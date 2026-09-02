/**
 * The parser's job is twofold: make a written document read like one, and make it
 * impossible for a document body to become markup. The second half is the half worth the
 * most tests — a document is written by anyone with write access and read by everyone.
 */

import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, safeHref, type Block } from './parse';

function kinds(blocks: readonly Block[]): string[] {
  return blocks.map((block) => block.kind);
}

describe('parseMarkdown', () => {
  it('reads a heading as a heading rather than as its own source', () => {
    const [block] = parseMarkdown('## Heading');

    expect(block).toEqual({
      kind: 'heading',
      level: 2,
      children: [{ kind: 'text', text: 'Heading' }],
    });
  });

  it('keeps consecutive lines in one paragraph and separates on a blank line', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');

    expect(kinds(blocks)).toEqual(['paragraph', 'paragraph']);
    expect(blocks[0]).toMatchObject({ children: [{ kind: 'text', text: 'one two' }] });
  });

  it('ends a paragraph at a heading written directly under it', () => {
    expect(kinds(parseMarkdown('a sentence\n# Title'))).toEqual(['paragraph', 'heading']);
  });

  it('collects bullets and numbers into lists', () => {
    const blocks = parseMarkdown('- one\n- two\n\n1. first\n2. second');

    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    expect((blocks[0] as unknown as { items: unknown[] }).items).toHaveLength(2);
  });

  it('takes a fenced block literally, markdown characters and all', () => {
    const [block] = parseMarkdown('```ts\nconst a = **not bold**;\n```');

    expect(block).toEqual({ kind: 'code', language: 'ts', text: 'const a = **not bold**;' });
  });

  it('runs an unterminated fence to the end, which is what a half-typed one is', () => {
    const [block] = parseMarkdown('```\nstill typing');

    expect(block).toMatchObject({ kind: 'code', text: 'still typing' });
  });

  it('reads a quote and a rule', () => {
    expect(kinds(parseMarkdown('> quoted\n\n---'))).toEqual(['quote', 'rule']);
  });

  it('returns nothing for an empty body rather than an empty paragraph', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });
});

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('**b** _i_ `c`')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'emphasis', children: [{ kind: 'text', text: 'i' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c' },
    ]);
  });

  it('suspends the other rules inside backticks', () => {
    expect(parseInline('`**literal**`')).toEqual([{ kind: 'code', text: '**literal**' }]);
  });

  it('honours a backslash escape', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ kind: 'text', text: '*not italic*' }]);
  });

  it('reads a link', () => {
    expect(parseInline('[docs](https://example.com/x)')).toEqual([
      {
        kind: 'link',
        href: 'https://example.com/x',
        children: [{ kind: 'text', text: 'docs' }],
      },
    ]);
  });

  it('leaves a javascript: link as plain text', () => {
    expect(parseInline('[click](javascript:alert)')).toEqual([
      { kind: 'text', text: '[click](javascript:alert)' },
    ]);
  });

  it('never emits anything but data, so raw HTML stays text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});

describe('safeHref', () => {
  it('allows http, https, mailto, in-app paths and fragments', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeHref('/issue/ENG-1')).toBe('/issue/ENG-1');
    expect(safeHref('#section')).toBe('#section');
  });

  it('refuses every scheme that can execute or smuggle, however it is spelled', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('  javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeHref('vbscript:msgbox')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });

  it('refuses a scheme-relative URL, which points off-site while looking like a path', () => {
    expect(safeHref('//evil.example/x')).toBeNull();
  });

  it('refuses an empty href', () => {
    expect(safeHref('   ')).toBeNull();
  });
});
