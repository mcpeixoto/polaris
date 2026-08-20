/**
 * Label settings: creating, renaming, recolouring, grouping and archiving labels.
 *
 * Three things here are heavier than they look, and all three are consequences of decisions
 * taken in the schema rather than choices this screen is free to make.
 *
 * A **group** is a label with `isGroup` set, not a separate kind of thing. That is why the
 * tree below is one level deep and cannot be more: a group cannot sit inside a group, and a
 * group can never be applied to an issue. It is also why creating one is a checkbox on the
 * create form rather than a second form.
 *
 * A label's **scope** — workspace or one team — is fixed at creation and is not editable
 * here. Moving a team label to the workspace would hand every team a label they never agreed
 * to; moving one the other way would unapply it from every other team's issues without
 * saying so. The server refuses both, and a control that exists only to be refused is worse
 * than no control.
 *
 * **Archiving is refused while anything still carries the label**, so the count of issues
 * using it sits next to the button. A refusal you could have predicted is a rule; one you
 * could not is an error message.
 */

import { useMemo, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Badge, Button, Checkbox, EmptyState, IconButton, Input, Select } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import {
  archiveLabel,
  createLabel,
  DEFAULT_LABEL_COLOR,
  mergeLabels,
  updateLabel,
} from './mutations';
import styles from './LabelSettings.module.css';

interface LabelView {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly isGroup: boolean;
  readonly teamId: UUID | undefined;
  readonly parentId: UUID | undefined;
  readonly position: string;
  /** How much work rides on it, which is what decides whether archiving will be refused. */
  readonly uses: number;
}

interface Scope {
  readonly id: string;
  readonly label: string;
  readonly teamId: UUID | undefined;
}

/** The scope key a workspace label carries, mirroring the database's all-zero sentinel. */
const WORKSPACE_SCOPE = 'workspace';

export function LabelSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const { labels, scopes } = useLiveQuery(
    (store: Store) => {
      const teams = [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.key.localeCompare(b.key));

      const rows: LabelView[] = [];
      for (const label of store.labels.values()) {
        if (label.archivedAt !== undefined) continue;
        rows.push({
          id: label.id,
          name: label.name,
          color: label.color,
          isGroup: label.isGroup,
          teamId: label.teamId,
          parentId: label.parentId,
          position: label.position,
          // Counted from the postings index rather than by scanning issues: a workspace
          // with sixty labels would otherwise walk every issue sixty times per render.
          uses: store.issueIdsWithLabel(label.id).size,
        });
      }

      return {
        labels: rows,
        scopes: [
          { id: WORKSPACE_SCOPE, label: 'Workspace', teamId: undefined },
          ...teams.map((team) => ({ id: team.id, label: team.name, teamId: team.id })),
        ] as Scope[],
      };
    },
    // issueLabel is in the list because the usage count is derived from it: without it the
    // count beside "Archive" goes stale the moment somebody labels an issue, and the button
    // starts refusing for reasons the screen is no longer showing.
    ['label', 'issueLabel', 'team'],
  );

  const grouped = useMemo(() => groupByScope(labels, scopes), [labels, scopes]);

  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((failure: unknown) => {
      // A duplicate name in one scope and a still-in-use archive are both things the user
      // can act on, so the server's own words are better than anything invented here.
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
    });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Labels</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          // A live region: the failure it reports is the answer to an action the user just
          // took, and one that only appears visually is one a screen-reader user performs
          // twice.
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {grouped.map((scope) => (
          <section key={scope.id} className={styles.section} aria-labelledby={`scope-${scope.id}`}>
            <h2 className={styles.sectionTitle} id={`scope-${scope.id}`}>
              {scope.label}
              {scope.teamId === undefined ? <Badge tone="accent">Every team</Badge> : null}
            </h2>
            <p className={styles.sectionHint}>
              {scope.teamId === undefined
                ? 'Offered on every issue in the workspace.'
                : `Offered only on ${scope.label}'s issues.`}
            </p>

            <CreateLabel
              scope={scope}
              groups={scope.roots.filter((row) => row.isGroup)}
              onCreate={(input) => run(createLabel(engine, input))}
            />

            {scope.roots.length === 0 ? (
              <EmptyState
                title="No labels yet"
                description="Labels are how work is described beyond its status — a bug, a regression, the thing blocking the release."
              />
            ) : (
              <ul className={styles.tree}>
                {scope.roots.map((row) => (
                  <li key={row.id}>
                    <LabelRow
                      row={row}
                      mergeInto={
                        row.isGroup
                          ? []
                          : scope.roots.filter((other) => !other.isGroup && other.id !== row.id)
                      }
                      onEdit={(fields) => run(updateLabel(engine, row.id, fields))}
                      onArchive={() => run(archiveLabel(engine, row.id))}
                      onMerge={(intoId) => run(mergeLabels(engine, row.id, intoId))}
                    />
                    {!row.isGroup ? null : (
                      <ul className={styles.children}>
                        {(scope.children.get(row.id) ?? []).map((child) => (
                          <li key={child.id}>
                            <LabelRow
                              row={child}
                              mergeInto={(scope.children.get(row.id) ?? []).filter(
                                (other) => other.id !== child.id,
                              )}
                              onEdit={(fields) => run(updateLabel(engine, child.id, fields))}
                              onArchive={() => run(archiveLabel(engine, child.id))}
                              onMerge={(intoId) => run(mergeLabels(engine, child.id, intoId))}
                              onUngroup={() =>
                                run(updateLabel(engine, child.id, { parentId: null }))
                              }
                            />
                          </li>
                        ))}
                        {(scope.children.get(row.id) ?? []).length > 0 ? null : (
                          <li className={styles.quiet}>
                            Empty. An issue can carry at most one label from a group, which is what
                            makes a group worth having.
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

interface CreateLabelProps {
  scope: Scope;
  groups: readonly LabelView[];
  onCreate: (input: {
    name: string;
    teamId?: UUID | undefined;
    parentId?: UUID | undefined;
    isGroup?: boolean | undefined;
    color?: string | undefined;
  }) => void;
}

function CreateLabel({ scope, groups, onCreate }: CreateLabelProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [parentId, setParentId] = useState('');
  const [isGroup, setIsGroup] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;

    onCreate({
      name: trimmed,
      teamId: scope.teamId,
      // A group cannot sit inside a group, so the picker is not merely hidden — the value
      // is dropped, in case the checkbox was ticked after a group was chosen.
      parentId: isGroup || parentId === '' ? undefined : parentId,
      isGroup,
      color,
    });
    setName('');
    setParentId('');
    setIsGroup(false);
  };

  return (
    <form className={styles.create} onSubmit={submit}>
      <Input
        label="Name"
        value={name}
        placeholder={isGroup ? 'Priority' : 'bug'}
        onChange={(event) => setName(event.target.value)}
      />

      <Select
        label="Group"
        value={parentId}
        // Groups do not nest, so there is nothing to offer a group being created.
        disabled={isGroup || groups.length === 0}
        onChange={(event) => setParentId(event.target.value)}
      >
        <option value="">No group</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </Select>

      <div className={styles.color}>
        <Input
          type="color"
          label="Colour"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
      </div>

      <Button type="submit" variant="primary" disabled={name.trim() === ''}>
        Add
      </Button>

      <div className={styles.createOptions}>
        <Checkbox
          checked={isGroup}
          onChange={(event) => setIsGroup(event.target.checked)}
          label={
            <>
              A group of labels
              <span className={styles.quiet}>
                {' '}
                — a container, not a label. An issue can carry at most one label from it, and the
                group itself is never applied to anything.
              </span>
            </>
          }
        />
      </div>
    </form>
  );
}

interface LabelRowProps {
  row: LabelView;
  mergeInto?: readonly LabelView[];
  onEdit: (fields: { name?: string; color?: string }) => void;
  onArchive: () => void;
  onMerge?: ((intoId: UUID) => void) | undefined;
  onUngroup?: (() => void) | undefined;
}

function LabelRow({ row, mergeInto = [], onEdit, onArchive, onMerge, onUngroup }: LabelRowProps) {
  const [name, setName] = useState(row.name);

  // Committed on blur rather than on every keystroke. Each keystroke is a mutation with its
  // own version and its own change row, and a fourteen-character rename would put fourteen
  // entries through the sync stream to every other client.
  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === row.name) {
      setName(row.name);
      return;
    }
    onEdit({ name: trimmed });
  };

  return (
    <div className={styles.row}>
      {/*
       * A form purely so that Enter commits.
       *
       * The obvious alternative is a local key handler, which the keymap lint refuses for
       * good reason: a handler scattered in a component is one the command menu and the
       * help overlay cannot see. Submitting a form is the platform's own answer to the
       * same problem and needs no handler at all.
       */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          commitName();
        }}
      >
        <Input
          label={`Name of ${row.name}`}
          hideLabel
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
        />
      </form>

      <div className={styles.color}>
        <Input
          type="color"
          label={`Colour of ${row.name}`}
          hideLabel
          value={row.color}
          // Colour has no blur to wait for and no half-typed state: the native picker emits
          // one change when the user is done with it.
          onChange={(event) => onEdit({ color: event.target.value })}
        />
      </div>

      {row.isGroup ? <Badge>Group</Badge> : <span />}

      <span className={styles.uses}>
        {row.isGroup ? '' : `${row.uses} ${row.uses === 1 ? 'issue' : 'issues'}`}
      </span>

      {onMerge === undefined || mergeInto.length === 0 ? (
        <span />
      ) : (
        <Select
          label={`Merge ${row.name} into`}
          hideLabel
          value=""
          onChange={(event) => {
            const intoId = event.target.value;
            if (intoId === '') return;
            onMerge(intoId);
          }}
        >
          <option value="">Merge into…</option>
          {mergeInto.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name}
            </option>
          ))}
        </Select>
      )}

      <span>
        {onUngroup === undefined ? null : (
          <IconButton
            aria-label={`Take ${row.name} out of its group`}
            icon={<UngroupIcon />}
            onClick={onUngroup}
          />
        )}
        <IconButton
          aria-label={
            row.uses > 0
              ? `${row.name} is on ${row.uses} ${row.uses === 1 ? 'issue' : 'issues'} and cannot be archived`
              : `Archive ${row.name}`
          }
          icon={<ArchiveIcon />}
          // Disabled rather than hidden, with the count beside it saying why. A control that
          // vanishes reads as a missing feature; one that is disabled with a reason reads as
          // a rule.
          disabled={row.uses > 0}
          onClick={onArchive}
        />
      </span>
    </div>
  );
}

interface ScopeGroup extends Scope {
  readonly roots: LabelView[];
  readonly children: Map<UUID, LabelView[]>;
}

/**
 * Splits labels into their scopes, and each scope into groups and their children.
 *
 * Ordered by the fractional position, which is only comparable within one scope — comparing
 * a workspace label's key against a team label's is comparing two unrelated numbers and
 * produces an order that looks almost right.
 */
function groupByScope(labels: readonly LabelView[], scopes: readonly Scope[]): ScopeGroup[] {
  const byPosition = (a: LabelView, b: LabelView) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name);

  return scopes.map((scope) => {
    const mine = labels.filter((row) => (row.teamId ?? undefined) === scope.teamId);
    const children = new Map<UUID, LabelView[]>();

    for (const row of mine) {
      if (row.parentId === undefined) continue;
      const siblings = children.get(row.parentId);
      if (siblings === undefined) children.set(row.parentId, [row]);
      else siblings.push(row);
    }
    for (const siblings of children.values()) siblings.sort(byPosition);

    return {
      ...scope,
      roots: mine.filter((row) => row.parentId === undefined).sort(byPosition),
      children,
    };
  });
}

/* Two 16px glyphs, drawn here rather than pulled from a set: the component library has no
   icon module, and a dependency for two paths is a dependency to keep current. */

function UngroupIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="16" height="16">
      <path
        d="M8 11V4M5 7l3-3 3 3M3 13h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="16" height="16">
      <path
        d="M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7ZM2 3h12v2.5H2V3Zm4 5h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
