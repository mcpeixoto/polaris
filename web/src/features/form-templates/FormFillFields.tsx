import { Input, Select, Textarea } from '~/components';
import type { FormTemplateField, FormTemplateFieldType } from '~/store';

export type FormAnswers = Readonly<Record<string, string>>;

export interface FormFillFieldsProps {
  readonly fields: readonly FormTemplateField[];
  readonly answers: FormAnswers;
  readonly onChange: (fieldId: string, value: string) => void;
}

export function FormFillFields({ fields, answers, onChange }: FormFillFieldsProps) {
  return (
    <div>
      {fields.map((field) => (
        <FormFieldInput
          key={field.id}
          field={field}
          value={answers[field.id] ?? ''}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function FormFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormTemplateField;
  value: string;
  onChange: (fieldId: string, value: string) => void;
}) {
  if (field.fieldType === 'instructions') {
    const content =
      typeof field.config.content === 'string'
        ? field.config.content
        : (field.description ?? field.label);
    return (
      <p>
        <strong>{field.label}</strong>
        {content === '' ? null : `: ${content}`}
      </p>
    );
  }

  if (propertyBound(field.fieldType)) {
    return null;
  }

  const label = `${field.label}${field.required ? ' *' : ''}`;

  switch (field.fieldType) {
    case 'long_text':
      return (
        <Textarea
          label={label}
          value={value}
          onChange={(e) => onChange(field.id, e.target.value)}
          minRows={3}
          required={field.required}
        />
      );
    case 'dropdown': {
      const options = optionsOf(field);
      return (
        <Select
          label={label}
          value={value}
          onChange={(e) => onChange(field.id, e.target.value)}
          required={field.required}
        >
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    }
    case 'checkboxes': {
      const options = optionsOf(field);
      const selected = new Set(value === '' ? [] : value.split('\n'));
      return (
        <fieldset>
          <legend>{label}</legend>
          {options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(option);
                  else next.delete(option);
                  onChange(field.id, [...next].join('\n'));
                }}
              />
              {option}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'date':
      return (
        <Input
          label={label}
          type="date"
          value={value}
          onChange={(e) => onChange(field.id, e.target.value)}
          required={field.required}
        />
      );
    case 'file_upload':
      return (
        <Input
          label={label}
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            onChange(field.id, file?.name ?? '');
          }}
        />
      );
    default:
      return (
        <Input
          label={label}
          value={value}
          onChange={(e) => onChange(field.id, e.target.value)}
          required={field.required}
        />
      );
  }
}

function propertyBound(type: FormTemplateFieldType): boolean {
  return type === 'title' || type === 'priority' || type === 'due_date' || type === 'label_group';
}

function optionsOf(field: FormTemplateField): string[] {
  const raw = field.config.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

/** Build issue description text from generic form answers. */
export function descriptionFromFormAnswers(
  fields: readonly FormTemplateField[],
  answers: FormAnswers,
): string {
  const lines: string[] = [];
  for (const field of fields) {
    if (field.fieldType === 'instructions') continue;
    if (propertyBound(field.fieldType)) continue;
    const answer = (answers[field.id] ?? '').trim();
    if (answer === '') continue;
    lines.push(`**${field.label}**\n${answer}`);
  }
  return lines.join('\n\n');
}

export function titleFromFormAnswers(
  fields: readonly FormTemplateField[],
  answers: FormAnswers,
  fallback: string,
): string {
  for (const field of fields) {
    if (field.fieldType !== 'title') continue;
    const answer = (answers[field.id] ?? '').trim();
    if (answer !== '') return answer;
  }
  return fallback;
}

export function priorityFromFormAnswers(
  fields: readonly FormTemplateField[],
  answers: FormAnswers,
  fallback: number,
): number {
  for (const field of fields) {
    if (field.fieldType !== 'priority') continue;
    const answer = Number(answers[field.id]);
    if (Number.isFinite(answer) && answer >= 0 && answer <= 4) return answer;
  }
  return fallback;
}
