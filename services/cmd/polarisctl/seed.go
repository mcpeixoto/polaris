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
	accountID, err := seedAccount(ctx, svc, *email, *password)
	if err != nil {
		return err
	}

	ws, firstTeam, err := seedWorkspace(ctx, svc, accountID)
	if err != nil {
		return err
	}
	fmt.Printf("workspace %s (%s)\n", ws.name, ws.urlKey)

	p, err := svc.ResolvePrincipal(ctx, accountID, ws.id)
	if err != nil {
		return err
	}

	// A deterministic source so two runs produce the same workspace: comparing a
	// performance measurement against yesterday's is meaningless if the data differs.
	rng := rand.New(rand.NewPCG(42, 1))

	memberCount, err := seedMembers(ctx, svc, p, firstTeam.id, *password)
	if err != nil {
		return err
	}

	teamIDs := []seededTeam{firstTeam}

	existingTeams, err := svc.ListTeams(ctx, p)
	if err != nil {
		return err
	}
	haveTeam := map[string]seededTeam{firstTeam.key: firstTeam}
	for _, t := range existingTeams {
		haveTeam[t.Key] = seededTeam{t.ID, t.Key}
		if t.ID != firstTeam.id {
			teamIDs = append(teamIDs, seededTeam{t.ID, t.Key})
		}
	}

	extraTeams := []struct{ key, name string }{
		{"DES", "Design"}, {"OPS", "Operations"},
	}
	for i := 0; i < teams-1 && i < len(extraTeams); i++ {
		if _, ok := haveTeam[extraTeams[i].key]; ok {
			continue
		}
		t, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{
			Key:  extraTeams[i].key,
			Name: extraTeams[i].name,
		})
		if err != nil {
			return fmt.Errorf("create team %s: %w", extraTeams[i].key, err)
		}
		teamIDs = append(teamIDs, seededTeam{t.ID, t.Key})
		haveTeam[t.Key] = seededTeam{t.ID, t.Key}
	}

	labelIDs, err := seedLabels(ctx, svc, p)
	if err != nil {
		return err
	}
	projectIDs, err := seedProjects(ctx, svc, p, teamIDs)
	if err != nil {
		return err
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
			if len(labelIDs) > 0 && rng.IntN(2) == 0 {
				in.LabelIDs = []uuid.UUID{labelIDs[rng.IntN(len(labelIDs))]}
			}
			if len(projectIDs) > 0 && rng.IntN(3) == 0 {
				project := projectIDs[rng.IntN(len(projectIDs))]
				in.ProjectID = &project
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

	version, err := svc.WorkspaceVersion(ctx, ws.id)
	if err != nil {
		return err
	}

	fmt.Printf("\nseeded %d issues across %d teams and %d members in %s\n",
		total, len(teamIDs), memberCount, time.Since(start).Round(time.Millisecond))
	fmt.Printf("sync version: %d\n", version)
	fmt.Printf("sign in as %s / %s\n", *email, *password)
	fmt.Printf("workspace id: %s\n", ws.id)
	return nil
}

type seededWorkspace struct {
	id     uuid.UUID
	name   string
	urlKey string
}

type seededTeam struct {
	id  uuid.UUID
	key string
}

// seedAccount creates the bootstrap account, or signs in if it already exists.
//
// Register admits the first account on an empty install and nobody else unless they
// hold an invitation. A failed seed therefore cannot re-register the same address,
// and flipping POLARIS_REGISTRATION_MODE does not help: polarisctl never reads it.
// Login is the resume path; it does not open signup.
func seedAccount(ctx context.Context, svc *domain.Service, email, password string) (uuid.UUID, error) {
	accountID, _, err := svc.Register(ctx, domain.RegisterInput{
		Email:    email,
		Password: password,
	})
	if err == nil {
		return accountID, nil
	}
	accountID, _, err = svc.Login(ctx, domain.LoginInput{
		Email:    email,
		Password: password,
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("create account: %w", err)
	}
	return accountID, nil
}

func seedWorkspace(ctx context.Context, svc *domain.Service, accountID uuid.UUID) (seededWorkspace, seededTeam, error) {
	existing, err := svc.ListWorkspacesForAccount(ctx, accountID)
	if err != nil {
		return seededWorkspace{}, seededTeam{}, err
	}
	if len(existing) > 0 {
		ws := existing[0]
		p, err := svc.ResolvePrincipal(ctx, accountID, ws.ID)
		if err != nil {
			return seededWorkspace{}, seededTeam{}, err
		}
		teams, err := svc.ListTeams(ctx, p)
		if err != nil {
			return seededWorkspace{}, seededTeam{}, err
		}
		if len(teams) == 0 {
			return seededWorkspace{}, seededTeam{}, fmt.Errorf("workspace %s has no teams", ws.URLKey)
		}
		first := seededTeam{teams[0].ID, teams[0].Key}
		for _, t := range teams {
			if t.Key == "ENG" {
				first = seededTeam{t.ID, t.Key}
				break
			}
		}
		return seededWorkspace{ws.ID, ws.Name, ws.URLKey}, first, nil
	}

	created, err := svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID:       accountID,
		Name:            "Polaris",
		URLKey:          fmt.Sprintf("polaris-%d", time.Now().Unix()%100000),
		UserName:        "Dev",
		UserDisplayName: "dev",
		FirstTeamKey:    "ENG",
		FirstTeamName:   "Engineering",
	})
	if err != nil {
		return seededWorkspace{}, seededTeam{}, fmt.Errorf("create workspace: %w", err)
	}
	return seededWorkspace{created.Workspace.ID, created.Workspace.Name, created.Workspace.URLKey},
		seededTeam{created.Team.ID, created.Team.Key}, nil
}

// seedMembers invites teammates and registers them with the invitation token.
//
// The token has to travel on Register: after the bootstrap account exists the
// install is invite-only, and a bare Register is refused. Register redeems the
// invitation in the same transaction, so there is no second AcceptInvite call
// on the happy path — that endpoint is for an account that already exists.
func seedMembers(ctx context.Context, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, password string) (int, error) {
	already := map[string]struct{}{}
	users, err := svc.ListUsers(ctx, p)
	if err != nil {
		return 0, err
	}
	for _, u := range users {
		if u.Email != nil {
			already[strings.ToLower(*u.Email)] = struct{}{}
		}
	}

	for i, name := range seedNames {
		if i >= 8 {
			break
		}
		email := fmt.Sprintf("%s@polaris.local", strings.ToLower(strings.ReplaceAll(name, " ", ".")))
		if _, ok := already[email]; ok {
			continue
		}
		// Invited straight into the first team. A workspace whose people belong to no team
		// looks fine until you open the assignee picker on a private team and it is empty —
		// which is exactly the case seed data exists to exercise.
		invited, err := svc.InviteToWorkspace(ctx, p, domain.InviteInput{
			Email:   email,
			Role:    string(authz.RoleMember),
			TeamIDs: []uuid.UUID{teamID},
		})
		if err != nil {
			return 0, fmt.Errorf("invite %s: %w", name, err)
		}
		_, _, err = svc.Register(ctx, domain.RegisterInput{
			Email:       invited.Email,
			Password:    password,
			InviteToken: invited.Token,
			DisplayName: name,
		})
		if err != nil {
			// Account already exists from a previous partial seed: sign in and redeem.
			accountID, _, loginErr := svc.Login(ctx, domain.LoginInput{
				Email:    invited.Email,
				Password: password,
			})
			if loginErr != nil {
				return 0, fmt.Errorf("register %s: %w", name, err)
			}
			if _, _, err := svc.AcceptInvite(ctx, accountID, invited.Token, name); err != nil {
				return 0, fmt.Errorf("accept invite for %s: %w", name, err)
			}
		}
	}

	users, err = svc.ListUsers(ctx, p)
	if err != nil {
		return 0, err
	}
	return len(users), nil
}

func seedLabels(ctx context.Context, svc *domain.Service, p *authz.Principal) ([]uuid.UUID, error) {
	existing, err := svc.ListLabels(ctx, p)
	if err != nil {
		return nil, err
	}
	have := map[string]uuid.UUID{}
	for _, l := range existing {
		if !l.IsGroup {
			have[strings.ToLower(l.Name)] = l.ID
		}
	}

	want := []struct{ name, color string }{
		{"Bug", "#eb5757"},
		{"Feature", "#5e6ad2"},
		{"Performance", "#f2c94c"},
		{"Security", "#27ae60"},
	}
	ids := make([]uuid.UUID, 0, len(want))
	for _, spec := range want {
		if id, ok := have[strings.ToLower(spec.name)]; ok {
			ids = append(ids, id)
			continue
		}
		color := spec.color
		label, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{
			Name:  spec.name,
			Color: &color,
		})
		if err != nil {
			return nil, fmt.Errorf("create label %s: %w", spec.name, err)
		}
		ids = append(ids, label.ID)
	}
	return ids, nil
}

func seedProjects(ctx context.Context, svc *domain.Service, p *authz.Principal, teams []seededTeam) ([]uuid.UUID, error) {
	if len(teams) == 0 {
		return nil, nil
	}
	teamIDs := make([]uuid.UUID, len(teams))
	for i, t := range teams {
		teamIDs[i] = t.id
	}

	existing, err := svc.ListProjects(ctx, p)
	if err != nil {
		return nil, err
	}
	have := map[string]uuid.UUID{}
	for _, project := range existing {
		have[strings.ToLower(project.Name)] = project.ID
	}

	want := []string{"Sync reliability", "Issue list performance"}
	ids := make([]uuid.UUID, 0, len(want))
	for _, name := range want {
		if id, ok := have[strings.ToLower(name)]; ok {
			ids = append(ids, id)
			continue
		}
		project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
			Name:    name,
			TeamIDs: teamIDs,
		})
		if err != nil {
			return nil, fmt.Errorf("create project %s: %w", name, err)
		}
		ids = append(ids, project.ID)
	}
	return ids, nil
}
