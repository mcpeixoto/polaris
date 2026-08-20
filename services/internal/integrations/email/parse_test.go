package email_test

import (
	"testing"

	inboundemail "github.com/peixotolabs/polaris/services/internal/integrations/email"
)

func TestParse_JSONStub(t *testing.T) {
	got, err := inboundemail.Parse([]byte(`{
		"to": "abc@inbound.example",
		"from": "Ada <ada@example.com>",
		"subject": "The roof leaks",
		"text": "Please look.",
		"messageId": "<1@example.com>",
		"attachments": [{"url": "https://files.example/shot.png", "title": "Screenshot"}]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if got.To != "abc@inbound.example" || got.Subject != "The roof leaks" {
		t.Fatalf("got %+v", got)
	}
	if len(got.Attachments) != 1 || got.Attachments[0].URL != "https://files.example/shot.png" {
		t.Fatalf("attachments = %+v", got.Attachments)
	}
}

func TestParse_RequiresTo(t *testing.T) {
	if _, err := inboundemail.Parse([]byte(`{"subject":"x"}`)); err == nil {
		t.Fatal("missing to must fail")
	}
}
