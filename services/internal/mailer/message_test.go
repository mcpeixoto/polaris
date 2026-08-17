package mailer_test

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/mailer"
)

// What a message is, asserted by parsing it back rather than by looking at it.
//
// A test that checks the output contains "Subject:" proves that a string was written and
// nothing about whether any client can read it. Every failure that matters here — an 8-bit
// subject nobody encoded, a missing Date, parts in the wrong order, a body that decodes to
// something else — produces bytes that still contain every header name. So these tests hand
// the output to net/mail and mime/multipart, which are the same parsers a receiving system
// uses, and assert on what comes out the other side.

const (
	fromEmail = "notifications@polaris.example"
	toEmail   = "ada@example.org"
)

var from = mailer.Address{Name: "Polaris", Email: fromEmail}

func TestBuild_RoundTripsThroughAMailParser(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 9, 8, 30, 0, 0, time.FixedZone("CET", 3600))
	msg := mailer.Message{
		// A recipient name and a subject that are not ASCII, because that is the ordinary
		// case for this product rather than the exotic one: workspace names and issue titles
		// are European and accented, and an unencoded 8-bit header is mangled or dropped.
		To:          mailer.Address{Name: "Ada Lovelaçe", Email: toEmail},
		Subject:     "Ação: 3 issues assigned to you",
		Text:        "3 issues assigned to you\nENG-14 Fix the thing",
		HTML:        "<p>3 issues assigned to you</p>",
		Unsubscribe: "https://polaris.example/settings/notifications",
	}

	raw, err := mailer.Build(msg, from, now)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	parsed, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("the message does not parse as RFC 5322: %v\n%s", err, raw)
	}
	h := parsed.Header

	// From and To, as addresses rather than as strings. A display name with an accent has to
	// survive being encoded on the way out and decoded on the way back in.
	assertAddress(t, "From", h.Get("From"), "Polaris", fromEmail)
	assertAddress(t, "To", h.Get("To"), "Ada Lovelaçe", toEmail)

	// The subject must be RFC 2047-encoded, which means two things and both are asserted:
	// the bytes on the wire are ASCII, and decoding them gives back exactly what was asked
	// for. Checking only the second would pass for a raw 8-bit header.
	rawSubject := h.Get("Subject")
	if !isASCII(rawSubject) {
		t.Errorf("the subject reached the wire unencoded: %q", rawSubject)
	}
	decoded, err := new(mime.WordDecoder).DecodeHeader(rawSubject)
	if err != nil {
		t.Fatalf("decode subject: %v", err)
	}
	if decoded != msg.Subject {
		t.Errorf("subject decoded to %q, want %q", decoded, msg.Subject)
	}

	// Date. Without one, clients sort the message to one end of the mailbox and some relays
	// stamp their own.
	date, err := h.Date()
	if err != nil {
		t.Fatalf("Date does not parse: %v", err)
	}
	if !date.Equal(now.Truncate(time.Second)) {
		t.Errorf("Date is %s, want %s", date, now)
	}

	// Message-ID, in the sender's own domain: a container's hostname resolves nowhere and
	// some filters score a Message-ID whose domain does not exist.
	id := h.Get("Message-ID")
	if !strings.HasPrefix(id, "<") || !strings.HasSuffix(id, ">") {
		t.Errorf("Message-ID is not an angle-addr: %q", id)
	}
	if !strings.HasSuffix(id, "@polaris.example>") {
		t.Errorf("Message-ID %q is not in the sender's domain", id)
	}

	if got := h.Get("MIME-Version"); got != "1.0" {
		t.Errorf("MIME-Version is %q, want 1.0", got)
	}
	// A digest without List-Unsubscribe is scored as spam, and — the reason that scoring
	// exists — is a recurring message the reader can only escape by reporting it as one.
	if got := h.Get("List-Unsubscribe"); got != "<"+msg.Unsubscribe+">" {
		t.Errorf("List-Unsubscribe is %q, want it wrapped in angle brackets", got)
	}
	// No one-click promise without an endpoint that honours it: the provider would stop
	// showing its own confirmation and the reader would believe they had unsubscribed.
	if got := h.Get("List-Unsubscribe-Post"); got != "" {
		t.Errorf("List-Unsubscribe-Post is set to %q but nothing honours a one-click POST", got)
	}
	if got := h.Get("Auto-Submitted"); got != "auto-generated" {
		t.Errorf("Auto-Submitted is %q; without it an out-of-office replies to the digest", got)
	}

	// The body: two alternatives, plain text first.
	mediaType, params, err := mime.ParseMediaType(h.Get("Content-Type"))
	if err != nil {
		t.Fatalf("Content-Type does not parse: %v", err)
	}
	if mediaType != "multipart/alternative" {
		t.Fatalf("Content-Type is %s, want multipart/alternative", mediaType)
	}
	if params["boundary"] == "" {
		t.Fatal("no boundary on the Content-Type")
	}

	parts := readParts(t, parsed.Body, params["boundary"])
	if len(parts) != 2 {
		t.Fatalf("the message has %d parts, want 2", len(parts))
	}
	// RFC 2046: a client renders the last alternative it understands. Reversing this order
	// silently downgrades every HTML-capable reader to plain text.
	if got := mediaTypeOf(t, parts[0].contentType); got != "text/plain" {
		t.Errorf("the first alternative is %s, want text/plain", got)
	}
	if got := mediaTypeOf(t, parts[1].contentType); got != "text/html" {
		t.Errorf("the second alternative is %s, want text/html", got)
	}
	for i, want := range []string{msg.Text, msg.HTML} {
		// SMTP's line terminator is CRLF and quoted-printable writes it, so the decoded body
		// differs from the input by exactly that. Normalising is the assertion that nothing
		// else changed.
		if got := strings.ReplaceAll(parts[i].body, "\r\n", "\n"); got != want {
			t.Errorf("part %d decoded to %q, want %q", i, got, want)
		}
	}
}

// A long non-ASCII subject is folded across several encoded-words. It is the case that
// breaks a hand-rolled encoder, and the reason a header is built with mime rather than with
// fmt.Sprintf.
func TestBuild_FoldsALongEncodedSubject(t *testing.T) {
	t.Parallel()

	subject := "Ação: " + strings.Repeat("uma questão bastante comprida ", 8)
	raw, err := mailer.Build(mailer.Message{
		To:      mailer.Address{Email: toEmail},
		Subject: subject,
		Text:    "text",
		HTML:    "<p>html</p>",
	}, from, time.Now())
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	parsed, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got, err := new(mime.WordDecoder).DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got != subject {
		t.Errorf("a folded subject decoded to %q, want %q", got, subject)
	}
	for _, line := range strings.Split(string(raw), "\r\n") {
		// RFC 5322 caps a line at 998 octets and every relay enforces it somewhere.
		if len(line) > 998 {
			t.Fatalf("a header line is %d octets long", len(line))
		}
	}
}

// Header injection. A subject or a display name reaches a header verbatim, so a line break in
// one can append headers of its own — a Bcc, a second To — and a workspace name is a value
// anybody who can create a workspace controls.
func TestBuild_RefusesLineBreaksInHeaders(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		msg  mailer.Message
	}{
		{"subject", mailer.Message{
			To: mailer.Address{Email: toEmail}, Subject: "hello\r\nBcc: eve@example.org",
			Text: "t", HTML: "<p>h</p>",
		}},
		{"recipient name", mailer.Message{
			To:      mailer.Address{Name: "Ada\nBcc: eve@example.org", Email: toEmail},
			Subject: "hello", Text: "t", HTML: "<p>h</p>",
		}},
		{"unsubscribe url", mailer.Message{
			To: mailer.Address{Email: toEmail}, Subject: "hello",
			Text: "t", HTML: "<p>h</p>", Unsubscribe: "https://x/\r\nBcc: eve@example.org",
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := mailer.Build(tc.msg, from, time.Now()); err == nil {
				t.Fatal("a header value with a line break was accepted")
			}
		})
	}
}

func TestBuild_RefusesAnIncompleteMessage(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		msg  mailer.Message
	}{
		{"no subject", mailer.Message{To: mailer.Address{Email: toEmail}, Text: "t", HTML: "<p>h</p>"}},
		{"no recipient", mailer.Message{Subject: "s", Text: "t", HTML: "<p>h</p>"}},
		{"a nonsense recipient", mailer.Message{
			To: mailer.Address{Email: "not an address"}, Subject: "s", Text: "t", HTML: "<p>h</p>",
		}},
		// One body is either unreadable in a text-only client or scored as spam for being
		// HTML-only, and the caller that omitted one has forgotten rather than decided.
		{"no text body", mailer.Message{To: mailer.Address{Email: toEmail}, Subject: "s", HTML: "<p>h</p>"}},
		{"no html body", mailer.Message{To: mailer.Address{Email: toEmail}, Subject: "s", Text: "t"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := mailer.Build(tc.msg, from, time.Now()); err == nil {
				t.Fatal("an incomplete message was accepted")
			}
		})
	}
}

func TestBuild_OmitsListUnsubscribeWhenThereIsNothingToUnsubscribeFrom(t *testing.T) {
	t.Parallel()

	raw, err := mailer.Build(mailer.Message{
		To: mailer.Address{Email: toEmail}, Subject: "s", Text: "t", HTML: "<p>h</p>",
	}, from, time.Now())
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	parsed, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	// An empty List-Unsubscribe is worse than none: it advertises a way out and gives none.
	if got := parsed.Header.Get("List-Unsubscribe"); got != "" {
		t.Errorf("List-Unsubscribe is %q on a message that has no unsubscribe URL", got)
	}
}

// New with no host is the supported configuration of a self-hosted install, not an error.
func TestNew_WithNoRelayAcceptsAndSendsNothing(t *testing.T) {
	t.Parallel()

	cfg := mailer.Config{From: mailer.Address{Email: fromEmail}}
	if cfg.Enabled() {
		t.Fatal("a configuration with no host reports itself as enabled")
	}
	m, err := mailer.New(cfg)
	if err != nil {
		t.Fatalf("an install with no mail configured failed to start: %v", err)
	}
	if err := m.Send(t.Context(), mailer.Message{
		To: mailer.Address{Email: toEmail}, Subject: "s", Text: "t", HTML: "<p>h</p>",
	}); err != nil {
		t.Errorf("sending with no relay configured returned an error: %v", err)
	}
	if r, ok := m.(*mailer.Recorder); !ok {
		t.Errorf("expected a Recorder, got %T", m)
	} else if r.Count() != 1 {
		t.Errorf("the no-op mailer counted %d messages, want 1", r.Count())
	} else if len(r.Sent()) != 0 {
		t.Error("the no-op mailer kept a message it should have dropped")
	}
}

func TestNew_RefusesAConfigurationThatIsOnAndUnusable(t *testing.T) {
	t.Parallel()

	if _, err := mailer.New(mailer.Config{
		Host: "smtp.example", Port: 587, From: mailer.Address{Email: "not an address"},
	}); err == nil {
		t.Error("a relay configured with an unusable From address started anyway")
	}
	if _, err := mailer.New(mailer.Config{
		Host: "smtp.example", Port: 0, From: mailer.Address{Email: fromEmail},
	}); err == nil {
		t.Error("a relay configured on port 0 started anyway")
	}
}

// ---------------------------------------------------------------------------------------

type part struct {
	contentType string
	body        string
}

// readParts decodes the alternatives. mime/multipart undoes the quoted-printable encoding
// itself when a part declares it, which is the same thing a mail client does.
func readParts(t *testing.T, body io.Reader, boundary string) []part {
	t.Helper()

	mr := multipart.NewReader(body, boundary)
	var out []part
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatalf("read part: %v", err)
		}
		b, err := io.ReadAll(p)
		if err != nil {
			t.Fatalf("read part body: %v", err)
		}
		out = append(out, part{contentType: p.Header.Get("Content-Type"), body: string(b)})
	}
}

func mediaTypeOf(t *testing.T, contentType string) string {
	t.Helper()
	mt, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatalf("parse content type %q: %v", contentType, err)
	}
	// Without a charset, a client guesses, and the ones that guess wrong guess Latin-1 —
	// which is exactly the accented text this product is full of.
	if got := strings.ToUpper(params["charset"]); got != "UTF-8" {
		t.Errorf("part %s declares charset %q, want UTF-8", mt, params["charset"])
	}
	return mt
}

func assertAddress(t *testing.T, header, value, wantName, wantEmail string) {
	t.Helper()
	addr, err := mail.ParseAddress(value)
	if err != nil {
		t.Fatalf("%s does not parse as an address: %v (%q)", header, err, value)
	}
	if addr.Name != wantName {
		t.Errorf("%s display name is %q, want %q", header, addr.Name, wantName)
	}
	if addr.Address != wantEmail {
		t.Errorf("%s address is %q, want %q", header, addr.Address, wantEmail)
	}
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}
