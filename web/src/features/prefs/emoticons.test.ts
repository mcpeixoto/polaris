/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expandEmoticons, maybeExpandEmoticons } from './emoticons';
import { setPrefs } from './prefs';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
});

afterEach(() => {
  memory.clear();
});

describe('expandEmoticons', () => {
  it('turns a trailing smile into an emoji', () => {
    expect(expandEmoticons('shipped :)')).toBe('shipped 🙂');
  });

  it('leaves a URL alone', () => {
    expect(expandEmoticons('see http://example.com')).toBe('see http://example.com');
  });

  it('does not rewrite a smile glued to a word', () => {
    expect(expandEmoticons('foo:)bar')).toBe('foo:)bar');
  });

  it('expands several in one body', () => {
    expect(expandEmoticons(':) then :( and <3')).toBe('🙂 then 🙁 and ❤️');
  });
});

describe('maybeExpandEmoticons', () => {
  it('leaves text alone when the preference is off', () => {
    expect(maybeExpandEmoticons('shipped :)')).toBe('shipped :)');
  });

  it('expands when the preference is on', () => {
    setPrefs({ convertEmoticons: true });
    expect(maybeExpandEmoticons('shipped :)')).toBe('shipped 🙂');
  });
});
