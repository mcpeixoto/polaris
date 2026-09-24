// Package push delivers a Web Push message to one browser.
//
// It knows nothing about issues. The domain layer decides what the message says and which
// device it is for; this package signs it and hands it to the push service. That split is
// the same one mailer has with the digest: wording is a product decision, and the protocol
// is not.
package push

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/SherClockHolmes/webpush-go"
)

// Subscription is one browser's push endpoint and the keys that encrypt for it.
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Config is the install's VAPID identity. Both keys are required; a process with neither
// does not construct a Sender.
type Config struct {
	PublicKey  string
	PrivateKey string
	// Subject is the contact the push service requires, a mailto: or https: URL.
	Subject string
	Timeout time.Duration
}

// Sender signs and delivers one message.
type Sender struct {
	public  string
	private string
	subject string
	client  *http.Client
}

// New builds a sender. The keys are checked by platform.LoadConfig before this is called;
// New still refuses an empty pair, because a sender that cannot sign would report success
// until the first phone.
func New(cfg Config) (*Sender, error) {
	if cfg.PublicKey == "" || cfg.PrivateKey == "" {
		return nil, errors.New("push: VAPID keys are required")
	}
	if cfg.Subject == "" {
		return nil, errors.New("push: VAPID subject is required")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Sender{
		public:  cfg.PublicKey,
		private: cfg.PrivateKey,
		subject: cfg.Subject,
		client:  &http.Client{Timeout: timeout},
	}, nil
}

// ErrGone means the push service no longer has this device. The subscription should be
// deleted; retrying it will get the same answer.
var ErrGone = errors.New("push subscription gone")

// IsGone reports whether err is ErrGone.
func IsGone(err error) bool { return errors.Is(err, ErrGone) }

// Send delivers payload to one device.
//
// A 404 or 410 is ErrGone. Anything else the service refuses, and any transport failure,
// is returned as-is so the caller can release its claim and try the row again. The body
// is limited: a push service's error page is not something to log in full.
func (s *Sender) Send(ctx context.Context, sub Subscription, payload []byte) error {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient:      s.client,
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.public,
		VAPIDPrivateKey: s.private,
		TTL:             24 * 60 * 60,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// Drain a bounded amount so the connection can be reused, and so a refusal has a
	// reason that fits in a log line.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent:
		return nil
	case http.StatusNotFound, http.StatusGone:
		return ErrGone
	default:
		return fmt.Errorf("push: %s: %s", resp.Status, body)
	}
}
