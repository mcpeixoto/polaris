package main

import (
	"fmt"
	"strings"
)

// COPY: appended to every prompt. The runner never invokes git; this is what
// tells the agent not to commit unless the issue asked, and to end with the
// summary finish posts when the run itself posted no comment.
const standingInstruction = "Work in this directory. Commit nothing unless the issue asks. End with a short summary of what changed."

func buildPrompt(iss issue) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Issue %s: %s\n", iss.identifier, iss.title)
	if iss.url != "" {
		fmt.Fprintf(&b, "URL: %s\n", iss.url)
	}
	switch {
	case iss.teamName != "" && iss.teamKey != "":
		fmt.Fprintf(&b, "Team: %s (%s)\n", iss.teamName, iss.teamKey)
	case iss.teamName != "" || iss.teamKey != "":
		fmt.Fprintf(&b, "Team: %s%s\n", iss.teamName, iss.teamKey)
	}
	if iss.state != "" {
		fmt.Fprintf(&b, "State: %s\n", iss.state)
	}
	if iss.priority != "" {
		fmt.Fprintf(&b, "Priority: %s\n", iss.priority)
	}
	if iss.description != "" {
		fmt.Fprintf(&b, "\nDescription:\n%s\n", strings.TrimRight(iss.description, "\n"))
	}
	if len(iss.comments) > 0 {
		b.WriteString("\nRecent comments:\n")
		for _, c := range iss.comments {
			head := c.author
			if c.createdAt != "" {
				if head != "" {
					head = head + " (" + c.createdAt + ")"
				} else {
					head = c.createdAt
				}
			}
			if head == "" {
				fmt.Fprintf(&b, "- %s\n", c.body)
				continue
			}
			fmt.Fprintf(&b, "- %s: %s\n", head, c.body)
		}
	}
	b.WriteString("\n")
	b.WriteString(standingInstruction)
	b.WriteString("\n")
	return b.String()
}
