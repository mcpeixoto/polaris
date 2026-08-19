/**
 * Form templates settings: structured intake templates and their fields.
 */

import { useMemo, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Badge, Button, EmptyState, Input, Select, Textarea } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  archiveFormTemplate,
  createFormTemplate,
  createFormTemplateField,
  deleteFormTemplateField,
  fieldsForFormTemplate,
  updateFormTemplate,
} from '~/features/form-templates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type {
  FormTemplate,
  FormTemplateField,
  FormTemplateFieldType,
  Store,
  TemplateProperties,
  UUID,
} from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/views/Templates.module.css';

const WORKSPACE_SCOPE = 'workspace';

const FIELD_TYPES: readonly { value: FormTemplateFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkboxes', label: 'Checkboxes' },
  { value: 'date', label: 'Date' },
  { value: 'file_upload', label: 'File upload' },
  { value: 'instructions', label: 'Instructions' },
  { value: 'label_group', label: 'Label group' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: 'due_date', label: 'Due date' },
];

interface Scope {
  readonly id: string;
  readonly label: string;
  readonly teamId: UUID | undefined;
}

interface FormTemplateRow {
  readonly id: UUID;
  readonly teamId: UUID | undefined;
  readonly name: string;
  readonly description: string;
  readonly properties: TemplateProperties;
  readonly position: string;
  readonly fields: readonly FormTemplateField[];
}

type Editing =
  | { readonly kind: 'create'; readonly scopeId: string }
  | { readonly kind: 'edit'; readonly templateId: UUID };

export function FormTemplatesPanel() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [archiving, setArchiving] = useState<FormTemplateRow | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const { rows, scopes } = useLiveQuery(
    (store: Store) => {
      const teams = [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.key.localeCompare(b.key));

      return {
        rows: [...store.formTemplates.values()].map((template) => rowOf(store, template)),
        scopes: [
          { id: WORKSPACE_SCOPE, label: 'Workspace', teamId: undefined },
          ...teams.map((team) => ({ id: team.id, label: team.name, teamId: team.id })),
        ] as Scope[],
      };
    },
    ['formTemplate', 'formTemplateField', 'team'],
  );

  const grouped = useMemo(() => {
    const byScope = new Map<string, FormTemplateRow[]>();
    for (const scope of scopes) byScope.set(scope.id, []);
    for (const row of rows) {
      if (row.teamId === undefined) byScope.get(WORKSPACE_SCOPE)?.push(row);
      else byScope.get(row.teamId)?.push(row);
    }
    return scopes.map((scope) => ({
      ...scope,
      templates: (byScope.get(scope.id) ?? []).sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name),
      ),
    }));
  }, [rows, scopes]);

  const save = async (
    scope: Scope,
    existing: FormTemplateRow | null,
    draft: { name: string; description: string },
  ) => {
    if (existing === null) {
      await createFormTemplate(engine, {
        teamId: scope.teamId,
        name: draft.name,
        description: draft.description,
        createdBy: viewerId ?? undefined,
      });
    } else {
      await updateFormTemplate(engine, existing.id, {
        name: draft.name,
        description: draft.description,
        properties: existing.properties,
      });
    }
    setEditing(null);
  };

  const addField = async (templateId: UUID, fieldType: FormTemplateFieldType, label: string) => {
    await createFormTemplateField(engine, { formTemplateId: templateId, fieldType, label });
  };

  const confirmArchive = () => {
    if (archiving === null) return;
    setArchiveBusy(true);
    archiveFormTemplate(engine, archiving.id)
      .then(() => {
        setArchiving(null);
        setArchiveError(null);
      })
      .catch((failure: unknown) => {
        setArchiveError(
          failure instanceof ApiError
            ? failure.message
            : 'That form template could not be archived.',
        );
      })
      .finally(() => setArchiveBusy(false));
  };

  return (
    <div className={styles.body}>
      {grouped.map((scope) => (
        <section
          key={scope.id}
          className={styles.section}
          aria-labelledby={`form-scope-${scope.id}`}
        >
          <h2 className={styles.sectionTitle} id={`form-scope-${scope.id}`}>
            {scope.label}
            {scope.teamId === undefined ? <Badge tone="accent">Every team</Badge> : null}
          </h2>
          <p className={styles.sectionHint}>
            Structured intake forms with required fields. Issues record which form they came from.
          </p>

          {editing?.kind === 'create' && editing.scopeId === scope.id ? (
            <FormTemplateEditor
              template={null}
              onSave={(draft) => save(scope, null, draft)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className={styles.sectionActions}>
              <Button onClick={() => setEditing({ kind: 'create', scopeId: scope.id })}>
                New form template
              </Button>
            </div>
          )}

          {scope.templates.length === 0 ? (
            <EmptyState
              title="No form templates yet"
              description="Form templates collect structured answers when someone files an issue."
            />
          ) : (
            <ul className={styles.list}>
              {scope.templates.map((row) =>
                editing?.kind === 'edit' && editing.templateId === row.id ? (
                  <li key={row.id}>
                    <FormTemplateEditor
                      template={row}
                      onSave={(draft) => save(scope, row, draft)}
                      onCancel={() => setEditing(null)}
                      onAddField={(type, label) => addField(row.id, type, label)}
                      onDeleteField={(fieldId) => deleteFormTemplateField(engine, fieldId)}
                    />
                  </li>
                ) : (
                  <li key={row.id}>
                    <div className={styles.row}>
                      <div className={styles.rowMain}>
                        <span className={styles.rowName}>{row.name}</span>
                        {row.description !== '' ? (
                          <span className={styles.rowDescription}>{row.description}</span>
                        ) : null}
                        <span className={styles.rowPrefills}>
                          {row.fields.length === 0
                            ? 'No fields yet'
                            : `${row.fields.length} field${row.fields.length === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        <Button
                          variant="ghost"
                          onClick={() => setEditing({ kind: 'edit', templateId: row.id })}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setArchiving(row)}>
                          Archive
                        </Button>
                      </div>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      ))}

      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? 'this form template'}?`}
        consequence="It stops being offered in create dialogs. Issues already filed from it keep their link."
        confirmLabel="Archive it"
        destructive
        busy={archiveBusy}
        error={archiveError ?? undefined}
        onConfirm={confirmArchive}
        onClose={() => {
          setArchiving(null);
          setArchiveError(null);
        }}
      />
    </div>
  );
}

function FormTemplateEditor({
  template,
  onSave,
  onCancel,
  onAddField,
  onDeleteField,
}: {
  template: FormTemplateRow | null;
  onSave: (draft: { name: string; description: string }) => void;
  onCancel: () => void;
  onAddField?: (type: FormTemplateFieldType, label: string) => void;
  onDeleteField?: (fieldId: UUID) => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [fieldType, setFieldType] = useState<FormTemplateFieldType>('text');
  const [fieldLabel, setFieldLabel] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ name, description });
  };

  const addField = (event: FormEvent) => {
    event.preventDefault();
    if (onAddField === undefined || fieldLabel.trim() === '') return;
    onAddField(fieldType, fieldLabel.trim());
    setFieldLabel('');
  };

  return (
    <form className={styles.editor} onSubmit={submit}>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        minRows={2}
      />

      {template === null ? null : (
        <>
          <h3 className={styles.editorSectionTitle}>Fields</h3>
          <ul className={styles.list}>
            {template.fields.map((field) => (
              <li key={field.id} className={styles.row}>
                <span>
                  {field.label} <Badge tone="neutral">{field.fieldType.replace('_', ' ')}</Badge>
                  {field.required ? <Badge tone="accent">Required</Badge> : null}
                </span>
                {onDeleteField === undefined ? null : (
                  <Button type="button" variant="ghost" onClick={() => onDeleteField(field.id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {onAddField === undefined ? null : (
            <div className={styles.fieldAdd}>
              <Select
                label="Field type"
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as FormTemplateFieldType)}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Input
                label="Field label"
                value={fieldLabel}
                onChange={(e) => setFieldLabel(e.target.value)}
              />
              <Button type="button" onClick={addField}>
                Add field
              </Button>
            </div>
          )}
        </>
      )}

      <div className={styles.editorActions}>
        <Button type="submit">Save</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function rowOf(store: Store, template: FormTemplate): FormTemplateRow {
  return {
    id: template.id,
    teamId: template.teamId,
    name: template.name,
    description: (template.description ?? '').trim(),
    properties: template.properties,
    position: template.position,
    fields: fieldsForFormTemplate(store, template.id),
  };
}
