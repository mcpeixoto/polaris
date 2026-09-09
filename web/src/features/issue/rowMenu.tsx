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

import type { CSSProperties, ReactNode } from 'react';

import {
  Avatar,
  PriorityIcon,
  priorityLabel,
  PRIORITY_LEVELS,
  StateIcon,
  type MenuItem,
  type MenuNode,
  type MenuSubmenu,
} from '~/components';

import {
  ArchiveGlyph,
  BellGlyph,
  BranchGlyph,
  CalendarGlyph,
  CopyGlyph,
  CycleGlyph,
  EstimateGlyph,
  LinkGlyph,
  MilestoneGlyph,
  PencilGlyph,
  PlusGlyph,
  ProjectGlyph,
  StarGlyph,
  SubIssueGlyph,
  TagGlyph,
  TrashGlyph,
  UnassignedGlyph,
} from './glyphs';
import {
  MARK_AS_KINDS,
  type LinkCandidate,
  type MarkAsKind,
  type OfferedMarkAsKind,
} from './relationLinks';

export type { MarkAsKind } from './relationLinks';
import styles from './rowMenu.module.css';

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
  copyTitle?(): void;
  /**
   * The branch name for this issue, in whatever format the workspace configured.
   *
   * Registered as a chord (`issue.copyGitBranchName`) long before it was drawn anywhere, so
   * the only way to reach it was to already know it existed. It is the first thing a lot of
   * people do with an issue, and it belongs beside the other two copies.
   */
  copyGitBranch?(): void;
  /** The issue as a markdown link: `[ENG-12 Ship the importer](https://…)`. */
  copyTitleAsLink?(): void;
  /**
   * Sets a property outright, from a value the surface put in `options`.
   *
   * The nested half of this menu. `pick` hands off to a picker anchored where the menu was;
   * this writes the value the submenu row already stands for, which is the whole reason a
   * cascade is worth having — status in two gestures rather than a menu, a picker and a
   * second aim.
   */
  set?(kind: IssuePropertyKind, value: string | number | null): void;
  /** Applies or removes one label, with the group-mates applying it would displace. */
  toggleLabel?(labelId: string, applied: boolean, displaces: readonly string[]): void;
  /** Opens the composer for a new issue attached to this one. See `RelatedKind`. */
  createRelated?(kind: RelatedKind): void;
  /** Declares a link to an issue that already exists. */
  markAs?(kind: MarkAsKind, otherId: string): void;
  /** A new issue seeded with this one's title, description and properties. */
  makeCopy?(): void;
  /** Puts the caret in the Links panel's URL box. Detail screen only. */
  addLink?(): void;
  /** Puts the caret in the title. Detail screen only. */
  rename?(): void;
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
export type IssueRowMenuChords = Readonly<
  Partial<
    Record<
      | IssuePropertyKind
      | 'subscribe'
      | 'copyGitBranch'
      | 'copyLink'
      | 'rename'
      | 'addLink'
      | 'createSubIssue'
      | 'markBlockedBy'
      | 'markBlocking'
      | 'markRelated',
      string
    >
  >
>;

/** The five things "Create related" can file, each attached to this issue differently. */
export type RelatedKind = 'issue' | 'subIssue' | 'parent' | 'blocked' | 'blocking';

/** One workflow state, as a submenu row. */
export interface StateChoice {
  readonly id: string;
  readonly name: string;
  readonly category: StateCategoryName;
  readonly color?: string | undefined;
}

/** The seven categories, spelled as the store spells them. Kept structural to avoid a cycle. */
type StateCategoryName =
  'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'duplicate';

export interface PersonChoice {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | null | undefined;
}

/** A project, a cycle or a milestone: a name, and the heading it sits under. */
export interface NamedChoice {
  readonly id: string;
  readonly name: string;
  readonly heading?: string | undefined;
  readonly hint?: string | undefined;
  /** The project's own emoji, where it has one. */
  readonly icon?: string | undefined;
}

export interface EstimateChoice {
  readonly value: number | null;
  readonly label: string;
}

/** A relative day the due-date submenu offers: "Today", and the day it resolves to. */
export interface DueChoice {
  readonly id: string;
  readonly label: string;
  readonly date: string;
  readonly hint?: string | undefined;
}

/**
 * One applicable label. Structurally `LabelOption` from `LabelPicker`, restated so this
 * builder does not import a component module to describe its own argument.
 */
export interface LabelChoice {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly applied: boolean;
  readonly displaces: readonly string[];
  readonly displacedNames: readonly string[];
}

export interface LabelChoiceGroup {
  readonly key: string;
  readonly heading: string | null;
  readonly options: readonly LabelChoice[];
}

/**
 * The candidate values a surface can compute from its replica, so the properties become
 * cascades rather than hand-offs.
 *
 * Every field is optional and every one is independent: a surface that can answer "which
 * statuses" but not "which projects" gets a Status submenu and a Project hand-off, which is
 * exactly what the sub-issue panel wants. Omit the argument entirely and the menu is the flat
 * one it has always been — the shape `Search` still needs, because its rows may not be in the
 * replica at all and there is nothing to offer for them.
 */
export interface IssueRowMenuOptions {
  readonly states?: readonly StateChoice[] | undefined;
  readonly stateId?: string | null | undefined;
  readonly priority?: number | undefined;
  readonly people?: readonly PersonChoice[] | undefined;
  readonly assigneeId?: string | null | undefined;
  readonly labels?: readonly LabelChoiceGroup[] | undefined;
  readonly projects?: readonly NamedChoice[] | undefined;
  readonly projectId?: string | null | undefined;
  readonly milestones?: readonly NamedChoice[] | undefined;
  readonly milestoneId?: string | null | undefined;
  readonly cycles?: readonly NamedChoice[] | undefined;
  readonly cycleId?: string | null | undefined;
  readonly estimates?: readonly EstimateChoice[] | undefined;
  readonly estimate?: number | null | undefined;
  readonly dueDates?: readonly DueChoice[] | undefined;
  readonly dueDate?: string | null | undefined;
  /**
   * What "Mark as ▸" is currently offering, for whatever was last typed into one of its
   * filter boxes. One list rather than six because only one submenu is open at a time.
   */
  readonly candidates?: readonly LinkCandidate[] | undefined;
  /** Told what a "Mark as" filter box holds, so the surface can run the search. */
  readonly onSearch?: ((query: string) => void) | undefined;
}

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

/**
 * The same properties in the order Linear draws them once they are cascades.
 *
 * Different from the flat order above, and deliberately: a hand-off list is read as a list of
 * commands, where status, assignee and priority are the three anybody presses; a cascade is
 * read as the issue's own property rail, which is the order the detail screen already uses.
 * Milestone stays at the top level rather than under "More properties" — the rail has it as a
 * property, this menu is the only pointer route to it on a list row, and burying it would make
 * a two-click property a three-click one.
 */
const LINEAR_ORDER: readonly IssuePropertyKind[] = [
  'status',
  'priority',
  'assignee',
  'due',
  'labels',
  'project',
  'estimate',
  'cycle',
  'milestone',
];

const CASCADE_PROPERTIES: readonly PropertySpec[] = LINEAR_ORDER.flatMap((kind) => {
  const found = PROPERTIES.find((property) => property.kind === kind);
  return found === undefined ? [] : [found];
});

/** What each "Mark as" row says, in the first person the reader is standing in. */
const MARK_AS_LABELS: Readonly<Record<OfferedMarkAsKind, string>> = {
  parentOf: 'Parent of…',
  subIssueOf: 'Sub-issue of…',
  related: 'Related to…',
  blockedBy: 'Blocked by…',
  blocking: 'Blocking…',
  duplicateOf: 'Duplicate of…',
};

/** The chord each "Mark as" row may print, where the surface has registered one. */
const MARK_AS_CHORDS: Readonly<Partial<Record<OfferedMarkAsKind, keyof IssueRowMenuChords>>> = {
  blockedBy: 'markBlockedBy',
  blocking: 'markBlocking',
  related: 'markRelated',
};

const CREATE_RELATED: readonly { readonly kind: RelatedKind; readonly label: string }[] = [
  { kind: 'issue', label: 'Issue…' },
  { kind: 'subIssue', label: 'Sub-issue…' },
  { kind: 'parent', label: 'Parent issue…' },
  { kind: 'blocked', label: 'Blocked issue…' },
  { kind: 'blocking', label: 'Blocking issue…' },
];

export function issueRowMenuItems(
  target: IssueRowMenuTarget,
  commands: IssueRowMenuCommands,
  chords: IssueRowMenuChords = {},
  options?: IssueRowMenuOptions,
): MenuNode[] {
  const items: MenuNode[] = [];
  const one = target.count === 1;

  for (const property of options === undefined ? PROPERTIES : CASCADE_PROPERTIES) {
    if (property.when !== undefined && !property.when(target)) continue;
    const chord = chords[property.kind];
    const disabled =
      !target.editable || (property.kind === 'status' ? !target.canSetStatus : false);
    const cascade =
      options === undefined ? undefined : propertySubmenu(property, commands, options, disabled);
    if (cascade !== undefined) {
      items.push({ ...cascade, ...(chord === undefined ? {} : { keys: chord }) });
      continue;
    }
    items.push({
      id: property.kind,
      label: property.label,
      icon: property.icon,
      ...(chord === undefined ? {} : { keys: chord }),
      disabled,
      onSelect: () => commands.pick(property.kind),
    });
  }

  /*
   * The two properties that are not values: a link is a row in another panel and a rename is
   * the title field. Both exist only on the issue's own screen, so the submenu that holds them
   * appears only where the commands do — a list row would offer two items that open nothing.
   */
  const more: MenuNode[] = [];
  if (commands.addLink !== undefined) {
    const addLink = commands.addLink;
    more.push({
      id: 'add-link',
      label: 'Add link…',
      icon: <LinkGlyph />,
      ...(chords.addLink === undefined ? {} : { keys: chords.addLink }),
      disabled: !target.editable,
      onSelect: () => addLink(),
    });
  }
  if (commands.rename !== undefined) {
    const rename = commands.rename;
    more.push({
      id: 'rename',
      label: 'Rename…',
      icon: <PencilGlyph />,
      ...(chords.rename === undefined ? {} : { keys: chords.rename }),
      disabled: !target.editable,
      onSelect: () => rename(),
    });
  }
  if (more.length > 0) {
    items.push({
      kind: 'submenu',
      id: 'more-properties',
      label: 'More properties',
      icon: <EstimateGlyph />,
      items: more,
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

  /*
   * The two halves of "this issue is attached to something": a new issue that will be, and an
   * issue that already is. Both are about one issue by definition — a parent for six selected
   * rows is a decision nobody can express — so both are dropped from a bulk menu rather than
   * silently acting on the row the pointer happened to be over.
   */
  if (commands.createRelated !== undefined && one) {
    const createRelated = commands.createRelated;
    issueActions.push({
      kind: 'submenu',
      id: 'create-related',
      label: 'Create related',
      icon: <PlusGlyph />,
      disabled: !target.editable,
      items: CREATE_RELATED.map((entry) => ({
        id: `create-${entry.kind}`,
        label: entry.label,
        ...(entry.kind === 'subIssue' && chords.createSubIssue !== undefined
          ? { keys: chords.createSubIssue }
          : {}),
        onSelect: () => createRelated(entry.kind),
      })),
    });
  }
  if (commands.markAs !== undefined && options !== undefined && one) {
    const markAs = commands.markAs;
    const candidates = options.candidates ?? [];
    const onSearch = options.onSearch;
    issueActions.push({
      kind: 'submenu',
      id: 'mark-as',
      label: 'Mark as',
      icon: <SubIssueGlyph />,
      disabled: !target.editable,
      items: MARK_AS_KINDS.map((kind): MenuSubmenu => {
        const chordKey = MARK_AS_CHORDS[kind];
        const chord = chordKey === undefined ? undefined : chords[chordKey];
        return {
          kind: 'submenu',
          id: `mark-${kind}`,
          label: MARK_AS_LABELS[kind],
          // The bare word, so the panel this opens is announced as "Blocked by" rather than
          // as "Blocked by ellipsis" — the ellipsis belongs to the row that promises a
          // question, not to the question itself.
          text: MARK_AS_LABELS[kind].replace('…', ''),
          ...(chord === undefined ? {} : { keys: chord }),
          filterable: true,
          filterPlaceholder: 'Search issues…',
          // Not "no matches": an empty box has not been asked anything yet, and telling
          // somebody nothing matched before they typed sends them looking for a filter.
          emptyLabel: 'Search by identifier or title',
          ...(onSearch === undefined ? {} : { onFilterChange: onSearch }),
          items: candidates.map((candidate) => ({
            id: `${kind}-${candidate.id}`,
            label: `${candidate.identifier} ${candidate.title}`,
            icon: <StateIcon category={candidate.category} color={candidate.color} decorative />,
            onSelect: () => markAs(kind, candidate.id),
          })),
        };
      }),
    });
  }

  const copyChildren: MenuNode[] = [];
  if (commands.copyLink !== undefined) {
    const copyLink = commands.copyLink;
    copyChildren.push({
      id: 'copy-link',
      label: 'Copy link',
      icon: <LinkGlyph />,
      ...(chords.copyLink === undefined ? {} : { keys: chords.copyLink }),
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
  if (commands.copyTitle !== undefined && target.count === 1) {
    const copyTitle = commands.copyTitle;
    copyChildren.push({
      id: 'copy-title',
      label: 'Copy title',
      icon: <CopyGlyph />,
      onSelect: () => copyTitle(),
    });
  }
  if (commands.copyTitleAsLink !== undefined && target.count === 1) {
    const copyTitleAsLink = commands.copyTitleAsLink;
    copyChildren.push({
      id: 'copy-title-link',
      // A markdown link, which is what a paste into a pull request, a comment or a chat
      // message wants. "Copy link" is the bare URL and "Copy title" the bare words; this is
      // the one people actually need and the only one they cannot assemble themselves.
      label: 'Copy title as link',
      icon: <LinkGlyph />,
      onSelect: () => copyTitleAsLink(),
    });
  }
  if (commands.copyGitBranch !== undefined && target.count === 1) {
    const copyGitBranch = commands.copyGitBranch;
    copyChildren.push({
      id: 'copy-branch',
      label: 'Copy git branch name',
      icon: <BranchGlyph />,
      ...(chords.copyGitBranch === undefined ? {} : { keys: chords.copyGitBranch }),
      onSelect: () => copyGitBranch(),
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

  if (commands.makeCopy !== undefined && one) {
    const makeCopy = commands.makeCopy;
    issueActions.push({
      id: 'make-copy',
      // Opens the composer with this issue's words and properties in it rather than filing
      // anything: a copy is nearly always a copy with one thing changed, and a menu item that
      // silently created a second identical issue would be a menu item people undo.
      label: 'Make a copy…',
      icon: <CopyGlyph />,
      disabled: !target.editable,
      onSelect: () => makeCopy(),
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

/**
 * The cascade for one property, or nothing when this surface cannot answer for it.
 *
 * "Cannot answer" is the normal case rather than an error: the sub-issue panel offers a
 * status and an assignee and has no project picker at all, and the caller that leaves
 * `projects` out gets the hand-off item it had before. So every branch here is a list the
 * surface put in `options`, and a missing list falls through to `undefined`.
 *
 * The row keeps its `…` label and the panel it opens takes the bare word — `text` is what
 * `Menu` names a submenu by. That is not cosmetic: "Status…" is a promise that something
 * further is being asked, and "Status" is the name of the thing being asked about.
 */
function propertySubmenu(
  property: PropertySpec,
  commands: IssueRowMenuCommands,
  options: IssueRowMenuOptions,
  disabled: boolean,
): MenuSubmenu | undefined {
  const set = commands.set;
  if (set === undefined) return undefined;
  const shell = {
    kind: 'submenu' as const,
    id: property.kind,
    label: property.label,
    text: property.label.replace('…', ''),
    disabled,
  };

  switch (property.kind) {
    case 'status': {
      const states = options.states;
      if (states === undefined || states.length === 0) return undefined;
      const current = states.find((state) => state.id === options.stateId);
      return {
        ...shell,
        icon: (
          <StateIcon category={current?.category ?? 'backlog'} color={current?.color} decorative />
        ),
        emptyLabel: 'This team has no statuses',
        items: states.map((state) => ({
          id: state.id,
          label: state.name,
          icon: <StateIcon category={state.category} color={state.color} decorative />,
          selected: state.id === options.stateId,
          onSelect: () => set('status', state.id),
        })),
      };
    }
    case 'priority':
      return {
        ...shell,
        icon: <PriorityIcon priority={options.priority ?? 0} decorative />,
        items: PRIORITY_LEVELS.map((priority) => ({
          id: `priority-${String(priority)}`,
          label: priorityLabel(priority),
          icon: <PriorityIcon priority={priority} decorative />,
          selected: priority === options.priority,
          onSelect: () => set('priority', priority),
        })),
      };
    case 'assignee': {
      const people = options.people;
      if (people === undefined) return undefined;
      const current = people.find((person) => person.id === options.assigneeId);
      return {
        ...shell,
        icon:
          current === undefined ? (
            <UnassignedGlyph />
          ) : (
            <Avatar
              name={current.name}
              src={current.avatarUrl}
              size="xs"
              colorKey={current.id}
              decorative
            />
          ),
        filterable: true,
        filterPlaceholder: 'Assign to…',
        emptyLabel: 'No matching people',
        items: [
          {
            id: 'assignee-none',
            label: 'No assignee',
            // The words somebody types when they mean this row, none of which is its label.
            text: 'No assignee nobody none clear unassigned',
            icon: <UnassignedGlyph />,
            selected: options.assigneeId === null,
            onSelect: () => set('assignee', null),
          },
          { kind: 'separator' },
          ...people.map((person) => ({
            id: person.id,
            label: person.name,
            icon: (
              <Avatar
                name={person.name}
                src={person.avatarUrl}
                size="xs"
                colorKey={person.id}
                decorative
              />
            ),
            selected: person.id === options.assigneeId,
            onSelect: () => set('assignee', person.id),
          })),
        ],
      };
    }
    case 'due': {
      const relatives = options.dueDates;
      if (relatives === undefined || relatives.length === 0) return undefined;
      return {
        ...shell,
        icon: <CalendarGlyph />,
        items: [
          ...relatives.map((relative) => ({
            id: relative.id,
            label: relative.label,
            ...(relative.hint === undefined ? {} : { hint: relative.hint }),
            selected: relative.date === options.dueDate,
            onSelect: () => set('due', relative.date),
          })),
          { kind: 'separator' as const },
          {
            id: 'due-none',
            label: 'No due date',
            selected: options.dueDate === null,
            onSelect: () => set('due', null),
          },
          {
            // The one row that is a hand-off rather than a value: a calendar is a panel, not a
            // list, and `DueDatePicker` is the panel every other surface already opens.
            id: 'due-custom',
            label: 'Custom date…',
            onSelect: () => commands.pick('due'),
          },
        ],
      };
    }
    case 'labels': {
      const groups = options.labels;
      const toggle = commands.toggleLabel;
      if (groups === undefined || toggle === undefined) return undefined;
      const items: MenuNode[] = [];
      for (const group of groups) {
        if (group.heading !== null) items.push({ kind: 'heading', label: group.heading });
        for (const option of group.options) {
          items.push({
            id: option.id,
            label: option.name,
            // The group's name matches too, so typing "priority" narrows to that group's
            // labels rather than to the one label somebody happened to call Priority.
            text: group.heading === null ? option.name : `${group.heading} ${option.name}`,
            icon: (
              <span
                className={styles.swatch}
                // Inline because the value is workspace data, not design; the stylesheet reads
                // it back through the custom property, exactly as LabelChip does.
                style={{ '--label-color': option.color } as CSSProperties}
              />
            ),
            selected: option.applied,
            ...(option.displacedNames.length === 0
              ? {}
              : { hint: `Replaces ${option.displacedNames.join(', ')}` }),
            onSelect: () => toggle(option.id, option.applied, option.displaces),
          });
        }
      }
      return {
        ...shell,
        icon: <TagGlyph />,
        filterable: true,
        filterPlaceholder: 'Add labels…',
        emptyLabel: items.length === 0 ? 'No labels for this team yet' : 'No labels match',
        items,
      };
    }
    case 'project': {
      const projects = options.projects;
      if (projects === undefined) return undefined;
      return {
        ...shell,
        icon: <ProjectGlyph />,
        filterable: true,
        filterPlaceholder: 'Add to project…',
        emptyLabel: 'No matching project',
        items: [
          {
            id: 'project-none',
            label: 'No project',
            selected: options.projectId === null,
            onSelect: () => set('project', null),
          },
          ...headed(projects, (project) => ({
            id: project.id,
            label: project.name,
            ...(project.hint === undefined ? {} : { hint: project.hint }),
            selected: project.id === options.projectId,
            onSelect: () => set('project', project.id),
          })),
        ],
      };
    }
    case 'cycle': {
      const cycles = options.cycles;
      if (cycles === undefined) return undefined;
      return {
        ...shell,
        icon: <CycleGlyph />,
        emptyLabel: 'No cycles yet',
        items: [
          {
            id: 'cycle-none',
            label: 'No cycle',
            selected: options.cycleId === null,
            onSelect: () => set('cycle', null),
          },
          ...headed(cycles, (cycle) => ({
            id: cycle.id,
            label: cycle.name,
            ...(cycle.hint === undefined ? {} : { hint: cycle.hint }),
            selected: cycle.id === options.cycleId,
            onSelect: () => set('cycle', cycle.id),
          })),
        ],
      };
    }
    case 'milestone': {
      const milestones = options.milestones;
      if (milestones === undefined || milestones.length === 0) return undefined;
      return {
        ...shell,
        icon: <MilestoneGlyph />,
        items: [
          {
            id: 'milestone-none',
            label: 'No milestone',
            selected: options.milestoneId === null,
            onSelect: () => set('milestone', null),
          },
          ...milestones.map((milestone) => ({
            id: milestone.id,
            label: milestone.name,
            selected: milestone.id === options.milestoneId,
            onSelect: () => set('milestone', milestone.id),
          })),
        ],
      };
    }
    case 'estimate': {
      const estimates = options.estimates;
      if (estimates === undefined || estimates.length === 0) return undefined;
      return {
        ...shell,
        icon: <EstimateGlyph />,
        items: estimates.map((estimate) => ({
          // "No estimate" is a word rather than a number, because none is not zero — the same
          // distinction `EstimatePicker` is built around.
          id: estimate.value === null ? 'unestimated' : `estimate-${String(estimate.value)}`,
          label: estimate.label,
          selected: estimate.value === options.estimate,
          onSelect: () => set('estimate', estimate.value),
        })),
      };
    }
    default:
      return undefined;
  }
}

/** Rows with a heading above each run of them, the way the pickers group their own lists. */
function headed(rows: readonly NamedChoice[], toItem: (row: NamedChoice) => MenuItem): MenuNode[] {
  const out: MenuNode[] = [];
  let previous: string | undefined;
  for (const row of rows) {
    if (row.heading !== undefined && row.heading !== previous) {
      out.push({ kind: 'heading', label: row.heading });
      previous = row.heading;
    }
    out.push(toItem(row));
  }
  return out;
}
