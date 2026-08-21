package domain

import "testing"

func TestParseIssueIdentifier(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in      string
		key     string
		number  int64
		wantErr bool
	}{
		{in: "ENG-123", key: "ENG", number: 123},
		{in: "eng-123", key: "ENG", number: 123},
		{in: "eng123", key: "ENG", number: 123},
		{in: " ENG-1 ", key: "ENG", number: 1},
		{in: "A1-2", key: "A1", number: 2},
		{in: "", wantErr: true},
		{in: "ENG", wantErr: true},
		{in: "ENG-", wantErr: true},
		{in: "-1", wantErr: true},
		{in: "123", wantErr: true},
		{in: "ENG-0", wantErr: true},
		{in: "ENG 123", wantErr: true},
		{in: "login-redirect", wantErr: true},
	}
	for _, tc := range cases {
		key, number, err := ParseIssueIdentifier(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("%q parsed as %s-%d, want malformed", tc.in, key, number)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: %v", tc.in, err)
			continue
		}
		if key != tc.key || number != tc.number {
			t.Errorf("%q -> %s-%d, want %s-%d", tc.in, key, number, tc.key, tc.number)
		}
	}
}
