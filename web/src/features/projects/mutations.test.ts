/**
 * The project fields that had no writer.
 *
 * `ProjectFields` accepted name, summary, status, lead, priority and the update schedule,
 * and nothing else — so a start date, a target date, a description, an icon and a colour
 * were fields the schema accepts, the store replicates and the timeline draws that no
 * screen in the client could set. These tests pin the variables the mutation sends, because
 * a field dropped on the way to the wire looks exactly like a field that saved.
 */

import { describe, expect, it, vi } from 'vitest';

import { Store, type Change, type Entity, type Project, type ProjectStatus } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { createProject, updateProject } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const STATUS = '01900000-0000-7000-8000-000000000003';
const TEAM = '01900000-0000-7000-8000-000000000004';
const VIEWER = '01900000-0000-7000-8000-000000000005';
const LEAD = '01900000-0000-7000-8000-000000000006';
const LABEL = '01900000-0000-7000-8000-000000000007';
const INITIATIVE = '01900000-0000-7000-8000-000000000008';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

const status: ProjectStatus = {
  id: STATUS,
  workspaceId: WORKSPACE,
  name: 'In progress',
  color: '#5e6ad2',
  category: 'started',
  position: 'a',
  isDefault: true,
  createdAt: AT,
  updatedAt: AT,
};

const project: Project = {
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: 'Launch',
  description: '',
  color: '',
  statusId: STATUS,
  priority: 0,
  sortOrder: 'a',
  updateSchedule: 'default',
  createdAt: AT,
  updatedAt: AT,
};

function seeded() {
  const store = new Store(WORKSPACE);
  store.applyChanges([upsert(1, 'projectStatus', status), upsert(2, 'project', project)]);
  const mutate = vi.fn().mockResolvedValue({ createProject: { project: { id: PROJECT } } });
  return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
}

describe('updateProject', () => {
  it('sends a timeframe with the granularity that goes with it', async () => {
    const { engine, mutate } = seeded();

    await updateProject(engine, PROJECT, {
      startDate: '2026-02-01',
      startDateGranularity: 'quarter',
      targetDate: '2026-06-30',
    });

    const input = mutate.mock.calls[0]![0].variables.input as Record<string, unknown>;
    expect(input['startDate']).toBe('2026-02-01');
    expect(input['startDateGranularity']).toBe('QUARTER');
    expect(input['targetDate']).toBe('2026-06-30');
    // Nothing said about the target's precision, so it is a day.
    expect(input['targetDateGranularity']).toBe('DAY');
  });

  it('spells an emptied date as the API does, and takes it off the local row', async () => {
    const { store, engine, mutate } = seeded();
    store.applyChanges([
      upsert(3, 'project', { ...project, targetDate: '2026-06-30', targetDateGranularity: 'day' }),
    ]);

    await updateProject(engine, PROJECT, { targetDate: null });

    const input = mutate.mock.calls[0]![0].variables.input as Record<string, unknown>;
    expect(input['clearTarget']).toBe(true);
    expect(input['targetDate']).toBeUndefined();

    const patch = mutate.mock.calls[0]![0].optimistic[0];
    expect(patch.after.targetDate).toBeUndefined();
    expect(patch.after.targetDateGranularity).toBeUndefined();
  });

  it('carries the description, the icon and the colour', async () => {
    const { engine, mutate } = seeded();

    await updateProject(engine, PROJECT, { description: 'Why', icon: '🚀', color: '#26b5ce' });

    const input = mutate.mock.calls[0]![0].variables.input as Record<string, unknown>;
    expect(input['description']).toBe('Why');
    expect(input['icon']).toBe('🚀');
    expect(input['color']).toBe('#26b5ce');
  });
});

describe('createProject', () => {
  it('records who filed it rather than who leads it', async () => {
    const { engine, mutate } = seeded();

    await createProject(engine, {
      name: 'Next',
      teamIds: [TEAM],
      leadId: LEAD,
      creatorId: VIEWER,
    });

    const patch = mutate.mock.calls[0]![0].optimistic[0];
    expect(patch.after.creatorId).toBe(VIEWER);
    expect(patch.after.leadId).toBe(LEAD);
  });

  /**
   * The optimistic row used to copy the status's colour, which the server does not do — so
   * the mark changed colour the moment the delta landed — and fell back to an empty string,
   * which as an inline background is not a colour at all.
   */
  it('does not invent a colour by copying the status', async () => {
    const { engine, mutate } = seeded();

    await createProject(engine, { name: 'Next', teamIds: [TEAM] });

    expect(mutate.mock.calls[0]![0].optimistic[0].after.color).toBe('');
  });
  /**
   * Everything the composer's pill row can set, on the create input rather than as a
   * follow-up edit. `CreateProjectInput` accepts all of these, and the web `NewProject` type
   * simply did not name them — so a project filed with an icon, a colour, a priority and
   * three members arrived bare and had to be edited into shape on the project page.
   */
  it('sends the properties the composer set, and draws them on the optimistic row', async () => {
    const { engine, mutate } = seeded();

    await createProject(engine, {
      name: 'Next',
      teamIds: [TEAM],
      icon: '🚀',
      color: '#26b5ce',
      priority: 2,
      memberIds: [LEAD, VIEWER],
    });

    const input = mutate.mock.calls[0]![0].variables.input as Record<string, unknown>;
    expect(input['icon']).toBe('🚀');
    expect(input['color']).toBe('#26b5ce');
    expect(input['priority']).toBe(2);
    expect(input['memberIds']).toEqual([LEAD, VIEWER]);

    const patch = mutate.mock.calls[0]![0].optimistic[0];
    expect(patch.after.icon).toBe('🚀');
    expect(patch.after.color).toBe('#26b5ce');
    expect(patch.after.priority).toBe(2);
  });

  /**
   * Labels and initiatives are the two properties `CreateProjectInput` does not carry, so
   * they are link rows written once the id is real. They go out after the create and not
   * inside it, which is the only order the ids allow.
   */
  it('links labels and initiatives after the project has an id', async () => {
    const { engine, mutate } = seeded();

    await createProject(engine, {
      name: 'Next',
      teamIds: [TEAM],
      labelIds: [LABEL],
      initiativeIds: [INITIATIVE],
    });

    const mutations = mutate.mock.calls.map((call) => call[0].variables as Record<string, unknown>);
    expect(mutations[0]!['input']).toBeDefined();
    expect(mutations[1]).toEqual({ projectId: PROJECT, labelId: LABEL });
    expect(mutations[2]).toEqual({ initiativeId: INITIATIVE, projectId: PROJECT });
  });

  /**
   * A refused label link must not lose the project. The create has already committed and the
   * dialog holds the only copy of what was typed, so throwing here would report a failure for
   * work that succeeded and invite the user to file it a second time.
   */
  it('keeps the project when a follow-up link is refused', async () => {
    const { store, engine, mutate } = seeded();
    mutate.mockImplementation((op: { variables: Record<string, unknown> }) => {
      if ('labelId' in op.variables) return Promise.reject(new ApiError('INTERNAL', 'No'));
      return Promise.resolve({ createProject: { project: { id: PROJECT } } });
    });

    const id = await createProject(engine, { name: 'Next', teamIds: [TEAM], labelIds: [LABEL] });

    expect(id).toBe(PROJECT);
    expect(store.get('project', PROJECT)).toBeDefined();
  });
});
