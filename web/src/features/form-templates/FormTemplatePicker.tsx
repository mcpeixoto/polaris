/**
 * The menu that chooses an intake *form* for a new issue.
 *
 * The sibling of `TemplatePicker`, and deliberately built the same way: a controlled Menu that
 * does not own its trigger, does not create anything, and reports the form the user chose for
 * the create dialog to turn into questions. The two are mutually exclusive in the composer —
 * picking one clears the other — because an issue template prefills the fields that are already
 * on screen while a form template replaces them with its own questions, and applying both would
 * leave the filer looking at two answers to the same field.
 *
 * "No form" leads the list rather than being reachable only by Escape, for the reason
 * `TemplatePicker` gives at length: a picker whose effect is visible on the form behind it has
 * to offer the way back in the same list that caused it.
 *
 * Every row is marked as a form, always, and not only where a name would otherwise be
 * ambiguous. These names sit beside issue-template names in the same dialog, and a marker that
 * comes and goes is one nobody learns to read.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { formTemplatesForTeam } from '~/features/form-templates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { FormTemplate, UUID } from '~/store';

import styles from '~/features/templates/TemplatePicker.module.css';

const NO_FORM = 'no-form-template';

export interface FormTemplatePickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  teamId: UUID;
  value: UUID | null;
  onSelect: (template: FormTemplate | null) => void;
}

export function FormTemplatePicker({
  open,
  onClose,
  trigger,
  placement,
  teamId,
  value,
  onSelect,
}: FormTemplatePickerProps) {
  const templates = useLiveQuery(
    (store) => formTemplatesForTeam(store, teamId),
    ['formTemplate', 'team'],
    [teamId],
  );

  const items: MenuNode[] = [
    {
      id: NO_FORM,
      label: 'No form',
      text: 'no form none blank',
      selected: value === null,
      onSelect: () => onSelect(null),
    },
    { kind: 'separator' },
    ...templates.map((template) => ({
      id: template.id,
      label: <span className={styles.name}>{template.name}</span>,
      // Required rather than an optimisation: Menu falls back to the label for filtering and
      // type-ahead only when the label is a string, and this one is markup.
      text: template.name,
      hint: template.teamId === undefined ? 'Every team · Form' : 'Form',
      selected: template.id === value,
      onSelect: () => onSelect(template),
    })),
  ];

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Form template"
      placement={placement}
      filterable
      filterPlaceholder="Form template…"
      emptyLabel={templates.length === 0 ? 'No form templates for this team yet' : 'No forms match'}
    />
  );
}
