package slack

import "strings"

const ticketEmoji = "🎫"

// TicketAsk reports whether a Slack message is an Ask: it starts with 🎫.
// The rest of the first line is the title; further lines are the body.
func TicketAsk(text string) (title, body string, ok bool) {
	s := strings.TrimSpace(text)
	if !strings.HasPrefix(s, ticketEmoji) {
		return "", "", false
	}
	rest := strings.TrimSpace(strings.TrimPrefix(s, ticketEmoji))
	if rest == "" {
		return "Ask from Slack", "", true
	}
	title, extra, found := strings.Cut(rest, "\n")
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Ask from Slack"
	}
	if found {
		body = strings.TrimSpace(extra)
	}
	return title, body, true
}
