package graph_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every domain method excused from the API as "worker cron" is actually scheduled.
//
// `notInTheAPI` is the file where an omission becomes a decision: a write with no GraphQL
// mutation has to be listed there with a reason, or the parity test fails. That works
// exactly as far as the reasons are true, and "worker cron" is the one reason that is a
// claim about a *different file* — every other entry points at an HTTP route in the same
// service or explains a false positive, and both are visible where they are written.
//
// It was not true. `PurgeExpiredIssues` — the trash's retention sweep, the only routine job
// in the product that destroys data — was excused here as a worker cron and was never added
// to the worker's job table. So the sweep existed, was tested, was documented, and ran
// never; soft-deleted issues would have sat in the trash for the lifetime of the
// installation. Nothing could see it: the function compiles and its tests pass whether or
// not anybody calls it, and this map made its absence from the API look deliberate rather
// than doubly absent.
//
// So the excuse is checked against the schedule. Reading the worker's source is crude and
// is the point: it is the artefact that decides whether the job runs, and the alternative —
// exporting the job table so a test can inspect it — would put a seam in the composition
// root for the benefit of this one assertion.
func TestAPIParity_EveryWorkerCronExcuseIsActuallyScheduled(t *testing.T) {
	const relative = "../../cmd/worker/main.go"

	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// A hard failure rather than a skip. A skip is silent on the day somebody moves the
		// worker, which is exactly when this stops holding.
		t.Fatalf("cannot read the worker at %s: %v", relative, err)
	}
	worker := string(source)

	found := 0
	for method, reason := range notInTheAPI {
		if !strings.Contains(reason, "worker cron") {
			continue
		}
		found++

		// `svc.<Method>(` is how every job in that table invokes the domain. Matching the
		// call rather than the bare name means a method merely mentioned in a comment there
		// does not satisfy this.
		if !strings.Contains(worker, "svc."+method+"(") {
			t.Errorf("%s is excused from the API as %q and %s never calls it.\n\n"+
				"The method therefore runs nowhere: not from a mutation, because this map "+
				"says it should not be, and not on a schedule, because nobody added it to the "+
				"job table. Add the job, or change the reason to say what does call it.",
				method, reason, relative)
		}
	}

	// If the whole category disappears, this test has quietly stopped testing anything.
	if found == 0 {
		t.Fatal(`no entry in notInTheAPI is excused as "worker cron" any more — either the ` +
			`wording changed, in which case teach this test the new wording, or the category ` +
			`is gone and so is the reason for this test`)
	}
}
