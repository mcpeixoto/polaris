/**
 * Merging two labels, which is the most destructive thing this screen can do.
 *
 * It used to be a `<select>` calling the mutation straight out of `onChange`. One arrow key
 * on a keyboard-navigated control relabelled every issue that carried the label and deleted
 * the label — no confirmation, no count of what would be relabelled, no undo — while
 * *archiving*, which is strictly milder and fully reversible, was already guarded. These
 * tests hold that line: a merge cannot happen without a confirmation naming both labels.
 */

import { render, screen, waitFor } from '@testing-library/react';
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

function label(id: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: undefined,
    name,
    color: '#3b82f6',
    isGroup: false,
    createdAt: AT,
    updatedAt: AT,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('merging a label', () => {
  it('asks before it relabels anything', async () => {
    const user = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Merge Bug into another label' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Defect' }));

    // Nothing has been sent yet. That is the whole finding.
    expect(mutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Bug');
    expect(dialog.textContent).toContain('Defect');
    // The consequence names what happens rather than asking "are you sure?".
    expect(dialog.textContent).toContain('will be deleted');
  });

  it('sends the merge only after the confirmation', async () => {
    const user = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Merge Bug into another label' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Defect' }));
    await user.click(await screen.findByRole('button', { name: 'Merge into Defect' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const user = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Merge Bug into another label' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Defect' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
  });
});
