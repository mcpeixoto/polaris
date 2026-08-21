package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toAuthorisedOauthApp(app domain.AuthorisedOauthApp) generated.AuthorisedOauthApp {
	return generated.AuthorisedOauthApp{
		ID:         app.ID,
		Name:       app.Name,
		ClientID:   app.ClientID,
		ImageURL:   app.ImageURL,
		Developer:  app.Developer,
		Scopes:     app.Scopes,
		LastUsedAt: app.LastUsedAt,
		CreatedAt:  app.CreatedAt,
	}
}

func toAuthorisedOauthApps(rows []domain.AuthorisedOauthApp) []generated.AuthorisedOauthApp {
	out := make([]generated.AuthorisedOauthApp, 0, len(rows))
	for _, app := range rows {
		out = append(out, toAuthorisedOauthApp(app))
	}
	return out
}
