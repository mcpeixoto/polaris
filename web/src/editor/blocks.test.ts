import { describe, expect, it } from 'vitest';

import { BLOCKS, BLOCK_ORDER, insertBlock } from './blocks';

describe('BLOCKS', () => {
  it('gives every offered block a matchable label', () => {
    for (const kind of BLOCK_ORDER) {
      expect(BLOCKS[kind].label.trim()).not.toBe('');
    }
  });

  it('offers the eight blocks the slash menu promises', () => {
    expect(BLOCK_ORDER.map((kind) => BLOCKS[kind].label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Code block',
      'Quote',
      'Divider',
    ]);
  });
});

describe('insertBlock', () => {
  it('replaces the query the user typed after the slash', () => {
    // "/head" typed at the start of an empty description.
    expect(insertBlock({ text: '/head', caret: 5 }, 0, 'heading1')).toEqual({
      text: '# ',
      caret: 2,
    });
  });

  it('starts a new line when the slash was not at the start of one', () => {
    expect(insertBlock({ text: 'Ship it /', caret: 9 }, 8, 'bulleted')).toEqual({
      text: 'Ship it \n- ',
      caret: 11,
    });
  });

  it('does not add a line when the slash already starts a line', () => {
    expect(insertBlock({ text: 'Ship it\n/', caret: 9 }, 8, 'quote')).toEqual({
      text: 'Ship it\n> ',
      caret: 10,
    });
  });

  it('keeps whatever followed the query', () => {
    expect(insertBlock({ text: '/\nafter', caret: 1 }, 0, 'numbered')).toEqual({
      text: '1. \nafter',
      caret: 3,
    });
  });

  it('leaves the caret between the fences of a code block', () => {
    const next = insertBlock({ text: '/code', caret: 5 }, 0, 'code');
    expect(next.text).toBe('```\n\n```');
    expect(next.caret).toBe(4);
    expect(next.text.slice(0, next.caret)).toBe('```\n');
  });
});
