/**
 * The sentence a refused key change carries across its own redirect.
 *
 * Saving a new team key redirects optimistically, because the route is keyed by the key and
 * the patch lands before the server answers. A refusal has to walk that redirect back — and
 * the shell keys the routed pane on the pathname, so walking it back re-mounts the screen and
 * throws away any state the refusal was written into. The refusal rides on the navigation
 * instead, and this is the reader for it: `history.state` is whatever anything else on the
 * site last put there, so it is inspected rather than trusted.
 */

import { describe, expect, it } from 'vitest';

import { routedError } from './TeamSettings';

describe('routedError', () => {
  it('reads the sentence a redirect was carrying', () => {
    expect(routedError({ error: 'That key is already used by another team.' })).toBe(
      'That key is already used by another team.',
    );
  });

  it('says nothing for a navigation that was not carrying one', () => {
    expect(routedError(null)).toBeNull();
    expect(routedError(undefined)).toBeNull();
    expect(routedError({})).toBeNull();
    expect(routedError({ scroll: 12 })).toBeNull();
    expect(routedError('back')).toBeNull();
  });

  it('refuses a non-string and an empty string, which would render as a blank alert', () => {
    expect(routedError({ error: 404 })).toBeNull();
    expect(routedError({ error: { message: 'nope' } })).toBeNull();
    expect(routedError({ error: '' })).toBeNull();
  });
});
