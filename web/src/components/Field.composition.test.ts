/**
 * The one rule about these stylesheets that a rendering test cannot reach.
 *
 * Input, Textarea and Select each `composes: control from './Field.module.css'`, which puts
 * two class names on one element at the same specificity. When a variant then overrides
 * something `.control` declared, the cascade has no specificity to break the tie and falls
 * through to the order the *bundler* emitted the two files in — a fact about module graph
 * traversal that no one writing the CSS can see, and that changes when an import moves.
 *
 * It had already gone wrong. In a shipped build, Input's `.plain` was emitted before
 * `.control`, so `.control` won: the unboxed title field rendered with a full border, a white
 * fill and, on focus, the entire boxed ring — the exact treatment its own stylesheet spends a
 * paragraph arguing against. Textarea's identical construction happened to be emitted after
 * Field's and won, which is not a fix, it is the same bug passing.
 *
 * So this file asserts the fix is written as specificity rather than luck. It reads the CSS
 * as text because that is where the invariant lives: vitest runs with `css: false`, so no
 * computed style exists to interrogate, and even with styles on, jsdom would only report
 * whichever rule won in that run — which is the thing under suspicion. Text is also what a
 * future "simplification" would touch, and catching that is the point.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(join(here, name), 'utf8');
}

/** Selectors only, with comments and declaration blocks stripped out of the way. */
function selectorsOf(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((chunk) => chunk.slice(0, chunk.indexOf('{')).trim())
    .filter((selector) => selector !== '' && !selector.startsWith('@'))
    .flatMap((selector) => selector.split(',').map((one) => one.trim()));
}

/** The rule body for an exact selector, comments removed. */
function ruleFor(source: string, selector: string): string {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const index = stripped.indexOf(`${selector} {`);
  expect(index, `expected a rule for \`${selector}\``).toBeGreaterThan(-1);
  return stripped.slice(index, stripped.indexOf('}', index));
}

/**
 * The three surfaces that compose Field's control, and the classes each of them puts on that
 * same element. A variant here must never lead a selector on its own.
 */
const SURFACES: readonly {
  readonly file: string;
  readonly base: string;
  readonly variants: readonly string[];
}[] = [
  { file: 'Input.module.css', base: 'box', variants: ['plain', 'invalid'] },
  { file: 'Textarea.module.css', base: 'textarea', variants: ['plain', 'invalid'] },
  { file: 'Select.module.css', base: 'box', variants: ['hasPrefix', 'invalid'] },
];

describe('composed control surfaces', () => {
  it.each(SURFACES)('$file declares the base class it composes into', ({ file, base }) => {
    expect(ruleFor(css(file), `.${base}`)).toContain("composes: control from './Field.module.css'");
  });

  /**
   * The general form of the bug, rather than the two instances of it. A variant standing
   * alone on the element it styles is one class against `.control`'s one class, whatever it
   * declares — so the check is on the selector's shape and needs no list of guarded
   * properties.
   *
   * It is the *last* compound that matters, because that is the element the rule paints.
   * `.hasPrefix .select` opens padding on the inner control, which never carries `.control`
   * and so has no tie to lose; `.plain:focus-within` paints the composing element itself and
   * does.
   *
   * A rule whose body is nothing but a `composes` is exempt as well: it declares no property,
   * so there is nothing for the cascade to decide.
   */
  it.each(SURFACES)(
    '$file never overrides the base from a lone variant class',
    ({ file, base, variants }) => {
      const source = css(file);
      const offenders = selectorsOf(source).filter((selector) => {
        const compounds = selector.split(/[\s>+~]+/).filter(Boolean);
        const painted = compounds[compounds.length - 1] ?? '';
        const classes = [...painted.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]);
        if (!classes.some((name) => name !== undefined && variants.includes(name))) {
          return false;
        }
        if (classes.includes(base)) return false;
        return !/^[^{]*\{\s*composes:[^;]+;\s*$/.test(ruleFor(source, selector));
      });

      expect(offenders).toEqual([]);
    },
  );

  /**
   * The specific rules the bug was found in, named so that deleting one is a test failure
   * rather than a silent return to the boxed field.
   */
  it('Input pins the plain surface, its focus edge and its error edge on two classes', () => {
    const source = css('Input.module.css');
    expect(selectorsOf(source)).toEqual(
      expect.arrayContaining(['.box.plain', '.box.plain:focus-within', '.box.plain.invalid']),
    );
  });

  it('Textarea pins the same three, having previously won only on emission order', () => {
    const selectors = selectorsOf(css('Textarea.module.css'));
    expect(selectors).toEqual(
      expect.arrayContaining([
        '.textarea.plain',
        '.textarea.plain:focus-within',
        '.textarea.plain.invalid',
      ]),
    );
  });

  /**
   * Focus is never removed, only relocated. Both plain surfaces drop the ring on purpose —
   * the variant exists to have no boundary — so each has to draw its replacement in the same
   * rule, or the field answers a Tab with nothing at all. Textarea's did exactly that.
   */
  it.each([
    ['Input.module.css', '.box.plain:focus-within'],
    ['Textarea.module.css', '.textarea.plain:focus-within'],
  ])('%s replaces the ring it removes in %s', (file, selector) => {
    const rule = ruleFor(css(file), selector);
    expect(rule).toContain('outline: none');
    expect(rule).toContain('border-bottom-color: var(--border-focus)');
  });

  it('marks an invalid plain field with the same single edge, in the error colour', () => {
    for (const [file, selector] of [
      ['Input.module.css', '.box.plain.invalid'],
      ['Textarea.module.css', '.textarea.plain.invalid'],
    ] as const) {
      const rule = ruleFor(css(file), selector);
      expect(rule).toContain('border-color: transparent');
      expect(rule).toContain('border-bottom-color: var(--priority-urgent)');
    }
  });
});
