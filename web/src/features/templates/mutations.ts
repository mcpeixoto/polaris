/**
 * Every write the template surfaces make, plus the one read that decides what a template is
 * allowed to prefill in a given team.
 *
 * The writes are the same bargain the label and issue mutations strike: work out what the
 * change looks like locally, hand it to `engine.mutate` with the document, and return. The
 * store applies the patch synchronously, the settings screen re-renders inside the frame, and
 * the network happens afterwards to somebody else's schedule. Unlike API keys, templates are
 * a replicated entity — there is an `issueTemplate` collection in the store and the sync
 * stream keeps it current — so an optimistic patch here is a patch the stream will confirm
 * rather than a guess about a row nobody can see.
 *
 * Three things about templates specifically, all of them consequences of the schema:
 *
 * **Scope is fixed at creation.** `UpdateIssueTemplateInput` has no `teamId`, so nothing in
 * this file can move a template between a team and the workspace. That is not an omission:
 * moving one changes who is offered it, and the teams that lose it have to be told rather
 * than have a COALESCE decide for them. The editor states the rule while the choice is still
 * live instead of shipping a control the server refuses.
 *
 * **`properties` is written whole, never merged.** The server's update is
 * `properties = COALESCE($properties, properties)`, so the JSON is replaced outright.
 * Sending `{ priority: 2 }` to a template that also carried an assignee *drops* the
 * assignee. `updateTemplate` therefore takes the full set the template should have from now
 * on, and its callers build that set rather than a delta.
 *
 * **A template's properties are only meaningful in a team that owns them.** A status id
 * belongs to exactly one team, and a team's label may only go on that team's issues, so a
 * template can carry a property that the team filing the issue cannot use. `templateDefaults`
 * is where that is resolved — see the note above it, because it is the one genuinely subtle
 * part of this feature.
 *
 * On failure: `engine.mutate` reverts the patch when the server rejects a write and leaves it
 * standing when the request never left the building. Everything here still rejects, so the
 * settings screen can put the server's own words in front of the user.
 */

import { estimatesEnabled } from '~/features/estimate';
import { fromWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityPatch,
  type IssueTemplate,
  type Store,
  type TemplateProperties,
  type UUID,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ARCHIVE_ISSUE_TEMPLATE, CREATE_ISSUE_TEMPLATE, UPDATE_ISSUE_TEMPLATE } from './operations';

export interface NewTemplate {
  /** Absent offers the template in every team. Fixed from here on; see the note above. */
  readonly teamId?: UUID | undefined;
  readonly name: string;
  /** What the template is *for*. The picker shows it beside the name. */
  readonly description?: string | undefined;
  /** The issue title it prefills. Empty on purpose means the filer writes their own. */
  readonly title?: string | undefined;
  /** The issue description it prefills, as Markdown. */
  readonly body?: string | undefined;
  readonly properties?: TemplateProperties | undefined;
  /** The viewer, when it is known. Only used by the optimistic row. */
  readonly createdBy?: UUID | undefined;
}

/**
 * Creates a template and returns the id it ends up with.
 *
 * The id is the server's, not the client's: `CreateIssueTemplateInput` has no `id` field, so
 * the local row is a stand-in swapped for the real one when the reply lands — the same trade
 * `createLabel` makes, and acceptable here for the same reason. A template is written on a
 * settings screen by somebody watching the dialog close, not queued behind an hour of tunnel,
 * so the one case where the stand-in outlives a frame is rare and self-heals on the next
 * delta.
 */
export async function createTemplate(engine: SyncEngine, input: NewTemplate): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const description = (input.description ?? '').trim();
  const title = input.title ?? '';
  const body = input.body ?? '';
  const properties = input.properties ?? {};
  const now = new Date().toISOString();

  const provisional: IssueTemplate = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    name,
    // Omitted rather than sent empty, so the column stays NULL and the store's optional
    // field stays absent. An *update* cannot reach that state again — see `updateTemplate`.
    ...(description === '' ? null : { description }),
    // Non-null locally even though both are optional on the wire: the columns default to an
    // empty string, and a stand-in that used `undefined` would differ in shape from the row
    // the server sends back a moment later.
    title,
    body,
    properties,
    position: lastPosition(store),
    ...(input.createdBy === undefined ? null : { createdBy: input.createdBy }),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createIssueTemplate: { template: IssueTemplate } }>({
    mutation: CREATE_ISSUE_TEMPLATE,
    variables: {
      input: {
        name,
        ...(input.teamId === undefined ? null : { teamId: input.teamId }),
        ...(description === '' ? null : { description }),
        ...(title === '' ? null : { title }),
        ...(body === '' ? null : { body }),
        properties,
      },
    },
    optimistic: [{ type: 'issueTemplate', id: provisional.id, before: null, after: provisional }],
  });

  const real = data.createIssueTemplate.template;
  swapTemplate(store, provisional.id, real);
  return real.id;
}

export interface TemplateFields {
  readonly name?: string | undefined;
  /**
   * `''` empties it. It cannot be put back to NULL — the server's update is a COALESCE, so
   * there is no value that means "clear this" — and every reader here treats an empty
   * description as no description, which makes the difference invisible where it matters.
   */
  readonly description?: string | undefined;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  /**
   * The whole property set the template should have from now on, never a subset. The server
   * replaces the stored JSON rather than merging into it.
   */
  readonly properties?: TemplateProperties | undefined;
}

/**
 * Edits a template, everything except its scope.
 *
 * Applied before the server answers because every field here is keystroke-scale and its only
 * plausible refusal is a name that is blank or too long — both of which the editor catches
 * first. The scope is absent and cannot be added: see the note at the top of the file.
 */
export async function updateTemplate(
  engine: SyncEngine,
  templateId: UUID,
  fields: TemplateFields,
): Promise<void> {
  const before = engine.store.get('issueTemplate', templateId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: IssueTemplate = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.title === undefined ? null : { title: fields.title }),
    ...(fields.body === undefined ? null : { body: fields.body }),
    ...(fields.properties === undefined ? null : { properties: fields.properties }),
    updatedAt: new Date().toISOString(),
  };
  if (sameTemplate(before, after)) return;

  await engine.mutate({
    mutation: UPDATE_ISSUE_TEMPLATE,
    variables: {
      input: {
        id: templateId,
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.description === before.description
          ? null
          : { description: after.description ?? '' }),
        ...(after.title === before.title ? null : { title: after.title }),
        ...(after.body === before.body ? null : { body: after.body }),
        // Sent whole whenever any part of it moved, because that is the only shape the
        // server accepts. Comparing first keeps a rename from rewriting the JSON.
        ...(sameProperties(before.properties, after.properties)
          ? null
          : { properties: after.properties }),
      },
    },
    optimistic: [{ type: 'issueTemplate', id: templateId, before, after }],
  });
}

/**
 * Retires a template, optimistically, and there is no way back.
 *
 * Optimistic, unlike `archiveLabel`, and the difference is the server's. An archive of a
 * label is refused while anything still carries it, so the common outcome is a refusal the
 * user has to read; an archive of a template has no such precondition — the only failure is
 * a permission the screen already knows about, or a template somebody else retired a moment
 * ago. So the row leaves the list on the frame the button is pressed, and a rejection reverts
 * it with the server's own words beside it.
 *
 * The patch is a delete rather than a flag, because that is what the sync stream carries: the
 * server keeps the row in Postgres — `issue.template_id` references it, so issues made from
 * the template keep their link — but emits `OpDelete`, and every replica forgets it. Combined
 * with there being no un-archive mutation and `issueTemplate(id:)` answering not-found for an
 * archived one, that makes this irreversible *and* unlistable from the client: after this
 * call there is no query on this side that can show the template again. The screen says so
 * before the button is pressed rather than leaving somebody to discover it.
 */
export async function archiveTemplate(engine: SyncEngine, templateId: UUID): Promise<void> {
  const before = engine.store.get('issueTemplate', templateId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: ARCHIVE_ISSUE_TEMPLATE,
    variables: { id: templateId },
    optimistic: [{ type: 'issueTemplate', id: templateId, before, after: null }],
  });
}

/**
 * What a template should actually prefill on an issue in this team.
 *
 * This is the part of the feature that is not obvious, and the reason is worth stating
 * plainly: **a template's properties are ids, and an id has a scope**. A workflow status
 * belongs to exactly one team; a team's label may only be applied to that team's issues. So a
 * template can perfectly legitimately name a property that the team filing the issue cannot
 * use — a workspace template written before a team existed, a team template whose status was
 * archived, a label somebody deleted last week.
 *
 * There are three possible answers and only one of them is a product. Sending the id anyway
 * gets a refusal from the database in the middle of filing an issue, about a template the
 * user did not write. Refusing to offer the template at all hides a perfectly good title and
 * body because one property no longer resolves. This drops what cannot apply, keeps
 * everything that can, and *says* what it dropped — so the create dialog can render "its
 * status does not belong to this team and has been left at the default" instead of silently
 * doing something other than what the template says.
 *
 * The editor is the other half of this bargain and does the same work forwards: it never
 * offers a status to a workspace template, and never offers another team's labels. Both are
 * needed. The editor keeps well-formed templates from being written; this keeps the
 * ill-formed ones — from the API, from a team that has moved on — from breaking a create.
 */
export interface TemplateDefaults {
  /** For `CreateIssueInput.templateId`, which is what records where the issue came from. */
  readonly templateId: UUID;
  /** Empty means the template prefills no title and the filer writes their own. */
  readonly title: string;
  /** The template's `body`, under the name `CreateIssueInput` gives it. */
  readonly description: string;
  readonly stateId?: UUID | undefined;
  readonly assigneeId?: UUID | undefined;
  readonly priority?: number | undefined;
  readonly estimate?: number | undefined;
  readonly labelIds: readonly UUID[];
  /**
   * The properties this team cannot use, named in words a dialog can show: `status`,
   * `assignee`, `estimate`, `1 label`. Empty in the ordinary case.
   */
  readonly dropped: readonly string[];
}

export function templateDefaults(
  store: Store,
  template: IssueTemplate,
  teamId: UUID,
): TemplateDefaults {
  const properties = template.properties;
  const dropped: string[] = [];

  // A status belongs to one team, full stop. A workspace template can never carry one that
  // resolves here, and a team template can stop carrying one the moment the status is
  // archived — both land in the same branch, which is why this is checked rather than
  // inferred from the template's scope.
  const state =
    properties.stateId === undefined ? undefined : store.get('workflowState', properties.stateId);
  const stateId =
    state !== undefined && state.teamId === teamId && state.archivedAt === undefined
      ? state.id
      : undefined;
  if (properties.stateId !== undefined && stateId === undefined) dropped.push('status');

  // Membership is not checked: assigning somebody outside the team is a thing the product
  // allows, and a template that names a person is naming a person rather than a seat. Only
  // a user who has left is dropped, because assigning to them would file the issue into
  // nobody's queue.
  const assignee =
    properties.assigneeId === undefined ? undefined : store.get('user', properties.assigneeId);
  const assigneeId =
    assignee !== undefined && assignee.status === 'active' && assignee.archivedAt === undefined
      ? assignee.id
      : undefined;
  if (properties.assigneeId !== undefined && assigneeId === undefined) dropped.push('assignee');

  // An estimate is a bare number and every team stores the same numbers, so the only team
  // that cannot use one is a team that does not estimate at all.
  const team = store.get('team', teamId);
  const estimate =
    properties.estimate !== undefined && team !== undefined && estimatesEnabled(team)
      ? properties.estimate
      : undefined;
  if (properties.estimate !== undefined && estimate === undefined) dropped.push('estimate');

  const labelIds: UUID[] = [];
  // At most one label from a group may sit on an issue, so a template naming two group-mates
  // would have its second application refused. The first one wins, which is arbitrary but
  // stable — and the editor stops this being written in the first place.
  const groupsTaken = new Set<UUID>();
  let lostLabels = 0;
  for (const labelId of properties.labelIds ?? []) {
    const label = store.get('label', labelId);
    const applicable =
      label !== undefined &&
      label.archivedAt === undefined &&
      !label.isGroup &&
      (label.teamId === undefined || label.teamId === teamId) &&
      (label.parentId === undefined || !groupsTaken.has(label.parentId));
    if (!applicable) {
      lostLabels += 1;
      continue;
    }
    if (label.parentId !== undefined) groupsTaken.add(label.parentId);
    labelIds.push(label.id);
  }
  if (lostLabels > 0) dropped.push(`${lostLabels} ${lostLabels === 1 ? 'label' : 'labels'}`);

  return {
    templateId: template.id,
    title: template.title,
    description: template.body,
    stateId,
    assigneeId,
    // Zero is the absence of a priority rather than a value, so a template carrying it says
    // nothing and is left off — the create dialog's own default is already zero.
    ...(properties.priority === undefined || properties.priority === 0
      ? null
      : { priority: properties.priority }),
    estimate,
    labelIds,
    dropped,
  };
}

/**
 * Puts the server's row in place of the stand-in, in one store write.
 *
 * One write rather than two because every subscribed row re-renders between them otherwise,
 * and a template that vanishes for a frame on its way to being replaced by itself is the
 * exact flicker the optimistic patch exists to prevent. See `swapLabel`, which this mirrors.
 */
function swapTemplate(store: Store, provisionalId: UUID, wire: IssueTemplate): void {
  // `issueTemplate` carries no enumerated field today, so this returns its argument
  // untouched. It is here anyway, so that "a GraphQL response goes through fromWire before it
  // reaches the store" is a rule with no exceptions to remember — the exceptions are what let
  // `"BLOCKS"` into the store in the first place. See web/src/gql/enums.ts.
  const real = fromWire('issueTemplate', wire);
  const patch: EntityPatch[] = [
    {
      type: 'issueTemplate',
      id: real.id,
      before: store.get('issueTemplate', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'issueTemplate', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

/**
 * A position after every template in the workspace.
 *
 * Deliberately not scoped the way `lastPositionIn` is for labels, and the difference is the
 * server's: `GetLastIssueTemplatePosition` reads the maximum across the whole workspace, so
 * that a team's templates and the workspace's interleave in one stated order rather than in
 * whichever order two lists happened to be concatenated. A per-scope guess here would put the
 * stand-in somewhere the server's key will not, and the row would jump when the reply lands.
 *
 * Fractional indices compare as plain strings, so extending the current maximum sorts after
 * all of them whatever they look like. It never leaves this machine.
 */
function lastPosition(store: Store): string {
  let highest = '';
  for (const template of store.issueTemplates.values()) {
    if (template.position > highest) highest = template.position;
  }
  return `${highest}z`;
}

/** Whether an update would change anything, so a form re-submitted unchanged is free. */
function sameTemplate(before: IssueTemplate, after: IssueTemplate): boolean {
  return (
    before.name === after.name &&
    before.description === after.description &&
    before.title === after.title &&
    before.body === after.body &&
    sameProperties(before.properties, after.properties)
  );
}

/**
 * Whether two property sets say the same thing.
 *
 * Written out rather than compared as JSON: key order is not part of the meaning, `labelIds`
 * is a list whose order is not either, and `JSON.stringify` would report a difference for
 * both — which would send a full `properties` rewrite over the wire every time somebody
 * reopened the editor and pressed Save.
 */
function sameProperties(a: TemplateProperties, b: TemplateProperties): boolean {
  if (
    a.stateId !== b.stateId ||
    a.assigneeId !== b.assigneeId ||
    a.priority !== b.priority ||
    a.estimate !== b.estimate
  ) {
    return false;
  }
  const left = [...(a.labelIds ?? [])].sort();
  const right = [...(b.labelIds ?? [])].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
