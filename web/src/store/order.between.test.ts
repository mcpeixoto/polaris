/**
 * `orderKeyBetween` — the client's half of the manual-order key.
 *
 * The server mints the key that is stored; this mints the one an optimistic reorder shows
 * for a round trip. They need not agree on the string, and the whole point of these cases is
 * that they must agree on the *order* — so everything here is asserted with the same byte
 * comparison Postgres runs under `COLLATE "C"`, never with `localeCompare`, which is the
 * mistake `order.ts`'s own header exists to warn about.
 */

import { describe, expect, it } from 'vitest';

import { compareOrderKeys, orderKeyBetween } from './order';

/** Strictly between, under the only comparison that counts. */
function between(a: string, b: string): string {
  const key = orderKeyBetween(a, b);
  expect(key, `no key minted between ${a || '<start>'} and ${b || '<end>'}`).not.toBeNull();
  if (a !== '') expect(compareOrderKeys(a, key!)).toBeLessThan(0);
  if (b !== '') expect(compareOrderKeys(key!, b)).toBeLessThan(0);
  return key!;
}

describe('orderKeyBetween', () => {
  it('mints a first key for an empty list', () => {
    const key = orderKeyBetween('', '');
    expect(key).not.toBeNull();
    // In the middle of the range rather than at the start, so the first prepend and the first
    // append are equally cheap — `fractional.First()` makes the same call.
    expect(compareOrderKeys(key!, '1')).toBeGreaterThan(0);
  });

  it('appends and prepends without bound', () => {
    let key = 'V';
    for (let i = 0; i < 200; i++) key = between(key, '');
    let low = 'V';
    for (let i = 0; i < 200; i++) low = between('', low);
  });

  /**
   * The access pattern that punishes a naive implementation: dropping into the same gap over
   * and over. Base 62 with a real midpoint holds it to about a byte per six splits, so two
   * hundred of them must not produce a key of two hundred bytes.
   */
  it('keeps a repeatedly split gap short', () => {
    let low = 'V';
    const high = 'W';
    for (let i = 0; i < 200; i++) low = between(low, high);
    expect(low.length).toBeLessThan(60);
  });

  it('never mints a key ending in the lowest digit', () => {
    // Such a key denotes the same fraction as its own truncation and sorts after it, so no
    // key can ever be minted between the two — the gap is permanently unsplittable.
    let key = 'V';
    for (let i = 0; i < 100; i++) {
      key = between('', key);
      expect(key.endsWith('0')).toBe(false);
    }
  });

  it('refuses neighbours that do not straddle a gap', () => {
    expect(orderKeyBetween('W', 'V')).toBeNull();
    expect(orderKeyBetween('V', 'V')).toBeNull();
  });

  it('refuses a neighbour that is not a key at all', () => {
    // A corrupted row or a hand-written migration. Refusing sends the caller back to re-read
    // its neighbours rather than putting the row somewhere nobody asked for.
    expect(orderKeyBetween('V!', 'W')).toBeNull();
    expect(orderKeyBetween('V0', 'W')).toBeNull();
  });

  it('enters a gap of consecutive digits rather than averaging it', () => {
    // The average of two adjacent digits is one of them, so the answer has to go one place
    // deeper — and must still be short.
    const key = between('V', 'W');
    expect(key.startsWith('V')).toBe(true);
    expect(key.length).toBe(2);
  });

  it('sorts a whole minted run the way it was built', () => {
    const keys: string[] = [orderKeyBetween('', '')!];
    for (let i = 0; i < 50; i++) keys.push(between(keys[keys.length - 1]!, ''));
    const sorted = [...keys].sort(compareOrderKeys);
    expect(sorted).toEqual(keys);
  });
});
