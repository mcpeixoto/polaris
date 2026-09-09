/**
 * The Drafts page's row menu, whichever way it was opened.
 *
 * The ⋯ button and a right-click on the row render the same array, so the two cannot drift.
 * The rows are the two things this screen already does — resume the draft, throw it away —
 * built by the shared entity builder so the order and the separator are the product's rather
 * than this screen's.
 *
 * Discarding from the menu asks first. The row's own Discard button is the shortcut for
 * somebody who has already read the row; a menu entry reached by right-clicking is not, and
 * an unsent draft is not recoverable once it is gone.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { CreateIssueProvider } from '~/features/issue/create-context';

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

function savedIssueDraft() {
  return {
    id: DRAFT,
    workspaceId: WORKSPACE,
    userId: USER,
    kind: 'issue' as const,
    payload: { title: 'Unsent' },
    createdAt: AT,
    updatedAt: AT,
  };
}

function mount(open: (seed?: unknown) => boolean = () => true) {
  render(
    <MemoryRouter>
      <KeymapProvider>
        <CreateIssueProvider value={{ open: open as never }}>
          <Drafts />
        </CreateIssueProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

/** What a menu offers, in the order it offers it. */
function labels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

beforeEach(() => {
  deleted.mockReset();
  fetched.mockReset();
  cleared.mockReset();
  listed.mockReset();
  deleted.mockResolvedValue(undefined as never);
  fetched.mockResolvedValue([savedIssueDraft()]);
  listed.mockReturnValue([]);
});

afterEach(cleanup);

describe('Drafts row menu', () => {
  it('opens on a right-click of the row, not only from the ⋯ button', async () => {
    const user = mount();
    const row = (await screen.findByText('Unsent')).closest('li') as HTMLElement;

    await user.pointer({ target: row, keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for Unsent' });
    expect(labels(menu)).toEqual(['Resume draft', 'Discard draft']);
  });

  it('offers the same items in the same order whichever way it was opened', async () => {
    const kebabUser = mount();
    await kebabUser.click(await screen.findByRole('button', { name: 'Options for Unsent' }));
    const fromKebab = labels(await screen.findByRole('menu', { name: 'Options for Unsent' }));
    cleanup();

    const rightUser = mount();
    const row = (await screen.findByText('Unsent')).closest('li') as HTMLElement;
    await rightUser.pointer({ target: row, keys: '[MouseRight]' });
    const fromRightClick = labels(await screen.findByRole('menu', { name: 'Options for Unsent' }));

    expect(fromRightClick).toEqual(fromKebab);
    expect(fromKebab.length).toBeGreaterThan(0);
  });

  it('opens from the keyboard, which is the only way in on a Mac', async () => {
    const user = mount();
    await screen.findByText('Unsent');

    await user.keyboard('.');

    const menu = await screen.findByRole('menu', { name: 'Options for Unsent' });
    expect(labels(menu)).toEqual(['Resume draft', 'Discard draft']);
  });

  it('resumes the draft the menu was opened on, in the composer it came from', async () => {
    const open = vi.fn((_seed?: unknown) => true);
    const user = mount(open);
    await user.click(await screen.findByRole('button', { name: 'Options for Unsent' }));

    const menu = await screen.findByRole('menu', { name: 'Options for Unsent' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Resume draft' }));

    expect(open).toHaveBeenCalledTimes(1);
    // The saved draft's id rides along, so filing it deletes the row rather than leaving a
    // duplicate behind.
    expect(open.mock.calls[0]?.[0]).toMatchObject({ draftId: DRAFT });
  });

  it('asks before discarding a saved draft, and deletes it only once told to', async () => {
    const user = mount();
    await user.click(await screen.findByRole('button', { name: 'Options for Unsent' }));

    const menu = await screen.findByRole('menu', { name: 'Options for Unsent' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Discard draft' }));

    // Nothing has been thrown away yet: the question is what the menu row does.
    expect(deleted).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Discard this draft?' });
    expect(dialog.textContent).toContain('Unsent');

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(deleted).toHaveBeenCalledWith(DRAFT);
  });

  it('leaves the draft alone when the question is declined', async () => {
    const user = mount();
    await user.click(await screen.findByRole('button', { name: 'Options for Unsent' }));

    const menu = await screen.findByRole('menu', { name: 'Options for Unsent' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Discard draft' }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard this draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(deleted).not.toHaveBeenCalled();
    expect(screen.getByText('Unsent')).toBeTruthy();
  });

  it('asks before discarding a local comment draft too, and clears the right slot', async () => {
    listed.mockReturnValue([
      { kind: 'comment', issueId: ISSUE, body: 'Half a reply', updatedAt: AT },
    ]);
    fetched.mockResolvedValue([]);
    const user = mount();

    await user.click(await screen.findByRole('button', { name: 'Options for Half a reply' }));
    const menu = await screen.findByRole('menu', { name: 'Options for Half a reply' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Discard draft' }));

    expect(cleared).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Discard this draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

    expect(cleared).toHaveBeenCalledWith(ISSUE, undefined);
  });
});
