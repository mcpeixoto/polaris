/**
 * The items a right-click on an issue offers, wherever that issue is drawn.
 *
 * Four surfaces show a list of issues and each grew its own context menu, which is how the
 * search results ended up with none at all and the sub-issue panel with no way to change a
 * child's status. What is genuinely the same across all four is the *item list*: the same
 * words, the same order, the same separators, so a person who learns the menu in one place
 * has learned it everywhere.
 *
 * What is genuinely different is everything else — `IssueList` acts on a multi-row selection
 * with permission gates, `Inbox` has a hand-off dance with the row it is leaving, `Search`
 * has rows whose issues are not in the replica at all, and the relations panel builds one
 * menu per row. So this is a builder and not a component: it returns `MenuNode[]` and owns
 * no state, no anchor and no picker. A component that owned all four would take every one of
 * those differences as a prop and be worse than the copies it replaced.
 */

import type { MenuNode } from '~/components';

export type IssuePropertyKind = 'status' | 'assignee' | 'priority' | 'project' | 'labels';

export interface IssueRowMenuTarget {
  /** How many issues the menu acts on. 1 for a single row. */
  readonly count: number;
  /**
   * Whether this client can write these rows at all: in the replica, not archived, and
   * within the viewer's permissions. A search result that only exists on the wire is the
   * case this exists for — there is no local row to patch optimistically.
   */
  readonly editable: boolean;
  /**
   * Whether one status list applies. False when a selection spans teams, because two teams
   * can have two different workflows and there is no single set of states to offer.
   */
  readonly canSetStatus: boolean;
  /** Names the issue when there is exactly one, for "Delete ENG-402". */
  readonly identifier?: string | undefined;
  /** The assignee's name, for "Go to Ada Lovelace's issues". Absent when unassigned. */
  readonly assigneeName?: string | undefined;
  /** The row's labels, for the navigation the chips gave up when they became pickers. */
  readonly labels?: readonly { readonly id: string; readonly name: string }[] | undefined;
}

export interface IssueRowMenuCommands {
  pick(kind: IssuePropertyKind): void;
  open?(): void;
  copyLink?(): void;
  copyIdentifier?(): void;
  goToAssignee?(): void;
  goToLabel?(labelId: string): void;
  askDelete?(): void;
}

/**
 * The chord to draw beside each property, per surface.
 *
 * Supplied by the caller and never defaulted. Only the caller knows what it registered in
 * its own context, and a shared default would print `S` on the sub-issue panel — where `S`
 * is registered but changes the status of the *parent* issue being viewed. A key cap is a
 * promise about what a keystroke does to the thing you are pointing at; this is how the
 * builder avoids making one it cannot keep.
 */
export type IssueRowMenuChords = Readonly<Partial<Record<IssuePropertyKind, string>>>;

const PROPERTIES: readonly { kind: IssuePropertyKind; label: string }[] = [
  { kind: 'status', label: 'Status…' },
  { kind: 'assignee', label: 'Assignee…' },
  { kind: 'priority', label: 'Priority…' },
  { kind: 'project', label: 'Project…' },
  { kind: 'labels', label: 'Labels…' },
];

export function issueRowMenuItems(
  target: IssueRowMenuTarget,
  commands: IssueRowMenuCommands,
  chords: IssueRowMenuChords = {},
): MenuNode[] {
  const items: MenuNode[] = [];

  for (const property of PROPERTIES) {
    const chord = chords[property.kind];
    items.push({
      id: property.kind,
      label: property.label,
      ...(chord === undefined ? {} : { keys: chord }),
      disabled:
        !target.editable || (property.kind === 'status' ? !target.canSetStatus : false),
      onSelect: () => commands.pick(property.kind),
    });
  }

  /*
   * The navigation the label chips and the assignee avatar used to carry. Those are pickers
   * now, so unless it lives here there is no pointer route from a list to a user's issues or
   * to a label's view at all. Load-bearing, not a nicety.
   */
  const navigation: MenuNode[] = [];
  if (commands.goToAssignee !== undefined && target.assigneeName !== undefined) {
    const goToAssignee = commands.goToAssignee;
    navigation.push({
      id: 'go-assignee',
      label: `Go to ${target.assigneeName}'s issues`,
      onSelect: () => goToAssignee(),
    });
  }
  const labels = target.labels ?? [];
  if (commands.goToLabel !== undefined && labels.length > 0) {
    const goToLabel = commands.goToLabel;
    // One label is a row; several are a submenu, because five labels flattened into this
    // menu would bury the commands under them.
    navigation.push(
      labels.length === 1 && labels[0] !== undefined
        ? {
            id: `label-${labels[0].id}`,
            label: `Open label ${labels[0].name}`,
            onSelect: () => goToLabel(labels[0]!.id),
          }
        : {
            kind: 'submenu',
            id: 'labels-nav',
            label: 'Open label',
            items: labels.map((label) => ({
              id: `label-${label.id}`,
              label: label.name,
              onSelect: () => goToLabel(label.id),
            })),
          },
    );
  }
  if (navigation.length > 0) {
    items.push({ kind: 'separator' }, ...navigation);
  }

  const clipboard: MenuNode[] = [];
  if (commands.open !== undefined) {
    const open = commands.open;
    clipboard.push({ id: 'open', label: 'Open issue', onSelect: () => open() });
  }
  if (commands.copyLink !== undefined) {
    const copyLink = commands.copyLink;
    clipboard.push({ id: 'copy-link', label: 'Copy link', onSelect: () => copyLink() });
  }
  if (commands.copyIdentifier !== undefined) {
    const copyIdentifier = commands.copyIdentifier;
    clipboard.push({
      id: 'copy-id',
      label: 'Copy issue ID',
      onSelect: () => copyIdentifier(),
    });
  }
  if (clipboard.length > 0) {
    items.push({ kind: 'separator' }, ...clipboard);
  }

  if (commands.askDelete !== undefined) {
    const askDelete = commands.askDelete;
    items.push(
      { kind: 'separator' },
      {
        id: 'delete',
        label:
          target.count === 1
            ? `Delete ${target.identifier ?? 'issue'}`
            : `Delete ${String(target.count)} issues`,
        danger: true,
        disabled: !target.editable,
        onSelect: () => askDelete(),
      },
    );
  }

  return items;
}
