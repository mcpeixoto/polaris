package domain

import (
	"slices"
	"testing"
)

// Magic words are the contract GitHub (and later GitLab) use to decide which issues a
// PR, commit or branch refers to, and whether that reference is closing. They are
// spelled here rather than in the GitHub package because the words are a product rule,
// not a provider rule — two providers share them, and a typo in one copy is a PR that
// does not close the issue the author named.

func TestParseMagicLinks_ClosingWords(t *testing.T) {
	t.Parallel()
	for _, word := range []string{
		"close", "closes", "closed", "closing",
		"fix", "fixes", "fixed", "fixing",
		"resolve", "resolves", "resolved", "resolving",
		"complete", "completes", "completed", "completing",
		"implement", "implements", "implemented", "implementing",
	} {
		got := ParseMagicLinks(word + " ENG-123")
		if len(got) != 1 || got[0].Identifier != "ENG-123" || got[0].Class != MagicClosing {
			t.Errorf("%q: got %#v, want one closing ENG-123", word, got)
		}
	}
}

func TestParseMagicLinks_PolarisIssueIsClosingAndLinearCopyIsNot(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinks("polaris issue ENG-9")
	if len(got) != 1 || got[0].Class != MagicClosing || got[0].Identifier != "ENG-9" {
		t.Fatalf("polaris issue: got %#v", got)
	}
	// The cloned product docs name a Linear-branded phrase. We do not recognise it: Polariss
	// copy is Polariss copy, and a PR that says "linear issue" is not a Polariss close.
	if lingering := ParseMagicLinks("linear issue ENG-9"); len(lingering) != 0 {
		t.Fatalf("linear issue must not close anything, got %#v", lingering)
	}
}

func TestParseMagicLinks_NonClosingAndRelation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		text  string
		class MagicClass
	}{
		{"ref ENG-1", MagicNonClosing},
		{"refs ENG-1", MagicNonClosing},
		{"references ENG-1", MagicNonClosing},
		{"part of ENG-1", MagicNonClosing},
		{"contributes to ENG-1", MagicNonClosing},
		{"toward ENG-1", MagicNonClosing},
		{"towards ENG-1", MagicNonClosing},
		{"relates to ENG-1", MagicRelation},
		{"related to ENG-1", MagicRelation},
	}
	for _, c := range cases {
		got := ParseMagicLinks(c.text)
		if len(got) != 1 || got[0].Identifier != "ENG-1" || got[0].Class != c.class {
			t.Errorf("%q: got %#v, want %s ENG-1", c.text, got, c.class)
		}
	}
}

func TestParseMagicLinks_SuppressPreventsLinkingThatID(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinks("skip ENG-123 also mentions ENG-123 in the branch")
	if len(got) != 1 || got[0].Class != MagicSuppress || got[0].Identifier != "ENG-123" {
		t.Fatalf("skip: got %#v", got)
	}
	if ParseMagicLinks("ignore DES-4")[0].Class != MagicSuppress {
		t.Fatal("ignore is the other documented suppress word")
	}
}

func TestParseMagicLinks_SeveralIDsAfterOneWord(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinks("Fixes ENG-123, DES-5, and ENG-256")
	want := []string{"ENG-123", "DES-5", "ENG-256"}
	var ids []string
	for _, l := range got {
		if l.Class != MagicClosing {
			t.Errorf("%s was %s, want closing", l.Identifier, l.Class)
		}
		ids = append(ids, l.Identifier)
	}
	if !slices.Equal(ids, want) {
		t.Fatalf("got %v, want %v", ids, want)
	}
}

func TestParseMagicLinks_IssueURLCountsAsAnID(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinks("Fixes https://polaris.example/issue/ENG-42/the-importer")
	if len(got) != 1 || got[0].Identifier != "ENG-42" || got[0].Class != MagicClosing {
		t.Fatalf("URL: got %#v", got)
	}
}

func TestParseMagicLinks_BareIdentifiersAreOptional(t *testing.T) {
	t.Parallel()
	// A PR title of "ENG-9 login" links by identifier without a magic word. Branch names
	// use the same helper with BareIdentifiers so feat/eng-9-login still attaches.
	got := ParseMagicLinksWithOptions("ENG-9 login is broken", MagicOptions{BareIdentifiers: true})
	if len(got) != 1 || got[0].Identifier != "ENG-9" || got[0].Class != MagicBare {
		t.Fatalf("bare title: got %#v", got)
	}
	if n := ParseMagicLinks("ENG-9 login is broken"); len(n) != 0 {
		t.Fatalf("bare identifiers stay off by default (commit messages require a word); got %#v", n)
	}
}

func TestParseMagicLinks_SuppressWinsOverBareAndClosing(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinksWithOptions("skip ENG-9\nFixes ENG-9", MagicOptions{BareIdentifiers: true})
	if len(got) != 1 || got[0].Class != MagicSuppress {
		t.Fatalf("suppress must win, got %#v", got)
	}
}

func TestParseMagicLinks_NewIssueFromTeamNEW(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinks("Creates ENG-NEW from this PR")
	if len(got) != 1 || got[0].NewTeamKey != "ENG" || got[0].Class != MagicNew {
		t.Fatalf("TEAM-NEW: got %#v", got)
	}
}

func TestParseMagicLinks_CaseInsensitiveWordsAndIDs(t *testing.T) {
	t.Parallel()
	got := ParseMagicLinks("FIXES eng-7")
	if len(got) != 1 || got[0].Identifier != "ENG-7" || got[0].Class != MagicClosing {
		t.Fatalf("got %#v", got)
	}
}

func TestParseIssueIDsInBranch(t *testing.T) {
	t.Parallel()
	got := ParseIssueIDsInBranch("feat/eng-42-the-importer")
	if !slices.Equal(got, []string{"ENG-42"}) {
		t.Fatalf("got %v", got)
	}
	if n := ParseIssueIDsInBranch("main"); len(n) != 0 {
		t.Fatalf("main is not an issue id, got %v", n)
	}
}
