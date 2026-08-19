import { describe, expect, it } from 'vitest';

import { formatSubtitle } from './tokens';

describe('formatSubtitle', () => {
  it('replaces {var__since} with a relative time from metadata', () => {
    const now = new Date('2026-01-07T00:00:00Z');
    expect(
      formatSubtitle('Merged {mergedAt__since}', { mergedAt: '2026-01-01T00:00:00Z' }, now),
    ).toBe('Merged 6 days ago');
  });

  it('leaves an unknown token alone rather than inventing a date', () => {
    expect(formatSubtitle('Opened {missing__since}', {})).toBe('Opened {missing__since}');
  });
});
