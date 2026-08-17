package domain

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/filter"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	maxViewNameLength = 256

	// A view key names one of the built-in views — "my-issues", "team:<uuid>". Its
	// vocabulary belongs to the client and is deliberately not policed here (see
	// SetViewPreference), so the only thing this side can sensibly say about one is how
	// long it may be: the row is unique on it, and without a ceiling a single client bug
	// fills somebody's preference table with keys nothing will ever read again.
	maxViewKeyLength = 128

	// maxViewJSONBytes bounds the opaque blobs a view and a template carry — the filter,
	// the display bag, the template's properties.
	//
	// Every one of them is stored whole, replayed in the bootstrap snapshot and pushed to
	// every replica that can see the row, so an unbounded blob is one client's memory bug
	// turned into everybody else's sync payload. 64 KiB is roughly two thousand clauses:
	// far past any filter a person built, far short of anything that hurts.
	maxViewJSONBytes = 64 << 10
)

type CreateViewInput struct {
	// TeamID anchors the view to one team's sidebar. Nil means it spans the workspace.
	TeamID *uuid.UUID
	// Private keeps the view to its creator. It is a separate flag rather than an owner id
	// in the input because a caller may only ever make a view private to *themselves* —
	// accepting an owner id would invite one that is not the caller's.
	Private bool

	Name        string
	Description *string
	Icon        *string
	Color       *string

	Filter  json.RawMessage
	Display json.RawMessage
}

// CreateView saves a filter, having first proved the filter can be read.
//
// Where the view lives decides three things at once — who may create it, whose sidebar it
// lands in, and which scope its changes travel under — and all three come out of the same
// switch below so they cannot drift apart.
func (s *Service) CreateView(ctx context.Context, p *authz.Principal, in CreateViewInput) (model.View, int64, error) {
	name, err := viewName(in.Name)
	if err != nil {
		return model.View{}, 0, err
	}
	filterJSON, err := validateViewFilter(in.Filter)
	if err != nil {
		return model.View{}, 0, err
	}
	displayJSON, err := jsonObject("display", in.Display)
	if err != nil {
		return model.View{}, 0, err
	}

	var out model.View
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var ownerID *uuid.UUID
		var scope authz.Scope

		switch {
		case in.Private:
			// Yours. Ownership is the whole test, which is why no Action exists for it.
			ownerID = &p.UserID
			scope = authz.UserScope(p.UserID)

			// A private view may still be anchored to a team, and that anchor has to be a
			// team the caller can reach — for a content action CanInTeam reduces to
			// membership, which is exactly the test wanted here. Without it, a private view
			// is a way to pin a sidebar entry to a team you cannot see, and the entry lists
			// nothing for the rest of its life.
			if in.TeamID != nil {
				if _, err := s.requireTeamAccess(ctx, q, p, *in.TeamID, authz.ActionTeamViewManage); err != nil {
					return err
				}
			}

		case in.TeamID != nil:
			team, err := s.requireTeamAccess(ctx, q, p, *in.TeamID, authz.ActionTeamViewManage)
			if err != nil {
				return err
			}
			scope = authz.TeamScope(team.ID, team.Private)

		default:
			// A workspace-wide view appears in everybody's sidebar. That reach is what makes
			// it an admin action while a team's shared view is not.
			if !authz.Can(p, authz.ActionWorkspaceViewManage) {
				return platform.Forbidden("only admins can create views for the whole workspace")
			}
			scope = authz.WorkspaceScope()
		}

		// Only shared views are gated. A private view is one person's saved filter and
		// gating it would mean a workspace whose billing lapsed cannot organise its own
		// work, which is not what anybody bought or failed to buy.
		if !in.Private {
			if err := requireCustomViews(ctx, q, p.WorkspaceID); err != nil {
				return err
			}
		}

		pos, err := nextViewPosition(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateView(ctx, store.CreateViewParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      in.TeamID,
			OwnerID:     ownerID,
			Name:        name,
			Description: in.Description,
			Icon:        in.Icon,
			Color:       in.Color,
			Filter:      filterJSON,
			Display:     displayJSON,
			Position:    pos,
			CreatedBy:   &p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toView(store.GetViewRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "view", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// UpdateViewInput carries no team id and no private flag, and that absence is deliberate:
// moving a view between scopes is a visibility change, so it has to revoke the view from
// everybody who just lost it. Hiding that behind the same partial update that renames a
// view would mean a rename and a re-scope racing to decide who can see it.
type UpdateViewInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Icon        *string
	Color       *string

	// Filter and Display are nil when untouched. A JSON `null` is treated the same way
	// rather than written through: the column is NOT NULL, so storing a JSON null would
	// leave a view whose display bag every client dereferences into a crash.
	Filter  json.RawMessage
	Display json.RawMessage

	AfterViewID *uuid.UUID
}

func (s *Service) UpdateView(ctx context.Context, p *authz.Principal, in UpdateViewInput) (model.View, int64, error) {
	var name *string
	if in.Name != nil {
		n, err := viewName(*in.Name)
		if err != nil {
			return model.View{}, 0, err
		}
		name = &n
	}
	// The filter is revalidated on every edit, not only at creation. A view that was saved
	// with a filter the compiler accepted and then edited into one it does not is the same
	// broken saved view, arriving a week later.
	var filterJSON json.RawMessage
	if !isAbsentJSON(in.Filter) {
		f, err := validateViewFilter(in.Filter)
		if err != nil {
			return model.View{}, 0, err
		}
		filterJSON = f
	}
	var displayJSON json.RawMessage
	if !isAbsentJSON(in.Display) {
		d, err := jsonObject("display", in.Display)
		if err != nil {
			return model.View{}, 0, err
		}
		displayJSON = d
	}

	var out model.View
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// Deliberately not re-gated on entitlement, unlike creation. A shared view that
		// already exists stays editable whatever the plan says today: the alternative is a
		// saved view holding a filter somebody has to fix and cannot.
		_, scope, err := s.requireViewAccess(ctx, q, p, in.ID)
		if err != nil {
			return err
		}

		var position *string
		if in.AfterViewID != nil {
			pos, err := s.viewPositionAfter(ctx, q, p, *in.AfterViewID)
			if err != nil {
				return err
			}
			position = &pos
		}

		row, err := q.UpdateView(ctx, store.UpdateViewParams{
			ID:          in.ID,
			Name:        name,
			Description: in.Description,
			Icon:        in.Icon,
			Color:       in.Color,
			Filter:      filterJSON,
			Display:     displayJSON,
			Position:    position,
		})
		if err != nil {
			if store.IsNotFound(err) {
				// The row was archived between the read above and this write.
				return platform.NotFound("view")
			}
			return platform.Internal(err)
		}
		out = toView(store.GetViewRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "view", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// DeleteView archives the view and tells every replica in its scope to forget it.
//
// Archived rather than removed, for the reason views.sql gives: favourites and view
// preferences point at views by id with no foreign key, so a hard delete leaves sidebar
// entries nothing can resolve. The change is still an OpDelete — as far as a client is
// concerned the view is gone, and an archived view it kept caching would be a view it
// could still open.
func (s *Service) DeleteView(ctx context.Context, p *authz.Principal, id uuid.UUID) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, scope, err := s.requireViewAccess(ctx, q, p, id)
		if err != nil {
			return err
		}
		if _, err := q.ArchiveView(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("view")
			}
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "view", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, row.TeamID), Scope: scope,
		})
		return err
	})
	return id, version, err
}

// ListViews returns the views the caller can see: the workspace's shared ones, the shared
// ones of teams they are in, and their own private ones.
func (s *Service) ListViews(ctx context.Context, p *authz.Principal) ([]model.View, error) {
	rows, err := s.db.Queries().ListViewsForUser(ctx, store.ListViewsForUserParams{
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
		UserID:      &p.UserID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}

	out := make([]model.View, 0, len(rows))
	for _, r := range rows {
		// The query states the team and owner halves of the rule (see its comment), and
		// states them once so this listing and the bootstrap snapshot cannot disagree. The
		// half it does not know is the guest rule: a guest is scoped to their teams and
		// never receives workspace-wide entities, so a workspace view they were shown here
		// would be one the sync hub then never sends them an update for.
		if r.TeamID == nil && r.OwnerID == nil && !authz.Visible(p, authz.WorkspaceScope()) {
			continue
		}
		out = append(out, toView(store.GetViewRow(r)))
	}
	return out, nil
}

func (s *Service) GetView(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.View, error) {
	q := s.db.Queries()
	row, err := s.visibleView(ctx, q, p, id)
	if err != nil {
		return model.View{}, err
	}
	return toView(row), nil
}

// SetViewPreference records how somebody wants one of the built-in views displayed.
//
// The view key is not validated against a list of known views on purpose. The built-in
// views are a client vocabulary — "my-issues" today, whatever the next release adds
// tomorrow — and a server-side allowlist would mean the day a new one ships, every client
// that already has it silently fails to remember its grouping until the server is
// deployed too.
func (s *Service) SetViewPreference(
	ctx context.Context, p *authz.Principal, viewKey string, display json.RawMessage,
) (model.ViewPreference, int64, error) {
	viewKey = strings.TrimSpace(viewKey)
	if viewKey == "" {
		return model.ViewPreference{}, 0, platform.Validation("viewKey", "a view key is required")
	}
	if len(viewKey) > maxViewKeyLength {
		return model.ViewPreference{}, 0, platform.Validation("viewKey", "that view key is too long")
	}
	displayJSON, err := jsonObject("display", display)
	if err != nil {
		return model.ViewPreference{}, 0, err
	}

	var out model.ViewPreference
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		// The natural key is (user_id, view_key), so this id is used only if the row is new
		// and thrown away otherwise. Everything downstream must therefore use the id the
		// upsert returned: emitting the freshly minted one would address a change at a row
		// that does not exist, and the client would grow a second preference for the same
		// view every time somebody changed their grouping.
		row, err := q.UpsertViewPreference(ctx, store.UpsertViewPreferenceParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			ViewKey:     viewKey,
			Display:     displayJSON,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toViewPreference(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "viewPreference", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ListViewPreferences(ctx context.Context, p *authz.Principal) ([]model.ViewPreference, error) {
	rows, err := s.db.Queries().ListViewPreferences(ctx, store.ListViewPreferencesParams{
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ViewPreference, 0, len(rows))
	for _, r := range rows {
		out = append(out, toViewPreference(r))
	}
	return out, nil
}

// AddFavorite pins something to the caller's own sidebar, in their own order.
//
// afterID is the favourite to sit below; nil appends. Favouriting something already
// favourited moves it rather than failing, because the only way a person reaches this
// twice is by dragging an entry they had already added.
func (s *Service) AddFavorite(
	ctx context.Context, p *authz.Principal, kind string, targetID uuid.UUID, afterID *uuid.UUID,
) (model.Favorite, int64, error) {
	if !validFavoriteKind(kind) {
		return model.Favorite{}, 0, platform.Validation("kind",
			"a favourite points at a view, a team, an issue or a label")
	}

	var out model.Favorite
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		scope, exists, err := favoriteTargetScope(ctx, q, p.WorkspaceID, kind, targetID)
		if err != nil {
			return err
		}
		// This is the whole of the check, and the reason it exists is that target_id is
		// deliberately not a foreign key — it can point at four different tables. Without a
		// visibility test, favouriting is an oracle: a uuid that stores successfully is one
		// that exists, which is how somebody enumerates a private team's issues without
		// ever being able to read one. The row would also survive as a sidebar entry that
		// resolves to nothing for the rest of its life.
		if !exists || !authz.Visible(p, scope) {
			return platform.Validation("targetId", "no such "+kind)
		}

		pos, err := favoritePosition(ctx, q, p, afterID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.AddFavorite(ctx, store.AddFavoriteParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			Kind:        kind,
			TargetID:    targetID,
			Position:    pos,
		})
		if err != nil {
			return platform.Internal(err)
		}
		// Re-favouriting updates the existing row, so this id is the stored one and not
		// necessarily the one minted above.
		out = toFavorite(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "favorite", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

// RemoveFavorite unpins by target rather than by id, because that is what the caller has:
// the star sits next to the thing, not next to the favourite row.
func (s *Service) RemoveFavorite(
	ctx context.Context, p *authz.Principal, kind string, targetID uuid.UUID,
) (uuid.UUID, int64, error) {
	if !validFavoriteKind(kind) {
		return uuid.Nil, 0, platform.Validation("kind",
			"a favourite points at a view, a team, an issue or a label")
	}

	var removed uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// The delete is keyed on the caller's own user id, so there is no ownership check to
		// forget here: a favourite of somebody else's simply does not match.
		row, err := q.RemoveFavorite(ctx, store.RemoveFavoriteParams{
			UserID: p.UserID, Kind: kind, TargetID: targetID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("favorite")
			}
			return platform.Internal(err)
		}
		removed = row.ID

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "favorite", EntityID: row.ID, Op: OpDelete,
			Scope: authz.UserScope(p.UserID),
		})
		return err
	})
	return removed, version, err
}

// ListFavorites returns the caller's sidebar, dropping entries whose target they can no
// longer see.
//
// Dropped rather than deleted, which is the one place this departs from the migration's
// "cleaned up on read". Deleting here would make a read path write, emit sync changes and
// contend with every other reader — and access comes back: somebody re-added to a team
// finds their favourites intact, where a row deleted the moment they left is gone for good.
func (s *Service) ListFavorites(ctx context.Context, p *authz.Principal) ([]model.Favorite, error) {
	q := s.db.Queries()
	rows, err := q.ListFavorites(ctx, store.ListFavoritesParams{
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}

	out := make([]model.Favorite, 0, len(rows))
	for _, r := range rows {
		// A query per favourite, which is affordable precisely because this list is a
		// sidebar: it is bounded by what one person was willing to pin by hand.
		scope, exists, err := favoriteTargetScope(ctx, q, p.WorkspaceID, r.Kind, r.TargetID)
		if err != nil {
			return nil, err
		}
		if !exists || !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toFavorite(r))
	}
	return out, nil
}

// --- shared plumbing ---------------------------------------------------------------

// validateViewFilter is the single most important call in this file.
//
// A view's filter is untrusted JSON from a client, stored for years, and compiled to SQL
// on somebody else's request. Parsing it here — through the same entry point search and
// the client's own evaluator use — means a filter the compiler cannot read is refused
// while its author is still looking at the thing they wrote. Stored unchecked it becomes a
// saved view that fails every time anybody opens it, months later, put there by somebody
// who has since left.
func validateViewFilter(raw json.RawMessage) (json.RawMessage, error) {
	if isAbsentJSON(raw) {
		// The canonical empty filter: a group with no children, which is an AND over
		// nothing and therefore matches everything. It is also the column's default, so a
		// view saved without a filter opens rather than erroring.
		return json.RawMessage(`{}`), nil
	}
	if len(raw) > maxViewJSONBytes {
		return nil, platform.Validation("filter", "that filter is too large to save")
	}
	if _, err := filter.Parse(raw); err != nil {
		// The compiler's own message names the field, operator or value it could not read,
		// and it quotes only what the caller sent. Replacing it with something generic
		// would leave the author guessing which of a dozen clauses is the wrong one.
		return nil, platform.Validation("filter", err.Error())
	}
	// Stored as sent. The migration is explicit that these are the same bytes the client
	// evaluates against its replica; re-serialising them here would make the server's copy
	// and the client's copy two representations of one filter.
	return raw, nil
}

// jsonObject checks an opaque bag is an object, defaulting an absent one to {}.
//
// An object rather than "any valid JSON", because both bags are named options on both
// sides of the wire: a client handed an array where it expects an object does not render
// one wrong option, it throws while painting the screen.
func jsonObject(field string, raw json.RawMessage) (json.RawMessage, error) {
	if isAbsentJSON(raw) {
		return json.RawMessage(`{}`), nil
	}
	if len(raw) > maxViewJSONBytes {
		return nil, platform.Validation(field, "that is too large to save")
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, platform.Validation(field, "must be a JSON object")
	}
	return raw, nil
}

// isAbsentJSON reports whether a raw message carries nothing. An explicit JSON `null` is
// absence too: it is how GraphQL delivers an optional field that was not set, and writing
// it through to a NOT NULL jsonb column stores the literal null every client then
// dereferences.
func isAbsentJSON(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null"))
}

func viewName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", platform.Validation("name", "a view needs a name")
	}
	if len(name) > maxViewNameLength {
		return "", platform.Validation("name", "that name is too long")
	}
	return name, nil
}

// requireCustomViews answers whether this workspace may save a shared view.
//
// Only the two facts a feature question depends on are read. SeatsUsed and SeatLimit feed
// CanAddSeat alone, and counting a workspace's members to decide whether somebody may save
// a filter would be a query for a number nobody looks at.
//
// The *entitlement.Error is returned as it comes: it unwraps to a platform error carrying
// CodeEntitlement, so GraphQL presents PLAN_LIMIT and REST answers 402 without a
// conversion here, and it carries the structure a paywall needs instead of a sentence to
// string-match.
func requireCustomViews(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) error {
	ws, err := q.GetWorkspace(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("workspace")
		}
		return platform.Internal(err)
	}
	set := entitlement.New(entitlement.Facts{
		Plan:         entitlement.Plan(ws.Plan),
		PlanLapsedAt: ws.PlanLapsedAt,
	})
	return set.Allow(entitlement.FeatureCustomViews)
}

// requireViewAccess loads a view and decides whether the caller may change it, returning
// the scope its changes travel under so that permission and visibility are answered by one
// switch rather than by two that can disagree.
func (s *Service) requireViewAccess(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetViewRow, authz.Scope, error) {
	row, err := q.GetView(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetViewRow{}, authz.Scope{}, platform.NotFound("view")
		}
		return store.GetViewRow{}, authz.Scope{}, platform.Internal(err)
	}
	// Not-found rather than forbidden for the workspace mismatch: confirming that an id
	// exists in another workspace is itself a leak.
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetViewRow{}, authz.Scope{}, platform.NotFound("view")
	}

	switch {
	case row.OwnerID != nil:
		// No admin override, deliberately, and the same not-found: an admin has no business
		// editing somebody's private view, and saying "forbidden" would tell them whose it
		// is by confirming it exists.
		if !authz.OwnsResource(p, *row.OwnerID) {
			return store.GetViewRow{}, authz.Scope{}, platform.NotFound("view")
		}
		return row, authz.UserScope(*row.OwnerID), nil

	case row.TeamID != nil:
		team, err := s.requireTeamAccess(ctx, q, p, *row.TeamID, authz.ActionTeamViewManage)
		if err != nil {
			return store.GetViewRow{}, authz.Scope{}, err
		}
		return row, authz.TeamScope(team.ID, team.Private), nil

	default:
		if !authz.Can(p, authz.ActionWorkspaceViewManage) {
			return store.GetViewRow{}, authz.Scope{}, platform.Forbidden(
				"only admins can change views that belong to the whole workspace")
		}
		return row, authz.WorkspaceScope(), nil
	}
}

// visibleView is the read-side test: may this principal see this view at all. Weaker than
// requireViewAccess, which asks whether they may change it — a team member sees their
// team's shared views and an admin sees the workspace's, but neither may touch a private
// one that is not theirs.
func (s *Service) visibleView(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetViewRow, error) {
	row, err := q.GetView(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetViewRow{}, platform.NotFound("view")
		}
		return store.GetViewRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetViewRow{}, platform.NotFound("view")
	}

	scope, err := scopeForView(ctx, q, row.TeamID, row.OwnerID)
	if err != nil {
		return store.GetViewRow{}, err
	}
	// The same predicate the sync hub applies to the change rows. Not-found rather than
	// forbidden keeps the existence of a private team's views, and of other people's own
	// views, secret.
	if !authz.Visible(p, scope) {
		return store.GetViewRow{}, platform.NotFound("view")
	}
	return row, nil
}

// scopeForView states the three-way rule once: an owner makes it personal, a team makes it
// the team's, and neither makes it the workspace's.
func scopeForView(
	ctx context.Context, q *store.Queries, teamID, ownerID *uuid.UUID,
) (authz.Scope, error) {
	switch {
	case ownerID != nil:
		return authz.UserScope(*ownerID), nil
	case teamID != nil:
		team, err := q.GetTeam(ctx, *teamID)
		if err != nil {
			if store.IsNotFound(err) {
				// The team is cascade-deleted with its views, so this cannot happen from a
				// consistent database — and a scope guessed here would be a scope that
				// decides who sees the row.
				return authz.Scope{}, platform.NotFound("team")
			}
			return authz.Scope{}, platform.Internal(err)
		}
		return authz.TeamScope(team.ID, team.Private), nil
	default:
		return authz.WorkspaceScope(), nil
	}
}

// scopeTeamID returns the denormalised team id a change row carries. Present only for
// team-scoped changes, matching what Change.TeamID is for: it lets the hub judge a change
// without re-reading an entity that may already be gone. A private view anchored to a team
// is judged by its owner, so it carries none.
func scopeTeamID(scope authz.Scope, teamID *uuid.UUID) *uuid.UUID {
	if scope.Kind == authz.ScopeTeam {
		return teamID
	}
	return nil
}

// nextViewPosition appends to the end of the workspace's views. Positions are compared
// across the whole workspace — that is the order the sidebar renders in once the
// visibility filter has been applied.
func nextViewPosition(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.GetLastViewPosition(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

// viewPositionAfter mints the key that puts a view directly below the anchor.
func (s *Service) viewPositionAfter(
	ctx context.Context, q *store.Queries, p *authz.Principal, anchorID uuid.UUID,
) (string, error) {
	// Visibility, not just existence: dropping a view below one you cannot see would tell
	// you it exists, and would sort your sidebar by a position you were never shown.
	anchor, err := s.visibleView(ctx, q, p, anchorID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return "", platform.Validation("afterViewId", "no such view")
		}
		return "", err
	}

	next, err := q.GetViewPositionAfter(ctx, store.GetViewPositionAfterParams{
		WorkspaceID: p.WorkspaceID,
		Position:    anchor.Position,
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
		return "", platform.Internal(err)
	}
	return pos, nil
}

// favoritePosition places a favourite below the anchor, or at the bottom of the sidebar.
//
// The anchor's neighbour is taken from the listing rather than from
// GetFavoritePositionAfter: there is no query that reads one favourite by id, so the list
// has to be read anyway to find the anchor at all, and it already arrives in position
// order. A second query would be asking the database something this function is holding.
func favoritePosition(
	ctx context.Context, q *store.Queries, p *authz.Principal, afterID *uuid.UUID,
) (string, error) {
	if afterID == nil {
		last, err := q.GetLastFavoritePosition(ctx, p.UserID)
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}

	rows, err := q.ListFavorites(ctx, store.ListFavoritesParams{
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
	})
	if err != nil {
		return "", platform.Internal(err)
	}
	for i, r := range rows {
		if r.ID != *afterID {
			continue
		}
		upper := ""
		if i+1 < len(rows) {
			upper = rows[i+1].Position
		}
		pos, err := fractional.Between(r.Position, upper)
		if err != nil {
			return "", platform.Internal(err)
		}
		return pos, nil
	}
	// The listing is scoped to this user, so an anchor that is not in it is either somebody
	// else's favourite or nobody's. Both are the same answer.
	return "", platform.Validation("afterFavoriteId", "no such favourite")
}

func validFavoriteKind(kind string) bool {
	switch kind {
	case model.FavoriteView, model.FavoriteTeam, model.FavoriteIssue, model.FavoriteLabel:
		return true
	}
	return false
}

// favoriteTargetScope resolves what a favourite points at into the scope that decides who
// may see that target.
//
// exists is false when the target is missing, belongs to another workspace, or has been
// archived — three cases the caller must not be able to tell apart, because telling them
// apart is how somebody learns which ids exist inside a team they cannot reach. Archived
// counts as missing because an archived row is not replicated: a favourite pointing at one
// renders as an entry that opens nothing.
func favoriteTargetScope(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, kind string, targetID uuid.UUID,
) (authz.Scope, bool, error) {
	switch kind {
	case model.FavoriteView:
		v, err := q.GetView(ctx, targetID)
		if err != nil {
			return missingFavoriteTarget(err)
		}
		if v.WorkspaceID != workspaceID || v.ArchivedAt != nil {
			return authz.Scope{}, false, nil
		}
		scope, err := scopeForView(ctx, q, v.TeamID, v.OwnerID)
		if err != nil {
			return authz.Scope{}, false, err
		}
		return scope, true, nil

	case model.FavoriteTeam:
		t, err := q.GetTeam(ctx, targetID)
		if err != nil {
			return missingFavoriteTarget(err)
		}
		if t.WorkspaceID != workspaceID || t.ArchivedAt != nil {
			return authz.Scope{}, false, nil
		}
		return authz.TeamScope(t.ID, t.Private), true, nil

	case model.FavoriteIssue:
		// GetIssue already excludes soft-deleted issues.
		i, err := q.GetIssue(ctx, targetID)
		if err != nil {
			return missingFavoriteTarget(err)
		}
		if i.WorkspaceID != workspaceID || i.ArchivedAt != nil {
			return authz.Scope{}, false, nil
		}
		team, err := q.GetTeam(ctx, i.TeamID)
		if err != nil {
			return missingFavoriteTarget(err)
		}
		return authz.TeamScope(team.ID, team.Private), true, nil

	case model.FavoriteLabel:
		l, err := q.GetLabel(ctx, targetID)
		if err != nil {
			return missingFavoriteTarget(err)
		}
		if l.WorkspaceID != workspaceID || l.ArchivedAt != nil {
			return authz.Scope{}, false, nil
		}
		if l.TeamID == nil {
			return authz.WorkspaceScope(), true, nil
		}
		team, err := q.GetTeam(ctx, *l.TeamID)
		if err != nil {
			return missingFavoriteTarget(err)
		}
		return authz.TeamScope(team.ID, team.Private), true, nil
	}
	return authz.Scope{}, false, nil
}

// missingFavoriteTarget turns a lookup failure into the two answers the caller can act on:
// "not there" for no rows, and an internal error for anything else.
func missingFavoriteTarget(err error) (authz.Scope, bool, error) {
	if store.IsNotFound(err) {
		return authz.Scope{}, false, nil
	}
	return authz.Scope{}, false, platform.Internal(err)
}

// The converters below take the row type GetView returns. sqlc mints a distinct type per
// query even when the columns are identical, and the call sites convert their row into
// this one — a plain struct conversion the compiler checks field by field, so a query
// whose column list drifts from the others fails the build instead of quietly serialising
// a different shape.

func toView(v store.GetViewRow) model.View {
	return model.View{
		ID:          v.ID,
		WorkspaceID: v.WorkspaceID,
		TeamID:      v.TeamID,
		OwnerID:     v.OwnerID,
		Name:        v.Name,
		Description: v.Description,
		Icon:        v.Icon,
		Color:       v.Color,
		Filter:      v.Filter,
		Display:     v.Display,
		Position:    v.Position,
		CreatedBy:   v.CreatedBy,
		CreatedAt:   v.CreatedAt,
		UpdatedAt:   v.UpdatedAt,
		ArchivedAt:  v.ArchivedAt,
	}
}

func toViewPreference(v store.ViewPreference) model.ViewPreference {
	return model.ViewPreference{
		ID:          v.ID,
		WorkspaceID: v.WorkspaceID,
		UserID:      v.UserID,
		ViewKey:     v.ViewKey,
		Display:     v.Display,
		CreatedAt:   v.CreatedAt,
		UpdatedAt:   v.UpdatedAt,
	}
}

func toFavorite(f store.Favorite) model.Favorite {
	return model.Favorite{
		ID:          f.ID,
		WorkspaceID: f.WorkspaceID,
		UserID:      f.UserID,
		Kind:        f.Kind,
		TargetID:    f.TargetID,
		Position:    f.Position,
		CreatedAt:   f.CreatedAt,
		UpdatedAt:   f.UpdatedAt,
	}
}
