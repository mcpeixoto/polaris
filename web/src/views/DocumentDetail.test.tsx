/**
 * A document being written while somebody else changes it.
 *
 * The screen mirrors the store into two controlled fields, so every delta that touches this
 * document re-runs the effect that fills them — including one that changes a field nobody
 * here is typing in. Adopting the store's answer wholesale threw away whatever was in the
 * textarea, which is the one thing on the screen that exists nowhere else yet.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DocumentDetail } from './DocumentDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const DOC = 'd1';
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', {
      id: TEAM,
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      private: false,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(2, 'document', {
      id: DOC,
      workspaceId: WORKSPACE,
      teamId: TEAM,
      title: 'Runbook',
      body: '',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderDetail() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/document/${DOC}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/document/:documentId" element={<DocumentDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

describe('DocumentDetail', () => {
  it('keeps an unsaved body when the document changes underneath it', async () => {
    const { store, user } = renderDetail();

    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.click(body);
    await user.type(body, 'half a sentence');

    // Somebody else renames the document while this one is mid-word.
    act(() =>
      store.applyChanges([
        upsert(3, 'document', {
          id: DOC,
          workspaceId: WORKSPACE,
          teamId: TEAM,
          title: 'Renamed by somebody else',
          body: '',
          sortOrder: 'a',
          createdAt: AT,
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ]),
    );

    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('half a sentence');
    // The field nobody was editing still follows the store.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Renamed by somebody else',
    );
  });

  it('adopts a remote body while nothing is being typed', () => {
    const { store } = renderDetail();

    act(() =>
      store.applyChanges([
        upsert(3, 'document', {
          id: DOC,
          workspaceId: WORKSPACE,
          teamId: TEAM,
          title: 'Runbook',
          body: 'written elsewhere',
          sortOrder: 'a',
          createdAt: AT,
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
      ]),
    );

    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('written elsewhere');
  });
});
