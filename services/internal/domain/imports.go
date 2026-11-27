package domain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Imports from another tracker.
//
// The domain owns the job — who may start one, the queue, the key's lifetime, the links that
// make a second run find the first one's work — and a source package owns the tracker: its
// API, its shapes, and how they map onto ours. The source writes through the ordinary create
// paths, with the context marked by WithImport, so an imported issue is validated, emitted
// and synced exactly like one somebody typed, and differs only in being silent.
//
// The source is handed in rather than imported because it imports this package to do its
// writes; the dependency can only point one way.

// importStaleAfter is how long a running job may go without reporting progress before the
// sweep decides its worker died. Progress is written every few dozen entities, so a live job
// touches its row far more often than this; a job silent for this long is not coming back.
const importStaleAfter = 15 * time.Minute

type importCtxKey struct{}

// WithImport marks every write made under ctx as part of an import: its changes are silent
// (see Change.Silent) and nobody is subscribed to anything because of it.
//
// A context flag rather than a parameter, because an import writes through a dozen create
// paths that each call SubscribeOnAction and Emit several layers down. Threading a boolean
// through all of them would change every signature for the sake of one caller, and the first
// path somebody forgot to thread would be the one that filled four hundred inboxes.
func WithImport(ctx context.Context) context.Context {
	return context.WithValue(ctx, importCtxKey{}, true)
}

func isImport(ctx context.Context) bool {
	on, _ := ctx.Value(importCtxKey{}).(bool)
	return on
}

// ImportSource is one tracker an import can read from.
type ImportSource interface {
	// Name is the import_job.source value this handles.
	Name() string
	// Validate proves a key works with the cheapest call the source has, so a typo fails
	// in the dialog that took it rather than in a job nobody is watching.
	Validate(ctx context.Context, apiKey string) error
	// Run copies everything. It must be safe to call again on the same workspace: a job
	// the sweep requeued, and a second import of the same source, both come back here and
	// must find what the first run made through run.Lookup instead of making it twice.
	Run(ctx context.Context, run *ImportRun) error
}

// RegisterImportSource wires a tracker into a service. A package function rather than a
// method because the API parity tests treat every method on Service as something a caller
// can do, and plugging in an HTTP client is something only main does.
func RegisterImportSource(s *Service, src ImportSource) {
	if s.importSources == nil {
		s.importSources = map[string]ImportSource{}
	}
	s.importSources[src.Name()] = src
}

// StartLinearImport queues an import of the Linear workspace a key belongs to.
//
// Admin-only, because an import writes teams, statuses and labels for the whole workspace
// and attributes work to people by email. The key is checked before anything is queued and
// stored only on the job, which drops it the moment the job ends.
func (s *Service) StartLinearImport(ctx context.Context, p *authz.Principal, apiKey string) (model.ImportJob, error) {
	if p == nil || !p.Role.IsAdmin() {
		// COPY: new string, shown when a member tries to start an import.
		return model.ImportJob{}, platform.Forbidden("only admins can import from another tracker")
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		// COPY: new string.
		return model.ImportJob{}, platform.Validation("apiKey", "paste a Linear API key")
	}
	src := s.importSources[model.ImportSourceLinear]
	if src == nil {
		// COPY: new string. A deployment that did not wire the importer.
		return model.ImportJob{}, platform.Conflict("importing from Linear is not available on this server")
	}
	if err := src.Validate(ctx, apiKey); err != nil {
		return model.ImportJob{}, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return model.ImportJob{}, platform.Internal(err)
	}
	creator := p.UserID
	row, err := s.db.Queries().InsertImportJob(ctx, store.InsertImportJobParams{
		ID:          id,
		WorkspaceID: p.WorkspaceID,
		Source:      model.ImportSourceLinear,
		CreatedBy:   &creator,
		ApiKey:      &apiKey,
	})
	if err != nil {
		return model.ImportJob{}, platform.Internal(err)
	}
	return toImportJob(store.GetImportJobRow(row)), nil
}

// GetImportJob is one job, for the admin watching it.
func (s *Service) GetImportJob(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.ImportJob, error) {
	if p == nil || !p.Role.IsAdmin() {
		return model.ImportJob{}, platform.NotFound("import")
	}
	row, err := s.db.Queries().GetImportJob(ctx, store.GetImportJobParams{ID: id, WorkspaceID: p.WorkspaceID})
	if err != nil {
		if store.IsNotFound(err) {
			return model.ImportJob{}, platform.NotFound("import")
		}
		return model.ImportJob{}, platform.Internal(err)
	}
	return toImportJob(row), nil
}

// ListImportJobs is the workspace's recent imports, newest first.
func (s *Service) ListImportJobs(ctx context.Context, p *authz.Principal) ([]model.ImportJob, error) {
	if p == nil || !p.Role.IsAdmin() {
		return nil, platform.Forbidden("only admins can see imports")
	}
	rows, err := s.db.Queries().ListImportJobs(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ImportJob, 0, len(rows))
	for _, r := range rows {
		out = append(out, toImportJob(store.GetImportJobRow(r)))
	}
	return out, nil
}

// RunQueuedImport claims the oldest queued import and runs it to the end. It reports false
// when the queue was empty.
//
// A package function, not a method, for the reason RegisterImportSource gives: it is the
// worker's, and no request may call it.
//
// A run cut off by its context is left running rather than failed. Failing it would drop
// the key, and with the key the only way to finish; left alone, it stops reporting progress
// and RequeueStaleImports puts it back in the queue, where the next claim resumes it from
// its import links.
func RunQueuedImport(ctx context.Context, s *Service) (bool, error) {
	q := s.db.Queries()
	claimed, err := q.ClaimQueuedImportJob(ctx)
	if err != nil {
		if store.IsNotFound(err) {
			return false, nil
		}
		return false, platform.Internal(err)
	}
	job := store.GetImportJobRow(claimed)

	fail := func(cause error) (bool, error) {
		msg := importFailureText(cause)
		if err := q.FinishImportJob(context.WithoutCancel(ctx), store.FinishImportJobParams{
			ID: job.ID, Status: model.ImportStatusFailed, Error: &msg,
		}); err != nil {
			return true, platform.Internal(fmt.Errorf("fail import %s: %w", job.ID, err))
		}
		return true, fmt.Errorf("import %s failed: %w", job.ID, cause)
	}

	key, err := q.GetImportJobAPIKey(ctx, job.ID)
	if err != nil {
		return fail(platform.Internal(err))
	}
	if key == nil || *key == "" {
		// COPY: new string.
		return fail(platform.Conflict("the import lost its API key; start it again"))
	}
	src := s.importSources[job.Source]
	if src == nil {
		// COPY: new string.
		return fail(platform.Conflict("importing from " + job.Source + " is not available on this server"))
	}
	if job.CreatedBy == nil {
		// COPY: new string.
		return fail(platform.Forbidden("the admin who started this import no longer exists"))
	}
	p, err := s.ResolvePrincipalForUser(ctx, job.WorkspaceID, *job.CreatedBy)
	if err != nil {
		return fail(err)
	}
	if !p.Role.IsAdmin() {
		// COPY: new string. Shown when the starter was demoted before the job ran.
		return fail(platform.Forbidden("the person who started this import is no longer an admin"))
	}

	run := &ImportRun{
		s:           s,
		JobID:       job.ID,
		WorkspaceID: job.WorkspaceID,
		Source:      job.Source,
		APIKey:      *key,
		p:           p,
	}
	if err := src.Run(WithImport(ctx), run); err != nil {
		if ctx.Err() != nil {
			return true, fmt.Errorf("import %s interrupted, left for the sweep: %w", job.ID, err)
		}
		return fail(err)
	}
	if err := q.FinishImportJob(context.WithoutCancel(ctx), store.FinishImportJobParams{
		ID: job.ID, Status: model.ImportStatusDone,
	}); err != nil {
		return true, platform.Internal(err)
	}
	return true, nil
}

// RequeueStaleImports puts every running job that has stopped reporting back in the queue.
func RequeueStaleImports(ctx context.Context, s *Service) (int64, error) {
	n, err := s.db.Queries().RequeueStaleImportJobs(ctx, time.Now().Add(-importStaleAfter))
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

// importFailureText is what the job row says went wrong. Only a classified error's message
// is shown — an internal one carries a database string or a URL, which the person reading
// the import page has no use for and should not be handed.
func importFailureText(err error) string {
	var pe *platform.Error
	if errors.As(err, &pe) && pe.Code != platform.CodeInternal && pe.Message != "" {
		return pe.Message
	}
	// COPY: new string.
	return "the import stopped unexpectedly"
}

func toImportJob(r store.GetImportJobRow) model.ImportJob {
	out := model.ImportJob{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		Source:      r.Source,
		Status:      r.Status,
		CreatedBy:   r.CreatedBy,
		Error:       r.Error,
		CreatedAt:   r.CreatedAt,
		StartedAt:   r.StartedAt,
		FinishedAt:  r.FinishedAt,
		Progress:    []model.ImportProgressStep{},
	}
	var raw map[string]struct {
		Done  int `json:"done"`
		Total int `json:"total"`
	}
	if len(r.Progress) > 0 && json.Unmarshal(r.Progress, &raw) == nil {
		for entity, p := range raw {
			out.Progress = append(out.Progress, model.ImportProgressStep{
				Entity: entity, Done: p.Done, Total: p.Total,
			})
		}
		sort.Slice(out.Progress, func(i, j int) bool { return out.Progress[i].Entity < out.Progress[j].Entity })
	}
	return out
}

// ---------------------------------------------------------------------------------------
// The run: what a source may do that a request may not.

// ImportRun is one claimed job, handed to the source that runs it.
//
// The ordinary writes — teams, statuses, labels, projects, issues, comments — go through
// Service like any other caller's. This type carries the few an import needs that no
// request may make: remembering what a source object became, writing an issue under the
// number it already had, placing a cycle where the source had it, and reporting progress.
type ImportRun struct {
	s *Service

	JobID       uuid.UUID
	WorkspaceID uuid.UUID
	Source      string
	APIKey      string

	p *authz.Principal
}

// ImportTeam is what a source needs to know about a team it is matching against.
type ImportTeam struct {
	ID            uuid.UUID
	Key           string
	TriageEnabled bool
}

// ImportedIssue is what a source knows about an issue beyond what CreateIssueInput holds.
type ImportedIssue struct {
	// ExternalID is the source's id for the issue. The link to it is written in the same
	// transaction as the issue.
	ExternalID  string
	Number      int64
	CreatedAt   *time.Time
	CompletedAt *time.Time
	CanceledAt  *time.Time
}

// Service is the domain, for the ordinary writes.
func (r *ImportRun) Service() *Service { return r.s }

// Principal is the admin who started the job. Every write the import makes is theirs,
// except a comment written as the person who wrote it in the source.
func (r *ImportRun) Principal() *authz.Principal { return r.p }

// RefreshPrincipal re-reads the admin's team set. A team the import just created is one the
// principal built at claim time does not know about, and a private one would refuse its
// own creator.
func (r *ImportRun) RefreshPrincipal(ctx context.Context) error {
	p, err := r.s.ResolvePrincipalForUser(ctx, r.WorkspaceID, r.p.UserID)
	if err != nil {
		return err
	}
	r.p = p
	return nil
}

// PrincipalFor is somebody else in the workspace, for writing a comment under their name.
func (r *ImportRun) PrincipalFor(ctx context.Context, userID uuid.UUID) (*authz.Principal, error) {
	return r.s.ResolvePrincipalForUser(ctx, r.WorkspaceID, userID)
}

// Lookup returns what a source object became here, if a run already made it.
func (r *ImportRun) Lookup(ctx context.Context, entity, externalID string) (uuid.UUID, bool, error) {
	id, err := r.s.db.Queries().GetImportLink(ctx, store.GetImportLinkParams{
		WorkspaceID: r.WorkspaceID, Source: r.Source, Entity: entity, ExternalID: externalID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return uuid.Nil, false, nil
		}
		return uuid.Nil, false, platform.Internal(err)
	}
	return id, true, nil
}

// Remember records what a source object became, so the next run finds it.
func (r *ImportRun) Remember(ctx context.Context, entity, externalID string, id uuid.UUID) error {
	if err := r.s.db.Queries().InsertImportLink(ctx, store.InsertImportLinkParams{
		WorkspaceID: r.WorkspaceID, JobID: r.JobID, Source: r.Source,
		Entity: entity, ExternalID: externalID, PolarisID: id,
	}); err != nil {
		return platform.Internal(err)
	}
	return nil
}

// Progress records how far one entity has got. It is also the job's heartbeat.
func (r *ImportRun) Progress(ctx context.Context, entity string, done, total int) error {
	if err := r.s.db.Queries().UpdateImportJobProgress(ctx, store.UpdateImportJobProgressParams{
		ID: r.JobID, Entity: entity, Done: int32(done), Total: int32(total),
	}); err != nil {
		return platform.Internal(err)
	}
	return nil
}

// CheckIssueAllowance asks the plan once for the whole batch. Each create checks again for
// itself, but an import that stopped at the plan's ceiling halfway through would leave a
// workspace with half of somebody's backlog and no clean way to say which half.
func (r *ImportRun) CheckIssueAllowance(ctx context.Context, n int) error {
	q := r.s.db.Queries()
	ent, err := entitlementSetFor(ctx, q, r.WorkspaceID)
	if err != nil {
		return err
	}
	held, err := q.CountIssuesInWorkspace(ctx, r.WorkspaceID)
	if err != nil {
		return platform.Internal(err)
	}
	return ent.CanAddIssues(int(held), n)
}

// CreateIssue files an issue the way CreateIssue does, keeping the number and dates it had
// in the source.
func (r *ImportRun) CreateIssue(
	ctx context.Context, in CreateIssueInput, imp ImportedIssue,
) (model.Issue, error) {
	if !isImport(ctx) {
		return model.Issue{}, platform.Internal(errors.New("import create outside WithImport"))
	}
	in.SkipDefaultTemplate = true
	in.imported = &importedIssue{
		number:      imp.Number,
		createdAt:   imp.CreatedAt,
		completedAt: imp.CompletedAt,
		canceledAt:  imp.CanceledAt,
	}
	if imp.ExternalID != "" {
		in.imported.link = &store.InsertImportLinkParams{
			WorkspaceID: r.WorkspaceID, JobID: r.JobID, Source: r.Source,
			Entity: "issue", ExternalID: imp.ExternalID,
		}
	}
	out, _, err := r.s.CreateIssue(ctx, r.p, in)
	return out, err
}

// CreateCycle places a cycle where the source had it. Teams here mint their own cycles from
// a cadence and there is no request that writes one directly; an import has to, or the
// issues filed under a past sprint lose it.
//
// The number is kept when the team has not used it; otherwise the cycle takes the next.
func (r *ImportRun) CreateCycle(
	ctx context.Context, teamID uuid.UUID, number int32, name string, startsAt, endsAt time.Time,
) (uuid.UUID, error) {
	if !endsAt.After(startsAt) {
		// COPY: new string.
		return uuid.Nil, platform.Validation("endsAt", "a cycle has to end after it starts")
	}
	var id uuid.UUID
	err := r.s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := q.GetTeam(ctx, teamID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		if team.WorkspaceID != r.WorkspaceID {
			return platform.NotFound("team")
		}
		cycles, err := q.ListCyclesForTeam(ctx, teamID)
		if err != nil {
			return platform.Internal(err)
		}
		for _, c := range cycles {
			if c.Number == number {
				if number, err = nextCycleNumber(ctx, q, teamID); err != nil {
					return err
				}
				break
			}
		}
		if number <= 0 {
			if number, err = nextCycleNumber(ctx, q, teamID); err != nil {
				return err
			}
		}
		name = strings.TrimSpace(name)
		if name == "" {
			name = fmt.Sprintf("Cycle %d", number)
		}
		newID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateCycle(ctx, store.CreateCycleParams{
			ID: newID, WorkspaceID: r.WorkspaceID, TeamID: teamID, Number: number,
			Name: name, StartsAt: startsAt, EndsAt: endsAt,
		})
		if err != nil {
			return platform.Internal(err)
		}
		id = row.ID
		_, err = r.s.em.Emit(ctx, q, r.WorkspaceID, r.p.Actor(), cycleChange(team, toCycle(row)))
		return err
	})
	return id, err
}

// MemberEmails maps each active member's lowercased email to their user id.
func (r *ImportRun) MemberEmails(ctx context.Context) (map[string]uuid.UUID, error) {
	rows, err := r.s.db.Queries().ListWorkspaceMemberEmails(ctx, r.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make(map[string]uuid.UUID, len(rows))
	for _, row := range rows {
		out[row.Email] = row.ID
	}
	return out, nil
}

// Teams lists the workspace's teams, for matching by key.
func (r *ImportRun) Teams(ctx context.Context) ([]ImportTeam, error) {
	rows, err := r.s.db.Queries().ListTeamsInWorkspace(ctx, r.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]ImportTeam, 0, len(rows))
	for _, t := range rows {
		out = append(out, ImportTeam{ID: t.ID, Key: t.Key, TriageEnabled: t.TriageEnabled})
	}
	return out, nil
}

// Team is one team, by id.
func (r *ImportRun) Team(ctx context.Context, id uuid.UUID) (ImportTeam, error) {
	t, err := r.s.db.Queries().GetTeam(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return ImportTeam{}, platform.NotFound("team")
		}
		return ImportTeam{}, platform.Internal(err)
	}
	if t.WorkspaceID != r.WorkspaceID {
		return ImportTeam{}, platform.NotFound("team")
	}
	return ImportTeam{ID: t.ID, Key: t.Key, TriageEnabled: t.TriageEnabled}, nil
}

// WorkflowStates lists a team's live statuses.
func (r *ImportRun) WorkflowStates(ctx context.Context, teamID uuid.UUID) ([]model.WorkflowState, error) {
	rows, err := r.s.db.Queries().ListWorkflowStatesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.WorkflowState, 0, len(rows))
	for _, row := range rows {
		out = append(out, toWorkflowState(row))
	}
	return out, nil
}

// Labels lists the labels a team's issues may carry: the workspace's and the team's own.
// A nil team lists the workspace's alone.
func (r *ImportRun) Labels(ctx context.Context, teamID *uuid.UUID) ([]model.Label, error) {
	q := r.s.db.Queries()
	var out []model.Label
	if teamID == nil {
		rows, err := q.ListLabelsInWorkspace(ctx, r.WorkspaceID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		for _, row := range rows {
			if row.TeamID == nil {
				out = append(out, toLabel(row))
			}
		}
		return out, nil
	}
	rows, err := q.ListLabelsForTeam(ctx, store.ListLabelsForTeamParams{WorkspaceID: r.WorkspaceID, TeamID: teamID})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, row := range rows {
		out = append(out, toLabel(row))
	}
	return out, nil
}

// ProjectByName finds a live project with this name, ignoring case.
func (r *ImportRun) ProjectByName(ctx context.Context, name string) (uuid.UUID, bool, error) {
	id, err := r.s.db.Queries().FindProjectByName(ctx, store.FindProjectByNameParams{
		WorkspaceID: r.WorkspaceID, Name: name,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return uuid.Nil, false, nil
		}
		return uuid.Nil, false, platform.Internal(err)
	}
	return id, true, nil
}
