import { describe, expect, it } from 'vitest';

import { restoringMessage } from './Boot';

/**
 * What the boot screen says, as a table.
 *
 * The bug it is holding shut: "Signing you in" for the entire snapshot download, to somebody
 * who was already signed in, on a wait that can run for many seconds and whose length the
 * engine was already reporting.
 */

describe('restoringMessage', () => {
  it('says what is happening once the engine has started reporting', () => {
    expect(restoringMessage({ reason: 'session' }, { phase: 'hydrating' })).toBe(
      'Opening your workspace',
    );
    expect(restoringMessage({ reason: 'session' }, { phase: 'bootstrapping', received: 412 })).toBe(
      'Loading your workspace… 412 items',
    );
  });

  it('names the workspace being switched to rather than claiming to sign anybody in', () => {
    expect(restoringMessage({ reason: 'switch', workspaceName: 'Acme' }, { phase: 'idle' })).toBe(
      'Opening Acme',
    );
    // A switch with no name to hand still must not say "Signing you in".
    expect(restoringMessage({ reason: 'switch' }, { phase: 'idle' })).toBe(
      'Opening your workspace',
    );
  });

  it('still says the true thing on a cold page load', () => {
    expect(restoringMessage({ reason: 'session' }, { phase: 'idle' })).toBe('Signing you in');
  });
});
