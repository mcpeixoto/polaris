package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toAccountSession(s domain.AccountSession) generated.AccountSession {
	return generated.AccountSession{
		ID:         s.ID,
		Label:      s.Label,
		UserAgent:  s.UserAgent,
		IP:         s.IP,
		Country:    s.Country,
		Current:    s.Current,
		LastSeenAt: s.LastSeenAt,
		CreatedAt:  s.CreatedAt,
		ExpiresAt:  s.ExpiresAt,
	}
}

func toAccountSessions(rows []domain.AccountSession) []generated.AccountSession {
	out := make([]generated.AccountSession, 0, len(rows))
	for _, s := range rows {
		out = append(out, toAccountSession(s))
	}
	return out
}
