/**
 * The Apple App Site Association file is what makes an https://polaris.peixotolabs.com
 * link open the iOS app instead of Safari. Apple's CDN fetches it once per install and
 * caches the result for days; a file that is not valid JSON, or that names the wrong app
 * id, fails with no error anybody sees — every link just keeps opening the browser.
 *
 * Nothing else in the build reads the file: it has no extension, so no linter or bundler
 * touches it, and Vite copies it verbatim. This is the only thing standing between an
 * edit and a silently broken deep link.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  '.well-known',
  'apple-app-site-association',
);

// Team id and bundle id, as in ios/project.yml. The entitlement on the iOS side names the
// domain; this side names the app. Both must agree.
const APP_ID = 'H874DPF6H5.com.peixotolabs.polaris';

type Component = { '/': string; exclude?: boolean };
type Aasa = {
  applinks: { details: { appIDs: string[]; components: Component[] }[] };
  webcredentials: { apps: string[] };
};

function load(): Aasa {
  return JSON.parse(readFileSync(FILE, 'utf8')) as Aasa;
}

// Apple evaluates components in order and the first match wins, exactly like the
// Caddyfile's handle blocks. A path is opened in the app when its first matching
// component is not an exclusion; a path that matches nothing goes to Safari.
function opensInApp(aasa: Aasa, path: string): boolean {
  for (const detail of aasa.applinks.details) {
    for (const component of detail.components) {
      const pattern = component['/'];
      const matches = pattern.endsWith('*')
        ? path.startsWith(pattern.slice(0, -1))
        : path === pattern;
      if (matches) return !component.exclude;
    }
  }
  return false;
}

describe('apple-app-site-association', () => {
  it('is valid JSON naming the app', () => {
    const aasa = load();
    expect(aasa.applinks.details).toHaveLength(1);
    expect(aasa.applinks.details[0]?.appIDs).toEqual([APP_ID]);
    expect(aasa.webcredentials.apps).toEqual([APP_ID]);
  });

  it('opens the signed-in routes in the app', () => {
    const aasa = load();
    for (const path of [
      '/issue/ENG-123',
      '/team/ENG',
      '/team/ENG/cycles',
      '/inbox',
      '/my-issues',
      '/search',
      '/projects',
      '/project/0193c2a0-7f4e-7c1d-9b1a-3e5f6a7b8c9d',
    ]) {
      expect(opensInApp(aasa, path), path).toBe(true);
    }
  });

  it('leaves the public and web-only routes to Safari', () => {
    const aasa = load();
    for (const path of [
      '/',
      '/welcome',
      '/pricing',
      '/signin',
      '/signup',
      '/invite/abc',
      '/ask/abc',
      '/oauth/authorize',
    ]) {
      expect(opensInApp(aasa, path), path).toBe(false);
    }
  });
});
