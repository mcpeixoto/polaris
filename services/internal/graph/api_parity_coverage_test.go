package graph_test

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Acceptance test 9 in docs/07-milestones/01-milestone-1.md:
//
//	Every new mutation is reachable over the public API — api_parity_test.go enforces it.
//
// Only this level can prove it, and the test next door does not quite. api_parity_test.go
// reflects over `*domain.Service` — which removes the need for a hand-maintained list of
// method names — and then decides which of those methods are writes with `isMutating`, a
// hand-maintained list of seventeen English verbs. Its own header says a hand-maintained
// list "is itself something somebody has to remember to update, which is the failure being
// prevented", and that is exactly what `mutatingPrefixes` is. The burden moved; it did not
// go away.
//
// The gap is not hypothetical. Five methods that write data are invisible to the parity
// test today and happen to have schema fields only because somebody also wrote them by
// hand: BulkUpdateIssues, RestoreIssue, MarkNotificationRead, MarkAllNotificationsRead and
// SnoozeNotification. None begins with a listed verb. A sixth — a hypothetical MoveIssue,
// AssignIssue, MergeIssues, CloseIssue or StarIssue — would be skipped in the same silence,
// with no GraphQL field, and the build would stay green.
//
// So this test asserts something the other cannot: that the classification is TOTAL. Every
// exported method of the domain service must be accounted for as exactly one of a read, an
// argued-for exemption, or a mutation that the schema exposes. There is no fourth category
// and no way to fall out of the set by being named unexpectedly.

// readPrefixes are the verbs that mark a domain method as a read.
//
// The opposite polarity to `mutatingPrefixes`, and that inversion is the point. A verb
// missing from that list makes a write invisible; a verb missing from this one makes a read
// fail the test until somebody classifies it. Both lists are maintained by hand — the
// difference is which way an omission fails, and only one of the two directions is safe.
// The prefixes are deliberately narrow. "Sub" would match both `SubIssuesFor` (a read) and
// `SubscribeOnAction` (a write), and the broader spelling would classify the write as a
// read — reintroducing, from the other direction, exactly the silent skip this file exists
// to close.
var readPrefixes = []string{
	"Get", "List", "Read", "Search", "My", "Stream", "Unread", "SubIssues", "IssuesByID",
	"WorkspaceVersion", "Oldest", "Entitlement", "IssueProgress", "Listen",
}

// serverSideOnly names exported methods that are neither reads nor part of the public API,
// each with the reason.
//
// Kept here rather than added to `notInTheAPI` next door because these are precisely the
// entries that map was never asked to hold: `notInTheAPI` covers writes the verb list
// already catches, and every one of these was exempt by accident of its name instead. A
// worker cron that has to be argued for and a worker cron that is skipped silently are the
// same amount of code and a very different amount of review.
var serverSideOnly = map[string]string{
	// FanOutAll is the scheduled thing and FanOut is its unit, so the "worker cron" excuse
	// belongs to the one the job table actually names. Spelling both as worker crons would
	// make TestAPIParity_EveryWorkerCronExcuseIsActuallyScheduled demand a job for a method
	// that correctly has none — and teaching that test to accept "something nearby is
	// scheduled" is how it stops meaning anything.
	"FanOutAll":                  "worker cron: derives inbox rows from change_log",
	"FanOut":                     "internal: one workspace's pass, called by FanOutAll",
	"FanOutWebhooksAll":          "worker cron: queues webhook deliveries from change_log",
	"FanOutWebhooks":             "internal: one workspace's pass, called by FanOutWebhooksAll",
	"DeliverDueWebhooks":         "worker cron: POSTs signed webhook deliveries",
	"DeliverNotificationDigests": "worker cron: sends the digest mail",
	"AdvanceCycles":              "worker cron: closes ended cycles, rolls work, auto-adds",
	"AdvanceRecurringIssues":     "worker cron: mints the next occurrence after the due date passes",
	"AutoCloseIssues":            "worker cron: closes stale open issues per team period",
	"AutoArchive":                "worker cron: archives stale closed issues, projects and cycles",
	"SubscribeOnAction":          "internal: called by the write paths that auto-subscribe",
	"AuthenticateApiKey":         "auth middleware: exchanging a token for a principal is not a mutation a caller performs",
	"AuthenticateOauthToken":     "auth middleware: exchanging an OAuth access token for a principal is not a mutation a caller performs",
	"IsOauthAccessToken":         "auth middleware: prefix check so a pla_ bearer is not parsed as a JWT",
	"DB":                         "accessor: hands the pool to the bootstrap and the sync hub",
	"IngestGitHubPullRequest":    "inbound GitHub webhook: signed HTTP, not GraphQL",
	"IngestGitHubPush":           "inbound GitHub commit webhook: signed HTTP, not GraphQL",
	"VerifyGitHubCommitWebhook":  "inbound GitHub webhook auth: HMAC check, not a caller mutation",
	"IngestGitLabMergeRequest":   "inbound GitLab webhook: token HTTP, not GraphQL",
	"IngestGitLabPush":           "inbound GitLab push webhook: token HTTP, not GraphQL",
	"VerifyGitLabWebhook":        "inbound GitLab webhook auth: token check, not a caller mutation",
	"IngestSentryIssue":          "inbound Sentry webhook: signed HTTP, not GraphQL",
	"VerifySentryWebhook":        "inbound Sentry webhook auth: HMAC or token check, not a caller mutation",
	"FanOutSlackAll":             "worker cron: POSTs issue/comment events to a Slack incoming webhook",
	"FanOutSlack":                "internal: one workspace's pass, called by FanOutSlackAll",
	"HandleSlackSlash":           "inbound Slack slash command: signed HTTP, not GraphQL",
	"HandleSlackMessage":         "inbound Slack Events API message: signed HTTP, not GraphQL",
	"SlackUnfurls":               "inbound Slack link_shared: signed HTTP, not GraphQL",
	"VerifySlackRequest":         "inbound Slack webhook auth: HMAC check, not a caller mutation",
	"SlackWebhookConfigured":     "GraphQL slackInbound: admin flag for a credential that is not replicated",
	"IngestInboundEmail":         "inbound email webhook: signed HTTP, not GraphQL",
	"SubmitAsk":                  "POST /asks/{token}: public, token is the credential",
	"SetGitHubCommentPoster":     "composition root: wires the GitHub HTTP client, not a caller mutation",
	"SetGitLabCommentPoster":     "composition root: wires the GitLab HTTP client, not a caller mutation",
}

func isRead(name string) bool {
	for _, prefix := range readPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// TestAPIParity_EveryDomainMethodIsClassified proves the parity test cannot be escaped by
// naming a mutation something the verb list does not expect.
//
// Modelled on authz.TestEveryActionIsClassified, which pins the same property for
// permissions: the value of an exhaustive partition is that the failure arrives when the
// method is added rather than when somebody notices the API is missing something.
func TestAPIParity_EveryDomainMethodIsClassified(t *testing.T) {
	schema := loadSchema(t)

	mutationFields := map[string]bool{}
	if schema.Mutation != nil {
		for _, f := range schema.Mutation.Fields {
			mutationFields[strings.ToLower(f.Name)] = true
		}
	}
	if len(mutationFields) == 0 {
		t.Fatal("the schema declares no mutations at all")
	}

	svcType := reflect.TypeOf(&domain.Service{})
	var unclassified []string

	for i := range svcType.NumMethod() {
		name := svcType.Method(i).Name

		switch {
		case isRead(name):
			// A read needs no API mutation. Reads are covered by the query side of the
			// schema, which schema_drift_test.go pins separately.
		case notInTheAPI[name] != "":
			// Argued for next door, with a reason.
		case serverSideOnly[name] != "":
			// Argued for above, with a reason.
		case mutationFields[strings.ToLower(name)]:
			// Reachable over the public API, which is the criterion.
		default:
			unclassified = append(unclassified, name)
		}
	}

	sort.Strings(unclassified)
	for _, name := range unclassified {
		t.Errorf(
			"domain.Service.%s is not reachable over the public API and is not classified.\n"+
				"It is not a read by any prefix in readPrefixes, it is in neither exemption map,\n"+
				"and schema/schema.graphql has no mutation called %q. Acceptance test 9 says every\n"+
				"mutation is reachable over the public API, so one of four things is true and the\n"+
				"fix depends on which:\n"+
				"  - it is a write callers should be able to perform -> add the field to the schema;\n"+
				"  - it is server-side only -> add it to serverSideOnly with the reason;\n"+
				"  - it is deliberately not in the API yet -> add it to notInTheAPI with the reason;\n"+
				"  - it is a read whose verb is new -> add the verb to readPrefixes.",
			name, strings.ToLower(name[:1])+name[1:])
	}
}

// TestAPIParity_TheVerbListDoesNotSilentlySkipWrites names the methods the sibling test's
// classifier misses, so that the gap is a fact in the test output rather than something a
// reader has to reconstruct from two lists.
//
// It asserts the miss set exactly. That makes it fail in both directions, which is what
// makes it useful: adding a verb to `mutatingPrefixes` fails here and the entry comes out,
// and adding a sixth unexpectedly-named write also fails here rather than passing in
// silence. When the set reaches zero — because `isMutating` is inverted to match `isRead`
// above — this test can go.
func TestAPIParity_TheVerbListDoesNotSilentlySkipWrites(t *testing.T) {
	// Writes that reach the public API only because somebody also wrote the schema field
	// by hand. Every one of these is exposed today; none is checked by the parity test.
	known := map[string]bool{
		"BulkUpdateIssues": true,
	}

	svcType := reflect.TypeOf(&domain.Service{})
	var missed []string
	for i := range svcType.NumMethod() {
		name := svcType.Method(i).Name
		// A write the sibling classifier does not see: not a read, not exempt anywhere,
		// and not caught by the verb list that decides whether parity is checked at all.
		if isRead(name) || notInTheAPI[name] != "" || serverSideOnly[name] != "" {
			continue
		}
		if !isMutating(name) {
			missed = append(missed, name)
		}
	}
	sort.Strings(missed)

	for _, name := range missed {
		if !known[name] {
			t.Errorf("domain.Service.%s is a write that api_parity_test.go's verb list does not "+
				"classify as one, so its API parity is not checked by anything. Either rename it to "+
				"start with a verb in mutatingPrefixes, or add that verb to the list.", name)
		}
		delete(known, name)
	}
	for name := range known {
		t.Errorf("domain.Service.%s is listed here as a write the verb list misses, but the verb "+
			"list now catches it. Remove it from `known` — and if `known` is empty, isMutating has "+
			"been inverted and this whole test can go.", name)
	}
}
