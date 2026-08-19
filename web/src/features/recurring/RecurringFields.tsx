/**
 * Cadence and first due date, the two facts a recurring schedule cannot be created without.
 *
 * Extracted so the composer, the convert dialogs and team settings all ask the same two
 * questions the same way. A native select and a date input rather than a Menu: this is a
 * form field on the way to a submit, not a command with a shortcut.
 */

import { Input, Select } from '~/components';
import type { RecurringCadence } from '~/store';

import { CADENCE_LABELS, CADENCES } from './mutations';
import styles from './RecurringFields.module.css';

export interface RecurringFieldsProps {
  cadence: RecurringCadence;
  firstDueDate: string;
  onCadence: (cadence: RecurringCadence) => void;
  onFirstDueDate: (day: string) => void;
  /** Composer chips hide the labels; the convert dialogs and settings do not. */
  hideLabels?: boolean | undefined;
}

export function RecurringFields({
  cadence,
  firstDueDate,
  onCadence,
  onFirstDueDate,
  hideLabels = false,
}: RecurringFieldsProps) {
  return (
    <div className={styles.fields}>
      <Select
        label="Cadence"
        hideLabel={hideLabels}
        value={cadence}
        onChange={(event) => onCadence(event.target.value as RecurringCadence)}
      >
        {CADENCES.map((option) => (
          <option key={option} value={option}>
            {CADENCE_LABELS[option]}
          </option>
        ))}
      </Select>
      <Input
        label="First due"
        hideLabel={hideLabels}
        type="date"
        value={firstDueDate}
        onChange={(event) => onFirstDueDate(event.target.value)}
      />
    </div>
  );
}
