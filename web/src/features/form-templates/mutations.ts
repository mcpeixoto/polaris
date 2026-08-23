import {
  uuidv7,
  type EntityPatch,
  type FormTemplate,
  type FormTemplateField,
  type FormTemplateFieldType,
  type Store,
  type TemplateProperties,
  type UUID,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import {
  ARCHIVE_FORM_TEMPLATE,
  CREATE_FORM_TEMPLATE,
  CREATE_FORM_TEMPLATE_FIELD,
  DELETE_FORM_TEMPLATE_FIELD,
  UPDATE_FORM_TEMPLATE,
  UPDATE_FORM_TEMPLATE_FIELD,
} from './operations';

export interface NewFormTemplate {
  readonly teamId?: UUID | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly properties?: TemplateProperties | undefined;
  readonly createdBy?: UUID | undefined;
}

export interface NewFormTemplateField {
  readonly formTemplateId: UUID;
  readonly fieldType: FormTemplateFieldType;
  readonly label: string;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
  readonly config?: Record<string, unknown> | undefined;
}

function lastFormTemplatePosition(store: Store): string {
  let last = '';
  for (const template of store.formTemplates.values()) {
    if (template.position > last) last = template.position;
  }
  return last === '' ? 'a0' : `${last}~`;
}

function lastFieldSortOrder(store: Store, formTemplateId: UUID): string {
  let last = '';
  for (const id of store.formTemplateFieldIdsFor(formTemplateId)) {
    const field = store.formTemplateFields.get(id);
    if (field !== undefined && field.sortOrder > last) last = field.sortOrder;
  }
  return last === '' ? 'a0' : `${last}~`;
}

export async function createFormTemplate(
  engine: SyncEngine,
  input: NewFormTemplate,
): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const description = (input.description ?? '').trim();
  const properties = input.properties ?? {};
  const now = new Date().toISOString();

  const provisional: FormTemplate = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    name,
    ...(description === '' ? null : { description }),
    properties,
    position: lastFormTemplatePosition(store),
    ...(input.createdBy === undefined ? null : { createdBy: input.createdBy }),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createFormTemplate: { template: FormTemplate } }>({
    mutation: CREATE_FORM_TEMPLATE,
    variables: {
      input: {
        name,
        ...(input.teamId === undefined ? null : { teamId: input.teamId }),
        ...(description === '' ? null : { description }),
        properties,
      },
    },
    optimistic: [{ type: 'formTemplate', id: provisional.id, before: null, after: provisional }],
    reconcile: {
      type: 'formTemplate',
      provisionalId: provisional.id,
      path: ['createFormTemplate', 'template'],
    },
  });

  return data.createFormTemplate.template.id;
}

export async function updateFormTemplate(
  engine: SyncEngine,
  templateId: UUID,
  input: {
    name?: string;
    description?: string;
    properties?: TemplateProperties;
  },
): Promise<void> {
  const store = engine.store;
  const before = store.get('formTemplate', templateId);
  if (before === undefined) return;

  const name = input.name?.trim() ?? before.name;
  const description =
    input.description === undefined ? before.description : input.description.trim();
  const properties = input.properties ?? before.properties;
  const after: FormTemplate = {
    ...before,
    name,
    description: description === '' ? undefined : description,
    properties,
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_FORM_TEMPLATE,
    variables: {
      input: {
        id: templateId,
        name,
        ...(description === '' ? { description: '' } : description ? { description } : null),
        properties,
      },
    },
    optimistic: [{ type: 'formTemplate', id: templateId, before, after }],
  });
}

export async function archiveFormTemplate(engine: SyncEngine, templateId: UUID): Promise<void> {
  const before = engine.store.get('formTemplate', templateId);
  if (before === undefined) return;

  const fieldDeletes: EntityPatch[] = [];
  for (const fieldId of engine.store.formTemplateFieldIdsFor(templateId)) {
    const field = engine.store.get('formTemplateField', fieldId);
    if (field !== undefined) {
      fieldDeletes.push({ type: 'formTemplateField', id: fieldId, before: field, after: null });
    }
  }

  await engine.mutate({
    mutation: ARCHIVE_FORM_TEMPLATE,
    variables: { id: templateId, archived: true },
    optimistic: [{ type: 'formTemplate', id: templateId, before, after: null }, ...fieldDeletes],
  });
}

export async function createFormTemplateField(
  engine: SyncEngine,
  input: NewFormTemplateField,
): Promise<UUID> {
  const store = engine.store;
  const label = input.label.trim();
  if (label === '') return '';

  const now = new Date().toISOString();
  const provisional: FormTemplateField = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    formTemplateId: input.formTemplateId,
    fieldType: input.fieldType,
    label,
    ...(input.description === undefined || input.description.trim() === ''
      ? null
      : { description: input.description.trim() }),
    required: input.required ?? false,
    sortOrder: lastFieldSortOrder(store, input.formTemplateId),
    config: input.config ?? {},
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createFormTemplateField: { field: FormTemplateField } }>({
    mutation: CREATE_FORM_TEMPLATE_FIELD,
    variables: {
      input: {
        formTemplateId: input.formTemplateId,
        fieldType: input.fieldType,
        label,
        ...(input.description?.trim() ? { description: input.description.trim() } : null),
        required: input.required ?? false,
        config: input.config ?? {},
      },
    },
    optimistic: [
      { type: 'formTemplateField', id: provisional.id, before: null, after: provisional },
    ],
    reconcile: {
      type: 'formTemplateField',
      provisionalId: provisional.id,
      path: ['createFormTemplateField', 'field'],
    },
  });

  return data.createFormTemplateField.field.id;
}

export async function deleteFormTemplateField(engine: SyncEngine, fieldId: UUID): Promise<void> {
  const before = engine.store.get('formTemplateField', fieldId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: DELETE_FORM_TEMPLATE_FIELD,
    variables: { id: fieldId },
    optimistic: [{ type: 'formTemplateField', id: fieldId, before, after: null }],
  });
}

export async function updateFormTemplateField(
  engine: SyncEngine,
  fieldId: UUID,
  input: Partial<Pick<FormTemplateField, 'label' | 'description' | 'required' | 'config'>>,
): Promise<void> {
  const before = engine.store.get('formTemplateField', fieldId);
  if (before === undefined) return;

  const after: FormTemplateField = {
    ...before,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_FORM_TEMPLATE_FIELD,
    variables: {
      input: {
        id: fieldId,
        ...(input.label !== undefined ? { label: input.label } : null),
        ...(input.description !== undefined ? { description: input.description } : null),
        ...(input.required !== undefined ? { required: input.required } : null),
        ...(input.config !== undefined ? { config: input.config } : null),
      },
    },
    optimistic: [{ type: 'formTemplateField', id: fieldId, before, after }],
  });
}

/** Form templates offered in a team, same rules as standard templates. */
export function formTemplatesForTeam(store: Store, teamId: UUID): FormTemplate[] {
  const team = store.get('team', teamId);
  if (team === undefined || team.archivedAt !== undefined || team.retiredAt !== undefined) {
    return [];
  }

  const offered: FormTemplate[] = [];
  for (const template of store.formTemplates.values()) {
    if (template.archivedAt !== undefined) continue;
    if (template.teamId !== undefined && template.teamId !== teamId) continue;
    offered.push(template);
  }
  return offered.sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name),
  );
}

export function fieldsForFormTemplate(store: Store, formTemplateId: UUID): FormTemplateField[] {
  const fields: FormTemplateField[] = [];
  for (const id of store.formTemplateFieldIdsFor(formTemplateId)) {
    const field = store.formTemplateFields.get(id);
    if (field !== undefined) fields.push(field);
  }
  return fields.sort((a, b) =>
    a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.label.localeCompare(b.label),
  );
}
