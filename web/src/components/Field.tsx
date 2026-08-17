import { useId, type ReactNode } from 'react';

import styles from './Field.module.css';

/**
 * The three ids a labelled control needs: the control's own, and one each for the two
 * messages it may be described by. They are derived from one id rather than generated
 * separately so that the markup is readable in devtools — `r1`, `r1-hint`, `r1-error` —
 * when someone is working out why a description is not being announced.
 */
export interface FieldIds {
  readonly controlId: string;
  readonly hintId: string;
  readonly errorId: string;
}

export interface FieldMessages {
  /** Standing help. Replaced by `error` while there is one. */
  hint?: string | undefined;
  /** Validation failure. Its presence is also what marks the control invalid. */
  error?: string | undefined;
}

export interface FieldProps extends FieldMessages {
  ids: FieldIds;
  label?: string | undefined;
  /** Keep the name, drop the visible text. For toolbars and single-field forms. */
  hideLabel?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

interface FieldMessage {
  readonly kind: 'error' | 'hint';
  readonly text: string;
  readonly id: string;
}

/**
 * useFieldIds honours a caller-supplied id and generates one otherwise, because a form
 * that wires its own labels or a test that needs a stable handle must be able to say what
 * the control is called.
 */
export function useFieldIds(id?: string | undefined): FieldIds {
  const generated = useId();
  const controlId = id ?? generated;
  return { controlId, hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

/**
 * Which message is on screen — one at a time, error winning.
 *
 * Both the rendering and the `aria-describedby` wiring go through this one function. When
 * they were allowed to decide separately, the failure was silent and specific: the hint is
 * replaced by an error, the description still points at the hint's id, and a screen reader
 * reads out advice that is no longer on the page.
 */
function messageOf(ids: FieldIds, { hint, error }: FieldMessages): FieldMessage | null {
  if (error !== undefined && error !== '') return { kind: 'error', text: error, id: ids.errorId };
  if (hint !== undefined && hint !== '') return { kind: 'hint', text: hint, id: ids.hintId };
  return null;
}

/**
 * fieldDescribedBy builds the control's `aria-describedby`, keeping anything the caller
 * already put there — a form-level explanation, a character counter — ahead of the field's
 * own message.
 */
export function fieldDescribedBy(
  ids: FieldIds,
  messages: FieldMessages,
  caller?: string | undefined,
): string | undefined {
  const message = messageOf(ids, messages);
  const joined = [caller, message?.id].filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

/** Whether the control should report itself invalid, from the same single source. */
export function fieldInvalid({ error }: FieldMessages): boolean {
  return error !== undefined && error !== '';
}

/**
 * Field is the label-and-message frame around a control. Input, Textarea and Select all
 * render through it so that a form built from the three of them has one vertical rhythm,
 * one place where an error appears, and one answer to what a hint looks like.
 *
 * The error is a live region. A validation message that arrives after a failed submit is
 * the one piece of text on the screen the user has not been told about, and without the
 * announcement a keyboard user's first clue is that nothing happened.
 */
export function Field({ ids, label, hideLabel, hint, error, className, children }: FieldProps) {
  const message = messageOf(ids, { hint, error });

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      {label === undefined ? null : (
        <label
          className={[styles.label, hideLabel === true ? styles.hiddenLabel : null]
            .filter(Boolean)
            .join(' ')}
          htmlFor={ids.controlId}
        >
          {label}
        </label>
      )}
      {children}
      {message === null ? null : (
        <p
          id={message.id}
          className={[styles.message, message.kind === 'error' ? styles.error : null]
            .filter(Boolean)
            .join(' ')}
          role={message.kind === 'error' ? 'alert' : undefined}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
