/**
 * A consent screen owes its reader what is being granted and by whom, and this one printed
 * neither: `read` and `write` as wire strings in a list, and "as you" without naming which
 * account "you" is — unanswerable for anybody with two accounts in one browser.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gql } from '~/sync/api';

import { OAuthAuthorize } from './OAuthAuthorize';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(async (query: string) => {
    if (query.includes('query OauthClientInfo')) {
      return {
        oauthClientInfo: {
          clientId: 'pol_demo',
          name: 'Acme Bot',
          description: 'Files bugs on your behalf.',
          developer: 'Acme',
          developerUrl: null,
          imageUrl: null,
          allowedScopes: ['read', 'write'],
        },
      };
    }
    if (query.includes('query Viewer')) {
      return { viewer: { user: { email: 'ada@example.com' } } };
    }
    return {};
  });
});

function renderConsent(scope: string) {
  render(
    <MemoryRouter
      initialEntries={[
        `/oauth/authorize?client_id=pol_demo&redirect_uri=https://example.com/cb&response_type=code&scope=${scope}`,
      ]}
    >
      <OAuthAuthorize />
    </MemoryRouter>,
  );
}

describe('OAuthAuthorize consent', () => {
  it('spells each scope as a sentence', async () => {
    renderConsent('read,write,admin');
    await screen.findByRole('heading', { name: 'Authorize Acme Bot' });

    expect(screen.getByText(/Read your issues, projects/)).toBeTruthy();
    expect(screen.getByText(/Create and change issues, projects/)).toBeTruthy();
    expect(screen.getByText(/Administer this workspace/)).toBeTruthy();
  });

  /** A server ahead of this bundle is shown, not hidden: an unnamed grant is still a grant. */
  it('still prints a scope it has no sentence for', async () => {
    renderConsent('read,telemetry:write');
    await screen.findByRole('heading', { name: 'Authorize Acme Bot' });
    expect(screen.getByText('telemetry:write')).toBeTruthy();
  });

  it('names the account that is granting', async () => {
    renderConsent('read');
    await waitFor(() => {
      expect(screen.getByText(/as ada@example\.com/)).toBeTruthy();
    });
  });

  /** aria-disabled, not disabled: a button that leaves the tab order drops focus to the top
   *  of the document, on a screen whose other button is mid-request. */
  it('keeps Deny focusable', async () => {
    renderConsent('read');
    const deny = await screen.findByRole('button', { name: 'Deny' });
    expect((deny as HTMLButtonElement).disabled).toBe(false);
  });
});
