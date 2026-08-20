package model

import (
	"time"

	"github.com/google/uuid"
)

// CycleCalendarFeed is the viewer's ICS subscription for one team, minus the token.
//
// On the sync stream so the Cycles ⋯ menu can offer Subscribe without a round-trip
// to learn that a feed already exists. The token stays in a column listing queries
// never select; the URL that contains it is fetched over GraphQL when the dialog opens.
type CycleCalendarFeed struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	TeamID      uuid.UUID `json:"teamId"`
	UserID      uuid.UUID `json:"userId"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
