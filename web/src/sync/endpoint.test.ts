import { describe, expect, it } from 'vitest';

import { isAnonymousAuthPath, isLoopbackHostname } from './endpoint';

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
  it.each(['/signin', '/signup', '/welcome', '/invite/abc'])('skips auto-login on %s', (path) => {
    expect(isAnonymousAuthPath(path)).toBe(true);
  });

  it.each(['/', '/team/ENG', '/invite', '/signin/extra'])('allows auto-login on %s', (path) => {
    expect(isAnonymousAuthPath(path)).toBe(false);
  });
});
