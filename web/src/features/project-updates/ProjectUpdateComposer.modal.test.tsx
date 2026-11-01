/**
 * The dialog around the form: the part `ProjectUpdateComposer.test.tsx` does not reach.
 *
 * What it adds to the form is what a dialog can get wrong and a form cannot: closing over
 * somebody's words, and a keyboard path to posting that takes a different route to the button.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectUpdateComposer } from './ProjectUpdateComposer';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const PROJECT = 'p1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, workspaceId: WORKSPACE, role: 'admin', displayName: 'Ada' }),
  useViewerRole: () => 'admin',
}));

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <ProjectUpdateComposer open={open} onClose={() => setOpen(false)} projectId={PROJECT} />
    </>
  );
}

function mount() {
  const mutate = vi.fn().mockResolvedValue({
    createProjectUpdate: {
      projectUpdate: {
        id: 'pu1',
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        health: 'ON_TRACK',
        body: 'Shipped.',
        authorId: VIEWER,
        createdAt: AT,
        updatedAt: AT,
      },
    },
  });
  const engine = { store: new Store(WORKSPACE), mutate } as unknown as SyncEngine;
  render(
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      <KeymapProvider>
        <Harness />
      </KeymapProvider>
    </EngineProvider>,
  );
  return { mutate, user: userEvent.setup() };
}

const dialog = () => screen.queryByRole('dialog', { name: 'Project update' });
const field = () => screen.getByRole('textbox', { name: 'Update' });

afterEach(cleanup);

describe('ProjectUpdateComposer', () => {
  it('is a modal with the writing field focused', async () => {
    mount();

    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it('closes on Escape without asking when nothing was written', async () => {
    const { user } = mount();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before Escape throws away a draft, and keeps it on Cancel', async () => {
    const { user } = mount();

    await user.type(field(), 'Half a sentence');
    await user.keyboard('{Escape}');

    const question = await screen.findByText('Discard this update?');
    expect(question).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Discard this update?')).toBeNull());
    expect((field() as HTMLTextAreaElement).value).toBe('Half a sentence');
  });

  it('closes on Discard, and the next open starts empty and unguarded', async () => {
    const { user } = mount();

    await user.type(field(), 'Half a sentence');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(dialog()).toBeNull());

    await user.click(screen.getByRole('button', { name: 'reopen', hidden: true }));
    expect((field() as HTMLTextAreaElement).value).toBe('');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.queryByText('Discard this update?')).toBeNull();
  });

  it('guards a chosen health as well as the words', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'Health' }));
    await user.click(await screen.findByRole('menuitem', { name: 'At risk' }));
    await user.click(within(dialog()!).getByRole('button', { name: 'Close' }));

    expect(await screen.findByText('Discard this update?')).toBeTruthy();
  });

  it('posts on mod+Enter and closes', async () => {
    const { mutate, user } = mount();

    await user.type(field(), 'Shipped.');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const call = mutate.mock.calls[0]?.[0] as { variables: { input: Record<string, unknown> } };
    expect(call.variables.input).toMatchObject({ projectId: PROJECT, body: 'Shipped.' });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.queryByText('Discard this update?')).toBeNull();
  });

  it('refuses a blank mod+Enter the way it refuses the button', async () => {
    const { mutate, user } = mount();

    await user.keyboard('{Control>}{Enter}{/Control}');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'An update needs something to say.',
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('files one update from two mod+Enters in the same tick', async () => {
    const { mutate, user } = mount();

    await user.type(field(), 'Shipped.');
    await user.keyboard('{Control>}{Enter}{Enter}{/Control}');

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
