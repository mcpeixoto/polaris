package mailer

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// SMTP delivers through a relay, over the standard library's net/smtp.
//
// net/smtp and not a dependency, on purpose. What this product sends is one small message to
// one recipient at a time, over a protocol that has not changed since 1982; the libraries
// that wrap it exist to do the parts we do not do — attachments, connection pools, provider
// APIs — and every one of them is a dependency in the process that holds the relay password.
//
// One connection per message, opened and quit. A pooled connection would save a handshake on
// a job that sends a few dozen messages an hour, and would introduce the failure where a
// relay closes an idle connection and the next digest is lost to a write on a dead socket.
type SMTP struct {
	cfg Config
}

// Send builds the message and hands it to the relay.
//
// The error it returns never names the recipient and never names the password. A delivery
// failure is logged by the job that called this, and a log line that carries an address is
// the one that ends up in a log aggregator with a much wider audience than the mailbox had.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	raw, err := Build(m, s.cfg.From, time.Now())
	if err != nil {
		return err
	}

	host := strings.TrimSpace(s.cfg.Host)
	addr := net.JoinHostPort(host, strconv.Itoa(s.cfg.Port))

	// The context bounds the dial; the deadline bounds everything after it. Without the
	// second, a relay that completes the TCP handshake and then goes quiet holds this
	// goroutine for as long as the kernel's keepalive allows, which is measured in hours.
	d := net.Dialer{Timeout: s.cfg.Timeout}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("mail: dial relay %s: %w", addr, err)
	}
	defer func() { _ = conn.Close() }()

	deadline := time.Now().Add(s.cfg.Timeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return fmt.Errorf("mail: set deadline: %w", err)
	}

	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("mail: greet relay: %w", err)
	}
	defer func() { _ = c.Close() }()

	// EHLO with the sender's own domain rather than net/smtp's default of "localhost".
	// Relays that check the EHLO name against the envelope sender — several large ones do —
	// treat a mismatch as a spam signal, and "localhost" is the mismatch they see most.
	if err := c.Hello(heloName(s.cfg.From.Email)); err != nil {
		return fmt.Errorf("mail: EHLO: %w", err)
	}

	// STARTTLS whenever the relay offers it, which is every relay worth using. It is not
	// optional when credentials are configured: sending a password in the clear to something
	// that claims not to support encryption is precisely the downgrade an attacker on the
	// path would arrange, and the honest answer is to refuse rather than to leak.
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(s.tlsConfig(host)); err != nil {
			return fmt.Errorf("mail: STARTTLS: %w", err)
		}
	} else if s.cfg.Username != "" {
		return errors.New("mail: the relay does not offer STARTTLS and credentials are configured; refusing to send a password in the clear")
	}

	// Authentication is optional. A self-hosted install commonly relays through a postfix
	// bound to 127.0.0.1 that accepts anything from the machine it runs on, and requiring a
	// username there would mean inventing one.
	if s.cfg.Username != "" {
		if ok, _ := c.Extension("AUTH"); !ok {
			return errors.New("mail: credentials are configured but the relay does not offer AUTH")
		}
		if err := c.Auth(smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, host)); err != nil {
			// Wrapped without the credential. net/smtp's own error text carries the server's
			// reply, which says "authentication failed" and not what was sent, but the
			// password is in scope here and this is the line where somebody would eventually
			// add it "for debugging".
			return fmt.Errorf("mail: authenticate to relay: %w", err)
		}
	}

	if err := c.Mail(s.cfg.From.Email); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(m.To.Email); err != nil {
		// Deliberately not "%s: %w" with the address. A refused recipient is the error most
		// likely to be logged verbatim, and an address in a log is the one piece of personal
		// data this package handles.
		return fmt.Errorf("mail: the relay refused the recipient: %w", err)
	}

	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("mail: write message: %w", err)
	}
	// The close is the send: this is where the relay accepts or rejects, so its error is the
	// one that decides whether the message exists.
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: the relay rejected the message: %w", err)
	}
	return c.Quit()
}

// tlsConfig verifies the relay's certificate, except on a loopback address.
//
// Verification on loopback is a check with nothing behind it: a certificate proves that the
// host at the other end is the one named, and on 127.0.0.1 the host at the other end is this
// machine — anybody able to intercept that already has the process's memory, the relay
// password included. The common self-hosted setup is a local postfix with a self-signed
// certificate, and failing it would leave that install with a choice between no mail and a
// configuration flag nobody can evaluate the safety of.
func (s *SMTP) tlsConfig(host string) *tls.Config {
	return &tls.Config{
		ServerName:         host,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: isLoopback(host),
	}
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// heloName is the domain the sender claims to be, taken from the From address.
func heloName(from string) string {
	if at := strings.LastIndex(from, "@"); at >= 0 && at+1 < len(from) {
		if domain := strings.TrimSpace(from[at+1:]); domain != "" {
			return domain
		}
	}
	return "localhost"
}
