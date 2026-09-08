/**
 * What a run of labels is: links to label views, or triggers for the issue's label picker.
 *
 * The run has two shapes and the prop that chooses between them is `onOpenPicker`, so both
 * shapes are rendered here from the same seed. The one that matters most is the "+2": the
 * labels it stands for are drawn `visibility: hidden`, which means the count is the only
 * thing a pointer can reach for them at all. A "+2" that is a span is a part of an issue no
 * mouse can get to.
 *
 * It runs against a real Store with no database behind it, as the pickers' own tests do —
 * asserting that a component asked a mock a question stays green through exactly the kind of
 * change that breaks the screen.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { LabelList } from './LabelList';

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const ISSUE = 'issue-1';
const AT = '2026-01-01T00:00:00Z';

/** Five labels on one issue, which is more than the width below has room for. */
const NAMES = ['Bug', 'Design', 'Docs', 'Regression', 'Urgent'] as const;

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'Europe/Lisbon',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        cyclesEnabled: false,
        cycleDurationWeeks: 1,
        cycleCooldownWeeks: 0,
        cycleStartDay: 'monday',
        cycleUpcomingCount: 2,
        cycleAutoAddStarted: false,
        cycleAutoAddCompleted: false,
        triageEnabled: false,
        triageRequirePriority: false,
        autoCloseDays: 0,
        autoArchiveDays: 0,
        autoCloseParent: false,
        autoCloseChildren: false,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 1,
        identifier: 'ENG-1',
        title: 'Fix the flake',
        description: '',
        dueDateSource: 'manual',
        stateId: 's-todo',
        priority: 0,
        sortOrder: 'V',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    ...NAMES.flatMap((name): [string, Entity][] => {
      const id = `label-${name.toLowerCase()}`;
      return [
        [
          'label',
          {
            id,
            workspaceId: WORKSPACE,
            teamId: TEAM,
            name,
            color: '#5e6ad2',
            isGroup: false,
            position: 'V',
            createdAt: AT,
            updatedAt: AT,
          },
        ],
        [
          'issueLabel',
          {
            id: `${ISSUE}:${id}`,
            workspaceId: WORKSPACE,
            teamId: TEAM,
            issueId: ISSUE,
            labelId: id,
            createdAt: AT,
          },
        ],
      ];
    }),
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

/**
 * The run inside a parent that behaves like the row it really sits in.
 *
 * The parent's `onClick` is the point of it: on a row or a card that click opens the issue,
 * so a chip that lets the press bubble changes a label *and* navigates away from the list
 * you were changing it in. The spy is how that stays proven.
 */
function renderRun(props: Partial<Parameters<typeof LabelList>[0]> = {}) {
  const onRowClick = vi.fn();
  const engine = { store: seeded() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        {/* Presentational on purpose: it is standing in for a row's click, not offering one
            of its own — the row this replaces is a `role="option"` with a keyboard route. */}
        <div role="presentation" onClick={onRowClick}>
          <LabelList issueId={ISSUE} {...props} />
        </div>
      </EngineProvider>
    </MemoryRouter>,
  );
  return { onRowClick, user: userEvent.setup() };
}

/**
 * jsdom lays nothing out, and `fittingCount` reads a container width of zero as "not laid
 * out yet" and keeps every chip — so without widths there is no "+2" to test at all.
 *
 * The two numbers are what produce a collapse rather than arbitrary: the container fits two
 * 60px chips and their 4px gap, and the third would need the 32px the count itself is owed,
 * so the run shows two and stands for three.
 */
const LIST_WIDTH = 200;
const ITEM_WIDTH = 60;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'UL' ? LIST_WIDTH : ITEM_WIDTH;
    },
  });
});

afterAll(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
});

describe('a run of labels with a picker behind it', () => {
  it('draws every chip as a trigger that says a menu is behind it', () => {
    renderRun({ onOpenPicker: vi.fn(), pickerOpen: false });

    const chip = screen.getByRole('button', { name: 'Bug' });

    expect(chip.getAttribute('aria-haspopup')).toBe('menu');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    // A row navigates by aria-activedescendant, and a tab stop inside an option breaks it.
    expect(chip.getAttribute('tabindex')).toBe('-1');
  });

  it('says the menu is open while it is', () => {
    renderRun({ onOpenPicker: vi.fn(), pickerOpen: true });

    expect(screen.getByRole('button', { name: 'Bug' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('hands the picker the chip it was pressed on, and nothing to the row', async () => {
    const onOpenPicker = vi.fn();
    const { onRowClick, user } = renderRun({ onOpenPicker, pickerOpen: false });

    const chip = screen.getByRole('button', { name: 'Bug' });
    await user.click(chip);

    expect(onOpenPicker.mock.calls.length).toBe(1);
    // The element and not the id: it is what the menu anchors itself against.
    expect(onOpenPicker.mock.calls[0]?.[0]).toBe(chip);
    expect(onRowClick.mock.calls.length, 'the press must not also open the issue').toBe(0);
  });

  /**
   * The one case the whole file exists for. The labels behind a "+3" are rendered
   * `visibility: hidden` so the run can measure them, which leaves them with no pointer
   * route of their own — the count is it.
   */
  it('makes the overflow count a trigger too', async () => {
    const onOpenPicker = vi.fn();
    const { onRowClick, user } = renderRun({ onOpenPicker, pickerOpen: false });

    const more = screen.getByRole('button', { name: '3 more: Docs, Regression, Urgent' });

    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('tabindex')).toBe('-1');

    await user.click(more);

    expect(onOpenPicker.mock.calls[0]?.[0]).toBe(more);
    expect(onRowClick.mock.calls.length).toBe(0);
  });
});

describe('a run of labels with nothing behind it', () => {
  it('leaves the chips as links to their label views', () => {
    renderRun();

    expect(screen.getByRole('link', { name: 'Bug' })).toBeTruthy();
    expect(
      screen.queryAllByRole('button').length,
      'a peek or a preview has no picker for a trigger to open',
    ).toBe(0);
  });

  it('leaves the count as an image that reads out the names it stands for', () => {
    renderRun();

    expect(screen.getByRole('img', { name: '3 more: Docs, Regression, Urgent' })).toBeTruthy();
  });
});
