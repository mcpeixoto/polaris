import { describe, expect, it } from 'vitest';

import { DISPLAY_PROPERTIES } from './types';
import { parseDisplayParams, toDisplayParams } from './url';

/**
 * The display options that were in the type and not in the URL, and the ones that were in
 * the URL and not in the type.
 *
 * Both halves are the same defect seen from two sides: an option is only real if it survives
 * being written into a link and read back out of one, and a name the reader accepts is only
 * real if the union has it. `url.test.ts` covers the options that already round-tripped;
 * these are the ones that did not.
 */
describe('sub-grouping and empty groups in a URL', () => {
  it('round-trips a sub-grouping', () => {
    const params = new URLSearchParams(toDisplayParams({ subGroupBy: 'assignee' }));
    expect(params.get('sub')).toBe('assignee');
    expect(parseDisplayParams(params)).toEqual({ subGroupBy: 'assignee' });
  });

  it('round-trips show-empty-groups', () => {
    const params = new URLSearchParams(toDisplayParams({ showEmptyGroups: true }));
    expect(params.get('empty')).toBe('true');
    expect(parseDisplayParams(params)).toEqual({ showEmptyGroups: true });
  });

  // Same bargain as every other option: a link carries the choices somebody made, not the
  // defaults they left alone.
  it('writes neither when both are the default', () => {
    expect(toDisplayParams({ subGroupBy: 'none', showEmptyGroups: false })).toEqual({});
  });

  it('ignores a sub-grouping this build has never heard of', () => {
    expect(parseDisplayParams(new URLSearchParams({ sub: 'sentiment' }))).toEqual({});
  });
});

describe('display properties from a URL', () => {
  /**
   * The round trip the predicate was lying about.
   *
   * `isDisplayProperty` narrowed a string to `DisplayProperty` off a list of names five of
   * which the union had never had, so a link could put a value into `DisplayOptions` that no
   * exhaustive handling of the union would ever see. Asserting over the whole vocabulary
   * rather than over an example is the point: the next name added to one list and not the
   * other fails here.
   */
  it('returns only names the union has', () => {
    const params = new URLSearchParams({
      show: [...DISPLAY_PROPERTIES, 'sla', 'sentry'].join(','),
    });
    expect(parseDisplayParams(params).properties).toEqual([...DISPLAY_PROPERTIES]);
  });

  it('round-trips every property the union has', () => {
    const params = new URLSearchParams(toDisplayParams({ properties: [...DISPLAY_PROPERTIES] }));
    expect(parseDisplayParams(params).properties).toEqual([...DISPLAY_PROPERTIES]);
  });
});
