/**
 * The two fields nothing may quietly discard.
 *
 * `updateWorkspaceGeneral` used to drop an empty required value from its patch and resolve
 * successfully, and the fields were uncontrolled — so clearing the workspace name and tabbing
 * out left an empty box, a sidebar still showing the old name, no error, and nothing to put
 * the value back. Two bugs pointing the same way: the mutation lied about having saved and
 * the view had no way to disagree.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { WorkspaceSettings } from './WorkspaceSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const AT = '2026-01-01T00:00:00.000Z';

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
      } as unknown as Entity,
    },
  ] as Change[]);

  mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <WorkspaceSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkspaceSettings', () => {
  it('refuses an emptied name and puts the old one back', async () => {
    const user = renderScreen();

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.tab();

    expect(mutate).not.toHaveBeenCalled();
    expect((name as HTMLInputElement).value).toBe('Acme');
    expect(screen.getByRole('alert').textContent).toContain('needs a name');
  });

  it('refuses a URL key with characters a URL cannot carry', async () => {
    const user = renderScreen();

    const address = await screen.findByLabelText('URL key');
    await user.clear(address);
    await user.type(address, 'Acme Corp!');
    await user.tab();

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Lower-case letters');
  });

  // The address is the change that moves every bookmark and every outstanding invitation
  // link, so what it will become is on screen before the field is left.
  it('previews the address the workspace will live at', async () => {
    const user = renderScreen();

    const address = await screen.findByLabelText('URL key');
    await user.clear(address);
    await user.type(address, 'acme-eu');

    expect(screen.getByText(/polaris\.app\/acme-eu/u)).toBeTruthy();
  });

  it('confirms a save that landed', async () => {
    const user = renderScreen();

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Acme Corp');
    await user.tab();

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Saved');
    });
  });

  it('does not send a value that has not changed', async () => {
    const user = renderScreen();

    await user.click(await screen.findByLabelText('Name'));
    await user.tab();

    expect(mutate).not.toHaveBeenCalled();
  });
});
