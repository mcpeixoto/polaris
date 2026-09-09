/**
 * The Drafts page: every row can be discarded, and a discard that fails says so.
 *
 * Both were holes rather than regressions. A local *comment* draft had no Discard button at
 * all, so the one pile on the screen that is definitely unsent was also the one nothing could
 * clear; and `discardSaved` was `void`-ed with no catch, so an offline delete left the row on
 * screen and an unhandled rejection in the console.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { CreateIssueProvider } from '~/features/issue/create-context';
import { ApiError } from '~/sync/api';

import { Drafts } from './Drafts';

vi.mock('~/features/drafts/mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/drafts/mutations')>();
  return { ...actual, fetchDrafts: vi.fn(), deleteDraft: vi.fn() };
});

vi.mock('~/features/drafts/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/drafts/local')>();
  return { ...actual, listLocalDrafts: vi.fn(), clearCommentDraft: vi.fn() };
});

const { deleteDraft, fetchDrafts } = await import('~/features/drafts/mutations');
const { clearCommentDraft, listLocalDrafts } = await import('~/features/drafts/local');

const deleted = vi.mocked(deleteDraft);
const fetched = vi.mocked(fetchDrafts);
const cleared = vi.mocked(clearCommentDraft);
const listed = vi.mocked(listLocalDrafts);

const WORKSPACE = '01900000-0000-7000-8000-000000000009';
const USER = '01900000-0000-7000-8000-000000000008';
const ISSUE = '01900000-0000-7000-8000-000000000001';
const DRAFT = '01900000-0000-7000-8000-000000000002';
const AT = '2026-01-01T00:00:00.000Z';

function renderDrafts() {
  render(
    <MemoryRouter>
      <KeymapProvider>
        <CreateIssueProvider value={{ open: () => true }}>
          <Drafts />
        </CreateIssueProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  deleted.mockReset();
  fetched.mockReset();
  cleared.mockReset();
  listed.mockReset();
  fetched.mockResolvedValue([]);
  listed.mockReturnValue([]);
});

describe('Drafts', () => {
  it('discards a local comment draft, which had no control at all', async () => {
    listed.mockReturnValue([
      { kind: 'comment', issueId: ISSUE, body: 'Half a reply', updatedAt: AT },
    ]);
    const user = renderDrafts();

    // Discarding asks first now, from the row's button as well as from its menu: nothing
    // brings an unsent draft back, and that was already the reason the menu asked.
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }),
    );

    expect(cleared).toHaveBeenCalledWith(ISSUE, undefined);
  });

  it('says so when a saved draft cannot be discarded, and offers another go', async () => {
    fetched.mockResolvedValue([
      {
        id: DRAFT,
        workspaceId: WORKSPACE,
        userId: USER,
        kind: 'issue',
        payload: { title: 'Unsent' },
        createdAt: AT,
        updatedAt: AT,
      },
    ]);
    deleted.mockRejectedValue(new ApiError('NETWORK', 'The request never left the device.'));
    const user = renderDrafts();

    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be discarded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('sends nothing until the discard is answered, and nothing at all if it is refused', async () => {
    listed.mockReturnValue([
      { kind: 'comment', issueId: ISSUE, body: 'Half a reply', updatedAt: AT },
    ]);
    const user = renderDrafts();

    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    // The dialogue names the draft, because "discard this draft?" over a list of them is a
    // question about which one.
    expect((await screen.findByRole('dialog')).textContent).toContain('Half a reply');
    expect(cleared).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');

    expect(cleared).not.toHaveBeenCalled();
  });

  it('waits rather than calling the wait an empty state', () => {
    // Never resolves: the saved pile is still on the wire.
    fetched.mockReturnValue(new Promise(() => {}));
    renderDrafts();

    // "Nothing unsent" is an answer this screen does not have yet, and "Loading drafts" as
    // an EmptyState was that answer wearing a spinner's clothes.
    expect(screen.queryByText('Nothing unsent')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading drafts');
  });

  it('moves a cursor with j and k and resumes the row under it', async () => {
    listed.mockReturnValue([
      { kind: 'comment', issueId: ISSUE, body: 'Half a reply', updatedAt: AT },
    ]);
    fetched.mockResolvedValue([
      {
        id: DRAFT,
        workspaceId: WORKSPACE,
        userId: USER,
        kind: 'issue',
        payload: { title: 'Unsent' },
        createdAt: AT,
        updatedAt: AT,
      },
    ]);
    const open = vi.fn(() => true);
    render(
      <MemoryRouter>
        <KeymapProvider>
          <CreateIssueProvider value={{ open: open as never }}>
            <Drafts />
          </CreateIssueProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await screen.findByText('Unsent');

    // One cursor over both piles: local first, then saved. j reaches the saved row, k comes
    // back to the local one — the screen claimed the list key context and answered none of
    // these keys before.
    const rows = () => screen.getAllByRole('option');
    await user.keyboard('j');
    expect(rows()[1]?.getAttribute('data-cursor')).toBe('');
    await user.keyboard('k');
    expect(rows()[0]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('j');
    await user.keyboard('{Enter}');
    // The saved issue draft resumes in the composer it came from.
    await waitFor(() => expect(open).toHaveBeenCalled());
  });

  it('re-reads its rows when the composer it opened shuts', async () => {
    fetched.mockResolvedValue([
      {
        id: DRAFT,
        workspaceId: WORKSPACE,
        userId: USER,
        kind: 'issue',
        payload: { title: 'Unsent' },
        createdAt: AT,
        updatedAt: AT,
      },
    ]);
    // Standing in for the shell: hold the callback the page passes, then fire it the way
    // closing a composer does.
    let closed = () => {};
    const open = vi.fn((_seed?: unknown, options?: { onClosed?: () => void }) => {
      closed = options?.onClosed ?? (() => {});
      return true;
    });
    render(
      <MemoryRouter>
        <KeymapProvider>
          <CreateIssueProvider value={{ open: open as never }}>
            <Drafts />
          </CreateIssueProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByText('Unsent'));
    expect(open).toHaveBeenCalled();

    listed.mockClear();
    fetched.mockClear();
    closed();

    await waitFor(() => expect(listed).toHaveBeenCalled());
    await waitFor(() => expect(fetched).toHaveBeenCalled());
  });
});
