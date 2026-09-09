/**
 * An initiative's properties, drawn twice: as the rail beside the reading column, and as the
 * inline row under the title.
 *
 * Linear puts both on the same screen and they are not redundant. The row is what somebody
 * reads on the way past — status, priority, owner, target, lead team, at a glance, in the
 * column they are already looking at. The rail is where the same facts are *worked on*, with
 * a named column beside each one and room for the properties the row has no space for. So
 * one component draws both, because the alternative is two lists of the same six properties
 * that drift apart the first time a seventh is added.
 *
 * The variants differ in shape, not in behaviour: each mounts its own pickers, because a
 * picker anchors to the control that opened it and one trigger ref cannot serve two buttons
 * in different corners of the screen.
 *
 * The keyboard is split along the same line. `s`, `a` and `shift+t` are registered by the
 * row, which is always on screen; `l` by the rail, which is the only surface carrying the
 * labels trigger. A shortcut registered by the surface that owns the control it opens is a
 * shortcut that cannot outlive it.
 */

import { useCallback, useId, useState, type ReactNode } from 'react';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import {
  Avatar,
  Button,
  ChevronGlyph,
  DatePicker,
  IconButton,
  LabelChip,
  Menu,
  PRIORITY_LEVELS,
  PriorityIcon,
  PropertyPill,
  SaveIndicator,
  SegmentedControl,
  StateIcon,
  priorityLabel,
  useSaveState,
  type MenuNode,
} from '~/components';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { IconPicker } from '~/features/icon/IconPicker';
import { DEFAULT_ENTITY_COLOR, iconValueLabel } from '~/features/icon/glyphs';
import {
  applyInitiativeLabel,
  removeInitiativeLabel,
} from '~/features/initiative-labels/mutations';
import { InitiativeLabelPicker } from '~/features/initiative-labels/InitiativeLabelPicker';
import {
  formatInitiativeStatus,
  INITIATIVE_STATUS_ICON,
  INITIATIVE_STATUSES,
  updateInitiative,
} from '~/features/initiatives/mutations';
import { InitiativeGlyph } from '~/features/initiatives/glyphs';
import { INITIATIVE_RAIL_KEY } from '~/features/initiatives/outlet';
import { CalendarGlyph, PlusGlyph, UnassignedGlyph } from '~/features/issue/glyphs';
import { UserPicker } from '~/features/members/UserPicker';
import { personName } from '~/features/prefs/prefs';
import { formatTimeframe } from '~/features/projects/properties';
import { report } from '~/features/issue/mutations';
import { readCollapsed, writeCollapsed } from '~/features/view/collapse';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer } from '~/hooks/useViewer';
import type { InitiativeLabel, TimeframeGranularity, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './properties.module.css';

/** The five precisions a target date can be meant at, shortest word each. */
const GRANULARITIES: readonly { readonly value: TimeframeGranularity; readonly label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'half', label: 'Half' },
  { value: 'year', label: 'Year' },
];

export interface InitiativePropertiesProps {
  readonly initiativeId: UUID;
  /** `rail` is the named column beside the page; `row` is the pills under the title. */
  readonly variant: 'rail' | 'row';
}

export function InitiativeProperties({ initiativeId, variant }: InitiativePropertiesProps) {
  const engine = useEngine();
  const viewer = useViewer();
  const rail = variant === 'rail';

  const iconPicker = useMenuTrigger('dialog');
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const owner = useMenuTrigger();
  const leadTeam = useMenuTrigger();
  const target = useMenuTrigger('dialog');
  const labelsMenu = useMenuTrigger();

  const saveState = useSaveState(describeRefusal);
  const { run: runSave } = saveState;

  const initiative = useLiveQuery(
    (store) => store.initiatives.get(initiativeId) ?? null,
    ['initiative'],
    [initiativeId],
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

  useActions(
    rail
      ? [
          {
            id: 'initiativeDetail.labels',
            title: 'Set labels',
            keys: ['l'],
            when: 'detail',
            group: 'Initiatives',
            run: () => labelsMenu.show(),
          },
        ]
      : [
          {
            id: 'initiative.status',
            title: 'Set initiative status',
            keys: ['s'],
            when: 'detail',
            group: 'Initiatives',
            run: () => status.show(),
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
    [initiativeId, rail],
  );

  if (initiative === null) return null;

  const save = (fields: Parameters<typeof updateInitiative>[2]) => {
    void runSave(() => updateInitiative(engine, initiative.id, fields));
  };

  const granularity = initiative.targetDateGranularity ?? 'day';
  const leadTeamName = teams.find((team) => team.id === initiative.leadTeamId)?.name ?? null;

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

  const statusIcon = <StateIcon category={INITIATIVE_STATUS_ICON[initiative.status]} decorative />;
  const ownerIcon =
    ownerName === null ? (
      <UnassignedGlyph width="14" height="14" />
    ) : (
      <Avatar name={ownerName} size="xs" colorKey={initiative.ownerId ?? ownerName} decorative />
    );
  const targetText =
    initiative.targetDate === undefined
      ? null
      : formatTimeframe(initiative.targetDate, granularity);

  // Every picker this surface owns, mounted once and shared by both shapes. A closed picker
  // draws nothing, so the pair of instances on screen is one panel at a time.
  const pickers = (
    <>
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
        actionId={rail ? 'initiative.rail.closeTargetPicker' : 'initiative.closeTargetPicker'}
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
    </>
  );

  if (!rail) {
    return (
      <div className={styles.row}>
        <PropertyPill
          {...status.props}
          name="Status"
          describe={`${initiative.id}-row-status`}
          icon={statusIcon}
        >
          {formatInitiativeStatus(initiative.status)}
        </PropertyPill>
        <PropertyPill
          {...priority.props}
          name="Priority"
          describe={`${initiative.id}-row-priority`}
          empty={initiative.priority === 0 ? 'No priority' : undefined}
          icon={<PriorityIcon priority={initiative.priority} decorative />}
        >
          {initiative.priority === 0 ? 'Priority' : priorityLabel(initiative.priority)}
        </PropertyPill>
        <PropertyPill
          {...owner.props}
          name="Owner"
          describe={`${initiative.id}-row-owner`}
          empty={ownerName === null ? 'No owner' : undefined}
          icon={ownerIcon}
        >
          {ownerName ?? 'Owner'}
        </PropertyPill>
        <PropertyPill
          {...target.props}
          name="Target date"
          describe={`${initiative.id}-row-target`}
          empty={targetText === null ? 'No target date' : undefined}
          icon={<CalendarGlyph width="14" height="14" />}
        >
          {targetText ?? 'Target'}
        </PropertyPill>
        <PropertyPill
          {...leadTeam.props}
          name="Lead team"
          describe={`${initiative.id}-row-team`}
          empty={leadTeamName === null ? 'No lead team' : undefined}
        >
          {leadTeamName ?? 'Lead team'}
        </PropertyPill>
        {pickers}
      </div>
    );
  }

  return (
    <>
      <InitiativeRailSection
        id="properties"
        title="Properties"
        detail={<SaveIndicator state={saveState.state} />}
        action={
          <IconButton
            size="sm"
            icon={<PlusGlyph />}
            aria-label="Add labels"
            tooltip="Add labels"
            aria-haspopup="menu"
            onClick={(event) => labelsMenu.showFrom(event.currentTarget)}
          />
        }
      >
        {saveState.error === undefined ? null : (
          <p className={styles.error} role="alert">
            {saveState.error}
          </p>
        )}

        {/* Icon first, because it is the only property that changes how the initiative is
            recognised everywhere else it appears — the list, the breadcrumb, the picker. */}
        <RailRow label="Icon">
          {() => (
            <Button
              {...iconPicker.props}
              variant="ghost"
              fullWidth
              className={styles.value}
              aria-label="Set icon"
              icon={
                <EntityIcon
                  icon={initiative.icon}
                  color={initiative.color ?? DEFAULT_ENTITY_COLOR}
                  fallback={<InitiativeGlyph />}
                />
              }
            >
              {iconValueLabel(initiative.icon) ?? <span className={styles.unset}>Set icon</span>}
            </Button>
          )}
        </RailRow>

        <RailRow label="Status">
          {(describedBy) => (
            <Button
              {...status.props}
              variant="ghost"
              aria-describedby={describedBy}
              fullWidth
              className={styles.value}
              icon={statusIcon}
            >
              {formatInitiativeStatus(initiative.status)}
            </Button>
          )}
        </RailRow>

        <RailRow label="Priority">
          {(describedBy) => (
            <Button
              {...priority.props}
              variant="ghost"
              aria-describedby={describedBy}
              fullWidth
              className={styles.value}
              icon={<PriorityIcon priority={initiative.priority} decorative />}
            >
              {priorityLabel(initiative.priority)}
            </Button>
          )}
        </RailRow>

        <RailRow label="Owner">
          {(describedBy) => (
            <Button
              {...owner.props}
              variant="ghost"
              aria-describedby={describedBy}
              fullWidth
              className={styles.value}
              icon={ownerIcon}
            >
              {ownerName ?? <span className={styles.unset}>No owner</span>}
            </Button>
          )}
        </RailRow>

        <RailRow label="Target date">
          {(describedBy) => (
            <Button
              {...target.props}
              variant="ghost"
              aria-describedby={describedBy}
              fullWidth
              className={styles.value}
              icon={<CalendarGlyph width="14" height="14" />}
            >
              {targetText ?? <span className={styles.unset}>No target date</span>}
            </Button>
          )}
        </RailRow>

        <RailRow label="Lead team">
          {(describedBy) => (
            <Button
              {...leadTeam.props}
              variant="ghost"
              aria-describedby={describedBy}
              fullWidth
              className={styles.value}
            >
              {leadTeamName ?? <span className={styles.unset}>No lead team</span>}
            </Button>
          )}
        </RailRow>

        <RailRow label="Labels">
          {(describedBy) => (
            <Button
              {...labelsMenu.props}
              variant="ghost"
              aria-describedby={describedBy}
              fullWidth
              className={styles.value}
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
          )}
        </RailRow>
      </InitiativeRailSection>

      {pickers}
      <IconPicker
        open={iconPicker.open}
        onClose={iconPicker.hide}
        trigger={iconPicker.ref}
        value={{ icon: initiative.icon ?? '', color: initiative.color ?? DEFAULT_ENTITY_COLOR }}
        onChange={(next) =>
          // The picker moves one half per act, so the mutation carries one half too.
          save(next.icon === (initiative.icon ?? '') ? { color: next.color } : { icon: next.icon })
        }
        actionId="initiativeDetail.closeIconPicker"
        label="Initiative icon"
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
    </>
  );
}

/**
 * One rail line: the property's name in its own column, then the control that sets it.
 *
 * The control is a render prop rather than plain children because the visible label has to
 * be the control's *description* as well as a word on screen. A button's accessible name is
 * its value — "Planned" — and without the description a screen reader announces a button
 * called Planned with nothing saying it is the status.
 */
function RailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (describedBy: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.railRow}>
      <span className={styles.railLabel} id={id}>
        {label}
      </span>
      {children(id)}
    </div>
  );
}

export interface InitiativeRailSectionProps {
  /** What the fold is remembered by. Stable across renames — it is not the title. */
  readonly id: string;
  readonly title: string;
  /** Extra content on the header row, between the title and the trailing action. */
  readonly detail?: ReactNode;
  /** The trailing control: the section's "+". */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A folded-away part of the rail, remembered per person.
 *
 * `Section` is the shape this copies and deliberately not the component: its fold is local
 * state by design, because a section somebody folded on one issue is not a decision about
 * the next issue. A rail is the other case — it is the same rail on every initiative, and
 * somebody who has folded Progress away has said so about the rail rather than about one
 * objective. So the fold rides in `features/view/collapse` with every other one.
 */
export function InitiativeRailSection({
  id,
  title,
  detail,
  action,
  children,
}: InitiativeRailSectionProps) {
  const [shut, setShut] = useState(() => readCollapsed(INITIATIVE_RAIL_KEY).has(id));

  const toggle = useCallback(() => {
    setShut((held) => {
      // Read-modify-write against storage rather than against local state: another tab may
      // have folded the other section since this one was read.
      const stored = new Set(readCollapsed(INITIATIVE_RAIL_KEY));
      if (held) stored.delete(id);
      else stored.add(id);
      writeCollapsed(INITIATIVE_RAIL_KEY, stored);
      return !held;
    });
  }, [id]);

  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          <button
            type="button"
            className={styles.sectionToggle}
            aria-expanded={!shut}
            onClick={toggle}
          >
            <ChevronGlyph
              className={[styles.chevron, shut ? null : styles.open].filter(Boolean).join(' ')}
            />
            <span>{title}</span>
          </button>
        </h2>
        {detail}
        <div className={styles.spacer} />
        {action}
      </div>
      {shut ? null : <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

/**
 * The server's own words when it has them.
 *
 * The domain refuses things for reasons only it knows, and "something went wrong" would
 * leave somebody guessing at a rule the API just named for them.
 */
function describeRefusal(failure: unknown): string {
  return failure instanceof ApiError ? failure.message : 'That change could not be saved.';
}
