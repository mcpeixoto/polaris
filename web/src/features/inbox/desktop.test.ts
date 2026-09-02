import { describe, expect, it } from 'vitest';

import { announcements, idsToAnnounce, shouldAnnounce } from './desktop';

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

describe('announcements', () => {
  const row = (body: string) => ({ body, route: `/issue/${body}` });

  it('fires one banner per row for a normal trickle', () => {
    const got = announcements([row('ENG-1'), row('ENG-2')]);
    expect(got.map((n) => n.body)).toEqual(['ENG-1', 'ENG-2']);
    expect(got[0]?.route).toBe('/issue/ENG-1');
  });

  it('collapses a burst into one line, which is what a day offline delivers', () => {
    const got = announcements(Array.from({ length: 43 }, (_, i) => row(`ENG-${i}`)));
    expect(got).toEqual([{ title: 'Polaris', body: '43 updates', route: '/inbox' }]);
  });

  it('keeps the boundary on the individual side', () => {
    expect(announcements(Array.from({ length: 5 }, (_, i) => row(`E-${i}`)))).toHaveLength(5);
    expect(announcements(Array.from({ length: 6 }, (_, i) => row(`E-${i}`)))).toHaveLength(1);
  });

  it('says nothing about nothing', () => {
    expect(announcements([])).toEqual([]);
  });
});

describe('shouldAnnounce', () => {
  it('stays quiet when the reader is already looking at the inbox', () => {
    expect(shouldAnnounce(true, '/inbox')).toBe(false);
    expect(shouldAnnounce(true, '/inbox/archive')).toBe(false);
  });

  it('announces anywhere else, focused or not', () => {
    expect(shouldAnnounce(true, '/issue/ENG-1')).toBe(true);
    expect(shouldAnnounce(false, '/inbox')).toBe(true);
  });
});
