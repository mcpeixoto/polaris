package slack

import (
	"encoding/json"
	"strings"
)

// EventEnvelope is a Slack Events API POST.
type EventEnvelope struct {
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
	Event     Event  `json:"event"`
}

type Event struct {
	Type      string `json:"type"`
	Channel   string `json:"channel"`
	User      string `json:"user"`
	Text      string `json:"text"`
	Timestamp string `json:"ts"`
	BotID     string `json:"bot_id"`
	MessageTS string `json:"message_ts"`
	Links     []Link `json:"links"`
}

type Link struct {
	URL    string `json:"url"`
	Domain string `json:"domain"`
}

func ParseEvent(body []byte) (EventEnvelope, error) {
	var env EventEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return EventEnvelope{}, err
	}
	return env, nil
}

func (e Event) FromBot() bool {
	return strings.TrimSpace(e.BotID) != ""
}

// UnfurlCard is one chat.unfurl attachment, kept to Slack's documented subset.
type UnfurlCard struct {
	Color     string `json:"color"`
	Title     string `json:"title"`
	TitleLink string `json:"title_link"`
	Text      string `json:"text,omitempty"`
}

type UnfurlRequest struct {
	Channel string                `json:"channel"`
	TS      string                `json:"ts"`
	Unfurls map[string]UnfurlCard `json:"unfurls"`
}

func EncodeUnfurl(channel, ts string, cards map[string]UnfurlCard) ([]byte, error) {
	return json.Marshal(UnfurlRequest{Channel: channel, TS: ts, Unfurls: cards})
}
