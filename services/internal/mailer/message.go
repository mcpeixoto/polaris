package mailer

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"
	"time"
)

// Build renders one message as the bytes an SMTP DATA command carries.
//
// Separate from sending, and exported, because the interesting failures of an email are all
// in this function and none of them are in the socket. A message with an unencoded subject,
// a missing Date or a mislabelled part is accepted by every relay and then rendered wrongly,
// or filed as spam, by the client — a failure that never appears in any log this product
// keeps. Being a pure function of its inputs is what lets the test parse its own output back
// with net/mail and mime/multipart and assert on the structure rather than on a substring.
//
// What every header here is for:
//
//	From, To          who it is from and who it is to, RFC 2047-encoded display names.
//	Subject           RFC 2047-encoded when it is not ASCII, which for this product is
//	                  routine: workspace names and issue titles are European and frequently
//	                  accented, and an unencoded 8-bit subject is mangled or dropped.
//	Date              required by RFC 5322. Without it clients sort the message to the
//	                  beginning or the end of the mailbox, and some relays add their own.
//	Message-ID        required in practice rather than by the RFC: it is what threads a
//	                  conversation, what deduplicates a retried delivery, and what a bounce
//	                  refers back to.
//	MIME-Version      the marker that makes everything below it MIME and not a flat body.
//	Content-Type      multipart/alternative: the same message twice, plain text first and
//	                  HTML second, because a client is required to render the last part it
//	                  understands and preferring HTML is the point of the ordering.
//	List-Unsubscribe  see Message.Unsubscribe.
//	Auto-Submitted    RFC 3834. It is what stops an out-of-office reply to a digest, and
//	                  therefore what stops two systems replying to each other all week.
func Build(m Message, from Address, now time.Time) ([]byte, error) {
	if _, err := mail.ParseAddress(from.Email); err != nil {
		return nil, fmt.Errorf("from address: %w", err)
	}
	if _, err := mail.ParseAddress(m.To.Email); err != nil {
		return nil, fmt.Errorf("recipient address: %w", err)
	}
	// Header injection. Everything below reaches a header, and a subject or a display name
	// carrying a newline can append headers of its own — a Bcc, a second To — which is a
	// workspace name away from being reachable by anybody who can create a workspace.
	// Rejecting is right rather than stripping: a name with a control character in it is not
	// something the sender meant, so silently sending a different message than the one asked
	// for is the wrong repair.
	for _, s := range []string{m.Subject, m.To.Name, from.Name, m.Unsubscribe} {
		if strings.ContainsAny(s, "\r\n") {
			return nil, errors.New("mail: a header value contains a line break")
		}
	}
	if strings.TrimSpace(m.Subject) == "" {
		return nil, errors.New("mail: a message needs a subject")
	}
	if m.Text == "" || m.HTML == "" {
		// Both or neither. A message with only one of them is either unreadable in a
		// text-only client or scored as spam for being HTML-only, and the caller that omitted
		// one has almost always forgotten rather than decided.
		return nil, errors.New("mail: a message needs both a text and an HTML body")
	}

	boundary, err := randomToken(16)
	if err != nil {
		return nil, err
	}
	messageID, err := newMessageID(from.Email)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	header := func(k, v string) {
		// CRLF, not LF. SMTP's line terminator is CRLF and a bare LF is what makes a message
		// arrive with its headers folded into the body on the one relay that is strict.
		buf.WriteString(k + ": " + v + "\r\n")
	}

	header("From", from.String())
	header("To", m.To.String())
	// Encode returns the string unchanged when it is plain ASCII, so an English subject stays
	// readable in the raw message and only the ones that need it are encoded.
	header("Subject", mime.QEncoding.Encode("utf-8", m.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", messageID)
	header("MIME-Version", "1.0")
	if m.Unsubscribe != "" {
		header("List-Unsubscribe", "<"+m.Unsubscribe+">")
	}
	header("Auto-Submitted", "auto-generated")
	header("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	buf.WriteString("\r\n")

	mw := multipart.NewWriter(&buf)
	if err := mw.SetBoundary(boundary); err != nil {
		return nil, err
	}
	// Plain text first. RFC 2046 says a client should render the *last* alternative it can
	// handle, so this order is what makes the HTML the preferred form rather than the
	// fallback — reversing it silently downgrades everybody to plain text.
	if err := writePart(mw, "text/plain; charset=UTF-8", m.Text); err != nil {
		return nil, err
	}
	if err := writePart(mw, "text/html; charset=UTF-8", m.HTML); err != nil {
		return nil, err
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// writePart writes one alternative, quoted-printable encoded.
//
// Quoted-printable rather than raw 8-bit, because SMTP guarantees only 7-bit transport with
// lines under 1000 octets. An accented issue title is 8-bit and a pasted URL is easily longer
// than that, and a relay that does not advertise 8BITMIME may fold or mangle either. It also
// keeps the message readable in the raw, unlike base64, which matters the day somebody has to
// debug a delivery from a mail log.
func writePart(mw *multipart.Writer, contentType, body string) error {
	h := textproto.MIMEHeader{}
	h.Set("Content-Type", contentType)
	h.Set("Content-Transfer-Encoding", "quoted-printable")

	w, err := mw.CreatePart(h)
	if err != nil {
		return err
	}
	qp := quotedprintable.NewWriter(w)
	if _, err := qp.Write([]byte(body)); err != nil {
		return err
	}
	return qp.Close()
}

// newMessageID mints a globally unique id in the sender's own domain.
//
// The domain must be one this install owns, which is why it comes from the From address
// rather than from the machine's hostname: a container's hostname is a random hex string
// that resolves nowhere, and some filters treat a Message-ID whose domain does not exist as
// a signal in itself.
func newMessageID(from string) (string, error) {
	domain := "localhost"
	if at := strings.LastIndex(from, "@"); at >= 0 && at+1 < len(from) {
		domain = from[at+1:]
	}
	token, err := randomToken(16)
	if err != nil {
		return "", err
	}
	return "<" + token + "@" + domain + ">", nil
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("mail: random: %w", err)
	}
	return hex.EncodeToString(b), nil
}
