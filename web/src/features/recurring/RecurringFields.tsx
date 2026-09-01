/**
 * Cadence and first due date, the two facts a recurring schedule cannot be created without.
 *
 * Extracted so the convert dialog and team settings ask the same two questions the same way.
 * A native select and a date input rather than a Menu: this is a form field on the way to a
 * submit, not a command with a shortcut.
 *
 * Both labels are visible and there is no longer a switch to hide them. There used to be one,
 * for a composer that was going to render these two as unlabelled chips; the composer asks
 * the same two questions inline and never passed it, and a pair of sibling fields showing
 * "Weekly" and a bare date picker names neither of them anyway. A control that is hard to
 * identify is not a denser control, it is a slower one.
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
}

export function RecurringFields({
  cadence,
  firstDueDate,
  onCadence,
  onFirstDueDate,
}: RecurringFieldsProps) {
  return (
    <div className={styles.fields}>
      <Select
        label="Cadence"
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
        type="date"
        value={firstDueDate}
        onChange={(event) => onFirstDueDate(event.target.value)}
      />
    </div>
  );
}
