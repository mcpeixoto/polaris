package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Pulse digest: a morning inbox summary of project updates the recipient would see
// on /pulse For me.
//
// Pulse v1 ranked replica rows and stopped there. The digest is the other half of
// Linear Pulse: people who do not live on that page still hear that their projects
// posted. It is not derived from change_log the way FanOut is — a summary of many
// posts has no single change to fan out from — so the worker writes the inbox row
// itself and emits it onto the stream so replicas learn about it the same way they
// learn about every other notification.
//
// Idempotency is the cursor, not the unique index. group_key is still per person per
// local day (or ISO week) so a replay that somehow skipped the cursor cannot invent
// a second morning mail; the WHERE on UpsertNotification then turns that replay into
// a no-op.

const pulseDigestHour = 6

type pulseDigestPayload struct {
	Count int `json:"count"`
}

// DeliverPulseDigests writes due morning summaries and returns how many inbox rows
// it created. now is injected so tests can pin 06:00 without waiting for it.
func (s *Service) DeliverPulseDigests(ctx context.Context, now time.Time) (int, error) {
	workspaces, err := s.db.Queries().ListPulseDigestWorkspaces(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}

	total := 0
	for _, ws := range workspaces {
		n, err := s.deliverPulseDigestsForWorkspace(ctx, ws.ID, ws.PulseDigestCadence, now)
		if err != nil {
			platform.Log(ctx).Error("pulse digest failed for a workspace",
				"workspace", ws.ID, "error", err)
			continue
		}
		total += n
	}
	return total, nil
}

func (s *Service) deliverPulseDigestsForWorkspace(
	ctx context.Context, workspaceID uuid.UUID, cadence string, now time.Time,
) (int, error) {
	users, err := s.db.Queries().ListPulseDigestUsers(ctx, workspaceID)
	if err != nil {
		return 0, platform.Internal(err)
	}

	delivered := 0
	for _, user := range users {
		ok, err := s.deliverPulseDigest(ctx, workspaceID, user.ID, user.Timezone, user.NotificationPrefs, cadence, now)
		if err != nil {
			return delivered, err
		}
		if ok {
			delivered++
		}
	}
	return delivered, nil
}

func (s *Service) deliverPulseDigest(
	ctx context.Context,
	workspaceID, userID uuid.UUID,
	timezone string,
	prefs []byte,
	cadence string,
	now time.Time,
) (bool, error) {
	if mutedTypes(prefs)[model.NotifyPulseDigest] {
		return false, nil
	}
	loc := pulseLocation(timezone)
	localNow := now.In(loc)

	var lastSent *time.Time
	cursor, err := s.db.Queries().GetPulseDigestCursor(ctx, store.GetPulseDigestCursorParams{
		WorkspaceID: workspaceID,
		UserID:      userID,
	})
	if err != nil {
		if !store.IsNotFound(err) {
			return false, platform.Internal(err)
		}
	} else {
		lastSent = &cursor
	}

	if !pulseDigestDue(cadence, loc, lastSent, localNow) {
		return false, nil
	}

	since := pulseDigestSince(cadence, loc, lastSent, localNow)
	count, err := s.db.Queries().CountPulseForMeUpdatesSince(ctx, store.CountPulseForMeUpdatesSinceParams{
		WorkspaceID: workspaceID,
		Since:       since,
		UserID:      &userID,
	})
	if err != nil {
		return false, platform.Internal(err)
	}
	if count == 0 {
		return false, nil
	}

	payload, err := json.Marshal(pulseDigestPayload{Count: int(count)})
	if err != nil {
		return false, platform.Internal(err)
	}

	wrote := false
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		version, err := q.GetWorkspaceVersion(ctx, workspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.UpsertNotification(ctx, store.UpsertNotificationParams{
			ID:            id,
			WorkspaceID:   workspaceID,
			UserID:        userID,
			Type:          model.NotifyPulseDigest,
			ActorType:     string(authz.ActorSystem),
			ChangeVersion: version,
			GroupKey:      pulseDigestGroupKey(userID, cadence, localNow),
			Payload:       payload,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return nil
			}
			return platform.Internal(fmt.Errorf("upsert pulse digest: %w", err))
		}
		n := toNotification(row)
		if _, err := s.em.Emit(ctx, q, workspaceID, authz.SystemActor(), Change{
			EntityType: "notification", EntityID: n.ID, Op: OpUpsert,
			Scope: authz.UserScope(n.UserID), Payload: n,
		}); err != nil {
			return err
		}
		if err := q.UpsertPulseDigestCursor(ctx, store.UpsertPulseDigestCursorParams{
			WorkspaceID: workspaceID,
			UserID:      userID,
			LastSentAt:  now,
		}); err != nil {
			return platform.Internal(err)
		}
		wrote = true
		return nil
	})
	return wrote, err
}

func pulseDigestDue(cadence string, loc *time.Location, lastSent *time.Time, now time.Time) bool {
	if now.Hour() < pulseDigestHour {
		return false
	}
	switch cadence {
	case model.PulseDigestDaily:
		if lastSent == nil {
			return true
		}
		sent := lastSent.In(loc)
		return !sameLocalDate(sent, now)
	case model.PulseDigestWeekly:
		if now.Weekday() != time.Monday {
			return false
		}
		if lastSent == nil {
			return true
		}
		monday := startOfLocalDay(now).AddDate(0, 0, -int(now.Weekday()-time.Monday))
		window := time.Date(monday.Year(), monday.Month(), monday.Day(), pulseDigestHour, 0, 0, 0, loc)
		return lastSent.In(loc).Before(window)
	default:
		return false
	}
}

func pulseDigestSince(cadence string, loc *time.Location, lastSent *time.Time, now time.Time) time.Time {
	if lastSent != nil {
		return *lastSent
	}
	if cadence == model.PulseDigestWeekly {
		return now.Add(-7 * 24 * time.Hour).In(loc)
	}
	return now.Add(-24 * time.Hour).In(loc)
}

func pulseDigestGroupKey(userID uuid.UUID, cadence string, now time.Time) string {
	if cadence == model.PulseDigestWeekly {
		year, week := now.ISOWeek()
		return fmt.Sprintf("pulse_digest:%s:%d-W%02d", userID, year, week)
	}
	return fmt.Sprintf("pulse_digest:%s:%s", userID, now.Format("2006-01-02"))
}

func pulseLocation(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

func sameLocalDate(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

func startOfLocalDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}
