/**
 * The pieces both peeks are made of.
 *
 * Peek started as one panel for one kind of thing. A second one — the project under the
 * cursor on the project list — is the same panel with different facts in it: the same
 * stylesheet, the same presence, the same header with the same close button, the same rail
 * of label-and-value rows, and the same rule that a glance shows the first paragraph of a
 * description rather than the whole document.
 *
 * So the shared half lives here and each peek is left with what is actually specific to it:
 * which entity it reads and which facts it draws. What is deliberately *not* here is the
 * `<aside>` and its `usePresence` — each peek keeps those, because the live query that fills
 * it is gated on `present` and a shell that owned the hook could not hand that fact back.
 */

import { useId, type ReactNode, type Ref } from 'react';

import { IconButton, Tooltip } from '~/components';
import { CrossGlyph } from '~/features/issue/glyphs';

import styles from './Peek.module.css';

/**
 * The panel's top line: what this is, and the way out.
 *
 * The close button exists only when a caller supplies `onClose`, which is the same bargain
 * the issue peek struck: the list owns the open state, so the list owns the close, and a
 * panel rendered without one is a panel Escape is the only exit from.
 */
export function PeekHeader({
  eyebrow,
  onClose,
}: {
  eyebrow: ReactNode;
  onClose?: (() => void) | undefined;
}) {
  return (
    <header className={styles.header}>
      <span className={styles.identifier}>{eyebrow}</span>
      {onClose === undefined ? null : (
        <IconButton
          aria-label="Close peek"
          keys="Escape"
          size="sm"
          className={styles.close}
          onClick={onClose}
          icon={<CrossGlyph />}
        />
      )}
    </header>
  );
}

/**
 * One rail row. The label is for the accessibility tree, as it is on the issue screen: on
 * screen the glyph and the value are the row.
 *
 * With `onOpen` the value becomes the control that changes it, which is the split the issue
 * screen's own rail makes: the button is *named* by the value — "In Progress", "Ada
 * Lovelace" — and *described* by the property, so a reader hears "In Progress, Status" and
 * not "Status, Status". The hidden `<dt>` was already carrying exactly that word, so it is
 * pointed at rather than duplicated into an `aria-label` that would then have two places to
 * drift from.
 *
 * These stay in the tab order, unlike the triggers on a list row: Peek is a panel, not a
 * `role="option"` navigating by `aria-activedescendant`, so an ordinary focusable control is
 * exactly right here.
 */
export function Fact({
  label,
  wrap = false,
  action,
  keys,
  open,
  popup = 'menu',
  onOpen,
  triggerRef,
  children,
}: {
  label: string;
  wrap?: boolean;
  /** The verb, drawn in the tooltip: "Change status". Its absence leaves the row inert. */
  action?: string | undefined;
  /** The chord that does the same thing. See the caveat where Peek passes these. */
  keys?: string | undefined;
  /** True while the menu this row opened is the one showing. */
  open?: boolean | undefined;
  /**
   * What opens, as `aria-haspopup` spells it.
   *
   * The due-date panel is a dialogue holding a text field, and a trigger promising a menu
   * tells a reader to expect a list the arrow keys walk. Same distinction `useMenuTrigger`
   * makes, for the same reason.
   */
  popup?: 'menu' | 'dialog' | undefined;
  /** Handed the button, because that is what the menu anchors to. */
  onOpen?: ((element: HTMLElement) => void) | undefined;
  /**
   * The button, for a caller that has to anchor a menu to it without a press.
   *
   * Peek's context menu is the case: choosing "Status…" there has to open the picker on the
   * status row, and a menu anchored at the pointer instead would have to survive its own
   * anchor being unmounted. A row that is always mounted is the simpler answer.
   */
  triggerRef?: Ref<HTMLButtonElement> | undefined;
  children: ReactNode;
}) {
  const id = useId();

  if (onOpen === undefined || action === undefined) {
    return (
      <div className={styles.fact}>
        <dt className={styles.srOnly}>{label}</dt>
        <dd className={wrap ? styles.factWrap : undefined}>{children}</dd>
      </div>
    );
  }

  return (
    <div className={styles.fact}>
      <dt className={styles.srOnly} id={id}>
        {label}
      </dt>
      {/* The cell gives up its padding to the button, which takes over the row's whole box —
          a control inset inside its row would leave a strip along the edge that looks
          pressable and is not. */}
      <dd className={[styles.factCell, wrap ? styles.factWrap : null].filter(Boolean).join(' ')}>
        {/* `describe={false}`: the description slot is the property's name, above. */}
        <Tooltip label={action} keys={keys} describe={false}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.factTrigger}
            aria-describedby={id}
            aria-haspopup={popup}
            aria-expanded={open === true}
            onClick={(event) => onOpen(event.currentTarget)}
          >
            {children}
          </button>
        </Tooltip>
      </dd>
    </div>
  );
}

/** Peek is a glance: a novel in the description stays on the entity's own page. */
export function glanceDescription(raw: string, limit = 480): string {
  const collapsed = raw.trim().replace(/\n{3,}/g, '\n\n');
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const at = cut.lastIndexOf(' ');
  return `${(at > 80 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
