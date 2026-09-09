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

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Badge,
  Button,
  Checkbox,
  ColorPicker,
  EmptyState,
  IconButton,
  Input,
  Menu,
  Select,
  type MenuNode,
} from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { DotsGlyph } from '~/features/issue/glyphs';
import { useContextMenu } from '~/hooks/useContextMenu';
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

  /**
   * The keyboard's way into a row's menu.
   *
   * This screen has no cursor and should not grow one: a label row is a form, and the
   * thing that already says which row the user means is where the keyboard is. So each
   * row reports focus and leaves behind a way to open its own menu, and the one `.`
   * binding below aims at whichever row that is. Registering the action per row would be
   * one `labels.actions` per label, which the registry refuses at mount.
   */
  const [focusedId, setFocusedId] = useState<UUID | null>(null);
  const openers = useRef(new Map<UUID, () => void>());

  const registerMenu = useCallback((id: UUID, open: (() => void) | null) => {
    if (open === null) openers.current.delete(id);
    else openers.current.set(id, open);
  }, []);

  useKeyContext('list');

  useActions(
    [
      {
        id: 'labels.actions',
        title: 'Show actions for the label',
        keys: ['.'],
        when: 'list',
        group: 'Labels',
        enabled: () => focusedId !== null && openers.current.has(focusedId),
        run: () => {
          if (focusedId === null) return;
          openers.current.get(focusedId)?.();
        },
      },
    ],
    [focusedId],
  );

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
                      onFocusRow={setFocusedId}
                      registerMenu={registerMenu}
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
                              onFocusRow={setFocusedId}
                              registerMenu={registerMenu}
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

      <ColorPicker label="Colour" className={styles.color} value={color} onChange={setColor} />

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

/** "Fourteen issues" / "One issue", as prose rather than as a machine's output. */
function mergeUses(row: LabelView): string {
  if (row.uses === 0) return 'No issues';
  return row.uses === 1 ? 'The one issue' : `All ${String(row.uses)} issues`;
}

interface LabelRowProps {
  row: LabelView;
  mergeInto?: readonly LabelView[];
  onEdit: (fields: { name?: string; color?: string }) => void;
  onArchive: () => void;
  onMerge?: ((intoId: UUID) => void) | undefined;
  onUngroup?: (() => void) | undefined;
  /** Reports where the keyboard is, so the screen's `.` binding knows which row it means. */
  onFocusRow?: ((id: UUID) => void) | undefined;
  /** Leaves behind a way to open this row's menu, and takes it back on unmount. */
  registerMenu?: ((id: UUID, open: (() => void) | null) => void) | undefined;
}

function LabelRow({
  row,
  mergeInto = [],
  onEdit,
  onArchive,
  onMerge,
  onUngroup,
  onFocusRow,
  registerMenu,
}: LabelRowProps) {
  const [name, setName] = useState(row.name);
  const mergeRef = useRef<HTMLButtonElement>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<LabelView | null>(null);

  const rowRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const contextMenu = useContextMenu<UUID>({ returnFocusTo: kebabRef });

  // A ref rather than the callback itself: the opener is registered once per row and must
  // not re-register on every render, but it still has to reach the current `openOn`.
  const openHere = useRef<() => void>(() => undefined);
  openHere.current = () => {
    const element = rowRef.current;
    if (element !== null) contextMenu.openOn(element, row.id);
  };

  useEffect(() => {
    if (registerMenu === undefined) return;
    registerMenu(row.id, () => openHere.current());
    return () => registerMenu(row.id, null);
  }, [registerMenu, row.id]);

  const closeMenus = () => {
    setKebabOpen(false);
    contextMenu.close();
  };

  /**
   * One array, drawn by the ⋯ button and by the right-click alike.
   *
   * Merge is a submenu here rather than a second dialog: the choice of what to merge into
   * is the command, and the standing `Merge…` button beside the row opens the same list
   * into the same confirmation.
   */
  const itemsFor = (target: LabelView): MenuNode[] => {
    const properties: MenuNode[] = [
      {
        id: 'rename',
        label: 'Rename…',
        onSelect: () => {
          closeMenus();
          // The row's own field, which is where renaming already happens. A second inline
          // editor would be a second commit path for one mutation.
          requestAnimationFrame(() => {
            nameRef.current?.focus();
            nameRef.current?.select();
          });
        },
      },
    ];

    if (onMerge !== undefined && mergeInto.length > 0) {
      properties.push({
        kind: 'submenu',
        id: 'merge',
        label: 'Merge…',
        filterable: mergeInto.length > 8,
        filterPlaceholder: 'Find a label',
        items: mergeInto.map((other) => ({
          id: other.id,
          label: other.name,
          onSelect: () => {
            closeMenus();
            setMergeTarget(other);
          },
        })),
      });
    }

    if (onUngroup !== undefined) {
      properties.push({
        id: 'ungroup',
        label: 'Remove from group',
        onSelect: () => {
          closeMenus();
          onUngroup();
        },
      });
    }

    const items = entityRowMenuItems(
      { noun: 'label', name: target.name },
      {
        properties,
        // Offered only when it can succeed. The count says why when it cannot, exactly as
        // the disabled button beside the row does.
        ...(target.uses > 0
          ? null
          : {
              archive: () => {
                closeMenus();
                setArchiving(true);
              },
              archiveLabel: 'Archive label',
            }),
      },
    );

    if (target.uses > 0) {
      items.push(
        { kind: 'separator' },
        {
          id: 'archive',
          label: 'Archive label',
          danger: true,
          disabled: true,
          hint: `${target.uses} ${target.uses === 1 ? 'issue' : 'issues'}`,
          onSelect: () => undefined,
        },
      );
    }

    return items;
  };

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
    <div
      ref={rowRef}
      className={styles.row}
      onFocusCapture={() => onFocusRow?.(row.id)}
      onContextMenu={(event) => {
        contextMenu.openFromEvent(event, row.id);
      }}
    >
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
          ref={nameRef}
          label={`Name of ${row.name}`}
          hideLabel
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
        />
      </form>

      {/*
       * One mutation per chosen colour.
       *
       * This was a bare `<Input type="color">` whose comment claimed "the native picker emits
       * one change when the user is done with it". It does not — React maps a colour input's
       * onChange to the DOM `input` event, which fires continuously while the picker is
       * dragged, so one colour change emitted dozens of `updateLabel` calls, each with its own
       * version and change row, fanned out to every other client. `ColorPicker` commits on a
       * discrete act, the way `commitName` right above it does.
       */}
      <ColorPicker
        label={`Colour of ${row.name}`}
        className={styles.color}
        value={row.color}
        onChange={(color) => onEdit({ color })}
      />

      {row.isGroup ? <Badge>Group</Badge> : <span />}

      <span className={styles.uses}>
        {row.isGroup ? '' : `${row.uses} ${row.uses === 1 ? 'issue' : 'issues'}`}
      </span>

      {/*
       * Merge is a command, not a form value, and it is now drawn as one.
       *
       * It used to be a `<select>` calling `onMerge` straight out of `onChange`: one arrow
       * key on a keyboard-navigated control relabelled every issue that carried the label
       * and destroyed the label, with no confirmation and nothing to undo it. Archiving —
       * strictly the milder of the two — was already guarded. The composition doc draws the
       * same line: a native select is for a plain form value, a Menu is for a command.
       */}
      {onMerge === undefined || mergeInto.length === 0 ? (
        <span />
      ) : (
        <>
          <Button
            ref={mergeRef}
            size="sm"
            aria-label={`Merge ${row.name} into another label`}
            aria-haspopup="menu"
            aria-expanded={mergeOpen}
            onClick={() => setMergeOpen(true)}
          >
            Merge…
          </Button>
          <Menu
            open={mergeOpen}
            onClose={() => setMergeOpen(false)}
            trigger={mergeRef}
            label={`Merge ${row.name} into`}
            filterable={mergeInto.length > 8}
            filterPlaceholder="Find a label"
            items={mergeInto.map((other) => ({
              id: other.id,
              label: other.name,
              onSelect: () => setMergeTarget(other),
            }))}
          />
          <ConfirmDialog
            open={mergeTarget !== null}
            title={mergeTarget === null ? '' : `Merge ${row.name} into ${mergeTarget.name}?`}
            consequence={
              mergeTarget === null
                ? ''
                : `${mergeUses(row)} that carry ${row.name} will carry ${mergeTarget.name} instead, and ${row.name} will be deleted. There is no undo for this.`
            }
            confirmLabel={mergeTarget === null ? 'Merge' : `Merge into ${mergeTarget.name}`}
            destructive
            onClose={() => setMergeTarget(null)}
            onConfirm={() => {
              const into = mergeTarget;
              setMergeTarget(null);
              if (into !== null) onMerge(into.id);
            }}
          />
        </>
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
          onClick={() => setArchiving(true)}
        />
        {/* The same array the right-click opens. Right-click alone is unreachable on a
            touch screen, and invisible on any other. */}
        <IconButton
          ref={kebabRef}
          aria-label={`Options for ${row.name}`}
          aria-haspopup="menu"
          aria-expanded={kebabOpen}
          icon={<DotsGlyph />}
          onClick={() => setKebabOpen(true)}
        />
      </span>

      <Menu
        open={kebabOpen}
        onClose={() => setKebabOpen(false)}
        trigger={kebabRef}
        label={`Options for ${row.name}`}
        density="compact"
        items={itemsFor(row)}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={`Options for ${row.name}`}
        density="compact"
        items={itemsFor(row)}
      />

      <ConfirmDialog
        open={archiving}
        title={`Archive ${row.name}?`}
        consequence={`${row.name} stops being offered on new issues. Archiving is refused while anything still carries it.`}
        confirmLabel="Archive"
        destructive
        onClose={() => setArchiving(false)}
        onConfirm={() => {
          setArchiving(false);
          onArchive();
        }}
      />
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
