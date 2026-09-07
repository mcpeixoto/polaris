/**
 * The initiatives display options: what the URL can carry, and what it must not.
 *
 * The round trip is the property that matters. A display somebody set has to survive being
 * written to the query string and read back, or a shared link opens on a different list from
 * the one it was copied out of.
 */

import { describe, expect, it } from 'vitest';

import {
  changedInitiativeDisplayCount,
  DEFAULT_INITIATIVE_DISPLAY,
  isFlatList,
  parseInitiativeDisplayParams,
  resolveInitiativeDisplay,
  toInitiativeDisplayParams,
  type RequiredInitiativeDisplay,
} from './display';

function roundTrip(display: RequiredInitiativeDisplay): RequiredInitiativeDisplay {
  return resolveInitiativeDisplay(new URLSearchParams(toInitiativeDisplayParams(display)));
}

describe('initiative display options', () => {
  it('writes nothing for the defaults', () => {
    expect(toInitiativeDisplayParams(DEFAULT_INITIATIVE_DISPLAY)).toEqual({});
    expect(changedInitiativeDisplayCount(DEFAULT_INITIATIVE_DISPLAY)).toBe(0);
  });

  it('round-trips every option through the query string', () => {
    const display: RequiredInitiativeDisplay = {
      grouping: 'owner',
      ordering: 'targetDate',
      columns: ['health', 'progress'],
    };
    expect(roundTrip(display)).toEqual({
      grouping: 'owner',
      ordering: 'targetDate',
      // Normalised to the order the cells are drawn in, which is what the row reads as.
      columns: ['progress', 'health'],
    });
    expect(changedInitiativeDisplayCount(display)).toBe(3);
  });

  it('round-trips every optional column turned off', () => {
    const display: RequiredInitiativeDisplay = {
      ...DEFAULT_INITIATIVE_DISPLAY,
      columns: [],
    };
    expect(toInitiativeDisplayParams(display).columns).toBe('none');
    expect(roundTrip(display).columns).toEqual([]);
  });

  it('ignores a value no option has, rather than showing a list nobody asked for', () => {
    const parsed = parseInitiativeDisplayParams(
      new URLSearchParams('group=phase&order=vibes&columns=nonsense'),
    );
    expect(parsed.grouping).toBeUndefined();
    expect(parsed.ordering).toBeUndefined();
    // A named set with nothing recognisable in it is an empty set, not the default one:
    // the reader asked for specific columns and none of them exist any more.
    expect(parsed.columns).toEqual([]);
    expect(resolveInitiativeDisplay(new URLSearchParams('group=phase'))).toEqual(
      DEFAULT_INITIATIVE_DISPLAY,
    );
  });
});

describe('isFlatList', () => {
  it('flattens under a filter or a grouping, and only then', () => {
    expect(isFlatList('none', false)).toBe(false);
    expect(isFlatList('none', true)).toBe(true);
    expect(isFlatList('status', false)).toBe(true);
    expect(isFlatList('owner', true)).toBe(true);
  });
});
