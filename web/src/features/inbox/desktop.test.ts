import { describe, expect, it } from 'vitest';

import { idsToAnnounce } from './desktop';

describe('idsToAnnounce', () => {
  it('is silent on the first snapshot so a hydrate does not pop every unread row', () => {
    const got = idsToAnnounce(new Set(['a', 'b']), new Set(), false);
    expect(got.announce).toEqual([]);
    expect([...got.seen].sort()).toEqual(['a', 'b']);
  });

  it('announces only ids that were not in the previous snapshot', () => {
    const primed = idsToAnnounce(new Set(['a']), new Set(), false);
    const got = idsToAnnounce(new Set(['a', 'b']), primed.seen, true);
    expect(got.announce).toEqual(['b']);
  });

  it('does not re-announce a row that was already shown', () => {
    const primed = idsToAnnounce(new Set(['a']), new Set(), false);
    const again = idsToAnnounce(new Set(['a']), primed.seen, true);
    expect(again.announce).toEqual([]);
  });

  it('treats a prefs-off seed like a first snapshot, so enabling later is quiet', () => {
    const seeded = idsToAnnounce(new Set(['a', 'b']), new Set(), false);
    const enabled = idsToAnnounce(new Set(['a', 'b', 'c']), seeded.seen, true);
    expect(enabled.announce).toEqual(['c']);
  });
});
