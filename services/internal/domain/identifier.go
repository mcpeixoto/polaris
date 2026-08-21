package domain

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// ParseIssueIdentifier splits a human issue reference into a team key and a number.
//
// ENG-123 is the spelling people paste. eng123 is the same thing typed without the hyphen —
// a search box and a URL bar both produce it. The identifier is not stored: it is derived
// from the team's key and the issue's number, so reading one back means taking it apart.
func ParseIssueIdentifier(identifier string) (string, int64, error) {
	s := strings.TrimSpace(identifier)
	if s == "" {
		return "", 0, fmt.Errorf("malformed")
	}
	for _, r := range s {
		if unicode.IsSpace(r) {
			return "", 0, fmt.Errorf("malformed")
		}
	}

	key, numPart := splitIssueIdentifier(s)
	if key == "" || numPart == "" {
		return "", 0, fmt.Errorf("malformed")
	}
	key = strings.ToUpper(key)
	for _, c := range key {
		if (c < 'A' || c > 'Z') && (c < '0' || c > '9') {
			return "", 0, fmt.Errorf("malformed")
		}
	}
	if key[0] < 'A' || key[0] > 'Z' {
		return "", 0, fmt.Errorf("malformed")
	}
	n, err := strconv.ParseInt(numPart, 10, 64)
	if err != nil || n <= 0 {
		return "", 0, fmt.Errorf("malformed")
	}
	return key, n, nil
}

func splitIssueIdentifier(s string) (key, number string) {
	sep := strings.LastIndex(s, "-")
	if sep > 0 && sep < len(s)-1 {
		return s[:sep], s[sep+1:]
	}
	i := len(s)
	for i > 0 && s[i-1] >= '0' && s[i-1] <= '9' {
		i--
	}
	if i == 0 || i == len(s) {
		return "", ""
	}
	return s[:i], s[i:]
}
