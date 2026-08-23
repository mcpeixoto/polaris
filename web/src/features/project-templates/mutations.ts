import {
  uuidv7,
  type EntityPatch,
  type ProjectTemplate,
  type ProjectTemplateIssue,
  type ProjectTemplateMilestone,
  type ProjectTemplateProperties,
  type Store,
  type TemplateProperties,
  type UUID,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import {
  ARCHIVE_PROJECT_TEMPLATE,
  CREATE_PROJECT_TEMPLATE,
  CREATE_PROJECT_TEMPLATE_ISSUE,
  CREATE_PROJECT_TEMPLATE_MILESTONE,
  DELETE_PROJECT_TEMPLATE_ISSUE,
  DELETE_PROJECT_TEMPLATE_MILESTONE,
  UPDATE_PROJECT_TEMPLATE,
} from './operations';

export interface NewProjectTemplate {
  readonly teamId?: UUID | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly summary?: string | undefined;
  readonly body?: string | undefined;
  readonly properties?: ProjectTemplateProperties | undefined;
  readonly createdBy?: UUID | undefined;
}

export interface NewProjectTemplateMilestone {
  readonly projectTemplateId: UUID;
  readonly name: string;
  readonly description?: string | undefined;
  readonly targetDate?: string | undefined;
}

export interface NewProjectTemplateIssue {
  readonly projectTemplateId: UUID;
  readonly title: string;
  readonly description?: string | undefined;
  readonly properties?: TemplateProperties | undefined;
}

function lastProjectTemplatePosition(store: Store): string {
  let last = '';
  for (const template of store.projectTemplates.values()) {
    if (template.position > last) last = template.position;
  }
  return last === '' ? 'a0' : `${last}~`;
}

function lastMilestoneSortOrder(store: Store, projectTemplateId: UUID): string {
  let last = '';
  for (const id of store.projectTemplateMilestoneIdsFor(projectTemplateId)) {
    const milestone = store.projectTemplateMilestones.get(id);
    if (milestone !== undefined && milestone.sortOrder > last) last = milestone.sortOrder;
  }
  return last === '' ? 'a0' : `${last}~`;
}

function lastIssueSortOrder(store: Store, projectTemplateId: UUID): string {
  let last = '';
  for (const id of store.projectTemplateIssueIdsFor(projectTemplateId)) {
    const issue = store.projectTemplateIssues.get(id);
    if (issue !== undefined && issue.sortOrder > last) last = issue.sortOrder;
  }
  return last === '' ? 'a0' : `${last}~`;
}

export async function createProjectTemplate(
  engine: SyncEngine,
  input: NewProjectTemplate,
): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const description = (input.description ?? '').trim();
  const summary = (input.summary ?? '').trim();
  const body = input.body ?? '';
  const properties = input.properties ?? {};
  const now = new Date().toISOString();

  const provisional: ProjectTemplate = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    name,
    ...(description === '' ? null : { description }),
    summary,
    body,
    properties,
    position: lastProjectTemplatePosition(store),
    ...(input.createdBy === undefined ? null : { createdBy: input.createdBy }),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createProjectTemplate: { template: ProjectTemplate } }>({
    mutation: CREATE_PROJECT_TEMPLATE,
    variables: {
      input: {
        name,
        ...(input.teamId === undefined ? null : { teamId: input.teamId }),
        ...(description === '' ? null : { description }),
        summary,
        body,
        properties,
      },
    },
    optimistic: [{ type: 'projectTemplate', id: provisional.id, before: null, after: provisional }],
    reconcile: {
      type: 'projectTemplate',
      provisionalId: provisional.id,
      path: ['createProjectTemplate', 'template'],
      // And from the delta stream, which usually gets here first — the socket pushes the
      // row the moment the mutation commits, while the response is still travelling back.
      // Scope and name.
      match: ['teamId', 'name'],
    },
  });

  return data.createProjectTemplate.template.id;
}

export async function updateProjectTemplate(
  engine: SyncEngine,
  templateId: UUID,
  input: {
    name?: string;
    description?: string;
    summary?: string;
    body?: string;
    properties?: ProjectTemplateProperties;
  },
): Promise<void> {
  const store = engine.store;
  const before = store.get('projectTemplate', templateId);
  if (before === undefined) return;

  const name = input.name?.trim() ?? before.name;
  const description =
    input.description === undefined ? before.description : input.description.trim();
  const summary = input.summary === undefined ? before.summary : input.summary.trim();
  const body = input.body ?? before.body;
  const properties = input.properties ?? before.properties;
  const after: ProjectTemplate = {
    ...before,
    name,
    description: description === '' ? undefined : description,
    summary,
    body,
    properties,
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_PROJECT_TEMPLATE,
    variables: {
      input: {
        id: templateId,
        name,
        ...(description === '' ? { description: '' } : description ? { description } : null),
        summary,
        body,
        properties,
      },
    },
    optimistic: [{ type: 'projectTemplate', id: templateId, before, after }],
  });
}

export async function archiveProjectTemplate(engine: SyncEngine, templateId: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('projectTemplate', templateId);
  if (before === undefined) return;

  const deletes: EntityPatch[] = [];
  for (const milestoneId of store.projectTemplateMilestoneIdsFor(templateId)) {
    const milestone = store.get('projectTemplateMilestone', milestoneId);
    if (milestone !== undefined) {
      deletes.push({
        type: 'projectTemplateMilestone',
        id: milestoneId,
        before: milestone,
        after: null,
      });
    }
  }
  for (const issueId of store.projectTemplateIssueIdsFor(templateId)) {
    const issue = store.get('projectTemplateIssue', issueId);
    if (issue !== undefined) {
      deletes.push({ type: 'projectTemplateIssue', id: issueId, before: issue, after: null });
    }
  }

  await engine.mutate({
    mutation: ARCHIVE_PROJECT_TEMPLATE,
    variables: { id: templateId, archived: true },
    optimistic: [{ type: 'projectTemplate', id: templateId, before, after: null }, ...deletes],
  });
}

export async function createProjectTemplateMilestone(
  engine: SyncEngine,
  input: NewProjectTemplateMilestone,
): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const now = new Date().toISOString();
  const provisional: ProjectTemplateMilestone = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    projectTemplateId: input.projectTemplateId,
    name,
    ...(input.description === undefined || input.description.trim() === ''
      ? null
      : { description: input.description.trim() }),
    ...(input.targetDate === undefined || input.targetDate === ''
      ? null
      : { targetDate: input.targetDate }),
    sortOrder: lastMilestoneSortOrder(store, input.projectTemplateId),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{
    createProjectTemplateMilestone: { milestone: ProjectTemplateMilestone };
  }>({
    mutation: CREATE_PROJECT_TEMPLATE_MILESTONE,
    variables: {
      input: {
        projectTemplateId: input.projectTemplateId,
        name,
        ...(input.description?.trim() ? { description: input.description.trim() } : null),
        ...(input.targetDate ? { targetDate: input.targetDate } : null),
      },
    },
    optimistic: [
      { type: 'projectTemplateMilestone', id: provisional.id, before: null, after: provisional },
    ],
    reconcile: {
      type: 'projectTemplateMilestone',
      provisionalId: provisional.id,
      path: ['createProjectTemplateMilestone', 'milestone'],
      // And from the delta stream, which usually gets here first — the socket pushes the
      // row the moment the mutation commits, while the response is still travelling back.
      // The template and the milestone's name.
      match: ['projectTemplateId', 'name'],
    },
  });

  return data.createProjectTemplateMilestone.milestone.id;
}

export async function deleteProjectTemplateMilestone(
  engine: SyncEngine,
  milestoneId: UUID,
): Promise<void> {
  const before = engine.store.get('projectTemplateMilestone', milestoneId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: DELETE_PROJECT_TEMPLATE_MILESTONE,
    variables: { id: milestoneId },
    optimistic: [{ type: 'projectTemplateMilestone', id: milestoneId, before, after: null }],
  });
}

export async function createProjectTemplateIssue(
  engine: SyncEngine,
  input: NewProjectTemplateIssue,
): Promise<UUID> {
  const store = engine.store;
  const title = input.title.trim();
  if (title === '') return '';

  const now = new Date().toISOString();
  const provisional: ProjectTemplateIssue = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    projectTemplateId: input.projectTemplateId,
    title,
    description: input.description ?? '',
    properties: input.properties ?? {},
    sortOrder: lastIssueSortOrder(store, input.projectTemplateId),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createProjectTemplateIssue: { issue: ProjectTemplateIssue } }>(
    {
      mutation: CREATE_PROJECT_TEMPLATE_ISSUE,
      variables: {
        input: {
          projectTemplateId: input.projectTemplateId,
          title,
          description: input.description ?? '',
          properties: input.properties ?? {},
        },
      },
      optimistic: [
        { type: 'projectTemplateIssue', id: provisional.id, before: null, after: provisional },
      ],
      reconcile: {
        type: 'projectTemplateIssue',
        provisionalId: provisional.id,
        path: ['createProjectTemplateIssue', 'issue'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // The template and the issue's title.
        match: ['projectTemplateId', 'title'],
      },
    },
  );

  return data.createProjectTemplateIssue.issue.id;
}

export async function deleteProjectTemplateIssue(engine: SyncEngine, issueId: UUID): Promise<void> {
  const before = engine.store.get('projectTemplateIssue', issueId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: DELETE_PROJECT_TEMPLATE_ISSUE,
    variables: { id: issueId },
    optimistic: [{ type: 'projectTemplateIssue', id: issueId, before, after: null }],
  });
}

/** Project templates offered in a team, same rules as standard templates. */
export function projectTemplatesForTeam(store: Store, teamId: UUID): ProjectTemplate[] {
  const team = store.get('team', teamId);
  if (team === undefined || team.archivedAt !== undefined || team.retiredAt !== undefined) {
    return [];
  }

  const offered: ProjectTemplate[] = [];
  for (const template of store.projectTemplates.values()) {
    if (template.archivedAt !== undefined) continue;
    if (template.teamId !== undefined && template.teamId !== teamId) continue;
    offered.push(template);
  }
  return offered.sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name),
  );
}

export function milestonesForTemplate(
  store: Store,
  projectTemplateId: UUID,
): ProjectTemplateMilestone[] {
  const milestones: ProjectTemplateMilestone[] = [];
  for (const id of store.projectTemplateMilestoneIdsFor(projectTemplateId)) {
    const milestone = store.projectTemplateMilestones.get(id);
    if (milestone !== undefined) milestones.push(milestone);
  }
  return milestones.sort((a, b) =>
    a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.name.localeCompare(b.name),
  );
}

export function issuesForTemplate(store: Store, projectTemplateId: UUID): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  for (const id of store.projectTemplateIssueIdsFor(projectTemplateId)) {
    const issue = store.projectTemplateIssues.get(id);
    if (issue !== undefined) issues.push(issue);
  }
  return issues.sort((a, b) =>
    a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.title.localeCompare(b.title),
  );
}
