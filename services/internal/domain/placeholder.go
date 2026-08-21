package domain

import "regexp"

// Placeholder marks in a template body. Linear's Aa toolbar wraps selected text so the
// filer sees a prompt rather than finished copy. The marks are a pair of lenticular
// brackets that almost never appear in ordinary markdown, so a description that was not
// written as a template is left alone.
const (
	placeholderOpen  = "⟦"
	placeholderClose = "⟧"
)

var placeholderRe = regexp.MustCompile(`⟦([^⟦⟧]*)⟧`)

// UnwrapPlaceholders turns Aa prompts into the prompt text itself. Unfilled prompts
// become the words the author wrote, which is what Linear leaves in the filed issue.
func UnwrapPlaceholders(body string) string {
	return placeholderRe.ReplaceAllString(body, "$1")
}
