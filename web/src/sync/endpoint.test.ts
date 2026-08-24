import { describe, expect, it } from 'vitest';

import { isAnonymousAuthPath, isLoopbackHostname, isSessionlessPath } from './endpoint';

describe('isLoopbackHostname', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]', 'localhost.'])(
    'accepts %s',
    (host) => {
      expect(isLoopbackHostname(host)).toBe(true);
    },
  );

  it.each(['polaris.example.com', '192.168.1.10', '10.0.0.1', '', 'localhost.example.com'])(
    'rejects %s',
    (host) => {
      expect(isLoopbackHostname(host)).toBe(false);
    },
  );
});

describe('isAnonymousAuthPath', () => {
  it.each(['/signin', '/signup', '/welcome', '/invite/abc', '/ask/deadbeef'])(
    'skips auto-login on %s',
    (path) => {
      expect(isAnonymousAuthPath(path)).toBe(true);
    },
  );

  it.each(['/', '/team/ENG', '/invite', '/signin/extra'])('allows auto-login on %s', (path) => {
    expect(isAnonymousAuthPath(path)).toBe(false);
  });
});

describe('isSessionlessPath', () => {
  it.each(['/ask/deadbeef', '/ask/'])('never restores a session on %s', (path) => {
    expect(isSessionlessPath(path)).toBe(true);
  });

  /**
   * Narrower than `isAnonymousAuthPath` on purpose. Those paths render signed out, but a
   * browser that *does* hold a session still has to be recognised on them — an invitation is
   * usually opened in the browser somebody already works in, and `/signin` on a live session
   * belongs on the issue list, not on the form.
   */
  it.each(['/signin', '/signup', '/welcome', '/invite/abc', '/', '/team/ENG', '/ask'])(
    'still restores a session on %s',
    (path) => {
      expect(isSessionlessPath(path)).toBe(false);
    },
  );
});
