/**
 * The two shapes, and the promise each makes. A row of destinations must be links a reload
 * survives; a row that only changes what is on screen must be the tablist a screen reader
 * can count.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { Tabs } from './Tabs';

const sections = [
  { id: 'overview', label: 'Overview', to: '/project/1', end: true },
  { id: 'issues', label: 'Issues', to: '/project/1/issues' },
];

describe('Tabs', () => {
  describe('as destinations', () => {
    it('renders links, so a section can be linked to and reloaded', () => {
      render(
        <MemoryRouter initialEntries={['/project/1']}>
          <Tabs items={sections} aria-label="Project sections" />
        </MemoryRouter>,
      );

      expect(screen.getByRole('navigation', { name: 'Project sections' })).toBeTruthy();
      expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Overview',
        'Issues',
      ]);
    });

    // The router marks the active link; nothing here keeps a copy of which tab is current.
    it('lets the router say which section is open', () => {
      render(
        <MemoryRouter initialEntries={['/project/1/issues']}>
          <Tabs items={sections} aria-label="Project sections" />
        </MemoryRouter>,
      );

      expect(screen.getByRole('link', { name: 'Issues' }).getAttribute('aria-current')).toBe(
        'page',
      );
      expect(
        screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current'),
      ).toBeNull();
    });
  });

  describe('as a tablist', () => {
    const views = [
      { id: 'list', label: 'List' },
      { id: 'board', label: 'Board' },
    ];

    it('announces itself as tabs with one selected', () => {
      render(<Tabs items={views} value="board" aria-label="Layout" />);

      expect(screen.getByRole('tablist', { name: 'Layout' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Board' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('false');
    });

    it('reports the tab that was chosen', async () => {
      const onSelect = vi.fn();
      render(<Tabs items={views} value="list" onSelect={onSelect} aria-label="Layout" />);

      await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
      expect(onSelect).toHaveBeenCalledWith('board');
    });

    // Every tab is a real control in the tab order, because roving would need the arrow
    // handler this component is not allowed to own.
    it('leaves every tab reachable by Tab', async () => {
      render(<Tabs items={views} value="list" aria-label="Layout" />);

      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'List' }));
      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Board' }));
    });
  });
});
