import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { Store, type Change, type EstimateScale, type Team } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DueDatePicker, DueDateValue, EstimatePicker, dueDateTone } from './properties';

/**
 * These two pickers are the ones whose answer depends on something other than their props —
 * the team's scale, and a clock in a particular zone — so they are the ones where a mock would
 * be worst. Every test below runs against a real Store and a pinned clock, because the whole
 * class of bug being guarded against is "the code asked the right question of the wrong
 * source": the reader's timezone instead of the team's, a default ladder instead of the team's,
 * zero instead of nothing.
 */

const WORKSPACE = 'workspace-1';
const AT = '2026-01-01T00:00:00Z';

function team(id: string, estimateScale: EstimateScale, extras: Partial<Team> = {}): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key: id.toUpperCase(),
    name: id,
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale,
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    createdAt: AT,
    updatedAt: AT,
    ...extras,
  };
}

function storeWith(teams: readonly Team[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    teams.map((entity, index) => ({
      v: index + 1,
      type: 'team',
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

/** The provider stack every screen in this product sits under, and nothing more. */
function mount(store: Store, children: ReactNode) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          {children}
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** A trigger and its picker, wired the way every real call site wires them. */
function Harness({
  render: renderPicker,
}: {
  render: (trigger: ReturnType<typeof useMenuTrigger>) => ReactNode;
}) {
  const trigger = useMenuTrigger();
  return (
    <>
      <button {...trigger.props}>Open</button>
      {renderPicker(trigger)}
    </>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

/**
 * Only this level can prove that the vocabulary on screen is the team's rather than the
 * store's. The ladders themselves are proven in features/estimate.test; what cannot be checked
 * there is that the picker asks the right team for one, and that "no estimate" and zero stay
 * two different answers all the way from the menu row to the callback.
 */
describe('EstimatePicker', () => {
  function renderPicker(teams: readonly Team[], teamId: string, value: number | null | undefined) {
    const onSelect = vi.fn();
    const mounted = mount(
      storeWith(teams),
      <Harness
        render={(trigger) => (
          <EstimatePicker
            open={trigger.open}
            onClose={trigger.hide}
            trigger={trigger.ref}
            teamId={teamId}
            value={value}
            onSelect={onSelect}
          />
        )}
      />,
    );
    return { ...mounted, onSelect };
  }

  it('offers a t-shirt team its own sizes rather than the numbers underneath them', async () => {
    const { user } = renderPicker([team('tees', 'tshirt')], 'tees', null);
    await open(user);

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'No estimate',
      'XS',
      'S',
      'M',
      'L',
      'XL',
    ]);
  });

  it('offers a Fibonacci team its numbers, with the extension when the team wants one', async () => {
    const { user } = renderPicker(
      [team('fib', 'fibonacci', { estimateExtended: true })],
      'fib',
      null,
    );
    await open(user);

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'No estimate',
      '1',
      '2',
      '3',
      '5',
      '8',
      '13',
      '21',
    ]);
  });

  it('offers zero only when the team allows it, and never in place of no estimate', async () => {
    const { user } = renderPicker(
      [team('zed', 'linear', { estimateAllowZero: true })],
      'zed',
      null,
    );
    await open(user);

    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    // Both are present and they are not the same row. A picker that offered one for both
    // would turn every unsized issue in the workspace into a zero-point one.
    expect(labels).toEqual(['No estimate', '0', '1', '2', '3', '4', '5']);
  });

  it('clears with null rather than with zero', async () => {
    const { user, onSelect } = renderPicker([team('fib', 'fibonacci')], 'fib', 3);
    await open(user);

    await user.click(screen.getByRole('menuitem', { name: 'No estimate' }));

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onSelect).not.toHaveBeenCalledWith(0);
  });

  it('ticks the estimate the issue already has', async () => {
    const { user } = renderPicker([team('tees', 'tshirt')], 'tees', 3);
    await open(user);

    expect(screen.getByRole('menuitem', { name: 'M' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'No estimate' }).getAttribute('aria-current')).toBe(
      null,
    );
  });

  it('does not appear at all for a team that does not estimate', async () => {
    const { user } = renderPicker([team('none', 'none')], 'none', null);
    await open(user);

    // Not an empty menu: `none` means the product has no opinion to offer, and a popover with
    // nothing in it reads as a control that failed to load.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not guess a ladder for a team the replica has not received', async () => {
    const { user } = renderPicker([], 'missing', null);
    await open(user);

    expect(screen.queryByRole('menu')).toBeNull();
  });
});

/**
 * Only this level can prove that a due date is reckoned where the team is rather than where the
 * reader is. Every assertion below pins the clock and moves the zone, because the failure this
 * guards against is invisible to whoever writes the code — it only appears to somebody sitting
 * in another timezone, which for an EU-first product is most people.
 */
describe('due dates', () => {
  // 02:00 UTC on 2 September. In Lisbon that is already the 2nd; in Honolulu it is still the
  // afternoon of the 1st. One instant, two calendars, and a deadline of the 1st that has
  // passed for one team and not for the other.
  const NOW = Date.parse('2026-09-02T02:00:00Z');

  it('calls the same day overdue in one zone and due today in another', () => {
    expect(dueDateTone('2026-09-01', 'Europe/Lisbon', NOW)).toBe('overdue');
    expect(dueDateTone('2026-09-01', 'Pacific/Honolulu', NOW)).toBe('soon');
  });

  it('separates a deadline within reach from one that is merely scheduled', () => {
    expect(dueDateTone('2026-09-02', 'Europe/Lisbon', NOW)).toBe('soon');
    expect(dueDateTone('2026-09-03', 'Europe/Lisbon', NOW)).toBe('soon');
    expect(dueDateTone('2026-09-04', 'Europe/Lisbon', NOW)).toBe('later');
  });

  it('says overdue in words as well as in colour, in the team zone', () => {
    mount(storeWith([]), <DueDateValue value="2026-09-01" timezone="Europe/Lisbon" now={NOW} />);

    // The word is in the element's text, so it reaches a screen reader and a monochrome
    // print. Colour alone is never the message.
    expect(screen.getByText(/overdue/).textContent).toContain('Yesterday');
  });

  it('reads the same date as still due for a team further west', () => {
    mount(storeWith([]), <DueDateValue value="2026-09-01" timezone="Pacific/Honolulu" now={NOW} />);

    expect(screen.queryByText(/overdue/)).toBeNull();
    expect(screen.getByText(/due soon/).textContent).toContain('Today');
  });

  it('says there is no due date rather than rendering an empty cell', () => {
    mount(storeWith([]), <DueDateValue value={null} timezone="Europe/Lisbon" now={NOW} />);

    expect(screen.getByText('No due date')).toBeTruthy();
  });
});

/**
 * Only this level can prove the panel's two contracts: that the relatives it offers resolve in
 * the team's calendar rather than the runner's, and that a date somebody is not allowed to
 * change is refused out loud instead of silently.
 */
describe('DueDatePicker', () => {
  // A Wednesday in Lisbon.
  const NOW = Date.parse('2026-09-02T09:00:00Z');

  function renderPicker(source: 'manual' | 'sla', value: string | null = null) {
    const onSelect = vi.fn();
    const mounted = mount(
      storeWith([]),
      <Harness
        render={(trigger) => (
          <DueDatePicker
            open={trigger.open}
            onClose={trigger.hide}
            trigger={trigger.ref}
            value={value}
            source={source}
            timezone="Europe/Lisbon"
            now={NOW}
            onSelect={onSelect}
          />
        )}
      />,
    );
    return { ...mounted, onSelect };
  }

  it('offers the four relatives, showing the day each of the vaguer two resolves to', async () => {
    const { user } = renderPicker('manual');
    await open(user);

    expect(screen.getByRole('dialog', { name: 'Due date' })).toBeTruthy();
    // Today and Tomorrow say only their own name: `whenDay` writes exactly those two words for
    // those two days, and repeating them would be read out twice.
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeTruthy();
    // The other two carry the date they mean, because nobody should have to count. The day is
    // written by `whenDay` through the UI's own locale, never the runner's — see
    // features/locale.ts, which exists because an English interface was rendering Portuguese
    // dates on a Portuguese machine.
    expect(screen.getByRole('button', { name: 'End of week Sep 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next week Sep 7' })).toBeTruthy();
  });

  it('writes the resolved day, not a token that would move by itself', async () => {
    const { user, onSelect } = renderPicker('manual');
    await open(user);

    await user.click(screen.getByRole('button', { name: /^End of week/ }));

    // Wednesday 2 September 2026 → Friday the 4th. A due date the team has committed to must
    // not quietly become next Friday every Friday.
    expect(onSelect).toHaveBeenCalledWith('2026-09-04');
  });

  it('resolves next week to the following Monday', async () => {
    const { user, onSelect } = renderPicker('manual');
    await open(user);

    await user.click(screen.getByRole('button', { name: /^Next week/ }));

    expect(onSelect).toHaveBeenCalledWith('2026-09-07');
  });

  it('clears the date with null, and offers nothing to clear when there is none', async () => {
    const { user, onSelect } = renderPicker('manual', '2026-09-10');
    await open(user);

    await user.click(screen.getByRole('button', { name: 'No due date' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('refuses an SLA date out loud rather than by doing nothing', async () => {
    const { user, onSelect } = renderPicker('sla', '2026-09-10');
    await open(user);

    // No controls at all, and a sentence saying who owns the date and what to do instead. A
    // disabled control with no explanation is indistinguishable from a broken one.
    expect(screen.queryByRole('button', { name: /^Today/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No due date' })).toBeNull();
    expect(screen.getByText(/service-level agreement/)).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives the trigger its focus back', async () => {
    const { user, onSelect } = renderPicker('manual');
    await open(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Due date' })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });
});
