package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	authorizeURL = "https://github.com/login/oauth/authorize"
	tokenURL     = "https://github.com/login/oauth/access_token"
	userURL      = "https://api.github.com/user"
)

// AuthorizeURL is the GitHub consent page. Scope is read:user: we only need the login
// to attribute activity. Repo access is the GitHub App's job, not the personal OAuth.
func AuthorizeURL(clientID, redirectURI, state string) string {
	q := url.Values{
		"client_id":    {clientID},
		"redirect_uri": {redirectURI},
		"state":        {state},
		"scope":        {"read:user"},
	}
	return authorizeURL + "?" + q.Encode()
}

// Identity is who GitHub says the person is after a successful OAuth exchange.
type Identity struct {
	Login  string
	UserID int64
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

type userResponse struct {
	Login string `json:"login"`
	ID    int64  `json:"id"`
}

// ExchangeCode trades a GitHub OAuth code for the person's login. The access token is
// used for that one call and then discarded: v1 only stores the login, so a leaked
// replica cannot become a GitHub session.
func ExchangeCode(ctx context.Context, clientID, clientSecret, code, redirectURI string) (Identity, error) {
	form := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return Identity{}, fmt.Errorf("github token: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return Identity{}, fmt.Errorf("github token: %w", err)
	}
	var tok tokenResponse
	if err := json.Unmarshal(raw, &tok); err != nil {
		return Identity{}, fmt.Errorf("github token: %w", err)
	}
	if tok.Error != "" || tok.AccessToken == "" {
		msg := tok.ErrorDesc
		if msg == "" {
			msg = tok.Error
		}
		if msg == "" {
			msg = "GitHub did not return an access token"
		}
		return Identity{}, fmt.Errorf("github token: %s", msg)
	}

	ureq, err := http.NewRequestWithContext(ctx, http.MethodGet, userURL, nil)
	if err != nil {
		return Identity{}, err
	}
	ureq.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	ureq.Header.Set("Accept", "application/vnd.github+json")
	ures, err := client.Do(ureq)
	if err != nil {
		return Identity{}, fmt.Errorf("github user: %w", err)
	}
	defer ures.Body.Close()
	ubody, err := io.ReadAll(io.LimitReader(ures.Body, 1<<20))
	if err != nil {
		return Identity{}, fmt.Errorf("github user: %w", err)
	}
	var user userResponse
	if err := json.Unmarshal(ubody, &user); err != nil {
		return Identity{}, fmt.Errorf("github user: %w", err)
	}
	if strings.TrimSpace(user.Login) == "" {
		return Identity{}, fmt.Errorf("github user: missing login")
	}
	return Identity{Login: user.Login, UserID: user.ID}, nil
}
