package domain

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Labels, and the application of a label to an issue.
//
// Two things about this file are worth reading before changing it.
//
// A label exists at one of two scopes, and the scope decides everything: who may manage
// it, which change scope it travels under, and which other labels its position is
// comparable with. A workspace label (team_id NULL) reaches every picker in the product,
// which is why it is an admin action; a team label is ordinary team content. They are two
// authz actions rather than one action taking an optional team, so that forgetting the
// team id cannot fail open — see the comment on ActionWorkspaceLabelManage.
//
// Applying a label is its own entity, issue_label, and never "the issue's labels". A set
// written as a whole loses writes: two people adding different labels a second apart both
// send the full new set and the second overwrites the first. As one row per application an
// add is an upsert of one row and a remove is a delete of one, so both survive with no
// merge logic anywhere — M1 acceptance test 1, satisfied by the shape of the data.
//
// The database owns the three rules that need to read another row: one label per group per
// issue, a team's label only on that team's issues, and a group is not itself applicable.
// This file does not re-check them. It translates their failures, because the trigger's own
// message names row ids and a raw 23505 reaches the caller as a 500 for something they
// could have fixed in one click.

type CreateLabelInput struct {
	// TeamID nil makes it a workspace label, offered to every team.
	TeamID *uuid.UUID
	// ParentID is the group to put it in. A group and its labels share one scope.
	ParentID *uuid.UUID
	// IsGroup makes it a container. Declared rather than derived from "has children": a
	// group you have just created has none yet, and under the derived definition it would
	// stay applicable until somebody added one.
	IsGroup     bool
	Name        string
	Description *string
	Color       *string
	// AfterLabelID places the new label directly below an existing one in the same scope.
	// Nil appends to the end.
	AfterLabelID *uuid.UUID
}

func (s *Service) CreateLabel(ctx context.Context, p *authz.Principal, in CreateLabelInput) (model.Label, int64, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.Label{}, 0, platform.Validation("name", "a label needs a name")
	}
	if err := validateLabelText(in.Name, in.Description); err != nil {
		return model.Label{}, 0, err
	}
	if err := validateHexColor("color", in.Color); err != nil {
		return model.Label{}, 0, err
	}
	in.Color = normaliseColor(in.Color)

	var out model.Label
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		scope, err := s.requireLabelScope(ctx, q, p, in.TeamID)
		if err != nil {
			return err
		}

		parent, err := s.resolveLabelGroup(ctx, q, p, in.ParentID)
		if err != nil {
			return err
		}

		pos, err := labelPosition(ctx, q, p.WorkspaceID, in.TeamID, in.AfterLabelID)
		if err != nil {
			return err
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateLabel(ctx, store.CreateLabelParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      in.TeamID,
			ParentID:    in.ParentID,
			IsGroup:     in.IsGroup,
			Name:        in.Name,
			Description: in.Description,
			Color:       in.Color,
			Position:    pos,
		})
		if err != nil {
			return labelWrite{name: in.Name, teamID: in.TeamID, isGroup: in.IsGroup, parent: parent}.explain(err)
		}

		out = toLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "label", EntityID: out.ID, Op: OpUpsert,
			TeamID: in.TeamID, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

type UpdateLabelInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Color       *string

	// ParentID is three-state, the same shape as the assignee on an issue and for the same
	// reason: a nil pointer has to mean "leave the group alone", so lifting a label out of
	// its group needs its own flag rather than a nil that cannot be told apart.
	ParentID    *uuid.UUID
	ClearParent bool

	AfterLabelID *uuid.UUID
}

// UpdateLabel edits a label in place. Its scope never changes — UpdateLabelInput carries no
// team id — because moving a team label to the workspace would hand every team a label they
// never agreed to, and moving one the other way would silently unapply it from the issues of
// every other team.
func (s *Service) UpdateLabel(ctx context.Context, p *authz.Principal, in UpdateLabelInput) (model.Label, int64, error) {
	if in.ParentID != nil && in.ClearParent {
		return model.Label{}, 0, platform.Validation("parentId", "cannot set and clear the group in one call")
	}
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.Label{}, 0, platform.Validation("name", "a label needs a name")
		}
		in.Name = &trimmed
	}
	name := ""
	if in.Name != nil {
		name = *in.Name
	}
	if err := validateLabelText(name, in.Description); err != nil {
		return model.Label{}, 0, err
	}
	if err := validateHexColor("color", in.Color); err != nil {
		return model.Label{}, 0, err
	}
	in.Color = normaliseColor(in.Color)

	var out model.Label
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.loadLabel(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		scope, err := s.requireLabelScope(ctx, q, p, existing.TeamID)
		if err != nil {
			return err
		}

		parent, err := s.resolveLabelGroup(ctx, q, p, in.ParentID)
		if err != nil {
			return err
		}

		var newPos *string
		if in.AfterLabelID != nil {
			pos, err := labelPosition(ctx, q, p.WorkspaceID, existing.TeamID, in.AfterLabelID)
			if err != nil {
				return err
			}
			newPos = &pos
		}

		name := existing.Name
		if in.Name != nil {
			name = *in.Name
		}

		row, err := q.UpdateLabel(ctx, store.UpdateLabelParams{
			ID:          in.ID,
			Name:        in.Name,
			Description: in.Description,
			Color:       in.Color,
			Position:    newPos,
			ParentID:    in.ParentID,
			ClearParent: in.ClearParent,
			// The group flag is not editable through the API: promoting a label that is
			// already applied to issues would make every one of those applications invalid
			// the moment it happened, and demoting a group is the same state reached from
			// the other side. Create the label you want and archive the one you do not.
			IsGroup: nil,
		})
		if err != nil {
			return labelWrite{name: name, teamID: existing.TeamID, isGroup: existing.IsGroup, parent: parent}.explain(err)
		}

		out = toLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "label", EntityID: out.ID, Op: OpUpsert,
			TeamID: out.TeamID, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// ArchiveLabel retires a label, or brings one back.
//
// An archived label is gone from every picker, every list and every client, which is why
// archiving emits a delete and un-archiving emits an upsert carrying the whole row: the
// clients threw their copy away and the payload is the only thing that can give it back.
//
// Archiving refuses while the label is still applied, exactly as ArchiveWorkflowState
// refuses while issues still sit in a status, and for the same reason. The two alternatives
// are worse: deleting the applications throws away something a person chose issue by issue,
// and keeping them leaves every client holding issue_label rows whose label it has just been
// told to forget — a chip with no name on it. CountIssuesWithLabel exists so the
// confirmation dialog can say how much work removing it first would be.
func (s *Service) ArchiveLabel(ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool) (int64, error) {
	if !archived {
		return s.unarchiveLabel(ctx, p, id)
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.loadLabel(ctx, q, p, id)
		if err != nil {
			return err
		}
		scope, err := s.requireLabelScope(ctx, q, p, existing.TeamID)
		if err != nil {
			return err
		}

		if existing.IsGroup {
			// Same rule the database applies to demoting a group, for the same reason:
			// otherwise its labels are left pointing at a group nobody can see, and the
			// picker renders them under a heading that no longer exists.
			children, err := q.ListLabelsInGroup(ctx, &id)
			if err != nil {
				return platform.Internal(err)
			}
			if len(children) > 0 {
				return platform.Conflict(fmt.Sprintf(
					"this group still holds %d labels; move them out before archiving it", len(children)))
			}
		}

		applied, err := q.CountIssuesWithLabel(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		if applied > 0 {
			return platform.Conflict(fmt.Sprintf(
				"%d issues still carry this label; remove it from them first", applied))
		}

		if _, err := q.ArchiveLabel(ctx, id); err != nil {
			if store.IsNotFound(err) {
				// Archived between the read above and here. The caller's intent already
				// holds, but saying so would report a version this call did not mint.
				return platform.NotFound("label")
			}
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "label", EntityID: id, Op: OpDelete,
			TeamID: existing.TeamID, Scope: scope,
		})
		return err
	})
	return version, err
}

// MergeLabels folds source into survivor. Applications move; the source is archived.
//
// Same scope and same group (or both ungrouped). A group cannot be merged — its children
// would be left pointing at a heading that no longer exists, which is the same state
// ArchiveLabel refuses. Issues that already carry the survivor drop the source chip
// rather than holding both, which the unique (issue, label) index would reject anyway.
func (s *Service) MergeLabels(
	ctx context.Context, p *authz.Principal, sourceID, intoID uuid.UUID,
) (model.Label, int64, error) {
	if sourceID == intoID {
		return model.Label{}, 0, platform.Validation("intoId", "a label cannot merge into itself")
	}

	var out model.Label
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		source, err := s.loadLabel(ctx, q, p, sourceID)
		if err != nil {
			return err
		}
		into, err := s.loadLabel(ctx, q, p, intoID)
		if err != nil {
			return err
		}
		if source.IsGroup || into.IsGroup {
			return platform.Validation("intoId", "a group cannot be merged; merge its labels instead")
		}
		if !sameOptUUID(source.TeamID, into.TeamID) {
			return platform.Validation("intoId", "labels can only merge inside the same scope")
		}
		if !sameOptUUID(source.ParentID, into.ParentID) {
			return platform.Validation("intoId", "labels can only merge inside the same group")
		}

		scope, err := s.requireLabelScope(ctx, q, p, source.TeamID)
		if err != nil {
			return err
		}

		moved, err := q.RetargetIssueLabels(ctx, store.RetargetIssueLabelsParams{
			SourceID: sourceID,
			IntoID:   intoID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		dropped, err := q.DeleteIssueLabelsForLabel(ctx, sourceID)
		if err != nil {
			return platform.Internal(err)
		}

		for _, row := range moved {
			team, err := q.GetTeam(ctx, row.TeamID)
			if err != nil {
				return platform.Internal(err)
			}
			if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "issueLabel", EntityID: row.ID, Op: OpUpsert,
				TeamID: &row.TeamID, Scope: authz.TeamScope(team.ID, team.Private),
				Payload: toIssueLabel(row),
			}); err != nil {
				return err
			}
		}
		for _, row := range dropped {
			team, err := q.GetTeam(ctx, row.TeamID)
			if err != nil {
				return platform.Internal(err)
			}
			if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "issueLabel", EntityID: row.ID, Op: OpDelete,
				TeamID: &row.TeamID, Scope: authz.TeamScope(team.ID, team.Private),
			}); err != nil {
				return err
			}
		}

		if _, err := q.ArchiveLabel(ctx, sourceID); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("label")
			}
			return platform.Internal(err)
		}
		if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "label", EntityID: sourceID, Op: OpDelete,
			TeamID: source.TeamID, Scope: scope,
		}); err != nil {
			return err
		}

		out = toLabel(into)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "label", EntityID: into.ID, Op: OpUpsert,
			TeamID: into.TeamID, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func sameOptUUID(a, b *uuid.UUID) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// unarchiveLabel is the way back, and the one rule it adds is about the group.
//
// A label lives inside a group or at the root, and archiving a group is refused while it
// still holds labels — so a group can only be archived once it is empty, and the labels that
// were in it were archived first. Un-archiving one of those without the group would put it
// back in the picker under a heading that has been archived: a chip filed under a group
// nothing can resolve, which is exactly the state the archive rule exists to prevent,
// reached from the other side. So it is refused, with the order to do it in.
//
// The refusal is deliberate rather than a cascade. Un-archiving the group as a side effect
// would restore a heading somebody retired without asking them, and un-archiving the label
// to the root would quietly change which group it belongs to — a taxonomy edit disguised as
// an undo.
func (s *Service) unarchiveLabel(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetArchivedLabel(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				// No such label, another workspace's, or one that is not archived at all.
				// One answer for all three, the same way loadLabel gives one answer for a
				// missing label and an archived one.
				return platform.NotFound("label")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("label")
		}
		scope, err := s.requireLabelScope(ctx, q, p, existing.TeamID)
		if err != nil {
			return err
		}

		if existing.ParentID != nil {
			// GetLabel rather than loadLabel, because an archived group is exactly what this
			// is looking for and loadLabel is the reader that treats one as gone. A missing
			// row is an internal error rather than a not-found: parent_id is ON DELETE SET
			// NULL, so a label still pointing at a group is a label whose group exists.
			parent, err := q.GetLabel(ctx, *existing.ParentID)
			if err != nil {
				return platform.Internal(err)
			}
			if parent.ArchivedAt != nil {
				return platform.Conflict(fmt.Sprintf(
					"the group %q is archived; restore it before restoring the labels inside it", parent.Name))
			}
		}

		row, err := q.UnarchiveLabel(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				// Restored between the read above and here.
				return platform.NotFound("label")
			}
			if store.IsUniqueViolation(err, "label_scope_name_key") {
				// The unique index is partial on archived_at, so archiving released the
				// name and somebody has taken it since. Naming it is the difference between
				// an error the user can act on and one that reads as a broken button.
				where := "this workspace"
				if existing.TeamID != nil {
					where = "this team"
				}
				return platform.Validation("id", fmt.Sprintf(
					"a label called %q already exists in %s; rename it before restoring this one",
					existing.Name, where))
			}
			return platform.Internal(err)
		}

		out := toLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "label", EntityID: id, Op: OpUpsert,
			TeamID: out.TeamID, Scope: scope, Payload: out,
		})
		return err
	})
	return version, err
}

// AddIssueLabel applies one label to one issue, as one row.
//
// Permission comes from the issue, not the label: applying a label is editing an issue, and
// a member who may not create labels may certainly use the ones their team has. The label
// itself is only read for the checks the database cannot make and for the error messages it
// cannot phrase.
func (s *Service) AddIssueLabel(
	ctx context.Context, p *authz.Principal, issueID, labelID uuid.UUID,
) (model.IssueLabel, int64, error) {
	var out model.IssueLabel
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// GetIssue, not GetIssueForUpdate. Nothing here is a read-modify-write, and a row
		// lock on the issue would make two people labelling it at the same moment queue
		// behind each other for no reason — the case this whole design exists to serve.
		issue, err := q.GetIssue(ctx, issueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}

		out, version, err = s.applyIssueLabel(ctx, q, p, issue.ID, issue.TeamID, team.Private, labelID)
		if err != nil {
			return err
		}
		return s.applyMatchingSLA(ctx, q, p, issue.ID)
	})
	if err != nil {
		var conflict errLabelGroupConflict
		if errors.As(err, &conflict) {
			return model.IssueLabel{}, 0, s.explainGroupConflict(ctx, conflict)
		}
		return model.IssueLabel{}, 0, err
	}
	return out, version, nil
}

// applyIssueLabel is the write half of AddIssueLabel, inside a transaction its caller owns
// and after that caller has established the issue and its team.
//
// It is separate so that creating an issue with labels can apply them in the same
// transaction that inserts the issue. Doing it as a second call afterwards would mean a
// window in which the issue exists without the labels it was created with — visible to
// anybody watching the change stream, and permanent if the second call fails.
//
// It returns errLabelGroupConflict unwrapped, exactly as the statement raised it: the
// conflict cannot be explained until the transaction has rolled back, so naming the label
// already in the way is the caller's job, after InTx returns. Both callers do it.
func (s *Service) applyIssueLabel(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	issueID, issueTeamID uuid.UUID, teamPrivate bool, labelID uuid.UUID,
) (model.IssueLabel, int64, error) {
	lbl, err := s.loadLabel(ctx, q, p, labelID)
	if err != nil {
		// The label is an input to this call, not the thing being addressed, so it
		// reads as a bad field rather than a missing resource.
		if platform.CodeOf(err) == platform.CodeNotFound {
			return model.IssueLabel{}, 0, platform.Validation("labelId", "no such label")
		}
		return model.IssueLabel{}, 0, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return model.IssueLabel{}, 0, platform.Internal(err)
	}
	row, err := q.AddIssueLabel(ctx, store.AddIssueLabelParams{
		ID:          id,
		WorkspaceID: p.WorkspaceID,
		IssueID:     issueID,
		LabelID:     labelID,
		CreatedBy:   &p.UserID,
	})
	if err != nil {
		return model.IssueLabel{}, 0, explainApplyFailure(err, issueID, issueTeamID, lbl)
	}
	out := toIssueLabel(row)

	// Scoped to the issue's team, never the label's: a workspace label applied to a
	// private team's issue must not be visible to people outside that team, and the
	// scope on the change row is the only thing the hub consults.
	//
	// Deliberately no issue_history entry. History folds consecutive same-kind edits by
	// one actor into a single row by moving its to-value forward, which is right for a
	// scalar field and wrong for a set: adding two labels a minute apart would leave a
	// feed claiming only the second happened. The application is already its own entity
	// on the change stream; the feed gains a label kind when it gains a rendering that
	// can express one added and one removed.
	version, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
		EntityType: "issueLabel", EntityID: out.ID, Op: OpUpsert,
		TeamID: &issueTeamID, Scope: authz.TeamScope(issueTeamID, teamPrivate),
		Payload: out,
	})
	if err != nil {
		return model.IssueLabel{}, 0, err
	}
	return out, version, nil
}

// RemoveIssueLabel unapplies a label and returns the id of the row that disappeared.
//
// That id is the entity's name on the change stream and the caller only knows the issue and
// the label, which is why the delete returns the row rather than a count: reading it back
// afterwards is not possible, and reading it first would be a second round trip that a
// concurrent removal could invalidate anyway.
func (s *Service) RemoveIssueLabel(
	ctx context.Context, p *authz.Principal, issueID, labelID uuid.UUID,
) (uuid.UUID, int64, error) {
	var removed uuid.UUID
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		issue, err := q.GetIssue(ctx, issueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}

		row, err := q.RemoveIssueLabel(ctx, store.RemoveIssueLabelParams{
			IssueID: issueID, LabelID: labelID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Validation("labelId", "that label is not on this issue")
			}
			return platform.Internal(err)
		}
		removed = row.ID

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueLabel", EntityID: row.ID, Op: OpDelete,
			TeamID: &issue.TeamID, Scope: authz.TeamScope(issue.TeamID, team.Private),
		})
		if err != nil {
			return err
		}
		return s.applyMatchingSLA(ctx, q, p, issue.ID)
	})
	return removed, version, err
}

// ListLabels returns every label the caller can see: the workspace's own, plus those of the
// teams they belong to.
func (s *Service) ListLabels(ctx context.Context, p *authz.Principal) ([]model.Label, error) {
	rows, err := s.db.Queries().ListLabelsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Label, 0, len(rows))
	for _, r := range rows {
		if !authz.Visible(p, labelScope(r.TeamID)) {
			continue
		}
		out = append(out, toLabel(r))
	}
	return out, nil
}

func (s *Service) GetLabel(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Label, error) {
	row, err := s.loadLabel(ctx, s.db.Queries(), p, id)
	if err != nil {
		return model.Label{}, err
	}
	if !authz.Visible(p, labelScope(row.TeamID)) {
		// Not-found rather than forbidden: which labels a team has is itself information
		// about that team.
		return model.Label{}, platform.NotFound("label")
	}
	return toLabel(row), nil
}

// ListIssueLabels returns the applications on one issue. Visibility is the issue's, because
// an application says as much about the issue as the issue does.
func (s *Service) ListIssueLabels(ctx context.Context, p *authz.Principal, issueID uuid.UUID) ([]model.IssueLabel, error) {
	q := s.db.Queries()
	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("issue")
		}
		return nil, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
		return nil, platform.NotFound("issue")
	}

	rows, err := q.ListIssueLabels(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.IssueLabel, 0, len(rows))
	for _, r := range rows {
		out = append(out, toIssueLabel(r))
	}
	return out, nil
}

// requireLabelScope authorises managing a label at its own scope and returns the scope its
// change must travel under.
//
// The two branches are two different actions on purpose. A workspace label lands in every
// team's picker, so it is an admin action; a team label is ordinary team content, so
// membership is the test. One action taking an optional team would put the whole decision in
// the caller's argument list, where omitting it fails open.
func (s *Service) requireLabelScope(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID *uuid.UUID,
) (authz.Scope, error) {
	if teamID == nil {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return authz.Scope{}, platform.Forbidden("only an admin can manage workspace-wide labels")
		}
		return authz.WorkspaceScope(), nil
	}
	team, err := s.requireTeamAccess(ctx, q, p, *teamID, authz.ActionTeamLabelManage)
	if err != nil {
		return authz.Scope{}, err
	}
	return authz.TeamScope(team.ID, team.Private), nil
}

// loadLabel reads a label and refuses one belonging to another workspace.
//
// That check is not redundant with the database's. The label triggers compare team ids, and
// two workspace-scoped labels in different workspaces both have a NULL team — so a parent or
// a label id from another tenant passes every rule migration 000012 states. This is the only
// place that can refuse it.
//
// An archived label is treated as gone rather than as a row in a special state. There is no
// unarchive, archiving is refused while anything still points at the label, and it reaches
// clients as a delete; a reader that could still fetch it would be the one surface where it
// exists.
func (s *Service) loadLabel(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetLabelRow, error) {
	row, err := q.GetLabel(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetLabelRow{}, platform.NotFound("label")
		}
		return store.GetLabelRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetLabelRow{}, platform.NotFound("label")
	}
	return row, nil
}

// resolveLabelGroup loads the group a label is being put into, so that a failed write can be
// explained in terms of it. It deliberately does not check that the parent is a group or
// that the scopes match — label_parent_integrity does both, and duplicating a rule is how the
// two copies start to disagree.
func (s *Service) resolveLabelGroup(
	ctx context.Context, q *store.Queries, p *authz.Principal, parentID *uuid.UUID,
) (*store.GetLabelRow, error) {
	if parentID == nil {
		return nil, nil
	}
	row, err := s.loadLabel(ctx, q, p, *parentID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return nil, platform.Validation("parentId", "no such group")
		}
		return nil, err
	}
	return &row, nil
}

// labelPosition mints a fractional key inside one scope.
//
// Both neighbour lookups take the team the new label will have, because positions are only
// ever compared within a scope — the picker draws the workspace's labels and then each
// team's. A key minted between two labels of another scope would sort this one somewhere
// nobody chose.
func labelPosition(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, teamID, after *uuid.UUID,
) (string, error) {
	if after == nil {
		last, err := q.GetLastLabelPosition(ctx, store.GetLastLabelPositionParams{
			WorkspaceID: workspaceID, TeamID: teamID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}

	anchor, err := q.GetLabel(ctx, *after)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("afterLabelId", "no such label")
		}
		return "", platform.Internal(err)
	}
	if anchor.WorkspaceID != workspaceID || !sameLabelScope(anchor.TeamID, teamID) {
		return "", platform.Validation("afterLabelId", "that label is in a different scope")
	}

	next, err := q.GetLabelPositionAfter(ctx, store.GetLabelPositionAfterParams{
		WorkspaceID: workspaceID, TeamID: teamID, Position: anchor.Position,
	})
	if err != nil && !store.IsNotFound(err) {
		return "", platform.Internal(err)
	}
	upper := ""
	if err == nil {
		upper = next
	}

	pos, err := fractional.Between(anchor.Position, upper)
	if err != nil {
		return "", platform.Internal(fmt.Errorf("label position between %q and %q: %w", anchor.Position, upper, err))
	}
	return pos, nil
}

// sameLabelScope compares two scopes, where nil means the whole workspace. Written out
// rather than compared through scope_key so that the sentinel uuid stays a database detail.
func sameLabelScope(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func labelScope(teamID *uuid.UUID) authz.Scope {
	if teamID == nil {
		return authz.WorkspaceScope()
	}
	// Private is false because a read judges membership and nothing else — the flag exists
	// so that a change written before a privacy flip is judged by the state at the time it
	// was written, which a live read has no equivalent of.
	return authz.TeamScope(*teamID, false)
}

// hexColor is the only colour a label may carry: a six-digit hex triple with a leading #.
var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// maxLabelNameLength and maxLabelDescriptionLength bound the two free-text fields. A label
// is a chip in a list, so these are generous for a real one and far short of anything that
// would make a board unreadable or a bootstrap snapshot larger than it should be.
const (
	maxLabelNameLength        = 128
	maxLabelDescriptionLength = 1024
)

// normaliseColor turns a blank colour into no colour at all, so the insert's COALESCE
// supplies the product default. An empty string is NOT NULL-clean and renders as a
// transparent chip, which looks like a bug in the picker rather than a missing input.
func normaliseColor(c *string) *string {
	if c == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*c)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// validateHexColor refuses anything that is not a colour.
//
// The columns are plain text with no CHECK, so any string at all used to be stored and
// then shipped to every client, which renders an invalid CSS value as a chip that silently
// disappears — no error on any layer, and nothing for the person who typed it to see.
//
// Validated in Go rather than only in SQL on purpose: labelWrite.explain turns constraint
// violations into sentences, and a CHECK added later without a matching branch there would
// fall through its final platform.Internal and become a 500 instead of a message.
func validateHexColor(field string, c *string) error {
	if c == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*c)
	if trimmed == "" {
		return nil
	}
	if !hexColor.MatchString(trimmed) {
		return platform.Validation(field, "a colour is a hex triple such as #4f46e5")
	}
	return nil
}

// validateLabelText bounds a label's name and description.
func validateLabelText(name string, description *string) error {
	if len(name) > maxLabelNameLength {
		return platform.Validation("name",
			fmt.Sprintf("a label name is at most %d characters", maxLabelNameLength))
	}
	if description != nil && len(*description) > maxLabelDescriptionLength {
		return platform.Validation("description",
			fmt.Sprintf("a label description is at most %d characters", maxLabelDescriptionLength))
	}
	return nil
}

// labelWrite is what it takes to turn a rejected label write into a sentence about the input
// the caller sent. Every rule named below is enforced by migration 000012; this only reads
// the failure.
type labelWrite struct {
	name    string
	teamID  *uuid.UUID
	isGroup bool
	parent  *store.GetLabelRow
}

func (w labelWrite) explain(err error) error {
	switch {
	case store.IsUniqueViolation(err, "label_scope_name_key"):
		where := "this workspace"
		if w.teamID != nil {
			where = "this team"
		}
		// The index is case-insensitive, so "Bug" collides with "bug". Saying which name
		// collided is what stops that reading as an unexplained refusal.
		return platform.Validation("name", fmt.Sprintf("a label called %q already exists in %s", w.name, where))

	case store.IsUniqueViolation(err, "issue_label_one_per_group"):
		// Not this row: label_group_propagate rewrote issue_label.group_id for every
		// application of this label, and at least one issue already carries another label
		// from the group it is moving into. Failing is the point — dropping one of the two
		// would lose something a person applied by hand, and only they can say which.
		group := "that group"
		if w.parent != nil {
			group = fmt.Sprintf("%q", w.parent.Name)
		}
		return platform.Validation("parentId", fmt.Sprintf(
			"moving %q into %s would leave an issue carrying two labels from that group; remove one of them first",
			w.name, group))

	case store.IsCheckViolation(err) && w.isGroup && w.parent != nil:
		return platform.Validation("parentId",
			"nesting is one level: a group cannot sit inside another group")
	}

	// What is left comes from label_parent_integrity, which raises rather than violating a
	// named constraint. It is told apart by the parent already in hand, because the trigger's
	// own message is a sentence about row ids and the transaction is aborted by the time it
	// arrives, so nothing more can be read to phrase a better one.
	if w.parent != nil {
		if !w.parent.IsGroup {
			return platform.Validation("parentId", fmt.Sprintf("%q is not a group", w.parent.Name))
		}
		if !sameLabelScope(w.parent.TeamID, w.teamID) {
			return platform.Validation("parentId", fmt.Sprintf(
				"%q is in a different scope; a group and its labels must both belong to the workspace or both to one team",
				w.parent.Name))
		}
	}
	return platform.Internal(err)
}

// explainApplyFailure reads a rejected application the same way, from the label in hand.
func explainApplyFailure(err error, issueID, issueTeamID uuid.UUID, lbl store.GetLabelRow) error {
	if store.IsUniqueViolation(err, "issue_label_one_per_group") {
		if lbl.ParentID == nil {
			// The index only covers rows with a group, so a label without one cannot have
			// violated it. Something is wrong with the denormalisation, not with the input.
			return platform.Internal(err)
		}
		return errLabelGroupConflict{issueID: issueID, groupID: *lbl.ParentID}
	}
	if lbl.IsGroup {
		return platform.Validation("labelId", fmt.Sprintf(
			"%q is a group — apply one of the labels inside it", lbl.Name))
	}
	if lbl.TeamID != nil && *lbl.TeamID != issueTeamID {
		return platform.Validation("labelId", fmt.Sprintf(
			"%q belongs to another team and cannot be applied to this issue", lbl.Name))
	}
	return platform.Internal(err)
}

// errLabelGroupConflict carries a one-per-group rejection out of the transaction.
//
// The explanation cannot be gathered inside it: the violation aborts the transaction, and
// every further statement on that connection fails until it rolls back. Naming the label
// already on the issue — the only part of the message the user can act on — therefore has to
// wait until the transaction is over.
type errLabelGroupConflict struct {
	issueID uuid.UUID
	groupID uuid.UUID
}

func (e errLabelGroupConflict) Error() string {
	return fmt.Sprintf("issue %s already carries a label from group %s", e.issueID, e.groupID)
}

// explainGroupConflict names the label that is in the way, after the transaction that failed
// has rolled back.
//
// Every lookup here is best-effort. A message with the names is much better than one
// without, but a failed read on the way to phrasing an error must not turn a fixable
// validation error into a 500.
func (s *Service) explainGroupConflict(ctx context.Context, c errLabelGroupConflict) error {
	q := s.db.Queries()

	held := "another label"
	if rows, err := q.ListIssueLabels(ctx, c.issueID); err == nil {
		for _, r := range rows {
			if r.GroupID == nil || *r.GroupID != c.groupID {
				continue
			}
			if l, err := q.GetLabel(ctx, r.LabelID); err == nil {
				held = fmt.Sprintf("%q", l.Name)
			}
			break
		}
	}
	group := "that group"
	if g, err := q.GetLabel(ctx, c.groupID); err == nil {
		group = fmt.Sprintf("%q", g.Name)
	}

	return platform.Validation("labelId", fmt.Sprintf(
		"this issue already carries %s from %s, and an issue may carry only one label from a group; remove it first",
		held, group))
}

// sqlc mints a distinct row type per query even when the column lists are identical, so the
// label queries return several structurally identical structs. Converting through one of them
// is legal precisely because they are identical — and stops compiling the moment one query's
// columns drift from the rest, which is the warning worth having rather than a second
// serialisation that quietly disagrees with this one.
type labelRow interface {
	store.CreateLabelRow | store.GetLabelRow | store.UpdateLabelRow | store.ArchiveLabelRow |
		store.UnarchiveLabelRow | store.GetArchivedLabelRow |
		store.ListLabelsInWorkspaceRow | store.ListLabelsForTeamRow | store.ListLabelsInGroupRow
}

func toLabel[R labelRow](r R) model.Label {
	l := store.GetLabelRow(r)
	return model.Label{
		ID:          l.ID,
		WorkspaceID: l.WorkspaceID,
		TeamID:      l.TeamID,
		ParentID:    l.ParentID,
		IsGroup:     l.IsGroup,
		Name:        l.Name,
		Description: l.Description,
		Color:       l.Color,
		Position:    l.Position,
		CreatedAt:   l.CreatedAt,
		UpdatedAt:   l.UpdatedAt,
		ArchivedAt:  l.ArchivedAt,
	}
}

func toIssueLabel(il store.IssueLabel) model.IssueLabel {
	return model.IssueLabel{
		ID:          il.ID,
		WorkspaceID: il.WorkspaceID,
		IssueID:     il.IssueID,
		LabelID:     il.LabelID,
		TeamID:      il.TeamID,
		GroupID:     il.GroupID,
		CreatedBy:   il.CreatedBy,
		CreatedAt:   il.CreatedAt,
	}
}
