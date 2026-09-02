import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { GitLabSettings } from './GitLabSettings';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

// Held in a box so one test can sign in as an admin without the others noticing; every
// other test keeps the original "no viewer" answer.
const viewer = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => null,
  useViewer: () => viewer.current,
}));

const sent = vi.mocked(gql);

function answer(query: string): unknown {
  if (query.includes('query GitLabSettings')) {
    return { gitlabWebhook: null };
  }
  return {};
}

beforeEach(() => {
  viewer.current = null;
  sent.mockReset();
  sent.mockImplementation(async (query: string) => answer(query) as never);
});

function renderScreen() {
  const store = new Store('w');
  const engine = { store } as unknown as SyncEngine;
  return render(
    <MemoryRouter initialEntries={['/settings/gitlab']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <GitLabSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

/** Types a username and submits, which is the only save a non-admin viewer can run here. */
async function submitUsername(): Promise<HTMLElement> {
  const field = await screen.findByLabelText('GitLab username');
  fireEvent.change(field, { target: { value: 'octocat' } });
  const button = screen.getByRole('button', { name: 'Save username' });
  fireEvent.click(button);
  const section = button.closest('section');
  if (section === null) throw new Error('the username form is not inside a section');
  return section;
}

describe('GitLabSettings', () => {
  it('renders the GitLab heading and a username field', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'GitLab' })).toBeTruthy();
    });
    expect(screen.getByLabelText('GitLab username')).toBeTruthy();
  });

  it('puts a refused save beside the form that produced it, not in the page banner', async () => {
    sent.mockImplementation(async (query: string) => {
      if (query.includes('query GitLabSettings')) return answer(query) as never;
      throw new ApiError('VALIDATION', 'That GitLab account is already linked.');
    });

    renderScreen();
    const section = await submitUsername();

    const message = await screen.findByText('That GitLab account is already linked.');
    // The proof that it is section-level and not page-level: the alert and the button that
    // caused it are inside the same section.
    expect(section.contains(message)).toBe(true);
    expect(within(section).getByRole('button', { name: 'Save username' })).toBeTruthy();
  });

  it('announces a landed save through the section indicator', async () => {
    renderScreen();
    const section = await submitUsername();

    await waitFor(() => {
      expect(within(section).getByRole('status').textContent).toBe('Saved');
    });
  });
});

const CONNECTION = '00000000-0000-4000-8000-000000000001';
const VIEWER = '00000000-0000-4000-8000-000000000002';

/**
 * The webhook section used to be rendered only once the fetch had returned a token, so a
 * refused fetch removed the whole section — a user who had never seen it had no way to
 * learn it existed.
 */
describe('GitLabSettings webhook section', () => {
  function renderConnected() {
    const store = new Store('w');
    store.applyChanges([
      {
        v: 1,
        type: 'gitlabConnection',
        id: CONNECTION,
        op: 'upsert',
        actor: { type: 'system' },
        payload: {
          id: CONNECTION,
          workspaceId: 'w',
          creatorId: VIEWER,
          enabled: true,
          instanceUrl: 'https://gitlab.com',
          branchNameFormat: '{identifier}-{title}',
          linkCommits: true,
          linkbacks: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      } as Change,
    ]);
    const engine = { store } as unknown as SyncEngine;
    return render(
      <MemoryRouter initialEntries={['/settings/gitlab']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <GitLabSettings />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
  }

  it('keeps the section and offers a retry when the fetch is refused', async () => {
    viewer.current = { id: VIEWER, role: 'admin' };
    sent.mockImplementation(async (query: string) => {
      if (query.includes('query GitLabSettings')) {
        throw new ApiError('INTERNAL', 'no');
      }
      return answer(query) as never;
    });

    renderConnected();

    const heading = await screen.findByRole('heading', { name: 'Webhook' });
    const section = heading.closest('section');
    expect(section).not.toBeNull();
    expect(
      within(section as HTMLElement).getByText('Webhook details could not be loaded'),
    ).toBeTruthy();
    expect(within(section as HTMLElement).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
