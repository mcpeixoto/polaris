import { useRef, useState } from 'react';

import { Button } from './Button';
import { Field, useFieldIds } from './Field';
import styles from './SecretField.module.css';

export interface SecretFieldProps {
  /** The field's name — "Invitation link", "Your new key". */
  label: string;
  /**
   * The secret itself.
   *
   * The caller holds it in component state for as long as it is on screen and nowhere else.
   * It must never be put in a route, a query string, `localStorage` or any list this screen
   * re-renders: those are all places it would survive the moment it belongs to.
   */
  value: string;
  /** What is lost by walking away without copying. Say the consequence, not "careful". */
  consequence: string;
  className?: string | undefined;
}

/**
 * A one-time secret, in the only form it may take: a field the user copies from.
 *
 * Every screen that mints a credential — an invitation link, an API key — shows it exactly
 * once, because only its SHA-256 is stored and there is no second chance to ask for it. That
 * makes this the highest-consequence field in the product, and the design follows from one
 * question: what happens to somebody who does not realise this is their only look at it?
 *
 * So the consequence is stated in the field rather than in a paragraph somewhere above it,
 * the box is read-only and selects itself on focus so ⌘C works without a mouse, and the copy
 * button reports that it worked — a copy nobody can confirm is a copy people press twice and
 * still do not trust. When the clipboard is refused, which every browser does on an insecure
 * origin, the text is left selected so the platform's own copy is one keystroke away instead
 * of the button silently doing nothing.
 *
 * It is deliberately not `type="password"`. A masked field invites a password manager to
 * offer to save it, invites the browser to remember it, and hides the one thing the user is
 * here to read — and the value is on screen for the length of a dialog, not stored behind a
 * login.
 */
export function SecretField({ label, value, consequence, className }: SecretFieldProps) {
  const ids = useFieldIds();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const select = () => inputRef.current?.select();
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      select();
      return;
    }
    void clipboard.writeText(value).then(
      () => setCopied(true),
      () => select(),
    );
  };

  return (
    <Field ids={ids} label={label} hint={consequence} className={className}>
      <div className={styles.row}>
        <input
          ref={inputRef}
          id={ids.controlId}
          className={styles.value}
          value={value}
          readOnly
          // Selecting on focus is what makes the keyboard path a Tab and a ⌘C rather than a
          // Tab and a drag with the mouse the user does not have their hand on.
          onFocus={(event) => event.currentTarget.select()}
          aria-describedby={ids.hintId}
          autoComplete="off"
          spellCheck={false}
        />
        <Button onClick={copy}>Copy</Button>
        {/*
          Always rendered, with its space reserved, so confirming the copy does not push the
          button sideways under the pointer that just pressed it.
        */}
        <span className={styles.copied} role="status" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </div>
    </Field>
  );
}
