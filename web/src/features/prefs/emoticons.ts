/**
 * Convert typed emoticons into emoji, the preference Linear keeps next to the comment
 * submit key.
 *
 * Off by default: people who write `:) ` in a code review or a status update usually mean
 * those characters. Turning it on is a habit, not a default the product should guess.
 *
 * Replacement is token-aware rather than a global search. `http://example.com` must not
 * become `http://example.com` with a grinning face in the scheme, and `foo:)bar` is not an
 * emoticon — the characters have to stand as their own token.
 */

import { getPrefs } from './prefs';

const PAIRS: readonly (readonly [string, string])[] = [
  [':)', '🙂'],
  [':(', '🙁'],
  [':D', '😃'],
  [':P', '😛'],
  [':p', '😛'],
  [';)', '😉'],
  [':/', '😕'],
  [':o', '😮'],
  [':O', '😮'],
  ['<3', '❤️'],
];

const TOKEN = new RegExp(
  `(^|\\s)(${PAIRS.map(([from]) => from.replace(/[)(/]/g, '\\$&')).join('|')})(?=\\s|$)`,
  'g',
);

const TO_EMOJI = new Map(PAIRS);

export function expandEmoticons(text: string): string {
  return text.replace(TOKEN, (match, lead: string, token: string) => {
    const emoji = TO_EMOJI.get(token);
    return emoji === undefined ? match : `${lead}${emoji}`;
  });
}

/** Comments honour the preference; issue mutations stay clear of prefs so the command menu can load. */
export function maybeExpandEmoticons(text: string): string {
  return getPrefs().convertEmoticons ? expandEmoticons(text) : text;
}
