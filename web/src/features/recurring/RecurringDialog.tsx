/**
 * The convert dialog: cadence and a first due date, then the write.
 *
 * Three places open this — an issue's ⋯, a team template, and nothing else. Team settings
 * has its own inline form because that screen is already a settings form and a second modal
 * on top of it is a dialog for a dialog. The composer asks the same two questions inline
 * as well, because making a new issue recurring is a property of the create, not a convert.
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
  timezone,
  busy = false,
  error,
  onClose,
  onConfirm,
}: RecurringDialogProps) {
  const [cadence, setCadence] = useState<RecurringCadence>('weekly');
  const [firstDueDate, setFirstDueDate] = useState(initialDueDate ?? today(timezone));

  useEffect(() => {
    if (!open) return;
    setCadence('weekly');
    setFirstDueDate(initialDueDate ?? today(timezone));
  }, [open, initialDueDate, timezone]);

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
            Make recurring
          </Button>
        </>
      }
    >
      <RecurringFields
        cadence={cadence}
        firstDueDate={firstDueDate}
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
