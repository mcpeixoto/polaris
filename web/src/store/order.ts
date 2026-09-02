/**
 * Comparing the fractional order keys the server mints.
 *
 * `position` and `sortOrder` are base-62 strings from `services/internal/fractional`, over
 * the alphabet `0-9A-Za-z`. That package's contract is stated in its own doc comment and is
 * the whole reason the scheme works: the column is declared `text COLLATE "C"`, Postgres
 * therefore compares it byte by byte, and every reader has to compare it the same way. Three
 * orders — the one a client computes while dragging, the one the server stores, and the one
 * the index hands back — are only one order for as long as that holds.
 *
 * `String.prototype.localeCompare` breaks it. It is a *linguistic* comparison: under the ICU
 * root collation letters sort by letter first and case second, so 'a' < 'V' — while byte
 * order, which is what the server sorted by, puts 'V' (0x56) before 'a' (0x61).
 *
 * That is invisible until a list crosses the case boundary, which is exactly why it survived.
 * `fractional.First()` is "V" and appending steps one digit at a time, so a list gets the
 * keys V, W, X, Y, Z, a, b … — the first five items sort identically under both rules, and
 * the *sixth* is the one that jumps to the top. A fresh workspace has five project statuses;
 * a fresh test has one or two saved views. Nothing below six ever shows it, so no fixture
 * ever did.
 *
 * Use `byOrderKey` for a list ordered by a fractional key, and `byOrderKeyThen` when ties
 * fall back to a human-readable name — the name is prose and *should* be compared
 * linguistically, which is the mix that made the wrong call look right at every call site.
 */

/**
 * Byte-order comparison of two fractional keys, matching `COLLATE "C"` in Postgres and
 * Go's `<` on a string.
 */
export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A comparator over rows carrying a fractional key under `field`. */
export function byOrderKey<F extends string>(
  field: F,
): (a: Readonly<Record<F, string>>, b: Readonly<Record<F, string>>) => number {
  return (a, b) => compareOrderKeys(a[field], b[field]);
}

/**
 * `byOrderKey`, with a linguistic tiebreak on a display name.
 *
 * Ties are real: two rows can share a key when one of them is an optimistic stand-in, or
 * after a restore from the trash puts a row back on a key that has since been reused.
 */
export function byOrderKeyThen<F extends string, N extends string>(
  field: F,
  name: N,
): (
  a: Readonly<Record<F, string> & Record<N, string>>,
  b: Readonly<Record<F, string> & Record<N, string>>,
) => number {
  return (a, b) => compareOrderKeys(a[field], b[field]) || a[name].localeCompare(b[name]);
}

/**
 * The alphabet the server mints keys over, from `services/internal/fractional`.
 *
 * Ordered so that a digit's numeric value and its ASCII byte value rise together, which is
 * what lets byte comparison stand in for arithmetic comparison — the same equality
 * `compareOrderKeys` above depends on.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const BASE = DIGITS.length;

/** Inverts `DIGITS`. Built once: minting walks every byte of both neighbours. */
const DIGIT_VALUES = new Map<string, number>(
  [...DIGITS].map((digit, value) => [digit, value] as const),
);

/**
 * A key strictly between `a` and `b` under byte comparison, for an optimistic reorder.
 *
 * This is a port of `fractional.Between`, and it exists for one reason: the server mints
 * the real key — `UpdateIssueInput` takes `afterIssueId`/`moveToTop`, not a `sortOrder` —
 * but the row has to move on the keystroke rather than a round trip later, and a patch
 * cannot leave `sortOrder` alone without the list re-sorting the row straight back where it
 * came from. So the client mints a key that lands the row in the right place locally and
 * the server's delta replaces it. The two need not agree on the exact string; they need to
 * agree on the order, which byte comparison over this alphabet is what guarantees.
 *
 * The empty string is the sentinel for "no neighbour on that side": `a === ''` is the top
 * of the list, `b === ''` the bottom, both empty an empty list. An empty `sortOrder` is not
 * a legal key, so it can never be mistaken for a real neighbour.
 *
 * Neighbours that do not straddle a gap — a stale local order, two people dragging into the
 * same place — return `null` rather than inventing a key that would put the row somewhere
 * nobody asked for. A caller with nowhere to show an error leaves the row where it is and
 * lets the server's answer arrive.
 */
export function orderKeyBetween(a: string, b: string): string | null {
  if (a !== '' && !isOrderKey(a)) return null;
  if (b !== '' && !isOrderKey(b)) return null;
  if (a !== '' && b !== '' && a >= b) return null;
  if (a === '' && b === '') return midpoint('', '');
  if (a === '') return shortestBefore(b);
  if (b === '') return shortestAfter(a);
  return midpoint(a, b);
}

/**
 * Whether a string is a well-formed key.
 *
 * The trailing-lowest-digit rule is the one that is easy to miss and is not defensiveness:
 * "V0" and "V" denote the same fraction yet sort as "V" < "V0", so no key can ever be
 * minted between them, and a row dropped into that gap would swap places on every reload.
 */
function isOrderKey(key: string): boolean {
  if (key === '') return false;
  for (const character of key) if (!DIGIT_VALUES.has(character)) return false;
  return !key.endsWith(DIGITS[0]!);
}

/** The shortest key sorting after `a`: "Vz" steps to "W" rather than to "Vz1". */
function shortestAfter(a: string): string {
  for (let i = a.length - 1; i >= 0; i--) {
    const value = DIGIT_VALUES.get(a[i]!) ?? 0;
    if (value < BASE - 1) return a.slice(0, i) + DIGITS[value + 1]!;
  }
  // Every digit is at the ceiling, so nothing of this length or shorter sorts above it.
  return a + DIGITS[1]!;
}

/**
 * The shortest key sorting before `b`.
 *
 * Truncating is enough whenever the truncation does not end in the lowest digit, because a
 * proper prefix always sorts before the whole.
 */
function shortestBefore(b: string): string {
  for (let i = 0; i < b.length - 1; i++) {
    if (b[i] !== DIGITS[0]) return b.slice(0, i + 1);
  }
  const last = DIGIT_VALUES.get(b[b.length - 1]!) ?? 0;
  if (last > 1) return b.slice(0, -1) + DIGITS[last - 1]!;
  // Nothing but lowest digits before a second-lowest last one, so the only way down is one
  // place deeper, at the top of that place.
  return b.slice(0, -1) + DIGITS[0]! + DIGITS[BASE - 1]!;
}

/**
 * The shortest key halving the gap between the fractions `a` and `b` denote, reading an
 * empty `a` as zero and an empty `b` as one.
 *
 * Two shortcuts keep it short: a shared prefix is copied out and the problem restarted on
 * what follows, and a gap whose leading digits are consecutive is entered rather than
 * averaged, since the average of two adjacent digits is one of them.
 */
function midpoint(a: string, b: string): string {
  let left = a;
  let right = b;
  let out = '';
  for (;;) {
    if (right !== '') {
      // A digit missing from `left` reads as the lowest digit, because a shorter key is the
      // same fraction padded with zeros. Without that, "V" and "V1" would look like they
      // part company in the first place rather than the second.
      let shared = 0;
      while (shared < right.length && (left[shared] ?? DIGITS[0]) === right[shared]) shared++;
      if (shared > 0) {
        out += right.slice(0, shared);
        left = shared < left.length ? left.slice(shared) : '';
        right = right.slice(shared);
        continue;
      }
    }

    const low = left === '' ? 0 : (DIGIT_VALUES.get(left[0]!) ?? 0);
    const high = right === '' ? BASE : (DIGIT_VALUES.get(right[0]!) ?? BASE);

    if (high - low > 1) {
      // Rounding up keeps the digit strictly inside the gap on both sides and can never
      // land on the lowest digit, so the result never ends in one.
      return out + DIGITS[Math.floor((low + high + 1) / 2)]!;
    }
    if (right.length > 1) {
      // The leading digits are consecutive but `right` carries on past its first, so its
      // own leading digit already sits inside the gap.
      return out + right[0]!;
    }
    // Nothing separates the leading digits, so the answer opens with `left`'s digit and is
    // found above the remainder of `left`, with no ceiling left to respect.
    out += DIGITS[low]!;
    left = left.slice(1);
    right = '';
  }
}
