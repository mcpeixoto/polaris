package linear

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Source is the Linear importer, as the domain's job runner sees it.
type Source struct {
	// BaseURL is Linear's GraphQL endpoint; empty means the real one.
	BaseURL string
	HTTP    *http.Client

	// sleep replaces the client's rate-limit wait in tests.
	sleep func(context.Context, time.Duration) error
}

var _ domain.ImportSource = (*Source)(nil)

func (s *Source) Name() string { return model.ImportSourceLinear }

func (s *Source) client(apiKey string) *Client {
	c := NewClient(s.BaseURL, apiKey, s.HTTP)
	if s.sleep != nil {
		c.sleep = s.sleep
	}
	return c
}

// Validate asks Linear who the key belongs to.
func (s *Source) Validate(ctx context.Context, apiKey string) error {
	if _, err := s.client(apiKey).Viewer(ctx); err != nil {
		var pe *platform.Error
		if errors.As(err, &pe) {
			return err
		}
		// COPY: new string.
		return &platform.Error{
			Code: platform.CodeValidation, Field: "apiKey",
			Message: "could not reach Linear to check that key", Err: err,
		}
	}
	return nil
}

// Run copies the key's workspace in.
func (s *Source) Run(ctx context.Context, run *domain.ImportRun) error {
	w, err := s.client(run.APIKey).FetchWorkspace(ctx)
	if err != nil {
		return err
	}
	m := newMapper(run, w)
	for _, step := range []func(context.Context) error{
		m.importTeams, m.importStates, m.importLabels, m.importUsers, m.importProjects,
		m.importCycles, m.importIssues, m.importParents, m.importRelations, m.importComments,
		m.importArchive,
	} {
		if err := step(ctx); err != nil {
			return err
		}
	}
	return nil
}

// progressEvery is how many entities pass between progress writes. Often enough that the
// job's heartbeat never goes quiet for anything like the stale sweep's fifteen minutes, and
// rarely enough that the progress bar is not most of the import's writes.
const progressEvery = 25

// mapper holds what each Linear object became, for the steps that follow it.
type mapper struct {
	run *domain.ImportRun
	svc *domain.Service
	w   *Workspace

	teams    map[string]uuid.UUID
	states   map[string]uuid.UUID
	labels   map[string]uuid.UUID
	groups   map[string]bool // Linear label ids that are groups here, so never applied
	users    map[string]uuid.UUID
	names    map[string]string // every Linear user's name, matched or not
	projects map[string]uuid.UUID
	cycles   map[string]uuid.UUID
	issues   map[string]uuid.UUID
	comments map[string]uuid.UUID

	// authors caches a principal per comment author, or nil for one who cannot write there.
	authors map[uuid.UUID]*authz.Principal
}

func newMapper(run *domain.ImportRun, w *Workspace) *mapper {
	m := &mapper{
		run: run, svc: run.Service(), w: w,
		teams: map[string]uuid.UUID{}, states: map[string]uuid.UUID{},
		labels: map[string]uuid.UUID{}, groups: map[string]bool{},
		users: map[string]uuid.UUID{}, names: map[string]string{},
		projects: map[string]uuid.UUID{}, cycles: map[string]uuid.UUID{},
		issues: map[string]uuid.UUID{}, comments: map[string]uuid.UUID{},
		authors: map[uuid.UUID]*authz.Principal{},
	}
	for _, u := range w.Users {
		name := strings.TrimSpace(u.Name)
		if name == "" {
			name = strings.TrimSpace(u.DisplayName)
		}
		m.names[u.ID] = name
	}
	return m
}

// lookup returns a link a previous run made, filling into.
func (m *mapper) lookup(ctx context.Context, entity, externalID string, into map[string]uuid.UUID) (bool, error) {
	id, ok, err := m.run.Lookup(ctx, entity, externalID)
	if err != nil || !ok {
		return false, err
	}
	into[externalID] = id
	return true, nil
}

func (m *mapper) remember(ctx context.Context, entity, externalID string, id uuid.UUID, into map[string]uuid.UUID) error {
	into[externalID] = id
	return m.run.Remember(ctx, entity, externalID, id)
}

func (m *mapper) progress(ctx context.Context, entity string, done, total int) error {
	if done != total && done%progressEvery != 0 {
		return nil
	}
	return m.run.Progress(ctx, entity, done, total)
}

// ---------------------------------------------------------------------------------------
// Teams, statuses, labels, people.

var teamKeyChars = regexp.MustCompile(`[^A-Z0-9]`)

// teamKey makes a Linear key one this product accepts: one to eight uppercase letters and
// digits, starting with a letter. Linear's own rules are close enough that this changes
// nothing for almost every team.
func teamKey(key string) string {
	k := teamKeyChars.ReplaceAllString(strings.ToUpper(key), "")
	if k == "" || !unicode.IsLetter(rune(k[0])) {
		k = "T" + k
	}
	if len(k) > 8 {
		k = k[:8]
	}
	return k
}

func (m *mapper) importTeams(ctx context.Context) error {
	existing, err := m.run.Teams(ctx)
	if err != nil {
		return err
	}
	byKey := map[string]uuid.UUID{}
	for _, t := range existing {
		byKey[strings.ToUpper(t.Key)] = t.ID
	}
	for i, t := range m.w.Teams {
		if ok, err := m.lookup(ctx, "team", t.ID, m.teams); err != nil {
			return err
		} else if !ok {
			key := teamKey(t.Key)
			id, matched := byKey[key]
			if !matched {
				created, _, err := m.svc.CreateTeam(ctx, m.run.Principal(), domain.CreateTeamInput{
					Key: key, Name: t.Name,
				})
				if err != nil {
					return fmt.Errorf("team %s: %w", t.Key, err)
				}
				id = created.ID
				byKey[key] = id
			}
			if err := m.remember(ctx, "team", t.ID, id, m.teams); err != nil {
				return err
			}
		}
		if err := m.progress(ctx, "team", i+1, len(m.w.Teams)); err != nil {
			return err
		}
	}
	// The admin's principal was built before these teams existed.
	return m.run.RefreshPrincipal(ctx)
}

// category maps a Linear state type onto a status category. They are the same six words;
// triage is the exception, because a team here that is not running triage has nowhere to
// put an issue in it, and the backlog is the closest thing it has.
func category(linearType string, triageEnabled bool) string {
	switch linearType {
	case domain.CategoryTriage:
		if triageEnabled {
			return domain.CategoryTriage
		}
		return domain.CategoryBacklog
	case domain.CategoryBacklog, domain.CategoryUnstarted, domain.CategoryStarted,
		domain.CategoryCompleted, domain.CategoryCanceled:
		return linearType
	default:
		return domain.CategoryBacklog
	}
}

func (m *mapper) importStates(ctx context.Context) error {
	byTeam := map[uuid.UUID][]model.WorkflowState{}
	teamInfo := map[uuid.UUID]domain.ImportTeam{}
	for i, st := range m.w.WorkflowStates {
		if err := m.state(ctx, st, byTeam, teamInfo); err != nil {
			return err
		}
		if err := m.progress(ctx, "state", i+1, len(m.w.WorkflowStates)); err != nil {
			return err
		}
	}
	return nil
}

func (m *mapper) state(
	ctx context.Context, st WorkflowState,
	byTeam map[uuid.UUID][]model.WorkflowState, teamInfo map[uuid.UUID]domain.ImportTeam,
) error {
	if ok, err := m.lookup(ctx, "state", st.ID, m.states); err != nil || ok {
		return err
	}
	if st.Team == nil {
		return nil
	}
	teamID, ok := m.teams[st.Team.ID]
	if !ok {
		return nil
	}
	info, seen := teamInfo[teamID]
	if !seen {
		t, err := m.run.Team(ctx, teamID)
		if err != nil {
			return err
		}
		info = t
		teamInfo[teamID] = t
	}
	list, seen := byTeam[teamID]
	if !seen {
		l, err := m.run.WorkflowStates(ctx, teamID)
		if err != nil {
			return err
		}
		list = l
		byTeam[teamID] = l
	}

	cat := category(st.Type, info.TriageEnabled)
	for _, have := range list {
		if have.Category == cat && strings.EqualFold(have.Name, strings.TrimSpace(st.Name)) {
			return m.remember(ctx, "state", st.ID, have.ID, m.states)
		}
	}
	if st.Type == domain.CategoryTriage && cat != domain.CategoryTriage {
		// Linear's triage status in a team not running triage here. Creating a backlog
		// status called Triage would be a status nobody chose; the team's default is where
		// an untriaged issue would have landed anyway.
		for _, have := range list {
			if have.IsDefault {
				return m.remember(ctx, "state", st.ID, have.ID, m.states)
			}
		}
	}

	var color string
	if hexColor.MatchString(st.Color) {
		color = st.Color
	}
	created, _, err := m.svc.CreateWorkflowState(ctx, m.run.Principal(), domain.CreateWorkflowStateInput{
		TeamID: teamID, Name: st.Name, Category: cat, Color: color,
	})
	if err != nil {
		return fmt.Errorf("status %q: %w", st.Name, err)
	}
	byTeam[teamID] = append(list, created)
	return m.remember(ctx, "state", st.ID, created.ID, m.states)
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (m *mapper) importLabels(ctx context.Context) error {
	isParent := map[string]bool{}
	for _, l := range m.w.Labels {
		if l.Parent != nil {
			isParent[l.Parent.ID] = true
		}
	}
	// Groups first, so a label's group exists by the time the label needs it.
	ordered := append([]IssueLabel(nil), m.w.Labels...)
	sort.SliceStable(ordered, func(i, j int) bool { return isParent[ordered[i].ID] && !isParent[ordered[j].ID] })

	cache := map[string][]model.Label{}
	for i, l := range ordered {
		if isParent[l.ID] {
			m.groups[l.ID] = true
		}
		if err := m.label(ctx, l, isParent[l.ID], cache); err != nil {
			return err
		}
		if err := m.progress(ctx, "label", i+1, len(ordered)); err != nil {
			return err
		}
	}
	return nil
}

func (m *mapper) label(ctx context.Context, l IssueLabel, group bool, cache map[string][]model.Label) error {
	if ok, err := m.lookup(ctx, "label", l.ID, m.labels); err != nil || ok {
		return err
	}
	var teamID *uuid.UUID
	if l.Team != nil {
		id, ok := m.teams[l.Team.ID]
		if !ok {
			return nil
		}
		teamID = &id
	}
	scope := "workspace"
	if teamID != nil {
		scope = teamID.String()
	}
	list, seen := cache[scope]
	if !seen {
		got, err := m.run.Labels(ctx, teamID)
		if err != nil {
			return err
		}
		list = got
		cache[scope] = got
	}
	name := strings.TrimSpace(l.Name)
	for _, have := range list {
		if strings.EqualFold(have.Name, name) {
			if have.IsGroup {
				m.groups[l.ID] = true
			}
			return m.remember(ctx, "label", l.ID, have.ID, m.labels)
		}
	}

	in := domain.CreateLabelInput{TeamID: teamID, Name: name, IsGroup: group}
	if hexColor.MatchString(l.Color) {
		c := l.Color
		in.Color = &c
	}
	if l.Parent != nil {
		if parent, ok := m.labels[l.Parent.ID]; ok && m.groups[l.Parent.ID] {
			in.ParentID = &parent
		}
	}
	created, _, err := m.svc.CreateLabel(ctx, m.run.Principal(), in)
	if err != nil {
		return fmt.Errorf("label %q: %w", l.Name, err)
	}
	cache[scope] = append(list, created)
	return m.remember(ctx, "label", l.ID, created.ID, m.labels)
}

// users matches by email and creates nobody. Inviting people is a decision about who is in
// this workspace, which an import is not entitled to make on the admin's behalf; work
// belonging to somebody unmatched arrives unassigned with their name written on it.
func (m *mapper) importUsers(ctx context.Context) error {
	members, err := m.run.MemberEmails(ctx)
	if err != nil {
		return err
	}
	for i, u := range m.w.Users {
		if ok, err := m.lookup(ctx, "user", u.ID, m.users); err != nil {
			return err
		} else if !ok {
			if id, matched := members[strings.ToLower(strings.TrimSpace(u.Email))]; matched && u.Email != "" {
				if err := m.remember(ctx, "user", u.ID, id, m.users); err != nil {
					return err
				}
			}
		}
		if err := m.progress(ctx, "user", i+1, len(m.w.Users)); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------------------
// Projects and cycles.

func (m *mapper) importProjects(ctx context.Context) error {
	for i, pr := range m.w.Projects {
		if err := m.project(ctx, pr); err != nil {
			return err
		}
		if err := m.progress(ctx, "project", i+1, len(m.w.Projects)); err != nil {
			return err
		}
	}
	return nil
}

func (m *mapper) project(ctx context.Context, pr Project) error {
	if ok, err := m.lookup(ctx, "project", pr.ID, m.projects); err != nil || ok {
		return err
	}
	if id, ok, err := m.run.ProjectByName(ctx, strings.TrimSpace(pr.Name)); err != nil {
		return err
	} else if ok {
		return m.remember(ctx, "project", pr.ID, id, m.projects)
	}

	var teams []uuid.UUID
	for _, t := range pr.Teams.Nodes {
		if id, ok := m.teams[t.ID]; ok {
			teams = append(teams, id)
		}
	}
	if len(teams) == 0 {
		// A project with no team is one nobody can open. Its issues still import; they
		// arrive without it.
		return nil
	}
	in := domain.CreateProjectInput{
		Name: strings.TrimSpace(pr.Name), Description: pr.Description, TeamIDs: teams,
		StartDate: linearDate(pr.StartDate), TargetDate: linearDate(pr.TargetDate),
	}
	if pr.Lead != nil {
		if id, ok := m.users[pr.Lead.ID]; ok {
			in.LeadID = &id
		}
	}
	created, _, err := m.svc.CreateProject(ctx, m.run.Principal(), in)
	if err != nil {
		return fmt.Errorf("project %q: %w", pr.Name, err)
	}
	return m.remember(ctx, "project", pr.ID, created.ID, m.projects)
}

func linearDate(s *string) *model.Date {
	if s == nil || len(*s) < 10 {
		return nil
	}
	d := model.Date((*s)[:10])
	return &d
}

func (m *mapper) importCycles(ctx context.Context) error {
	for i, c := range m.w.Cycles {
		if ok, err := m.lookup(ctx, "cycle", c.ID, m.cycles); err != nil {
			return err
		} else if !ok && c.Team != nil {
			if teamID, mapped := m.teams[c.Team.ID]; mapped {
				name := ""
				if c.Name != nil {
					name = *c.Name
				}
				id, err := m.run.CreateCycle(ctx, teamID, int32(c.Number), name, c.StartsAt, c.EndsAt)
				if err != nil {
					return fmt.Errorf("cycle %v: %w", c.Number, err)
				}
				if err := m.remember(ctx, "cycle", c.ID, id, m.cycles); err != nil {
					return err
				}
			}
		}
		if err := m.progress(ctx, "cycle", i+1, len(m.w.Cycles)); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------------------
// Issues.

// maxTitle mirrors the domain's own limit, so an overlong Linear title is cut rather than
// failing the whole job.
const maxTitle = 512

func (m *mapper) importIssues(ctx context.Context) error {
	ordered := append([]Issue(nil), m.w.Issues...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Number < ordered[j].Number })

	var pending []Issue
	for _, is := range ordered {
		if ok, err := m.lookup(ctx, "issue", is.ID, m.issues); err != nil {
			return err
		} else if ok {
			continue
		}
		if is.Team == nil {
			continue
		}
		if _, ok := m.teams[is.Team.ID]; !ok {
			continue
		}
		pending = append(pending, is)
	}

	// The whole batch against the plan, once, before the first issue is written.
	if err := m.run.CheckIssueAllowance(ctx, len(pending)); err != nil {
		return err
	}

	for i, is := range pending {
		if err := m.issue(ctx, is); err != nil {
			return err
		}
		if err := m.progress(ctx, "issue", i+1, len(pending)); err != nil {
			return err
		}
	}
	if len(pending) == 0 {
		return m.run.Progress(ctx, "issue", 0, 0)
	}
	return nil
}

func (m *mapper) issue(ctx context.Context, is Issue) error {
	in := domain.CreateIssueInput{
		TeamID:   m.teams[is.Team.ID],
		Title:    strings.TrimSpace(is.Title),
		Priority: priority(is.Priority),
	}
	if in.Title == "" {
		in.Title = is.Identifier
	}
	if len(in.Title) > maxTitle {
		in.Title = in.Title[:maxTitle]
	}
	if is.Description != nil {
		in.Description = *is.Description
	}
	if is.State != nil {
		if id, ok := m.states[is.State.ID]; ok {
			in.StateID = &id
		}
	}
	if is.Estimate != nil {
		e := int(math.Round(*is.Estimate))
		in.Estimate = &e
	}
	in.DueDate = linearDate(is.DueDate)
	for _, l := range is.Labels.Nodes {
		if id, ok := m.labels[l.ID]; ok && !m.groups[l.ID] {
			in.LabelIDs = append(in.LabelIDs, id)
		}
	}
	if is.Project != nil {
		if id, ok := m.projects[is.Project.ID]; ok {
			in.ProjectID = &id
		}
	}
	if is.Cycle != nil {
		if id, ok := m.cycles[is.Cycle.ID]; ok {
			in.CycleID = &id
		}
	}

	var unassignedName string
	if is.Assignee != nil {
		if id, ok := m.users[is.Assignee.ID]; ok {
			in.AssigneeID = &id
		} else {
			unassignedName = m.nameOf(is.Assignee.ID)
		}
	}

	imp := domain.ImportedIssue{
		ExternalID:  is.ID,
		Number:      int64(is.Number),
		CreatedAt:   &is.CreatedAt,
		CompletedAt: is.CompletedAt,
		CanceledAt:  is.CanceledAt,
	}

	created, err := m.run.CreateIssue(ctx, withAssigneeNote(in, unassignedName), imp)
	if err != nil && in.AssigneeID != nil && isFieldError(err, "assigneeId") {
		// Matched by email and still not assignable here: a guest outside the team, or
		// somebody suspended since. The issue matters more than who it was assigned to.
		name := m.nameOf(is.Assignee.ID)
		in.AssigneeID = nil
		created, err = m.run.CreateIssue(ctx, withAssigneeNote(in, name), imp)
	}
	if err != nil {
		return fmt.Errorf("issue %s: %w", is.Identifier, err)
	}
	return m.remember(ctx, "issue", is.ID, created.ID, m.issues)
}

func withAssigneeNote(in domain.CreateIssueInput, name string) domain.CreateIssueInput {
	if name == "" {
		return in
	}
	// COPY: new string, appended to an imported issue whose assignee has no account here.
	note := "Imported from Linear: assigned to " + name
	if strings.TrimSpace(in.Description) == "" {
		in.Description = note
	} else {
		in.Description = strings.TrimRight(in.Description, "\n") + "\n\n" + note
	}
	return in
}

func (m *mapper) nameOf(linearUserID string) string {
	if n := m.names[linearUserID]; n != "" {
		return n
	}
	// COPY: new string, for a Linear user the API did not describe (an integration, say).
	return "a Linear user"
}

func isFieldError(err error, field string) bool {
	var pe *platform.Error
	return errors.As(err, &pe) && pe.Code == platform.CodeValidation && pe.Field == field
}

// priority maps Linear's scale onto ours. They are the same scale — 0 none, 1 urgent,
// 2 high, 3 medium, 4 low — so this only guards the range.
func priority(p float64) int {
	n := int(p)
	if n < 0 || n > 4 {
		return 0
	}
	return n
}

// parents links sub-issues once every issue exists, because a child can come before its
// parent in Linear's order and across teams.
func (m *mapper) importParents(ctx context.Context) error {
	done := 0
	var withParent []Issue
	for _, is := range m.w.Issues {
		if is.Parent != nil {
			withParent = append(withParent, is)
		}
	}
	for _, is := range withParent {
		done++
		child, ok := m.issues[is.ID]
		parent, ok2 := m.issues[is.Parent.ID]
		if ok && ok2 {
			current, err := m.svc.GetIssue(ctx, m.run.Principal(), child)
			if err != nil {
				return fmt.Errorf("issue %s: %w", is.Identifier, err)
			}
			if current.ParentID == nil || *current.ParentID != parent {
				if _, _, err := m.svc.UpdateIssue(ctx, m.run.Principal(), domain.UpdateIssueInput{
					ID: child, ParentID: &parent,
				}); err != nil {
					return fmt.Errorf("parent of %s: %w", is.Identifier, err)
				}
			}
		}
		if err := m.progress(ctx, "parent", done, len(withParent)); err != nil {
			return err
		}
	}
	return nil
}

// relationType maps Linear's relation types onto ours. Linear's `similar` is a suggestion
// its own product made, not a link a person drew, and `related` is the closest honest
// reading of it.
func relationType(t string) string {
	switch t {
	case "blocks":
		return model.RelationBlocks
	case "duplicate":
		return model.RelationDuplicate
	case "related", "similar":
		return model.RelationRelated
	}
	return ""
}

// relations are not import_link entities: the pair and the type are the identity, and the
// domain refuses a second identical link, which is what makes a rerun a no-op here.
func (m *mapper) importRelations(ctx context.Context) error {
	for i, r := range m.w.Relations {
		if r.Issue != nil && r.RelatedIssue != nil {
			a, ok := m.issues[r.Issue.ID]
			b, ok2 := m.issues[r.RelatedIssue.ID]
			typ := relationType(r.Type)
			if ok && ok2 && typ != "" && a != b {
				if _, _, err := m.svc.CreateIssueRelation(ctx, m.run.Principal(), a, b, typ); err != nil &&
					!isFieldError(err, "relatedIssueId") {
					return fmt.Errorf("relation %s: %w", r.ID, err)
				}
			}
		}
		if err := m.progress(ctx, "relation", i+1, len(m.w.Relations)); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------------------
// Comments, and archiving.

func (m *mapper) importComments(ctx context.Context) error {
	// Oldest first, so a reply's parent has been written by the time the reply is.
	ordered := append([]Comment(nil), m.w.Comments...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].CreatedAt.Before(ordered[j].CreatedAt) })
	for i, c := range ordered {
		if err := m.comment(ctx, c); err != nil {
			return err
		}
		if err := m.progress(ctx, "comment", i+1, len(ordered)); err != nil {
			return err
		}
	}
	return nil
}

func (m *mapper) comment(ctx context.Context, c Comment) error {
	if ok, err := m.lookup(ctx, "comment", c.ID, m.comments); err != nil || ok {
		return err
	}
	if c.Issue == nil || strings.TrimSpace(c.Body) == "" {
		return nil
	}
	issueID, ok := m.issues[c.Issue.ID]
	if !ok {
		return nil
	}
	in := domain.CreateCommentInput{IssueID: issueID, Body: c.Body}
	if c.Parent != nil {
		if id, ok := m.comments[c.Parent.ID]; ok {
			in.ParentID = &id
		}
	}

	var author *authz.Principal
	if c.User != nil {
		if userID, ok := m.users[c.User.ID]; ok {
			author = m.author(ctx, userID)
		}
	}
	var created model.Comment
	var err error
	if author != nil {
		created, _, err = m.svc.CreateComment(ctx, author, in)
		if code := platform.CodeOf(err); code == platform.CodeForbidden || code == platform.CodeNotFound {
			// They are a member here but cannot reach this team. Written by the admin
			// instead, under their name, the same as somebody with no account at all.
			author = nil
		}
	}
	if author == nil {
		name := "a Linear user"
		if c.User != nil {
			name = m.nameOf(c.User.ID)
		}
		// COPY: new string, the byline on a comment whose author has no account here.
		in.Body = "**" + name + "** wrote:\n\n" + c.Body
		created, _, err = m.svc.CreateComment(ctx, m.run.Principal(), in)
	}
	if err != nil {
		return fmt.Errorf("comment %s: %w", c.ID, err)
	}
	return m.remember(ctx, "comment", c.ID, created.ID, m.comments)
}

func (m *mapper) author(ctx context.Context, userID uuid.UUID) *authz.Principal {
	if p, seen := m.authors[userID]; seen {
		return p
	}
	p, err := m.run.PrincipalFor(ctx, userID)
	if err != nil {
		p = nil
	}
	m.authors[userID] = p
	return p
}

// archive runs last, because an archived issue takes no new parent, relation or comment.
func (m *mapper) importArchive(ctx context.Context) error {
	for _, is := range m.w.Issues {
		if is.ArchivedAt == nil {
			continue
		}
		id, ok := m.issues[is.ID]
		if !ok {
			continue
		}
		current, err := m.svc.GetIssue(ctx, m.run.Principal(), id)
		if err != nil {
			if platform.CodeOf(err) == platform.CodeNotFound {
				continue
			}
			return fmt.Errorf("issue %s: %w", is.Identifier, err)
		}
		if current.ArchivedAt != nil {
			continue
		}
		if _, err := m.svc.ArchiveIssue(ctx, m.run.Principal(), id, true); err != nil {
			return fmt.Errorf("archive %s: %w", is.Identifier, err)
		}
	}
	return nil
}
