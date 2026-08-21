package slack

import (
	"net/url"
	"strings"
)

// Slash is a Slack slash-command POST (application/x-www-form-urlencoded).
type Slash struct {
	Command     string
	Text        string
	UserName    string
	UserID      string
	ChannelName string
	ChannelID   string
	TeamID      string
	ResponseURL string
}

func ParseSlash(form url.Values) Slash {
	return Slash{
		Command:     strings.TrimSpace(form.Get("command")),
		Text:        strings.TrimSpace(form.Get("text")),
		UserName:    strings.TrimSpace(form.Get("user_name")),
		UserID:      strings.TrimSpace(form.Get("user_id")),
		ChannelName: strings.TrimSpace(form.Get("channel_name")),
		ChannelID:   strings.TrimSpace(form.Get("channel_id")),
		TeamID:      strings.TrimSpace(form.Get("team_id")),
		ResponseURL: strings.TrimSpace(form.Get("response_url")),
	}
}

// Kind is what the slash text asked for.
type Kind string

const (
	KindHelp    Kind = "help"
	KindCreate  Kind = "create"
	KindAsk     Kind = "ask"
	KindComment Kind = "comment"
	KindShow    Kind = "show"
)

// Parsed is the slash text after the verb is split off.
type Parsed struct {
	Kind       Kind
	Title      string
	Identifier string
	Body       string
}

// ParseText reads `/polaris …` text. Magic words are applied later in domain.
func ParseText(text string) Parsed {
	s := strings.TrimSpace(text)
	if s == "" || strings.EqualFold(s, "help") {
		return Parsed{Kind: KindHelp}
	}
	verb, rest, _ := strings.Cut(s, " ")
	rest = strings.TrimSpace(rest)
	switch strings.ToLower(verb) {
	case "help":
		return Parsed{Kind: KindHelp}
	case "ask", "asks":
		if rest == "" {
			return Parsed{Kind: KindHelp}
		}
		return Parsed{Kind: KindAsk, Title: rest}
	case "create", "new":
		if rest == "" {
			return Parsed{Kind: KindHelp}
		}
		return Parsed{Kind: KindCreate, Title: rest}
	case "comment", "c":
		id, body, ok := strings.Cut(rest, " ")
		if !ok || !looksLikeID(id) || strings.TrimSpace(body) == "" {
			return Parsed{Kind: KindHelp}
		}
		return Parsed{Kind: KindComment, Identifier: strings.ToUpper(id), Body: strings.TrimSpace(body)}
	}
	if looksLikeID(verb) {
		if rest == "" {
			return Parsed{Kind: KindShow, Identifier: strings.ToUpper(verb)}
		}
		sub, body, _ := strings.Cut(rest, " ")
		if strings.EqualFold(sub, "comment") || strings.EqualFold(sub, "c") {
			if strings.TrimSpace(body) == "" {
				return Parsed{Kind: KindHelp}
			}
			return Parsed{Kind: KindComment, Identifier: strings.ToUpper(verb), Body: strings.TrimSpace(body)}
		}
		return Parsed{Kind: KindComment, Identifier: strings.ToUpper(verb), Body: rest}
	}
	// Bare text creates an issue, matching how people already type in Slack.
	return Parsed{Kind: KindCreate, Title: s}
}

func looksLikeID(s string) bool {
	s = strings.TrimSpace(s)
	i := strings.LastIndex(s, "-")
	if i <= 0 || i == len(s)-1 {
		return false
	}
	key := s[:i]
	num := s[i+1:]
	if key == "" || num == "" {
		return false
	}
	for _, r := range key {
		if (r < 'A' || r > 'Z') && (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return false
		}
	}
	for _, r := range num {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// IsAsksCommand is the dedicated Slack slash that always files an Ask, not a
// regular issue. `/polaris ask` is parsed from the text instead.
func IsAsksCommand(command string) bool {
	switch strings.ToLower(strings.TrimSpace(command)) {
	case "/asks", "/ask":
		return true
	default:
		return false
	}
}
