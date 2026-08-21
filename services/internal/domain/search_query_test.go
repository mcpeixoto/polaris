package domain

import "testing"

func TestBuildTSQuery_DropsStopWordsAndKeepsPhrases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{in: "login redirect", want: "login & redirect:*"},
		{in: "login ", want: "login"},
		{in: "the login", want: "login:*"},
		{in: "the", want: "the:*"},
		{in: `"login redirect"`, want: "login <-> redirect"},
		{in: `the "login redirect" bug`, want: "login <-> redirect & bug:*"},
		{in: "logi", want: "logi:*"},
		{in: "", want: ""},
		{in: "   ---   ", want: ""},
	}
	for _, tc := range cases {
		got := buildTSQuery(tc.in)
		if got != tc.want {
			t.Errorf("buildTSQuery(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
