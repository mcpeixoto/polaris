import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Markdown } from './Markdown';

afterEach(cleanup);

function draw(text: string): HTMLElement {
  const { container } = render(<Markdown text={text} />);
  return container.firstElementChild as HTMLElement;
}

describe('Markdown', () => {
  it('renders a paragraph, keeping a soft newline as a line break', () => {
    const root = draw('one\ntwo');
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelectorAll('br')).toHaveLength(1);
    expect(root.textContent).toBe('onetwo');
  });

  it('separates paragraphs on a blank line', () => {
    expect(draw('one\n\ntwo').querySelectorAll('p')).toHaveLength(2);
  });

  it('renders headings under the screen’s own heading levels', () => {
    const root = draw('# Title\n\n### Deeper');
    expect(root.querySelector('h3')?.textContent).toBe('Title');
    expect(root.querySelector('h5')?.textContent).toBe('Deeper');
  });

  it('renders bold, italic, strikethrough and inline code', () => {
    const root = draw('**bold** and _soft_ and ~~gone~~ and `code()`');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelector('em')?.textContent).toBe('soft');
    expect(root.querySelector('del')?.textContent).toBe('gone');
    expect(root.querySelector('code')?.textContent).toBe('code()');
  });

  it('does not read emphasis inside inline code', () => {
    const root = draw('`**x**`');
    expect(root.querySelector('strong')).toBeNull();
    expect(root.querySelector('code')?.textContent).toBe('**x**');
  });

  it('renders a fenced code block verbatim', () => {
    const root = draw('```ts\nconst a = **1**;\n```');
    const block = root.querySelector('pre code');
    expect(block?.textContent).toBe('const a = **1**;');
    expect(block?.getAttribute('data-language')).toBe('ts');
  });

  it('renders both list kinds and keeps a numbered list’s start', () => {
    const bullets = draw('- one\n- two');
    expect([...bullets.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual([
      'one',
      'two',
    ]);
    const numbers = draw('3. three\n4. four');
    expect(numbers.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(numbers.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders a blockquote, parsing the blocks inside it', () => {
    const root = draw('> ## Quoted\n> body');
    expect(root.querySelector('blockquote h4')?.textContent).toBe('Quoted');
  });

  it('renders a thematic break', () => {
    expect(draw('one\n\n---\n\ntwo').querySelector('hr')).not.toBeNull();
  });

  it('links an http url', () => {
    render(<Markdown text="see [the docs](https://example.com/x)" />);
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('href')).toBe('https://example.com/x');
  });

  /**
   * The two cases that make this renderer safe to point at a field any workspace member can
   * write into. Nothing here goes near `dangerouslySetInnerHTML`, so the first is React's
   * guarantee — but a regression to a markdown library's HTML string output would break it
   * silently, and this is the test that would not let it.
   */
  it('never injects markup from the body', () => {
    const root = draw('<img src=x onerror="boom()"> **still bold**');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="boom()">');
    expect(root.querySelector('strong')?.textContent).toBe('still bold');
  });

  it('refuses a javascript: link and renders its label as text', () => {
    const root = draw('[click](javascript:boom)');
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toBe('click');
  });
});
