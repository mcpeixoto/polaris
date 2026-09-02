/**
 * The reminder cadence fields used to save from `onChange`: typing "14" wrote 1 and then
 * 14, clearing the field parsed to NaN and was skipped so the input looked frozen, and the
 * declared min/max were never enforced on a typed value.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { clampInt, ProjectUpdateSettings } from './ProjectUpdateSettings';

const WORKSPACE = 'w1';
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
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
  ]);
  return store;
}

function renderPage() {
  const mutate = vi.fn().mockResolvedValue({ updateWorkspace: { workspace: null } });
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ProjectUpdateSettings />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { mutate, user: userEvent.setup() };
}

function inputOf(mutate: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  const args = mutate.mock.calls[call]?.[0] as { variables: { input: Record<string, unknown> } };
  return args.variables.input;
}

describe('Project update settings', () => {
  it('labels its fields through Field rather than a loose span', () => {
    renderPage();
    expect(screen.getByLabelText(/Reminder interval/)).toBeTruthy();
    expect(screen.getByLabelText(/Reminder weekday/)).toBeTruthy();
    expect(screen.getByLabelText(/Reminder hour/)).toBeTruthy();
  });

  it('writes once, on blur, with the number that was typed', async () => {
    const { mutate, user } = renderPage();
    const field = screen.getByLabelText(/Reminder interval/);

    await user.clear(field);
    await user.type(field, '14');
    // Nothing yet: the intermediate "1" is not a value anybody chose.
    expect(mutate).not.toHaveBeenCalled();

    await user.tab();
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(inputOf(mutate, 0).projectUpdateReminderIntervalDays).toBe(14);
  });

  it('confirms the write next to the fields', async () => {
    const { user } = renderPage();
    await user.clear(screen.getByLabelText(/Reminder interval/));
    await user.type(screen.getByLabelText(/Reminder interval/), '10');
    await user.tab();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('clamps a typed value into the declared range', async () => {
    const { mutate, user } = renderPage();
    const hour = screen.getByLabelText(/Reminder hour/);
    await user.clear(hour);
    await user.type(hour, '99');
    await user.tab();
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(inputOf(mutate, 0).projectUpdateReminderHour).toBe(23);
  });

  /**
   * Emptying the field to retype it used to write nothing and leave the old number on
   * screen, so the input read as frozen. It is empty while being typed in, and the stored
   * value comes back if the reader leaves it that way.
   */
  it('can be emptied, and falls back to the stored value with no write', async () => {
    const { mutate, user } = renderPage();
    const field = screen.getByLabelText(/Reminder interval/);
    await user.clear(field);
    expect((field as HTMLInputElement).value).toBe('');

    await user.tab();
    expect(mutate).not.toHaveBeenCalled();
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('7'));
  });
});

describe('clampInt', () => {
  it('holds a number inside its range', () => {
    expect(clampInt('0', 1, 365)).toBe(1);
    expect(clampInt('900', 1, 365)).toBe(365);
    expect(clampInt(' 14 ', 1, 365)).toBe(14);
  });

  it('answers null for text that is not a number', () => {
    expect(clampInt('', 0, 23)).toBeNull();
    expect(clampInt('abc', 0, 23)).toBeNull();
  });
});
