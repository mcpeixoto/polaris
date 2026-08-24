import { useLayoutEffect, type RefObject } from 'react';

/**
 * Mirror a value into a text control without destroying the browser's undo history.
 *
 * ## The fault this exists to avoid
 *
 * React's controlled `<textarea>` does two things on every commit: it assigns `node.value`
 * when the prop and the DOM disagree, and — because no `defaultValue` prop was given — it
 * also assigns `node.defaultValue`, so that a form reset would restore the current text
 * rather than the text the page was served with. That second write is the problem.
 *
 * A textarea's `defaultValue` setter is its `textContent` setter. Rewriting the text content
 * of a textarea the user has already edited makes Blink and WebKit mark the change as "not a
 * user edit", which closes the open typing command the browser was coalescing keystrokes
 * into. Every keystroke therefore starts a fresh undo entry, and ⌘Z walks back through the
 * text one character at a time — in the issue description, the document body, the comment
 * composer, and every other field built on the shared primitive.
 *
 * Measured in Chromium 1.49 with React 19, typing "hello world burst" into four textareas
 * and pressing undo once:
 *
 * | shape                                              | after one undo      |
 * | -------------------------------------------------- | ------------------- |
 * | `value` + `onChange` (React controlled)             | `hello world burs`  |
 * | no `value`, pushed through a ref (this hook)        | `` (empty)          |
 * | uncontrolled with a constant `defaultValue`         | `` (empty)          |
 * | a plain textarea React never updates                | `` (empty)          |
 *
 * Redo was already correct in all four; it is only the undo grain that was wrong.
 *
 * ## What this does instead
 *
 * The element is rendered with no `value`, no `defaultValue` and no children, so React's
 * update path finds nothing to reconcile: it assigns `defaultValue = ''` to a node that has
 * never had a child, which removes nothing and mutates nothing. The text is pushed in from
 * here instead.
 *
 * The write itself is deliberately the *same* write React would have made — same condition
 * (the prop and the DOM disagree), same moment (commit, before paint) — so the field still
 * behaves as a controlled one from every caller's point of view. A remote delta landing in a
 * field nobody is typing in still replaces the text; clearing a composer by setting its state
 * to `''` still empties it; switching to another issue still swaps the body. What no longer
 * happens is a write during ordinary typing, because by then the DOM already holds exactly
 * what the prop says.
 *
 * The one behaviour that is not reproduced is React's post-event restore, which re-asserts
 * the prop after a change event the owner declined to act on — a caller whose `onChange`
 * filtered or truncated the keystroke rather than storing it. No field in this app does that,
 * and reproducing it would mean writing to the element from inside the typing path, which is
 * the thing being fixed. A caller that needs to reject a keystroke should render its own
 * control.
 *
 * ## Caret
 *
 * React saves and restores the selection around its own commit, and that restore runs before
 * layout effects — so a write from here lands after it and has to put the caret back itself.
 * Offsets are clamped, because the incoming text can be shorter than what was on screen.
 */
export function useNativeValue(
  elementRef: RefObject<HTMLTextAreaElement | null>,
  value: string | undefined,
): void {
  // No dependency list on purpose: this reconciles the DOM against the prop on every commit,
  // which is when React would have done it. The guard below makes the common case — a render
  // caused by the keystroke that is already in the element — free.
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element === null || value === undefined) return;
    if (element.value === value) return;

    const focused = element.ownerDocument.activeElement === element;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    element.value = value;
    if (focused) {
      element.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
    }
  });
}
