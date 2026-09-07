/**
 * The document dialog, from the outside.
 *
 * `CreateDocumentInput.teamId` is required, and before this dialog existed the only place a
 * team id came from was the route — so the create in the documents header worked on two
 * screens and nowhere else, and ⌘K could not make a document at all. These are the two
 * things that would put it back there: a team that never reaches the wire, and a document
 * that is filed and then not opened.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateDocumentModal, seedFromPath } from './CreateDocumentModal';
import { createDocument } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createDocument: vi.fn(() => Promise.resolve('doc-1')) };
});

const WORKSPACE = 'w1';
const ENG = 't1';
const DESIGN = 't2';
const AT = '2026-01-01T00:00:00.000Z';

const filed = vi.mocked(createDocument);

function team(id: string, key: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
    private: false,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: Entity[] = [team(DESIGN, 'DES', 'Design'), team(ENG, 'ENG', 'Engineering')];
  store.applyChanges(
    rows.map((payload, index): Change => ({
      v: index + 1,
      type: 'team',
      id: (payload as { id: string }).id,
      op: 'upsert',
      actor: { type: 'system' },
      payload,
    })),
  );
  return store;
}

function renderDialog(at = '/documents') {
  const store = seeded();
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter initialEntries={[at]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/document/:documentId" element={<div>Document screen</div>} />
            <Route path="*" element={<CreateDocumentModal onClose={onClose} />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, user: userEvent.setup(), onClose };
}

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue('doc-1');
});
afterEach(cleanup);

describe('CreateDocumentModal', () => {
  it('files the document with the team the pill is showing, and opens it', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Runbook');
    await user.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    // Alphabetically first when the path names no team: Design, not "no team at all".
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ teamId: DESIGN, title: 'Runbook' });
    expect(onClose).toHaveBeenCalled();
    // And the point of making one: the editor, not the list it was made from.
    expect(await screen.findByText('Document screen')).toBeTruthy();
  });

  it('takes the team from a team documents route it was opened over', async () => {
    const { user } = renderDialog('/team/ENG/documents');

    await user.type(screen.getByLabelText('Title'), 'Runbook');
    await user.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ teamId: ENG });
  });

  it('files the team the pill was changed to', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: /Design/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Engineering' }));
    await user.type(screen.getByLabelText('Title'), 'Runbook');
    await user.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ teamId: ENG });
  });

  it('says a document needs a title rather than disabling the button', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create document' }));

    expect(screen.getByText('A document needs a title')).toBeTruthy();
    expect(filed).not.toHaveBeenCalled();
  });

  it('files once when ⌘⏎ is pressed twice in the same tick', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Runbook');

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed).toHaveBeenCalledTimes(1);
  });

  it('reads the team and project out of a documents path, and nothing out of any other', () => {
    const store = seeded();
    expect(seedFromPath(store, '/team/ENG/documents')).toEqual({ teamId: ENG });
    expect(seedFromPath(store, '/team/NOPE/documents')).toEqual({});
    expect(seedFromPath(store, '/documents')).toEqual({});
    expect(seedFromPath(store, '/team/ENG')).toEqual({});
  });
});
