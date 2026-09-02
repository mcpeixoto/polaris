/**
 * Writing in the description field: the overlay staying on the text it paints, the markdown
 * input rules, the block menu, and the markdown a thread renders.
 *
 * A separate file from DescriptionEditor.test.tsx, which covers the comment-anchoring half.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { Store, type Change, type Comment, type Entity, type EntityType } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DescriptionEditor } from './DescriptionEditor';

afterEach(cleanup);

const WORKSPACE = 'workspace-1';
const ISSUE = 'issue-1';
const ADA = 'user-ada';
const AT = '2026-01-01T00:00:00.000Z';

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

function mount(store: Store, description = '', onSave: (next: string) => void = () => {}) {
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
          issueId={ISSUE}
          description={description}
          names={{ [ADA]: 'Ada' }}
          viewerId={ADA}
          enterSubmits={false}
          onSave={onSave}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
  const area = screen.getByLabelText('Description') as HTMLTextAreaElement;
  const backdrop = view.container.querySelector('pre') as HTMLPreElement;
  return { view, area, backdrop, user: userEvent.setup() };
}

/** Types into the field the way the browser does, so the component's own handlers run. */
async function typeInto(area: HTMLTextAreaElement, text: string) {
  await userEvent.type(area, text);
}

describe('the overlay follows the text', () => {
  it('scrolls the paint layer with the textarea', () => {
    const { area, backdrop } = mount(
      storeWith([]),
      Array.from({ length: 60 }, () => 'x').join('\n'),
    );

    area.scrollTop = 240;
    area.scrollLeft = 12;
    fireEvent.scroll(area);

    // Past the 30-line ceiling `resize()` puts the textarea on `overflow-y: auto` and it
    // scrolls inside itself, while `.backdrop` is `inset: 0; overflow: hidden`. Without the
    // sync the highlights stay pinned at the top and every mark lands on the wrong words.
    expect(backdrop.scrollTop).toBe(240);
    expect(backdrop.scrollLeft).toBe(12);
  });

  it('restores the offset after a re-render', async () => {
    const { area, backdrop } = mount(
      storeWith([]),
      Array.from({ length: 60 }, () => 'x').join('\n'),
    );

    area.scrollTop = 300;
    fireEvent.scroll(area);
    backdrop.scrollTop = 0; // What a commit does to a `<pre>` React has just rewritten.

    await typeInto(area, 'y');

    expect(backdrop.scrollTop).toBe(area.scrollTop);
  });
});

describe('markdown input rules', () => {
  it('continues a bulleted list on Enter', async () => {
    const { area } = mount(storeWith([]));
    await typeInto(area, '- one{Enter}two');
    expect(area.value).toBe('- one\n- two');
  });

  it('ends the list on an empty item', async () => {
    const { area } = mount(storeWith([]));
    await typeInto(area, '- one{Enter}{Enter}plain');
    expect(area.value).toBe('- one\nplain');
  });

  it('numbers a numbered list as it goes', async () => {
    const { area } = mount(storeWith([]));
    await typeInto(area, '1. one{Enter}two{Enter}three');
    expect(area.value).toBe('1. one\n2. two\n3. three');
  });

  it('normalises a star bullet when its space is typed', async () => {
    const { area } = mount(storeWith([]));
    await typeInto(area, '* one');
    expect(area.value).toBe('- one');
  });

  it('leaves a heading marker alone', async () => {
    const { area } = mount(storeWith([]));
    await typeInto(area, '## Heading');
    expect(area.value).toBe('## Heading');
  });

  it('saves the rule’s own edit when the field is left', async () => {
    const onSave = vi.fn();
    const { area } = mount(storeWith([]), '', onSave);
    await typeInto(area, '- one{Enter}two');
    fireEvent.blur(area);
    expect(onSave).toHaveBeenCalledWith('- one\n- two');
  });
});

describe('the block menu', () => {
  it('opens on a slash that starts a word and offers every block', async () => {
    const { area, user } = mount(storeWith([]));
    await user.click(area);
    await typeInto(area, '/');

    const menu = screen.getByRole('menu', { name: 'Insert block' });
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(
      [
        'Heading 1',
        'Heading 2',
        'Heading 3',
        'Bulleted list',
        'Numbered list',
        'Code block',
        'Quote',
        'Divider',
      ],
    );
  });

  it('does not open on a slash inside a word', async () => {
    const { area } = mount(storeWith([]));
    await typeInto(area, 'and/');
    expect(screen.queryByRole('menu', { name: 'Insert block' })).toBeNull();
    expect(area.value).toBe('and/');
  });

  it('replaces the slash query with the chosen block and returns focus to the field', async () => {
    const { area, user } = mount(storeWith([]));
    await user.click(area);
    await typeInto(area, 'Ship it /');

    await user.click(screen.getByRole('menuitem', { name: 'Bulleted list' }));

    expect(area.value).toBe('Ship it \n- ');
    expect(document.activeElement).toBe(area);
    expect(screen.queryByRole('menu', { name: 'Insert block' })).toBeNull();
  });

  it('does not save the field back to its last saved text while the menu is open', async () => {
    const onSave = vi.fn();
    const { area, user } = mount(storeWith([]), '', onSave);
    await user.click(area);
    await typeInto(area, 'Ship it /');

    // Opening the menu moves focus off the textarea. That is not the writer leaving.
    expect(onSave).not.toHaveBeenCalled();
    expect(area.value).toBe('Ship it /');
  });
});

describe('a thread renders markdown', () => {
  it('formats a comment body instead of printing its source', async () => {
    const { area, user } = mount(
      storeWith([
        [
          'comment',
          comment('c1', {
            body: 'It is the **session** cookie.',
            anchorStart: 4,
            anchorEnd: 13,
            quote: 'auth path',
          }),
        ],
      ]),
      'The auth path is wrong.',
    );

    await user.click(area);
    area.setSelectionRange(6, 6);
    fireEvent.mouseUp(area);

    const thread = screen.getByRole('dialog', { name: 'Comment thread' });
    expect(thread.querySelector('strong')?.textContent).toBe('session');
    expect(thread.textContent).not.toContain('**session**');
  });
});
