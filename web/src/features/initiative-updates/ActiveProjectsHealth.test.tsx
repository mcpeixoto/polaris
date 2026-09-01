/**
 * The linked-project health strip says what it means in words.
 *
 * This is the densest indicator in the product — one 8px mark per project, inside one cell
 * of a 32px row — and the temptation on a surface that tight is to let hue carry the whole
 * message. It did, once: four dots with `title` attributes, a container named "Active
 * project health", and nothing a screen reader or a colour-blind reader could act on.
 *
 * These assertions are about that rule rather than about layout. If someone shortens the
 * strip's accessible name back to a constant, or drops the tally, these fail — which is the
 * point, because nothing else on the screen would look any different.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActiveProjectsHealth } from './ActiveProjectsHealth';
import type { LinkedProjectHealth } from './helpers';

const ROWS: readonly LinkedProjectHealth[] = [
  { projectId: 'p1', name: 'Ingest', health: 'on_track' },
  { projectId: 'p2', name: 'Billing', health: 'on_track' },
  { projectId: 'p3', name: 'Search', health: 'at_risk' },
  { projectId: 'p4', name: 'Mobile', health: null },
];

describe('ActiveProjectsHealth', () => {
  it('names itself with a tally rather than a constant', () => {
    render(<ActiveProjectsHealth projects={ROWS} />);
    expect(
      screen.getByRole('img', { name: '4 projects: 2 on track, 1 at risk, 1 with no update' }),
    ).toBeTruthy();
  });

  it('counts a single project in the singular', () => {
    render(<ActiveProjectsHealth projects={[ROWS[0]!]} />);
    expect(screen.getByRole('img', { name: '1 project: 1 on track' })).toBeTruthy();
  });

  it('says so in words when there is nothing linked', () => {
    const { container } = render(<ActiveProjectsHealth projects={[]} />);
    expect(container.textContent).toBe('No projects');
  });
});
