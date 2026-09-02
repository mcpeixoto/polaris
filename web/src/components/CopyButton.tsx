import { useRef, useState } from 'react';

import { Button, type ButtonProps } from './Button';
import styles from './CopyButton.module.css';

export interface CopyButtonProps {
  /** The text put on the clipboard. */
  value: string;
  /**
   * The button's label. It never changes — see the note on the component about why the
   * confirmation is a separate element and not this string.
   */
  label?: string | undefined;
  /**
   * The accessible name, where the visible label is too terse to stand alone in a list of
   * several copy buttons ("Copy" × 4 names nothing).
   */
  ariaLabel?: string | undefined;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string | undefined;
}

/**
 * Copy one value, and say that it worked.
 *
 * This is `SecretField`'s copy row lifted out of it, because three other screens had each
 * hand-rolled a worse version of the same thing: `copyText(v).then(ok => ok && setCopied(…))`
 * with no `false` branch, no reset, and the confirmation written into the button's own label.
 * Each of those is a distinct defect. The `false` branch is every insecure origin and every
 * browser that refuses the write, and dropping it makes the button look inert exactly when it
 * has failed. Never resetting turns the accessible name into "Copied" permanently, so the
 * control stops naming what it does. And a label that changes in place is not announced at
 * all: a screen reader is not looking at the button after the click.
 *
 * So: the confirmation is a sibling `role="status"` with its width reserved — reserved so the
 * word arriving does not shove the button out from under the pointer that just pressed it —
 * the label is constant, and a refused clipboard falls back to selecting a hidden copy of the
 * value so the platform's own ⌘C is one keystroke away rather than nothing happening.
 */
export function CopyButton({
  value,
  label = 'Copy',
  ariaLabel,
  size,
  variant,
  className,
}: CopyButtonProps) {
  const fallbackRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  };

  // The clipboard was refused — which is every insecure origin, and any browser that has
  // not granted the permission. Put the selection on the value so the user's own copy
  // shortcut still reaches it, rather than the button doing nothing at all.
  const fallBack = () => {
    const field = fallbackRef.current;
    if (field === null) return;
    field.focus();
    field.select();
  };

  const copy = () => {
    // Deliberately inlined rather than borrowed from a feature: a component may not depend
    // on `~/features`, and the clipboard call is four lines.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      fallBack();
      return;
    }
    void clipboard.writeText(value).then(announce, fallBack);
  };

  return (
    <span className={className === undefined ? styles.root : `${styles.root} ${className}`}>
      <Button size={size} variant={variant} onClick={copy} aria-label={ariaLabel}>
        {label}
      </Button>
      {/*
        The fallback. Off to the side rather than hidden: `display: none` cannot be selected,
        and a `readOnly` input that only ever receives focus on a refused write is the
        cheapest thing that can hold a selection.
      */}
      <input
        ref={fallbackRef}
        className={styles.fallback}
        value={value}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        spellCheck={false}
      />
      <span className={styles.copied} role="status" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </span>
  );
}

/** Long enough to be read once, short enough that it is gone before the next copy. */
const CONFIRM_MS = 2000;
