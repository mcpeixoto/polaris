import { useRef } from 'react';

import { Button } from './Button';
import { Modal } from './Modal';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  /**
   * The question, naming its subject: "Remove Ada Lovelace from Acme?".
   *
   * A string rather than a node because it is also the dialog's accessible name, and a
   * heading assembled out of markup announces as whatever the markup happens to flatten to.
   */
  title: string;
  /**
   * What will actually happen, in sentences. This is the component's entire reason for
   * existing — see the note below — so it is required and cannot be a single word.
   */
  consequence: string;
  /** The verb, repeated: "Remove Ada", "Revoke this key". Never "OK". */
  confirmLabel: string;
  /** Draws the confirm button as destructive. True for anything that takes something away. */
  destructive?: boolean | undefined;
  /** The request is in flight. Keeps focus where it is; see Button. */
  busy?: boolean | undefined;
  /** Shown above the buttons when the attempt was refused. */
  error?: string | undefined;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The confirmation before something is taken away.
 *
 * "Are you sure?" is a question nobody can answer, because it withholds the only information
 * that would let them: what is about to change. So this dialog cannot be constructed without
 * a consequence, and the consequence is meant to be specific — "Ada loses access to this
 * workspace and its 3 teams. Their issues and comments stay exactly as they are." A user who
 * reads that either presses the button confidently or does not press it at all, and both of
 * those are better outcomes than a shrug.
 *
 * Focus lands on Cancel, not on the destructive button. The dialog usually opens from a
 * keystroke or a click that has just been made, and putting the irreversible action under
 * the Enter key the user's finger is already on turns a confirmation into a formality.
 */
export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.consequence}>{consequence}</p>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
