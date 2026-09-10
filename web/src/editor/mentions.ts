/**
 * @mention tokens in markdown bodies.
 *
 * The server notifies on `@[Display Name](user:<uuid>)` (see notify.ParseMentions). The name
 * is what was typed; the id is what is stored — so a rename does not break an old mention,
 * and a client that knows nothing about mentions still sees an ordinary markdown-ish link.
 *
 * Deliberately not bare `@name`. Display names are neither unique nor stable.
 */

import type { EditorState } from './inputRules';

const USER_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The wire form the notify package parses. */
export function mentionToken(name: string, userId: string): string {
  return `@[${name}](user:${userId})`;
}

export function isUserId(value: string): boolean {
  return USER_ID.test(value);
}

/**
 * Where an unfinished `@query` runs, if the caret is inside one.
 *
 * Opens only after a word boundary so an email address does not become a mention picker.
 * Stops at whitespace or another `@`, so a second mention can start on the same line.
 */
export function findMentionQuery(
  text: string,
  caret: number,
): { readonly start: number; readonly query: string } | null {
  if (caret < 1 || caret > text.length) return null;
  let start = caret - 1;
  while (start >= 0) {
    const ch = text[start] ?? '';
    if (ch === '@') break;
    if (/\s/.test(ch)) return null;
    start -= 1;
  }
  if (start < 0 || text[start] !== '@') return null;
  const before = start === 0 ? '' : (text[start - 1] ?? '');
  if (before !== '' && !/\s/.test(before)) return null;
  const query = text.slice(start + 1, caret);
  // A completed token already has `[` right after `@`. Leave it alone.
  if (query.startsWith('[')) return null;
  return { start, query };
}

/**
 * Replace the `@query` from `from` to the caret with a mention token and a trailing space.
 */
export function insertMention(
  state: EditorState,
  from: number,
  name: string,
  userId: string,
): EditorState {
  const token = `${mentionToken(name, userId)} `;
  return {
    text: state.text.slice(0, from) + token + state.text.slice(state.caret),
    caret: from + token.length,
  };
}
