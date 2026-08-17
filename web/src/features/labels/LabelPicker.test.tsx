/**
 * The label picker, driven the way a person drives it.
 *
 * The claim under test is the one the refactor was for: this component chooses labels and
 * does not know what it is choosing them *for*. So every case here is run twice where it
 * costs nothing — once with the chosen ids coming out of the replica, the way an issue
 * screen supplies them, and once with the chosen ids in a plain `useState`, the way a
 * template editor or a create form supplies them. If the two ever diverge, the component has
 * quietly grown an opinion about issues again, which is exactly what it used to have and
 * exactly what made it unusable anywhere else.
 *
 * Everything runs against a real `Store` with no database behind it, as `pickers.test.tsx`
 * does: mocking the store would mean asserting that the component asked a mock a question,
 * and the questions are the part most likely to be wrong.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { Store, type Change, type Issue, type IssueLabel, type Label, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { LabelPicker } from './LabelPicker';

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const PLAT = 'team-plat';
const AT = '2026-01-01T00:00:00Z';

function label(id: string, name: string, over: Partial<Label> = {}): Label {
  return {
    id,
    workspaceId: WORKSPACE,
    isGroup: false,
    name,
    color: '#6b7280',
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function issue(id: string, teamId: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the importer',
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function applied(id: string, issueId: string, labelId: string, teamId: string): IssueLabel {
  return { id, workspaceId: WORKSPACE, issueId, labelId, teamId, createdAt: AT };
}

/**
 * The workspace's labels: one loose workspace label, one loose label per team, and a
 * "Priority" group with two mutually exclusive members.
 *
 * Deliberately not the minimum. The offering rule, the heading rule and the displacement rule
 * are each simple alone and only ever wrong in combination — a picker that filters by team
 * correctly and then loses the group headings looks fine in a test that has one label.
 */
const LABELS: readonly Label[] = [
  label('l-bug', 'Bug'),
  label('l-eng', 'Flaky', { teamId: ENG }),
  label('l-plat', 'Infra', { teamId: PLAT }),
  label('l-prio', 'Priority', { isGroup: true }),
  label('l-p0', 'P0', { parentId: 'l-prio' }),
  label('l-p1', 'P1', { parentId: 'l-prio' }),
];

type Seeded = Label | Issue | IssueLabel;

function changes(entities: readonly Seeded[], type: string, from: number): Change[] {
  return entities.map((entity, index) => ({
    v: from + index,
    type,
    id: entity.id,
    op: 'upsert' as const,
    actor: { type: 'system' as const },
    payload: entity,
  })) as Change[];
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(changes(LABELS, 'label', 1));
  store.applyChanges(changes([issue('issue-1', ENG)], 'issue', 100));
  return store;
}

function withStore(store: Store, children: ReactNode) {
  const engine = { store } as unknown as SyncEngine;
  return (
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      {children}
    </EngineProvider>
  );
}

interface Chosen {
  readonly onApply: ReturnType<typeof vi.fn>;
  readonly onRemove: ReturnType<typeof vi.fn>;
}

/**
 * A trigger and the picker under it, wired the way a call site wires them.
 *
 * The `value` is a prop and not state, so a test can assert what the picker was *given*
 * without a write having to land first — which is the whole distinction the refactor drew.
 */
function Harness({
  store,
  teamId,
  value,
  spies,
}: {
  store: Store;
  teamId: UUID | null;
  value: readonly UUID[];
  spies: Chosen;
}) {
  const trigger = useMenuTrigger();
  return withStore(
    store,
    <>
      <button {...trigger.props}>Open</button>
      <LabelPicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        teamId={teamId}
        value={value}
        onApply={spies.onApply}
        onRemove={spies.onRemove}
      />
    </>,
  );
}

function mount(value: readonly UUID[] = [], teamId: UUID | null = ENG, store: Store = seeded()) {
  const spies: Chosen = { onApply: vi.fn(), onRemove: vi.fn() };
  render(<Harness store={store} teamId={teamId} value={value} spies={spies} />);
  return { ...spies, store, user: userEvent.setup() };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

/** Every choosable row, in the order the menu draws them. */
function offered(): string[] {
  return screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
}

describe('LabelPicker', () => {
  it("offers the workspace's labels and this team's, and never another team's", async () => {
    const { user } = mount();
    await open(user);

    // "Infra" belongs to PLAT. Not offered rather than offered-and-refused: a label that is
    // not in the list is a rule nobody has to learn.
    expect(offered()).toEqual(['Bug', 'Flaky', 'P0', 'P1']);
    expect(screen.queryByRole('menuitem', { name: 'Infra' })).toBeNull();
  });

  it('makes a group a heading and never an item, because a group cannot be applied', async () => {
    const { user } = mount();
    await open(user);

    expect(screen.getByRole('group', { name: 'Priority' })).toBeTruthy();
    // Not a disabled item either, which would only invite the click that fails.
    expect(screen.queryByRole('menuitem', { name: 'Priority' })).toBeNull();
  });

  it('ticks what it was given and takes it off when chosen again', async () => {
    const { onApply, onRemove, user } = mount(['l-bug']);
    await open(user);

    expect(screen.getByRole('menuitem', { name: 'Bug' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Flaky' }).getAttribute('aria-current')).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: 'Bug' }));

    expect(onRemove).toHaveBeenCalledWith('l-bug');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('names the group-mate a choice would displace, and hands it to the caller to remove', async () => {
    const { onApply, user } = mount(['l-p0']);
    await open(user);

    // Said before it is chosen. The swap is the product; a swap the user notices afterwards
    // is a bug report.
    expect(screen.getByRole('menuitem', { name: /P1/ }).textContent).toContain('Replaces P0');

    await user.click(screen.getByRole('menuitem', { name: /P1/ }));

    expect(onApply).toHaveBeenCalledWith('l-p1', ['l-p0']);
  });

  it('displaces nothing when no group-mate is chosen', async () => {
    const { onApply, user } = mount([]);
    await open(user);

    await user.click(screen.getByRole('menuitem', { name: /P1/ }));

    expect(onApply).toHaveBeenCalledWith('l-p1', []);
  });

  it('offers only the workspace labels when there is no team to file it in', async () => {
    const { user } = mount([], null);
    await open(user);

    // A workspace-scoped template has no team, so a team's label would be one it could never
    // legally carry.
    expect(offered()).toEqual(['Bug', 'P0', 'P1']);
  });

  it('says a workspace with no labels is empty rather than saying nothing matched', async () => {
    const { user } = mount([], ENG, new Store(WORKSPACE));
    await open(user);

    expect(screen.getByText('No labels for this team yet')).toBeTruthy();
  });
});

/**
 * The two callers, side by side.
 *
 * This is the test the refactor exists for. Before it, the second of these could not be
 * written at all: the picker read the ticked set out of `store.labelIdsFor(issueId)`, so
 * choosing labels for something that was not yet an issue produced an empty menu against an
 * issue that did not exist.
 */
describe('LabelPicker · the same menu for an issue and for something that is not one yet', () => {
  /** What an issue screen does: the ticks come from the replica, the choice becomes a write. */
  function IssueBackedCaller({ store, onWrite }: { store: Store; onWrite: (id: UUID) => void }) {
    const trigger = useMenuTrigger();
    const chosen = [...store.labelIdsFor('issue-1')];
    return withStore(
      store,
      <>
        <button {...trigger.props}>Open</button>
        <LabelPicker
          open={trigger.open}
          onClose={trigger.hide}
          trigger={trigger.ref}
          teamId={ENG}
          value={chosen}
          onApply={(labelId) => onWrite(labelId)}
          onRemove={(labelId) => onWrite(labelId)}
        />
      </>,
    );
  }

  /** What a form does: the ticks are its own state, and there is no issue anywhere. */
  function FormCaller({ store }: { store: Store }) {
    const trigger = useMenuTrigger();
    const [labelIds, setLabelIds] = useState<readonly UUID[]>([]);
    return withStore(
      store,
      <>
        <button {...trigger.props}>Open</button>
        <p>Chosen: {labelIds.join(', ')}</p>
        <LabelPicker
          open={trigger.open}
          onClose={trigger.hide}
          trigger={trigger.ref}
          teamId={ENG}
          value={labelIds}
          onApply={(labelId, displaced) =>
            setLabelIds((held) => [...held.filter((id) => !displaced.includes(id)), labelId])
          }
          onRemove={(labelId) => setLabelIds((held) => held.filter((id) => id !== labelId))}
        />
      </>,
    );
  }

  it('reads the ticks out of the replica for a caller that has an issue', async () => {
    const store = seeded();
    store.applyChanges(changes([applied('il-1', 'issue-1', 'l-bug', ENG)], 'issueLabel', 200));
    const onWrite = vi.fn();
    const user = userEvent.setup();

    render(<IssueBackedCaller store={store} onWrite={onWrite} />);
    await open(user);

    expect(screen.getByRole('menuitem', { name: 'Bug' }).getAttribute('aria-current')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: 'Flaky' }));
    expect(onWrite).toHaveBeenCalledWith('l-eng');
  });

  it('drives a caller holding its own state, with no issue in the replica at all', async () => {
    // Labels only. Nothing here is an issue, which is precisely the situation a template
    // editor and a create form are both in.
    const store = new Store(WORKSPACE);
    store.applyChanges(changes(LABELS, 'label', 1));
    const user = userEvent.setup();

    render(<FormCaller store={store} />);

    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'P0' }));
    expect(screen.getByText('Chosen: l-p0')).toBeTruthy();

    // And the group rule holds without a database to enforce it: choosing P1 swaps P0 out,
    // because the picker told the caller which id to drop.
    await open(user);
    expect(screen.getByRole('menuitem', { name: 'P0' }).getAttribute('aria-current')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: /P1/ }));
    expect(screen.getByText('Chosen: l-p1')).toBeTruthy();
  });
});
