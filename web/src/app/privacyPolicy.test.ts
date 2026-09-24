/**
 * App Store Connect requires a privacy-policy URL that is a real document, not the
 * sign-in screen the SPA serves for unknown paths. nginx serves this file as-is from
 * public/, the same way it serves the Apple App Site Association file, so the only
 * check that the page still says who operates Polaris is this one.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'privacy.html');

function load(): string {
  return readFileSync(FILE, 'utf8');
}

describe('privacy policy', () => {
  const html = load();

  it('names the company that operates the hosted service', () => {
    expect(html).toContain('PEIXOTO LABS, LDA');
    expect(html).toContain('519651251');
    expect(html).toContain('hello@peixotolabs.com');
  });

  it('says what the app collects and that it does not sell it', () => {
    expect(html).toContain('password hash');
    expect(html).toContain('push-notification token');
    expect(html).toContain('We do not sell personal data');
  });

  it('keeps a third-party product name out of the store-facing page', () => {
    expect(html.toLowerCase()).not.toContain('linear');
  });
});
