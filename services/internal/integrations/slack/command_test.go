package slack

import (
	"net/url"
	"testing"
)

func TestParseText(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   string
		kind Kind
		id   string
		rest string
	}{
		{"", KindHelp, "", ""},
		{"help", KindHelp, "", ""},
		{"create Fix login", KindCreate, "", "Fix login"},
		{"new The title", KindCreate, "", "The title"},
		{"comment ENG-12 shipped", KindComment, "ENG-12", "shipped"},
		{"ENG-3", KindShow, "ENG-3", ""},
		{"eng-3 comment looks good", KindComment, "ENG-3", "looks good"},
		{"ENG-3 looks good", KindComment, "ENG-3", "looks good"},
		{"Fix the login", KindCreate, "", "Fix the login"},
	}
	for _, tc := range tests {
		got := ParseText(tc.in)
		if got.Kind != tc.kind {
			t.Errorf("%q: kind %s, want %s", tc.in, got.Kind, tc.kind)
		}
		switch got.Kind {
		case KindCreate:
			if got.Title != tc.rest {
				t.Errorf("%q: title %q, want %q", tc.in, got.Title, tc.rest)
			}
		case KindComment:
			if got.Identifier != tc.id || got.Body != tc.rest {
				t.Errorf("%q: comment %+v, want id=%s body=%s", tc.in, got, tc.id, tc.rest)
			}
		case KindShow:
			if got.Identifier != tc.id {
				t.Errorf("%q: show %q, want %s", tc.in, got.Identifier, tc.id)
			}
		}
	}
}

func TestParseSlash(t *testing.T) {
	t.Parallel()
	got := ParseSlash(url.Values{
		"command":      {"/polaris"},
		"text":         {"create hello"},
		"user_name":    {"ada"},
		"channel_name": {"eng"},
	})
	if got.Command != "/polaris" || got.Text != "create hello" || got.UserName != "ada" {
		t.Fatalf("slash: %+v", got)
	}
}
