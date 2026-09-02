/**
 * The filter bar: a `FilterNode` rendered as a row of chips somebody can read, and edited
 * in place.
 *
 * The bar is a *view over the AST* and holds none of it. Every edit — a value ticked, an
 * operator changed, a chip removed — is a new tree handed straight to `onChange`, which in
 * the issue list is `useView`'s `setFilter` and therefore the URL. Nothing is buffered and
 * nothing is debounced: `useView` explains why, and the short version is that a four-clause
 * filter over five thousand issues costs well under a millisecond, so a debounce would add
 * latency to hide a cost that is not there. The only local state here is what cannot be
 * expressed in the grammar at all — which chip is being edited, what has been typed into a
 * picker's search box, and a half-typed number that is not yet a number.
 *
 * Two consequences of the grammar shape everything below and are worth knowing before
 * editing:
 *
 * **A clause must never be emitted invalid.** `validate.ts` rejects rather than repairs, so
 * an AST this bar emits with, say, `assignee eq` and no value would be written to the URL,
 * fail to parse on the way back, and turn the user's list into an error message. The only
 * shape the grammar has for "no value chosen yet" is `in []` — which is why a newly added
 * uuid clause is `in`, and why an operator that needs exactly one value is offered only
 * when there is a value to give it.
 *
 * **Ids are never shown.** A clause holds uuids; a person reads names. Every uuid in the
 * tree is resolved against the store, and an id that resolves to nothing reads as "an
 * unknown status" rather than as forty hex characters — an entity can legitimately be
 * missing here, because the replica may not have synced it or the viewer may not be allowed
 * to see it.
 *
 * On the keyboard: this file owns no key handler, because the keyboard belongs to the
 * registry in web/src/keys. Two bindings are registered — `F` in the `list` context, which
 * opens the field menu, and Escape in `menu`, which closes the clause editor. The bar pushes
 * `menu` while an editor is open, and that push is doing a second job as well: `menu` is
 * sealed, so `J`, `K` and the `F` above stop reaching the list underneath while somebody is
 * ticking boxes in a popover over it.
 *
 * That registration is also the one thing a caller has to know: an action id is claimed
 * once, so two of these mounted at the same time is a startup error rather than a subtle
 * one. One bar per screen, which is what a filter bar is anyway — the same constraint the
 * issue list's own eleven actions carry.
 */

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  Checkbox,
  IconButton,
  Input,
  Menu,
  PriorityIcon,
  priorityLabel,
  PRIORITY_LEVELS,
  Select,
  StateIcon,
  STATE_LABELS,
  Tooltip,
  type MenuNode,
} from '~/components';
import { formatCustomerStatus } from '~/features/customers/mutations';
import { browserTimezone } from '~/features/locale';
import { usePresence, type ExitProps } from '~/hooks/usePresence';
import { whenDay } from '~/features/time';
import {
  CUSTOMER_STATUSES,
  EMPTY_FILTER,
  FILTER_FIELDS,
  FILTER_OPS,
  isFilterClause,
  isFilterOp,
  isFilterGroup,
  isStateCategory,
  isRelativeToken,
  operatorApplies,
  RELATIVE_KEYWORDS,
  takesNoValues,
  takesSingleValue,
  type FilterClause,
  type FilterField,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterValueType,
  type RelativeKeyword,
} from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer } from '~/hooks/useViewer';
import {
  CATEGORY_ORDER,
  type EntityType,
  type StateCategory,
  type Store,
  type UUID,
  type WorkflowState,
} from '~/store';

import styles from './FilterBar.module.css';

export interface FilterBarProps {
  /**
   * The filter as it stands. A clause at the top level is legal in the grammar and is
   * wrapped in a group for rendering, so callers do not have to normalise first.
   */
  readonly filter: FilterNode;
  /** Called with a whole new tree. Never called with a filter `validateFilter` would reject. */
  readonly onChange: (next: FilterNode) => void;
  /**
   * The team whose statuses and labels are on offer, when there is one.
   *
   * Absent is the search screen, which spans the workspace: every team's statuses and
   * labels are then offered, each named by its team. It is not a filter on the *results* —
   * that is a `team` clause, which the user can add like any other.
   */
  readonly teamId?: UUID | undefined;
  /**
   * Set when the link carried a filter this build could not read. See `parseFilterParam`:
   * it reports rather than throws, precisely so this bar can say so and offer a way out.
   */
  readonly error?: string | null | undefined;
  /**
   * The zone a due date is reckoned in — the team's, not the reader's, or two people
   * looking at one board disagree about which day "today" was. Defaults to the browser's,
   * which is the right answer for a search across teams.
   */
  readonly timezone?: string | undefined;
  readonly className?: string | undefined;
}

/** Where a node sits in the tree: the index at each level, outermost first. */
type Path = readonly number[];

/** The entity types a chip's wording or a picker's options can depend on. */
const OPTION_DEPS: readonly EntityType[] = [
  'workflowState',
  'user',
  'label',
  'team',
  'issue',
  'customer',
  'customerRequest',
  'workspace',
];

/**
 * How many issues an issue picker offers at once.
 *
 * An issue field is the one uuid picker whose candidate set is the whole corpus, and Menu
 * and this list alike render every option they are given. Fifty is more than anybody scans;
 * past that the answer is to type into the search box, which is why there is one.
 */
const MAX_ISSUE_OPTIONS = 50;

export function FilterBar({
  filter,
  onChange,
  teamId,
  error = null,
  timezone,
  className,
}: FilterBarProps) {
  const zone = timezone ?? browserTimezone();
  const viewer = useViewer();
  const hideCustomers = viewer === null || viewer.role === 'guest';
  const root = useMemo(() => asGroup(filter), [filter]);
  const nodes = root.nodes ?? [];

  /** Which chip has its editor open, as a path key. At most one at a time, like a menu. */
  const [editing, setEditing] = useState<string | null>(null);
  const names = useEntityMarks(root);
  const add = useMenuTrigger();
  // The same list of fields, opened from inside a bracket. A second trigger rather than a
  // second menu's worth of items: which group the clause lands in is the only difference,
  // and it is held in a ref because it is answered by the click, not by a render.
  const into = useMenuTrigger();
  const intoPath = useRef<Path>([]);
  const intoAnchor = useRef<HTMLElement | null>(null);

  // Sealed while an editor is open, so the list underneath stops treating letters typed at
  // a popover as its own shortcuts, and so the Escape below wins over the shell's dismiss.
  useKeyContext('menu', editing !== null);

  // The registry captures `run` and `enabled` once, at registration, so the current value has
  // to be reachable through a ref rather than closed over.
  const open = useRef(false);
  open.current = editing !== null;

  // Reached the same way, though `useMenuTrigger` promises `show` is stable for exactly this
  // reason. The ref is what makes that a local fact rather than a dependency on somebody
  // else's `useCallback` deps staying empty, which is not a promise a registration made once
  // at mount can check.
  const showAdd = useRef(add.show);
  showAdd.current = add.show;

  useActions(
    [
      {
        id: 'filterBar.add',
        title: 'Filter',
        keys: ['f'],
        // `list`, not `menu`: F opens the add menu from the list, and while a popover is up
        // the letter belongs to whatever box is being typed into.
        when: 'list',
        group: 'Filters',
        run: () => showAdd.current(),
      },
      {
        id: 'filterBar.closeEditor',
        title: 'Close the filter editor',
        keys: ['Escape'],
        when: 'menu',
        group: 'Filters',
        // Hidden from the command menu: "close the thing that is open" is not something
        // anybody searches for, and it still appears in the help overlay.
        hidden: true,
        // Guarded rather than relying on this component being the only thing in `menu`. It is
        // not: the context is sealed and shared by every popover on the screen, so the
        // display panel is in it too. A disabled action is treated as unbound, which is what
        // lets both of them own Escape and only the open one answer for it.
        enabled: () => open.current,
        run: () => setEditing(null),
      },
    ],
    [],
  );

  const replace = (path: Path, next: FilterNode) => onChange(replaceAt(root, path, next));

  const remove = (path: Path) => {
    // Paths are positions, so removing a node renumbers everything after it. Closing the
    // editor is cheaper than reindexing it onto whichever clause has moved into its place.
    setEditing(null);
    onChange(removeAt(root, path));
  };

  /**
   * Flips one group's conjunction, at any depth.
   *
   * Per group rather than per filter, which is the difference between "and/or" being a
   * switch on the bar and it being the grammar the bar renders: `(A or B) and C` has two
   * conjunctions, the brackets on screen say so, and a control that rewrote both of them
   * from either bracket would silently change the half nobody was pointing at.
   */
  const toggleConjunction = (path: Path) => {
    const group = groupAt(root, path);
    if (group === null) return;
    const next: FilterGroup = { ...group, conj: (group.conj ?? 'and') === 'and' ? 'or' : 'and' };
    if (path.length === 0) onChange(next);
    else replace(path, next);
  };

  /**
   * Adds a clause to a group, and opens its editor.
   *
   * The path is the bar's own row by default and a bracket when the plus inside one was
   * used. Both exist now that brackets can be made here: an empty group nobody can put a
   * clause into is not an advanced filter, it is a pair of parentheses somebody is stuck
   * with.
   */
  const addClause = (field: FilterField, path: Path = []) => {
    const group = groupAt(root, path) ?? root;
    const siblings = group.nodes ?? [];
    const next: FilterGroup = { ...group, nodes: [...siblings, newClause(field)] };
    if (path.length === 0) onChange(next);
    else replace(path, next);
    setEditing(pathKey([...path, siblings.length]));
  };

  const openAddInto = (path: Path, anchor: HTMLElement) => {
    intoPath.current = path;
    intoAnchor.current = anchor;
    into.show();
  };

  const fieldItems = (target: Path | null): MenuNode[] => {
    const items: MenuNode[] = [];
    for (const group of fieldGroups(hideCustomers)) {
      items.push({ kind: 'heading', label: group.heading });
      for (const field of group.fields) {
        items.push({
          id: field,
          label: FIELD_LABELS[field],
          hint: FIELD_HINTS[field],
          onSelect: () => addClause(field, target ?? intoPath.current),
        });
      }
    }
    return items;
  };

  /**
   * Wraps what is there into a bracket, and opens a second one beside it.
   *
   * This is the only way to *make* a nested group from the interface, and it is deliberately
   * one shape rather than a builder: "(what I have) and ()" is the step somebody is taking
   * when they reach for an advanced filter — they have a filter that is nearly right and
   * they want an alternative beside it — and the two conjunction buttons it leaves on screen
   * are what turn that shape into every other one.
   *
   * The empty sibling matters: an AND over nothing is vacuously true, so the filter it
   * produces matches exactly what it did a moment before, and nothing on screen jumps while
   * the user decides what goes in the new bracket.
   */
  const addGroup = () => {
    const inner: FilterGroup = { conj: root.conj ?? 'and', nodes };
    onChange({ conj: 'and', nodes: [inner, { conj: 'and', nodes: [] }] });
    setEditing(null);
  };

  const addItems = fieldItems([]);
  addItems.push({ kind: 'heading', label: 'Advanced' });
  addItems.push({
    id: 'group',
    label: 'Advanced filter',
    hint: 'Group these, and start another',
    onSelect: addGroup,
  });

  return (
    <div className={[styles.bar, className].filter(Boolean).join(' ')}>
      {error === null || error === undefined ? null : (
        // A live region: the user did not do anything to cause this, they followed a link,
        // and the whole point of the message is that it explains a list that is not the one
        // they were sent.
        <div className={styles.error} role="alert">
          <p className={styles.errorText}>
            This link carried a filter this build could not read, so every issue is shown.{' '}
            <span className={styles.errorDetail}>{error}</span>
          </p>
          <Button size="sm" onClick={() => onChange(EMPTY_FILTER)}>
            Clear filter
          </Button>
        </div>
      )}

      {/*
       * A group rather than `role="toolbar"`, for the reason the issue list gives: a toolbar
       * promises arrow-key navigation between its controls, which would mean a roving
       * tabindex and a local key handler. Every control here is in the tab order instead.
       */}
      <div className={styles.row} role="group" aria-label="Filters">
        {nodes.length === 0 ? <span className={styles.quiet}>All issues</span> : null}

        <NodeRun
          group={root}
          path={[]}
          depth={0}
          editing={editing}
          names={names}
          timezone={zone}
          teamId={teamId}
          onOpen={setEditing}
          onReplace={replace}
          onRemove={remove}
          onToggleConjunction={toggleConjunction}
          onAddInto={openAddInto}
        />

        {/* Secondary, not ghost. It stands in a horizontal group beside the clause chips,
            which carry a border and a background of their own, and a borderless word at the
            end of a run of bordered pills reads as a caption on the last one rather than as
            the control that adds the next. Ghost is for a full-width trigger inside a
            labelled row, where the label supplies the affordance; there is no label here. */}
        <Button {...add.props} size="sm" icon={<PlusGlyph />}>
          Add filter
        </Button>
        <Menu
          open={add.open}
          onClose={add.hide}
          trigger={add.ref}
          items={addItems}
          label="Add filter"
          filterable
          filterPlaceholder="Filter by…"
          emptyLabel="Nothing to filter by under that name"
        />
        <Menu
          open={into.open}
          onClose={into.hide}
          trigger={intoAnchor}
          items={fieldItems(null)}
          label="Add filter to this group"
          filterable
          filterPlaceholder="Filter by…"
          emptyLabel="Nothing to filter by under that name"
        />
      </div>
    </div>
  );
}

interface NodeRunProps {
  group: FilterGroup;
  path: Path;
  /** Zero at the top. Only used to tell a bracketed run from the bar's own row. */
  depth: number;
  editing: string | null;
  names: EntityMarks;
  timezone: string;
  teamId: UUID | undefined;
  onOpen: (key: string | null) => void;
  onReplace: (path: Path, next: FilterNode) => void;
  onRemove: (path: Path) => void;
  /** Called with the path of the group whose conjunction was clicked, at any depth. */
  onToggleConjunction: (path: Path) => void;
  /** Opens the field menu against the plus inside one bracket, for that bracket. */
  onAddInto: (path: Path, anchor: HTMLElement) => void;
}

/**
 * One group's children, with its conjunction written between them.
 *
 * Recursive, because the grammar is. The conjunction is only drawn *between* nodes: a group
 * of one has no two things to combine, and a control that changes nothing is worse than no
 * control.
 */
function NodeRun({
  group,
  path,
  depth,
  editing,
  names,
  timezone,
  teamId,
  onOpen,
  onReplace,
  onRemove,
  onToggleConjunction,
  onAddInto,
}: NodeRunProps) {
  const nodes = group.nodes ?? [];
  const conj = group.conj ?? 'and';

  return (
    <>
      {nodes.map((node, index) => {
        const here = [...path, index];
        const key = pathKey(here);
        return (
          // Keyed by position, which is the only identity a node has: the grammar is the
          // wire shape and carries no ids. Reordering is not offered, so a position is
          // stable for as long as the node it names.
          <Fragment key={key}>
            {index === 0 ? null : (
              // Every group's own, nested ones included: the brackets on screen say the
              // filter has more than one conjunction in it, and a bracket somebody can read
              // and cannot change is a control missing rather than a control not needed.
              <Tooltip
                label={conj === 'and' ? 'Match any of these instead' : 'Match all of these instead'}
              >
                <button
                  type="button"
                  className={styles.conj}
                  onClick={() => onToggleConjunction(path)}
                >
                  {conj}
                </button>
              </Tooltip>
            )}

            {isFilterClause(node) ? (
              <ClauseChip
                clause={node}
                wording={wordClause(node, names, timezone)}
                open={editing === key}
                names={names}
                timezone={timezone}
                teamId={teamId}
                onOpen={(open) => onOpen(open ? key : null)}
                onChange={(next) => onReplace(here, next)}
                onRemove={() => onRemove(here)}
              />
            ) : (
              <span
                className={styles.nested}
                role="group"
                // The nested group's own conjunction, not the one joining it to its
                // siblings: "(A or B) and C" has two, and naming the bracket after the
                // outer one describes the wrong half of the filter.
                aria-label={(node.conj ?? 'and') === 'or' ? 'Any of these' : 'All of these'}
              >
                <span className={styles.bracket} aria-hidden="true">
                  (
                </span>
                <NodeRun
                  group={node}
                  path={here}
                  depth={depth + 1}
                  editing={editing}
                  names={names}
                  timezone={timezone}
                  teamId={teamId}
                  onOpen={onOpen}
                  onReplace={onReplace}
                  onRemove={onRemove}
                  onToggleConjunction={onToggleConjunction}
                  onAddInto={onAddInto}
                />
                <span className={styles.bracket} aria-hidden="true">
                  )
                </span>
                {/* A bracket carries its own two controls, because nothing else can reach
                    it: the bar's Add filter button writes to the top level, and a group with
                    no clauses in it has no remove button of its own to inherit. */}
                <IconButton
                  className={styles.groupAction}
                  size="sm"
                  aria-label="Add a filter to this group"
                  tooltip="Add filter"
                  icon={<PlusGlyph />}
                  onClick={(event) => onAddInto(here, event.currentTarget)}
                />
                <IconButton
                  className={styles.groupAction}
                  size="sm"
                  aria-label="Remove this group of filters"
                  tooltip="Remove group"
                  icon={<CrossGlyph />}
                  onClick={() => onRemove(here)}
                />
              </span>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

interface ClauseChipProps {
  clause: FilterClause;
  wording: Wording;
  open: boolean;
  names: EntityMarks;
  timezone: string;
  teamId: UUID | undefined;
  onOpen: (open: boolean) => void;
  onChange: (next: FilterClause) => void;
  onRemove: () => void;
}

/**
 * One clause: a button that reads as a sentence, and the control that takes it away.
 *
 * Two buttons rather than one with a cross inside it, because a button inside a button is
 * not markup a browser will render and not a thing a screen reader can announce. The chip
 * carries the sentence as its accessible name, so "Status is In Progress" is both what is
 * read on screen and what is announced.
 */
function ClauseChip({
  clause,
  wording,
  open,
  names,
  timezone,
  teamId,
  onOpen,
  onChange,
  onRemove,
}: ClauseChipProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  // The popover is held on screen for the length of its fade. The focus hand-back below
  // still fires on the frame it closes: `inert` has already pushed the caret out of the
  // exiting panel by then, so this puts it back on the chip rather than fighting it.
  const { present, exitProps } = usePresence(open, editorRef);

  // Focus comes back to the chip when its editor closes, wherever the closing came from —
  // Escape, the Done button, or another chip being opened. Without it, dismissing a popover
  // drops a keyboard user at the top of the document.
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <span className={styles.clause}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <span className={styles.chipField}>{wording.field}</span>{' '}
        <span className={styles.chipOp}>{wording.op}</span>
        {wording.value === null ? null : (
          <>
            {' '}
            {/* Decorative, and it must be: the sentence beside it already names the value,
                and an icon announced next to the word it repeats is that word twice. */}
            {wording.glyph === undefined ? null : <OptionGlyphMark glyph={wording.glyph} />}
            <span className={styles.chipValue}>{wording.value}</span>
          </>
        )}
      </button>

      <IconButton
        className={styles.remove}
        size="sm"
        aria-label={`Remove filter: ${wording.text}`}
        tooltip="Remove"
        icon={<CrossGlyph />}
        onClick={onRemove}
      />

      {present ? (
        <ClauseEditor
          ref={editorRef}
          exitProps={exitProps}
          clause={clause}
          names={names}
          timezone={timezone}
          teamId={teamId}
          onChange={onChange}
          onClose={() => onOpen(false)}
        />
      ) : null}
    </span>
  );
}

interface ClauseEditorProps {
  clause: FilterClause;
  names: EntityMarks;
  timezone: string;
  teamId: UUID | undefined;
  onChange: (next: FilterClause) => void;
  onClose: () => void;
  /** The popover's own node, so its chip can time the exit against the animation on it. */
  ref?: Ref<HTMLDivElement> | undefined;
  /** Inertness and the exit hook, from the chip's `usePresence`. Spread, never inspected. */
  exitProps?: ExitProps | undefined;
}

/**
 * The popover that edits one clause: its operator, and its values.
 *
 * It deliberately does not close on an outside click. The value pickers inside it are
 * portalled elsewhere in the document, so an "is this click inside me" test would treat
 * every choice made in one of them as a click outside this panel and close the thing the
 * user was working in. Escape, the Done button and clicking the chip again all close it,
 * which is three ways more than the failure mode is worth.
 */
function ClauseEditor({
  clause,
  names,
  timezone,
  teamId,
  onChange,
  onClose,
  ref,
  exitProps,
}: ClauseEditorProps) {
  const [search, setSearch] = useState('');
  const operatorRef = useRef<HTMLSelectElement>(null);
  const field = clause.field;
  const values = clause.values ?? [];

  const options = useValueOptions(field, teamId, search, values);

  // The panel opens because the user asked to edit this clause, so the first thing they can
  // change is where the keyboard should already be.
  useEffect(() => {
    operatorRef.current?.focus();
  }, []);

  const applyOperator = (op: FilterOp) => onChange(withOperator(clause, op, options));
  const applyValues = (next: readonly string[]) => onChange({ field, op: clause.op, values: next });

  return (
    <div
      ref={ref}
      className={styles.editor}
      role="dialog"
      aria-label={`Edit the ${FIELD_LABELS[field]} filter`}
      {...exitProps}
    >
      <Select
        ref={operatorRef}
        label="Condition"
        value={clause.op}
        onChange={(event) => {
          if (isFilterOp(event.target.value)) applyOperator(event.target.value);
        }}
      >
        {FILTER_OPS.filter((op) => operatorApplies(field, op)).map((op) => (
          <option
            key={op}
            value={op}
            // An operator that needs exactly one value has nothing to say until there is a
            // value to give it, and emitting `eq` with none would produce a filter the
            // grammar rejects on the way back out of the URL.
            disabled={takesSingleValue(op) && carriedValue(clause, options) === null}
          >
            {operatorPhrase(op, field)}
          </option>
        ))}
      </Select>

      {takesNoValues(clause.op) ? (
        <p className={styles.note}>This condition asks about presence, so it takes no value.</p>
      ) : isEnumerable(field) && !typed(clause.op) ? (
        <OptionList
          field={field}
          single={takesSingleValue(clause.op)}
          values={values}
          options={options}
          search={search}
          onSearch={setSearch}
          onChange={applyValues}
        />
      ) : (
        <TypedValues
          field={field}
          single={takesSingleValue(clause.op)}
          values={values}
          names={names}
          timezone={timezone}
          onChange={applyValues}
        />
      )}

      <div className={styles.editorFooter}>
        <Button size="sm" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

interface OptionListProps {
  field: FilterField;
  single: boolean;
  values: readonly string[];
  options: readonly ValueOption[];
  search: string;
  onSearch: (next: string) => void;
  onChange: (next: readonly string[]) => void;
}

/**
 * The value picker for everything with a knowable set of answers: statuses, people, labels,
 * teams, issues, the seven categories, the five priorities, yes and no.
 *
 * Checkboxes when the operator takes several values, radios when it takes one. Both are the
 * platform's own controls rather than something built out of divs, which is the same
 * bargain Checkbox itself makes: focus, the space bar, the arrow keys within a radio group
 * and how each is announced are all behaviour a reimplementation would have to earn back
 * one bug at a time. The library has no radio because nothing else in the product needs
 * one — a filter clause is the only place a single choice is made from a live list rather
 * than from a menu.
 */
function OptionList({
  field,
  single,
  values,
  options,
  search,
  onSearch,
  onChange,
}: OptionListProps) {
  const group = useId();
  // Tiers are workspace-defined names and a workspace can have a dozen of them, so the box
  // that finds one is wanted for the same reason a status list wants it. It is not a uuid
  // field, which is why the type alone was the wrong question.
  const searchable = FILTER_FIELDS[field].type === 'uuid' || field === 'customerTier';

  return (
    <fieldset className={styles.options}>
      <legend className={styles.srOnly}>Value</legend>

      {searchable ? (
        <Input
          label={`Search ${FIELD_LABELS[field].toLowerCase()}`}
          hideLabel
          placeholder="Search…"
          value={search}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onSearch(event.target.value)}
        />
      ) : null}

      {options.length === 0 ? (
        <p className={styles.note}>
          {search === '' ? 'Nothing here to filter by yet.' : 'Nothing matches that.'}
        </p>
      ) : (
        <ul className={styles.optionList}>
          {options.map((option) => (
            <li key={option.id}>
              {single ? (
                <label className={styles.option}>
                  <input
                    type="radio"
                    name={group}
                    value={option.id}
                    checked={values[0] === option.id}
                    onChange={() => onChange([option.id])}
                  />
                  <OptionLabel option={option} />
                </label>
              ) : (
                <Checkbox
                  checked={values.includes(option.id)}
                  label={<OptionLabel option={option} />}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...values, option.id]
                        : values.filter((value) => value !== option.id),
                    )
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function OptionLabel({ option }: { option: ValueOption }): ReactNode {
  return (
    <span className={styles.optionLabel}>
      {option.glyph === undefined ? null : <OptionGlyphMark glyph={option.glyph} />}
      <span className={styles.optionName}>{option.label}</span>
      {option.hint === undefined ? null : <span className={styles.hint}>{option.hint}</span>}
    </span>
  );
}

/**
 * One value's glyph.
 *
 * Decorative in every case: the option's own text names it, and the tick or the radio says
 * whether it is chosen. An icon announced beside the name it duplicates is the same word
 * twice for anybody listening rather than looking.
 */
function OptionGlyphMark({ glyph }: { glyph: OptionGlyph }): ReactNode {
  switch (glyph.kind) {
    case 'state':
      return <StateIcon category={glyph.category} color={glyph.color} decorative />;
    case 'priority':
      return <PriorityIcon priority={glyph.level} decorative />;
    case 'person':
      return (
        <Avatar
          name={glyph.name}
          src={glyph.avatar ?? null}
          size="xs"
          colorKey={glyph.personId}
          decorative
        />
      );
    case 'label':
      return (
        <span
          className={styles.swatch}
          style={{ '--label-color': glyph.color } as CSSProperties}
          aria-hidden="true"
        />
      );
  }
}

interface TypedValuesProps {
  field: FilterField;
  single: boolean;
  values: readonly string[];
  names: EntityMarks;
  timezone: string;
  onChange: (next: readonly string[]) => void;
}

/**
 * The value editor for everything that is typed rather than chosen: a title fragment, an
 * estimate, a day, a moment.
 *
 * The one-value and many-value forms are two components rather than one with a branch,
 * because each keeps a draft of what is half-typed and they mean different things — the
 * single form's box holds the value, the multi form's box holds the next value to add. One
 * component would have to reset the same piece of state on two different events, and would
 * get one of them wrong.
 */
function TypedValues({ field, single, values, names, timezone, onChange }: TypedValuesProps) {
  return single ? (
    <SingleTypedValue field={field} values={values} onChange={onChange} />
  ) : (
    <MultiTypedValues
      field={field}
      values={values}
      names={names}
      timezone={timezone}
      onChange={onChange}
    />
  );
}

/**
 * A picker for the relative tokens, which are what a saved date filter should almost always
 * hold: "updated after the start of this week" stays true next week, and the resolved date
 * it would otherwise have frozen does not.
 */
function RelativePicker({
  label,
  placeholder,
  value,
  onPick,
}: {
  label: string;
  placeholder: string;
  value: string;
  onPick: (keyword: string) => void;
}) {
  return (
    <Select
      label={label}
      value={isRelativeToken(value) ? value : ''}
      onChange={(event) => {
        if (event.target.value !== '') onPick(event.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {RELATIVE_KEYWORDS.map((keyword) => (
        <option key={keyword} value={keyword}>
          {KEYWORD_WORDS[keyword]}
        </option>
      ))}
    </Select>
  );
}

/**
 * One typed value.
 *
 * The draft is not a debounce. A value is published on the keystroke that makes it a legal
 * value and on no other — "2026-0" is not a date, and publishing it would put a filter in
 * the URL that will not parse when somebody opens the link. Text has no such state: the
 * empty string is a legal value meaning "matches everything", which is what a cleared
 * search box should do.
 *
 * The draft is also the authority, and that is the part worth the ceremony below. Publishing
 * goes through `onChange` to `setFilter` to the URL, and `BrowserRouter` applies a location
 * inside `React.startTransition`: the transition is interruptible, the thing that interrupts
 * it is the next keystroke, and the location that lands afterwards carries the value from
 * *before* that keystroke. An effect that answered every incoming `current` by writing it
 * into the box therefore put the older value back and ate the character — the same defect,
 * with the same cause, that `useQueryParam` in web/src/views/Search.tsx documents at length
 * for the search box.
 *
 * So the box keeps a list of what it has published and has not yet seen come back. A
 * `current` found in that list is this component's own write arriving late and is consumed;
 * only a value it never asked for — the back button, a link, the operator switching under it
 * — reaches `setDraft`.
 */
function SingleTypedValue({
  field,
  values,
  onChange,
}: {
  field: FilterField;
  values: readonly string[];
  onChange: (next: readonly string[]) => void;
}) {
  const type = FILTER_FIELDS[field].type;
  const current = values[0] ?? '';
  const [draft, setDraft] = useState(current);

  /** Values this box has published and not yet seen come back. Oldest first. */
  const written = useRef<string[]>([current]);

  // What the box says, for the effect below to compare against without depending on it. An
  // effect that re-ran on every keystroke would run against a clause one write behind,
  // mistake it for an outside change, and put the box back a character.
  const latest = useRef(draft);
  latest.current = draft;

  useEffect(() => {
    const mine = written.current.indexOf(current);
    if (mine !== -1) {
      // One of this box's own writes, arriving after it has already moved on. Everything
      // before it in the list is older still and can never be the current value again.
      written.current.splice(0, mine + 1);
      return;
    }
    if (current === latest.current) return;
    // The clause changed underneath this — the operator switched, or the URL changed under
    // the back button — and the box has to follow rather than keep showing what was in it.
    written.current = [current];
    setDraft(current);
  }, [current]);

  const publish = (next: string) => {
    setDraft(next);
    if (!publishable(type, next)) return;
    written.current.push(next);
    onChange([next]);
  };

  return (
    <div className={styles.valueBlock}>
      {/* A timestamp has no free-text box: the grammar wants RFC 3339 down to the second,
          and a person filtering an activity feed means "this week", not 14:07:32. */}
      {type === 'timestamp' ? null : (
        <Input
          label="Value"
          type={inputTypeOf(type)}
          value={isRelativeToken(draft) ? '' : draft}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => publish(event.target.value)}
        />
      )}
      {type === 'date' || type === 'timestamp' ? (
        <RelativePicker
          label="Relative"
          placeholder={type === 'timestamp' ? 'Choose a moment…' : 'Or a relative day…'}
          value={current}
          onPick={(keyword) => onChange([keyword])}
        />
      ) : null}
    </div>
  );
}

/** Several typed values: what is already chosen, and a box that adds one more. */
function MultiTypedValues({
  field,
  values,
  names,
  timezone,
  onChange,
}: {
  field: FilterField;
  values: readonly string[];
  names: EntityMarks;
  timezone: string;
  onChange: (next: readonly string[]) => void;
}) {
  const type = FILTER_FIELDS[field].type;
  const [draft, setDraft] = useState('');
  const ready = draft !== '' && publishable(type, draft);

  return (
    <div className={styles.valueBlock}>
      <ul className={styles.chosen}>
        {values.map((value, index) => {
          const word = valueWord(field, value, names, timezone);
          return (
            // Keyed by value and position together: `in` does not forbid a repeated value,
            // and two identical keys would make React reuse the wrong row when one goes.
            <li key={`${value}-${index}`} className={styles.chosenItem}>
              <span>{word}</span>
              <IconButton
                size="sm"
                aria-label={`Remove ${word}`}
                tooltip="Remove"
                icon={<CrossGlyph />}
                onClick={() => onChange(values.filter((_, at) => at !== index))}
              />
            </li>
          );
        })}
      </ul>

      {type === 'timestamp' ? null : (
        // A form purely so that Enter adds. The alternative is a local key handler, which
        // the keymap lint refuses for good reason; submitting a form is the platform's own
        // answer to the same problem and needs no handler at all.
        <form
          className={styles.addValue}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!ready) return;
            onChange([...values, draft]);
            setDraft('');
          }}
        >
          <Input
            label="Add a value"
            hideLabel
            type={inputTypeOf(type)}
            value={draft}
            placeholder="Add a value…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!ready}>
            Add
          </Button>
        </form>
      )}

      {type === 'date' || type === 'timestamp' ? (
        <RelativePicker
          label="Add a relative day"
          placeholder={type === 'timestamp' ? 'Add a moment…' : 'Add a relative day…'}
          value=""
          onPick={(keyword) => onChange([...values, keyword])}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * The AST.
 *
 * Every edit is a rebuild rather than a mutation: the tree in the URL is the one source,
 * and a node edited in place would be a second copy of it for as long as React took to
 * re-render.
 */

function asGroup(node: FilterNode): FilterGroup {
  // A bare clause is a legal filter, and the bar's whole model — add here, combine with
  // and/or — needs a group to hang off. Wrapping is what `validateFilter` would produce
  // anyway the moment a second clause is added.
  return isFilterGroup(node) ? node : { conj: 'and', nodes: [node] };
}

function pathKey(path: Path): string {
  return path.join('.');
}

/** The group at a path, or null when the path names a clause or nothing at all. */
function groupAt(root: FilterGroup, path: Path): FilterGroup | null {
  let node: FilterNode = root;
  for (const index of path) {
    if (isFilterClause(node)) return null;
    const child: FilterNode | undefined = (node.nodes ?? [])[index];
    if (child === undefined) return null;
    node = child;
  }
  return isFilterGroup(node) ? node : null;
}

function replaceAt(root: FilterGroup, path: Path, next: FilterNode): FilterGroup {
  return { ...root, nodes: rebuild(root.nodes ?? [], path, () => next) };
}

function removeAt(root: FilterGroup, path: Path): FilterGroup {
  return { ...root, nodes: rebuild(root.nodes ?? [], path, () => null) };
}

/** Walks to `path` and swaps what it finds, or drops it when the callback returns null. */
function rebuild(
  nodes: readonly FilterNode[],
  path: Path,
  make: () => FilterNode | null,
): FilterNode[] {
  const head = path[0];
  if (head === undefined) return [...nodes];
  const rest = path.slice(1);

  const out: FilterNode[] = [];
  nodes.forEach((node, index) => {
    if (index !== head) {
      out.push(node);
      return;
    }
    if (rest.length === 0) {
      const next = make();
      if (next !== null) out.push(next);
      return;
    }
    // A path that runs past a clause names a node that does not exist; the clause is kept
    // rather than dropped, because losing a filter is a worse answer than ignoring a stale
    // path.
    if (isFilterGroup(node)) out.push({ ...node, nodes: rebuild(node.nodes ?? [], rest, make) });
    else out.push(node);
  });
  return out;
}

/**
 * A freshly added clause, in the shape that is both valid and empty.
 *
 * `in` for anything chosen from a set, because `in []` is the grammar's only way to say "no
 * value yet" — it matches nothing, the chip says so, and the editor is opened on it
 * immediately. `contains` for text, whose empty string matches everything. `eq` for the
 * scalars, each with a first value that is a reasonable guess rather than a placeholder.
 */
function newClause(field: FilterField): FilterClause {
  const spec = FILTER_FIELDS[field];
  if (spec.type === 'uuid' || spec.multi) return { field, op: 'in', values: [] };
  if (spec.type === 'text') return { field, op: 'contains', values: [''] };
  return { field, op: 'eq', values: [scalarDefault(field)] };
}

function scalarDefault(field: FilterField): string {
  switch (FILTER_FIELDS[field].type) {
    case 'enum':
      return FILTER_FIELDS[field].enums?.[0] ?? 'started';
    case 'number':
      // Urgent for a priority, one point for an estimate. The two scales agree on the digit
      // by coincidence, and both are a plausible first thing to ask about.
      return '1';
    case 'date':
    case 'timestamp':
      return 'today';
    case 'boolean':
      return 'true';
    default:
      return '';
  }
}

/**
 * The clause with a different operator, and values reshaped to fit it.
 *
 * The reshaping is the point. `isNull` may carry no values at all — not even an empty array
 * — and a single-valued operator must carry exactly one, so a switch from "is any of Ana,
 * Bo" to "is" keeps Ana rather than producing a clause the validator rejects.
 */
function withOperator(
  clause: FilterClause,
  op: FilterOp,
  options: readonly ValueOption[],
): FilterClause {
  if (takesNoValues(op)) return { field: clause.field, op };
  const values = clause.values ?? [];
  if (!takesSingleValue(op)) return { field: clause.field, op, values: [...values] };
  const carried = carriedValue(clause, options);
  // The select disables an operator with nothing to carry, so this is unreachable from the
  // interface; keeping the clause unchanged is the answer that cannot emit an invalid one.
  if (carried === null) return clause;
  return { field: clause.field, op, values: [carried] };
}

/** The one value a single-valued operator would take: what is there, or a sensible first. */
function carriedValue(clause: FilterClause, options: readonly ValueOption[]): string | null {
  const existing = (clause.values ?? [])[0];
  if (existing !== undefined) return existing;
  if (FILTER_FIELDS[clause.field].type === 'uuid') return options[0]?.id ?? null;
  return scalarDefault(clause.field);
}

/* ---------------------------------------------------------------------------------------
 * Wording.
 *
 * A chip is a sentence, and the sentence is the whole interface: somebody reading a shared
 * link has to be able to tell what it will show before they click it, and the bar is where
 * that promise is kept once they have.
 */

interface Wording {
  readonly field: string;
  readonly op: string;
  /** Null when the operator takes no value, or when none has been chosen yet. */
  readonly value: string | null;
  /**
   * The first value's canonical mark, when it has one.
   *
   * The first and not all of them: a chip is one line of a sentence, and four avatars in the
   * middle of it would be a second list competing with the names already there. It is what
   * makes a row of chips scannable — the status icon says which chip is the status one
   * before any of them has been read.
   */
  readonly glyph?: OptionGlyph | undefined;
  /** The three of them as one string, for accessible names. */
  readonly text: string;
}

function wordClause(clause: FilterClause, names: EntityMarks, timezone: string): Wording {
  const field = FIELD_LABELS[clause.field];
  const values = clause.values ?? [];

  if (takesNoValues(clause.op)) {
    const op = operatorPhrase(clause.op, clause.field);
    return { field, op, value: null, text: `${field} ${op}` };
  }
  if (values.length === 0) {
    // `in []` matches nothing, which is true but is not what anybody meant by adding the
    // clause a moment ago. Saying what it is waiting for is more use than saying what it
    // currently does.
    return { field, op: 'needs a value', value: null, text: `${field} needs a value` };
  }

  const op = operatorPhrase(clause.op, clause.field);
  const value = values.map((raw) => valueWord(clause.field, raw, names, timezone)).join(', ');
  // `text` stays the words alone. It is the remove button's accessible name, and an icon has
  // nothing to say to somebody listening to "Remove filter: Status is Doing".
  return {
    field,
    op,
    value,
    glyph: firstGlyph(clause, values, names),
    text: `${field} ${op} ${value}`,
  };
}

/**
 * The mark for the first value of a clause, for the fields whose values have one.
 *
 * A priority is the case that makes this worth doing without the store: the level is the
 * value itself, so the chip can draw the same glyph the picker does with nothing looked up.
 */
function firstGlyph(
  clause: FilterClause,
  values: readonly string[],
  names: EntityMarks,
): OptionGlyph | undefined {
  const first = values[0];
  if (first === undefined) return undefined;
  if (clause.field === 'priority') {
    const level = Number(first);
    return Number.isInteger(level) ? { kind: 'priority', level } : undefined;
  }
  if (clause.field === 'stateCategory') {
    return isStateCategory(first) ? { kind: 'state', category: first as StateCategory } : undefined;
  }
  return names[nameKey(clause.field, first)]?.glyph;
}

/**
 * How an operator reads, which depends on what it is comparing.
 *
 * `lt` on a due date is "before" and on an estimate is "less than". The same comparison,
 * and two different English words — a filter bar that says "due date less than today" is
 * one people have to translate as they read it.
 */
function operatorPhrase(op: FilterOp, field: FilterField): string {
  const type = FILTER_FIELDS[field].type;
  const chronological = type === 'date' || type === 'timestamp';
  switch (op) {
    case 'eq':
      return 'is';
    case 'neq':
      return 'is not';
    case 'in':
      return 'is any of';
    case 'notIn':
      return 'is none of';
    case 'contains':
      return 'contains';
    case 'notContains':
      return 'does not contain';
    case 'gt':
      return chronological ? 'after' : 'more than';
    case 'gte':
      return chronological ? 'on or after' : 'at least';
    case 'lt':
      return chronological ? 'before' : 'less than';
    case 'lte':
      return chronological ? 'on or before' : 'at most';
    case 'isNull':
      return 'is empty';
    case 'isNotNull':
      return 'is set';
  }
}

function valueWord(
  field: FilterField,
  value: string,
  names: EntityMarks,
  timezone: string,
): string {
  switch (FILTER_FIELDS[field].type) {
    case 'uuid':
      // An id that resolves to nothing is not an error: the replica may not have that
      // entity yet, or the viewer may not be allowed to see it. What it must never be is
      // the id itself.
      return names[nameKey(field, value)]?.name ?? UNKNOWN_ENTITY[field] ?? 'something unknown';
    case 'enum':
      return STATE_LABELS[value as StateCategory] ?? value;
    case 'number':
      return field === 'priority' ? priorityLabel(Number(value)) : value;
    case 'boolean':
      return value === 'true' ? 'yes' : 'no';
    case 'date':
      return relativeWord(value) ?? whenDay(value, timezone);
    case 'timestamp':
      return relativeWord(value) ?? value;
    case 'text':
      // Quoted, because a filter for the word "and" would otherwise read as punctuation in
      // the middle of the sentence the chips make.
      return `"${value}"`;
  }
}

/** The words for the seven tokens. `relative.ts` owns what they mean; this owns how they read. */
const KEYWORD_WORDS: Readonly<Record<RelativeKeyword, string>> = {
  now: 'now',
  today: 'today',
  yesterday: 'yesterday',
  tomorrow: 'tomorrow',
  startOfWeek: 'the start of this week',
  startOfMonth: 'the start of this month',
  startOfYear: 'the start of this year',
};

/** Sign, count, unit — the offset form, mirrored from `relative.ts` for rendering only. */
const OFFSET_PATTERN = /^([+-])(\d+)([dwMy])$/;

const OFFSET_UNITS: Readonly<Record<string, string>> = {
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

/** The English for a relative token, or null when the value is a plain date or timestamp. */
function relativeWord(value: string): string | null {
  const keyword = KEYWORD_WORDS[value as RelativeKeyword];
  if (keyword !== undefined) return keyword;

  const offset = OFFSET_PATTERN.exec(value);
  if (offset === null) return null;
  const count = Number(offset[2]);
  const unit = OFFSET_UNITS[offset[3] ?? ''] ?? 'day';
  const plural = count === 1 ? unit : `${unit}s`;
  return offset[1] === '-' ? `${count} ${plural} ago` : `in ${count} ${plural}`;
}

/* ---------------------------------------------------------------------------------------
 * The field table, as the interface says it.
 *
 * Deliberately keyed by `FilterField` so that adding a field to the grammar and forgetting
 * it here is a compile error rather than a chip that reads "createdAt".
 */

const FIELD_LABELS: Readonly<Record<FilterField, string>> = {
  state: 'Status',
  stateCategory: 'Status category',
  assignee: 'Assignee',
  creator: 'Creator',
  subscriber: 'Subscriber',
  priority: 'Priority',
  label: 'Label',
  team: 'Team',
  estimate: 'Estimate',
  dueDate: 'Due date',
  createdAt: 'Created',
  updatedAt: 'Updated',
  completedAt: 'Completed',
  title: 'Title',
  description: 'Description',
  parent: 'Parent',
  blockedBy: 'Blocked by',
  blocking: 'Blocking',
  archived: 'Archived',
  deleted: 'Deleted',
  template: 'Template',
  recurring: 'Recurring',
  customer: 'Customer',
  customerCount: 'Customer count',
  customerStatus: 'Customer status',
  customerTier: 'Customer tier',
  customerRevenue: 'Customer revenue',
  customerSize: 'Customer size',
  customerImportant: 'Important request',
};

/** Said in the add menu where the label alone would leave a real question open. */
const FIELD_HINTS: Partial<Record<FilterField, string>> = {
  stateCategory: 'Survives a rename',
  subscriber: 'Following the issue',
  archived: 'Hidden by default',
  deleted: 'Hidden by default',
  recurring: 'Minted on a schedule',
  customerCount: 'Requests on the issue',
  customerImportant: 'At least one request marked important',
};

/** What a uuid reads as when the store has never seen it. */
const UNKNOWN_ENTITY: Partial<Record<FilterField, string>> = {
  state: 'an unknown status',
  assignee: 'an unknown person',
  creator: 'an unknown person',
  subscriber: 'an unknown person',
  label: 'an unknown label',
  team: 'an unknown team',
  parent: 'an unknown issue',
  blockedBy: 'an unknown issue',
  blocking: 'an unknown issue',
  template: 'an unknown template',
  customer: 'an unknown customer',
};

interface FieldGroup {
  readonly heading: string;
  readonly fields: readonly FilterField[];
}

const GROUPED_FIELDS: readonly FieldGroup[] = [
  {
    heading: 'Properties',
    fields: ['state', 'stateCategory', 'priority', 'estimate', 'label', 'team', 'template'],
  },
  { heading: 'People', fields: ['assignee', 'creator', 'subscriber'] },
  { heading: 'Dates', fields: ['dueDate', 'createdAt', 'updatedAt', 'completedAt'] },
  { heading: 'Text', fields: ['title', 'description'] },
  { heading: 'Relationships', fields: ['parent', 'blockedBy', 'blocking'] },
  { heading: 'Lifecycle', fields: ['archived', 'deleted', 'recurring'] },
  {
    heading: 'Customers',
    fields: [
      'customer',
      'customerCount',
      'customerStatus',
      'customerTier',
      'customerRevenue',
      'customerSize',
      'customerImportant',
    ],
  },
];

const CUSTOMER_FIELDS = new Set<FilterField>([
  'customer',
  'customerCount',
  'customerStatus',
  'customerTier',
  'customerRevenue',
  'customerSize',
  'customerImportant',
]);

/**
 * The groups, plus anything the grammar has grown that this file has not been told about.
 *
 * A new field would otherwise be filterable by URL and unreachable from the interface,
 * which is the kind of gap nobody finds for a year. Landing under "Other" is not a good
 * home; it is a visible one.
 */
function fieldGroups(hideCustomers: boolean): readonly FieldGroup[] {
  const groups = hideCustomers
    ? GROUPED_FIELDS.filter((group) => group.heading !== 'Customers')
    : GROUPED_FIELDS;
  const placed = new Set(groups.flatMap((group) => group.fields));
  const rest = (Object.keys(FILTER_FIELDS) as FilterField[]).filter((field) => {
    if (placed.has(field)) return false;
    if (hideCustomers && CUSTOMER_FIELDS.has(field)) return false;
    return true;
  });
  return rest.length === 0 ? groups : [...groups, { heading: 'Other', fields: rest }];
}

/**
 * Whether this operator asks for typing whatever the field is.
 *
 * `contains` over a list of tiers is the case: the operator matches a *fragment*, and every
 * fragment worth searching for is one no option in the list spells — a picker offering
 * "Enterprise" and "Pro" cannot express "everything with 'ent' in it", so the panel drew
 * checkboxes for a clause the user could not fill in.
 */
function typed(op: FilterOp): boolean {
  return op === 'contains' || op === 'notContains';
}

/** Whether the field's values come from a list rather than from the keyboard. */
function isEnumerable(field: FilterField): boolean {
  const type = FILTER_FIELDS[field].type;
  return (
    type === 'uuid' ||
    type === 'enum' ||
    type === 'boolean' ||
    field === 'priority' ||
    field === 'customerTier'
  );
}

function inputTypeOf(type: FilterValueType): string {
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  return 'text';
}

/**
 * Whether a typed string is a legal value of this type yet.
 *
 * Deliberately the same shapes `validate.ts` accepts and no looser: this is the gate that
 * keeps a half-typed value out of the URL, and a gate that disagrees with the validator is
 * a gate that lets through exactly the values the validator will reject.
 */
function publishable(type: FilterValueType, value: string): boolean {
  if (type === 'number') return /^[+-]?\d+$/.test(value);
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value);
  return true;
}

/* ---------------------------------------------------------------------------------------
 * The store.
 */

/**
 * What is known about one uuid a filter mentions: how it reads, and how it is drawn.
 *
 * The two travel together because they are wanted together — a chip says "Status is Doing"
 * and draws the status's icon in front of it — but they stay separate fields rather than one
 * rendered node, for the reason `OptionGlyph` gives: this is the answer of a `useLiveQuery`
 * selector, and a React element would compare as different on every pass.
 */
interface EntityMark {
  readonly name: string;
  /** Absent for a team, a template, a customer, an issue — the values with no canonical mark. */
  readonly glyph?: OptionGlyph | undefined;
}

/** Marks for the uuids a filter mentions, keyed by field and id. */
type EntityMarks = Readonly<Record<string, EntityMark>>;

interface UuidRef {
  readonly field: FilterField;
  readonly id: UUID;
}

/**
 * The canonical mark for a value, carried as data rather than as a rendered node.
 *
 * Every one of these options is produced inside a `useLiveQuery` selector, and the store
 * compares a selector's answer structurally to decide whether anything changed. A React
 * element is an object with a symbol tag and a props bag that is rebuilt on every pass, so
 * putting one here would make every answer compare as different and wake every picker on
 * every delta. Plain data compares; `OptionGlyphMark` turns it into the icon.
 */
type OptionGlyph =
  | {
      readonly kind: 'state';
      readonly category: StateCategory;
      readonly color?: string | undefined;
    }
  | { readonly kind: 'priority'; readonly level: number }
  | {
      readonly kind: 'person';
      readonly personId: string;
      readonly name: string;
      readonly avatar?: string | undefined;
    }
  | { readonly kind: 'label'; readonly color: string };

interface ValueOption {
  readonly id: string;
  readonly label: string;
  /** A second line of identification: a status's category, a label's team. */
  readonly hint?: string | undefined;
  /**
   * What the value looks like everywhere else in the product.
   *
   * A status, a priority, a person and a label each have a glyph the rest of the interface
   * uses to say which one they are — and this picker showed none of them, so choosing a
   * status here meant reading a column of names that the list it filters draws as icons.
   * Absent for the values that genuinely have no mark: a team, a template, a customer, yes
   * and no.
   */
  readonly glyph?: OptionGlyph | undefined;
}

function nameKey(field: FilterField, id: string): string {
  return `${field}:${id}`;
}

/**
 * Resolves every uuid in the filter to a name and, where it has one, a glyph.
 *
 * Only the ids actually in the tree, rather than a name index over the workspace: a filter
 * mentions a handful of entities and a workspace holds thousands, and rebuilding a map of
 * five thousand issue identifiers whenever anybody edits a title would cost more than
 * everything else this component does put together.
 *
 * The glyph is collected here rather than in the chip because this is the one place that
 * touches the store on the bar's behalf: the picker inside a popover already drew a status
 * in its own colour, and the chip that popover writes to drew the name alone — the same
 * value, in two vocabularies, a centimetre apart.
 */
function useEntityMarks(root: FilterGroup): EntityMarks {
  const refs = useMemo(() => collectUuids(root, []), [root]);
  const key = refs.map((ref) => nameKey(ref.field, ref.id)).join(',');

  return useLiveQuery(
    (store) => {
      const out: Record<string, EntityMark> = {};
      for (const ref of refs) {
        const name = entityName(store, ref.field, ref.id);
        // Nothing is recorded for an id the replica has never seen: `valueWord` says "an
        // unknown status" for those, and a mark carrying only a glyph would have to invent
        // a name to sit beside it.
        if (name === null) continue;
        out[nameKey(ref.field, ref.id)] = { name, glyph: entityGlyph(store, ref.field, ref.id) };
      }
      return out;
    },
    OPTION_DEPS,
    [key],
  );
}

function collectUuids(node: FilterNode, out: UuidRef[]): UuidRef[] {
  if (isFilterClause(node)) {
    if (FILTER_FIELDS[node.field].type === 'uuid') {
      for (const id of node.values ?? []) out.push({ field: node.field, id });
    }
    return out;
  }
  for (const child of node.nodes ?? []) collectUuids(child, out);
  return out;
}

function entityName(store: Store, field: FilterField, id: UUID): string | null {
  switch (field) {
    case 'state':
      return store.get('workflowState', id)?.name ?? null;
    case 'assignee':
    case 'creator':
    case 'subscriber':
      return store.get('user', id)?.displayName ?? null;
    case 'label':
      return store.get('label', id)?.name ?? null;
    case 'team':
      return store.get('team', id)?.name ?? null;
    case 'template':
      return store.get('issueTemplate', id)?.name ?? null;
    case 'customer':
      return store.get('customer', id)?.name ?? null;
    case 'parent':
    case 'blockedBy':
    case 'blocking': {
      const issue = store.issues.get(id);
      // The identifier rather than the title: ENG-14 is what people say to each other, and
      // a chip is too small to hold a sentence of somebody else's prose.
      return issue === undefined ? null : store.identifierOf(issue);
    }
    default:
      return null;
  }
}

/**
 * The glyph for one entity, for the fields that have one.
 *
 * Deliberately separate from `entityName` rather than folded into it: a name is wanted in
 * places a glyph is not — the chip's sentence, the accessible name of the remove button —
 * and a function that returned both would have every caller throwing half of it away.
 */
function entityGlyph(store: Store, field: FilterField, id: UUID): OptionGlyph | undefined {
  switch (field) {
    case 'state': {
      const state = store.get('workflowState', id);
      return state === undefined
        ? undefined
        : { kind: 'state', category: state.category, color: state.color };
    }
    case 'assignee':
    case 'creator':
    case 'subscriber': {
      const user = store.get('user', id);
      return user === undefined
        ? undefined
        : { kind: 'person', personId: user.id, name: user.displayName, avatar: user.avatarUrl };
    }
    case 'label': {
      const label = store.get('label', id);
      return label === undefined ? undefined : { kind: 'label', color: label.color };
    }
    default:
      // A team, a template, a customer, a tier, an issue, yes and no. None of them has a
      // canonical mark anywhere else in the product, and inventing one here would be this
      // picker teaching a vocabulary no other screen speaks.
      return undefined;
  }
}

/**
 * What a picker offers for this field.
 *
 * The values already chosen always lead the list, whatever the search box says. Without
 * that, typing into the search of a multi-value picker hides the ticks the user has already
 * made — and a checkbox they cannot see is a value they cannot take off again.
 */
function useValueOptions(
  field: FilterField,
  teamId: UUID | undefined,
  search: string,
  values: readonly string[],
): readonly ValueOption[] {
  const chosen = values.join(',');
  const stored = useLiveQuery(
    (store) => storeOptions(store, field, teamId, search, values),
    OPTION_DEPS,
    [field, teamId ?? '', search, chosen],
  );
  const fixed = useMemo(() => staticOptions(field), [field]);
  return FILTER_FIELDS[field].type === 'uuid' || field === 'customerTier' ? stored : fixed;
}

function staticOptions(field: FilterField): readonly ValueOption[] {
  switch (FILTER_FIELDS[field].type) {
    case 'enum':
      if (field === 'customerStatus') {
        return CUSTOMER_STATUSES.map((status) => ({
          id: status,
          label: formatCustomerStatus(status),
        }));
      }
      return (Object.keys(CATEGORY_ORDER) as StateCategory[]).map((category) => ({
        id: category,
        label: STATE_LABELS[category],
        // No colour: a category is not a status, so there is no workspace colour to draw it
        // in — StateIcon's own default for the category is exactly what is meant here.
        glyph: { kind: 'state', category } as const,
      }));
    case 'boolean':
      return [
        { id: 'true', label: 'Yes' },
        { id: 'false', label: 'No' },
      ];
    case 'number':
      if (field !== 'priority') return [];
      return PRIORITY_LEVELS.map((level) => ({
        id: String(level),
        label: priorityLabel(level),
        glyph: { kind: 'priority', level } as const,
      }));
    default:
      return [];
  }
}

function storeOptions(
  store: Store,
  field: FilterField,
  teamId: UUID | undefined,
  search: string,
  values: readonly string[],
): ValueOption[] {
  if (FILTER_FIELDS[field].type !== 'uuid' && field !== 'customerTier') return [];

  const chosen: ValueOption[] = [];
  for (const id of values) {
    // The values already ticked lead the list, so they get their glyph the same way the
    // candidates below do. Without this the chosen half of a status picker would be the only
    // rows in it drawn as bare text, which reads as those rows being a different kind of
    // thing rather than as the same rows, already chosen.
    chosen.push({
      id,
      label: entityName(store, field, id) ?? UNKNOWN_ENTITY[field] ?? id,
      glyph: entityGlyph(store, field, id),
    });
  }
  const needle = search.trim().toLowerCase();
  const taken = new Set(values);
  const rest = candidates(store, field, teamId, needle).filter((option) => !taken.has(option.id));

  // Applied again here, because only the issue picker narrows its own scan. Doing it in one
  // place for every field is what stops a status list and a label list disagreeing about
  // whether a search matches the hint as well as the name.
  const matching = needle === '' ? rest : rest.filter((option) => matches(option, needle));

  return [...chosen, ...matching];
}

function matches(option: ValueOption, needle: string): boolean {
  return `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle);
}

function candidates(
  store: Store,
  field: FilterField,
  teamId: UUID | undefined,
  needle: string,
): ValueOption[] {
  switch (field) {
    case 'state': {
      const states: WorkflowState[] =
        teamId === undefined
          ? [...store.workflowStates.values()]
          : [...store.workflowStateIdsFor(teamId)]
              .map((id) => store.get('workflowState', id))
              .filter((state): state is WorkflowState => state !== undefined);
      return states
        .filter((state) => state.archivedAt === undefined)
        .sort(
          (a, b) =>
            teamName(store, a.teamId).localeCompare(teamName(store, b.teamId)) ||
            CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
            (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
        )
        .map((state) => ({
          id: state.id,
          label: state.name,
          // Across teams the same name means two different statuses, so the team is part of
          // the identification rather than decoration.
          hint:
            teamId === undefined
              ? `${teamName(store, state.teamId)} · ${STATE_LABELS[state.category]}`
              : STATE_LABELS[state.category],
          glyph: { kind: 'state', category: state.category, color: state.color } as const,
        }));
    }
    case 'assignee':
    case 'creator':
    case 'subscriber':
      return [...store.users.values()]
        .filter((user) => user.archivedAt === undefined)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((user) => ({
          id: user.id,
          label: user.displayName,
          hint: user.status === 'active' ? undefined : 'Suspended',
          glyph: {
            kind: 'person',
            personId: user.id,
            name: user.displayName,
            avatar: user.avatarUrl,
          } as const,
        }));
    case 'label':
      return (
        [...store.labels.values()]
          // A group is a heading and is never applied to an issue, so filtering by one would
          // match nothing for a reason the user cannot see.
          .filter(
            (label) =>
              !label.isGroup &&
              label.archivedAt === undefined &&
              (label.teamId === undefined || teamId === undefined || label.teamId === teamId),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((label) => ({
            id: label.id,
            label: label.name,
            hint: label.teamId === undefined ? undefined : teamName(store, label.teamId),
            glyph: { kind: 'label', color: label.color } as const,
          }))
      );
    case 'team':
      return [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((team) => ({ id: team.id, label: team.name, hint: team.key }));
    case 'template': {
      const templates = [...store.issueTemplates.values()].filter(
        (template) =>
          template.archivedAt === undefined &&
          (template.teamId === undefined || teamId === undefined || template.teamId === teamId),
      );
      return templates
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((template) => ({
          id: template.id,
          label: template.name,
          hint: template.teamId === undefined ? undefined : teamName(store, template.teamId),
        }));
    }
    case 'customer':
      return [...store.customers.values()]
        .filter((customer) => customer.archivedAt === undefined && customer.deletedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((customer) => ({
          id: customer.id,
          label: customer.name,
          hint: customer.tier,
        }));
    case 'customerTier': {
      const named = new Set<string>([...store.workspaces.values()][0]?.customerTiers ?? []);
      for (const customer of store.customers.values()) {
        if (customer.tier !== undefined && customer.tier !== '') named.add(customer.tier);
      }
      return [...named]
        .sort((a, b) => a.localeCompare(b))
        .map((tier) => ({ id: tier, label: tier }));
    }
    case 'parent':
    case 'blockedBy':
    case 'blocking': {
      // The one picker whose candidates are the whole corpus, so it is the one that has to
      // narrow before it collects rather than after. Sorting five thousand issues on every
      // keystroke to then show fifty of them would spend the entire keystroke budget on a
      // list nobody sees.
      const found: ValueOption[] = [];
      for (const issue of store.issues.values()) {
        if (issue.archivedAt !== undefined) continue;
        if (teamId !== undefined && issue.teamId !== teamId) continue;
        const option: ValueOption = {
          id: issue.id,
          label: store.identifierOf(issue),
          hint: issue.title,
        };
        if (needle !== '' && !matches(option, needle)) continue;
        found.push(option);
        if (found.length >= MAX_ISSUE_OPTIONS) break;
      }
      // Ordered within the page rather than across the corpus: which fifty you get is the
      // store's order, and searching is how you reach a particular one.
      return found.sort((a, b) => a.label.localeCompare(b.label));
    }
    default:
      return [];
  }
}

function teamName(store: Store, teamId: UUID | undefined): string {
  if (teamId === undefined) return 'Workspace';
  return store.get('team', teamId)?.name ?? 'Unknown team';
}

/* Two 16px glyphs, drawn here rather than pulled from a set: the component library has no
   icon module, and a dependency for two paths is a dependency to keep current. */

function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
