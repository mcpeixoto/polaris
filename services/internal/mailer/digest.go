package mailer

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"sort"
	"strconv"
	texttemplate "text/template"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
)

// The digest: the one message this product sends, and what it has to say.
//
// A digest that says "you have 7 notifications" is a notification about notifications. It
// makes the reader open the app to find out whether any of it mattered, which is the exact
// interruption a digest exists to replace. So this one names what happened — "3 issues
// assigned to you", "2 comments on issues you follow" — and links each one, and a reader who
// recognises nothing important can close it and have lost nothing.
//
// The wording lives here rather than in the domain layer because it is the email's voice,
// and the notification type constants come from internal/domain/model for the reason
// internal/notify gives for depending on the same package: they are the values that reach
// the database and the wire, and a second copy of them in the package that renders them is
// the kind of duplicate that drifts silently — the symptom being a notification type that
// arrives in the inbox and is missing from the digest.

// Digest is one person's digest, already decided. Nothing here is a query result: the domain
// layer works out what happened and to whom, and this package works out how it reads.
type Digest struct {
	// Workspace is the name people know this Polaris by, and is in the subject line because
	// somebody in three workspaces gets three digests and has to tell them apart at a glance.
	Workspace string
	// Recipient is a display name, for the greeting. Never an address.
	Recipient string

	Sections []Section

	// InboxURL and PreferencesURL are absolute, and carry no token.
	//
	// Both go behind the product's own sign-in, which is what makes them safe to put in an
	// email at all: a message forwarded to a colleague, or sitting in a mailbox synced to
	// somebody's phone backup, hands over no access. A one-click unsubscribe token in a URL
	// would be a credential in a place nobody treats as one, and it would be logged by every
	// mail gateway between here and the reader.
	InboxURL       string
	PreferencesURL string

	// Remaining is how many notifications did not fit in this digest and are waiting for the
	// next one. Said out loud rather than hidden, because a digest that silently truncates
	// teaches people that it is not the whole picture without telling them when.
	Remaining int
}

// Section is everything of one notification type.
type Section struct {
	// Type is a model.Notify* value.
	Type string
	// Count is how many notifications this covers, which is not len(Items): one coalesced
	// inbox row can stand for two hundred issues moved in one bulk edit.
	Count int
	Items []Item
}

// Item is one line: an issue, and how to open it.
type Item struct {
	// Identifier is the human name of the issue — ENG-123. Empty when the issue it pointed
	// at has since been deleted, which is a row that still has to be renderable.
	Identifier string
	Title      string
	URL        string
	// Others is how many further issues the same coalesced row stands for.
	Others int
}

// sectionOrder is the order sections appear in, most directly about you first.
//
// The same order as notify.precedence, and for the same reason — mention, then assignment,
// then a blockage, then conversation, then property changes — because a reader skimming a
// digest is doing exactly what the fan-out is doing when it picks one row per event:
// deciding what this is really about. Restated here rather than exported from internal/notify
// because that package's order decides which notification exists and this one decides where
// it sits on a page; they agree today and there is no rule that they must, which is why one
// is not derived from the other.
var sectionOrder = []string{
	model.NotifyMention,
	model.NotifyIssueAssigned,
	model.NotifyIssueBlocked,
	model.NotifyComment,
	model.NotifyIssuePriorityUp,
	model.NotifyIssueStatusChanged,
	model.NotifySubIssueCompleted,
	model.NotifyIssueDue,
	model.NotifyViewIssueAdded,
	model.NotifyViewIssueCompleted,
	model.NotifyProjectIssueAdded,
	model.NotifyProjectIssueCompleted,
	model.NotifyProjectUpdate,
	model.NotifyInitiativeIssueAdded,
	model.NotifyInitiativeIssueCompleted,
	model.NotifyInitiativeUpdate,
	model.NotifyCustomerRequestAdded,
	model.NotifyCustomerRequestImportant,
	model.NotifyCustomerRequestCompleted,
}

// RenderDigest turns a digest into the message that carries it.
func RenderDigest(to Address, d Digest) (Message, error) {
	sections := make([]Section, 0, len(d.Sections))
	for _, s := range d.Sections {
		if s.Count > 0 {
			sections = append(sections, s)
		}
	}
	if len(sections) == 0 {
		// A digest with nothing in it must not become an empty email. The caller has a bug,
		// and the failure has to be loud here rather than arriving in somebody's mailbox as a
		// greeting with no news under it.
		return Message{}, errors.New("mail: a digest with no sections")
	}
	sort.SliceStable(sections, func(i, j int) bool {
		return orderOf(sections[i].Type) < orderOf(sections[j].Type)
	})

	view := digestView{
		Workspace:      d.Workspace,
		Recipient:      d.Recipient,
		InboxURL:       d.InboxURL,
		PreferencesURL: d.PreferencesURL,
		Remaining:      d.Remaining,
	}
	for _, s := range sections {
		view.Sections = append(view.Sections, sectionView{
			Title: SectionTitle(s.Type, s.Count),
			Items: s.Items,
		})
	}

	var text bytes.Buffer
	if err := digestText.Execute(&text, view); err != nil {
		return Message{}, fmt.Errorf("mail: render text digest: %w", err)
	}
	var html bytes.Buffer
	if err := digestHTML.Execute(&html, view); err != nil {
		return Message{}, fmt.Errorf("mail: render html digest: %w", err)
	}

	return Message{
		To:      to,
		Subject: digestSubject(d.Workspace, view.Sections),
		Text:    text.String(),
		HTML:    html.String(),
		// The preferences page is the unsubscribe, because turning the digest off is a
		// preference and not a separate mechanism: one place where somebody can say "less
		// often" as well as "never", which is what most people pressing unsubscribe actually
		// want.
		Unsubscribe: d.PreferencesURL,
	}, nil
}

func orderOf(typ string) int {
	for i, t := range sectionOrder {
		if t == typ {
			return i
		}
	}
	// An unknown type sorts last rather than first. A type added later and forgotten here
	// still arrives, at the bottom, described generically — which is a worse digest, but a
	// digest, and not a section that outranks a mention because it happened to be unknown.
	return len(sectionOrder)
}

// SectionTitle is the headline for one group: what happened, and how much of it.
//
// Written out per type rather than composed from a noun and a verb, because English does not
// compose: "3 issues assigned to you" and "3 mentions of you" and "3 issues you follow are
// blocked" have nothing in common but the number, and a template that tries to share their
// shape produces the tone of a machine translation.
func SectionTitle(typ string, n int) string {
	switch typ {
	case model.NotifyMention:
		return plural(n, "mention of you", "mentions of you")
	case model.NotifyIssueAssigned:
		return plural(n, "issue assigned to you", "issues assigned to you")
	case model.NotifyIssueBlocked:
		return plural(n, "issue you follow is blocked", "issues you follow are blocked")
	case model.NotifyComment:
		return plural(n, "new comment on issues you follow", "new comments on issues you follow")
	case model.NotifyIssuePriorityUp:
		return plural(n, "issue raised to urgent", "issues raised to urgent")
	case model.NotifyIssueStatusChanged:
		return plural(n, "status change on issues you follow", "status changes on issues you follow")
	case model.NotifySubIssueCompleted:
		return plural(n, "sub-issue completed", "sub-issues completed")
	case model.NotifyIssueDue:
		return plural(n, "issue due", "issues due")
	case model.NotifyViewIssueAdded:
		return plural(n, "issue added to a view you follow", "issues added to views you follow")
	case model.NotifyViewIssueCompleted:
		return plural(n, "issue completed in a view you follow", "issues completed in views you follow")
	case model.NotifyProjectIssueAdded:
		return plural(n, "issue added to a project you follow", "issues added to projects you follow")
	case model.NotifyProjectIssueCompleted:
		return plural(n, "issue completed in a project you follow", "issues completed in projects you follow")
	case model.NotifyProjectUpdate:
		return plural(n, "update on a project you follow", "updates on projects you follow")
	case model.NotifyInitiativeIssueAdded:
		return plural(n, "issue added to an initiative you follow", "issues added to initiatives you follow")
	case model.NotifyInitiativeIssueCompleted:
		return plural(n, "issue completed in an initiative you follow", "issues completed in initiatives you follow")
	case model.NotifyInitiativeUpdate:
		return plural(n, "update on an initiative you follow", "updates on initiatives you follow")
	case model.NotifyCustomerRequestAdded:
		return plural(n, "request added for a customer you follow", "requests added for customers you follow")
	case model.NotifyCustomerRequestImportant:
		return plural(n, "request marked important for a customer you follow", "requests marked important for customers you follow")
	case model.NotifyCustomerRequestCompleted:
		return plural(n, "request completed for a customer you follow", "requests completed for customers you follow")
	default:
		return plural(n, "update", "updates")
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

// digestSubject leads with the most important thing that happened and counts the rest.
//
// The first section is already the most direct one — see sectionOrder — so the subject is the
// headline a reader would have skimmed to anyway, and the workspace name in front of it is
// what tells somebody in three workspaces which one this is before they open anything.
func digestSubject(workspace string, sections []sectionView) string {
	subject := sections[0].Title
	if rest := len(sections) - 1; rest > 0 {
		subject += ", and " + plural(rest, "more kind of update", "more kinds of update")
	}
	if workspace != "" {
		return workspace + ": " + subject
	}
	return subject
}

// digestView is what the templates see.
type digestView struct {
	Workspace      string
	Recipient      string
	Sections       []sectionView
	InboxURL       string
	PreferencesURL string
	Remaining      int
}

type sectionView struct {
	Title string
	Items []Item
}

var digestText = texttemplate.Must(texttemplate.New("digest.txt").Parse(
	`Hi {{.Recipient}},

Here is what happened in {{.Workspace}} since your last digest.
{{range .Sections}}
{{.Title}}
{{range .Items}}  * {{with .Identifier}}{{.}} {{end}}{{.Title}}{{if .Others}} (and {{.Others}} more like it){{end}}
    {{.URL}}
{{end}}{{end}}{{if .Remaining}}
{{.Remaining}} more are waiting in your inbox and will be in your next digest.
{{end}}
Open your inbox: {{.InboxURL}}

You are receiving this because you follow these issues in {{.Workspace}}.
Choose how often, or stop these emails: {{.PreferencesURL}}
`))

// The HTML body.
//
// It is built the way email HTML has to be built rather than the way a web page is, and the
// two have almost nothing in common. Gmail strips <style> blocks in several of its clients
// and Outlook renders with Word's engine, which has no flexbox, no grid, no float worth
// relying on and no support for most of CSS2 — so every rule here is a `style` attribute on
// the element it applies to, the layout is nested tables with explicit border/cellpadding/
// cellspacing, widths are fixed pixels on a 600px column, and there are no images, no web
// fonts and no background images.
//
// It is plain on purpose. A digest is read in four seconds in a list of forty other messages;
// the work goes into it being legible at that speed and identical in every client, and none
// of it goes into it being pretty. Anything more elaborate than this is a thing that renders
// beautifully in the browser it was written in and breaks somewhere nobody tests.
var digestHTML = template.Must(template.New("digest.html").Parse(
	`<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f7f9;padding:24px 0;">
<tr><td align="center">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e3e5e8;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<tr><td style="padding:24px 24px 8px 24px;color:#1c1d21;font-size:16px;line-height:24px;">
Hi {{.Recipient}}, here is what happened in <strong>{{.Workspace}}</strong> since your last digest.
</td></tr>
{{range .Sections}}<tr><td style="padding:16px 24px 0 24px;color:#1c1d21;font-size:14px;line-height:20px;font-weight:600;">
{{.Title}}
</td></tr>
<tr><td style="padding:4px 24px 0 24px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
{{range .Items}}<tr><td style="padding:6px 0;border-bottom:1px solid #eceef0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#1c1d21;">
<a href="{{.URL}}" style="color:#5e6ad2;text-decoration:none;">{{with .Identifier}}<span style="color:#6b6f76;">{{.}}</span> {{end}}{{.Title}}</a>{{if .Others}} <span style="color:#6b6f76;">and {{.Others}} more like it</span>{{end}}
</td></tr>
{{end}}</table>
</td></tr>
{{end}}{{if .Remaining}}<tr><td style="padding:16px 24px 0 24px;color:#6b6f76;font-size:13px;line-height:19px;">
{{.Remaining}} more are waiting in your inbox and will be in your next digest.
</td></tr>
{{end}}<tr><td style="padding:24px;">
<a href="{{.InboxURL}}" style="display:inline-block;padding:10px 16px;background-color:#5e6ad2;color:#ffffff;font-size:14px;line-height:20px;text-decoration:none;border-radius:4px;">Open your inbox</a>
</td></tr>
<tr><td style="padding:0 24px 24px 24px;color:#6b6f76;font-size:12px;line-height:18px;">
You are receiving this because you follow these issues in {{.Workspace}}.
<a href="{{.PreferencesURL}}" style="color:#6b6f76;text-decoration:underline;">Choose how often, or stop these emails</a>.
</td></tr>
</table>
</td></tr>
</table>
`))
