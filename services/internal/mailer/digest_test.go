package mailer_test

import (
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/mailer"
)

// What the digest says, which is the half of this feature a reader ever sees.
//
// The assertions are about wording and structure rather than about bytes, because the
// failure being guarded against is a digest that says "you have 5 notifications" — a
// notification about notifications, which sends the reader to the app to find out whether
// any of it mattered and so replaces nothing.

func digest() mailer.Digest {
	return mailer.Digest{
		Workspace:      "Acme",
		Recipient:      "Ada",
		InboxURL:       "https://polaris.example/inbox",
		PreferencesURL: "https://polaris.example/settings/notifications",
		Sections: []mailer.Section{
			// Deliberately out of order: RenderDigest sorts them, most directly about you
			// first, and a caller that appends them in query order must not decide the layout.
			{Type: model.NotifyComment, Count: 2, Items: []mailer.Item{
				{Identifier: "ENG-2", Title: "Flaky test", URL: "https://polaris.example/issue/ENG-2"},
				{Identifier: "ENG-3", Title: "Slow query", URL: "https://polaris.example/issue/ENG-3"},
			}},
			{Type: model.NotifyIssueAssigned, Count: 3, Items: []mailer.Item{
				{Identifier: "ENG-1", Title: "Ship the thing", URL: "https://polaris.example/issue/ENG-1", Others: 2},
			}},
		},
	}
}

func TestRenderDigest_NamesWhatHappened(t *testing.T) {
	t.Parallel()

	msg, err := mailer.RenderDigest(mailer.Address{Name: "Ada", Email: toEmail}, digest())
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	// The subject leads with the most direct thing and says which workspace it is about,
	// because somebody in three workspaces gets three of these.
	if !strings.HasPrefix(msg.Subject, "Acme: 3 issues assigned to you") {
		t.Errorf("subject is %q; it should lead with the assignment", msg.Subject)
	}
	if strings.Contains(msg.Subject, "notification") {
		t.Errorf("subject is about notifications rather than about work: %q", msg.Subject)
	}

	for _, body := range []struct {
		name string
		text string
	}{{"text", msg.Text}, {"html", msg.HTML}} {
		t.Run(body.name, func(t *testing.T) {
			for _, want := range []string{
				"3 issues assigned to you",
				"2 new comments on issues you follow",
				"ENG-1", "Ship the thing",
				"ENG-3", "Slow query",
				// A coalesced row stands for a whole bulk edit. Naming one of two hundred
				// issues without saying so would read as if there had been one.
				"and 2 more like it",
				"https://polaris.example/issue/ENG-1",
				"https://polaris.example/inbox",
				"https://polaris.example/settings/notifications",
			} {
				if !strings.Contains(body.text, want) {
					t.Errorf("the %s body does not contain %q:\n%s", body.name, want, body.text)
				}
			}

			// Assignment before comments, in both bodies. The order is the reader's triage
			// order and it is the whole reason sectionOrder exists.
			if strings.Index(body.text, "assigned to you") > strings.Index(body.text, "new comments") {
				t.Error("comments are listed above assignments")
			}
		})
	}

	// The unsubscribe header and the link in the footer are the same URL, and it carries no
	// token: it goes behind the product's own sign-in, so a forwarded digest hands over
	// nothing, and no credential ends up in a mail gateway's logs.
	if msg.Unsubscribe != "https://polaris.example/settings/notifications" {
		t.Errorf("List-Unsubscribe would be %q", msg.Unsubscribe)
	}
	if strings.Contains(msg.Unsubscribe, "token") || strings.Contains(msg.Unsubscribe, "?") {
		t.Errorf("the unsubscribe URL carries a query string: %q", msg.Unsubscribe)
	}
}

// The HTML body has to survive Gmail and Outlook, which means tables and inline styles: no
// <style> block to be stripped, and no layout that Word's rendering engine cannot do.
func TestRenderDigest_HTMLIsBuiltTheWayEmailHTMLHasToBe(t *testing.T) {
	t.Parallel()

	msg, err := mailer.RenderDigest(mailer.Address{Email: toEmail}, digest())
	if err != nil {
		t.Fatalf("render: %v", err)
	}

	if !strings.Contains(msg.HTML, "<table") {
		t.Error("the HTML body is not laid out with tables")
	}
	if !strings.Contains(msg.HTML, "style=") {
		t.Error("the HTML body has no inline styles")
	}
	for _, forbidden := range []string{"<style", "<link", "display:flex", "display:grid", "<img"} {
		if strings.Contains(msg.HTML, forbidden) {
			t.Errorf("the HTML body uses %q, which does not survive Outlook or Gmail", forbidden)
		}
	}
}

// An issue title is somebody's typing and reaches an HTML document. html/template escapes it;
// this is the test that notices the day somebody switches the template to text/template to
// "share the code" with the plain-text body.
func TestRenderDigest_EscapesTitlesInTheHTMLBody(t *testing.T) {
	t.Parallel()

	d := digest()
	d.Sections[0].Items[0].Title = `<script>alert("hi")</script>`

	msg, err := mailer.RenderDigest(mailer.Address{Email: toEmail}, d)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(msg.HTML, "<script>") {
		t.Errorf("an issue title reached the HTML body unescaped:\n%s", msg.HTML)
	}
	// And the plain-text body carries it as typed, which is correct there.
	if !strings.Contains(msg.Text, `<script>alert("hi")</script>`) {
		t.Error("the text body mangled a title that needs no escaping")
	}
}

func TestRenderDigest_RefusesAnEmptyDigest(t *testing.T) {
	t.Parallel()

	// A greeting with no news under it is worse than no email. The caller has a bug and it
	// has to fail here rather than in somebody's mailbox.
	if _, err := mailer.RenderDigest(mailer.Address{Email: toEmail}, mailer.Digest{
		Workspace: "Acme", Recipient: "Ada",
	}); err == nil {
		t.Fatal("a digest with no sections rendered anyway")
	}
}

func TestRenderDigest_SaysWhatItLeftOut(t *testing.T) {
	t.Parallel()

	d := digest()
	d.Remaining = 37

	msg, err := mailer.RenderDigest(mailer.Address{Email: toEmail}, d)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	// A digest that silently truncates teaches people it is not the whole picture, without
	// ever telling them when.
	for _, body := range []string{msg.Text, msg.HTML} {
		if !strings.Contains(body, "37 more") {
			t.Errorf("a truncated digest does not say so:\n%s", body)
		}
	}
}

func TestSectionTitle_ReadsLikeEnglishInBothNumbers(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		typ  string
		n    int
		want string
	}{
		{model.NotifyIssueAssigned, 1, "1 issue assigned to you"},
		{model.NotifyIssueAssigned, 3, "3 issues assigned to you"},
		{model.NotifyComment, 1, "1 new comment on issues you follow"},
		{model.NotifyMention, 2, "2 mentions of you"},
		{model.NotifyIssueBlocked, 1, "1 issue you follow is blocked"},
		{model.NotifyIssueBlocked, 2, "2 issues you follow are blocked"},
		{model.NotifySubIssueCompleted, 4, "4 sub-issues completed"},
		// A type added later and forgotten here still arrives, described generically, rather
		// than not arriving at all.
		{"something_new", 2, "2 updates"},
	} {
		if got := mailer.SectionTitle(tc.typ, tc.n); got != tc.want {
			t.Errorf("SectionTitle(%q, %d) = %q, want %q", tc.typ, tc.n, got, tc.want)
		}
	}
}
