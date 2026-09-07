/**
 * One initiative: what it is for, how far along it is, and the work that rolls up into it.
 *
 * The properties are a rail, not a form. They used to be a two-column grid of native
 * `<select>`s and an `<input type="date">` sitting in the middle of the reading column,
 * ahead of the description — so the page opened on six form controls rather than on what
 * the initiative is about, and the same facts wore different clothes here and on the issue
 * a click away. The rail is `IssueDetail`'s: one ghost row per property, its label hidden
 * for the accessibility tree, its value carrying the glyph that names it.
 *
 * Nothing here has a Save button. Every property writes on choice and the description
 * writes on blur, which is what `SaveIndicator` is for — the screen used to explain that
 * arrangement in a line of body copy ("Every property here saves on its own…"), and a
 * sentence explaining a save model is the shape of a missing indicator.
 *
 * The two "add" rows are `Section` "+" affordances over the shared pickers. An unbounded
 * `<select>` of every project in the workspace is unusable past a few dozen and offers no
 * way to search; the pickers rank and filter, and are the same ones the composer uses.
 * Removing a project and un-nesting an initiative both ask first: they are one click, they
 * throw away a link somebody made deliberately, and there is no undo for either.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  IconButton,
  Input,
  LabelChip,
  Menu,
  PRIORITY_LEVELS,
  PriorityIcon,
  priorityLabel,
  SaveIndicator,
  Section,
  SegmentedControl,
  Select,
  StateIcon,
  Textarea,
  useSaveState,
  type MenuNode,
} from '~/components';
import { DescriptionEditor } from '~/editor/DescriptionEditor';
import {
  addInitiativeProject,
  addInitiativeRelation,
  createInitiative,
  formatInitiativeStatus,
  INITIATIVE_STATUS_ICON,
  INITIATIVE_STATUSES,
  removeInitiativeProject,
  removeInitiativeRelation,
  updateInitiative,
} from '~/features/initiatives/mutations';
import { InitiativePicker } from '~/features/initiatives/InitiativePicker';
import {
  applyInitiativeLabel,
  removeInitiativeLabel,
} from '~/features/initiative-labels/mutations';
import { InitiativeLabelPicker } from '~/features/initiative-labels/InitiativeLabelPicker';
import { createInitiativeUpdate } from '~/features/initiative-updates/mutations';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { InitiativeGraph } from '~/features/initiatives/InitiativeGraph';
import { ProgressBar } from '~/features/initiatives/ProgressBar';
import {
  initiativeProgress,
  listInitiativeProjectRows,
  type InitiativeProjectRow,
} from '~/features/initiatives/progress';
import { CalendarGlyph, PlusGlyph, UnassignedGlyph } from '~/features/issue/glyphs';
import { UserPicker } from '~/features/members/UserPicker';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { formatTimeframe } from '~/features/projects/properties';
import { PROJECT_STATUS_ICON } from '~/features/projects/statusCategories';
import { personName } from '~/features/prefs/prefs';
import { exact, when, whenDay } from '~/features/time';
import { HealthDot, ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { report } from '~/features/issue/mutations';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type {
  InitiativeLabel,
  ProjectUpdateHealth,
  Store,
  TimeframeGranularity,
  UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import styles from './InitiativeDetail.module.css';

interface ChildRow {
  readonly id: UUID;
  readonly name: string;
}

/** What a remove/un-nest confirmation is about, so one dialog serves both sections. */
interface Pending {
  readonly kind: 'project' | 'child';
  readonly id: UUID;
  readonly name: string;
}

const HEALTH_OPTIONS: readonly { readonly value: ProjectUpdateHealth; readonly label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
];

/** The five precisions a target date can be meant at, shortest word each. */
const GRANULARITIES: readonly { readonly value: TimeframeGranularity; readonly label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'half', label: 'Half' },
  { value: 'year', label: 'Year' },
];

export function InitiativeDetail() {
  const engine = useEngine();
  const viewer = useViewer();
  const viewerId = useViewerId();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [nestedName, setNestedName] = useState('');
  const [nestError, setNestError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const owner = useMenuTrigger();
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const leadTeam = useMenuTrigger();
  const target = useMenuTrigger('dialog');
  const labelsMenu = useMenuTrigger();
  const childPicker = useMenuTrigger();
  const projectPicker = useMenuTrigger();

  const saveState = useSaveState(describeRefusal);
  const { run: runSave } = saveState;

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'initiativeDetail.labels',
        title: 'Set labels',
        keys: ['l'],
        when: 'detail',
        group: 'Initiatives',
        run: () => labelsMenu.show(),
      },
      {
        id: 'initiative.owner',
        title: 'Set initiative owner',
        keys: ['a'],
        when: 'detail',
        group: 'Initiatives',
        run: () => owner.show(),
      },
      {
        id: 'initiative.targetDate',
        title: 'Set initiative target date',
        keys: ['shift+t'],
        when: 'detail',
        group: 'Initiatives',
        run: () => target.show(),
      },
    ],
    [initiativeId],
  );

  const initiative = useLiveQuery(
    (store) => store.initiatives.get(initiativeId) ?? null,
    ['initiative'],
    [initiativeId],
  );

  const latest = useLiveQuery(
    (store) => latestInitiativeUpdate(store, initiativeId),
    ['initiativeUpdate', 'user'],
    [initiativeId],
  );

  const latestAuthor = useLiveQuery(
    (store) => {
      if (latest === undefined) return null;
      const author = store.users.get(latest.authorId);
      // `personName` rather than `.displayName`: the "full names" preference is one answer
      // for the whole product, and this screen and the list beside it disagreed on it.
      return author === undefined ? null : personName(author);
    },
    ['user', 'initiativeUpdate'],
    [initiativeId, latest?.authorId ?? ''],
  );

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = personName(user);
      return out;
    },
    ['user'],
  );

  const ownerName = useLiveQuery(
    (store) => {
      const id = initiative?.ownerId;
      if (id === undefined) return null;
      const person = store.users.get(id);
      return person === undefined ? null : personName(person);
    },
    ['user', 'initiative'],
    [initiativeId, initiative?.ownerId ?? ''],
  );

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({ id: team.id, name: team.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['team'],
  );

  const projects = useLiveQuery(
    (store) => listInitiativeProjectRows(store, initiativeId),
    [
      'initiative',
      'initiativeProject',
      'initiativeRelation',
      'issue',
      'project',
      'projectStatus',
      'projectUpdate',
      'user',
    ],
    [initiativeId],
  );

  const progress = useLiveQuery(
    (store) => initiativeProgress(store, initiativeId),
    ['initiative', 'initiativeProject', 'initiativeRelation', 'issue', 'project'],
    [initiativeId],
  );

  const labelIds = useLiveQuery(
    (store) => [...store.initiativeLabelIdsFor(initiativeId)],
    ['initiativeLabel', 'initiativeLabelLink'],
    [initiativeId],
  );

  const appliedLabels = useLiveQuery(
    (store) =>
      [...store.initiativeLabelIdsFor(initiativeId)]
        .map((id) => store.initiativeLabels.get(id))
        .filter(
          (label): label is InitiativeLabel =>
            label !== undefined && label.archivedAt === undefined,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['initiativeLabel', 'initiativeLabelLink'],
    [initiativeId],
  );

  const children = useLiveQuery(
    (store) => (initiative === null ? [] : listChildren(store, initiative.id)),
    ['initiative', 'initiativeRelation'],
    [initiativeId],
  );

  // The initiative itself and everything already under it: an initiative cannot be its own
  // parent, and offering a child that is already nested is offering a refusal.
  const excludedChildren = useMemo(
    () => new Set<UUID>([initiativeId, ...children.map((row) => row.id)]),
    [initiativeId, children],
  );

  if (initiative === null) return null;

  const save = (fields: Parameters<typeof updateInitiative>[2]) => {
    void runSave(() => updateInitiative(engine, initiative.id, fields));
  };

  const onAddProject = async (projectId: UUID) => {
    setProjectError(null);
    try {
      await addInitiativeProject(engine, initiative.id, projectId);
    } catch (failure) {
      setProjectError(refusal(failure, 'That project could not be added.'));
    }
  };

  const onRemoveProject = async (projectId: UUID) => {
    setProjectError(null);
    try {
      await removeInitiativeProject(engine, initiative.id, projectId);
    } catch (failure) {
      setProjectError(refusal(failure, 'That project could not be removed.'));
    }
  };

  const onNestExisting = async (childId: UUID) => {
    setNestError(null);
    try {
      await addInitiativeRelation(engine, initiative.id, childId);
    } catch (failure) {
      setNestError(refusal(failure, 'That initiative could not be nested.'));
    }
  };

  const onCreateNested = async () => {
    const name = nestedName.trim();
    if (name === '') return;
    setNestError(null);
    setNestedName('');
    try {
      await createInitiative(engine, {
        name,
        ownerId: viewerId ?? undefined,
        parentInitiativeId: initiative.id,
      });
    } catch (failure) {
      setNestedName((current) => (current === '' ? name : current));
      setNestError(refusal(failure, 'That sub-initiative could not be created.'));
    }
  };

  const onUnnest = async (childId: UUID) => {
    setNestError(null);
    try {
      await removeInitiativeRelation(engine, initiative.id, childId);
    } catch (failure) {
      setNestError(refusal(failure, 'That initiative could not be un-nested.'));
    }
  };

  const onSubmitUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || viewerId === null) return;
    setPosting(true);
    setUpdateError(null);
    try {
      await createInitiativeUpdate(engine, {
        initiativeId: initiative.id,
        health,
        body,
        authorId: viewerId,
      });
      setBody('');
    } catch (failure) {
      setUpdateError(refusal(failure, 'That update could not be posted.'));
    } finally {
      setPosting(false);
    }
  };

  const confirmPending = () => {
    if (pending === null) return;
    if (pending.kind === 'project') void onRemoveProject(pending.id);
    else void onUnnest(pending.id);
    setPending(null);
  };

  const statusItems: MenuNode[] = INITIATIVE_STATUSES.map((value) => ({
    id: value,
    label: formatInitiativeStatus(value),
    icon: <StateIcon category={INITIATIVE_STATUS_ICON[value]} decorative />,
    selected: value === initiative.status,
    onSelect: () => save({ status: value }),
  }));

  const priorityItems: MenuNode[] = PRIORITY_LEVELS.map((level) => ({
    id: String(level),
    label: priorityLabel(level),
    icon: <PriorityIcon priority={level} decorative />,
    selected: level === initiative.priority,
    onSelect: () => save({ priority: level }),
  }));

  const teamItems: MenuNode[] = [
    {
      id: 'none',
      label: 'No lead team',
      selected: initiative.leadTeamId === undefined,
      onSelect: () => save({ leadTeamId: null }),
    },
    ...teams.map((team): MenuNode => ({
      id: team.id,
      label: team.name,
      selected: team.id === initiative.leadTeamId,
      onSelect: () => save({ leadTeamId: team.id }),
    })),
  ];

  const granularity = initiative.targetDateGranularity ?? 'day';

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Progress</h2>
          <ProgressBar progress={progress} label={initiative.name} />
          <p className={styles.muted}>
            {progress.total === 0
              ? 'No issues in the linked projects yet.'
              : `${progress.completed} of ${progress.total} issues completed across ${
                  projects.length === 1 ? '1 project' : `${projects.length} projects`
                }.`}
          </p>
          <InitiativeGraph initiativeId={initiative.id} />
        </section>

        {/* Autosaving on blur, like every other description in the product. It used to sit
            behind an explicit Edit / Save / Cancel — the only entity here that worked that
            way, and the reason a description typed and then navigated away from was lost. */}
        <section className={styles.section} aria-labelledby="initiative-description">
          <h2 className={styles.sectionTitle} id="initiative-description">
            Description
          </h2>
          <DescriptionEditor
            target={{ kind: 'initiative', id: initiative.id }}
            description={initiative.description}
            names={names}
            viewerId={viewerId}
            enterSubmits={false}
            onSave={(description) => save({ description })}
          />
        </section>

        {latest !== undefined && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Latest update</h2>
            <div className={styles.latestMeta}>
              <ProjectHealthBadge health={latest.health} />
              {latestAuthor !== null && (
                <span className={styles.metaText} title={exact(latest.createdAt)}>
                  {latestAuthor} · {when(latest.createdAt)}
                </span>
              )}
            </div>
            {latest.body !== '' && <p className={styles.description}>{latest.body}</p>}
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Post an update</h2>
          <form className={styles.form} onSubmit={onSubmitUpdate}>
            <Select
              label="Health"
              value={health}
              prefix={<HealthDot health={health} />}
              onChange={(event) => setHealth(event.target.value as ProjectUpdateHealth)}
            >
              {HEALTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Textarea
              label="Update"
              value={body}
              minRows={4}
              placeholder="What changed since the last update?"
              onChange={(event) => setBody(event.target.value)}
            />
            {updateError === null ? null : (
              <p className={styles.error} role="alert">
                {updateError}
              </p>
            )}
            <div className={styles.addRow}>
              <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
                Post update
              </Button>
            </div>
          </form>
        </section>

        <Section
          title="Sub-initiatives"
          count={children.length === 0 ? undefined : children.length}
          className={styles.section}
          action={
            <IconButton
              {...childPicker.props}
              size="sm"
              icon={<PlusGlyph />}
              aria-label="Nest an existing initiative"
              tooltip="Nest an existing initiative"
            />
          }
        >
          {children.length === 0 ? (
            <EmptyState
              title="No sub-initiatives"
              description="Nest an existing initiative, or start one under this objective."
            />
          ) : (
            <ul className={styles.projectList}>
              {children.map((row) => (
                <li key={row.id} className={styles.childRow}>
                  <Link to={`/initiative/${row.id}`} className={styles.projectLink}>
                    {row.name}
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() => setPending({ kind: 'child', id: row.id, name: row.name })}
                  >
                    Un-nest
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {nestError === null ? null : (
            <p className={styles.error} role="alert">
              {nestError}
            </p>
          )}
          <div className={styles.addRow}>
            <Input
              label="New sub-initiative"
              className={styles.addField}
              value={nestedName}
              onChange={(event) => setNestedName(event.target.value)}
            />
            <Button disabled={nestedName.trim() === ''} onClick={() => void onCreateNested()}>
              Create nested
            </Button>
          </div>
        </Section>

        <Section
          title="Projects"
          count={projects.length === 0 ? undefined : projects.length}
          className={styles.section}
          action={
            <IconButton
              {...projectPicker.props}
              size="sm"
              icon={<PlusGlyph />}
              aria-label="Add a project"
              tooltip="Add a project"
            />
          }
        >
          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Add the work streams that contribute to this initiative."
            />
          ) : (
            <ul className={styles.projectList}>
              {projects.map((row) => (
                <ProjectRow
                  key={row.projectId}
                  row={row}
                  onRemove={() =>
                    setPending({ kind: 'project', id: row.projectId, name: row.name })
                  }
                />
              ))}
            </ul>
          )}
          {projectError === null ? null : (
            <p className={styles.error} role="alert">
              {projectError}
            </p>
          )}
        </Section>
      </div>

      <aside className={styles.rail} aria-label="Initiative properties">
        <div className={styles.railHead}>
          <h2 className={styles.railTitle}>Properties</h2>
          <SaveIndicator state={saveState.state} />
        </div>
        {saveState.error === undefined ? null : (
          <p className={styles.error} role="alert">
            {saveState.error}
          </p>
        )}

        {/* Every row names itself for the accessibility tree and shows its glyph and value
            on screen, which is how the issue rail beside it is drawn. */}
        <div className={styles.property}>
          <span className={styles.srOnly} id="initiative-status-label">
            Status
          </span>
          <Button
            {...status.props}
            variant="ghost"
            fullWidth
            className={styles.propertyTrigger}
            aria-describedby="initiative-status-label"
            icon={<StateIcon category={INITIATIVE_STATUS_ICON[initiative.status]} decorative />}
          >
            {formatInitiativeStatus(initiative.status)}
          </Button>
        </div>

        <div className={styles.property}>
          <span className={styles.srOnly} id="initiative-priority-label">
            Priority
          </span>
          <Button
            {...priority.props}
            variant="ghost"
            fullWidth
            className={styles.propertyTrigger}
            aria-describedby="initiative-priority-label"
            icon={<PriorityIcon priority={initiative.priority} decorative />}
          >
            {priorityLabel(initiative.priority)}
          </Button>
        </div>

        <div className={styles.property}>
          <span className={styles.srOnly} id="initiative-owner-label">
            Owner
          </span>
          <Button
            {...owner.props}
            variant="ghost"
            fullWidth
            className={styles.propertyTrigger}
            aria-describedby="initiative-owner-label"
            icon={
              ownerName === null ? (
                <UnassignedGlyph width="14" height="14" />
              ) : (
                <Avatar
                  name={ownerName}
                  size="xs"
                  colorKey={initiative.ownerId ?? ownerName}
                  decorative
                />
              )
            }
          >
            {ownerName ?? <span className={styles.unset}>No owner</span>}
          </Button>
        </div>

        <div className={styles.property}>
          <span className={styles.srOnly} id="initiative-target-label">
            Target date
          </span>
          <Button
            {...target.props}
            variant="ghost"
            fullWidth
            className={styles.propertyTrigger}
            aria-describedby="initiative-target-label"
            icon={<CalendarGlyph width="14" height="14" />}
          >
            {initiative.targetDate === undefined ? (
              <span className={styles.unset}>No target date</span>
            ) : (
              formatTimeframe(initiative.targetDate, granularity)
            )}
          </Button>
        </div>

        <div className={styles.property}>
          <span className={styles.srOnly} id="initiative-team-label">
            Lead team
          </span>
          <Button
            {...leadTeam.props}
            variant="ghost"
            fullWidth
            className={styles.propertyTrigger}
            aria-describedby="initiative-team-label"
          >
            {teams.find((team) => team.id === initiative.leadTeamId)?.name ?? (
              <span className={styles.unset}>No lead team</span>
            )}
          </Button>
        </div>

        <h3 className={styles.railGroup} id="initiative-labels-label">
          Labels
        </h3>
        <div className={styles.property}>
          <Button
            {...labelsMenu.props}
            variant="ghost"
            fullWidth
            className={styles.propertyTrigger}
            aria-label="Set labels"
          >
            {appliedLabels.length === 0 ? (
              <span className={styles.unset}>Add labels</span>
            ) : (
              <span className={styles.labelRun}>
                {appliedLabels.map((label) => (
                  <LabelChip key={label.id} name={label.name} color={label.color} compact />
                ))}
              </span>
            )}
          </Button>
        </div>
      </aside>

      <Menu
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        label="Status"
        items={statusItems}
      />
      <Menu
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        label="Priority"
        items={priorityItems}
      />
      <Menu
        open={leadTeam.open}
        onClose={leadTeam.hide}
        trigger={leadTeam.ref}
        label="Lead team"
        items={teamItems}
        filterable
        filterPlaceholder="Lead team…"
      />
      <UserPicker
        open={owner.open}
        onClose={owner.hide}
        trigger={owner.ref}
        label="Owner"
        noneLabel="No owner"
        filterPlaceholder="Owned by…"
        filterHint="a"
        value={initiative.ownerId ?? null}
        onSelect={(ownerId) => save({ ownerId })}
      />
      <DatePicker
        open={target.open}
        onClose={target.hide}
        trigger={target.ref}
        actionId="initiative.closeTargetPicker"
        actionGroup="Initiatives"
        label="Target date"
        clearLabel="No target date"
        timezone={viewer?.timezone ?? 'UTC'}
        value={initiative.targetDate ?? null}
        onSelect={(day) =>
          save(
            day === null
              ? { targetDate: null }
              : { targetDate: day, targetDateGranularity: granularity },
          )
        }
        footer={
          initiative.targetDate === undefined ? undefined : (
            // The precision is a property of the date, so it is set where the date is:
            // "Q3" and "12 August" are the same stored day meant two different ways.
            <SegmentedControl
              aria-label="Target date precision"
              options={GRANULARITIES}
              value={granularity}
              onChange={(value) =>
                save({ targetDate: initiative.targetDate ?? null, targetDateGranularity: value })
              }
            />
          )
        }
      />
      <InitiativeLabelPicker
        open={labelsMenu.open}
        onClose={labelsMenu.hide}
        trigger={labelsMenu.ref}
        value={labelIds}
        onApply={(labelId, displaced) =>
          applyInitiativeLabel(engine, initiative.id, labelId, displaced).catch(report)
        }
        onRemove={(labelId) => removeInitiativeLabel(engine, initiative.id, labelId).catch(report)}
      />
      <InitiativePicker
        open={childPicker.open}
        onClose={childPicker.hide}
        trigger={childPicker.ref}
        label="Nest an initiative"
        value={null}
        noneLabel={null}
        exclude={excludedChildren}
        onSelect={(childId) => {
          if (childId !== null) void onNestExisting(childId);
        }}
      />
      <ProjectPicker
        open={projectPicker.open}
        onClose={projectPicker.hide}
        trigger={projectPicker.ref}
        value={null}
        onSelect={(projectId) => {
          if (projectId !== null) void onAddProject(projectId);
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'child'
            ? `Un-nest ${pending.name}?`
            : `Remove ${pending?.name ?? 'this project'}?`
        }
        consequence={
          pending?.kind === 'child'
            ? 'It goes back to being a top-level initiative. Nothing inside it changes, and its projects stop rolling up here.'
            : 'The project leaves this initiative and stops counting towards its progress. The project itself, and its issues, are untouched.'
        }
        confirmLabel={pending?.kind === 'child' ? 'Un-nest' : 'Remove'}
        onConfirm={confirmPending}
        onClose={() => setPending(null)}
      />
    </div>
  );
}

/**
 * The server's own words when it has them.
 *
 * These sections talk to a domain that refuses things for reasons only it knows — a sixth
 * level of nesting, a nest that would close a cycle — and "something went wrong" would
 * leave the person guessing at a rule the API just named for them.
 */
function refusal(failure: unknown, fallback: string): string {
  return failure instanceof ApiError ? failure.message : fallback;
}

function describeRefusal(failure: unknown): string {
  return refusal(failure, 'That change could not be saved.');
}

/**
 * One contributing project: what it is, who has it, and how far along it is.
 *
 * The section used to be a list of names with a Remove button each, which said nothing the
 * initiative is actually tracked on — and it walked only the direct links while the health
 * strip on the list screen walked descendants, so the same initiative reported two different
 * project counts. Both read `listInitiativeProjectRows` now.
 */
function ProjectRow({ row, onRemove }: { row: InitiativeProjectRow; onRemove: () => void }) {
  return (
    <li className={styles.projectRow}>
      <StateIcon category={PROJECT_STATUS_ICON[row.statusCategory]} label={row.statusName} />
      <Link to={`/project/${row.projectId}`} className={styles.projectLink}>
        {row.name}
      </Link>
      <span className={styles.projectHealth}>
        {row.health === null ? (
          <span className={styles.projectMuted}>No update</span>
        ) : (
          <ProjectHealthBadge health={row.health} compact />
        )}
      </span>
      <span className={styles.projectLead}>
        {row.leadName === null ? (
          <span className={styles.projectMuted}>No lead</span>
        ) : (
          <>
            <Avatar name={row.leadName} size="xs" colorKey={row.leadId} decorative />
            {row.leadName}
          </>
        )}
      </span>
      <span className={styles.projectTarget}>
        {row.targetDate === undefined ? (
          <span className={styles.projectMuted}>No target</span>
        ) : (
          whenDay(row.targetDate)
        )}
      </span>
      <span className={styles.projectProgress}>
        <ProgressBar progress={row.progress} label={row.name} compact />
      </span>
      {row.direct ? (
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      ) : (
        // Inherited from a sub-initiative. Removing it here would have to reach into the
        // initiative that owns the link, which is not what a button on this row looks like
        // it does — so this row says where the project comes from instead.
        <span className={styles.projectMuted}>Via a sub-initiative</span>
      )}
    </li>
  );
}

function listChildren(store: Store, initiativeId: UUID): readonly ChildRow[] {
  const rows: ChildRow[] = [];
  for (const childId of store.initiativeChildIdsFor(initiativeId)) {
    const child = store.initiatives.get(childId);
    if (child === undefined || child.archivedAt !== undefined || child.deletedAt !== undefined) {
      continue;
    }
    rows.push({ id: child.id, name: child.name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
