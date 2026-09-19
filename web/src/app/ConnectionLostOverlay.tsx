/**
 * A blocking overlay for a lost connection.
 *
 * The sidebar badge already says "Reconnecting". That is the right answer for a socket
 * that comes back in a few hundred milliseconds, which is most of them — and it is the
 * right answer while a person is still typing through a sync blip. It is the wrong
 * answer for the laptop that went to sleep or the cable that came out: `navigator.onLine`
 * is false, the replica is no longer being written, and a click that looks like it landed
 * is a change sitting in an outbox the user cannot see. So this takes the screen until
 * the browser is online again, and it does not offer a way to dismiss it — waiting is
 * the only thing to do.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useOptionalKeyContext } from '~/components/keyContext';
import { useFocusTrap } from '~/hooks/useFocusTrap';

import styles from './ConnectionLostOverlay.module.css';

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function ConnectionLostOverlay() {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return <Overlay open={!online} />;
}

function Overlay({ open }: { open: boolean }) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useOptionalKeyContext('modal', open);
  useFocusTrap(dialogRef, open);

  useLayoutEffect(() => {
    if (!open) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, [open]);

  /**
   * The rest of the document is not merely covered, it is inert.
   *
   * `aria-modal` is honoured unevenly — Safari with VoiceOver still walks the page behind
   * the scrim — and a keyboard that is sealed in `modal` context still leaves the pointer
   * and the virtual cursor free unless the nodes themselves refuse them. Direct children
   * of `<body>`, because that is where every portal in this product lands. Previous values
   * are restored rather than cleared so a dialog that was already open can take the page
   * back when the network returns.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    const inerted: { node: HTMLElement; previous: boolean }[] = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (backdrop !== null && child.contains(backdrop)) continue;
      inerted.push({ node: child, previous: child.inert });
      child.inert = true;
    }
    return () => {
      for (const { node, previous } of inerted) node.inert = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // Stop the keymap, not the browser. Cmd+R has to keep working; J and Escape do not.
      event.stopImmediatePropagation();
    };
    // keymap-lint-allow: overlay owns the keyboard until the replica is reachable again
    window.addEventListener('keydown', onKey, true);
    // keymap-lint-allow: keyup too — Space-to-peek is a keydown/keyup pair
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div ref={backdropRef} className={styles.backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={styles.dialog}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          Connection lost.
        </h2>
        <p id={descriptionId} className={styles.message}>
          Please wait.
        </p>
      </div>
    </div>,
    document.body,
  );
}
