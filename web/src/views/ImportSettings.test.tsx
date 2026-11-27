import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportJob } from '~/features/imports/mutations';
import type { UserRole } from '~/store';
import { gql } from '~/sync/api';

import { ImportSettings } from './ImportSettings';

/**
 * The Linear import screen.
 *
 * The role comes from the session, so it is mocked at the hook rather than seeded as a
 * replica row — the same split Export uses, for the same reason. The jobs come from
 * GraphQL, which is mocked at `gql` the way the webhook screen mocks it: there is no
 * import entity in the store to seed.
 */
const role: { current: UserRole | null } = { current: 'admin' };
vi.mock('~/hooks/useViewer', () => ({
  useViewerRole: () => role.current,
}));

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

let listing: ImportJob[] = [];

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    source: 'linear',
    status: 'done',
    progress: [],
    error: null,
    createdAt: '2026-01-02T00:00:00Z',
    startedAt: '2026-01-02T00:00:01Z',
    finishedAt: '2026-01-02T00:10:00Z',
    ...over,
  };
}

function answer(query: string): unknown {
  if (query.includes('mutation StartLinearImport')) {
    return {
      startLinearImport: job({
        id: 'job-new',
        status: 'queued',
        progress: [],
        error: null,
        createdAt: '2026-01-03T00:00:00Z',
        startedAt: null,
        finishedAt: null,
      }),
    };
  }
  // `ImportJobs` contains the prefix `ImportJob`, so the list has to be matched first.
  if (query.includes('query ImportJobs')) return { importJobs: listing };
  if (query.includes('query ImportJob')) return { importJob: listing[0] ?? null };
  return {};
}

function listCalls(): number {
  return sent.mock.calls.filter(([query]) => String(query).includes('query ImportJobs')).length;
}

function renderImport() {
  return render(
    <MemoryRouter initialEntries={['/settings/import']}>
      <ImportSettings />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  role.current = 'admin';
  listing = [];
  sent.mockReset();
  sent.mockImplementation(async (query: string) => answer(String(query)) as never);
});

describe('ImportSettings', () => {
  it('shows an admin the form', async () => {
    renderImport();

    expect(await screen.findByRole('heading', { name: 'Import' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Import from Linear' })).toBeTruthy();
    expect(screen.getByLabelText('Linear API key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start import' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Linear account security' }).getAttribute('href')).toBe(
      'https://linear.app/settings/account/security',
    );
  });

  it('keeps Start disabled while the key is empty', async () => {
    renderImport();

    // After the list has answered, so the button is not disabled merely because the
    // screen has not heard back yet. An empty key is the reason.
    expect(await screen.findByText('No imports yet')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start import' }).disabled).toBe(
      true,
    );
  });

  it('starts an import with the key and clears the field', async () => {
    const user = userEvent.setup();
    renderImport();

    const input = await screen.findByLabelText('Linear API key');
    await user.type(input, 'lin_api_test');
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Start import' });
    await waitFor(() => expect(button.disabled).toBe(false));
    await user.click(button);

    await waitFor(() => {
      expect(
        sent.mock.calls.some(
          ([query, variables]) =>
            String(query).includes('mutation StartLinearImport') &&
            (variables as { apiKey?: string } | undefined)?.apiKey === 'lin_api_test',
        ),
      ).toBe(true);
    });
    expect((screen.getByLabelText('Linear API key') as HTMLInputElement).value).toBe('');
  });

  it('shows a running import’s progress and keeps asking while it runs', async () => {
    listing = [
      job({
        status: 'running',
        progress: [{ entity: 'issues', done: 3, total: 10 }],
        finishedAt: null,
      }),
    ];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
      const view = renderImport();

      expect(await screen.findByText('issues 3 / 10')).toBeTruthy();
      expect(screen.getByText('Running')).toBeTruthy();
      await user.type(screen.getByLabelText('Linear API key'), 'lin_api_test');
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start import' }).disabled).toBe(
        true,
      );

      const before = listCalls();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(listCalls()).toBeGreaterThan(before);

      const settled = listCalls();
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(listCalls()).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a failed import’s error and stops asking', async () => {
    listing = [
      job({
        status: 'failed',
        error: 'Linear rejected the API key.',
      }),
    ];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderImport();

      expect(await screen.findByText('Linear rejected the API key.')).toBeTruthy();
      expect(screen.getByText('Failed')).toBeTruthy();
      const before = listCalls();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(listCalls()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells a member they cannot import, and does not show the form', () => {
    role.current = 'member';
    renderImport();

    expect(screen.getByText('Only a workspace administrator can import from Linear.')).toBeTruthy();
    expect(screen.queryByLabelText('Linear API key')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start import' })).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });
});
