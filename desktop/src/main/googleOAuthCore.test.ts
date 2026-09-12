/**
 * Unit tests for the pure half of desktop Google sign-in.
 *
 * Run with `node --import tsx --test` is not wired: the desktop package compiles with tsc
 * first. These run after `npm run build:electron` via `node --test dist/main/googleOAuthCore.test.js`,
 * or directly against the TypeScript through the package's test script.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  base64URL,
  buildAttempt,
  challengeFor,
  formEncode,
  GOOGLE_OAUTH_REDIRECT_URI,
  idTokenFromTokenResponse,
  readCallback,
} from './googleOAuthCore.js';

describe('base64URL', () => {
  it('uses the URL alphabet and drops padding', () => {
    const encoded = base64URL(Buffer.from([0xfb, 0xff, 0xbf]));
    assert.equal(encoded.includes('+'), false);
    assert.equal(encoded.includes('/'), false);
    assert.equal(encoded.includes('='), false);
    // Same bytes in standard base64 are '+/+/'; the URL form must differ only by alphabet.
    assert.equal(Buffer.from([0xfb, 0xff, 0xbf]).toString('base64'), '+/+/');
    assert.equal(encoded, '-_-_');
  });
});

describe('challengeFor', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    // verifier from the RFC; challenge must be the published S256 value.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = base64URL(createHash('sha256').update(verifier, 'utf8').digest());
    assert.equal(challengeFor(verifier), expected);
    assert.equal(challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('buildAttempt', () => {
  it('pins the authorization URL to the injected entropy', () => {
    const entropy = (n: number) => Buffer.alloc(n, n === 32 ? 1 : 2);
    const attempt = buildAttempt(
      'client.apps.googleusercontent.com',
      GOOGLE_OAUTH_REDIRECT_URI,
      entropy,
    );
    const url = new URL(attempt.url);

    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), 'client.apps.googleusercontent.com');
    assert.equal(url.searchParams.get('redirect_uri'), GOOGLE_OAUTH_REDIRECT_URI);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), challengeFor(attempt.codeVerifier));
    assert.equal(url.searchParams.get('state'), attempt.state);
    assert.equal(url.searchParams.get('nonce'), attempt.nonce);
    assert.equal(url.searchParams.get('prompt'), 'select_account');
    assert.equal(attempt.codeVerifier, base64URL(Buffer.alloc(32, 1)));
    assert.equal(attempt.state, base64URL(Buffer.alloc(16, 2)));
    assert.equal(attempt.nonce, base64URL(Buffer.alloc(16, 2)));
  });
});

describe('readCallback', () => {
  it('accepts a matching code', () => {
    const url = new URL('http://127.0.0.1:42773/oauth2redirect?state=s1&code=4/abc');
    assert.deepEqual(readCallback(url, 's1'), { code: '4/abc' });
  });

  it('treats access_denied as a quiet cancel', () => {
    const url = new URL('http://127.0.0.1:42773/oauth2redirect?state=s1&error=access_denied');
    assert.deepEqual(readCallback(url, 's1'), { cancelled: true });
  });

  it('rejects a mismatched state before reading the code', () => {
    const url = new URL('http://127.0.0.1:42773/oauth2redirect?state=other&code=4/abc');
    assert.deepEqual(readCallback(url, 's1'), { error: 'that sign-in could not be verified' });
  });
});

describe('idTokenFromTokenResponse', () => {
  it('returns the id_token', () => {
    assert.equal(idTokenFromTokenResponse({ id_token: 'eyJ.header.sig' }), 'eyJ.header.sig');
  });

  it("refuses an error body without echoing Google's developer sentence", () => {
    assert.throws(
      () =>
        idTokenFromTokenResponse({
          error: 'invalid_grant',
          error_description: 'Malformed auth code.',
        }),
      /could not be completed/,
    );
  });
});

describe('formEncode', () => {
  it('percent-encodes values', () => {
    assert.equal(
      formEncode([
        ['a', 'b c'],
        ['d', 'e=f'],
      ]),
      'a=b%20c&d=e%3Df',
    );
  });
});
