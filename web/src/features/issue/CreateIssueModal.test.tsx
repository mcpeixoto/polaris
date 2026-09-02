/**
 * "Create more" — `docs/01-features/02-issues.md`: the composer files the issue, stays open,
 * and keeps the properties for a rapid second one.
 *
 * The point of the feature is what it does *not* reset, so that is what this asserts:
 * `createIssue` is called with the status and priority that were set once, both times, while
 * the words are cleared between them and the dialog is never closed.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { writeIssueComposerDraft } from '~/features/drafts/local';

import { CreateIssueModal } from './CreateIssueModal';
import { createIssue } from './mutations';
import type { IssueComposerSeed } from './create-url';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createIssue: vi.fn(() => Promise.resolve('issue-1')) };
});

/**
 * The local composer slot is a real sessionStorage write, and what these cases are about is
 * *whether it happens at all* — which sitting owns the one slot per workspace. Mocked rather
 * than driven through storage because `currentWorkspace()` is null in a test, so the real
 * module is a no-op and would agree with every hypothesis.
 */
vi.mock('~/features/drafts/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/drafts/local')>();
  return {
    ...actual,
    readIssueComposerDraft: vi.fn(() => null),
    writeIssueComposerDraft: vi.fn(),
  };
});

const filed = vi.mocked(createIssue);
const wroteLocalDraft = vi.mocked(writeIssueComposerDraft);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const DOING = '01900000-0000-7000-8000-000000000004';

const AT = '2026-01-01T00:00:00.000Z';

function state(id: string, name: string, isDefault: boolean): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    category: isDefault ? 'unstarted' : 'started',
    position: 'V',
    isDefault,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
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
      } as Entity,
    ],
    ['workflowState', state(TODO, 'Todo', true)],
    ['workflowState', state(DOING, 'In Progress', false)],
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function renderComposer() {
  const onClose = vi.fn();
  const store = seeded();
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateIssueModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose };
}

/**
 * A composer over a store this test wants to be different — a team that estimates, a label
 * to apply. Written beside `renderComposer` rather than through it, so the cases that were
 * here first keep the fixture they were written against.
 */
function renderVariant(
  options: { team?: Partial<Entity>; rows?: [string, Entity][]; seed?: IssueComposerSeed } = {},
) {
  const onClose = vi.fn();
  const store = seeded();
  const changes: Change[] = [];
  let version = 100;
  const team = store.get('team', TEAM) as Entity;
  if (options.team !== undefined) {
    changes.push({
      v: (version += 1),
      type: 'team',
      id: TEAM,
      op: 'upsert',
      actor: { type: 'system' },
      payload: { ...team, ...options.team },
    } as Change);
  }
  for (const [type, payload] of options.rows ?? []) {
    changes.push({
      v: (version += 1),
      type,
      id: (payload as { id: string }).id,
      op: 'upsert',
      actor: { type: 'system' },
      payload,
    } as Change);
  }
  store.applyChanges(changes);
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateIssueModal onClose={onClose} seed={options.seed} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose };
}

const BUG = '01900000-0000-7000-8000-000000000005';
const CHORE = '01900000-0000-7000-8000-000000000006';
const TEMPLATE = '01900000-0000-7000-8000-000000000007';

function template(id: string, labelIds: string[]): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'Chores',
    title: '',
    body: '',
    properties: { labelIds },
    subIssues: [],
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function label(id: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#ff0000',
    isGroup: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

beforeEach(() => {
  filed.mockClear();
  wroteLocalDraft.mockClear();
});

describe('CreateIssueModal', () => {
  it('files and stays open on "Create more", keeping every property but the words', async () => {
    const { user, onClose } = renderComposer();

    await user.selectOptions(screen.getByLabelText('Status'), DOING);
    await user.selectOptions(screen.getByLabelText('Priority'), '1');
    await user.type(screen.getByLabelText('Title'), 'First');
    await user.click(screen.getByRole('button', { name: 'Create more' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      title: 'First',
      stateId: DOING,
      priority: 1,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');

    // The second issue inherits the properties the first one was given.
    await user.type(screen.getByLabelText('Title'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Create more' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(2));
    expect(filed.mock.calls[1]?.[1]).toMatchObject({
      title: 'Second',
      stateId: DOING,
      priority: 1,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses an empty title without filing anything or closing', async () => {
    const { user, onClose } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Create more' }));

    expect(await screen.findByText('An issue needs a title.')).toBeTruthy();
    expect(filed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * `docs/03-architecture/08-ui-composition.md`: three or more sibling fields all get visible
   * labels. This row is the specimen the rule was written against — eight controls with every
   * label suppressed, reading "No assignee · No priority · No project · No form" and naming
   * none of its own fields.
   *
   * The association is what is asserted rather than the pixels, because that is what a
   * regression would take away: a label reachable by `getByLabelText` is a real `<label for>`
   * on the page, and a trigger whose `aria-describedby` resolves to the word "Project" is a
   * button somebody can find out the meaning of without opening it.
   */
  it('names every property field, rather than showing eight unlabelled controls', () => {
    renderComposer();

    for (const field of ['Team', 'Status', 'Assignee', 'Priority', 'Repeat']) {
      const control = screen.getByLabelText(field) as HTMLSelectElement | HTMLInputElement;
      // `.labels` is the DOM's own answer to "what names this control", so it is only
      // populated by a real `<label for>` — an aria-label would pass `getByLabelText` and
      // leave nothing visible on the page.
      const labels = [...(control.labels ?? [])];
      expect(labels.map((label) => label.textContent?.trim())).toEqual([field]);
    }

    // The menu triggers cannot take a `<label for>` — a button's own text is its name — so
    // they carry the same word as a description, exactly as the detail rail's triggers do.
    for (const [value, field] of [
      ['No project', 'Project'],
      ['No template', 'Template'],
      ['No form', 'Form'],
    ]) {
      const trigger = screen.getByRole('button', { name: value as string });
      const describedBy = trigger.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy as string)?.textContent?.trim()).toBe(field);
    }
  });

  it('closes on an ordinary create, as it always did', async () => {
    const { user, onClose } = renderComposer();

    await user.type(screen.getByLabelText('Title'), 'Only one');
    await user.click(screen.getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(filed).toHaveBeenCalledTimes(1);
  });

  /**
   * Finding 3: the double-submit guard read `saving`, which is state and a frame late — so
   * two ⌘⏎ in one tick, or ⌘⏎ and a click on the button, both passed it and filed two issues
   * with two ids. `createIssue` is optimistic, so both landed in the list.
   *
   * `fireEvent` rather than `userEvent` because the point is two presses inside one tick,
   * which is exactly what `userEvent`'s awaited, act-wrapped clicks cannot produce.
   */
  it('drops a second submit made while the first create is still in flight', async () => {
    let settle: (id: string) => void = () => {};
    filed.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          settle = resolve;
        }),
    );
    const { user } = renderComposer();

    await user.type(screen.getByLabelText('Title'), 'Only once');
    const button = screen.getByRole('button', { name: 'Create issue' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(filed).toHaveBeenCalledTimes(1);
    settle('issue-1');
    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
  });

  /**
   * Finding 27: the footer's "Create issue" is the form's default submit button, so a bare
   * Enter in the title fired implicit submission and shipped a half-written issue on a reflex
   * keystroke. Enter belongs to the composer's own flow — title, then description — and only
   * ⌘⏎ files.
   */
  it('moves Enter from the title into the description instead of filing', async () => {
    const { user, onClose } = renderComposer();

    await user.type(screen.getByLabelText('Title'), 'Half a thought{Enter}');

    expect(filed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText('Description'));
  });

  /**
   * Finding 26: the shell mounts the composer whether or not it is open, so the dialog can
   * play its exit. A shut one must render nothing at all — and, just as importantly, claim
   * none of the chords, which is what would otherwise collide with the next modal to ask for
   * ⌘⏎ in the `modal` context.
   */
  it('renders nothing while it is shut', () => {
    const onClose = vi.fn();
    const store = seeded();
    const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <CreateIssueModal open={false} onClose={onClose} />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * Finding 28: the property grid had no way to set labels, and the only labels an issue
   * could be filed with came from a URL or a template. The trigger carries the chosen
   * labels the way the detail rail's does, so the cell says what it holds before it is opened.
   */
  it('offers a label picker whose trigger names the labels it holds', async () => {
    const { user } = renderVariant({ rows: [['label', label(BUG, 'Bug')]] });

    const trigger = screen.getByRole('button', { name: 'No labels' });
    expect(
      document.getElementById(trigger.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Labels');

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Bug' }));

    expect(await screen.findByRole('button', { name: /Bug/ })).toBeTruthy();
  });

  /**
   * Finding 28, the other half: an estimate control, and only where the team estimates.
   * `none` is a team saying it does not size work, and a points field on such a team can
   * only produce a value nothing will ever read.
   */
  it('shows an estimate control only on a team that estimates', () => {
    renderComposer();
    expect(screen.queryByLabelText('Estimate')).toBeNull();

    cleanup();
    renderVariant({ team: { estimateScale: 'fibonacci' } as Partial<Entity> });
    expect(screen.getByLabelText('Estimate')).toBeTruthy();
  });

  /**
   * Finding 5: there is one `polaris.draft.issue.<ws>` per workspace and it belongs to the
   * blank composer, which is the only sitting that reads it back. A seeded one wrote into it
   * anyway, so following `/new?title=…` — or resuming a saved draft — destroyed the
   * half-written issue somebody had walked away from, without ever offering to restore it.
   */
  it('leaves the local draft slot alone when it opened from a link', async () => {
    const { user } = renderVariant({ seed: { title: 'From a link' } });

    await user.type(screen.getByLabelText('Title'), ' and then some');

    expect(wroteLocalDraft).not.toHaveBeenCalled();
  });

  it('still keeps the local draft slot for a blank composer', async () => {
    const { user } = renderComposer();

    await user.type(screen.getByLabelText('Title'), 'Typed here');

    await waitFor(() => expect(wroteLocalDraft).toHaveBeenCalled());
    expect(wroteLocalDraft.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Typed here' });
  });

  /**
   * Finding 4: the seed's labels were spread first and the template's second, so the later
   * key won and a link that asked for a label filed with the template's instead — silently.
   * A template fills in what was left empty; it does not overrule what was asked for.
   */
  it('keeps the labels a link asked for when a template names others', async () => {
    const { user } = renderVariant({
      rows: [
        ['label', label(BUG, 'Bug')],
        ['label', label(CHORE, 'Chore')],
        ['issueTemplate', template(TEMPLATE, [CHORE])],
      ],
      seed: { title: 'From a link', labelIds: [BUG] },
    });

    await user.click(screen.getByRole('button', { name: 'No template' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Chores' }));
    await user.click(screen.getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ labelIds: [BUG] });
  });
});
