package domain

import (
	"strings"
	"unicode"
)

// DefaultGitBranchFormat is what Copy git branch name uses until an admin changes it.
// Identifier first, then a slug of the title: `eng-42-the-importer-is-broken`.
const DefaultGitBranchFormat = "{identifier}-{title}"

// Git branch names have a practical ceiling well below Git's 4096. Keeping the copied
// name short is what makes it pasteable into a terminal without wrapping.
const maxGitBranchLen = 80

// GitBranchParts are the placeholders a format string may name.
type GitBranchParts struct {
	Identifier string
	Title      string
	User       string
}

// FormatGitBranchName expands a template. Unknown placeholders are dropped rather than
// left as `{foo}`, which would make a branch that cannot be pushed.
func FormatGitBranchName(format string, parts GitBranchParts) string {
	if strings.TrimSpace(format) == "" {
		format = DefaultGitBranchFormat
	}
	repl := map[string]string{
		"identifier": slug(parts.Identifier, false),
		"title":      slug(parts.Title, true),
		"user":       slug(parts.User, true),
	}
	var b strings.Builder
	s := format
	for len(s) > 0 {
		start := strings.IndexByte(s, '{')
		if start < 0 {
			b.WriteString(s)
			break
		}
		b.WriteString(s[:start])
		end := strings.IndexByte(s[start:], '}')
		if end < 0 {
			break
		}
		end += start
		key := strings.ToLower(strings.TrimSpace(s[start+1 : end]))
		if v, ok := repl[key]; ok {
			b.WriteString(v)
		}
		s = s[end+1:]
	}
	return clipBranch(collapseSlashes(b.String()))
}

func slug(s string, allowEmpty bool) string {
	var b strings.Builder
	prevHyphen := false
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevHyphen = false
		default:
			if b.Len() == 0 || prevHyphen {
				continue
			}
			b.WriteByte('-')
			prevHyphen = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" && !allowEmpty {
		return "issue"
	}
	return out
}

func collapseSlashes(s string) string {
	for strings.Contains(s, "//") {
		s = strings.ReplaceAll(s, "//", "/")
	}
	return strings.Trim(s, "/-")
}

func clipBranch(s string) string {
	if len(s) <= maxGitBranchLen {
		return strings.Trim(s, "-/")
	}
	s = s[:maxGitBranchLen]
	s = strings.TrimRight(s, "-/")
	return s
}
