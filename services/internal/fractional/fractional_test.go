package fractional

import (
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// These tests are the specification. Manual order is stored once and read forever, so a
// key minted wrongly today is a row that sorts wrongly for the life of the workspace —
// there is no migration that repairs it, because nothing records where the issue was meant
// to be. The two property tests at the bottom are the ones that earn their keep.

func TestValidate(t *testing.T) {
	tests := []struct {
		name string
		key  string
		ok   bool
	}{
		{"a single digit", "V", true},
		{"the lowest usable key", "1", true},
		{"the highest digit", "z", true},
		{"a lowest digit anywhere but the end", "V01", true},
		{"a long key", "V00000001", true},
		{"empty", "", false},
		{"a trailing lowest digit", "V0", false},
		{"nothing but a lowest digit", "0", false},
		{"a trailing lowest digit on a long key", "V0V0", false},
		{"a character outside the alphabet", "V-1", false},
		{"a space", "V 1", false},
		{"a multi-byte rune", "Vé", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := Validate(tc.key)
			if tc.ok && err != nil {
				t.Errorf("%q must be accepted: %v", tc.key, err)
			}
			if !tc.ok && err == nil {
				t.Errorf("%q must be rejected, or a gap somewhere becomes unsplittable", tc.key)
			}
			if err != nil && platform.CodeOf(err) != platform.CodeValidation {
				t.Errorf("a bad key is the caller's mistake, not ours: got code %q", platform.CodeOf(err))
			}
		})
	}
}

func TestBetween_OpenEnds(t *testing.T) {
	// The empty string is the sentinel for "no neighbour on that side". All three shapes
	// happen on the very first drag in a workspace, so none of them may be an error.
	k := First()
	if err := Validate(k); err != nil {
		t.Fatalf("First must mint a usable key: %v", err)
	}

	tests := []struct {
		name string
		a, b string
	}{
		{"an empty list", "", ""},
		{"below everything", k, ""},
		{"above everything", "", k},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Between(tc.a, tc.b)
			if err != nil {
				t.Fatalf("Between(%q, %q) must succeed: %v", tc.a, tc.b, err)
			}
			if err := Validate(got); err != nil {
				t.Fatalf("Between(%q, %q) minted the invalid key %q: %v", tc.a, tc.b, got, err)
			}
			if tc.a != "" && got <= tc.a {
				t.Errorf("Between(%q, %q) = %q, which does not sort after its left neighbour", tc.a, tc.b, got)
			}
			if tc.b != "" && got >= tc.b {
				t.Errorf("Between(%q, %q) = %q, which does not sort before its right neighbour", tc.a, tc.b, got)
			}
		})
	}
}

func TestBetween_RejectsNeighboursOutOfOrder(t *testing.T) {
	// A request whose neighbours do not straddle a gap is a stale client, not a rounding
	// problem. Minting anyway would put the issue somewhere nobody asked for.
	tests := []struct {
		name string
		a, b string
	}{
		{"identical neighbours", "V", "V"},
		{"neighbours the wrong way round", "z", "V"},
		{"a right neighbour that is a prefix of the left", "V1", "V"},
		{"an invalid left neighbour", "V0", "z"},
		{"an invalid right neighbour", "1", "V0"},
		{"a left neighbour outside the alphabet", "V!", "z"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Between(tc.a, tc.b)
			if err == nil {
				t.Fatalf("Between(%q, %q) must fail, it returned %q", tc.a, tc.b, got)
			}
			if platform.CodeOf(err) != platform.CodeValidation {
				t.Errorf("a stale or malformed pair is the caller's mistake: got code %q", platform.CodeOf(err))
			}
		})
	}
}

func TestBetween_SplitsAGapThatAlreadyExists(t *testing.T) {
	tests := []struct {
		name string
		a, b string
	}{
		{"adjacent digits", "1", "2"},
		{"distant digits", "1", "z"},
		{"a shared prefix", "VVV1", "VVV2"},
		{"a right neighbour extending the left", "V", "V1"},
		{"a gap made only of lowest digits", "V0000001", "V0000002"},
		{"the top of the range", "z", "zz"},
		{"the bottom of the range", "01", "02"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Between(tc.a, tc.b)
			if err != nil {
				t.Fatalf("Between(%q, %q): %v", tc.a, tc.b, err)
			}
			if err := Validate(got); err != nil {
				t.Fatalf("Between(%q, %q) minted the invalid key %q: %v", tc.a, tc.b, got, err)
			}
			if !(tc.a < got && got < tc.b) {
				t.Errorf("Between(%q, %q) = %q, which is not strictly between them", tc.a, tc.b, got)
			}
		})
	}
}

func TestBeforeAndAfter_AreTotal(t *testing.T) {
	k := First()

	if before := Before(k); before >= k {
		t.Errorf("Before(%q) = %q must sort above nothing else in the list", k, before)
	}
	if after := After(k); after <= k {
		t.Errorf("After(%q) = %q must sort below everything else in the list", k, after)
	}

	// A drag has nowhere to show an error, so a neighbour that could only have come from a
	// corrupted row still has to produce a usable key rather than a panic.
	for _, broken := range []string{"", "V0", "not a key"} {
		if err := Validate(Before(broken)); err != nil {
			t.Errorf("Before(%q) must still mint a usable key: %v", broken, err)
		}
		if err := Validate(After(broken)); err != nil {
			t.Errorf("After(%q) must still mint a usable key: %v", broken, err)
		}
	}
}

// appends is a whole workspace's worth of issues created one after another, which is the
// access pattern an issue tracker spends most of its life in.
const appends = 10000

func TestAfter_CostsAByteOnlyEverySixtyOneAppends(t *testing.T) {
	// A key is a fraction, so the room above the last one shrinks as the list grows and no
	// append strategy can be better than linear here. What is in the implementation's gift
	// is the slope. Stepping to the adjacent key uses all sixty-one digits of each new
	// byte; halving towards the end of the range — the reading of "after" that falls out of
	// reusing the midpoint — uses about five, and would leave this workspace carrying
	// two-kilobyte keys.
	k := First()
	for i := 0; i < appends; i++ {
		next := After(k)
		if next <= k {
			t.Fatalf("append %d went backwards: %q then %q", i, k, next)
		}
		if err := Validate(next); err != nil {
			t.Fatalf("append %d minted the invalid key %q: %v", i, next, err)
		}
		k = next
	}
	if len(k) > appends/61+3 {
		t.Errorf("ten thousand appends ended on a %d-byte key; each byte is meant to carry sixty-one of them", len(k))
	}
	t.Logf("ten thousand appends ended on %d bytes", len(k))
}

func TestBefore_CostsAByteOnlyEverySixtyOnePrepends(t *testing.T) {
	// Prepending is the mirror image and has to cost the same, because a triage list is
	// filled from the top as often as a backlog is filled from the bottom.
	k := First()
	for i := 0; i < appends; i++ {
		prev := Before(k)
		if prev >= k {
			t.Fatalf("prepend %d went forwards: %q then %q", i, k, prev)
		}
		if err := Validate(prev); err != nil {
			t.Fatalf("prepend %d minted the invalid key %q: %v", i, prev, err)
		}
		k = prev
	}
	if len(k) > appends/61+3 {
		t.Errorf("ten thousand prepends ended on a %d-byte key; each byte is meant to carry sixty-one of them", len(k))
	}
	t.Logf("ten thousand prepends ended on %d bytes", len(k))
}

func TestNBetween(t *testing.T) {
	lo, hi := "1", "2"

	tests := []struct {
		name string
		a, b string
		n    int
	}{
		{"inside a narrow gap", lo, hi, 50},
		{"inside a wide gap", "1", "z", 50},
		{"below everything", "", hi, 50},
		{"above everything", lo, "", 50},
		{"into an empty list", "", "", 50},
		{"a single key", lo, hi, 1},
		{"an even count", lo, hi, 2},
		{"none at all", lo, hi, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			keys, err := NBetween(tc.a, tc.b, tc.n)
			if err != nil {
				t.Fatalf("NBetween(%q, %q, %d): %v", tc.a, tc.b, tc.n, err)
			}
			if len(keys) != tc.n {
				t.Fatalf("asked for %d keys, got %d: a bulk insert would lose rows", tc.n, len(keys))
			}
			for i, k := range keys {
				if err := Validate(k); err != nil {
					t.Fatalf("key %d of the batch is invalid: %q: %v", i, k, err)
				}
				if tc.a != "" && k <= tc.a {
					t.Errorf("key %d (%q) escaped below the left neighbour %q", i, k, tc.a)
				}
				if tc.b != "" && k >= tc.b {
					t.Errorf("key %d (%q) escaped above the right neighbour %q", i, k, tc.b)
				}
				if i > 0 && keys[i-1] >= k {
					t.Errorf("the batch is not ascending at %d: %q >= %q", i, keys[i-1], k)
				}
			}
		})
	}
}

func TestNBetween_BisectsRatherThanChains(t *testing.T) {
	// Chaining a thousand keys through one gap would leave the last of them two hundred
	// bytes long, and every later insert beside it would inherit that length. Bisecting
	// keeps the batch within log2(n) halvings of the gap it was given.
	keys, err := NBetween("1", "2", 1000)
	if err != nil {
		t.Fatalf("NBetween: %v", err)
	}
	longest := 0
	for _, k := range keys {
		if len(k) > longest {
			longest = len(k)
		}
	}
	if longest > 6 {
		t.Errorf("a thousand bulk keys reached %d bytes; that is a chain, not a bisection", longest)
	}
}

func TestNBetween_RejectsANegativeCount(t *testing.T) {
	if _, err := NBetween("1", "2", -1); err == nil {
		t.Error("a negative count is a caller bug and must not be silently read as zero")
	}
}

func TestKeysAreASCIIDigitsOnly(t *testing.T) {
	// The column is `text COLLATE "C"`, so Postgres orders these rows by raw byte. That is
	// only the same order as Go's `<` while every byte stays inside this alphabet: a
	// multi-byte rune would sort one way here and another way there.
	for i := 1; i < len(Digits); i++ {
		if Digits[i-1] >= Digits[i] {
			t.Fatalf("the alphabet is not in byte order at %d (%q >= %q): byte comparison no longer means digit comparison",
				i, Digits[i-1], Digits[i])
		}
	}
	if len(Digits) != 62 {
		t.Fatalf("the alphabet must hold 62 digits, it holds %d", len(Digits))
	}

	k := First()
	for i := 0; i < 500; i++ {
		k = After(k)
		if strings.ContainsFunc(k, func(r rune) bool { return r > 127 }) {
			t.Fatalf("key %q left ASCII; Postgres and Go would stop agreeing on its position", k)
		}
	}
}

func TestBetween_NeverMintsATrailingLowestDigit(t *testing.T) {
	// The invariant that keeps every gap splittable. It is asserted against the shapes most
	// likely to break it: gaps whose neighbours are already full of lowest digits.
	pairs := [][2]string{
		{"", ""}, {"", "1"}, {"", "01"}, {"", "001"}, {"z", ""}, {"zz", ""},
		{"V", "V1"}, {"V", "V01"}, {"V0001", "V0002"}, {"01", "02"}, {"1", "2"},
	}
	for _, p := range pairs {
		k, err := Between(p[0], p[1])
		if err != nil {
			t.Fatalf("Between(%q, %q): %v", p[0], p[1], err)
		}
		if strings.HasSuffix(k, string(Digits[0])) {
			t.Errorf("Between(%q, %q) = %q ends in the lowest digit: nothing could ever be minted before it", p[0], p[1], k)
		}
	}
}

func TestBetween_RandomInsertionsKeepTheListOrdered(t *testing.T) {
	// The test that actually catches the algorithm being subtly wrong. Every shape of gap
	// turns up somewhere in two thousand random insertions, including the ones that only
	// appear after a key has been split five levels deep.
	rng := rand.New(rand.NewPCG(0x504f4c41, 0x52495300))

	const insertions = 2000
	list := make([]string, 0, insertions)
	seen := make(map[string]int, insertions)
	longest := 0

	for i := 0; i < insertions; i++ {
		pos := rng.IntN(len(list) + 1)
		var a, b string
		if pos > 0 {
			a = list[pos-1]
		}
		if pos < len(list) {
			b = list[pos]
		}

		k, err := Between(a, b)
		if err != nil {
			t.Fatalf("insertion %d between %q and %q failed: %v", i, a, b, err)
		}
		if err := Validate(k); err != nil {
			t.Fatalf("insertion %d minted the invalid key %q: %v", i, k, err)
		}
		if first, dup := seen[k]; dup {
			t.Fatalf("insertion %d re-minted %q (first used by insertion %d): two issues would hold the same position", i, k, first)
		}
		seen[k] = i
		if len(k) > longest {
			longest = len(k)
		}

		list = append(list, "")
		copy(list[pos+1:], list[pos:])
		list[pos] = k

		for j := 1; j < len(list); j++ {
			if list[j-1] >= list[j] {
				t.Fatalf("after insertion %d at position %d the list is out of order at %d: %q >= %q",
					i, pos, j, list[j-1], list[j])
			}
		}
	}

	if len(seen) != insertions {
		t.Fatalf("%d insertions produced only %d distinct keys", insertions, len(seen))
	}
	if longest > 12 {
		t.Errorf("random insertion reached a %d-byte key; balanced use is meant to stay far shorter", longest)
	}
}

func TestBetween_RepeatedlySplittingOneGapGrowsSlowly(t *testing.T) {
	// Everyone dropping issues into the same place — the top of a triage list, say — is the
	// pattern that punishes a naive midpoint. Each insertion halves the surviving gap, and
	// a byte of base 62 buys log2(62) ≈ 5.95 halvings, so five hundred nested insertions
	// cost about eighty-five bytes. An implementation that appends a digit per insertion
	// instead — the obvious way to get a key "between" two others — costs five hundred, and
	// is what the length bound below is here to catch.
	//
	// Both directions are exercised because they are not symmetric: rounding up when the
	// midpoint falls between two digits makes descending gaps cost a byte every six
	// insertions and ascending gaps a byte every five.
	const insertions = 500

	t.Run("towards the left neighbour", func(t *testing.T) {
		lo := First()
		hi := After(lo)
		k := hi
		for i := 0; i < insertions; i++ {
			next, err := Between(lo, k)
			if err != nil {
				t.Fatalf("insertion %d between %q and %q failed: %v", i, lo, k, err)
			}
			if err := Validate(next); err != nil {
				t.Fatalf("insertion %d minted the invalid key %q: %v", i, next, err)
			}
			if !(lo < next && next < k) {
				t.Fatalf("insertion %d minted %q, which is not strictly between %q and %q", i, next, lo, k)
			}
			k = next
		}
		if len(k) >= 128 {
			t.Errorf("five hundred nested insertions ended on a %d-byte key; growth is linear, not logarithmic in the gap", len(k))
		}
		t.Logf("five hundred insertions towards the left neighbour ended on %d bytes", len(k))
	})

	t.Run("towards the right neighbour", func(t *testing.T) {
		lo := First()
		hi := After(lo)
		k := lo
		for i := 0; i < insertions; i++ {
			next, err := Between(k, hi)
			if err != nil {
				t.Fatalf("insertion %d between %q and %q failed: %v", i, k, hi, err)
			}
			if err := Validate(next); err != nil {
				t.Fatalf("insertion %d minted the invalid key %q: %v", i, next, err)
			}
			if !(k < next && next < hi) {
				t.Fatalf("insertion %d minted %q, which is not strictly between %q and %q", i, next, k, hi)
			}
			k = next
		}
		if len(k) >= 128 {
			t.Errorf("five hundred nested insertions ended on a %d-byte key; growth is linear, not logarithmic in the gap", len(k))
		}
		t.Logf("five hundred insertions towards the right neighbour ended on %d bytes", len(k))
	})
}
