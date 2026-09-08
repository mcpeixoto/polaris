package platform

import (
	"strings"
	"testing"
)

// Google issues one client id per platform. The web client and the iOS client are different
// strings against the same project, so a token minted in the app names an audience the
// browser's id never has.
//
// Before GoogleClientIDs existed the server accepted exactly one, which made Sign in with
// Google structurally impossible in the app: the token would be valid, signed by Google, for
// the right user, and refused on its audience. Apple's side had carried a list from the
// start for exactly this reason; Google's had not, and nothing said so.
func TestGoogleSignInAudiences(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		web  string
		more []string
		want []string
	}{
		{
			name: "unset is off, not empty-string-accepting",
			want: nil,
		},
		{
			// The ordinary self-hosted and web-only case: one value, and the app is simply
			// not offered.
			name: "web alone",
			web:  "web.apps.googleusercontent.com",
			want: []string{"web.apps.googleusercontent.com"},
		},
		{
			// The web id must come first. /auth/providers publishes the first audience for
			// Google's JS to use, and handing the browser an iOS client id fails with an
			// error that names neither value.
			name: "web is first even when others are configured",
			web:  "web.apps.googleusercontent.com",
			more: []string{"ios.apps.googleusercontent.com"},
			want: []string{"web.apps.googleusercontent.com", "ios.apps.googleusercontent.com"},
		},
		{
			name: "duplicates collapse",
			web:  "web.apps.googleusercontent.com",
			more: []string{"web.apps.googleusercontent.com", "ios.apps.googleusercontent.com"},
			want: []string{"web.apps.googleusercontent.com", "ios.apps.googleusercontent.com"},
		},
		{
			// Whitespace survives a copy-paste out of a console and a comma-separated env
			// var. An audience with a stray space matches nothing and the resulting error
			// says only that the audience was wrong.
			name: "surrounding whitespace is trimmed, blanks dropped",
			web:  "  web.apps.googleusercontent.com  ",
			more: []string{"", "  ", " ios.apps.googleusercontent.com"},
			want: []string{"web.apps.googleusercontent.com", "ios.apps.googleusercontent.com"},
		},
		{
			// A deployment that only ever serves the app. Nothing requires the web id to be
			// set, and refusing to run without it would be inventing a requirement.
			name: "app only, no web id",
			more: []string{"ios.apps.googleusercontent.com"},
			want: []string{"ios.apps.googleusercontent.com"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := Config{GoogleClientID: tc.web, GoogleClientIDs: tc.more}.GoogleSignInAudiences()
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("at %d: got %q, want %q (full: %v)", i, got[i], tc.want[i], got)
				}
			}
		})
	}
}

// Whatever the audience list holds, no entry may be blank. An empty audience compared
// against a token's `aud` with == would accept a token claiming nothing.
func TestGoogleSignInAudiencesNeverBlank(t *testing.T) {
	t.Parallel()

	got := Config{
		GoogleClientID:  " ",
		GoogleClientIDs: []string{"", "  ", "real.apps.googleusercontent.com"},
	}.GoogleSignInAudiences()

	for _, a := range got {
		if strings.TrimSpace(a) == "" {
			t.Fatalf("blank audience in %v", got)
		}
	}
	if len(got) != 1 || got[0] != "real.apps.googleusercontent.com" {
		t.Fatalf("got %v", got)
	}
}
