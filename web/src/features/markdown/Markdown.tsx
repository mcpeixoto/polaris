/**
 * The read-only view of a markdown body.
 *
 * Built from React elements rather than from an HTML string, so there is no path from a
 * document body to markup — see parse.ts. Headings start at `<h2>` because this always
 * renders inside a screen whose `<h1>` is the thing's title; a document body that shipped
 * its own `<h1>` would give the page two.
 */

import type { ReactNode } from 'react';

import { parseMarkdown, type Block, type Inline } from './parse';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  source: string;
  /**
   * Whether links are real links.
   *
   * A rendered body that sits over an editor and hands focus to it on the first click has no
   * business holding focus stops of its own — a keyboard user would tab into anchors inside
   * a region the screen reader has been told to ignore, which is the worst of both. Those
   * callers pass `false` and get the link text with its destination in a tooltip.
   */
  interactive?: boolean | undefined;
  className?: string | undefined;
}

export function Markdown({ source, interactive = true, className }: MarkdownProps) {
  const blocks = parseMarkdown(source);
  return (
    <div className={[styles.body, className].filter(Boolean).join(' ')}>
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} interactive={interactive} />
      ))}
    </div>
  );
}

function BlockNode({ block, interactive }: { block: Block; interactive: boolean }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      // Clamped so the document's outline stays under the page's own heading, and so six
      // levels of `#` cannot walk off the end of the elements that exist.
      const level = Math.min(block.level + 1, 6);
      const Tag = `h${level}` as 'h2';
      return (
        <Tag className={styles.heading}>
          <InlineNodes nodes={block.children} interactive={interactive} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className={styles.paragraph}>
          <InlineNodes nodes={block.children} interactive={interactive} />
        </p>
      );
    case 'code':
      return (
        <pre className={styles.pre}>
          <code data-language={block.language === '' ? undefined : block.language}>
            {block.text}
          </code>
        </pre>
      );
    case 'list':
      return block.ordered ? (
        <ol className={styles.list}>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineNodes nodes={item} interactive={interactive} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className={styles.list}>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineNodes nodes={item} interactive={interactive} />
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote className={styles.quote}>
          <InlineNodes nodes={block.children} interactive={interactive} />
        </blockquote>
      );
    case 'rule':
      return <hr className={styles.rule} />;
  }
}

function InlineNodes({
  nodes,
  interactive,
}: {
  nodes: readonly Inline[];
  interactive: boolean;
}): ReactNode {
  return nodes.map((node, index) => (
    <InlineNode key={index} node={node} interactive={interactive} />
  ));
}

function InlineNode({ node, interactive }: { node: Inline; interactive: boolean }): ReactNode {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'strong':
      return (
        <strong>
          <InlineNodes nodes={node.children} interactive={interactive} />
        </strong>
      );
    case 'emphasis':
      return (
        <em>
          <InlineNodes nodes={node.children} interactive={interactive} />
        </em>
      );
    case 'code':
      return <code className={styles.code}>{node.text}</code>;
    case 'link':
      // `noreferrer` as well as `noopener`: a document is a surface anyone with write access
      // to the workspace can edit, and the referrer would tell wherever it points which
      // workspace read it.
      if (!interactive) {
        return (
          <span className={styles.link} title={node.href}>
            <InlineNodes nodes={node.children} interactive={interactive} />
          </span>
        );
      }
      return (
        <a
          className={styles.link}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <InlineNodes nodes={node.children} interactive={interactive} />
        </a>
      );
  }
}
