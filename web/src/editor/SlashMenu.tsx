/**
 * The `/` block menu.
 *
 * It is `Menu` with a fixed item list and nothing else, and that is the point: the block
 * picker gets arrow keys, type-ahead, Escape, outside-click dismissal and focus restoration
 * for free rather than growing a second, slightly different implementation of each. Every
 * item's label is a plain string, so `text` is unnecessary — the label *is* the matchable
 * text the composition doc requires.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode } from '~/components';

import { BLOCKS, BLOCK_ORDER, type BlockKind } from './blocks';

interface SlashMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Positioned against the caret marker in the overlay, not against the whole field. */
  readonly trigger: RefObject<HTMLElement | null>;
  readonly onInsert: (kind: BlockKind) => void;
}

export function SlashMenu({ open, onClose, trigger, onInsert }: SlashMenuProps) {
  const items: MenuNode[] = BLOCK_ORDER.map((kind) => ({
    id: kind,
    label: BLOCKS[kind].label,
    onSelect: () => onInsert(kind),
  }));

  return (
    <Menu open={open} onClose={onClose} trigger={trigger} items={items} label="Insert block" />
  );
}
