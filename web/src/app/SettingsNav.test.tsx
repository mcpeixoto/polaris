import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { SETTINGS_ROUTES, SettingsNav } from './SettingsNav';

function renderNav(props: Partial<Parameters<typeof SettingsNav>[0]> = {}) {
  render(
    <MemoryRouter initialEntries={['/settings/profile']}>
      <SettingsNav showMemberSettings showAdminSettings workspaceName="Polaris" {...props} />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const hrefs = () => screen.getAllByRole('link').map((link) => link.getAttribute('href'));

describe('SettingsNav', () => {
  // Regrouping the rows is only safe if every route survived it. The routes are what
  // `App.tsx` mounts; a row that fell out of the nav is a screen only a bookmark can reach.
  it('links to every settings route for an admin, and back to the app', () => {
    renderNav();

    const links = hrefs();
    expect(links[0]).toBe('/');
    for (const route of SETTINGS_ROUTES) {
      expect(links).toContain(route);
    }
    expect(SETTINGS_ROUTES).toHaveLength(32);
  });

  it('groups the rows under Personal, Issues, Projects, Features and Administration', () => {
    renderNav();

    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'Personal',
      'Issues',
      'Projects',
      'Features',
      'Administration',
    ]);
  });

  // A guest has an account and nothing else. The groups that would be empty for them are
  // not drawn empty; they are not drawn.
  it('shows a guest only the Personal group', () => {
    renderNav({ showMemberSettings: false, showAdminSettings: false });

    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'Personal',
    ]);
    expect(hrefs()).not.toContain('/settings/members');
    expect(hrefs()).not.toContain('/settings/api-keys');
  });

  it('filters the rows as the search box is typed into, and hides emptied groups', async () => {
    const user = renderNav();

    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'labels');

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Back to app',
      'Labels',
      'Project labels',
      'Initiative labels',
    ]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'Issues',
      'Projects',
    ]);
  });

  it('says so when nothing matches, and keeps the way out', async () => {
    const user = renderNav();

    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'zzz');

    expect(screen.getByRole('status').textContent).toBe('No settings match “zzz”');
    expect(screen.getByRole('link', { name: 'Back to app' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('marks the current route and names the workspace being edited', () => {
    renderNav();

    expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Polaris')).toBeTruthy();
  });
});
