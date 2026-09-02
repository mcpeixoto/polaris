/**
 * The blocks the slash menu can insert, and the edit that inserts one.
 *
 * Separate from the menu component for the same reason the input rules are: choosing where
 * a marker goes — on its own line, replacing the `/query` that opened the menu, with the
 * caret left somewhere useful afterwards — is string arithmetic, and it is the part that
 * can be wrong.
 */

import type { EditorState } from './inputRules';

export type BlockKind =
  'heading1' | 'heading2' | 'heading3' | 'bulleted' | 'numbered' | 'code' | 'quote' | 'divider';

interface BlockSpec {
  /** The menu's label, which is also what its type-ahead matches on. */
  readonly label: string;
  readonly snippet: string;
  /** Where the caret lands inside `snippet` — for a fence, between the two fences. */
  readonly caret: number;
}

export const BLOCKS: Readonly<Record<BlockKind, BlockSpec>> = {
  heading1: { label: 'Heading 1', snippet: '# ', caret: 2 },
  heading2: { label: 'Heading 2', snippet: '## ', caret: 3 },
  heading3: { label: 'Heading 3', snippet: '### ', caret: 4 },
  bulleted: { label: 'Bulleted list', snippet: '- ', caret: 2 },
  numbered: { label: 'Numbered list', snippet: '1. ', caret: 3 },
  code: { label: 'Code block', snippet: '```\n\n```', caret: 4 },
  quote: { label: 'Quote', snippet: '> ', caret: 2 },
  divider: { label: 'Divider', snippet: '---\n', caret: 4 },
};

/** The order the menu draws them in: text shapes first, then the two structural ones. */
export const BLOCK_ORDER: readonly BlockKind[] = [
  'heading1',
  'heading2',
  'heading3',
  'bulleted',
  'numbered',
  'code',
  'quote',
  'divider',
];

/**
 * Replace the `/query` running from `from` to the caret with `kind`'s marker.
 *
 * A block marker only means anything at the start of a line, so a `/` typed at the end of a
 * sentence gets a newline in front of the marker rather than producing `Ship it# `.
 */
export function insertBlock(state: EditorState, from: number, kind: BlockKind): EditorState {
  const spec = BLOCKS[kind];
  const before = state.text.slice(0, from);
  const after = state.text.slice(state.caret);
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  return {
    text: before + lead + spec.snippet + after,
    caret: before.length + lead.length + spec.caret,
  };
}
