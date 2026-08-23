package graph

import (
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// A recurring schedule is the one create in the API that writes twice: the schedule, and
// the first occurrence filed from it. So a replayed request costs two rows, not one, and
// neither is distinguishable afterwards from something a person meant to file — "Weekly
// status" appears on the team's list twice, on two schedules, and archiving one of them
// leaves the other still minting.
//
// The replay is not exotic. The client renders the schedule optimistically and keeps the
// op in its outbox until the response lands; a reload taken in that window — which is a
// couple of hundred milliseconds on a loaded machine — throws the response away and the
// outbox re-sends, with the same (clientId, opId) it used the first time. That pair is the
// whole mechanism, and it does nothing unless the field carries @idempotent and the
// resolver asks. This mutation carried neither, and a browser probe that clicked "Add
// schedule" and reloaded produced two schedules and two issues every time, three when the
// machine was busy enough for the outbox to drain twice.
func TestCreateRecurringIssue_AReplayFilesNeitherASecondScheduleNorASecondIssue(t *testing.T) {
	h := newHarness(t)

	clientID := uuid.Must(uuid.NewV7())
	opID := uuid.Must(uuid.NewV7())
	in := generated.CreateRecurringIssueInput{
		TeamID:       h.f.TeamID,
		Title:        "Weekly status",
		Cadence:      generated.RecurringCadenceWeekly,
		FirstDueDate: "2030-01-07",
	}

	first, err := h.Mutation().CreateRecurringIssue(h.ctx, in, &clientID, &opID)
	if err != nil {
		t.Fatalf("create the schedule: %v", err)
	}
	second, err := h.Mutation().CreateRecurringIssue(h.ctx, in, &clientID, &opID)
	if err != nil {
		t.Fatalf("replay the create: %v", err)
	}

	if first.RecurringIssue.ID != second.RecurringIssue.ID {
		t.Errorf("the replay minted a second schedule (%s, then %s); the outbox re-sends the "+
			"original (clientId, opId) precisely so it does not",
			first.RecurringIssue.ID, second.RecurringIssue.ID)
	}

	schedules, err := h.Query().RecurringIssues(h.ctx, h.f.TeamID)
	if err != nil {
		t.Fatalf("list the schedules: %v", err)
	}
	if len(schedules) != 1 {
		t.Errorf("the team holds %d schedules after one create and one replay; it should hold one", len(schedules))
	}

	// The occurrence is the half that hurts: a duplicate schedule is visible in team
	// settings and can be archived, while a duplicate issue is just an issue.
	issues, err := h.Query().Issues(h.ctx, h.f.TeamID)
	if err != nil {
		t.Fatalf("list the issues: %v", err)
	}
	minted := 0
	for _, issue := range issues {
		if issue.RecurringIssueID != nil {
			minted++
		}
	}
	if minted != 1 {
		t.Errorf("the schedule filed %d occurrences across the create and its replay; one create is one issue", minted)
	}
}

// The other two carry the same key for the same reason. Neither duplicates a row the way
// the create does — an update is a write of known values and an archive is a flag — but
// both return a version the client stores, and a replay that re-ran them would answer with
// a version from a second write rather than the one the caller's first attempt earned.
func TestUpdateAndArchiveRecurringIssue_ReplayAnswersWithTheOriginalResult(t *testing.T) {
	h := newHarness(t)

	created, err := h.Mutation().CreateRecurringIssue(h.ctx, generated.CreateRecurringIssueInput{
		TeamID:       h.f.TeamID,
		Title:        "Weekly status",
		Cadence:      generated.RecurringCadenceWeekly,
		FirstDueDate: "2030-01-07",
	}, nil, nil)
	if err != nil {
		t.Fatalf("create the schedule: %v", err)
	}
	id := created.RecurringIssue.ID

	updateClient, updateOp := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	update := generated.UpdateRecurringIssueInput{ID: id, Title: ptr("Fortnightly status")}
	updatedOnce, err := h.Mutation().UpdateRecurringIssue(h.ctx, update, &updateClient, &updateOp)
	if err != nil {
		t.Fatalf("update the schedule: %v", err)
	}
	updatedTwice, err := h.Mutation().UpdateRecurringIssue(h.ctx, update, &updateClient, &updateOp)
	if err != nil {
		t.Fatalf("replay the update: %v", err)
	}
	if updatedOnce.Version != updatedTwice.Version {
		t.Errorf("the replayed update reported version %d against the original %d; a replay "+
			"replays the answer, it does not write again", updatedTwice.Version, updatedOnce.Version)
	}

	archiveClient, archiveOp := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	archivedOnce, err := h.Mutation().ArchiveRecurringIssue(h.ctx, id, true, &archiveClient, &archiveOp)
	if err != nil {
		t.Fatalf("archive the schedule: %v", err)
	}
	archivedTwice, err := h.Mutation().ArchiveRecurringIssue(h.ctx, id, true, &archiveClient, &archiveOp)
	if err != nil {
		t.Fatalf("replay the archive: %v", err)
	}
	if archivedOnce.Version != archivedTwice.Version || archivedOnce.ID != archivedTwice.ID {
		t.Errorf("the replayed archive answered %+v against the original %+v", archivedTwice, archivedOnce)
	}
}
