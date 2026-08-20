package domain

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	cycleCalendarTokenPrefix = "cal_"
	cycleCalendarTokenBytes  = 32
)

type CycleCalendarICS struct {
	Body     []byte
	Filename string
}

func (s *Service) EnsureCycleCalendarFeed(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (model.CycleCalendarFeed, string, int64, error) {
	if err := s.requireCycleCalendarTeam(ctx, p, teamID); err != nil {
		return model.CycleCalendarFeed{}, "", 0, err
	}

	existing, token, err := s.ownerCycleCalendarFeed(ctx, teamID, p.UserID)
	if err == nil {
		return existing, token, 0, nil
	}
	if !store.IsNotFound(err) {
		return model.CycleCalendarFeed{}, "", 0, err
	}

	secret, err := newCycleCalendarToken()
	if err != nil {
		return model.CycleCalendarFeed{}, "", 0, err
	}

	var out model.CycleCalendarFeed
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateCycleCalendarFeed(ctx, store.CreateCycleCalendarFeedParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      teamID,
			UserID:      p.UserID,
			Token:       secret,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "cycle_calendar_feed_team_user") {
				got, tok, getErr := s.ownerCycleCalendarFeed(ctx, teamID, p.UserID)
				if getErr != nil {
					return getErr
				}
				out = got
				secret = tok
				return nil
			}
			return platform.Internal(err)
		}
		out = cycleCalendarFeedFromCreate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "cycleCalendarFeed", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.CycleCalendarFeed{}, "", 0, err
	}
	return out, secret, version, nil
}

// RotateCycleCalendarFeed replaces the personal ICS token. The previous feed URL
// stops working the moment this returns; that is the whole point of the mutation.
func (s *Service) RotateCycleCalendarFeed(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (model.CycleCalendarFeed, string, int64, error) {
	if err := s.requireCycleCalendarTeam(ctx, p, teamID); err != nil {
		return model.CycleCalendarFeed{}, "", 0, err
	}

	secret, err := newCycleCalendarToken()
	if err != nil {
		return model.CycleCalendarFeed{}, "", 0, err
	}

	var out model.CycleCalendarFeed
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.RotateCycleCalendarFeedToken(ctx, store.RotateCycleCalendarFeedTokenParams{
			Token:  secret,
			TeamID: teamID,
			UserID: p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("cycleCalendarFeed")
			}
			return platform.Internal(err)
		}
		out = cycleCalendarFeedFromRotate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "cycleCalendarFeed", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.CycleCalendarFeed{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) GetCycleCalendarFeed(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (model.CycleCalendarFeed, error) {
	if err := s.requireCycleCalendarTeam(ctx, p, teamID); err != nil {
		return model.CycleCalendarFeed{}, err
	}
	feed, _, err := s.ownerCycleCalendarFeed(ctx, teamID, p.UserID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.CycleCalendarFeed{}, platform.NotFound("cycleCalendarFeed")
		}
		return model.CycleCalendarFeed{}, err
	}
	return feed, nil
}

func (s *Service) GetCycleCalendarFeedToken(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (string, error) {
	if err := s.requireCycleCalendarTeam(ctx, p, teamID); err != nil {
		return "", err
	}
	_, token, err := s.ownerCycleCalendarFeed(ctx, teamID, p.UserID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.NotFound("cycleCalendarFeed")
		}
		return "", err
	}
	return token, nil
}

func (s *Service) GetPublicCycleCalendar(ctx context.Context, token string) (CycleCalendarICS, error) {
	token = strings.TrimSuffix(strings.TrimSpace(token), ".ics")
	if token == "" {
		return CycleCalendarICS{}, platform.NotFound("cycleCalendarFeed")
	}
	row, err := s.db.Queries().GetCycleCalendarFeedByToken(ctx, token)
	if err != nil {
		if store.IsNotFound(err) {
			return CycleCalendarICS{}, platform.NotFound("cycleCalendarFeed")
		}
		return CycleCalendarICS{}, platform.Internal(err)
	}
	team, err := s.db.Queries().GetTeam(ctx, row.TeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return CycleCalendarICS{}, platform.NotFound("team")
		}
		return CycleCalendarICS{}, platform.Internal(err)
	}
	cycles, err := s.db.Queries().ListCyclesForTeam(ctx, row.TeamID)
	if err != nil {
		return CycleCalendarICS{}, platform.Internal(err)
	}
	models := make([]model.Cycle, 0, len(cycles))
	for _, c := range cycles {
		models = append(models, toCycle(c))
	}
	body := RenderCycleICS(team.Name, team.Timezone, models, s.now())
	return CycleCalendarICS{
		Body:     body,
		Filename: icsFilename(team.Key),
	}, nil
}

func (s *Service) requireCycleCalendarTeam(ctx context.Context, p *authz.Principal, teamID uuid.UUID) error {
	team, err := s.db.Queries().GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("team")
		}
		return platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		return platform.NotFound("team")
	}
	if !authz.Visible(p, authz.TeamScope(teamID, team.Private)) {
		return platform.NotFound("team")
	}
	return nil
}

func (s *Service) ownerCycleCalendarFeed(
	ctx context.Context, teamID, userID uuid.UUID,
) (model.CycleCalendarFeed, string, error) {
	row, err := s.db.Queries().GetCycleCalendarFeedForOwner(ctx, store.GetCycleCalendarFeedForOwnerParams{
		TeamID: teamID,
		UserID: userID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return model.CycleCalendarFeed{}, "", err
		}
		return model.CycleCalendarFeed{}, "", platform.Internal(err)
	}
	return cycleCalendarFeedFromRow(row), row.Token, nil
}

func newCycleCalendarToken() (string, error) {
	buf := make([]byte, cycleCalendarTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", platform.Internal(err)
	}
	return cycleCalendarTokenPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func cycleCalendarFeedFromCreate(r store.CreateCycleCalendarFeedRow) model.CycleCalendarFeed {
	return model.CycleCalendarFeed{
		ID: r.ID, WorkspaceID: r.WorkspaceID, TeamID: r.TeamID, UserID: r.UserID,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func cycleCalendarFeedFromRotate(r store.RotateCycleCalendarFeedTokenRow) model.CycleCalendarFeed {
	return model.CycleCalendarFeed{
		ID: r.ID, WorkspaceID: r.WorkspaceID, TeamID: r.TeamID, UserID: r.UserID,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func cycleCalendarFeedFromRow(r store.CycleCalendarFeed) model.CycleCalendarFeed {
	return model.CycleCalendarFeed{
		ID: r.ID, WorkspaceID: r.WorkspaceID, TeamID: r.TeamID, UserID: r.UserID,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func cycleCalendarFeedFromStream(r store.StreamCycleCalendarFeedsForBootstrapRow) model.CycleCalendarFeed {
	return model.CycleCalendarFeed{
		ID: r.ID, WorkspaceID: r.WorkspaceID, TeamID: r.TeamID, UserID: r.UserID,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func icsFilename(teamKey string) string {
	key := strings.ToLower(strings.TrimSpace(teamKey))
	if key == "" {
		return "cycles.ics"
	}
	return key + "-cycles.ics"
}

// RenderCycleICS builds a published VCALENDAR of the team's live cycles.
//
// All-day DATE values in the team's timezone: DTSTART is the cycle's start day,
// DTEND is the exclusive end day (the same instant as cycle.endsAt, which is
// already exclusive). Google Calendar and Apple Calendar both treat that pair
// as a multi-day all-day event covering the sprint.
func RenderCycleICS(teamName, timezone string, cycles []model.Cycle, now time.Time) []byte {
	loc := locationOf(timezone)
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\n")
	b.WriteString("VERSION:2.0\r\n")
	b.WriteString("PRODID:-//Polaris//Cycles//EN\r\n")
	b.WriteString("CALSCALE:GREGORIAN\r\n")
	b.WriteString("METHOD:PUBLISH\r\n")
	writeICSLine(&b, "X-WR-CALNAME", teamName+" cycles")
	stamp := now.UTC().Format("20060102T150405Z")
	for _, cycle := range cycles {
		b.WriteString("BEGIN:VEVENT\r\n")
		writeICSLine(&b, "UID", cycle.ID.String()+"@polaris")
		writeICSLine(&b, "DTSTAMP", stamp)
		writeICSLine(&b, "DTSTART;VALUE=DATE", icsDate(cycle.StartsAt, loc))
		writeICSLine(&b, "DTEND;VALUE=DATE", icsDate(cycle.EndsAt, loc))
		writeICSLine(&b, "SUMMARY", cycle.Name)
		if cycle.Description != nil && strings.TrimSpace(*cycle.Description) != "" {
			writeICSLine(&b, "DESCRIPTION", strings.TrimSpace(*cycle.Description))
		}
		b.WriteString("END:VEVENT\r\n")
	}
	b.WriteString("END:VCALENDAR\r\n")
	return []byte(b.String())
}

func locationOf(name string) *time.Location {
	name = strings.TrimSpace(name)
	if name == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

func icsDate(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("20060102")
}

func writeICSLine(b *strings.Builder, name, value string) {
	line := name + ":" + escapeICSText(value)
	// RFC 5545 folds at 75 octets. ASCII names keep this a character count.
	for len(line) > 75 {
		b.WriteString(line[:75])
		b.WriteString("\r\n ")
		line = line[75:]
	}
	b.WriteString(line)
	b.WriteString("\r\n")
}

func escapeICSText(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		";", `\;`,
		",", `\,`,
		"\r\n", `\n`,
		"\n", `\n`,
	)
	return replacer.Replace(value)
}

func cycleCalendarURL(publicURL, token string) string {
	base := strings.TrimRight(strings.TrimSpace(publicURL), "/")
	path := "/calendars/cycles/" + token
	if base == "" {
		return path
	}
	return base + path
}

// Exported for the GraphQL layer; the token must not leak onto the replica.
func CycleCalendarURL(publicURL, token string) string {
	return cycleCalendarURL(publicURL, token)
}
