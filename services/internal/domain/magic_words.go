package domain

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// MagicClass is what a reference in a PR, commit or branch means for linking.
//
// Status transitions from these classes are a later slice. V1 only decides whether to
// attach the GitHub object, and whether the author meant "this closes it", "this is
// related", or "do not auto-link this id even if it is in the branch name".
type MagicClass string

const (
	MagicClosing    MagicClass = "closing"
	MagicNonClosing MagicClass = "nonclosing"
	MagicRelation   MagicClass = "relation"
	MagicSuppress   MagicClass = "suppress"
	MagicBare       MagicClass = "bare"
	MagicNew        MagicClass = "new"
)

// MagicLink is one issue (or a TEAM-NEW create) named in GitHub text.
type MagicLink struct {
	Identifier string
	Class      MagicClass
	// NewTeamKey is set when the text asked for `{TEAM}-NEW`. Identifier is empty then.
	NewTeamKey string
}

// MagicOptions controls a parse. Commit messages require a magic word; PR titles and
// branch names also accept a bare identifier.
type MagicOptions struct {
	BareIdentifiers bool
}

type magicPhrase struct {
	phrase string
	class  MagicClass
	words  int
}

// Longest phrases first so "related to" wins over a hypothetical "related", and
// "part of" is not parsed as two tokens that happen to sit next to an id.
var magicPhrases = func() []magicPhrase {
	type pair struct {
		phrase string
		class  MagicClass
	}
	raw := []pair{
		{"close", MagicClosing}, {"closes", MagicClosing}, {"closed", MagicClosing}, {"closing", MagicClosing},
		{"fix", MagicClosing}, {"fixes", MagicClosing}, {"fixed", MagicClosing}, {"fixing", MagicClosing},
		{"resolve", MagicClosing}, {"resolves", MagicClosing}, {"resolved", MagicClosing}, {"resolving", MagicClosing},
		{"complete", MagicClosing}, {"completes", MagicClosing}, {"completed", MagicClosing}, {"completing", MagicClosing},
		{"implement", MagicClosing}, {"implements", MagicClosing}, {"implemented", MagicClosing}, {"implementing", MagicClosing},
		{"polaris issue", MagicClosing},
		{"ref", MagicNonClosing}, {"refs", MagicNonClosing}, {"references", MagicNonClosing},
		{"part of", MagicNonClosing}, {"contributes to", MagicNonClosing},
		{"toward", MagicNonClosing}, {"towards", MagicNonClosing},
		{"relates to", MagicRelation}, {"related to", MagicRelation},
		{"skip", MagicSuppress}, {"ignore", MagicSuppress},
	}
	out := make([]magicPhrase, 0, len(raw))
	for _, p := range raw {
		out = append(out, magicPhrase{
			phrase: p.phrase,
			class:  p.class,
			words:  len(strings.Fields(p.phrase)),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].words != out[j].words {
			return out[i].words > out[j].words
		}
		return len(out[i].phrase) > len(out[j].phrase)
	})
	return out
}()

// issueIDPattern is TEAM-123. Team keys are uppercase alphanumerics; we fold on the way in.
var issueIDPattern = regexp.MustCompile(`(?i)\b([A-Z][A-Z0-9]*)-(\d+)\b`)

var issueURLPattern = regexp.MustCompile(`(?i)/issue/([A-Z][A-Z0-9]*-\d+)`)

var teamNewPattern = regexp.MustCompile(`(?i)\b([A-Z][A-Z0-9]*)-NEW\b`)

var branchIDPattern = regexp.MustCompile(`(?i)(?:^|[^A-Z0-9])([A-Z][A-Z0-9]*)-(\d+)(?:$|[^A-Z0-9])`)

// ParseMagicLinks reads closing / non-closing / relation / suppress references.
// Bare identifiers are off: a commit message of "WIP ENG-1" must not link.
func ParseMagicLinks(text string) []MagicLink {
	return ParseMagicLinksWithOptions(text, MagicOptions{})
}

func ParseMagicLinksWithOptions(text string, opt MagicOptions) []MagicLink {
	if strings.TrimSpace(text) == "" {
		return nil
	}

	type hit struct {
		start, end int
		class      MagicClass
		id         string
		newKey     string
	}

	lower := strings.ToLower(text)
	var hits []hit

	for _, p := range magicPhrases {
		from := 0
		for {
			idx := indexPhrase(lower, p.phrase, from)
			if idx < 0 {
				break
			}
			end := idx + len(p.phrase)
			ids, newKeys, consumedTo := collectIDsAfter(text, end)
			if len(ids) == 0 && len(newKeys) == 0 {
				from = end
				continue
			}
			for _, id := range ids {
				hits = append(hits, hit{start: idx, end: consumedTo, class: p.class, id: id})
			}
			for _, key := range newKeys {
				hits = append(hits, hit{start: idx, end: consumedTo, class: MagicNew, newKey: key})
			}
			from = consumedTo
		}
	}

	if opt.BareIdentifiers {
		for _, m := range issueIDPattern.FindAllStringSubmatchIndex(text, -1) {
			id := canonicalID(text[m[2]:m[3]], text[m[4]:m[5]])
			hits = append(hits, hit{start: m[0], end: m[1], class: MagicBare, id: id})
		}
		for _, m := range issueURLPattern.FindAllStringSubmatchIndex(text, -1) {
			id := strings.ToUpper(text[m[2]:m[3]])
			hits = append(hits, hit{start: m[0], end: m[1], class: MagicBare, id: id})
		}
	}

	// `{TEAM}-NEW` is a create, not a close, and does not need a magic word in front.
	for _, m := range teamNewPattern.FindAllStringSubmatchIndex(text, -1) {
		hits = append(hits, hit{
			start: m[0], end: m[1], class: MagicNew, newKey: strings.ToUpper(text[m[2]:m[3]]),
		})
	}

	suppressed := map[string]bool{}
	for _, h := range hits {
		if h.class == MagicSuppress && h.id != "" {
			suppressed[h.id] = true
		}
	}

	type key struct {
		id     string
		newKey string
	}
	rank := func(c MagicClass) int {
		switch c {
		case MagicSuppress:
			return 4
		case MagicClosing:
			return 3
		case MagicNonClosing:
			return 2
		case MagicRelation:
			return 1
		case MagicNew:
			return 1
		default:
			return 0
		}
	}
	best := map[key]MagicLink{}
	order := make([]key, 0, len(hits))
	for _, h := range hits {
		if h.id != "" && suppressed[h.id] && h.class != MagicSuppress {
			continue
		}
		k := key{id: h.id, newKey: h.newKey}
		cur, ok := best[k]
		next := MagicLink{Identifier: h.id, Class: h.class, NewTeamKey: h.newKey}
		if !ok {
			best[k] = next
			order = append(order, k)
			continue
		}
		if rank(next.Class) > rank(cur.Class) {
			best[k] = next
		}
	}

	out := make([]MagicLink, 0, len(order))
	for _, k := range order {
		out = append(out, best[k])
	}
	return out
}

// ParseIssueIDsInBranch finds TEAM-123 inside a git branch name.
func ParseIssueIDsInBranch(branch string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range branchIDPattern.FindAllStringSubmatch(branch, -1) {
		id := canonicalID(m[1], m[2])
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func canonicalID(key, number string) string {
	return strings.ToUpper(key) + "-" + number
}

func indexPhrase(lower, phrase string, from int) int {
	for from < len(lower) {
		i := strings.Index(lower[from:], phrase)
		if i < 0 {
			return -1
		}
		at := from + i
		if phraseBounded(lower, at, at+len(phrase)) {
			return at
		}
		from = at + 1
	}
	return -1
}

func phraseBounded(s string, start, end int) bool {
	if start > 0 {
		r := rune(s[start-1])
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return false
		}
	}
	if end < len(s) {
		r := rune(s[end])
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// collectIDsAfter reads identifiers and TEAM-NEW tokens after a magic word, stopping at
// the next magic word or when the list (commas / "and") runs out.
func collectIDsAfter(text string, from int) (ids []string, newKeys []string, consumedTo int) {
	consumedTo = from
	rest := text[from:]
	lowerRest := strings.ToLower(rest)

	// Skip a colon or dash the author put after the word ("Fixes: ENG-1").
	trimmed := strings.TrimLeft(rest, " \t:-\n")
	skip := len(rest) - len(trimmed)
	search := rest[skip:]
	searchLower := lowerRest[skip:]

	stop := len(search)
	for _, p := range magicPhrases {
		if i := indexPhrase(searchLower, p.phrase, 0); i >= 0 && i < stop {
			stop = i
		}
	}
	window := search[:stop]
	consumedTo = from + skip + stop

	for _, m := range issueIDPattern.FindAllStringSubmatch(window, -1) {
		ids = append(ids, canonicalID(m[1], m[2]))
	}
	for _, m := range issueURLPattern.FindAllStringSubmatch(window, -1) {
		ids = append(ids, strings.ToUpper(m[1]))
	}
	for _, m := range teamNewPattern.FindAllStringSubmatch(window, -1) {
		newKeys = append(newKeys, strings.ToUpper(m[1]))
	}

	// Dedup preserving order.
	ids = uniqueKeep(ids)
	newKeys = uniqueKeep(newKeys)
	return ids, newKeys, consumedTo
}

func uniqueKeep(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
