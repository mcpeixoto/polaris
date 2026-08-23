#!/usr/bin/env node
// Every optimistic create must be able to meet the server's row.
//
// The bug this exists to stop has been shipped five times, by five different features, each
// found by a user rather than by a test: comments and relations, issue subscriptions,
// attachments, project dependencies. The shape is always the same. An entity whose id the
// API mints is rendered under an id the client invented, and the two are paired in the tail
// of the mutation's own `await` — which works right up until the `await` is not there to
// finish: a reload, a navigation, a 429 that sends the op to the outbox, a response that
// never comes. The stand-in is persisted, like every optimistic write, so it survives; the
// server's row then lands beside it; and the user has one comment, one link, one attachment
// twice, in a replica where both rows are equally real. No amount of reloading clears it.
//
// `SyncEngine.mutate` carries the same rule as a runtime assertion, and that one is exact —
// it reads the ids and the variables rather than guessing at them. This is the half that
// runs on code no test reaches. It is deliberately crude, in the manner of the other lints
// here: brace-matched text, not a parser. A parser would be more precise and would be the
// thing that rots.
//
// The rule, per `engine.mutate` call:
//
//   for every entry in `optimistic` with `before: null` and a non-null `after`
//     the entry's id must appear in `variables` (the client minted it and sent it)
//     or be named by a `reconcile` spec (the server mints it and this is how they meet)
//
// A create whose id was sent needs nothing: the response upserts over the same key. That is
// why `createIssue` passes, and why it would start failing the day somebody stopped sending
// the id — which is exactly the change that would put the bug back.
//
// What it cannot see, and `mutate`'s assertion can: a patch assembled by a helper, and an
// upsert whose `before` is a variable that is sometimes null. Neither is a reason to skip
// the cheap check; both are the reason there are two of them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'web', 'src');

/** Every non-test .ts/.tsx under web/src. */
function sources(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/** The text between a balanced pair, starting at `from`, which must be an opener. */
function balanced(text, from) {
  const openers = '([{';
  const closers = ')]}';
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (openers.includes(text[i])) depth++;
    else if (closers.includes(text[i])) {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

/** The value of one key in an object literal, as text, or '' when the key is absent. */
function field(object, key) {
  const at = new RegExp(`\\b${key}\\s*:\\s*`).exec(object);
  if (at === null) return '';
  const from = at.index + at[0].length;
  return '[{'.includes(object[from]) ? (balanced(object, from) ?? '') : '';
}

/** The top-level object literals inside an array literal. */
function elements(array) {
  const found = [];
  let depth = 0;
  let start = null;
  for (let i = 0; i < array.length; i++) {
    const c = array[i];
    if (c === '{') {
      if (depth === 1) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 1 && start !== null) {
        found.push(array.slice(start, i + 1));
        start = null;
      }
    } else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return found;
}

/** Every `.mutate(...)` / `.mutate<...>(...)` argument object in one file. */
function mutateCalls(text) {
  const calls = [];
  for (const hit of text.matchAll(/\.mutate\s*(<)?/g)) {
    let at = hit.index + hit[0].length;
    if (hit[1] !== undefined) {
      // Step over the type argument, which nests.
      let depth = 1;
      while (depth > 0 && at < text.length) {
        if (text[at] === '<') depth++;
        else if (text[at] === '>') depth--;
        at++;
      }
    }
    while (at < text.length && /\s/.test(text[at])) at++;
    if (text[at] !== '(') continue;
    const body = balanced(text, at);
    if (body === null) continue;
    calls.push({ body, line: text.slice(0, hit.index).split('\n').length });
  }
  return calls;
}

let failures = 0;

for (const path of sources(SRC)) {
  const text = readFileSync(path, 'utf8');
  for (const call of mutateCalls(text)) {
    const optimistic = field(call.body, 'optimistic');
    if (optimistic === '') continue;
    const variables = field(call.body, 'variables');
    const reconcile = field(call.body, 'reconcile');

    for (const entry of elements(optimistic)) {
      const flat = entry.replace(/\s+/g, ' ');
      if (!/before: null/.test(flat) || /after: null/.test(flat)) continue;

      // `id: something` or the shorthand `id,`.
      const named = /\bid:\s*([A-Za-z0-9_.]+)/.exec(flat);
      const id = named === null ? (/,\s*id\s*,/.test(flat) ? 'id' : null) : named[1];
      // An id built inline is beyond a text check. `mutate`'s assertion has the real value.
      if (id === null) continue;

      const root = id.split('.')[0];
      const mentions = new RegExp(`\\b${root}\\b`);
      if (mentions.test(variables)) continue;
      if (new RegExp(`\\b${id.replace(/\./g, '\\.')}\\b`).test(reconcile)) continue;
      // A `reconcile` derived from the same list the patch was — `applications.map(...)`.
      if (reconcile !== '' && mentions.test(reconcile)) continue;

      failures++;
      console.log(
        `FAIL: ${relative(ROOT, path)}:${call.line}: renders ${flat.slice(0, 60)}… under an id it does not send`,
      );
      console.log(
        `      Declare \`reconcile\` for ${id}, or send the id, or the server's row will land beside this one.`,
      );
    }
  }
}

if (failures === 0) console.log('optimistic creates: ok');
process.exit(failures === 0 ? 0 : 1);
