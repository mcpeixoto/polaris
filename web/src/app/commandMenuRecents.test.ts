import { describe, expect, it } from 'vitest';

import { frecency, NO_RECENTS, order, record } from './commandMenuRecents';

/**
 * The property worth holding these to is the one that made frecency worth writing at all:
 * neither pure recency nor pure frequency, so a command run once yesterday does not outrank
 * one run every day, and a command run forty times last month does not outrank what somebody
 * is working on now.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

describe('command menu recents', () => {
  it('weighs a command run often above one run once, at the same age', () => {
    let recents = NO_RECENTS;
    recents = record(recents, 'issue.create', NOW - HOUR);
    recents = record(recents, 'issue.create', NOW - HOUR);
    recents = record(recents, 'issue.create', NOW - HOUR);
    recents = record(recents, 'settings.open', NOW - HOUR);

    expect(order(recents, NOW)).toEqual(['issue.create', 'settings.open']);
  });

  it('weighs a command run today above one run repeatedly last week', () => {
    let recents = NO_RECENTS;
    for (let i = 0; i < 4; i++) recents = record(recents, 'stale', NOW - 7 * DAY);
    recents = record(recents, 'fresh', NOW - HOUR);

    expect(order(recents, NOW)[0]).toBe('fresh');
  });

  it('decays, so a use is worth less the older it gets', () => {
    const recents = record(NO_RECENTS, 'a', NOW - DAY);

    // One half-life old is worth half a fresh use, which is the whole shape of the curve.
    expect(frecency(recents, 'a', NOW)).toBeCloseTo(0.5, 5);
    expect(frecency(recents, 'a', NOW - DAY)).toBeCloseTo(1, 5);
  });

  it('knows nothing about a command that has never been run', () => {
    expect(frecency(NO_RECENTS, 'never', NOW)).toBe(0);
    expect(order(NO_RECENTS, NOW)).toEqual([]);
  });

  it('bounds what it remembers per command, so the entry cannot grow with the session', () => {
    let recents = NO_RECENTS;
    for (let i = 0; i < 50; i++) recents = record(recents, 'a', NOW - i);

    expect((recents['a'] ?? []).length).toBeLessThanOrEqual(5);
  });

  it('bounds how many commands it remembers, evicting the least recently used', () => {
    let recents = NO_RECENTS;
    for (let i = 0; i < 60; i++) recents = record(recents, `a${i}`, NOW - (60 - i) * HOUR);

    const ids = Object.keys(recents);
    expect(ids.length).toBeLessThanOrEqual(40);
    // The newest survives; the oldest does not.
    expect(ids).toContain('a59');
    expect(ids).not.toContain('a0');
  });
});
