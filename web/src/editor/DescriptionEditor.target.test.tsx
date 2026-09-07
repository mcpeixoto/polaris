/**
 * The editor on a target that is not an issue.
 *
 * A project and an initiative have a description but no comment tree, so the same editor has
 * to render without the inline-thread half: no query against the issue's comments, and no
 * Comment button offered on a selection that could not go anywhere. The writing half —
 * autosave on blur and the flush when the tab goes away — is the whole reason these screens
 * want the editor at all, so it is asserted here rather than assumed from the issue tests.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { Store, type Change, type Comment, type Entity, type EntityType } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DescriptionEditor, type EditorTarget } from './DescriptionEditor';

afterEach(cleanup);

const WORKSPACE = 'workspace-1';
const ISSUE = 'issue-1';
const PROJECT = 'project-1';
const ADA = 'user-ada';
const AT = '2026-01-01T00:00:00.000Z';
const TEXT = 'The auth path is wrong.';

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId: ISSUE,
    body: 'It is the session cookie.',
    actor: { type: 'user', id: ADA },
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function storeWith(rows: readonly [EntityType, Entity][]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(([type, entity], index) => ({
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

function Host(props: Parameters<typeof DescriptionEditor>[0]) {
  useKeyContext('detail');
  return <DescriptionEditor {...props} />;
}

function mount(target: EditorTarget, store: Store, onSave: (next: string) => void = () => {}) {
  const mutate = vi.fn(async () => ({}));
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  const view = render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Host
          target={target}
          description={TEXT}
          names={{ [ADA]: 'Ada' }}
          viewerId={ADA}
          enterSubmits={false}
          onSave={onSave}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
  const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
  return { view, area, mutate, user: userEvent.setup() };
}

/** A row anchored at the same id, to prove the kind and not the id is what gates the query. */
const anchored = comment('c1', {
  issueId: PROJECT,
  anchorStart: 4,
  anchorEnd: 13,
  quote: 'auth path',
});

describe('a project target has no inline comments', () => {
  it('offers no Comment button on a selection', async () => {
    const { area, user } = mount({ kind: 'project', id: PROJECT }, storeWith([]));
    await user.click(area);
    area.setSelectionRange(4, 13);
    fireEvent.mouseUp(area);

    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it('paints no marks for comment rows carrying the same id', () => {
    mount({ kind: 'project', id: PROJECT }, storeWith([['comment', anchored]]));

    expect(screen.queryByText('It is the session cookie.')).toBeNull();
    expect(document.querySelector('mark')).toBeNull();
  });

  it('still saves on blur', async () => {
    const onSave = vi.fn();
    const { area, user } = mount({ kind: 'project', id: PROJECT }, storeWith([]), onSave);
    await user.click(area);
    await user.type(area, ' Probably.');
    fireEvent.blur(area);

    expect(onSave).toHaveBeenCalledWith(`${TEXT} Probably.`);
  });

  it('still saves when the tab is hidden', async () => {
    const onSave = vi.fn();
    const { area, user } = mount({ kind: 'project', id: PROJECT }, storeWith([]), onSave);
    await user.click(area);
    await user.type(area, ' Probably.');

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    hidden.mockRestore();

    expect(onSave).toHaveBeenCalledWith(`${TEXT} Probably.`);
  });
});

describe('an issue target keeps the comment affordance', () => {
  it('offers the Comment button on a selection', async () => {
    const { area, user } = mount({ kind: 'issue', id: ISSUE }, storeWith([]));
    await user.click(area);
    area.setSelectionRange(4, 13);
    fireEvent.mouseUp(area);

    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
  });
});
