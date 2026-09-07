/**
 * A document is stored as markdown and used to be shown as markdown, so every reader saw
 * `## Heading` where a heading belonged. These are the two halves of the fix: the body reads
 * as a document until somebody puts the caret in it, and the two destructive buttons beside
 * the title can no longer fire on one click.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { DocumentDetail } from './DocumentDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const DOC = 'd1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function seeded(body: string): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', {
      id: TEAM,
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      private: false,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(2, 'document', {
      id: DOC,
      workspaceId: WORKSPACE,
      teamId: TEAM,
      title: 'Runbook',
      body,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

afterEach(cleanup);

function mount(store: Store, mutate: ReturnType<typeof vi.fn>, status: EngineStatus) {
  const view = render(
    <MemoryRouter initialEntries={[`/document/${DOC}`]}>
      <KeymapProvider>
        <EngineProvider engine={{ store, mutate } as unknown as SyncEngine} status={status}>
          <Routes>
            <Route path="/document/:documentId" element={<DocumentDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), view };
}

function renderReading(body: string) {
  const store = seeded(body);
  const mutate = vi.fn().mockResolvedValue({});
  return { mutate, ...mount(store, mutate, { phase: 'idle' }) };
}

describe('DocumentDetail reading', () => {
  it('renders the body as a document rather than as its own source', () => {
    // The rendered copy is aria-hidden by design — the textarea under it is the field, and
    // announcing the body twice would be worse than announcing it once as source. So this
    // looks at the elements rather than at the accessibility tree.
    const { view } = renderReading('## Runbook\n\nRestart the **worker** first.');

    expect(view.container.querySelector('h3')?.textContent).toBe('Runbook');
    expect(view.container.querySelector('strong')?.textContent).toBe('worker');
    expect(screen.queryByText('## Runbook')).toBeNull();
  });

  it('swaps to the editor when the reader clicks the body', async () => {
    const { user, view } = renderReading('## Runbook');

    // The rendered copy is laid over the field and is transparent to the pointer, so the
    // click a reader aims at the document is delivered by the browser to the textarea
    // underneath it. jsdom does no hit testing and honours no `pointer-events`, so the
    // click is aimed at the element a real browser would have chosen.
    await user.click(screen.getByLabelText('Body'));

    // The rendered copy is gone and the caret is in the field that holds the markdown.
    expect(view.container.querySelector('h3')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Body'));
  });

  it('never turns a link the writer typed into one the reader can be sent down', () => {
    const { view } = renderReading('[click](javascript:alert)');

    // The breadcrumb's crumbs are the only anchors on the page, and none of them is the
    // writer's. The assertion is on the hrefs rather than on a count, because the trail's
    // length is a layout decision and the absence of a `javascript:` URL is not.
    const hrefs = [...view.container.querySelectorAll('a')].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/team/ENG', '/team/ENG/documents']);
    expect(screen.getByText('[click](javascript:alert)')).toBeTruthy();
  });

  it('says where the document lives, and never invents a team it cannot name', () => {
    renderReading('body');

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail.textContent).toContain('Engineering');
    expect(trail.textContent).toContain('Documents');
    // The last crumb is the page you are on, so it is text rather than a link.
    expect(within(trail).getByText('Runbook').closest('a')).toBeNull();
  });

  it('asks before deleting, and names what goes', async () => {
    const { mutate, user } = renderReading('body');

    // Behind the ⋯ menu rather than beside the title, where it was one click from happening
    // to a document that may hold the only copy of something.
    await user.click(screen.getByRole('button', { name: 'Document options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete document' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/go for good/)).toBeTruthy();
    // Nothing has happened yet — the click opened a question, not a deletion.
    expect(mutate).not.toHaveBeenCalled();
  });

  it('waits for the store to settle before calling a document missing', () => {
    const store = new Store(WORKSPACE);
    const mutate = vi.fn();
    mount(store, mutate, { phase: 'bootstrapping', received: 3 });

    expect(screen.getByRole('status').textContent).toBe('Loading document…');
    expect(screen.queryByText('No such document')).toBeNull();
  });
});
