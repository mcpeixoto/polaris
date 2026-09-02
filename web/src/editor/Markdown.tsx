/**
 * Read-only markdown, rendered as elements.
 *
 * Every body this product stores — an issue description, a comment, a reply — is markdown
 * source, because the editor is a markdown textarea. Until a rich editor lands this is the
 * other half of that bargain: markdown in, formatted text out, for every surface that only
 * ever *displays* a body. Before it existed a comment reading "**not** the cookie" rendered
 * with its asterisks, which is the product telling the writer their formatting did nothing.
 *
 * It builds React elements and never touches `dangerouslySetInnerHTML`. That is the whole
 * security model and it is worth saying out loud, because the obvious shortcut — hand a
 * markdown library's HTML string to React — puts stored XSS on a field every member of the
 * workspace can write into. Anything this parser does not recognise falls through as text
 * and is escaped by React on the way out.
 *
 * The grammar is deliberately the subset the editor's own input rules and slash menu can
 * produce: headings, emphasis, inline code, fenced code, links, quotes and both list kinds.
 * Tables, footnotes and reference links are not in it, and render as the source lines they
 * are rather than being silently swallowed.
 */

import { Fragment, type ReactNode } from 'react';

import styles from './Markdown.module.css';

interface MarkdownProps {
  readonly text: string;
  readonly className?: string | undefined;
}

/**
 * Schemes we are willing to put in an `href`.
 *
 * A link is the one place a markdown body hands the reader something clickable, and
 * `javascript:` in a `[label](…)` is script execution on a click. An unlisted scheme is not
 * dropped — the link renders as its own label text, so nothing the writer typed disappears.
 */
const SAFE_SCHEME = /^(?:https?:|mailto:)/i;

function hrefFor(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

/**
 * Inline spans, longest-marker-first so `**bold**` is not read as an empty emphasis.
 *
 * Code is first for the reason it is first in every markdown implementation: a backtick
 * span suppresses everything inside it, so `` `**x**` `` is two asterisks and a letter.
 */
const INLINE: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'code', pattern: /`([^`\n]+)`/ },
  { kind: 'link', pattern: /\[([^\]\n]*)\]\(([^)\s]*)\)/ },
  { kind: 'strong', pattern: /\*\*([^\n]+?)\*\*/ },
  { kind: 'strong', pattern: /__([^\n]+?)__/ },
  { kind: 'strike', pattern: /~~([^\n]+?)~~/ },
  { kind: 'em', pattern: /\*([^*\n]+)\*/ },
  { kind: 'em', pattern: /_([^_\n]+)_/ },
];

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;

  while (rest !== '') {
    let best: { kind: string; match: RegExpExecArray } | null = null;
    for (const rule of INLINE) {
      const match = rule.pattern.exec(rest);
      if (match === null) continue;
      if (best === null || match.index < best.match.index) best = { kind: rule.kind, match };
    }
    if (best === null) {
      out.push(rest);
      break;
    }

    const { kind, match } = best;
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const inner = match[1] ?? '';
    const childKey = `${key}-${n}`;
    n += 1;

    if (kind === 'code') {
      out.push(
        <code key={childKey} className={styles.code}>
          {inner}
        </code>,
      );
    } else if (kind === 'link') {
      const href = hrefFor(match[2] ?? '');
      const label = renderInline(inner === '' ? (match[2] ?? '') : inner, childKey);
      out.push(
        href === null ? (
          <Fragment key={childKey}>{label}</Fragment>
        ) : (
          // Underlined by the stylesheet, not distinguished by colour alone: the accent
          // does not clear 3:1 against body text in either theme.
          <a key={childKey} className={styles.link} href={href} rel="noreferrer noopener">
            {label}
          </a>
        ),
      );
    } else if (kind === 'strong') {
      out.push(<strong key={childKey}>{renderInline(inner, childKey)}</strong>);
    } else if (kind === 'strike') {
      out.push(<del key={childKey}>{renderInline(inner, childKey)}</del>);
    } else {
      out.push(<em key={childKey}>{renderInline(inner, childKey)}</em>);
    }

    rest = rest.slice(match.index + match[0].length);
  }

  return out;
}

/** A soft newline inside a paragraph is a line break, because that is what the writer saw. */
function renderLines(lines: readonly string[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) out.push(<br key={`${key}-br-${index}`} />);
    out.push(...renderInline(line, `${key}-${index}`));
  });
  return out;
}

const HEADING = /^(#{1,6}) +(.*)$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const FENCE = /^[ \t]*```([A-Za-z0-9+#-]*)[ \t]*$/;
const BULLET = /^[ \t]*[-*+] +(.*)$/;
const ORDERED = /^[ \t]*(\d+)[.)] +(.*)$/;
const QUOTE = /^[ \t]*> ?(.*)$/;

function renderBlocks(source: string, key: string): ReactNode[] {
  const lines = source.split('\n');
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const blockKey = `${key}-${i}`;

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      // A run-on fence — no closing line — still renders as code rather than as the rest of
      // the document in monospace-shaped limbo.
      i += 1;
      const language = fence[1] ?? '';
      out.push(
        <pre key={blockKey} className={styles.pre}>
          <code {...(language === '' ? {} : { 'data-language': language })}>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (RULE.test(line)) {
      out.push(<hr key={blockKey} className={styles.rule} />);
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = Math.min((heading[1] ?? '#').length, 6);
      // The renderer draws headings at their markdown level, but a body is nested inside a
      // screen that already has an `h1`/`h2`, so these start at `h3` and clamp at `h6`.
      const Tag = `h${String(Math.min(level + 2, 6))}` as 'h3';
      out.push(
        <Tag key={blockKey} className={styles.heading}>
          {renderInline(heading[2] ?? '', blockKey)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i] ?? '');
        if (quoted === null) break;
        body.push(quoted[1] ?? '');
        i += 1;
      }
      out.push(
        <blockquote key={blockKey} className={styles.quote}>
          {renderBlocks(body.join('\n'), blockKey)}
        </blockquote>,
      );
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered !== null) {
      const items: string[] = [];
      const start = Number(ordered[1] ?? '1');
      while (i < lines.length) {
        const item = ORDERED.exec(lines[i] ?? '');
        if (item === null) break;
        items.push(item[2] ?? '');
        i += 1;
      }
      out.push(
        <ol key={blockKey} className={styles.list} {...(start === 1 ? {} : { start })}>
          {items.map((item, index) => (
            <li key={`${blockKey}-${index}`}>{renderInline(item, `${blockKey}-${index}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = BULLET.exec(lines[i] ?? '');
        if (item === null) break;
        items.push(item[1] ?? '');
        i += 1;
      }
      out.push(
        <ul key={blockKey} className={styles.list}>
          {items.map((item, index) => (
            <li key={`${blockKey}-${index}`}>{renderInline(item, `${blockKey}-${index}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (
        next.trim() === '' ||
        FENCE.test(next) ||
        RULE.test(next) ||
        HEADING.test(next) ||
        QUOTE.test(next) ||
        BULLET.test(next) ||
        ORDERED.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      i += 1;
    }
    out.push(
      <p key={blockKey} className={styles.paragraph}>
        {renderLines(paragraph, blockKey)}
      </p>,
    );
  }

  return out;
}

/** Renders `text` as markdown. Safe for any user-supplied string. */
export function Markdown({ text, className }: MarkdownProps) {
  const classes = className === undefined ? styles.root : `${styles.root} ${className}`;
  return <div className={classes}>{renderBlocks(text, 'b')}</div>;
}
