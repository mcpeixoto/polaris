package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Due-date notices.
//
// The fan-out cannot produce these. A deadline is not a change somebody made, so it has no
// change_log row, and notify.Deliveries refuses to invent one. This sweep is the other
// producer of inbox rows: two mornings per deadline, the day it is due and the morning
// after, and then it stops. Repeating "still overdue" every day is how the channel gets
// muted, and a muted channel delivers nothing — including the assignment that mattered.
//
// Who hears it is the assignee. With no assignee, the people watching the issue. Telling
// every subscriber of an assigned issue would wake the team for one person's deadline.

// SweepDueNotifications writes the due and overdue notices that are owed at now.
//
// now is an argument so a test can stand on a morning without waiting for one. The worker
// passes time.Now. A workspace that fails is logged and skipped: this runs unattended, and
// one team's bad row must not stop every other team's deadlines. The claim is what makes
// the next pass safe — a notice that committed is not said again.
func (s *Service) SweepDueNotifications(ctx context.Context, now time.Time) (int, error) {
	workspaces, err := s.db.Queries().ListWorkspacesWithDueIssues(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}

	total := 0
	for _, workspaceID := range workspaces {
		n, err := s.sweepDueWorkspace(ctx, workspaceID, now)
		if err != nil {
			platform.Log(ctx).Error("due-date sweep failed for a workspace",
				"workspace", workspaceID, "error", err)
			continue
		}
		total += n
	}
	return total, nil
}

type dueGroup struct {
	userID    uuid.UUID
	kind      string
	localDate string
	items     []store.ListOpenIssuesWithDueDatesRow
}

func (s *Service) sweepDueWorkspace(ctx context.Context, workspaceID uuid.UUID, now time.Time) (int, error) {
	var written int
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		version, err := q.GetWorkspaceVersion(ctx, workspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("read workspace version: %w", err))
		}

		rows, err := q.ListOpenIssuesWithDueDates(ctx, workspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("list due issues: %w", err))
		}
		if len(rows) == 0 {
			return nil
		}

		groups := map[string]*dueGroup{}
		var order []string
		known := map[uuid.UUID]*store.User{}

		for _, row := range rows {
			if !row.DueDate.Valid {
				continue
			}
			kind, localDate, ok, err := notify.DueNotice(row.DueDate.Time, now, row.TeamTimezone)
			if err != nil {
				// A zone the process cannot load. Skipping the issue is the safe failure:
				// announcing it in UTC would be the wrong day, and failing the workspace
				// would hold every other team's deadlines behind one bad setting.
				platform.Log(ctx).Warn("due-date sweep: skipping an issue with an unusable timezone",
					"workspace", workspaceID, "issue", row.ID, "timezone", row.TeamTimezone, "error", err)
				continue
			}
			if !ok {
				continue
			}

			recipients, err := dueRecipients(ctx, q, workspaceID, row, known)
			if err != nil {
				return err
			}
			for _, userID := range recipients {
				user := known[userID]
				if user != nil && mutedTypes(user.NotificationPrefs)[model.NotifyIssueDue] {
					continue
				}
				key := userID.String() + "|" + notify.DueGroupKey(kind, localDate)
				g, seen := groups[key]
				if !seen {
					g = &dueGroup{userID: userID, kind: kind, localDate: localDate}
					groups[key] = g
					order = append(order, key)
				}
				g.items = append(g.items, row)
			}
		}

		var changes []Change
		for _, key := range order {
			g := groups[key]
			fresh := make([]store.ListOpenIssuesWithDueDatesRow, 0, len(g.items))
			for _, item := range g.items {
				_, err := q.ClaimDueNotice(ctx, store.ClaimDueNoticeParams{
					UserID: g.userID, IssueID: item.ID, Kind: g.kind, DueDate: item.DueDate,
				})
				if err != nil {
					if store.IsNotFound(err) {
						continue
					}
					return platform.Internal(fmt.Errorf("claim due notice: %w", err))
				}
				fresh = append(fresh, item)
			}
			if len(fresh) == 0 {
				continue
			}

			ids := make([]uuid.UUID, len(fresh))
			for i, item := range fresh {
				ids[i] = item.ID
			}
			payload, err := json.Marshal(struct {
				Kind     string      `json:"kind"`
				IssueIDs []uuid.UUID `json:"issueIds"`
			}{Kind: g.kind, IssueIDs: ids})
			if err != nil {
				return platform.Internal(err)
			}

			id, err := uuid.NewV7()
			if err != nil {
				return platform.Internal(err)
			}
			first := fresh[0].ID
			row, err := q.UpsertDueNotification(ctx, store.UpsertDueNotificationParams{
				ID:            id,
				WorkspaceID:   workspaceID,
				UserID:        g.userID,
				Type:          model.NotifyIssueDue,
				IssueID:       &first,
				ChangeVersion: version,
				GroupKey:      notify.DueGroupKey(g.kind, g.localDate),
				Count:         int32(len(fresh)),
				Payload:       payload,
			})
			if err != nil {
				return platform.Internal(fmt.Errorf("write due notification: %w", err))
			}
			changes = append(changes, Change{
				EntityType: "notification", EntityID: row.ID, Op: OpUpsert,
				Scope: authz.UserScope(g.userID), Payload: toNotification(row),
			})
			written++
		}

		if len(changes) == 0 {
			return nil
		}
		// The calendar, not a person. Attributing a deadline to whoever last edited the
		// issue would put their name on a notification they did not send.
		_, err = s.em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...)
		return err
	})
	if err != nil {
		return 0, err
	}
	return written, nil
}

// dueRecipients is the assignee, or the watchers when there is no assignee.
//
// known caches the user row for the pass, because a person assigned ten deadlines is one
// person. A user who is gone, archived, suspended, or in another workspace is not a
// recipient — and an assignee who is one of those is not replaced by the watchers. The
// work is still theirs.
func dueRecipients(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID,
	row store.ListOpenIssuesWithDueDatesRow, known map[uuid.UUID]*store.User,
) ([]uuid.UUID, error) {
	if row.AssigneeID != nil {
		ok, err := dueRecipientOK(ctx, q, workspaceID, *row.AssigneeID, known)
		if err != nil || !ok {
			return nil, err
		}
		return []uuid.UUID{*row.AssigneeID}, nil
	}

	subs, err := q.ListIssueSubscribers(ctx, row.ID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("due sweep: read subscribers: %w", err))
	}
	out := make([]uuid.UUID, 0, len(subs))
	for _, sub := range subs {
		ok, err := dueRecipientOK(ctx, q, workspaceID, sub.UserID, known)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, sub.UserID)
		}
	}
	return out, nil
}

func dueRecipientOK(
	ctx context.Context, q *store.Queries, workspaceID, userID uuid.UUID, known map[uuid.UUID]*store.User,
) (bool, error) {
	user, seen := known[userID]
	if !seen {
		row, err := q.GetUser(ctx, userID)
		if err != nil {
			if store.IsNotFound(err) {
				known[userID] = nil
				return false, nil
			}
			return false, platform.Internal(fmt.Errorf("due sweep: read recipient: %w", err))
		}
		user = &row
		known[userID] = user
	}
	if user == nil || user.WorkspaceID != workspaceID || user.ArchivedAt != nil || user.Status != "active" {
		return false, nil
	}
	return true, nil
}
