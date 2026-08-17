// Package mailer sends the product's outbound email.
//
// It is deliberately small and deliberately ignorant. It knows how to turn a subject and
// two bodies into a well-formed RFC 5322 message and how to hand that to a relay; it knows
// nothing about issues, workspaces or the database, and it must not learn — a mail package
// that can query is one that will eventually be asked to decide who gets mail, which is a
// decision that belongs where the notification rules already live.
// scripts/lint-imports.sh enforces the half of that it can (no internal/store); the rest is
// this comment and the absence of a *store.DB in any signature here.
//
// Mail is optional. A self-hosted Polaris with no relay configured is a supported, common
// and perfectly good installation — see docs/05-infrastructure/10-self-host-and-cloud.md,
// where requiring SMTP before first login is named as the most common way self-host
// onboarding fails. With no host configured, New returns a Mailer that accepts everything
// and sends nothing, and Config.Enabled reports it so the caller can say so once at startup
// instead of failing a job every hour.
//
// Nothing here logs. The only two values it handles that must never reach a log line at
// info level are the recipient's address and the relay password, and the surest way to keep
// both out of the log is for the package that holds them to have no logger at all.
package mailer

import (
	"context"
	"fmt"
	"net/mail"
	"strings"
	"sync"
	"time"
)

// Mailer is one message to one person.
//
// One recipient per call, with no Bcc and no batch form, and that is a product decision
// rather than a simplification: every message this product sends is somebody's own digest,
// naming their own issues. A batch interface would make it possible to write a caller that
// hands the same body to fifty addresses, and the first bug in it puts one person's inbox in
// front of the other forty-nine.
type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// Both implementations, stated here so that a change to the interface fails in this file
// rather than at whichever call site happens to be compiled first.
var (
	_ Mailer = (*SMTP)(nil)
	_ Mailer = (*Recorder)(nil)
)

// Address is a person and the mailbox they read.
type Address struct {
	// Name is what a mail client shows instead of the address. May be empty, and may be
	// anything a person typed into their profile — it is RFC 2047-encoded on the way out.
	Name  string
	Email string
}

func (a Address) String() string {
	// net/mail owns the encoding rules: quoting a display name with a comma in it, and
	// switching to an encoded-word when it is not ASCII. Hand-rolling that is how a name
	// with an accent in it turns into a message some clients refuse to display.
	return (&mail.Address{Name: a.Name, Address: a.Email}).String()
}

// Message is one email, with both bodies.
//
// Both, always: a plain-text alternative is not a courtesy to people with text-only clients,
// it is what stops a message being scored as spam, and it is the version that survives every
// client that strips HTML for security. Building only one and letting the other be generated
// from it produces the worst of both.
type Message struct {
	To      Address
	Subject string
	Text    string
	HTML    string

	// Unsubscribe is the URL a mail client puts behind its own unsubscribe button, sent as
	// List-Unsubscribe. A bulk message without one is scored as spam by every large provider,
	// and — the reason that scoring exists — a recurring message somebody cannot turn off
	// from the message itself is one they can only escape by marking it as spam.
	//
	// No List-Unsubscribe-Post is sent alongside it, deliberately. That header promises
	// one-click unsubscription: the provider POSTs to the URL and the sender is obliged to
	// stop. Promising that without an endpoint that honours it is worse than not promising
	// it, because the provider stops showing its own confirmation dialog and the user
	// believes they have unsubscribed.
	Unsubscribe string
}

// Config is what a relay needs, mirroring the mail fields of platform.Config.
//
// A separate struct for the reason store.PoolConfig is one: this package does not import
// platform, so that platform stays a leaf and this package stays testable without an
// environment.
type Config struct {
	// Host empty means no mail. Every other field is ignored in that case, so a half-filled
	// configuration cannot half-enable delivery.
	Host string
	Port int

	// Username and Password are optional. A self-hosted install frequently has an open relay
	// on localhost — a postfix listening on 127.0.0.1 that accepts anything from the host it
	// runs on — and demanding credentials there would mean inventing some.
	Username string
	Password string

	// From is the envelope sender and the From header. Its domain also becomes the
	// Message-ID's domain and the EHLO name, so it should be a domain this install actually
	// sends as; SPF and DKIM are checked against it, and a From that does not match is the
	// difference between the inbox and the spam folder.
	From Address

	// Timeout bounds one delivery, dialling to QUIT. A relay that accepts a connection and
	// then stops answering is the normal failure, and without a deadline it holds a worker
	// goroutine until the process restarts.
	Timeout time.Duration
}

// Enabled reports whether mail is configured at all.
func (c Config) Enabled() bool { return strings.TrimSpace(c.Host) != "" }

// New returns the Mailer this configuration describes: a real SMTP client when a host is
// set, and a Mailer that quietly accepts and drops everything when one is not.
//
// It never returns an error for "mail is switched off", because that is not an error — it is
// the default state of a fresh self-hosted install and it has to stay a supported one. It
// does return one for a configuration that is switched on and unusable, which is the case
// worth failing a process start over.
func New(c Config) (Mailer, error) {
	if !c.Enabled() {
		return Discard(), nil
	}
	if _, err := mail.ParseAddress(c.From.Email); err != nil {
		return nil, fmt.Errorf("mail from address %q is not a valid address: %w", c.From.Email, err)
	}
	if c.Port <= 0 || c.Port > 65535 {
		return nil, fmt.Errorf("smtp port %d is out of range", c.Port)
	}
	if c.Timeout <= 0 {
		c.Timeout = 30 * time.Second
	}
	return &SMTP{cfg: c}, nil
}

// Recorder is the Mailer for tests, and — with keep off — for an install with no relay.
//
// One type for both because they are the same behaviour with the memory turned off, and two
// types would mean the no-mail path in production is not the path any test exercises.
type Recorder struct {
	mu   sync.Mutex
	keep bool
	sent []Message
	// count is kept even when the messages are not, so an install with mail switched off can
	// still answer "did anything try to send".
	count int
	// Err, when set, is returned by every Send. It is how a test makes a relay refuse.
	Err error
}

// NewRecorder returns a Recorder that keeps every message for inspection.
func NewRecorder() *Recorder { return &Recorder{keep: true} }

// Discard returns a Recorder that counts messages and keeps none. It is what New returns
// when no relay is configured: sending is a no-op rather than an error, so every caller
// above works identically whether or not the install has mail.
func Discard() *Recorder { return &Recorder{} }

func (r *Recorder) Send(_ context.Context, m Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Err != nil {
		return r.Err
	}
	r.count++
	if r.keep {
		r.sent = append(r.sent, m)
	}
	return nil
}

// Sent returns a copy of what was recorded, so a test reading it cannot race with a job
// still sending.
func (r *Recorder) Sent() []Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Message(nil), r.sent...)
}

// Count is how many messages were accepted, whether or not they were kept.
func (r *Recorder) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count
}
