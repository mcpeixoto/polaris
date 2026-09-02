/**
 * "Due soon" was drawn as a 1px dashed outline and nothing else. The label existed in
 * `PROJECT_UPDATE_STALENESS_LABEL` and was rendered nowhere, so a whole state was invisible
 * to a screen reader and to anyone who cannot pick a dashed edge out of a dense row.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Store, type Change, type Entity } from '~/store';

import { ProjectHealthCell } from './ProjectHealthCell';

const WORKSPACE = 'w1';
const PROJECT = 'p1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

/** An on-track update `daysAgo` old, against a 7-day cadence with a 3-day grace period. */
function seeded(daysAgo: number): Store {
  const store = new Store(WORKSPACE);
  const posted = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  store.applyChanges([
    upsert(1, 'workspace', {
      id: WORKSPACE,
      name: 'Acme',
      urlKey: 'acme',
      plan: 'free',
      projectUpdateReminderIntervalDays: 7,
      projectUpdateReminderWeekday: 3,
      projectUpdateReminderHour: 9,
      pulseEnabled: true,
      customerRequestsEnabled: true,
      customerRevenueUnit: '',
      customerTiers: [],
      pulseDigestCadence: 'off',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'projectStatus', {
      id: 'ps-started',
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(3, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Polaris',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps-started',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(4, 'projectUpdate', {
      id: 'pu1',
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      health: 'on_track',
      body: 'Going fine.',
      authorId: 'u1',
      createdAt: posted,
      updatedAt: posted,
    }),
  ]);
  return store;
}

describe('ProjectHealthCell', () => {
  it('says "Due soon" in words, not only as an outline', () => {
    render(<ProjectHealthCell store={seeded(8)} projectId={PROJECT} />);
    expect(screen.getByText('Due soon')).toBeTruthy();
    expect(screen.getByText('On track')).toBeTruthy();
  });

  it('keeps the word in the accessibility tree in the compact list cell', () => {
    const { container } = render(
      <ProjectHealthCell store={seeded(8)} projectId={PROJECT} compact />,
    );
    // Clipped, not removed: a dense surface drops the visible label, never the name.
    expect(screen.getByText('Due soon')).toBeTruthy();
    expect(container.querySelector('[title]')?.getAttribute('title')).toContain('Due soon');
  });

  it('says nothing extra while an update is not yet due', () => {
    render(<ProjectHealthCell store={seeded(1)} projectId={PROJECT} />);
    expect(screen.queryByText('Due soon')).toBeNull();
    expect(screen.getByText('On track')).toBeTruthy();
  });

  it('escalates to "Update missing" past the grace period', () => {
    render(<ProjectHealthCell store={seeded(11)} projectId={PROJECT} />);
    expect(screen.getByText('Update missing')).toBeTruthy();
  });
});
