/**
 * The cadence dialog: cadence and a due date, then the write.
 *
 * It opens to convert an issue and, since the rail's Repeats row became a control, to edit
 * the schedule it names — the same two questions either way, so the difference is two
 * strings rather than a second dialog. Team settings still has its own inline form because
 * that screen is already a settings form and a second modal on top of it is a dialog for a
 * dialog. The composer asks the same two questions inline as well, because making a new
 * issue recurring is a property of the create, not a convert.
 */

import { useEffect, useState } from 'react';

import { Button, Modal } from '~/components';
import { today } from '~/features/time';
import type { RecurringCadence } from '~/store';

import { RecurringFields } from './RecurringFields';
import styles from './RecurringDialog.module.css';

export interface RecurringDraft {
  readonly cadence: RecurringCadence;
  readonly firstDueDate: string;
}

export interface RecurringDialogProps {
  open: boolean;
  title: string;
  description?: string | undefined;
  /** The issue's own due date, when converting one that already has a day. */
  initialDueDate?: string | undefined;
  /**
   * The cadence to open on. Defaults to weekly, which is right for a schedule that does not
   * exist yet and wrong for one that does: editing a monthly schedule used to propose weekly
   * and call it the current value.
   */
  initialCadence?: RecurringCadence | undefined;
  /** The verb on the primary button. Defaults to the convert case. */
  confirmLabel?: string | undefined;
  /** What the date field is called. See RecurringFields. */
  dueLabel?: string | undefined;
  timezone: string;
  busy?: boolean | undefined;
  error?: string | null | undefined;
  onClose: () => void;
  onConfirm: (draft: RecurringDraft) => void;
}

export function RecurringDialog({
  open,
  title,
  description,
  initialDueDate,
  initialCadence,
  confirmLabel = 'Make recurring',
  dueLabel,
  timezone,
  busy = false,
  error,
  onClose,
  onConfirm,
}: RecurringDialogProps) {
  const [cadence, setCadence] = useState<RecurringCadence>(initialCadence ?? 'weekly');
  const [firstDueDate, setFirstDueDate] = useState(initialDueDate ?? today(timezone));

  useEffect(() => {
    if (!open) return;
    setCadence(initialCadence ?? 'weekly');
    setFirstDueDate(initialDueDate ?? today(timezone));
  }, [open, initialCadence, initialDueDate, timezone]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          {/* One primary and a ghost cancel: leaving is not a second command, and drawing it
              as one asks the reader to choose between two equal-looking buttons. */}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={firstDueDate === ''}
            onClick={() => onConfirm({ cadence, firstDueDate })}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <RecurringFields
        cadence={cadence}
        firstDueDate={firstDueDate}
        dueLabel={dueLabel}
        onCadence={setCadence}
        onFirstDueDate={setFirstDueDate}
      />
      {error === null || error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
