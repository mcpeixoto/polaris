/**
 * WritingField: slash blocks, input rules, and @mentions on a plain textarea.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type User, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { WritingField } from './WritingField';

afterEach(cleanup);

const WORKSPACE = 'w1';
const BOB = '11111111-1111-4111-8111-111111111111' as UUID;

function person(id: UUID, displayName: string): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name: displayName,
    displayName,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function mount(value = '', onChange = vi.fn()) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'user',
      id: BOB,
      op: 'upsert',
      actor: { type: 'system' as const },
      payload: person(BOB, 'Bob'),
    } as Change,
  ]);
  const engine = { store } as unknown as SyncEngine;

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <WritingField label="Body" value={value} onChange={onChange} />
      </EngineProvider>
    </KeymapProvider>,
  );
  return {
    area: screen.getByLabelText('Body') as HTMLTextAreaElement,
    onChange,
    user: userEvent.setup(),
  };
}

describe('WritingField', () => {
  it('opens the slash menu on a word-starting / and inserts a heading', async () => {
    const { area, onChange, user } = mount();
    area.focus();
    await user.keyboard('/');
    expect(onChange).toHaveBeenCalledWith('/');
    await screen.findByRole('menu', { name: 'Insert block' });
    await user.click(screen.getByRole('menuitem', { name: 'Heading 1' }));
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith('# ');
    });
  });

  it('opens the mention menu on @ and inserts the notify token', async () => {
    const { area, onChange, user } = mount();
    area.focus();
    await user.keyboard('@');
    expect(onChange).toHaveBeenCalledWith('@');
    await screen.findByRole('menu', { name: 'Mention someone' });
    await user.click(screen.getByRole('menuitem', { name: 'Bob' }));
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(`@[Bob](user:${BOB}) `);
    });
  });

  it('continues a bullet list on Enter', () => {
    const onChange = vi.fn();
    const { area } = mount('- one', onChange);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('- one\n- ');
  });
});
