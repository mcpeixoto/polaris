/**
 * The two panels that say what an issue is attached to: the work underneath it, and the work
 * beside it.
 *
 * Both are read straight out of the replica and both are written through `mutations.ts`, so a
 * child added here is under its parent on the next frame and a blocker linked here appears in
 * both issues' panels without anybody waiting for a server. That is not a nicety: a person
 * breaking an epic into eight sub-issues is making eight round trips under any other
 * arrangement, and the eight-hundred-millisecond version of that interaction is one people
 * stop doing.
 *
 * Three facts about the data shape everything below.
 *
 * **Only `blocks` is stored.** "Blocked by" is the same row read from the other end —
 * `relationIdsTo` rather than `relationIdsFrom` — and there is no inverse type to ask for.
 * Adding a blocker therefore swaps the two ids; `createRelation` says the same thing from the
 * write side, and the reason is that two rows could disagree, leaving an issue that blocks
 * another without the other being blocked by it. `related` is symmetric and stored with the
 * smaller id first, so this issue can be at either end of one and both readings are the same
 * section.
 *
 * **The store's spelling is lower case.** A relation's type is `'blocks'` here and `BLOCKS` on
 * the wire, and the conversion happens at the GraphQL boundary in `~/gql/enums`. Comparing
 * against the wire spelling anywhere in this file is the exact bug that made a relation created
 * in one session invisible to this panel until a reload re-bootstrapped it — present,
 * plausible, and equal to nothing.
 *
 * **The other end may not be here at all.** A relation can point at an issue in a team this
 * client is not in, and a sub-issue's team is routinely not its parent's — platform work under
 * a feature epic is the normal case rather than the exception. So neither panel assumes it can
 * resolve the issue it is pointing at, and neither hides a link it cannot resolve: a blocker
 * nobody can see is still a blocker, and a panel that quietly dropped it would tell the reader
 * this issue is unblocked.
 */

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Badge, Button, IconButton, Input, Progress, Select, StateIcon } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import {
  subIssueProgress,
  type RelationType,
  type StateCategory,
  type Store,
  type UUID,
} from '~/store';

import { createRelation, createSubIssue, deleteRelation, report } from './mutations';
import styles from './relations.module.css';

/**
 * How many issues the link picker offers at once.
 *
 * It is the one picker in the product whose candidate set is the whole corpus, and it renders
 * inline under a search box rather than in a scrolling menu — so the cap is a handful rather
 * than the fifty the filter bar allows itself. Past that the answer is to type more, which is
 * why there is a box.
 */
const MAX_RESULTS = 8;

/* ---------------------------------------------------------------------------------------
 * Sub-issues.
 */

interface Child {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly category: StateCategory;
  readonly stateName: string;
  readonly color: string | undefined;
  /** The child's team, when it is not the parent's. Null means "the same team, say nothing". */
  readonly teamName: string | null;
  readonly order: string;
}

export interface SubIssuesProps {
  /** The parent. */
  issueId: UUID;
  /**
   * The parent's team, which is where a child created from this panel lands.
   *
   * Cross-team children are normal and are shown as such, but the one being typed into this
   * box belongs to the issue it is being typed under; moving it afterwards is a different
   * decision made on the child's own screen.
   */
  teamId: UUID;
  /**
   * Detaches a child from its parent — the child stays, the parenthood goes.
   *
   * A callback rather than a call into `mutations.ts`, and this is the one place in either
   * panel where that is true, so it is worth saying why. Every other write here goes through
   * that module because it owns the optimistic patch that goes with each one. Clearing a
   * parent has no function there: `IssueProperties` carries an estimate and a due date and
   * nothing else, and `IssueFields` carries no parent either — while the API's
   * `UpdateIssueInput` has had `parentId` and `clearParent` all along. Writing a second update
   * path inside a panel would put a second answer to "what does the screen show before the
   * server replies" beside the one that module exists to be, which is a worse outcome than
   * one required prop and a note in the review. Give it `updateIssueProperties` once that
   * function learns the field.
   */
  onDetach: (childId: UUID) => void;
  className?: string | undefined;
}

/**
 * An issue's children, with a rollup and a box to add another.
 *
 * The rollup is `subIssueProgress`, which counts from the children rather than from a stored
 * number on the parent — so a child moved to Done updates the ring on the frame the status
 * menu closes, with nothing on the wire in between. A stored counter would be a second
 * definition of "done" that drifts the first time a status is recategorised, and it could not
 * move optimistically at all.
 *
 * Cancelled and duplicate children leave the total rather than counting as incomplete; that
 * decision belongs to `subIssueProgress` and is restated nowhere here. Work the team
 * explicitly dropped must not hold a parent at "3 of 5" forever.
 */
export function SubIssues({ issueId, teamId, onDetach, className }: SubIssuesProps) {
  const engine = useEngine();
  const viewerId = useViewerId();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [detaching, setDetaching] = useState<Child | null>(null);

  /**
   * The documented way in from the keyboard.
   *
   * `Cmd/Ctrl+Shift+O` is listed as a creation entry point in 02-issues.md and in the
   * shortcut reference, and was bound to nothing — which meant the only way to break an
   * issue down was to find a button with a mouse. Registered here rather than on the
   * screen because this component owns `adding`, which is the whole of what the action
   * does; the same arrangement `Links` uses for `Cmd/Ctrl+Shift+U`.
   */
  useActions(
    [
      {
        id: 'issueDetail.addSubIssue',
        title: 'Add sub-issue',
        keys: ['mod+shift+o'],
        when: 'detail',
        group: 'Issues',
        run: () => setAdding(true),
      },
    ],
    [],
  );

  const view = useLiveQuery(
    (store) => {
      const children: Child[] = [];
      for (const id of store.childIssueIdsFor(issueId)) {
        const child = store.issues.get(id);
        // An id in the index with no row behind it should not happen, and skipping is still
        // the right answer if it ever does: half a row is worse than no row.
        if (child === undefined || child.archivedAt !== undefined) continue;
        const state = store.workflowStates.get(child.stateId);
        children.push({
          id: child.id,
          // Recomputed from the team rather than read off the issue: a team key changed this
          // morning must not leave a checklist naming issues that no longer exist.
          identifier: store.identifierOf(child),
          title: child.title,
          category: state?.category ?? 'backlog',
          stateName: state?.name ?? 'No status',
          color: state?.color,
          teamName:
            child.teamId === teamId
              ? null
              : (store.get('team', child.teamId)?.name ?? 'Another team'),
          order: child.subIssueSortOrder ?? '',
        });
      }
      // The checklist's own order, which has nothing to do with the backlog's — see
      // `lastSubIssueSortOrderIn`. The identifier breaks ties so two children written in the
      // same millisecond keep a stable position between renders.
      children.sort((a, b) =>
        a.order === b.order ? a.identifier.localeCompare(b.identifier) : a.order < b.order ? -1 : 1,
      );
      return { children, progress: subIssueProgress(store, issueId) };
    },
    ['issue', 'workflowState', 'team'],
    [issueId, teamId],
  );

  const { children, progress } = view;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (next === '') return;
    // Cleared but not closed: breaking an epic down is a run of six or seven of these, and a
    // form that dismissed itself after each one would make the second child cost two clicks
    // more than the first.
    setTitle('');
    createSubIssue(engine, {
      parentId: issueId,
      teamId,
      title: next,
      creatorId: viewerId ?? undefined,
    }).catch(report);
  };

  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(' ')}
      aria-label="Sub-issues"
    >
      <div className={styles.head}>
        <h2 className={styles.title}>Sub-issues</h2>
        {progress.total === 0 ? null : (
          <>
            <Progress
              percent={(progress.completed / progress.total) * 100}
              label="Sub-issues"
              detail={`${progress.completed} of ${progress.total} done`}
              size="sm"
            />
            {/* Hidden from the accessibility tree because the ring beside it already carries
                exactly these numbers in its name, and hearing "1 of 2 done, 1 slash 2" is a
                worse answer than hearing it once. */}
            <span className={styles.count} aria-hidden="true">
              {progress.completed}/{progress.total}
            </span>
          </>
        )}
        <div className={styles.spacer} />
        <Button size="sm" variant="ghost" icon={<PlusGlyph />} onClick={() => setAdding(true)}>
          Add sub-issue
        </Button>
      </div>

      {children.length === 0 && !adding ? (
        <p className={styles.quiet}>Nothing underneath this one yet.</p>
      ) : null}

      {children.length === 0 ? null : (
        <ul className={styles.rows}>
          {children.map((child) => (
            <li key={child.id} className={styles.row}>
              <StateIcon category={child.category} color={child.color} label={child.stateName} />
              <Link className={styles.rowLink} to={`/issue/${child.identifier}`}>
                <span className={styles.identifier}>{child.identifier}</span>
                <span className={styles.rowTitle}>{child.title}</span>
              </Link>
              {/* Only when it differs. A badge on every row saying what the reader already
                  knows from the header teaches them to stop reading badges. */}
              {child.teamName === null ? null : <Badge>{child.teamName}</Badge>}
              <IconButton
                size="sm"
                variant="ghost"
                icon={<CrossGlyph />}
                aria-label={`Remove ${child.identifier} from this issue`}
                tooltip="Remove from this issue"
                onClick={() => setDetaching(child)}
              />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className={styles.addForm} onSubmit={submit}>
          <Input
            label="Sub-issue title"
            hideLabel
            placeholder="Sub-issue title…"
            value={title}
            autoFocus
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button type="submit" size="sm" variant="primary" disabled={title.trim() === ''}>
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setTitle('');
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {detaching === null ? null : (
        // Confirmed, because "remove" is the word people read as "delete" — and the whole
        // point of this dialog is that it has to say what will actually happen instead of
        // asking a question nobody can answer.
        <ConfirmDialog
          open
          title={`Remove ${detaching.identifier} from this issue?`}
          consequence={`${detaching.identifier} stays exactly as it is — same status, same assignee, same comments — and goes back to being an issue in its own right. Only the link to this one goes.`}
          confirmLabel={`Remove ${detaching.identifier}`}
          onConfirm={() => {
            onDetach(detaching.id);
            setDetaching(null);
          }}
          onClose={() => setDetaching(null)}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------
 * Relations.
 */

/**
 * The five ways one issue can be linked to another, as a reader meets them.
 *
 * Five, from three stored types, because two of them read differently from each end. That is
 * the asymmetry the whole panel exists to hide: the reader thinks in "blocked by" and the
 * database only knows "blocks".
 */
type RelationKind = 'blockedBy' | 'blocking' | 'related' | 'duplicateOf' | 'duplicatedBy';

/**
 * The flag beside a section heading, or nothing.
 *
 * Only the two blocking kinds carry one. A flag on "Related" would be decoration, and a
 * palette where everything is marked marks nothing — these two exist because they are the
 * only relations that say work cannot proceed.
 *
 * `aria-hidden`, because the heading it sits in already says "Blocked by" in words. A screen
 * reader that also announced an image here would read the same fact twice.
 */
function RelationFlag({ kind }: { kind: RelationKind }) {
  if (kind !== 'blockedBy' && kind !== 'blocking') return null;
  const tone = kind === 'blockedBy' ? styles.flagBlocked : styles.flagBlocking;
  return (
    <svg
      className={[styles.flag, tone].join(' ')}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 1.5v9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3 2.25h5.5L7 4.5l1.5 2.25H3z" fill="currentColor" />
    </svg>
  );
}

const KIND_HEADINGS: Readonly<Record<RelationKind, string>> = {
  blockedBy: 'Blocked by',
  blocking: 'Blocking',
  related: 'Related',
  duplicateOf: 'Duplicate of',
  duplicatedBy: 'Duplicated by',
};

/** Blocked by leads: it is the only one of the five that says why this issue is not moving. */
const KIND_ORDER: readonly RelationKind[] = [
  'blockedBy',
  'blocking',
  'related',
  'duplicateOf',
  'duplicatedBy',
];

/**
 * The four a person adds from this end.
 *
 * "Duplicated by" is missing on purpose. It is a real reading — another issue has been marked
 * a duplicate of this one — and it is shown when a row exists, but nobody stands on an issue
 * and declares that some other issue duplicates it: the person who found the duplicate says so
 * from the duplicate. Offering it here would produce rows written from the wrong end.
 */
const ADDABLE: readonly RelationKind[] = ['blockedBy', 'blocking', 'related', 'duplicateOf'];

/**
 * The command-menu wording for each addable kind, and the chord the docs promise.
 *
 * `M` then `R`/`B`/`X` is in 03-issue-properties.md and in the shortcut reference, and was
 * bound to nothing: every relation in the product was mouse-only, and none of the four was
 * reachable from the command menu either. The titles are phrased as the sentence a person
 * types into that menu — "mark as blocked by" — rather than as the section heading, because
 * the heading is what the row is called afterwards and not what the act is called.
 *
 * `duplicateOf` gets a menu entry and no chord. The documented `MM` is a triage-view
 * gesture, and inventing a detail-screen binding for it here would put a key in the product
 * that no doc describes — the opposite of the problem this table exists to fix.
 */
const ADD_ACTIONS: readonly {
  readonly kind: RelationKind;
  readonly id: string;
  readonly title: string;
  readonly keys?: readonly string[];
}[] = [
  {
    kind: 'blockedBy',
    id: 'issueDetail.markBlockedBy',
    title: 'Mark as blocked by…',
    keys: ['m b'],
  },
  { kind: 'blocking', id: 'issueDetail.markBlocking', title: 'Mark as blocking…', keys: ['m x'] },
  { kind: 'related', id: 'issueDetail.markRelated', title: 'Mark as related to…', keys: ['m r'] },
  { kind: 'duplicateOf', id: 'issueDetail.markDuplicateOf', title: 'Mark as duplicate of…' },
];

interface NewLink {
  readonly issueId: UUID;
  readonly relatedIssueId: UUID;
  readonly type: RelationType;
}

/**
 * Which row to write for each thing a person can add, and which way round.
 *
 * `blockedBy` is the load-bearing entry: there is no inverse type, so a blocker is a `blocks`
 * row with the two ids the other way about. Getting this backwards produces a relation that is
 * present, well-formed and says the opposite of what the user asked for — which is why it has
 * a test of its own.
 *
 * `related` is handed over in the order it was given. `createRelation` normalises the pair to
 * smaller-id-first because that is how the server stores it, and doing it here as well would be
 * a second copy of a rule that must not be able to disagree with itself.
 */
const NEW_LINK: Readonly<Record<string, (issueId: UUID, otherId: UUID) => NewLink>> = {
  blockedBy: (issueId, otherId) => ({ issueId: otherId, relatedIssueId: issueId, type: 'blocks' }),
  blocking: (issueId, otherId) => ({ issueId, relatedIssueId: otherId, type: 'blocks' }),
  related: (issueId, otherId) => ({ issueId, relatedIssueId: otherId, type: 'related' }),
  duplicateOf: (issueId, otherId) => ({ issueId, relatedIssueId: otherId, type: 'duplicate' }),
};

interface RelationRow {
  readonly relationId: UUID;
  readonly kind: RelationKind;
  /** Null when the issue at the other end is not in this replica. */
  readonly identifier: string | null;
  readonly title: string | null;
  readonly category: StateCategory | null;
  readonly stateName: string | null;
  readonly color: string | undefined;
  /** The other end's team, when it is known. Named on every row: a link crosses teams often. */
  readonly teamName: string | null;
}

interface Candidate {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
}

export interface RelationsProps {
  issueId: UUID;
  className?: string | undefined;
}

/**
 * An issue's links, in labelled sections, with a box to add one.
 *
 * The picker searches by identifier or by title because those are the two ways people name an
 * issue to each other — "ENG-402" in a standup and "the importer flake" in a message — and a
 * picker that only accepted one of them would be unusable for whoever thinks in the other.
 *
 * The add form is inline rather than a popover, which is a deliberate difference from the due
 * date picker beside it. Escape has to close a popover, Escape is a registered action, and an
 * action's key is claimed once per context — so two popovers in one rail cannot both have one,
 * and the registry throws rather than letting the second one silently lose. Inline needs no
 * Escape at all: it is in the tab order, it has a Cancel button, and nothing is trapped.
 */
export function Relations({ issueId, className }: RelationsProps) {
  const engine = useEngine();
  const viewerId = useViewerId();

  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<RelationKind>('blockedBy');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * One action per addable kind, each opening the form with that kind already chosen.
   *
   * Opening the form is not enough on its own: the box `autoFocus`es when it mounts, so a
   * second chord pressed while the form is already open would change the dropdown and leave
   * the caret wherever it was. The explicit focus covers that, and is a no-op on the first
   * press because the ref is not attached until the effect after this frame.
   */
  useActions(
    ADD_ACTIONS.map((entry) => ({
      id: entry.id,
      title: entry.title,
      ...(entry.keys === undefined ? null : { keys: [...entry.keys] }),
      when: 'detail' as const,
      group: 'Issues',
      run: () => {
        setKind(entry.kind);
        setAdding(true);
        searchRef.current?.focus();
      },
    })),
    [],
  );

  const rows = useLiveQuery(
    (store) => {
      const found: RelationRow[] = [];
      // Both directions, and they cannot overlap: a row names this issue at one end or the
      // other, never both, because an issue cannot be linked to itself.
      for (const id of store.relationIdsFrom(issueId)) collect(store, found, id, false);
      for (const id of store.relationIdsTo(issueId)) collect(store, found, id, true);
      return found;
    },
    ['issueRelation', 'issue', 'workflowState', 'team'],
    [issueId],
  );

  const results = useLiveQuery(
    (store) => searchIssues(store, issueId, query),
    ['issue', 'issueRelation', 'team'],
    [issueId, query],
  );

  const link = (otherId: UUID) => {
    const make = NEW_LINK[kind];
    if (make === undefined) return;
    createRelation(engine, { ...make(issueId, otherId), createdBy: viewerId ?? undefined }).catch(
      report,
    );
    setQuery('');
    setAdding(false);
  };

  const sections = KIND_ORDER.map((section) => ({
    kind: section,
    rows: rows.filter((row) => row.kind === section),
  })).filter((section) => section.rows.length > 0);

  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(' ')}
      aria-label="Linked issues"
    >
      <div className={styles.head}>
        <h2 className={styles.title}>Links</h2>
        <div className={styles.spacer} />
        <Button size="sm" variant="ghost" icon={<PlusGlyph />} onClick={() => setAdding(true)}>
          Add link
        </Button>
      </div>

      {sections.length === 0 && !adding ? (
        <p className={styles.quiet}>Nothing linked to this one.</p>
      ) : null}

      {sections.map((section) => (
        <div key={section.kind} className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <RelationFlag kind={section.kind} />
            {KIND_HEADINGS[section.kind]}
          </h3>
          <ul className={styles.rows}>
            {section.rows.map((row) => (
              <li key={row.relationId} className={styles.row}>
                <RelationSubject row={row} />
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={<CrossGlyph />}
                  aria-label={`Remove the ${KIND_HEADINGS[section.kind].toLowerCase()} link to ${row.identifier ?? 'an issue you cannot see'}`}
                  tooltip="Remove this link"
                  onClick={() => deleteRelation(engine, row.relationId).catch(report)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {adding ? (
        <div className={styles.addForm}>
          <Select
            label="Link type"
            value={kind}
            onChange={(event) => {
              const chosen = ADDABLE.find((candidate) => candidate === event.target.value);
              if (chosen !== undefined) setKind(chosen);
            }}
          >
            {ADDABLE.map((candidate) => (
              <option key={candidate} value={candidate}>
                {KIND_HEADINGS[candidate]}
              </option>
            ))}
          </Select>

          <Input
            ref={searchRef}
            label="Search issues"
            placeholder="Identifier or title…"
            value={query}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />

          {query.trim() === '' ? (
            <p className={styles.note}>Search by identifier or by title — “ENG-402”, “importer”.</p>
          ) : results.length === 0 ? (
            <p className={styles.note}>Nothing here by that name.</p>
          ) : (
            <ul className={styles.results}>
              {results.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className={styles.result}
                    onClick={() => link(candidate.id)}
                  >
                    <span className={styles.identifier}>{candidate.identifier}</span>
                    <span className={styles.rowTitle}>{candidate.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.addFooter}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setQuery('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The issue at the other end of a link, or an honest account of why it is not here.
 *
 * The absent case is a link rather than a row that has been dropped, because the relation is
 * real: the reader is entitled to know that something they cannot open is blocking this, and
 * to remove the link if it is stale. What it must not be is a `<Link>` to a route built out of
 * `undefined`, which is the broken row this branch exists to prevent.
 */
function RelationSubject({ row }: { row: RelationRow }): ReactNode {
  if (row.identifier === null) {
    return (
      <span className={styles.unknown}>
        An issue you cannot see
        {row.teamName === null ? null : <span className={styles.hint}> in {row.teamName}</span>}
      </span>
    );
  }

  return (
    <>
      <StateIcon
        category={row.category ?? 'backlog'}
        color={row.color}
        label={row.stateName ?? 'No status'}
      />
      <Link className={styles.rowLink} to={`/issue/${row.identifier}`}>
        <span className={styles.identifier}>{row.identifier}</span>
        <span className={styles.rowTitle}>{row.title}</span>
      </Link>
      {row.teamName === null ? null : <Badge>{row.teamName}</Badge>}
    </>
  );
}

/** Reads one relation row from the end this issue is standing at, and appends it. */
function collect(store: Store, out: RelationRow[], relationId: UUID, fromOtherEnd: boolean): void {
  const relation = store.get('issueRelation', relationId);
  if (relation === undefined) return;

  const kind = kindOf(relation.type, fromOtherEnd);
  if (kind === null) return;

  const otherId = fromOtherEnd ? relation.issueId : relation.relatedIssueId;
  const otherTeamId = fromOtherEnd ? relation.teamId : relation.relatedTeamId;
  const other = store.issues.get(otherId);
  const teamName = store.get('team', otherTeamId)?.name ?? null;

  if (other === undefined) {
    out.push({
      relationId,
      kind,
      identifier: null,
      title: null,
      category: null,
      stateName: null,
      color: undefined,
      teamName,
    });
    return;
  }

  const state = store.workflowStates.get(other.stateId);
  out.push({
    relationId,
    kind,
    identifier: store.identifierOf(other),
    title: other.title,
    category: state?.category ?? 'backlog',
    stateName: state?.name ?? 'No status',
    color: state?.color,
    teamName,
  });
}

/**
 * Which section a stored row belongs in, given which end of it this issue is.
 *
 * The comparisons are against the store's lower-case spelling and must stay that way. GraphQL
 * declares `RelationType` and its values are `BLOCKS`, `RELATED`, `DUPLICATE`; the client
 * converts at its boundary in `~/gql/enums`. A reader here that compared against the wire form
 * would match nothing at all for a relation that is sitting right there in the replica.
 */
function kindOf(type: RelationType, fromOtherEnd: boolean): RelationKind | null {
  switch (type) {
    case 'blocks':
      return fromOtherEnd ? 'blockedBy' : 'blocking';
    case 'related':
      // Symmetric: the row is stored smaller-id-first, so this issue is at whichever end that
      // put it, and both readings are the same word.
      return 'related';
    case 'duplicate':
      return fromOtherEnd ? 'duplicatedBy' : 'duplicateOf';
    default:
      // A newer server may stream a type this build has never heard of. Dropping the row is
      // better than inventing a heading for it.
      return null;
  }
}

/**
 * Issues that could be linked to this one, by identifier or by title.
 *
 * Two narrowings, because the two things a person types are indexed differently. Titles come
 * out of the trigram index — that is what `store.index.search` is — so a workspace of five
 * thousand issues costs a set intersection rather than a scan. Identifiers cannot: they are
 * derived from the team key at read time and are in no index at all, so they are a walk, and
 * the walk stops at `MAX_RESULTS` rather than at the end of the corpus.
 *
 * Anything already linked is left out. Offering it would produce a duplicate row on the server
 * or a silent no-op, and neither of those is a thing the person clicking it asked for.
 */
function searchIssues(store: Store, issueId: UUID, query: string): Candidate[] {
  const needle = query.trim().toLowerCase();
  // Nothing until something is typed. The alternative is an arbitrary eight issues appearing
  // under the box, which reads as a suggestion the product is not in a position to make.
  if (needle === '') return [];

  const linked = new Set<UUID>([issueId]);
  for (const id of store.relationIdsFrom(issueId)) {
    const row = store.get('issueRelation', id);
    if (row !== undefined) linked.add(row.relatedIssueId);
  }
  for (const id of store.relationIdsTo(issueId)) {
    const row = store.get('issueRelation', id);
    if (row !== undefined) linked.add(row.issueId);
  }

  const byTitle = store.index.search(needle);
  const found: Candidate[] = [];
  for (const issue of store.issues.values()) {
    if (issue.archivedAt !== undefined || linked.has(issue.id)) continue;
    const identifier = store.identifierOf(issue);
    if (!byTitle.has(issue.id) && !identifier.toLowerCase().includes(needle)) continue;
    found.push({ id: issue.id, identifier, title: issue.title });
    if (found.length >= MAX_RESULTS) break;
  }
  // Ordered within the page rather than across the corpus: which eight you get is the store's
  // order, and typing more is how you reach a particular one.
  return found.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/* Two 16px glyphs, drawn here rather than pulled from a set: the component library has no icon
   module, and a dependency for two paths is a dependency to keep current. */

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
