// Package email parses inbound mail-provider JSON into domain input.
//
// It calls nothing in store: the HTTP layer authenticates, this package turns the JSON
// into domain input, and domain creates the issue. That split is what keeps an
// email-created issue on the same path as one created from GraphQL.
package email

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

type payload struct {
	To          string `json:"to"`
	From        string `json:"from"`
	Subject     string `json:"subject"`
	Text        string `json:"text"`
	HTML        string `json:"html"`
	MessageID   string `json:"messageId"`
	InReplyTo   string `json:"inReplyTo"`
	References  string `json:"references"`
	Attachments []struct {
		URL   string `json:"url"`
		Title string `json:"title"`
	} `json:"attachments"`
}

// Parse reads the JSON stub a mail provider (or `curl` in development) POSTs.
func Parse(body []byte) (domain.InboundEmail, error) {
	var raw payload
	if err := json.Unmarshal(body, &raw); err != nil {
		return domain.InboundEmail{}, fmt.Errorf("inbound email: %w", err)
	}
	if strings.TrimSpace(raw.To) == "" {
		return domain.InboundEmail{}, fmt.Errorf("inbound email: missing to")
	}
	out := domain.InboundEmail{
		To:         strings.TrimSpace(raw.To),
		From:       strings.TrimSpace(raw.From),
		Subject:    raw.Subject,
		Text:       raw.Text,
		HTML:       raw.HTML,
		MessageID:  strings.TrimSpace(raw.MessageID),
		InReplyTo:  strings.TrimSpace(raw.InReplyTo),
		References: strings.TrimSpace(raw.References),
	}
	for _, a := range raw.Attachments {
		if strings.TrimSpace(a.URL) == "" {
			continue
		}
		out.Attachments = append(out.Attachments, domain.InboundEmailLink{
			URL:   strings.TrimSpace(a.URL),
			Title: strings.TrimSpace(a.Title),
		})
	}
	return out, nil
}
