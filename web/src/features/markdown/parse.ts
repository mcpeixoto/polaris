/**
 * Markdown, as far as reading it goes.
 *
 * A document in this product is stored as markdown and, until now, shown as its own source:
 * every reader saw `## Heading` where a heading belonged. This is the parser behind the
 * read-only view that fixes that — the smallest grammar that makes a written document read
 * like one, and deliberately not a second editor.
 *
 * It is a parser rather than a string-replacer, and it emits data rather than HTML, because
 * the renderer builds React elements from what comes out. Nothing here can produce markup,
 * so a document body cannot inject a `<script>`, an `onerror`, or a `javascript:` link into
 * the page no matter what somebody types into it — the sanitising is the shape of the type,
 * not a filter somebody has to remember to run.
 *
 * What it does not do: tables, footnotes, nested lists, reference links, HTML passthrough.
 * Those belong to the editor slice, and a half-parsed table is worse than a visible pipe.
 */

export interface InlineText {
  readonly kind: 'text';
  readonly text: string;
}

export interface InlineStrong {
  readonly kind: 'strong';
  readonly children: readonly Inline[];
}

export interface InlineEmphasis {
  readonly kind: 'emphasis';
  readonly children: readonly Inline[];
}

export interface InlineCode {
  readonly kind: 'code';
  readonly text: string;
}

export interface InlineLink {
  readonly kind: 'link';
  readonly href: string;
  readonly children: readonly Inline[];
}

export type Inline = InlineText | InlineStrong | InlineEmphasis | InlineCode | InlineLink;

export interface HeadingBlock {
  readonly kind: 'heading';
  /** 1-6, as written. The renderer decides which element that maps to. */
  readonly level: number;
  readonly children: readonly Inline[];
}

export interface ParagraphBlock {
  readonly kind: 'paragraph';
  readonly children: readonly Inline[];
}

export interface CodeBlock {
  readonly kind: 'code';
  readonly language: string;
  readonly text: string;
}

export interface ListBlock {
  readonly kind: 'list';
  readonly ordered: boolean;
  readonly items: readonly (readonly Inline[])[];
}

export interface QuoteBlock {
  readonly kind: 'quote';
  readonly children: readonly Inline[];
}

export interface RuleBlock {
  readonly kind: 'rule';
}

export type Block = HeadingBlock | ParagraphBlock | CodeBlock | ListBlock | QuoteBlock | RuleBlock;

/**
 * The schemes a link is allowed to carry.
 *
 * Anything else — `javascript:`, `data:`, `vbscript:`, a scheme nobody has invented yet —
 * is rendered as its own text rather than as a link. A reader can still see where it points
 * and copy it; what they cannot do is follow it by accident from a document a stranger with
 * write access wrote.
 */
const SAFE_SCHEME = /^(https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === '') return null;
  // A scheme-relative URL (`//evil.example`) inherits the page's scheme, so it is a link
  // to somewhere else however harmless the characters look. In-app paths and fragments are
  // fine and are how a document points at an issue.
  if (trimmed.startsWith('//')) return null;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  if (!HAS_SCHEME.test(trimmed)) return null;
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

/** Splits a document body into blocks. Never throws: anything unrecognised is a paragraph. */
export function parseMarkdown(source: string): readonly Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Fenced code first: everything inside it is literal, including the characters every
    // other rule below is looking for.
    const fence = /^```(.*)$/.exec(line);
    if (fence !== null) {
      const language = (fence[1] ?? '').trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      // An unterminated fence runs to the end of the document, which is what the writer is
      // looking at while they are still typing it.
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language, text: body.join('\n') });
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        children: parseInline((heading[2] ?? '').replace(/\s+#+\s*$/, '')),
      });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^ {0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', children: parseInline(quoted.join(' ').trim()) });
      continue;
    }

    const bullet = /^ {0,3}[-*+]\s+(.*)$/.exec(line);
    const ordered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items: (readonly Inline[])[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = isOrdered
          ? /^ {0,3}\d+[.)]\s+(.*)$/.exec(current)
          : /^ {0,3}[-*+]\s+(.*)$/.exec(current);
        if (match === null) break;
        items.push(parseInline(match[1] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    // A paragraph runs until a blank line or the start of any other block, so a heading
    // written directly under a sentence still becomes a heading.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || startsBlock(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

function startsBlock(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^ {0,3}#{1,6}\s/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}[-*+]\s/.test(line) ||
    /^ {0,3}\d+[.)]\s/.test(line) ||
    /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

/**
 * Inline spans, innermost-last.
 *
 * Code is matched before everything else because backticks suspend the other rules — the
 * whole point of `**not bold**` in code is that it is not bold.
 */
export function parseInline(source: string): readonly Inline[] {
  const nodes: Inline[] = [];
  let text = '';
  let index = 0;

  const flush = () => {
    if (text !== '') {
      nodes.push({ kind: 'text', text });
      text = '';
    }
  };

  while (index < source.length) {
    const rest = source.slice(index);

    const code = /^`([^`]+)`/.exec(rest);
    if (code !== null) {
      flush();
      nodes.push({ kind: 'code', text: code[1] ?? '' });
      index += code[0].length;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
    if (link !== null) {
      const href = safeHref(link[2] ?? '');
      flush();
      if (href === null) {
        // Shown as it was written. A reader can see the destination and decide; nothing on
        // the page will take them there in one click.
        nodes.push({ kind: 'text', text: link[0] });
      } else {
        nodes.push({ kind: 'link', href, children: parseInline(link[1] ?? '') });
      }
      index += link[0].length;
      continue;
    }

    const strong = /^(\*\*|__)(.+?)\1/.exec(rest);
    if (strong !== null) {
      flush();
      nodes.push({ kind: 'strong', children: parseInline(strong[2] ?? '') });
      index += strong[0].length;
      continue;
    }

    const emphasis = /^(\*|_)([^*_]+?)\1/.exec(rest);
    if (emphasis !== null) {
      flush();
      nodes.push({ kind: 'emphasis', children: parseInline(emphasis[2] ?? '') });
      index += emphasis[0].length;
      continue;
    }

    // A backslash escapes the character after it, which is how a document writes a literal
    // asterisk in a sentence about markdown.
    if (rest.startsWith('\\') && rest.length > 1) {
      text += rest[1];
      index += 2;
      continue;
    }

    text += source[index];
    index += 1;
  }

  flush();
  return nodes;
}
