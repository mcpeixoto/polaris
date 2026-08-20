package slack

import (
	"testing"
)

func TestParseEvent_URLVerification(t *testing.T) {
	t.Parallel()
	env, err := ParseEvent([]byte(`{"type":"url_verification","challenge":"abc"}`))
	if err != nil {
		t.Fatal(err)
	}
	if env.Type != "url_verification" || env.Challenge != "abc" {
		t.Fatalf("%+v", env)
	}
}

func TestParseEvent_LinkShared(t *testing.T) {
	t.Parallel()
	env, err := ParseEvent([]byte(`{
		"type":"event_callback",
		"event":{
			"type":"link_shared",
			"channel":"C1",
			"message_ts":"123.456",
			"links":[{"url":"https://polaris.example/issue/ENG-9","domain":"polaris.example"}]
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if env.Event.Type != "link_shared" || len(env.Event.Links) != 1 {
		t.Fatalf("%+v", env.Event)
	}
}

func TestEventFromBot(t *testing.T) {
	t.Parallel()
	if (Event{BotID: "B1"}).FromBot() != true {
		t.Fatal("a bot_id must mark the event as from a bot")
	}
	if (Event{}).FromBot() {
		t.Fatal("a human message has no bot_id")
	}
}
