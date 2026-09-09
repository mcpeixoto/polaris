/**
 * The label row's actions menu.
 *
 * Two menus are drawn from one `itemsFor(row)` — the ⋯ button and the right-click — and the
 * point of these tests is that they cannot drift apart: a right-click-only menu is
 * unreachable on a touch screen, and a ⋯ menu that offers something the right-click does not
 * is two products. The rest holds the line the merge tests already hold for merging:
 * nothing destructive leaves this screen without a confirmation naming what it will do.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { LabelSettings } from './LabelSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const AT = '2026-01-01T00:00:00.000Z';

function label(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: undefined,
    name,
    color: '#3b82f6',
    isGroup: false,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as unknown as Entity;
}

let mutate: ReturnType<typeof vi.fn>;

function renderScreen() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'workspace',
      id: WORKSPACE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: WORKSPACE,
        name: 'Acme',
        urlKey: 'acme',
        plan: 'free',
        createdAt: AT,
        updatedAt: AT,
      },
    },
    {
      v: 2,
      type: 'label',
      id: 'l-bug',
      op: 'upsert',
      actor: { type: 'system' },
      payload: label('l-bug', 'Bug'),
    },
    {
      v: 3,
      type: 'label',
      id: 'l-defect',
      op: 'upsert',
      actor: { type: 'system' },
      payload: label('l-defect', 'Defect'),
    },
  ] as Change[]);

  mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <LabelSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

/** The words on every row of the open menu, in order. */
function openMenuRows(): string[] {
  const menu = screen.getByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim() ?? '');
}

/** Right-clicks a label's row, through a control that sits inside it. */
function rightClickRow(name: string) {
  fireEvent.contextMenu(screen.getByRole('button', { name: `Options for ${name}` }), {
    button: 2,
    buttons: 2,
    clientX: 40,
    clientY: 60,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the label row menu', () => {
  it('opens on a right-click', async () => {
    renderScreen();

    expect(screen.queryByRole('menu')).toBeNull();
    rightClickRow('Bug');

    await screen.findByRole('menu');
    expect(openMenuRows()).toContain('Rename…');
  });

  it('offers the ⋯ button exactly what the right-click offers', async () => {
    const user = renderScreen();

    rightClickRow('Bug');
    await screen.findByRole('menu');
    const fromRightClick = openMenuRows();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Options for Bug' }));
    await screen.findByRole('menu');

    expect(openMenuRows()).toEqual(fromRightClick);
    // And it is not a pair of empty menus agreeing with each other.
    expect(fromRightClick.length).toBeGreaterThan(1);
  });

  it('merges through the same confirmation the Merge button uses', async () => {
    const user = renderScreen();

    rightClickRow('Bug');
    await user.click(await screen.findByRole('menuitem', { name: /Merge/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Defect' }));

    // Nothing has been sent on the strength of a menu choice alone.
    expect(mutate).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Merge into Defect' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { sourceId: 'l-bug', intoId: 'l-defect' },
    });
  });

  it('asks before it archives, and then sends the archive', async () => {
    const user = renderScreen();

    rightClickRow('Bug');
    await user.click(await screen.findByRole('menuitem', { name: 'Archive label' }));

    expect(mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Bug');

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { id: 'l-bug', archived: true },
    });
  });

  it('opens from the keyboard on the row that has focus', async () => {
    const user = renderScreen();

    // Focus a control in Defect's row rather than Bug's, so a menu that ignored focus
    // would open on the wrong label and say so in its own name.
    act(() => {
      screen.getByRole('button', { name: 'Options for Defect' }).focus();
    });
    await user.keyboard('.');

    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('Options for Defect');
  });

  it('sends nothing when the archive confirmation is cancelled', async () => {
    const user = renderScreen();

    rightClickRow('Bug');
    await user.click(await screen.findByRole('menuitem', { name: 'Archive label' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
  });
});
