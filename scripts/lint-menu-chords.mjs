#!/usr/bin/env node
/**
 * A chord drawn in a menu must be a chord the keymap actually binds.
 *
 * `MenuItem.keys` is a string the caller types by hand — `rowMenu.tsx` says so outright:
 * "supplied by the caller and never defaulted". Nothing checks it against the registry, so a
 * menu teaches a shortcut that a rename or a removal made untrue, and the only way anyone
 * finds out is by pressing it. That is the worst kind of documentation: confident and wrong,
 * shipped in the interface itself.
 *
 * The registry is the source of truth. This walks every `keys: [...]` on a registered action
 * to build the set of specs the product really binds, then walks every `keys: '...'` hint on
 * a menu item and insists it is one of them.
 *
 * It deliberately does not check that the hint belongs to the *right* action — a menu item
 * labelled "Status…" showing `p` would pass. Matching label to action needs the projection
 * this repo has not built yet; until then, "the chord exists at all" is the check that pays
 * for itself, and it is the one that catches a rename.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'web/src';

/**
 * Hints that name no chord.
 *
 * `[MouseRight]` is the glyph a menu uses to teach the right-click that opens it — a gesture,
 * not a binding, and there is nothing in the registry for it to match.
 */
const NOT_A_CHORD = new Set(['[MouseRight]']);

/** Files whose chords are demonstrations rather than promises. */
const EXEMPT = new Set([join(ROOT, 'views', 'Gallery.tsx')]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const files = walk(ROOT);

const bound = new Set();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const [, body] of source.matchAll(/\bkeys:\s*\[([^\]]*)\]/g)) {
    for (const [, spec] of body.matchAll(/'([^']*)'/g)) bound.add(spec);
  }
}

if (bound.size === 0) {
  console.error('menu chords: found no registered bindings at all — the scan is broken.');
  process.exit(1);
}

const problems = [];
for (const file of files) {
  if (EXEMPT.has(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const match = /\bkeys:\s*'([^']*)'/.exec(line);
    if (match === null) return;
    const spec = match[1];
    if (NOT_A_CHORD.has(spec) || bound.has(spec)) return;
    problems.push({ file, line: index + 1, spec });
  });
}

if (problems.length > 0) {
  console.error('menu chords: a menu teaches a chord the keymap does not bind.\n');
  for (const { file, line, spec } of problems) {
    console.error(`  ${file}:${line}  '${spec}'`);
  }
  console.error(
    '\nEither register the action, or correct the hint. A menu that names a key nothing',
  );
  console.error("listens for is worse than a menu with no hint at all — it is a promise.");
  process.exit(1);
}

console.log(`menu chords: ok (${bound.size} bound specs)`);
