// Package push sends inbox-class alerts to Apple Push Notification service.
//
// It is deliberately small and deliberately ignorant. It knows how to mint an APNs JWT,
// hand a payload to Apple's HTTP/2 gateway, and classify the response; it knows nothing
// about issues, workspaces or the database. scripts/lint-imports.sh enforces the half of
// that it can (no internal/store).
//
// Push is optional. A self-hosted Polaris with no APNs key configured is a supported
// installation — New returns a Sender that accepts everything and sends nothing, and
// Config.Enabled reports it so the worker can say so once at startup instead of failing
// a job every minute.
package push

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Sender is one alert to one device token.
type Sender interface {
	Send(ctx context.Context, n Notification) Result
}

// Both implementations, stated here so a change to the interface fails in this file.
var (
	_ Sender = (*APNs)(nil)
	_ Sender = (*Recorder)(nil)
	_ Sender = (*Nop)(nil)
)

// Environment picks the APNs host. A Debug iOS build registers sandbox tokens; TestFlight
// and App Store builds register production ones. Mixing them fails permanently.
type Environment string

const (
	Production Environment = "production"
	Sandbox    Environment = "sandbox"
)

// Notification is one APNs alert.
type Notification struct {
	Token       string
	Environment Environment
	Topic       string // bundle id
	Title       string
	Body        string
	Badge       *int
	// CollapseID replaces an earlier undelivered notification with the same id on the device.
	CollapseID string
	// ThreadID groups notifications in Notification Center.
	ThreadID string
	// Data is under the custom "polaris" key so the app can deep-link without parsing the body.
	Data map[string]string
}

// Result is what APNs answered.
type Result struct {
	// Status is the HTTP status, or 0 when the request never left.
	Status int
	// Reason is APNs' reason string when Status is not 200.
	Reason string
	// Err is a transport or configuration failure. A 410/Unregistered is not Err — it is
	// Status+Reason, so the caller can delete the token without treating Apple as down.
	Err error
}

// Unregistered reports a token Apple will never accept again.
func (r Result) Unregistered() bool {
	if r.Status == http.StatusGone {
		return true
	}
	switch r.Reason {
	case "BadDeviceToken", "Unregistered", "ExpiredToken", "DeviceTokenNotForTopic":
		return true
	}
	return false
}

// Config is what token-based APNs auth needs.
type Config struct {
	KeyID   string
	TeamID  string
	KeyPEM  string
	Bundle  string
	// HTTPClient overrides the default; tests inject a stub transport.
	HTTPClient *http.Client
}

// Enabled is true when every credential needed to talk to APNs is present.
func (c Config) Enabled() bool {
	return strings.TrimSpace(c.KeyID) != "" &&
		strings.TrimSpace(c.TeamID) != "" &&
		strings.TrimSpace(c.KeyPEM) != ""
}

// New returns a live APNs client, or a no-op Sender when credentials are absent.
func New(cfg Config) (Sender, error) {
	if !cfg.Enabled() {
		return Nop{}, nil
	}
	key, err := parseECPrivateKey(cfg.KeyPEM)
	if err != nil {
		return nil, fmt.Errorf("apns key: %w", err)
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &APNs{
		keyID:  strings.TrimSpace(cfg.KeyID),
		teamID: strings.TrimSpace(cfg.TeamID),
		key:    key,
		bundle: strings.TrimSpace(cfg.Bundle),
		http:   client,
	}, nil
}

// APNs talks to api.push.apple.com / api.sandbox.push.apple.com with a provider token.
type APNs struct {
	keyID  string
	teamID string
	key    *ecdsa.PrivateKey
	bundle string
	http   *http.Client

	mu    sync.Mutex
	token string
	exp   time.Time
}

func (a *APNs) Send(ctx context.Context, n Notification) Result {
	if strings.TrimSpace(n.Token) == "" {
		return Result{Err: fmt.Errorf("apns: empty device token")}
	}
	topic := n.Topic
	if topic == "" {
		topic = a.bundle
	}
	if topic == "" {
		return Result{Err: fmt.Errorf("apns: empty topic")}
	}

	bearer, err := a.bearer()
	if err != nil {
		return Result{Err: err}
	}

	payload := map[string]any{
		"aps": map[string]any{
			"alert": map[string]string{
				"title": n.Title,
				"body":  n.Body,
			},
			"sound": "default",
		},
	}
	if n.Badge != nil {
		payload["aps"].(map[string]any)["badge"] = *n.Badge
	}
	if n.ThreadID != "" {
		payload["aps"].(map[string]any)["thread-id"] = n.ThreadID
	}
	if len(n.Data) > 0 {
		payload["polaris"] = n.Data
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return Result{Err: err}
	}

	host := "https://api.push.apple.com"
	if n.Environment == Sandbox {
		host = "https://api.sandbox.push.apple.com"
	}
	url := host + "/3/device/" + n.Token
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return Result{Err: err}
	}
	req.Header.Set("authorization", "bearer "+bearer)
	req.Header.Set("apns-topic", topic)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	if n.CollapseID != "" {
		req.Header.Set("apns-collapse-id", n.CollapseID)
	}
	req.Header.Set("content-type", "application/json")

	res, err := a.http.Do(req)
	if err != nil {
		return Result{Err: err}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	reason := ""
	if len(raw) > 0 {
		var parsed struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(raw, &parsed)
		reason = parsed.Reason
	}
	return Result{Status: res.StatusCode, Reason: reason}
}

func (a *APNs) bearer() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	// Apple accepts tokens for up to an hour; refresh a little early.
	if a.token != "" && now.Before(a.exp.Add(-60*time.Second)) {
		return a.token, nil
	}
	claims := jwt.MapClaims{
		"iss": a.teamID,
		"iat": now.Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["kid"] = a.keyID
	signed, err := tok.SignedString(a.key)
	if err != nil {
		return "", fmt.Errorf("apns jwt: %w", err)
	}
	a.token = signed
	a.exp = now.Add(50 * time.Minute)
	return signed, nil
}

func parseECPrivateKey(pemBytes string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemBytes))
	if block == nil {
		return nil, fmt.Errorf("no PEM block")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		ec, ok := key.(*ecdsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("not an EC private key")
		}
		return ec, nil
	}
	return x509.ParseECPrivateKey(block.Bytes)
}

// Nop accepts every send and delivers nothing. Used when APNs is not configured.
type Nop struct{}

func (Nop) Send(context.Context, Notification) Result { return Result{Status: http.StatusOK} }

// Recorder records every send for tests.
type Recorder struct {
	mu   sync.Mutex
	Sent []Notification
	Next Result
}

func (r *Recorder) Send(_ context.Context, n Notification) Result {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Sent = append(r.Sent, n)
	if r.Next.Status != 0 || r.Next.Err != nil || r.Next.Reason != "" {
		return r.Next
	}
	return Result{Status: http.StatusOK}
}

func (r *Recorder) Reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Sent = nil
	r.Next = Result{}
}
