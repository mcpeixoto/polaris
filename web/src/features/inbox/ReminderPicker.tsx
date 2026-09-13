/**
 * The inbox's custom snooze box: a typed phrase rather than a calendar.
 *
 * The relatives on the menu cover the three common answers. This panel is for the fourth —
 * "til Friday", "next quarter", "for two weeks" — and deliberately takes free text rather
 * than a `type="date"` control, because those phrases are what people mean and a calendar
 * cannot say them.
 */

import { useRef, useState, type FormEvent, type RefObject } from 'react';

import { Button } from '~/components/Button';
import { Input } from '~/components/Input';
import { Popover } from '~/components/Popover';

import { parseReminder } from './parseReminder';
import styles from './ReminderPicker.module.css';

export interface ReminderPickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  /** Pins the clock. Tests only. */
  now?: Date | undefined;
  onSelect: (until: Date) => void;
  /** Unique Escape id — two of these can sit on one screen (bulk + row). */
  actionId: string;
}

export function ReminderPicker({
  open,
  onClose,
  trigger,
  now,
  onSelect,
  actionId,
}: ReminderPickerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open) {
      setDraft('');
      setError(null);
    }
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      label="Custom reminder"
      actionId={actionId}
      actionTitle="Close the custom reminder"
      actionGroup="Inbox"
      className={styles.panel}
    >
      <form
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const parsed = parseReminder(draft, now ?? new Date());
          if (!parsed.ok) {
            setError(parsed.error);
            return;
          }
          onSelect(parsed.until);
          onClose();
        }}
      >
        <Input
          ref={inputRef}
          label="Remind me"
          hint="til Friday, next quarter, for 2 weeks, Jan 3 10am"
          placeholder="til Friday"
          value={draft}
          autoComplete="off"
          error={error ?? undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error !== null) setError(null);
          }}
        />
        <Button type="submit" size="sm" variant="primary">
          Set
        </Button>
      </form>
    </Popover>
  );
}
