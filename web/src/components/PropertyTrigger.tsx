import type { MouseEvent, ReactNode, Ref } from 'react';

import { IconButton } from './IconButton';
import styles from './PropertyTrigger.module.css';

export interface PropertyTriggerProps {
  /**
   * The value, which is the control's accessible name: "In Progress", "Ada Lovelace",
   * "Unassigned". Not the property name — that is what `action` carries.
   */
  name: string;
  /**
   * The verb, drawn in the tooltip and attached as the description: "Change status",
   * "Assign to…". Never the same words as `name`, or a screen reader says it twice.
   */
  action: string;
  /**
   * The chord that does the same thing from the keyboard, copied from the registry.
   *
   * Only pass one where it is true *of this surface and this issue*. A sub-issue row is the
   * counter-example: `S` is registered in the `detail` context and changes the status of the
   * issue being viewed, not of the child being pointed at, so drawing `S` there would be a
   * lie told in a tooltip.
   */
  keys?: string | undefined;
  /** True while the menu that this trigger opened is the one showing. */
  open: boolean;
  disabled?: boolean | undefined;
  /**
   * Keep the control out of the tab order.
   *
   * Required inside a `role="option"` row: that listbox navigates by
   * `aria-activedescendant` and a tab stop inside an option breaks the roving model. The
   * cost is that these triggers are pointer-only on those surfaces, which is why every one
   * of them has a registered chord and a context-menu item as well. Omitted in Peek and the
   * detail rail, where the buttons are ordinary focusable controls.
   */
  roving?: boolean | undefined;
  /** Handed the button element, because that is what the menu anchors to. */
  onOpen: (element: HTMLElement) => void;
  /**
   * The registered trigger, for a surface that has exactly one row.
   *
   * A pointer click carries its own element and needs nothing here. A *keystroke* does not:
   * `useMenuTrigger.show()` clears the override and falls back to the element the trigger
   * registered, and a picker with no anchor at all skips positioning entirely and opens in
   * the window corner with no focus to return to. So a single-issue surface — the inbox
   * pane, the triage pane — passes `trigger.props.ref` here and its chords land on the
   * control they belong to. A list passes nothing: its keyboard path is anchored elsewhere,
   * and hundreds of rows cannot all claim one ref.
   */
  ref?: Ref<HTMLButtonElement> | undefined;
  /** The glyph. Drawn inside an `aria-hidden` slot, so pass the decorative variant. */
  children: ReactNode;
}

/**
 * A property glyph that opens the picker that owns it.
 *
 * The status circle on a row looks like a control, and until this component existed it was
 * an `<svg>`. Everywhere a property is drawn — list rows, board cards, Peek, the panes —
 * this is the thing that makes it editable where it is shown.
 *
 * The `stopPropagation` is the entire reason this is a component rather than a spread of
 * `useMenuTrigger`'s props. A row's own click opens the issue; without stopping the bubble,
 * changing an assignee would also navigate away from the list you were changing it in.
 *
 * It does not own its open state. A list has one status picker and hundreds of rows, so the
 * surface holds the picker and tells each trigger whether it is the one hanging off it —
 * see `useMenuTrigger`'s `showFrom`.
 */
export function PropertyTrigger({
  name,
  action,
  keys,
  open,
  disabled,
  roving,
  onOpen,
  ref,
  children,
}: PropertyTriggerProps) {
  return (
    <IconButton
      ref={ref}
      aria-label={name}
      tooltip={action}
      keys={keys}
      icon={children}
      size="sm"
      variant="ghost"
      className={styles.trigger}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      tabIndex={roving === true ? -1 : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
    />
  );
}
