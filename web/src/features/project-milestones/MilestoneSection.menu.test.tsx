/**
 * The milestone row's menu: one array, two ways in.
 *
 * A right-click on a row used to do nothing at all, and the ⋯ button was the only way to
 * reach Edit or Remove. The two menus are now built by the same `itemsFor`, which is worth
 * asserting item-for-item — the failure this guards against is a row added to one of them
 * and forgotten in the other, and that is invisible to a test that only opens one.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type ProjectMilestone } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { MilestoneSection } from './MilestoneSection';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const ALPHA = '01900000-0000-7000-8000-00000000000a';
const BETA = '01900000-0000-7000-8000-00000000000b';
const GAMMA = '01900000-0000-7000-8000-00000000000c';
const AT = '2026-01-01T00:00:00.000Z';

function milestone(id: string, name: string, sortOrder: string): ProjectMilestone {
  return {
    id,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    name,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  };
}

function upsert(v: number, entity: Entity): Change {
  return {
    v,
    type: 'projectMilestone',
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

/** Three checkpoints in order, so "up" and "down" both have somewhere to go. */
function renderSection() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, milestone(ALPHA, 'Alpha', 'a')),
    upsert(2, milestone(BETA, 'Beta', 'b')),
    upsert(3, milestone(GAMMA, 'Gamma', 'c')),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'ready', connection: 'ready', pending: 0 }}>
        <MilestoneSection projectId={PROJECT} />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { mutate };
}

function rowFor(name: string): HTMLElement {
  const element = screen.getByText(name).closest('li');
  if (element === null) throw new Error(`no row for ${name}`);
  return element;
}

/** What the open menu offers, in order, with the rows it refuses marked. */
function offered(): string[] {
  return screen.getAllByRole('menuitem').map((item) => {
    const disabled = item.getAttribute('aria-disabled') === 'true';
    return `${item.textContent ?? ''}${disabled ? ' [disabled]' : ''}`;
  });
}

describe('MilestoneSection row menu', () => {
  it('opens on a right-click, where nothing opened before', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.queryByRole('menu')).toBeNull();

    await user.pointer({ target: rowFor('Beta'), keys: '[MouseRight]' });

    expect(screen.getByRole('menu', { name: 'Actions for Beta' })).not.toBeNull();
  });

  it('offers the same rows from the ⋯ and from the right-click', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Actions for Beta' }));
    const fromButton = offered();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await user.pointer({ target: rowFor('Beta'), keys: '[MouseRight]' });
    const fromRightClick = offered();

    expect(fromButton).toEqual(['Edit milestone', 'Move up', 'Move down', 'Remove milestone']);
    expect(fromRightClick).toEqual(fromButton);
  });

  it('refuses to move the first one up and the last one down', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.pointer({ target: rowFor('Alpha'), keys: '[MouseRight]' });
    expect(offered()).toContain('Move up [disabled]');
    expect(offered()).toContain('Move down');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await user.pointer({ target: rowFor('Gamma'), keys: '[MouseRight]' });
    expect(offered()).toContain('Move down [disabled]');
    expect(offered()).toContain('Move up');
  });

  /**
   * Second row moving up has no predecessor to land after, which is the case `moveToTop`
   * exists for — the one place where `afterMilestoneId` cannot say what is meant.
   */
  it('moves up by asking for the top when there is nothing above to sit after', async () => {
    const user = userEvent.setup();
    const { mutate } = renderSection();

    await user.pointer({ target: rowFor('Beta'), keys: '[MouseRight]' });
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0].variables.input).toEqual({ id: BETA, moveToTop: true });
  });

  it('moves down by naming the milestone it lands after', async () => {
    const user = userEvent.setup();
    const { mutate } = renderSection();

    await user.pointer({ target: rowFor('Beta'), keys: '[MouseRight]' });
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0].variables.input).toEqual({
      id: BETA,
      afterMilestoneId: GAMMA,
    });
  });

  it('edits from the right-click menu, and saves the new name', async () => {
    const user = userEvent.setup();
    const { mutate } = renderSection();

    await user.pointer({ target: rowFor('Beta'), keys: '[MouseRight]' });
    await user.click(screen.getByRole('menuitem', { name: 'Edit milestone' }));

    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Beta 2');
    await user.click(screen.getByRole('button', { name: 'Save milestone' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    // These three have no target date, and an empty date field is spelled as its own flag.
    expect(mutate.mock.calls[0]![0].variables.input).toEqual({
      id: BETA,
      name: 'Beta 2',
      clearTarget: true,
    });
  });

  /** The confirmation is the point of Remove; reaching it from the right-click keeps it. */
  it('still asks before removing one opened from the right-click', async () => {
    const user = userEvent.setup();
    const { mutate } = renderSection();

    await user.pointer({ target: rowFor('Beta'), keys: '[MouseRight]' });
    await user.click(screen.getByRole('menuitem', { name: 'Remove milestone' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove Beta?' });
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove milestone' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0].variables).toEqual({ id: BETA });
  });
});
