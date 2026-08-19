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
      label: (
        <>
          <span className={styles.name}>{template.name}</span>
        </>
      ),
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
