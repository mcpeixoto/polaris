import { describe, expect, it } from 'vitest';

import { cycleWindow, daysLeft, daysLeftLabel } from './format';

const NOW = Date.parse('2026-01-08T12:00:00.000Z');

describe('cycleWindow', () => {
  it('leaves the year off while it is this year', () => {
    const text = cycleWindow('2026-01-05T00:00:00.000Z', '2026-01-18T23:59:59.999Z', 'UTC', NOW);
    expect(text).toBe('Jan 5 – Jan 18');
  });

  it('names the year once it stops being this one, so two sprints cannot read alike', () => {
    const text = cycleWindow('2024-01-05T00:00:00.000Z', '2024-01-18T23:59:59.999Z', 'UTC', NOW);
    expect(text).toContain('2024');
  });

  it('reads the days in the team’s zone', () => {
    // 2026-01-05 00:00 in Tokyo, which is still the 4th in UTC.
    const text = cycleWindow(
      '2026-01-04T15:00:00.000Z',
      '2026-01-18T14:59:59.999Z',
      'Asia/Tokyo',
      NOW,
    );
    expect(text).toBe('Jan 5 – Jan 18');
  });
});

describe('daysLeft', () => {
  it('counts whole days in the team’s zone', () => {
    expect(daysLeft('2026-01-18T23:59:59.999Z', 'UTC', NOW)).toBe(10);
  });

  it('says a cycle ending tonight ends today rather than having nothing left', () => {
    expect(daysLeftLabel('2026-01-08T23:59:59.999Z', 'UTC', NOW)).toBe('Ends today');
    expect(daysLeftLabel('2026-01-09T23:59:59.999Z', 'UTC', NOW)).toBe('1 day left');
  });

  it('never counts below zero for a window that has already closed', () => {
    expect(daysLeft('2026-01-01T00:00:00.000Z', 'UTC', NOW)).toBe(0);
  });
});
