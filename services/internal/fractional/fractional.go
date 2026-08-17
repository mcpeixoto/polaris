// Package fractional mints the string keys Polaris uses for manual ordering.
//
// A manual reorder has to write exactly one row. Manual priority order in this product is
// workspace-global, so an integer `position` column — the obvious implementation, which
// renumbers every sibling on every drag — would turn one drag into an UPDATE across all of
// the workspace's issues, a change_log row for each, and a fan-out of the lot to every
// connected session. Instead `issue.sort_order` holds a base-62 string that denotes a
// fraction, and moving an issue mints a fresh key strictly between its two new
// neighbours. The neighbours are not touched, so a drag costs one row however large the
// workspace has grown.
//
// The column is declared `text COLLATE "C"`, which makes Postgres compare it byte by
// byte — exactly what Go's `<` on a string does. That equality is the whole reason the
// scheme works: the order a client computes locally while dragging, the order the server
// stores, and the order the index hands back are one order. Under a linguistic collation
// (en_US.UTF-8 folds case and ignores punctuation) 'a' and 'A' can compare equal, and rows
// come back in an order no client ever asked for. If that column is ever migrated to
// another collation, this package quietly stops being correct.
//
// Keys grow, and are meant to: that is the price of never renumbering. Dropping issues
// into the same gap over and over costs about one byte per six drops, and appending costs
// about one byte per sixty-one appends — ten thousand issues created back to back end on a
// key of some hundred and sixty bytes. Neither cost compounds and neither ever needs the
// reindex pass this package exists to avoid, but both are worth knowing before anyone
// indexes something else on this column.
package fractional

import (
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Digits is the alphabet, ordered so that a digit's numeric value and its ASCII byte value
// rise together — that is what lets byte comparison stand in for arithmetic comparison.
//
// Base 62 rather than base 10 is a density decision: one byte absorbs log2(62) ≈ 5.95
// halvings of a gap instead of 3.32, so keys grow a little under half as fast under the
// worst access pattern. Every character is also safe unquoted in a URL, in a JSON string
// and in a psql session, which matters because these keys ride in sync payloads and get
// read by people debugging ordering bugs.
const Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

const base = len(Digits)

// digitValues inverts Digits. It is a byte-indexed table rather than a call to
// strings.IndexByte because minting walks every byte of both neighbours, and a multi-select
// drag mints one key per selected issue.
var digitValues = func() [256]int8 {
	var t [256]int8
	for i := range t {
		t[i] = -1
	}
	for i := 0; i < len(Digits); i++ {
		t[Digits[i]] = int8(i)
	}
	return t
}()

// Validate reports whether k is a well-formed order key.
//
// A key is a fraction written without its leading "0.", so it must be non-empty and hold
// nothing but base-62 digits. The second rule is the one that is easy to miss: a key must
// not end in the lowest digit. "V0" and "V" denote the same fraction yet sort as
// "V" < "V0", so no key can ever be minted between them — a user dropping an issue into
// that gap would be handed a key equal to one of its neighbours, and the pair would swap
// places on every reload. Worse, the only escape is to keep appending digits, so a client
// retrying the drag lengthens the key without ever succeeding. Forbidding the trailing
// zero keeps the map from keys to fractions injective and order-preserving, which is
// exactly what makes every gap splittable forever.
//
// Callers that read a key out of the database do not need this; anything minted here is
// valid by construction. It is for keys arriving from a client, an importer, or a
// hand-written migration.
func Validate(k string) error {
	if k == "" {
		return platform.Validation("sortOrder", "an order key must not be empty")
	}
	for i := 0; i < len(k); i++ {
		if digitValues[k[i]] < 0 {
			return platform.Validation("sortOrder", "an order key may only contain base-62 digits")
		}
	}
	if k[len(k)-1] == Digits[0] {
		return platform.Validation("sortOrder", "an order key must not end in the lowest digit")
	}
	return nil
}

// Between mints a key k with a < k < b under plain byte comparison.
//
// The empty string is the sentinel for "no neighbour on that side": a == "" means the
// issue is being dropped above everything, b == "" below everything, and both empty means
// the list is empty. That sentinel is why the parameters are plain strings rather than
// pointers — an empty sort_order is not a legal key, so it can never be mistaken for a
// real neighbour.
//
// It is an error for a to sort at or after b. That is not defensiveness, it is a stale
// client: two people dragging into the same place at once can produce a request whose
// claimed neighbours no longer straddle a gap, and minting a key anyway would drop the
// issue somewhere neither of them asked for. Refusing sends the client back to re-read its
// neighbours, which its local store already has.
func Between(a, b string) (string, error) {
	if err := checkBounds(a, b); err != nil {
		return "", err
	}
	return mint(a, b), nil
}

// First is the key for the first issue in a list that has none. It sits in the middle of
// the range rather than at the start so that the first prepend and the first append are
// equally cheap; starting at the bottom would make every prepend lengthen the key.
func First() string {
	return midpoint("", "")
}

// Before mints a key that sorts before b, for dropping an issue above everything else.
//
// It cannot fail, because a drag has nowhere to show an error. A malformed b — which can
// only come from a corrupted store or a hand-edited row, never from this package — is
// treated as an empty list, so the issue lands at the top rather than the drag appearing
// to do nothing.
func Before(b string) string {
	k, err := Between("", b)
	if err != nil {
		return First()
	}
	return k
}

// After mints a key that sorts after a, for appending an issue below everything else. It
// is total for the same reason Before is.
func After(a string) string {
	k, err := Between(a, "")
	if err != nil {
		return First()
	}
	return k
}

// NBetween mints n keys, all strictly between a and b and in ascending order, for bulk
// insertion: an import, a paste of several issues, a multi-select drag.
//
// Inside a bounded gap the keys are spread by repeated bisection rather than by chaining
// one after another, because chaining makes the last key n halvings deep — importing a
// thousand issues would end on a key of some two hundred bytes, and every later insert
// near it would inherit that length. Bisecting keeps the whole batch within about log2(n)
// halvings of the original gap, so a thousand keys stay three bytes long.
func NBetween(a, b string, n int) ([]string, error) {
	if n < 0 {
		return nil, platform.Validation("count", "cannot mint a negative number of order keys")
	}
	if err := checkBounds(a, b); err != nil {
		return nil, err
	}
	if n == 0 {
		return []string{}, nil
	}

	// An open end has no gap to bisect, so the keys are chained outwards. Each link is the
	// shortest step, which is why this stays cheap where a bisection cannot help.
	switch {
	case b == "":
		out := make([]string, n)
		prev := a
		for i := 0; i < n; i++ {
			prev = mint(prev, "")
			out[i] = prev
		}
		return out, nil

	case a == "":
		out := make([]string, n)
		next := b
		for i := n - 1; i >= 0; i-- {
			next = mint("", next)
			out[i] = next
		}
		return out, nil
	}

	mid := n / 2
	c := mint(a, b)
	left, err := NBetween(a, c, mid)
	if err != nil {
		return nil, err
	}
	right, err := NBetween(c, b, n-mid-1)
	if err != nil {
		return nil, err
	}

	out := make([]string, 0, n)
	out = append(out, left...)
	out = append(out, c)
	out = append(out, right...)
	return out, nil
}

// checkBounds is the single gate every minting path goes through, so that the routines
// below may assume valid, correctly ordered arguments and stay free of error returns
// inside their recursion.
func checkBounds(a, b string) error {
	if a != "" {
		if err := Validate(a); err != nil {
			return err
		}
	}
	if b != "" {
		if err := Validate(b); err != nil {
			return err
		}
	}
	if a != "" && b != "" && a >= b {
		return platform.Validation("sortOrder", "an order key can only be minted between two neighbours that are already in order")
	}
	return nil
}

// mint picks the strategy. Between two real neighbours the answer is the midpoint, because
// nothing says which side the next insertion will come from and halving is the choice that
// cannot be punished twice in a row.
//
// An open end is different, and treating it as a midpoint is the mistake that makes this
// scheme look worse than it is. There is no neighbour to stay clear of, so halving towards
// the end of the range wastes the room it is protecting: it would spend a byte every five
// appends and leave a ten-thousand-issue workspace carrying two-kilobyte keys. Stepping to
// the adjacent key instead spends a byte every sixty-one appends. The cost is that
// consecutive appends leave no room between them, so an issue later dragged between two of
// them pays one extra byte — once, not compounding.
func mint(a, b string) string {
	switch {
	case a == "" && b == "":
		return midpoint("", "")
	case a == "":
		return shortestBefore(b)
	case b == "":
		return shortestAfter(a)
	default:
		return midpoint(a, b)
	}
}

// shortestAfter returns the shortest key that sorts after a: the last digit below the
// alphabet's ceiling is raised by one and everything past it dropped, which is why "Vz"
// steps to "W" and not to "Vz1".
func shortestAfter(a string) string {
	for i := len(a) - 1; i >= 0; i-- {
		if v := int(digitValues[a[i]]); v < base-1 {
			return a[:i] + string(Digits[v+1])
		}
	}
	// a is all top digits, so nothing of its length or shorter sorts above it.
	return a + string(Digits[1])
}

// shortestBefore returns the shortest key that sorts before b.
//
// Truncating b is enough whenever the truncation does not end in the lowest digit, because
// a proper prefix always sorts before the whole. The remaining cases are keys made
// entirely of lowest digits bar the last, where the only room left is below that last
// digit.
func shortestBefore(b string) string {
	for i := 0; i < len(b)-1; i++ {
		if b[i] != Digits[0] {
			return b[:i+1]
		}
	}
	if last := int(digitValues[b[len(b)-1]]); last > 1 {
		return b[:len(b)-1] + string(Digits[last-1])
	}
	// b ends in the second-lowest digit with nothing but lowest digits before it, so the
	// only way down is to go one place deeper and take the top of that place.
	return b[:len(b)-1] + string(Digits[0]) + string(Digits[base-1])
}

// midpoint returns the shortest key that halves the gap between the fractions denoted by a
// and b, where an empty a reads as zero and an empty b as one. It assumes checkBounds has
// passed.
//
// It descends digit by digit, and the fiddliness earns its keep by never returning a key
// longer than the gap requires. Two shortcuts do the work: a shared prefix is copied out
// and the problem restarted on what follows, and a gap whose leading digits are
// consecutive is entered rather than averaged, since the average of two adjacent digits is
// one of them. Between them they hold growth to one byte per six splits of the same gap,
// against one byte per split for the naive "append a digit to a" approach.
func midpoint(a, b string) string {
	var out []byte
	for {
		if b != "" {
			// A digit missing from a reads as the lowest digit, because a shorter key is
			// the same fraction padded with zeros. Without that, "V" and "V1" would look
			// like they part company in the first place rather than the second.
			n := 0
			for n < len(b) {
				ac := Digits[0]
				if n < len(a) {
					ac = a[n]
				}
				if ac != b[n] {
					break
				}
				n++
			}
			if n > 0 {
				out = append(out, b[:n]...)
				if n < len(a) {
					a = a[n:]
				} else {
					a = ""
				}
				b = b[n:]
				continue
			}
		}

		da := 0
		if a != "" {
			da = int(digitValues[a[0]])
		}
		db := base
		if b != "" {
			db = int(digitValues[b[0]])
		}

		if db-da > 1 {
			// Rounding up keeps the chosen digit strictly inside the gap on both sides and
			// can never land on the lowest digit, so the result never ends in one.
			out = append(out, Digits[(da+db+1)/2])
			return string(out)
		}

		if len(b) > 1 {
			// The leading digits are consecutive but b carries on past its first, so b's
			// own leading digit already sits inside the gap.
			out = append(out, b[0])
			return string(out)
		}

		// Nothing separates the leading digits, so the answer has to open with a's digit
		// and be found above the remainder of a, with no ceiling left to respect.
		out = append(out, Digits[da])
		if a != "" {
			a = a[1:]
		}
		b = ""
	}
}
