/**
 * The overview as a document: the prose, the standing health, and what the autosave says.
 *
 * The name and its emoji are the shell's now — they are in the breadcrumb, which is also
 * where the project is renamed — so this screen opens on the summary. And the feed belongs
 * to the activity tab: this one keeps the composer and the latest update, which is the
 * standing answer to "how is it going".
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectOverview } from './ProjectOverview';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const VIEWER = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

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

function renderOverview(mutate = vi.fn().mockResolvedValue({})) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Launch',
      icon: '🚀',
      summary: 'Ship it',
      description: '',
      color: '',
      statusId: 'ps-backlog',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'projectUpdate', {
      id: 'pu1',
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      health: 'on_track',
      body: 'Started well',
      authorId: VIEWER,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: AT,
    } as Entity),
    upsert(3, 'projectUpdate', {
      id: 'pu2',
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      health: 'off_track',
      body: 'Then it slipped',
      authorId: VIEWER,
      createdAt: '2026-01-09T00:00:00.000Z',
      updatedAt: AT,
    } as Entity),
  ]);
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <Routes>
            <Route path="/project/:projectId" element={<ProjectOverview />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate };
}

describe('ProjectOverview as a document', () => {
  it('opens on the mark, the name, the summary and the description', () => {
    renderOverview();

    // The document names itself. The mark and the name were the breadcrumb's alone until
    // the page grew a title block of its own; the trail still carries both — it is on every
    // tab, and it is where somebody arriving from the list confirms what they opened — and
    // this pair is the document's own heading, editable in place.
    expect(screen.getByText('🚀')).toBeTruthy();
    expect((screen.getByLabelText('Project name') as HTMLTextAreaElement).value).toBe('Launch');
    expect((screen.getByLabelText('Summary') as HTMLInputElement).value).toBe('Ship it');
    expect(screen.getByLabelText('Description')).toBeTruthy();
  });

  it('shows the latest update, and leaves the history to the activity tab', () => {
    renderOverview();

    expect(screen.getByRole('heading', { name: 'Latest update' })).toBeTruthy();
    expect(screen.getByText('Then it slipped')).toBeTruthy();
    expect(screen.queryByText('Started well')).toBeNull();
    // The health it claimed, on the card rather than only in the composer's control.
    expect(screen.getAllByText('Off track').some((node) => node.closest('li') !== null)).toBe(true);
  });

  it('keeps the composer beneath the card, health chosen from a menu', async () => {
    const user = userEvent.setup();
    renderOverview();

    expect(screen.getByLabelText('Update')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post update' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Health' }));
    const menu = screen.getByRole('menu', { name: 'Health' });
    await user.click(within(menu).getByRole('menuitem', { name: 'At risk' }));

    expect(screen.getByRole('button', { name: 'Health' }).textContent).toContain('At risk');
  });

  /**
   * The description used to be a `Textarea` keyed on the stored value, so a change arriving
   * over sync remounted the field and threw away whatever was half-written in it. Somebody
   * else's edit is not a reason to lose your paragraph.
   */
  it('keeps a half-typed description when the stored one changes underneath', async () => {
    const user = userEvent.setup();
    const { store } = renderOverview();

    const field = screen.getByLabelText('Description');
    await user.click(field);
    await user.type(field, 'Half a thought');

    await act(async () => {
      store.applyChanges([
        upsert(4, 'project', {
          id: PROJECT,
          workspaceId: WORKSPACE,
          name: 'Launch',
          icon: '🚀',
          summary: 'Ship it',
          description: 'Written by somebody else',
          color: '',
          statusId: 'ps-backlog',
          priority: 0,
          sortOrder: 'a',
          updateSchedule: 'default',
          createdAt: AT,
          updatedAt: AT,
        } as Entity),
      ]);
    });

    expect((field as HTMLTextAreaElement).value).toBe('Half a thought');
  });

  /**
   * Three detail screens autosave and none of them said so, which is how a form the user
   * cannot tell they have submitted gets submitted again.
   */
  it('says a save is happening, and then that it happened', async () => {
    const user = userEvent.setup();
    let settle: (() => void) | null = null;
    const mutate = vi.fn().mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          settle = () => resolve({});
        }),
    );
    renderOverview(mutate);

    await user.click(screen.getByLabelText('Summary'));
    await user.type(screen.getByLabelText('Summary'), ' now');
    await user.tab();

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saving…'));
    await act(async () => {
      settle?.();
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });
});
