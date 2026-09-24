package domain

import "testing"

func TestPushTitle(t *testing.T) {
	cases := []struct {
		name       string
		typ        string
		identifier string
		count      int
		payload    string
		want       string
	}{
		{"one assignment", "issue_assigned", "ENG-12", 1, "", "ENG-12 assigned to you"},
		{"three assignments", "issue_assigned", "ENG-12", 3, "", "ENG-12 and 2 more assigned to you"},
		{"a mention", "mention", "ENG-4", 1, "", "Mentioned in ENG-4"},
		{"due today", "issue_due", "ENG-12", 1, `{"kind":"today"}`, "ENG-12 is due today"},
		{"several due today", "issue_due", "ENG-12", 3, `{"kind":"today"}`, "ENG-12 and 2 more are due today"},
		{"overdue", "issue_due", "ENG-4", 1, `{"kind":"overdue"}`, "ENG-4 is overdue"},
		{"several overdue", "issue_due", "ENG-4", 3, `{"kind":"overdue"}`, "ENG-4 and 2 more are overdue"},
		{"a due row with no kind still says today", "issue_due", "ENG-4", 1, `{}`, "ENG-4 is due today"},
		{"no identifier still says something", "issue_assigned", "", 1, "", "An issue assigned to you"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := pushTitle(tc.typ, tc.identifier, tc.count, []byte(tc.payload))
			if got != tc.want {
				t.Fatalf("pushTitle() = %q, want %q", got, tc.want)
			}
		})
	}
}
