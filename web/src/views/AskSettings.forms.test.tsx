/**
 * The two things a form row owes the person looking at it: deleting one is confirmed, and
 * copying its link says whether the copy worked.
 *
 * The link is a public credential — `AskFormPage` accepts it signed out — so a Delete beside
 * a Copy link, both ghost, both unnamed, was one mis-click away from breaking a URL already
 * sitting in strangers' inboxes.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AskSettings } from './AskSettings';

const WORKSPACE = 'w1';
const AT = '2026-08-20T12:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({
    id: 'u1',
    workspaceId: WORKSPACE,
    name: 'Ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

function renderAsks() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', {
      id: 't1',
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      timezone: 'UTC',
      private: false,
      estimateScale: 'none',
      estimateAllowZero: false,
      estimateExtended: false,
      cyclesEnabled: false,
      cycleDurationWeeks: 1,
      cycleCooldownWeeks: 0,
      cycleStartDay: 'monday',
      cycleUpcomingCount: 2,
      cycleAutoAddStarted: false,
      cycleAutoAddCompleted: false,
      triageEnabled: false,
      triageRequirePriority: false,
      autoCloseDays: 0,
      autoArchiveDays: 0,
      autoCloseParent: false,
      autoCloseChildren: false,
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'askForm', {
      id: 'a1',
      workspaceId: WORKSPACE,
      teamId: 't1',
      name: 'Bug report',
      description: '',
      token: 'tok-1',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/asks']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AskSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/**
 * `userEvent.setup()` installs a clipboard stub of its own, so a test that wants to control
 * `navigator.clipboard` has to define it after the setup call rather than before it.
 */
function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('Ask form rows', () => {
  afterEach(() => {
    stubClipboard(undefined);
  });

  it('names each destructive control after the form it destroys', () => {
    renderAsks();

    expect(screen.getByRole('button', { name: 'Delete Bug report' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the link for Bug report' })).toBeTruthy();
  });

  it('confirms before it breaks a public link, and does not delete on the way to the dialog', async () => {
    const { mutate, user } = renderAsks();

    await user.click(screen.getByRole('button', { name: 'Delete Bug report' }));
    expect(mutate).not.toHaveBeenCalled();

    expect(screen.getByRole('heading', { name: 'Delete Bug report?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete this form' }));
    expect(mutate).toHaveBeenCalled();
  });

  it('says the delete was refused instead of closing as though it worked', async () => {
    const { mutate, user } = renderAsks();
    mutate.mockRejectedValueOnce(new Error('offline'));

    await user.click(screen.getByRole('button', { name: 'Delete Bug report' }));
    await user.click(screen.getByRole('button', { name: 'Delete this form' }));

    expect((await screen.findByRole('alert')).textContent).toBe('That form could not be deleted.');
    expect(screen.getByRole('heading', { name: 'Delete Bug report?' })).toBeTruthy();
  });

  it('confirms a copy in a live region and leaves the button called Copy link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = renderAsks();
    stubClipboard({ writeText });

    const button = screen.getByRole('button', { name: 'Copy the link for Bug report' });
    await user.click(button);

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/ask/tok-1`);
    expect((await screen.findByRole('status')).textContent).toBe('Copied');
    // The label is the command, not the outcome — otherwise it says "Copied" for ever.
    expect(button.textContent).toBe('Copy link');
  });

  it('selects the link when the clipboard refuses, rather than doing nothing', async () => {
    const { user } = renderAsks();
    stubClipboard(undefined);

    await user.click(screen.getByRole('button', { name: 'Copy the link for Bug report' }));

    expect((await screen.findByRole('status')).textContent).toBe(
      'Selected — copy it with your keyboard',
    );
  });
});

/**
 * The link, as text in the row.
 *
 * It lived in a read-only `<input>`, which draws the same and is invisible to everything that
 * reads the document: selection, find-in-page, a screen reader walking the row, and anything
 * that has to check what a settings screen actually put on the page. This is a URL people
 * read out loud and paste into a wiki, so it is a run of text — focusable, and selecting
 * itself on focus, which is what the input was there for.
 */
describe('the public link', () => {
  it('is text in the row, not a form control the row only appears to show', () => {
    renderAsks();

    const link = screen.getByLabelText('Link for Bug report');
    expect(link.tagName).toBe('CODE');
    expect(link.textContent).toBe(`${window.location.origin}/ask/tok-1`);
    // Reachable from the keyboard, so ⌘C is one Tab away for somebody with no mouse.
    expect(link.getAttribute('tabindex')).toBe('0');
  });
});
