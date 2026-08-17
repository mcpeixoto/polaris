package main

import (
	"context"
	"flag"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Seed data matters more here than in most products.
//
// The client renders everything from a local replica, so list virtualisation, index
// rebuild cost, bootstrap size and sync fan-out volume are all invisible on a workspace
// with twelve issues and all painful on a workspace with five thousand. A realistic seed
// is the only way to meet those problems during development rather than after launch.

var seedTitles = []string{
	"Sync engine drops deltas when the socket reconnects mid-batch",
	"Command menu should remember the last action per context",
	"Issue list janks at 5k rows on a cold index",
	"Add keyboard shortcut for moving an issue between teams",
	"Bootstrap gzip level is wrong for large snapshots",
	"Private team leaks into the assignee picker",
	"Fractional index grows unbounded after repeated reordering",
	"Refresh token rotation logs the user out on a slow network",
	"Timestamps render in the wrong timezone on the board",
	"Archived issues still appear in search results",
	"Optimistic update flickers when the server rejects it",
	"Team key rename breaks existing issue links",
	"Comment thread collapses when a reply arrives",
	"Workspace switcher loads every workspace's issues",
	"Status reorder does not persist across a reload",
	"Cannot unassign an issue once an assignee is set",
	"Bulk status change only applies to the visible page",
	"Sub-issue count is wrong after moving the parent",
	"Idle sockets die behind the proxy after sixty seconds",
	"Duplicate issue numbers after a rolled-back transaction",
	"Activity feed shows three entries for one edit",
	"Guest can see the workspace member directory",
	"Search ranks exact identifier matches below fuzzy ones",
	"Deleting a status silently reassigns its issues",
	"Sort order collides when two clients insert at the same position",
}

var seedNames = []string{
	"Ada Lovelace", "Grace Hopper", "Alan Turing", "Barbara Liskov",
	"Edsger Dijkstra", "Katherine Johnson", "Donald Knuth", "Margaret Hamilton",
	"Ken Thompson", "Radia Perlman", "Leslie Lamport", "Karen Spärck Jones",
}

func seedCmd(args []string) error {
	fs := flag.NewFlagSet("seed", flag.ExitOnError)
	db := databaseFlag(fs)
	scale := fs.String("scale", "small", "small (1 team, 200 issues) or large (3 teams, 2000 issues)")
	// An explicit count, for measuring how the bootstrap snapshot and the client's index
	// build scale. The named scales are the ones to develop against; this is for the
	// question "what happens at ten thousand".
	issues := fs.Int("issues", 0, "total issues to create, overriding --scale")
	email := fs.String("email", "dev@polaris.local", "email of the account to create")
	password := fs.String("password", "polaris-dev-password", "password for that account")
	_ = fs.Parse(args)

	svc, closeFn, err := openService(*db)
	if err != nil {
		return err
	}
	defer closeFn()

	teams, issuesPerTeam := 1, 200
	if *scale == "large" {
		teams, issuesPerTeam = 3, 667
	}
	if *issues > 0 {
		issuesPerTeam = (*issues + teams - 1) / teams
	}

	ctx := context.Background()
	start := time.Now()

	// Seeding through the domain layer, not through raw SQL, on purpose: it exercises the
	// same validation, version minting and change-log emission a real user would, so the
	// seeded workspace is one a client can actually bootstrap and sync against. A seeder
	// that wrote rows directly would produce a workspace with an empty change log — and
	// the first thing anybody would test is sync.
	accountID, _, err := svc.Register(ctx, domain.RegisterInput{
		Email:    *email,
		Password: *password,
	})
	if err != nil {
		return fmt.Errorf("create account: %w", err)
	}

	ws, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID:       accountID,
		Name:            "Polaris",
		URLKey:          fmt.Sprintf("polaris-%d", time.Now().Unix()%100000),
		UserName:        "Dev",
		UserDisplayName: "dev",
		FirstTeamKey:    "ENG",
		FirstTeamName:   "Engineering",
	})
	if err != nil {
		return fmt.Errorf("create workspace: %w", err)
	}
	fmt.Printf("workspace %s (%s)\n", ws.Workspace.Name, ws.Workspace.URLKey)

	p, err := svc.ResolvePrincipal(ctx, accountID, ws.Workspace.ID)
	if err != nil {
		return err
	}

	// A deterministic source so two runs produce the same workspace: comparing a
	// performance measurement against yesterday's is meaningless if the data differs.
	rng := rand.New(rand.NewPCG(42, 1))

	memberIDs := []uuid.UUID{}
	for i, name := range seedNames {
		// Invited straight into the first team. A workspace whose people belong to no team
		// looks fine until you open the assignee picker on a private team and it is empty —
		// which is exactly the case seed data exists to exercise.
		invited, err := svc.InviteToWorkspace(ctx, p, domain.InviteInput{
			Email:   fmt.Sprintf("%s@polaris.local", strings.ToLower(strings.ReplaceAll(name, " ", "."))),
			Role:    string(authz.RoleMember),
			TeamIDs: []uuid.UUID{ws.Team.ID},
		})
		if err != nil {
			return fmt.Errorf("invite %s: %w", name, err)
		}
		// Accepting the invitation needs an account with the matching address.
		memberAccount, _, err := svc.Register(ctx, domain.RegisterInput{
			Email:    invited.Email,
			Password: *password,
		})
		if err != nil {
			return fmt.Errorf("register %s: %w", name, err)
		}
		user, _, err := svc.AcceptInvite(ctx, memberAccount, invited.Token, name)
		if err != nil {
			return fmt.Errorf("accept invite for %s: %w", name, err)
		}
		memberIDs = append(memberIDs, user.ID)
		if i >= 7 {
			break
		}
	}

	type seededTeam struct {
		id  uuid.UUID
		key string
	}
	teamIDs := []seededTeam{{ws.Team.ID, ws.Team.Key}}

	extraTeams := []struct{ key, name string }{
		{"DES", "Design"}, {"OPS", "Operations"},
	}
	for i := 0; i < teams-1 && i < len(extraTeams); i++ {
		t, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
			Key:  extraTeams[i].key,
			Name: extraTeams[i].name,
		})
		if err != nil {
			return fmt.Errorf("create team %s: %w", extraTeams[i].key, err)
		}
		teamIDs = append(teamIDs, seededTeam{t.ID, t.Key})
	}

	users, err := svc.ListUsers(ctx, p)
	if err != nil {
		return err
	}

	total := 0
	for _, team := range teamIDs {
		states, err := svc.ListWorkflowStates(ctx, p, team.id)
		if err != nil {
			return err
		}

		for i := range issuesPerTeam {
			title := seedTitles[rng.IntN(len(seedTitles))]
			if rng.IntN(3) == 0 {
				title = fmt.Sprintf("%s (%d)", title, i)
			}

			in := domain.CreateIssueInput{
				TeamID:   team.id,
				Title:    title,
				Priority: rng.IntN(5),
			}
			// Two thirds assigned, matching what a real backlog looks like — an entirely
			// assigned or entirely unassigned workspace hides grouping bugs.
			if rng.IntN(3) != 0 && len(users) > 0 {
				assignee := users[rng.IntN(len(users))].ID
				in.AssigneeID = &assignee
			}

			issue, _, err := svc.CreateIssue(ctx, p, in)
			if err != nil {
				return fmt.Errorf("create issue: %w", err)
			}
			total++

			// Spread issues across the workflow rather than leaving everything in the
			// backlog, so board columns and status grouping have something to show.
			if target := rng.IntN(len(states)); target > 0 {
				if _, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
					ID:      issue.ID,
					StateID: &states[target].ID,
				}); err != nil {
					return fmt.Errorf("move issue: %w", err)
				}
			}

			if rng.IntN(4) == 0 {
				if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
					IssueID: issue.ID,
					Body:    "Reproduced on main. Adding a failing test before touching the fix.",
				}); err != nil {
					return fmt.Errorf("create comment: %w", err)
				}
			}

			if total%200 == 0 {
				fmt.Printf("  %d issues…\n", total)
			}
		}
	}

	version, err := svc.WorkspaceVersion(ctx, ws.Workspace.ID)
	if err != nil {
		return err
	}

	fmt.Printf("\nseeded %d issues across %d teams and %d members in %s\n",
		total, len(teamIDs), len(memberIDs)+1, time.Since(start).Round(time.Millisecond))
	fmt.Printf("sync version: %d\n", version)
	fmt.Printf("sign in as %s / %s\n", *email, *password)
	fmt.Printf("workspace id: %s\n", ws.Workspace.ID)
	return nil
}
