import { describe, expect, it } from 'vitest';

import { applyEnterRule, applySpaceRule } from './inputRules';

/** Reads a fixture with `|` marking the caret, so the cases stay legible. */
function at(marked: string): { text: string; caret: number } {
  const caret = marked.indexOf('|');
  return { text: marked.replace('|', ''), caret };
}

describe('applySpaceRule', () => {
  it('normalises a star bullet to a dash', () => {
    expect(applySpaceRule(at('*|'))).toEqual({ text: '- ', caret: 2 });
  });

  it('normalises a plus bullet to a dash', () => {
    expect(applySpaceRule(at('one\n+|'))).toEqual({ text: 'one\n- ', caret: 6 });
  });

  it('expands a bare checkbox into a checklist item', () => {
    expect(applySpaceRule(at('[]|'))).toEqual({ text: '- [ ] ', caret: 6 });
  });

  it('turns three underscores into a divider', () => {
    expect(applySpaceRule(at('___|'))).toEqual({ text: '---\n', caret: 4 });
  });

  it('leaves the canonical markers alone so the browser inserts the space', () => {
    expect(applySpaceRule(at('#|'))).toBeNull();
    expect(applySpaceRule(at('###|'))).toBeNull();
    expect(applySpaceRule(at('-|'))).toBeNull();
    expect(applySpaceRule(at('1.|'))).toBeNull();
    expect(applySpaceRule(at('>|'))).toBeNull();
  });

  it('does not fire on a marker character mid-line', () => {
    expect(applySpaceRule(at('2 *|'))).toBeNull();
    expect(applySpaceRule(at('a value of *|'))).toBeNull();
  });
});

describe('applyEnterRule', () => {
  it('continues a bulleted list', () => {
    expect(applyEnterRule(at('- one|'))).toEqual({ text: '- one\n- ', caret: 8 });
  });

  it('keeps the indent of a nested bullet', () => {
    expect(applyEnterRule(at('- one\n  - two|'))).toEqual({
      text: '- one\n  - two\n  - ',
      caret: 18,
    });
  });

  it('ends the list when the item is empty', () => {
    expect(applyEnterRule(at('- one\n- |'))).toEqual({ text: '- one\n', caret: 6 });
  });

  it('increments a numbered list', () => {
    expect(applyEnterRule(at('1. one\n2. two|'))).toEqual({
      text: '1. one\n2. two\n3. ',
      caret: 17,
    });
  });

  it('ends a numbered list on an empty item', () => {
    expect(applyEnterRule(at('1. one\n2. |'))).toEqual({ text: '1. one\n', caret: 7 });
  });

  it('continues a checklist unticked, whatever the line above was', () => {
    expect(applyEnterRule(at('- [x] done|'))).toEqual({ text: '- [x] done\n- [ ] ', caret: 17 });
  });

  it('continues a blockquote and ends it on an empty line', () => {
    expect(applyEnterRule(at('> quoted|'))).toEqual({ text: '> quoted\n> ', caret: 11 });
    expect(applyEnterRule(at('> quoted\n> |'))).toEqual({ text: '> quoted\n', caret: 9 });
  });

  it('closes an opening code fence and leaves the caret inside it', () => {
    expect(applyEnterRule(at('```ts|'))).toEqual({ text: '```ts\n\n```', caret: 6 });
  });

  it('leaves a closing fence to the browser', () => {
    expect(applyEnterRule(at('```\nbody\n```|'))).toBeNull();
  });

  it('does not continue anything from the middle of a line', () => {
    expect(applyEnterRule(at('- on|e'))).toBeNull();
  });

  it('leaves ordinary prose alone', () => {
    expect(applyEnterRule(at('just a sentence|'))).toBeNull();
  });
});
