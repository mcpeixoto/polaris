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

import type { ReactNode } from 'react';

import { PriorityIcon, StateIcon, type MenuNode } from '~/components';

import {
  ArchiveGlyph,
  BellGlyph,
  CalendarGlyph,
  CopyGlyph,
  CycleGlyph,
  EstimateGlyph,
  LinkGlyph,
  MilestoneGlyph,
  ProjectGlyph,
  StarGlyph,
  TagGlyph,
  TrashGlyph,
  UnassignedGlyph,
} from './glyphs';

export type IssuePropertyKind =
  | 'status'
  | 'assignee'
  | 'priority'
  | 'estimate'
  | 'due'
  | 'cycle'
  | 'project'
  | 'labels'
  | 'milestone';

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
  /**
   * Whether estimate is a real property on these rows. Teams that do not estimate omit the
   * row rather than offering a control that writes a value nothing will read.
   */
  readonly estimates?: boolean | undefined;
  /** Whether any of the rows belong to a team that runs cycles. */
  readonly cycles?: boolean | undefined;
  /**
   * Whether a milestone picker can apply. Opt-in: a milestone is a marker inside a project,
   * and most list surfaces have no picker for it yet.
   */
  readonly milestone?: boolean | undefined;
  /** Whether the single row is already on the viewer's watch list. */
  readonly subscribed?: boolean | undefined;
  /** Whether the single row is already in the viewer's favourites. */
  readonly favorited?: boolean | undefined;
}

export interface IssueRowMenuCommands {
  pick(kind: IssuePropertyKind): void;
  open?(): void;
  openInPeek?(): void;
  copyLink?(): void;
  copyIdentifier?(): void;
  goToAssignee?(): void;
  goToLabel?(labelId: string): void;
  toggleSubscribe?(): void;
  toggleFavorite?(): void;
  askArchive?(): void;
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
export type IssueRowMenuChords = Readonly<Partial<Record<IssuePropertyKind | 'subscribe', string>>>;

interface PropertySpec {
  readonly kind: IssuePropertyKind;
  readonly label: string;
  readonly icon: ReactNode;
  readonly when?: (target: IssueRowMenuTarget) => boolean;
}

const PROPERTIES: readonly PropertySpec[] = [
  {
    kind: 'status',
    label: 'Status…',
    icon: <StateIcon category="backlog" decorative />,
  },
  {
    kind: 'assignee',
    label: 'Assignee…',
    icon: <UnassignedGlyph />,
  },
  {
    kind: 'priority',
    label: 'Priority…',
    icon: <PriorityIcon priority={0} decorative />,
  },
  {
    kind: 'estimate',
    label: 'Estimate…',
    icon: <EstimateGlyph />,
    when: (target) => target.estimates !== false,
  },
  {
    kind: 'due',
    label: 'Due date…',
    icon: <CalendarGlyph />,
  },
  {
    kind: 'cycle',
    label: 'Cycle…',
    icon: <CycleGlyph />,
    when: (target) => target.cycles !== false,
  },
  {
    kind: 'project',
    label: 'Project…',
    icon: <ProjectGlyph />,
  },
  {
    kind: 'labels',
    label: 'Labels…',
    icon: <TagGlyph />,
  },
  {
    kind: 'milestone',
    label: 'Milestone…',
    icon: <MilestoneGlyph />,
    when: (target) => target.milestone === true,
  },
];

export function issueRowMenuItems(
  target: IssueRowMenuTarget,
  commands: IssueRowMenuCommands,
  chords: IssueRowMenuChords = {},
): MenuNode[] {
  const items: MenuNode[] = [];

  for (const property of PROPERTIES) {
    if (property.when !== undefined && !property.when(target)) continue;
    const chord = chords[property.kind];
    items.push({
      id: property.kind,
      label: property.label,
      icon: property.icon,
      ...(chord === undefined ? {} : { keys: chord }),
      disabled: !target.editable || (property.kind === 'status' ? !target.canSetStatus : false),
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

  const issueActions: MenuNode[] = [];
  if (commands.open !== undefined) {
    const open = commands.open;
    issueActions.push({ id: 'open', label: 'Open issue', onSelect: () => open() });
  }
  if (commands.openInPeek !== undefined) {
    const openInPeek = commands.openInPeek;
    issueActions.push({
      id: 'open-peek',
      label: 'Open in peek',
      onSelect: () => openInPeek(),
    });
  }

  const copyChildren: MenuNode[] = [];
  if (commands.copyLink !== undefined) {
    const copyLink = commands.copyLink;
    copyChildren.push({
      id: 'copy-link',
      label: 'Copy link',
      icon: <LinkGlyph />,
      onSelect: () => copyLink(),
    });
  }
  if (commands.copyIdentifier !== undefined) {
    const copyIdentifier = commands.copyIdentifier;
    copyChildren.push({
      id: 'copy-id',
      label: 'Copy issue ID',
      icon: <CopyGlyph />,
      onSelect: () => copyIdentifier(),
    });
  }
  if (copyChildren.length === 1 && copyChildren[0] !== undefined) {
    issueActions.push(copyChildren[0]);
  } else if (copyChildren.length > 1) {
    issueActions.push({
      kind: 'submenu',
      id: 'copy',
      label: 'Copy',
      icon: <CopyGlyph />,
      items: copyChildren,
    });
  }

  if (commands.toggleSubscribe !== undefined && target.count === 1) {
    const toggleSubscribe = commands.toggleSubscribe;
    const subscribed = target.subscribed === true;
    issueActions.push({
      id: 'subscribe',
      label: subscribed ? 'Unsubscribe' : 'Subscribe',
      icon: <BellGlyph />,
      ...(chords.subscribe === undefined ? {} : { keys: chords.subscribe }),
      disabled: !target.editable,
      onSelect: () => toggleSubscribe(),
    });
  }
  if (commands.toggleFavorite !== undefined && target.count === 1) {
    const toggleFavorite = commands.toggleFavorite;
    const favorited = target.favorited === true;
    issueActions.push({
      id: 'favorite',
      label: favorited ? 'Remove from favourites' : 'Add to favourites',
      icon: <StarGlyph on={favorited} />,
      disabled: !target.editable,
      onSelect: () => toggleFavorite(),
    });
  }

  if (issueActions.length > 0) {
    items.push({ kind: 'separator' }, ...issueActions);
  }

  const lifecycle: MenuNode[] = [];
  if (commands.askArchive !== undefined) {
    const askArchive = commands.askArchive;
    // Archive is the one people actually want and Delete is the one they can reach, which is
    // how a list ends up with issues deleted that were only finished. Both surfaces already
    // had the confirm dialogue and the undo offer behind `askArchive`; only the row was
    // missing.
    lifecycle.push({
      id: 'archive',
      label:
        target.count === 1
          ? `Archive ${target.identifier ?? 'issue'}`
          : `Archive ${String(target.count)} issues`,
      icon: <ArchiveGlyph />,
      disabled: !target.editable,
      onSelect: () => askArchive(),
    });
  }
  if (commands.askDelete !== undefined) {
    const askDelete = commands.askDelete;
    lifecycle.push({
      id: 'delete',
      label:
        target.count === 1
          ? `Delete ${target.identifier ?? 'issue'}`
          : `Delete ${String(target.count)} issues`,
      icon: <TrashGlyph />,
      danger: true,
      disabled: !target.editable,
      onSelect: () => askDelete(),
    });
  }
  if (lifecycle.length > 0) {
    items.push({ kind: 'separator' }, ...lifecycle);
  }

  return items;
}
