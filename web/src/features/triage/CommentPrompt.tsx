/**
 * Optional comment before a triage accept or decline.
 *
 * Accept and decline are decisions about somebody else's filing, and a one-line note is how
 * a reviewer stays polite without opening the issue afterwards. The comment is optional on
 * purpose: Enter with an empty box is the same as the old one-keystroke accept, so the
 * queue does not grow a second press for the common case of saying nothing.
 *
 * A single-line field rather than a textarea, so Enter submits the form the platform way —
 * the alternative is a local key handler, which the keymap lint refuses for good reason.
 *
 * Anchored to the Accept button (or whichever control opened it) as a Popover rather than a
 * Modal, because a modal is an interruption and this is finishing a sentence already started.
 */

import { useRef, useState, type FormEvent, type RefObject } from 'react';

import { Button } from '~/components/Button';
import { Input } from '~/components/Input';
import { Popover } from '~/components/Popover';

import styles from './CommentPrompt.module.css';

export type TriageCommentKind = 'accept' | 'decline';

export interface CommentPromptProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  kind: TriageCommentKind;
  /** Issue identifier for the accessible name, e.g. ENG-12. */
  identifier: string;
  onConfirm: (comment: string) => void;
  actionId: string;
}

export function CommentPrompt({
  open,
  onClose,
  trigger,
  kind,
  identifier,
  onConfirm,
  actionId,
}: CommentPromptProps) {
  const [body, setBody] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);

  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) setBody('');
  }

  const verb = kind === 'accept' ? 'Accept' : 'Decline';
  const label = `${verb} ${identifier}`;

  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      label={label}
      actionId={actionId}
      actionTitle={`Close the ${kind} comment`}
      actionGroup="Triage"
      className={styles.panel}
    >
      <form
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onConfirm(body.trim());
          onClose();
        }}
      >
        <Input
          ref={fieldRef}
          label="Comment"
          hideLabel
          autoFocus
          placeholder={
            kind === 'decline'
              ? 'Optional — why this is being declined'
              : 'Optional — a note for the reporter'
          }
          hint="Enter accepts with or without a comment. Escape cancels."
          value={body}
          autoComplete="off"
          onChange={(event) => setBody(event.target.value)}
        />
        <div className={styles.actions}>
          <Button type="button" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" variant={kind === 'decline' ? 'danger' : 'primary'}>
            {verb}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
