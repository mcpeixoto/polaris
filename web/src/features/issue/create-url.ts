/**
 * Pre-filled creation URLs.
 *
 * `/new` and `/team/:key/new` accept query params so a template, a Slack unfurl, a
 * bookmark or a paste from another tool can land someone in the composer already filled
 * in. The grammar is the documented one: title, description, status, team, priority,
 * assignee, estimate, cycle, label(s), project, milestone, template.
 *
 * Parsing is stringly. Resolution against the replica — turning "ENG" into a team id,
 * "me" into the viewer — happens later, because this module has to work before the
 * workspace has finished hydrating and in tests that have no store.
 */

import { PRIORITY_LABELS } from '~/components';
import type { Store, UUID } from '~/store';

export interface CreateURLParams {
  readonly title?: string;
  readonly description?: string;
  readonly status?: string;
  readonly team?: string;
  readonly priority?: string;
  readonly assignee?: string;
  readonly estimate?: string;
  readonly cycle?: string;
  readonly labels?: string;
  readonly project?: string;
  readonly milestone?: string;
  readonly template?: string;
}

/** What the composer can actually set once names have been resolved to ids. */
export interface IssueComposerSeed {
  readonly teamId?: UUID;
  readonly teamKey?: string;
  readonly title?: string;
  readonly description?: string;
  readonly stateId?: UUID;
  readonly assigneeId?: UUID | 'me';
  readonly priority?: number;
  readonly estimate?: number;
  readonly cycleId?: UUID;
  readonly labelIds?: readonly UUID[];
  readonly projectId?: UUID;
  readonly projectMilestoneId?: UUID;
  readonly templateId?: UUID;
  /** A saved draft this seed is resuming. Submitting or discarding clears it. */
  readonly draftId?: UUID;
}

const T_SHIRT: Readonly<Record<string, number>> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 5,
  xl: 8,
  xxl: 13,
  xxxl: 21,
};

/**
 * Reads the documented query keys off a URLSearchParams.
 *
 * `label` and `labels` are the same field: some tools send one, some the other, and
 * collapsing them here is what stops a bookmark that used the singular from silently
 * creating an unlabelled issue.
 */
export function parseCreateURL(
  search: URLSearchParams,
  teamKeyFromPath?: string | null,
): CreateURLParams {
  const pick = (key: string): string | undefined => {
    const value = search.get(key);
    if (value === null) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const milestone = pick('milestone') ?? pick('projectMilestone');
  const labels = pick('labels') ?? pick('label');
  const team =
    pick('team') ??
    (teamKeyFromPath === null || teamKeyFromPath === undefined || teamKeyFromPath === ''
      ? undefined
      : teamKeyFromPath);

  return {
    ...(pick('title') === undefined ? null : { title: pick('title') }),
    ...(pick('description') === undefined ? null : { description: pick('description') }),
    ...(pick('status') === undefined ? null : { status: pick('status') }),
    ...(team === undefined ? null : { team }),
    ...(pick('priority') === undefined ? null : { priority: pick('priority') }),
    ...(pick('assignee') === undefined ? null : { assignee: pick('assignee') }),
    ...(pick('estimate') === undefined ? null : { estimate: pick('estimate') }),
    ...(pick('cycle') === undefined ? null : { cycle: pick('cycle') }),
    ...(labels === undefined ? null : { labels }),
    ...(pick('project') === undefined ? null : { project: pick('project') }),
    ...(milestone === undefined ? null : { milestone }),
    ...(pick('template') === undefined ? null : { template: pick('template') }),
  };
}

/**
 * Turns names, keys and "me" into ids the composer can set without thinking.
 *
 * Unknown names are dropped rather than failing the whole URL: a stale status name should
 * still create the issue, just without that field. The filer can see the empty picker.
 */
export function resolveCreateURL(
  store: Store,
  params: CreateURLParams,
  viewerId: UUID | null,
): IssueComposerSeed {
  const team = resolveTeam(store, params.team);
  const seed: IssueComposerSeed = {
    ...(team === undefined ? null : { teamId: team.id, teamKey: team.key }),
    ...(params.title === undefined ? null : { title: params.title }),
    ...(params.description === undefined ? null : { description: params.description }),
    ...(params.priority === undefined ? null : { priority: parsePriority(params.priority) }),
    ...(params.estimate === undefined ? null : { estimate: parseEstimate(params.estimate) }),
  };

  const stateId = team === undefined ? undefined : resolveState(store, team.id, params.status);
  const assigneeId = resolveAssignee(store, params.assignee, viewerId);
  const projectId = resolveProject(store, params.project, team?.id);
  const cycleId = team === undefined ? undefined : resolveCycle(store, team.id, params.cycle);
  const templateId = resolveTemplate(store, params.template, team?.id);
  const labelIds = resolveLabels(store, params.labels, team?.id);
  const projectMilestoneId =
    projectId === undefined ? undefined : resolveMilestone(store, projectId, params.milestone);

  return {
    ...seed,
    ...(stateId === undefined ? null : { stateId }),
    ...(assigneeId === undefined ? null : { assigneeId }),
    ...(projectId === undefined ? null : { projectId }),
    ...(cycleId === undefined ? null : { cycleId }),
    ...(templateId === undefined ? null : { templateId }),
    ...(labelIds === undefined ? null : { labelIds }),
    ...(projectMilestoneId === undefined ? null : { projectMilestoneId }),
  };
}

/**
 * Builds a `/new` (or `/team/:key/new`) URL from the composer's current fields.
 *
 * Only the fields that are actually set go on the query string, so copying a blank
 * composer produces `/new` rather than a wall of empty params.
 */
export function buildCreateURL(input: {
  readonly teamKey?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly statusName?: string | undefined;
  readonly priority?: number | undefined;
  readonly assignee?: string | undefined;
  readonly estimate?: number | undefined;
  readonly cycle?: string | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly project?: string | undefined;
  readonly template?: string | undefined;
}): string {
  const path = input.teamKey ? `/team/${encodeURIComponent(input.teamKey)}/new` : '/new';
  const query = new URLSearchParams();
  if (input.title) query.set('title', input.title);
  if (input.description) query.set('description', input.description);
  if (input.statusName) query.set('status', input.statusName);
  if (input.priority !== undefined && input.priority !== 0) {
    query.set('priority', PRIORITY_LABELS[input.priority] ?? String(input.priority));
  }
  if (input.assignee) query.set('assignee', input.assignee);
  if (input.estimate !== undefined) query.set('estimate', String(input.estimate));
  if (input.cycle) query.set('cycle', input.cycle);
  if (input.labels !== undefined && input.labels.length > 0)
    query.set('labels', input.labels.join(','));
  if (input.project) query.set('project', input.project);
  if (input.template) query.set('template', input.template);
  const encoded = query.toString();
  return encoded === '' ? path : `${path}?${encoded}`;
}

function resolveTeam(store: Store, raw: string | undefined): { id: UUID; key: string } | undefined {
  if (raw === undefined) return undefined;
  const folded = raw.toLowerCase();
  for (const team of store.teams.values()) {
    if (team.archivedAt !== undefined || team.retiredAt !== undefined) continue;
    if (team.id === raw || team.key.toLowerCase() === folded) return { id: team.id, key: team.key };
  }
  return undefined;
}

function resolveState(store: Store, teamId: UUID, raw: string | undefined): UUID | undefined {
  if (raw === undefined) return undefined;
  const folded = raw.toLowerCase();
  for (const id of store.workflowStateIdsFor(teamId)) {
    const state = store.workflowStates.get(id);
    if (state === undefined || state.archivedAt !== undefined) continue;
    if (state.id === raw || state.name.toLowerCase() === folded) return state.id;
  }
  return undefined;
}

function resolveAssignee(
  store: Store,
  raw: string | undefined,
  viewerId: UUID | null,
): UUID | 'me' | undefined {
  if (raw === undefined) return undefined;
  if (raw.toLowerCase() === 'me') return viewerId ?? 'me';
  const folded = raw.toLowerCase();
  for (const user of store.users.values()) {
    if (user.status !== 'active' || user.archivedAt !== undefined) continue;
    if (
      user.id === raw ||
      user.name.toLowerCase() === folded ||
      user.displayName.toLowerCase() === folded
    ) {
      return user.id;
    }
  }
  return undefined;
}

function resolveProject(
  store: Store,
  raw: string | undefined,
  teamId: UUID | undefined,
): UUID | undefined {
  if (raw === undefined) return undefined;
  const folded = raw.toLowerCase();
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (project.id !== raw && project.name.toLowerCase() !== folded) continue;
    if (teamId !== undefined) {
      const onTeam = [...store.projectTeamIdsFor(project.id)].some(
        (id) => store.projectTeams.get(id)?.teamId === teamId,
      );
      if (!onTeam) continue;
    }
    return project.id;
  }
  return undefined;
}

function resolveCycle(store: Store, teamId: UUID, raw: string | undefined): UUID | undefined {
  if (raw === undefined) return undefined;
  const folded = raw.toLowerCase();
  const asNumber = Number(raw);
  for (const cycle of store.cycles.values()) {
    if (cycle.teamId !== teamId || cycle.archivedAt !== undefined) continue;
    if (cycle.id === raw || cycle.name.toLowerCase() === folded) return cycle.id;
    if (Number.isInteger(asNumber) && cycle.number === asNumber) return cycle.id;
  }
  return undefined;
}

function resolveTemplate(
  store: Store,
  raw: string | undefined,
  teamId: UUID | undefined,
): UUID | undefined {
  if (raw === undefined) return undefined;
  const folded = raw.toLowerCase();
  for (const template of store.issueTemplates.values()) {
    if (template.archivedAt !== undefined) continue;
    if (teamId !== undefined && template.teamId !== undefined && template.teamId !== teamId)
      continue;
    if (template.id === raw || template.name.toLowerCase() === folded) return template.id;
  }
  return undefined;
}

function resolveLabels(
  store: Store,
  raw: string | undefined,
  teamId: UUID | undefined,
): readonly UUID[] | undefined {
  if (raw === undefined) return undefined;
  const names = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (names.length === 0) return undefined;
  const ids: UUID[] = [];
  for (const name of names) {
    const folded = name.toLowerCase();
    for (const label of store.labels.values()) {
      if (label.archivedAt !== undefined) continue;
      if (teamId !== undefined && label.teamId !== undefined && label.teamId !== teamId) continue;
      if (label.id === name || label.name.toLowerCase() === folded) {
        ids.push(label.id);
        break;
      }
    }
  }
  return ids.length === 0 ? undefined : ids;
}

function resolveMilestone(
  store: Store,
  projectId: UUID,
  raw: string | undefined,
): UUID | undefined {
  if (raw === undefined) return undefined;
  const folded = raw.toLowerCase();
  for (const milestone of store.projectMilestones.values()) {
    if (milestone.projectId !== projectId || milestone.archivedAt !== undefined) continue;
    if (milestone.id === raw || milestone.name.toLowerCase() === folded) return milestone.id;
  }
  return undefined;
}

/**
 * Urgent / High / Medium / Low, or the numeric scale 0–4. Anything else is no priority,
 * which is also what a typo should produce rather than a thrown URL.
 */
export function parsePriority(raw: string): number {
  const folded = raw.trim().toLowerCase();
  const byName = PRIORITY_LABELS.findIndex((label) => label.toLowerCase() === folded);
  if (byName > 0) return byName;
  const n = Number(raw);
  if (n === 0 || n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 0;
}

export function parseEstimate(raw: string): number | undefined {
  const folded = raw.trim().toLowerCase();
  const shirt = T_SHIRT[folded];
  if (shirt !== undefined) return shirt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}
