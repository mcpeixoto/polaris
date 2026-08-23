package graph

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// A replayed create files one row, across the creates the client queues.
//
// The mechanism is the outbox. `SyncEngine.mutate` appends the op *before* the request goes
// out and only removes it once a response has been parsed; `drainOutbox` then re-sends
// whatever is still queued with the (clientId, opId) of the first attempt. A reload taken in
// between — a couple of hundred milliseconds on a loaded machine, and rather longer on a bad
// connection — throws the response away and leaves the op queued, so the next drain sends it
// again. That is not an edge case, it is the ordinary cost of navigating away while a write
// is in flight.
//
// The pair only means something if the field carries @idempotent and the resolver hands it
// to idempotent(...). createRecurringIssue had neither and duplicated a schedule and its
// first occurrence every single time (#107); an audit afterwards found twenty more creates
// in exactly the same state. These are the ones the web client queues, and the duplicate
// each of them made was a real row in a real list: two identical saved views in the sidebar,
// two "In review" columns on the board, two labels of the same name and colour. Nothing
// about the second is distinguishable afterwards from something a person meant to create,
// which is why this is a data-integrity test and not a tidiness one.
//
// Written against the resolvers rather than a browser because the replay is a property of
// the pair, not of the UI: the same two calls are what the outbox makes.
func TestCreateMutations_AReplayFilesOneRow(t *testing.T) {
	t.Run("createView", func(t *testing.T) {
		h := newHarness(t)
		clientID, opID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
		in := generated.CreateViewInput{Name: "Blocked", Filter: json.RawMessage(`{"conj":"and","nodes":[]}`)}

		first, err := h.Mutation().CreateView(h.ctx, in, &clientID, &opID)
		if err != nil {
			t.Fatalf("save the view: %v", err)
		}
		second, err := h.Mutation().CreateView(h.ctx, in, &clientID, &opID)
		if err != nil {
			t.Fatalf("replay the save: %v", err)
		}
		if first.View.ID != second.View.ID {
			t.Errorf("the replay saved a second view (%s, then %s)", first.View.ID, second.View.ID)
		}

		views, err := h.Query().Views(h.ctx)
		if err != nil {
			t.Fatalf("list the views: %v", err)
		}
		if got := countNamed(len(views), func(i int) bool { return views[i].Name == "Blocked" }); got != 1 {
			t.Errorf("the sidebar holds %d views called \"Blocked\" after one save and one replay", got)
		}
	})

	t.Run("createWorkflowState", func(t *testing.T) {
		h := newHarness(t)
		clientID, opID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
		in := generated.CreateWorkflowStateInput{
			TeamID:   h.f.TeamID,
			Name:     "In review",
			Category: generated.StateCategoryStarted,
		}

		first, err := h.Mutation().CreateWorkflowState(h.ctx, in, &clientID, &opID)
		if err != nil {
			t.Fatalf("add the state: %v", err)
		}
		second, err := h.Mutation().CreateWorkflowState(h.ctx, in, &clientID, &opID)
		if err != nil {
			t.Fatalf("replay the add: %v", err)
		}
		if first.State.ID != second.State.ID {
			t.Errorf("the replay added a second state (%s, then %s)", first.State.ID, second.State.ID)
		}

		states, err := h.Query().WorkflowStates(h.ctx, h.f.TeamID)
		if err != nil {
			t.Fatalf("list the states: %v", err)
		}
		if got := countNamed(len(states), func(i int) bool { return states[i].Name == "In review" }); got != 1 {
			t.Errorf("the board holds %d columns called \"In review\" after one add and one replay", got)
		}
	})

	t.Run("createIssueTemplate", func(t *testing.T) {
		h := newHarness(t)
		clientID, opID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
		in := generated.CreateIssueTemplateInput{TeamID: &h.f.TeamID, Name: "Bug report"}

		first, err := h.Mutation().CreateIssueTemplate(h.ctx, in, &clientID, &opID)
		if err != nil {
			t.Fatalf("create the template: %v", err)
		}
		second, err := h.Mutation().CreateIssueTemplate(h.ctx, in, &clientID, &opID)
		if err != nil {
			t.Fatalf("replay the create: %v", err)
		}
		if first.Template.ID != second.Template.ID {
			t.Errorf("the replay created a second template (%s, then %s)",
				first.Template.ID, second.Template.ID)
		}

		templates, err := h.Query().IssueTemplates(h.ctx, &h.f.TeamID)
		if err != nil {
			t.Fatalf("list the templates: %v", err)
		}
		if len(templates) != 1 {
			t.Errorf("the team holds %d templates after one create and one replay", len(templates))
		}
	})

	t.Run("createFavoriteFolder", func(t *testing.T) {
		// The one create in this set whose arguments are positional rather than an input
		// object, so its request hash is built by hand in the resolver. Worth its own case:
		// a wrong hash there does not fail loudly, it just makes every call a fresh op.
		h := newHarness(t)
		clientID, opID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())

		first, err := h.Mutation().CreateFavoriteFolder(h.ctx, "Reading", nil, &clientID, &opID)
		if err != nil {
			t.Fatalf("create the folder: %v", err)
		}
		second, err := h.Mutation().CreateFavoriteFolder(h.ctx, "Reading", nil, &clientID, &opID)
		if err != nil {
			t.Fatalf("replay the create: %v", err)
		}
		if first.Favorite.ID != second.Favorite.ID {
			t.Errorf("the replay created a second folder (%s, then %s)",
				first.Favorite.ID, second.Favorite.ID)
		}

		favorites, err := h.Query().Favorites(h.ctx)
		if err != nil {
			t.Fatalf("list the favourites: %v", err)
		}
		if got := countNamed(len(favorites), func(i int) bool {
			return favorites[i].Name != nil && *favorites[i].Name == "Reading"
		}); got != 1 {
			t.Errorf("the sidebar holds %d folders called \"Reading\" after one create and one replay", got)
		}
	})
}

// Reusing an opId for a *different* request is a client bug, and it must not be answered
// with the earlier result.
//
// The stored key hashes the request precisely so the two cases can be told apart: a replay
// is the same op, and the same op is the same arguments. Answering a different create with
// the first one's row would be worse than writing twice — the caller would be handed an id
// for something it did not ask for and would have no way to notice.
func TestCreateMutations_AReusedKeyWithDifferentArgumentsIsRefused(t *testing.T) {
	h := newHarness(t)
	clientID, opID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())

	if _, err := h.Mutation().CreateView(h.ctx,
		generated.CreateViewInput{Name: "Blocked", Filter: json.RawMessage(`{"conj":"and","nodes":[]}`)},
		&clientID, &opID); err != nil {
		t.Fatalf("save the first view: %v", err)
	}

	other, err := h.Mutation().CreateView(h.ctx,
		generated.CreateViewInput{Name: "Stale", Filter: json.RawMessage(`{"conj":"and","nodes":[]}`)},
		&clientID, &opID)
	if err == nil {
		t.Fatalf("saving a different view under the same (clientId, opId) succeeded and returned "+
			"%q; the request is part of the key so that a reused op id is refused rather than "+
			"silently answered with the earlier row", other.View.Name)
	}
}

func countNamed(n int, matches func(int) bool) int {
	found := 0
	for i := range n {
		if matches(i) {
			found++
		}
	}
	return found
}
