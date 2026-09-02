/**
 * The milestone list on the project overview, which had no create control anywhere in the
 * client — the timeline drew ticks for checkpoints nothing could add.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity, type ProjectMilestone } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { MilestoneSection } from './MilestoneSection';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const MILESTONE = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

const beta: ProjectMilestone = {
  id: MILESTONE,
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  name: 'Beta',
  targetDate: '2026-03-01',
  sortOrder: 'a',
  createdAt: AT,
  updatedAt: AT,
};

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function renderSection(seed: readonly Change[] = []) {
  const store = new Store(WORKSPACE);
  if (seed.length > 0) store.applyChanges([...seed]);
  const mutate = vi
    .fn()
    .mockResolvedValue({ createProjectMilestone: { milestone: { id: 'server-id' } } });
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <EngineProvider engine={engine} status={{ phase: 'ready', connection: 'ready', pending: 0 }}>
      <MilestoneSection projectId={PROJECT} />
    </EngineProvider>,
  );
  return { mutate };
}

describe('MilestoneSection', () => {
  it('says a project has none rather than showing a blank pane', () => {
    renderSection();

    expect(screen.getByText(/No milestones yet/)).not.toBeNull();
  });

  it('lists a milestone with its target date and its progress', () => {
    renderSection([upsert(1, 'projectMilestone', beta)]);

    expect(screen.getByText('Beta')).not.toBeNull();
    // No issues attached yet, and the row says so in words rather than drawing an empty bar.
    expect(screen.getByText('No issues yet')).not.toBeNull();
  });

  it('creates one from the form under the list', async () => {
    const user = userEvent.setup();
    const { mutate } = renderSection();

    await user.type(screen.getByLabelText('Milestone'), 'Launch');
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0].variables.input).toEqual({
      projectId: PROJECT,
      name: 'Launch',
    });
  });

  it('refuses an unnamed milestone without reaching the API', async () => {
    const user = userEvent.setup();
    const { mutate } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Add milestone' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('A milestone needs a name');
  });
});
