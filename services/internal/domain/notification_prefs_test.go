package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"
)

// The preferences bag has one shape, and both languages have to agree on it.
//
// They did not. The client declared `muted` as an array of notification types; the server
// decoded it as `map[string]bool`. `json.Unmarshal` of `["comment"]` into a map fails, and the
// decoder is deliberately lenient — an unparseable bag mutes nothing — so muting a
// notification type silently did nothing at all.
//
// That failure is invisible by construction. It fails in the *safe* direction: the user keeps
// receiving the notification they asked not to receive, which looks exactly like the
// preference not having been saved, or like a notification they forgot they wanted. There is
// no error, no log line and no wrong value on screen to notice.
//
// A JSON bag shared across two languages has no compiler holding it together, so it needs a
// test that reads both. This is that test, and it is the same shape as the one pinning the
// sync schema version and the one pinning the GraphQL enum spellings — three instances of the
// same lesson, which is why each of them says so.
func TestNotificationPrefsMatchTheClient(t *testing.T) {
	const relative = "../../../web/src/store/types.ts"

	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// A hard failure, not a skip. A skip would be silent in CI on the day somebody moved
		// the file, which is exactly when the pin stops holding.
		t.Fatalf("cannot read the client's store types at %s: %v", relative, err)
	}

	client := interfaceKeys(t, string(source), "NotificationPrefs")
	server := jsonTagsOf(t, NotificationPrefs{})

	if len(client) == 0 {
		t.Fatalf("no `export interface NotificationPrefs` in %s — if it was renamed, this test "+
			"has to be taught the new name rather than deleted", relative)
	}

	if !equalStrings(client, server) {
		t.Fatalf(
			"the notification preferences bag has drifted.\n  client (%s): %v\n  server (NotificationPrefs): %v\n\n"+
				"A key the client writes and the server does not read is a preference that "+
				"silently does nothing, and it fails in the direction nobody reports.",
			relative, client, server,
		)
	}
}

// TestMutedTypesReadsTheClientsShape is the specific regression, spelled out.
//
// Kept separate from the key-set check above because they fail for different reasons and a
// reader should be able to tell which happened: this one is about the *shape of a value*,
// which no comparison of key names can see.
func TestMutedTypesReadsTheClientsShape(t *testing.T) {
	cases := []struct {
		name string
		bag  string
		want map[string]bool
	}{
		{
			name: "the array the client writes",
			bag:  `{"muted":["issue_status_changed","comment"]}`,
			want: map[string]bool{"issue_status_changed": true, "comment": true},
		},
		{
			name: "an empty array mutes nothing",
			bag:  `{"muted":[]}`,
			want: nil,
		},
		{
			name: "an absent key mutes nothing",
			bag:  `{"emailDigest":"weekly"}`,
			want: nil,
		},
		{
			// The shape the server used to expect. It is not accepted, deliberately: taking
			// both is how two shapes survive, and nothing has been written in this one.
			name: "the old object shape is not silently honoured",
			bag:  `{"muted":{"comment":true}}`,
			want: nil,
		},
		{
			name: "a bag that will not parse mutes nothing rather than everything",
			bag:  `{"muted":`,
			want: nil,
		},
		{
			name: "an unknown key is ignored rather than fatal",
			bag:  `{"muted":["comment"],"somethingNewer":42}`,
			want: map[string]bool{"comment": true},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mutedTypes(json.RawMessage(tc.bag))
			if len(got) != len(tc.want) {
				t.Fatalf("mutedTypes(%s) = %v, want %v", tc.bag, got, tc.want)
			}
			for key := range tc.want {
				if !got[key] {
					t.Fatalf("mutedTypes(%s) = %v, want %v", tc.bag, got, tc.want)
				}
			}
		})
	}
}

func TestEmailPrefsDefaults(t *testing.T) {
	cases := []struct {
		name        string
		bag         string
		wantCadence string
		wantPer     bool
	}{
		{"absent bag is a daily digest", ``, cadenceDaily, false},
		{"empty bag is a daily digest", `{}`, cadenceDaily, false},
		{"off is a real choice", `{"emailDigest":"off"}`, cadenceOff, false},
		{"hourly is honoured", `{"emailDigest":"hourly"}`, cadenceHourly, false},
		// A typo must not silently stop somebody's mail, which is what falling back to "off"
		// would do.
		{"an unknown cadence falls back to the default, not to off", `{"emailDigest":"fortnightly"}`, cadenceDaily, false},
		{"per-notification is opt-in", `{"emailPerNotification":true}`, cadenceDaily, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := emailPrefsOf(json.RawMessage(tc.bag))
			if got.Cadence != tc.wantCadence || got.PerNotification != tc.wantPer {
				t.Fatalf("emailPrefsOf(%q) = %+v, want cadence %q per-notification %v",
					tc.bag, got, tc.wantCadence, tc.wantPer)
			}
		})
	}
}

// interfaceKeys returns the property names of an exported TypeScript interface.
func interfaceKeys(t *testing.T, source, name string) []string {
	t.Helper()

	header := regexp.MustCompile(`export interface ` + name + `\s*\{`).FindStringIndex(source)
	if header == nil {
		return nil
	}

	body, ok := balanced(source, header[1]-1)
	if !ok {
		t.Fatalf("could not find the end of interface %s", name)
	}

	keys := regexp.MustCompile(`(?m)^\s*readonly (\w+)\??:`).FindAllStringSubmatch(body, -1)
	out := make([]string, 0, len(keys))
	for _, match := range keys {
		out = append(out, match[1])
	}
	sort.Strings(out)
	return out
}

// jsonTagsOf returns the json tag names of a struct's fields.
func jsonTagsOf(t *testing.T, v any) []string {
	t.Helper()

	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("cannot marshal %T: %v", v, err)
	}
	var bag map[string]json.RawMessage
	if err := json.Unmarshal(raw, &bag); err != nil {
		t.Fatalf("cannot read back %T: %v", v, err)
	}

	out := make([]string, 0, len(bag))
	for key := range bag {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// balanced returns the text between the brace at open and its match, exclusive.
func balanced(text string, open int) (string, bool) {
	depth := 0
	for i := open; i < len(text); i++ {
		switch text[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[open+1 : i], true
			}
		}
	}
	return "", false
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
