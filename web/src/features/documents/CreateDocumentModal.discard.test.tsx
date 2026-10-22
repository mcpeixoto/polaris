/**
 * Escape out of the document dialog.
 *
 * The title is typing, and the team pill is the route the dialog was opened on — so opening
 * it over `/team/ENG/documents` and changing nothing has to close in silence, while moving
 * the pill off that team is a choice somebody made and worth a question.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateDocumentModal } from './CreateDocumentModal';
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
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter initialEntries={[at]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="*" element={<CreateDocumentModal onClose={onClose} />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { user: userEvent.setup(), onClose };
}

const QUESTION = 'Discard this document?';

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue('doc-1');
});
afterEach(cleanup);

describe('CreateDocumentModal discard guard', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when the team came from the route and was left there', async () => {
    const { user, onClose } = renderDialog('/team/ENG/documents');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks instead of closing when there is a title', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Runbook');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: QUESTION })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks when the team was moved off the one the route seeded', async () => {
    const { user, onClose } = renderDialog('/team/ENG/documents');

    await user.click(screen.getByRole('button', { name: /Engineering/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Design' }));
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: QUESTION })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Runbook');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and the title in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Title'), 'Runbook');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: QUESTION });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Runbook');
  });
});
