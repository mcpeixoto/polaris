/**
 * What the row menu offers, read out of the replica once per open menu.
 *
 * The builder in `rowMenu.tsx` takes lists and knows nothing about a store; every surface
 * that draws it has a store and no appetite for six more `useLiveQuery` calls. This is the
 * one place the two meet, so a status list is ordered the same way on the issue list, in
 * peek, in the inbox and on the detail header — and so a surface that adds the menu gets all
 * of it by calling one hook.
 *
 * Two decisions are worth stating.
 *
 * **It answers for a selection, not only for a row.** Every value is ticked only where the
 * targeted issues agree on it, which is the same rule the bulk pickers follow: forty issues
 * with four assignees must not show a tick against one of them.
 *
 * **The search box is state, and it lives here.** "Mark as ▸ Blocked by…" filters over the
 * whole corpus, which is not a list the menu can hold, so the submenu reports what was typed
 * and the answer comes back through `candidates`. The query is reset when the menu closes;
 * a surface that forgets to call `reset` gets a stale eight rows the next time it opens,
 * which is why `reset` is returned rather than left to a `useEffect` nobody can see.
 */

import { useCallback, useMemo, useState } from 'react';

import { defaultRelatives } from '~/components';
import { estimateLabel, estimateOptions, estimatesEnabled } from '~/features/estimate';
import { labelOfferings } from '~/features/labels/LabelPicker';
import { personName } from '~/features/prefs/prefs';
import { listProjectMilestones } from '~/features/project-milestones/helpers';
import { rankProjects } from '~/features/projects/ProjectPicker';
import { rankCycles } from '~/features/cycles/CyclePicker';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import { CATEGORY_ORDER, type EntityType, type Store, type UUID } from '~/store';

import { searchIssues } from './relationLinks';
import type { IssueRowMenuOptions, NamedChoice, StateChoice } from './rowMenu';

/** Everything the menu's lists can change under. Declared once; six surfaces subscribe to it. */
export const ROW_MENU_DEPS: readonly EntityType[] = [
  'issue',
  'issueRelation',
  'issueLabel',
  'label',
  'team',
  'user',
  'workflowState',
  'project',
  'projectStatus',
  'projectTeam',
  'projectMember',
  'projectMilestone',
  'cycle',
];

export interface RowMenuOptionsInput {
  /** The issue the menu is about — the one a relation or a copy would be written from. */
  readonly issueId: UUID | null;
  /**
   * Every issue the menu writes to. Defaults to the one above.
   *
   * A right-click inside a standing selection acts on the selection, and the ticks have to
   * say so: a value the six do not share is ticked nowhere.
   */
  readonly targets?: readonly UUID[] | undefined;
  /** False while no menu is open, so a closed menu costs nothing but the subscription. */
  readonly enabled?: boolean | undefined;
}

export interface RowMenuOptionsHandle {
  readonly options: IssueRowMenuOptions;
  /** Forgets what was typed into a "Mark as" box. Call when the menu closes. */
  readonly reset: () => void;
}

export function useIssueRowMenuOptions(input: RowMenuOptionsInput): RowMenuOptionsHandle {
  const { issueId, targets, enabled = true } = input;
  const viewerId = useViewerId();
  const [query, setQuery] = useState('');

  const ids = useMemo(
    () => (targets === undefined ? (issueId === null ? [] : [issueId]) : [...targets]),
    // The contents rather than the array: a caller writing `targets={[id]}` inline hands a
    // new reference every render, and a memo keyed on that is a memo that never hits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets?.join(',') ?? '', issueId ?? ''],
  );

  const key = ids.join(',');
  const options = useLiveQuery(
    (store) => (enabled ? readRowMenuOptions(store, issueId, ids, query, viewerId) : EMPTY),
    ROW_MENU_DEPS,
    [key, query, enabled, viewerId ?? ''],
  );

  const reset = useCallback(() => setQuery(''), []);
  const onSearch = useCallback((value: string) => setQuery(value), []);

  return useMemo(() => ({ options: { ...options, onSearch }, reset }), [options, onSearch, reset]);
}

const EMPTY: IssueRowMenuOptions = {};

/**
 * The lists themselves, as a pure function of the store.
 *
 * Separate from the hook so it can be read in a test without a React tree, and because the
 * agreement rule below is the part worth testing: `shared` returns `undefined` for a property
 * the targets disagree about, and `undefined` is what makes the menu tick nothing.
 */
export function readRowMenuOptions(
  store: Store,
  issueId: UUID | null,
  targets: readonly UUID[],
  query: string,
  viewerId: UUID | null = null,
): IssueRowMenuOptions {
  const rows = targets.flatMap((id) => {
    const issue = store.issues.get(id);
    return issue === undefined ? [] : [issue];
  });
  const first = rows[0];
  if (first === undefined) return EMPTY;

  /** The value every target agrees on, or `undefined` when they do not. */
  const shared = <T>(read: (issue: (typeof rows)[number]) => T): T | undefined => {
    const value = read(first);
    return rows.every((issue) => read(issue) === value) ? value : undefined;
  };

  const teamId = shared((issue) => issue.teamId);
  const team = teamId === undefined ? undefined : store.get('team', teamId);
  const projectId = shared((issue) => issue.projectId ?? null);

  const states: StateChoice[] =
    teamId === undefined
      ? []
      : [...store.workflowStateIdsFor(teamId)]
          .flatMap((id) => {
            const state = store.get('workflowState', id);
            // Duplicate is assigned by the system when an issue is closed as a duplicate of
            // another, never by hand — `StatusPicker` refuses to offer it for the same reason.
            if (state === undefined || state.archivedAt !== undefined || state.isSystem) return [];
            return [state];
          })
          .sort((a, b) => {
            const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
            if (byCategory !== 0) return byCategory;
            return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
          })
          .map((state) => ({
            id: state.id,
            name: state.name,
            category: state.category,
            color: state.color,
          }));

  const people = [...store.users.values()]
    .filter((user) => user.archivedAt === undefined && user.status === 'active')
    .map((user) => ({ id: user.id, name: personName(user), avatarUrl: user.avatarUrl ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The labels ticked are the ones every target already carries, which is the same
  // intersection the bulk label picker applies.
  const applied = new Set(targets.length === 0 ? [] : [...store.labelIdsFor(targets[0] as UUID)]);
  for (const id of targets.slice(1)) {
    const held = store.labelIdsFor(id);
    for (const labelId of [...applied]) if (!held.has(labelId)) applied.delete(labelId);
  }

  const projects: NamedChoice[] = rankProjects(
    store,
    viewerId,
    teamId === undefined ? [] : [teamId],
  ).map((row) => ({
    id: row.project.id,
    name: row.project.name,
    heading: row.heading,
    ...(row.status === undefined ? {} : { hint: row.status.name }),
    ...(row.project.icon === undefined ? {} : { icon: row.project.icon }),
  }));

  const cycles: NamedChoice[] =
    team?.cyclesEnabled === true
      ? rankCycles(store, teamId).map((row) => ({
          id: row.cycle.id,
          name: row.cycle.name,
          heading: row.heading,
          hint: row.window,
        }))
      : [];

  const milestones: NamedChoice[] =
    projectId === undefined || projectId === null
      ? []
      : listProjectMilestones(store, projectId).map((row) => ({
          id: row.milestone.id,
          name: row.milestone.name,
        }));

  const estimates =
    team === undefined || !estimatesEnabled(team)
      ? []
      : [
          { value: null, label: 'No estimate' },
          ...estimateOptions(team).map((value) => ({
            value,
            label: estimateLabel(value, team.estimateScale),
          })),
        ];

  const timezone = team?.timezone ?? 'UTC';

  return {
    states,
    stateId: shared((issue) => issue.stateId) ?? null,
    priority: shared((issue) => issue.priority),
    people,
    assigneeId: shared((issue) => issue.assigneeId ?? null),
    labels: labelOfferings(store, teamId ?? null, applied),
    projects,
    projectId: projectId ?? null,
    milestones,
    milestoneId: shared((issue) => issue.projectMilestoneId ?? null) ?? null,
    cycles,
    cycleId: shared((issue) => issue.cycleId ?? null) ?? null,
    estimates,
    estimate: shared((issue) => issue.estimate ?? null),
    // Resolved in the team's zone, never the reader's: a due date is the team's Friday.
    dueDates: defaultRelatives(timezone, Date.now()),
    dueDate: shared((issue) => issue.dueDate ?? null) ?? null,
    candidates: issueId === null ? [] : searchIssues(store, issueId, query),
  };
}
