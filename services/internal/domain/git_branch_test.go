package domain

import "testing"

func TestFormatGitBranchName_DefaultTemplate(t *testing.T) {
	t.Parallel()
	got := FormatGitBranchName("", GitBranchParts{
		Identifier: "ENG-42",
		Title:      "The importer is broken",
		User:       "Ada Lovelace",
	})
	if got != "eng-42-the-importer-is-broken" {
		t.Fatalf("default format: got %q", got)
	}
}

func TestFormatGitBranchName_UserPrefixAndTruncation(t *testing.T) {
	t.Parallel()
	got := FormatGitBranchName("{user}/{identifier}-{title}", GitBranchParts{
		Identifier: "ENG-1",
		Title:      "A very long title that should not produce an infinite git branch name because shells and GitHub both have limits",
		User:       "Ada Lovelace",
	})
	const want = "ada-lovelace/eng-1-a-very-long-title-that-should-not-produce-an-infinite-git-bra"
	if got != want {
		t.Fatalf("got %q (len %d), want %q (len %d)", got, len(got), want, len(want))
	}
	if len(got) > maxGitBranchLen {
		t.Fatalf("branch is %d runes, ceiling is %d", len(got), maxGitBranchLen)
	}
}

func TestFormatGitBranchName_StripsUnsafeCharacters(t *testing.T) {
	t.Parallel()
	got := FormatGitBranchName("{identifier}-{title}", GitBranchParts{
		Identifier: "ENG-3",
		Title:      "Fix: `foo` / bar?",
		User:       "",
	})
	if got != "eng-3-fix-foo-bar" {
		t.Fatalf("got %q", got)
	}
}
