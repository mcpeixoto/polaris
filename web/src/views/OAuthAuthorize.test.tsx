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
    return {};
  });
});

describe('OAuthAuthorize', () => {
  it('shows the application name and an Authorize control', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/oauth/authorize?client_id=pol_demo&redirect_uri=https://example.com/cb&response_type=code&scope=read',
        ]}
      >
        <OAuthAuthorize />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Authorize Acme Bot' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Authorize' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    });
  });

  it('explains a request that is missing the required parameters', async () => {
    render(
      <MemoryRouter initialEntries={['/oauth/authorize']}>
        <OAuthAuthorize />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/missing client_id, redirect_uri, or response_type=code/),
    ).toBeTruthy();
  });
});
