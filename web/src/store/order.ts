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
