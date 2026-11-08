import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { Downloads } from './Downloads';
import { APP_STORE_URL } from '~/features/downloads/device';

afterEach(() => vi.unstubAllGlobals());

it('offers iOS independently of release API failure and preserves all desktop choices', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  vi.stubGlobal('navigator', { userAgent: 'iPhone OS 18', platform: 'iPhone', maxTouchPoints: 5 });
  render(
    <MemoryRouter>
      <Downloads />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Polaris for iOS' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Get it on the App Store →' }).getAttribute('href')).toBe(
    APP_STORE_URL,
  );
  expect(screen.getByRole('link', { name: 'Get the iPhone app ↗' }).getAttribute('href')).toBe(
    APP_STORE_URL,
  );
  expect(await screen.findByText(/We couldn’t load/)).toBeTruthy();
  expect(screen.getAllByRole('region')).toHaveLength(3);
});
