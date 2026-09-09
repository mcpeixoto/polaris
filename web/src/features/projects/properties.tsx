/**
 * Project properties — everything the project *is*, editable, in the shell's rail.
 *
 * Three sections, each folding on its own heading and remembering it: **Properties**, the
 * rows below; **Milestones**, the checkpoints as a reader checks which one is current; and
 * **Progress**, the scope-started-completed counts with the burn-up under them. The graph
 * used to sit at the bottom of the overview, a screen's worth of scrolling away from the
 * dates it is drawn against.
 *
 * One row per property: its name at the left in the rail's grey, its value at the right as a
 * ghost `Button` wearing the value's own glyph — a state icon, a priority glyph, an avatar.
 * An unset value says what setting it would do ("Add lead") rather than "None". The summary
 * and the description are not here: they are the project's content, and they read and edit as
 * prose on the overview.
 *
 * The two dates share one row — `start → target` — because a timeframe is one fact with two
 * ends, and two rows of it made the rail read as though a project had four dates.
 *
 * The names on the triggers are verbs — "Set status", "Add lead" — rather than the issue
 * rail's arrangement, where the button is named by its value and described by its property.
 * Two reasons: this rail keeps its property names visible, so a second copy of them on the
 * accessibility tree would be read twice; and half of these rows are empty on a young
 * project, where a value has no name to be called by.
 *
 * Every picker here writes through `updateProject` and none of them own the value they show —
 * the same bargain the issue rail makes, which is what lets a change arriving over sync land
 * on the rail without a picker having to be told.
 */

import { useState, type ReactNode } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  DatePicker,
  LabelChip,
  Menu,
  PriorityIcon,
  priorityLabel,
  Progress,
  Select,
  StateIcon,
  Tooltip,
  type MenuNode,
} from '~/components';
import { AssigneePicker, PriorityPicker } from '~/features/issue/pickers';
import { ChevronGlyph } from '~/features/issue/glyphs';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { iconValueLabel } from '~/features/icon/glyphs';
import { IconPicker } from '~/features/icon/IconPicker';
import { UserPicker } from '~/features/members/UserPicker';
import { useEngine } from '~/app/context';
import { browserTimezone } from '~/features/locale';
import { readCollapsed, writeCollapsed } from '~/features/view/collapse';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type {
  Issue,
  ProjectLabel,
  ProjectUpdateSchedule,
  Store,
  TimeframeGranularity,
  UUID,
} from '~/store';

import { report } from '~/features/issue/mutations';
import { applyProjectLabel, removeProjectLabel } from '~/features/project-labels/mutations';
import { ProjectLabelPicker } from '~/features/project-labels/ProjectLabelPicker';
import { listProjectMilestones } from '~/features/project-milestones/helpers';
import { addProjectMember, removeProjectMember, updateProject } from './mutations';
import { ProjectDependencies } from './dependencies';
import { CalendarGlyph, LabelGlyph, MembersGlyph, MilestoneGlyph, NoPersonGlyph } from './glyphs';
import { ProjectGraph } from './ProjectGraph';
import { ProjectStatusPicker } from './ProjectStatusPicker';
import { PROJECT_STATUS_ICON } from './statusCategories';
import styles from './properties.module.css';

/** Where the rail's folded sections are kept. The rail itself is the shell's own key. */
const COLLAPSE_PREFERENCE = 'project-rail-sections';

interface ProjectPropertiesProps {
  readonly projectId: UUID;
}

/** The reminder cadences the API offers, as one list rather than a second control. */
const SCHEDULES: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'default', label: 'Workspace default' },
  { id: 'never', label: 'Never' },
  { id: 'custom:7', label: 'Every 7 days' },
  { id: 'custom:14', label: 'Every 14 days' },
  { id: 'custom:21', label: 'Every 21 days' },
  { id: 'custom:28', label: 'Every 28 days' },
];

export function ProjectProperties({ projectId }: ProjectPropertiesProps) {
  const engine = useEngine();
  const icon = useMenuTrigger<HTMLButtonElement>('dialog');
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const labels = useMenuTrigger();
  const lead = useMenuTrigger();
  const members = useMenuTrigger();
  const schedule = useMenuTrigger();
  const startDate = useMenuTrigger<HTMLButtonElement>('dialog');
  const targetDate = useMenuTrigger<HTMLButtonElement>('dialog');

  useKeyContext('detail');

  // The row and the status it points at in one query rather than two: they are read
  // together on every render of this panel, and a second subscription over the same row
  // buys nothing but another render for the store to schedule.
  const row = useLiveQuery(
    (store) => {
      const found = store.projects.get(projectId);
      if (found === undefined) return null;
      return {
        project: found,
        status: store.projectStatuses.get(found.statusId) ?? null,
        lead: found.leadId === undefined ? null : (store.users.get(found.leadId) ?? null),
      };
    },
    ['project', 'projectStatus', 'user'],
    [projectId],
  );
  const project = row?.project ?? null;
  const currentStatus = row?.status ?? null;
  const currentLead = row?.lead ?? null;

  const labelIds = useLiveQuery(
    (store) => [...store.projectLabelIdsFor(projectId)],
    ['projectLabel', 'projectLabelLink'],
    [projectId],
  );

  const appliedLabels = useLiveQuery(
    (store) =>
      [...store.projectLabelIdsFor(projectId)]
        .map((id) => store.projectLabels.get(id))
        .filter(
          (label): label is ProjectLabel => label !== undefined && label.archivedAt === undefined,
        ),
    ['projectLabel', 'projectLabelLink'],
    [projectId],
  );

  const memberRows = useLiveQuery(
    (store) =>
      [...store.projectMemberIdsFor(projectId)]
        .map((id) => store.projectMembers.get(id))
        .map((member) => (member === undefined ? undefined : store.users.get(member.userId)))
        .filter((user): user is NonNullable<typeof user> => user !== undefined)
        .map((user) => ({
          id: user.id,
          name: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
        })),
    ['projectMember', 'user'],
    [projectId],
  );
  const memberIds = new Set(memberRows.map((user) => user.id));

  const teams = useLiveQuery(
    (store) =>
      [...store.projectTeamIdsFor(projectId)]
        .map((id) => store.projectTeams.get(id))
        .map((link) => (link === undefined ? undefined : store.teams.get(link.teamId)))
        .filter((team): team is NonNullable<typeof team> => team !== undefined)
        .map((team) => ({ id: team.id, name: team.name, key: team.key })),
    ['projectTeam', 'team'],
    [projectId],
  );

  // No index from a project back to its initiatives — the link is indexed by initiative — so
  // this is a scan. A workspace has tens of initiatives, not thousands, and the alternative
  // is a second index maintained for one rail row.
  const initiatives = useLiveQuery(
    (store) =>
      [...store.initiativeProjects.values()]
        .filter((link) => link.projectId === projectId)
        .map((link) => store.initiatives.get(link.initiativeId))
        .filter((found): found is NonNullable<typeof found> => found !== undefined)
        .map((found) => ({ id: found.id, name: found.name })),
    ['initiativeProject', 'initiative'],
    [projectId],
  );

  const milestones = useLiveQuery(
    (store) => listProjectMilestones(store, projectId),
    ['projectMilestone', 'issue', 'workflowState'],
    [projectId],
  );

  const scope = useLiveQuery(
    (store) => projectScope(store, projectId),
    ['issue', 'workflowState'],
    [projectId],
  );

  useActions(
    [
      // Status is registered by the shell, whose header pill opens the same picker: the
      // registry refuses two actions on one key in one context, and `S` should reach the
      // control the reader can see from every tab rather than only from the rail.
      {
        id: 'projectDetail.icon',
        title: 'Set icon',
        keys: ['i'],
        when: 'detail',
        group: 'Projects',
        run: () => icon.show(),
      },
      {
        id: 'projectDetail.priority',
        title: 'Set priority',
        keys: ['p'],
        when: 'detail',
        group: 'Projects',
        run: () => priority.show(),
      },
      {
        id: 'projectDetail.labels',
        title: 'Set labels',
        keys: ['l'],
        when: 'detail',
        group: 'Projects',
        run: () => labels.show(),
      },
      {
        id: 'projectDetail.lead',
        title: 'Set lead',
        keys: ['a'],
        when: 'detail',
        group: 'Projects',
        run: () => lead.show(),
      },
      {
        id: 'projectDetail.members',
        title: 'Set members',
        keys: ['shift+a'],
        when: 'detail',
        group: 'Projects',
        run: () => members.show(),
      },
      {
        id: 'projectDetail.targetDate',
        title: 'Set target date',
        keys: ['shift+d'],
        when: 'detail',
        group: 'Projects',
        run: () => targetDate.show(),
      },
    ],
    [projectId],
  );

  if (project === null) return null;

  const scheduleLabel =
    project.updateSchedule === 'custom'
      ? `Every ${project.updateReminderIntervalDays ?? 7} days`
      : project.updateSchedule === 'never'
        ? 'Never'
        : 'Workspace default';

  const scheduleItems: MenuNode[] = SCHEDULES.map((option) => {
    const [kind, days] = option.id.split(':');
    const selected =
      kind === 'custom'
        ? project.updateSchedule === 'custom' &&
          (project.updateReminderIntervalDays ?? 7) === Number(days)
        : project.updateSchedule === kind;
    return {
      id: option.id,
      label: option.label,
      selected,
      onSelect: () =>
        updateProject(
          engine,
          project.id,
          kind === 'custom'
            ? { updateSchedule: 'custom', updateReminderIntervalDays: Number(days) }
            : { updateSchedule: kind as ProjectUpdateSchedule },
        ).catch(report),
    };
  });

  return (
    <div className={styles.panel}>
      <RailSection id="properties" title="Properties">
        {/* First, because it is the only property that changes how the project is recognised
          everywhere else it appears — the list, the sidebar, the breadcrumb. It was settable
          in the create dialog and nowhere afterwards, which made the one property you pick
          before you know anything about the project the one you could never revise. */}
        <div className={styles.row}>
          <span className={styles.label}>Icon</span>
          <Button
            {...icon.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Set icon"
            icon={
              project.icon === undefined || project.icon === '' ? undefined : (
                <EntityIcon icon={project.icon} color={project.color} fallback={null} size="md" />
              )
            }
          >
            {iconValueLabel(project.icon) ?? <span className={styles.unset}>Set icon</span>}
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Status</span>
          <Button
            {...status.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Set status"
            icon={
              currentStatus === null ? undefined : (
                <StateIcon
                  category={PROJECT_STATUS_ICON[currentStatus.category]}
                  color={currentStatus.color}
                  decorative
                />
              )
            }
          >
            {currentStatus === null ? (
              <span className={styles.unset}>Set status</span>
            ) : (
              currentStatus.name
            )}
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Priority</span>
          <Button
            {...priority.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Set priority"
            icon={<PriorityIcon priority={project.priority} decorative />}
          >
            {priorityLabel(project.priority)}
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Lead</span>
          <Button
            {...lead.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Set lead"
            icon={
              currentLead === null ? (
                <NoPersonGlyph />
              ) : (
                <Avatar
                  name={currentLead.displayName}
                  src={currentLead.avatarUrl ?? null}
                  size="xs"
                  colorKey={currentLead.id}
                  decorative
                />
              )
            }
          >
            {currentLead === null ? (
              <span className={styles.unset}>Add lead</span>
            ) : (
              currentLead.displayName
            )}
          </Button>
        </div>
        {/* Editable, at last. Membership is also written by the server as people are given work
          in the project, so this list adds to that rather than replacing it. */}
        <div className={styles.row}>
          <span className={styles.label}>Members</span>
          <Button
            {...members.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Set members"
            icon={memberRows.length === 0 ? <MembersGlyph /> : undefined}
          >
            {memberRows.length === 0 ? (
              <span className={styles.unset}>Add members</span>
            ) : (
              <Tooltip label={memberRows.map((user) => user.name).join(', ')}>
                <span className={styles.avatars}>
                  {memberRows.slice(0, 5).map((user) => (
                    <Avatar
                      key={user.id}
                      name={user.name}
                      src={user.avatarUrl}
                      size="xs"
                      colorKey={user.id}
                      decorative
                    />
                  ))}
                  {memberRows.length > 5 && (
                    <span className={styles.more}>+{memberRows.length - 5}</span>
                  )}
                </span>
              </Tooltip>
            )}
          </Button>
        </div>
        {/* Both ends of the timeframe on one line, each with the granularity that says how
          much of the day to believe. The API refuses a granularity without a day, and "Q3"
          is a day nobody is meant to read too closely — so the write always carries both,
          and the granularity is chosen in the panel that sets the day. */}
        <div className={styles.row}>
          <span className={styles.label}>Dates</span>
          <span className={styles.dateRow}>
            <TimeframeTrigger
              title="Start date"
              trigger={startDate}
              date={project.startDate ?? null}
              granularity={project.startDateGranularity ?? 'day'}
              actionId="projectDetail.closeStartPicker"
              short="Start"
              onChange={(startDate, startDateGranularity) =>
                updateProject(engine, project.id, { startDate, startDateGranularity }).catch(report)
              }
            />
            <span className={styles.dateArrow} aria-hidden="true">
              →
            </span>
            <TimeframeTrigger
              title="Target date"
              trigger={targetDate}
              date={project.targetDate ?? null}
              granularity={project.targetDateGranularity ?? 'day'}
              actionId="projectDetail.closeTargetPicker"
              short="Target"
              onChange={(targetDate, targetDateGranularity) =>
                updateProject(engine, project.id, { targetDate, targetDateGranularity }).catch(
                  report,
                )
              }
            />
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Labels</span>
          <Button
            {...labels.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Set labels"
            icon={appliedLabels.length === 0 ? <LabelGlyph /> : undefined}
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
        {/* Which teams carry the work, and which initiatives the project rolls up into. Read
          here and written where the relationship is owned — the team from the project's own
          settings, the initiative from the initiative it belongs to — so the rail states them
          rather than offering a second, half-informed place to change them. */}
        <div className={styles.row}>
          <span className={styles.label}>Teams</span>
          <span className={styles.value}>
            {teams.length === 0 ? (
              <span className={styles.unset}>No teams</span>
            ) : (
              teams.map((team) => team.key).join(', ')
            )}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Initiatives</span>
          <span className={styles.value}>
            {initiatives.length === 0 ? (
              <span className={styles.unset}>No initiatives</span>
            ) : (
              initiatives.map((found) => found.name).join(', ')
            )}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Updates</span>
          <Button
            {...schedule.props}
            variant="ghost"
            fullWidth
            className={styles.trigger}
            aria-label="Update schedule"
          >
            {scheduleLabel}
          </Button>
        </div>

        <ProjectDependencies projectId={project.id} compact addable />
      </RailSection>

      {/* The checkpoints, each with how far along it is. Editing them is the overview's
          job — the "+" is there, on the section that owns the list — and the rail is where
          a reader checks which one the project is on. */}
      <RailSection id="milestones" title="Milestones" count={milestones.length}>
        {milestones.length === 0 ? (
          <p className={styles.helper}>
            Add milestones on the overview to break the project into stages.
          </p>
        ) : (
          <ul className={styles.milestones}>
            {milestones.map((milestone) => (
              <li
                key={milestone.milestone.id}
                className={
                  milestone.current
                    ? `${styles.milestone} ${styles.milestoneCurrent}`
                    : styles.milestone
                }
              >
                <span className={styles.glyph}>
                  <MilestoneGlyph />
                </span>
                <span className={styles.milestoneName}>{milestone.milestone.name}</span>
                <Progress
                  percent={milestone.percent}
                  label={milestone.milestone.name}
                  detail={
                    milestone.total === 0
                      ? 'no issues yet'
                      : `${milestone.done} of ${milestone.total} issues completed`
                  }
                  size="sm"
                />
                <span className={styles.milestonePercent} aria-hidden="true">
                  {milestone.percent}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      {/* Scope, started and completed, then the burn-up they are the endpoints of. Counted
          from the issues in the project rather than from the graph, which only draws once a
          project is under way and would leave the counts blank for the projects that most
          need them. */}
      <RailSection id="progress" title="Progress">
        <dl className={styles.counts}>
          <div className={styles.count}>
            <dt className={styles.countLabel}>Scope</dt>
            <dd className={styles.countValue}>{scope.total}</dd>
          </div>
          <div className={styles.count}>
            <dt className={styles.countLabel}>Started</dt>
            <dd className={styles.countValue}>{scope.started}</dd>
          </div>
          <div className={styles.count}>
            <dt className={styles.countLabel}>Completed</dt>
            <dd className={styles.countValue}>{scope.completed}</dd>
          </div>
        </dl>
        <ProjectGraph projectId={project.id} />
      </RailSection>

      <IconPicker
        open={icon.open}
        onClose={icon.hide}
        trigger={icon.ref}
        value={{ icon: project.icon ?? '', color: project.color }}
        onChange={(next) =>
          updateProject(engine, project.id, { icon: next.icon, color: next.color }).catch(report)
        }
        actionId="projectDetail.closeIconPicker"
        label="Project icon"
      />
      <ProjectStatusPicker
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        value={project.statusId}
        onSelect={(statusId) => updateProject(engine, project.id, { statusId }).catch(report)}
      />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={project.priority}
        onSelect={(level) => updateProject(engine, project.id, { priority: level }).catch(report)}
      />
      <AssigneePicker
        open={lead.open}
        onClose={lead.hide}
        trigger={lead.ref}
        value={project.leadId ?? null}
        onSelect={(leadId) => updateProject(engine, project.id, { leadId }).catch(report)}
      />
      <UserPicker
        open={members.open}
        onClose={members.hide}
        trigger={members.ref}
        multiple
        label="Project members"
        filterPlaceholder="Add to the project…"
        value={memberIds}
        onToggle={(userId) => {
          const write = memberIds.has(userId)
            ? removeProjectMember(engine, project.id, userId)
            : addProjectMember(engine, project.id, userId);
          write.catch(report);
        }}
      />
      <Menu
        open={schedule.open}
        onClose={schedule.hide}
        trigger={schedule.ref}
        label="Update schedule"
        items={scheduleItems}
      />
      <ProjectLabelPicker
        open={labels.open}
        onClose={labels.hide}
        trigger={labels.ref}
        value={labelIds}
        onApply={(labelId, displaced) =>
          applyProjectLabel(engine, project.id, labelId, displaced).catch(report)
        }
        onRemove={(labelId) => removeProjectLabel(engine, project.id, labelId).catch(report)}
      />
    </div>
  );
}

const GRANULARITIES: readonly { readonly value: TimeframeGranularity; readonly label: string }[] = [
  { value: 'day', label: 'Exact day' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'half', label: 'Half-year' },
  { value: 'year', label: 'Year' },
];

interface TimeframeTriggerProps {
  readonly title: string;
  /** What the trigger says while the date is unset — "Start", not "Set start date". */
  readonly short: string;
  readonly trigger: ReturnType<typeof useMenuTrigger<HTMLButtonElement>>;
  readonly date: string | null;
  readonly granularity: TimeframeGranularity;
  /** This panel's own Escape. Two of them are mounted here, and ids may not collide. */
  readonly actionId: string;
  readonly onChange: (date: string | null, granularity: TimeframeGranularity) => void;
}

/**
 * One end of the timeframe: the day, and how precisely it is meant.
 *
 * The granularity rides in the picker's footer rather than beside the row, because it is a
 * qualifier on the day being chosen and not a property of its own — a rail that showed
 * "Quarter" next to an empty date was offering a precision for a date nobody had set.
 *
 * The visible text is the short word because both ends share one 88px row; the full name is
 * on the accessible name, where "Set target date" still says which end this is.
 */
function TimeframeTrigger({
  title,
  short,
  trigger,
  date,
  granularity,
  actionId,
  onChange,
}: TimeframeTriggerProps) {
  return (
    <>
      <Button
        {...trigger.props}
        variant="ghost"
        className={styles.trigger}
        aria-label={`Set ${title.toLowerCase()}`}
        icon={<CalendarGlyph />}
      >
        {date === null || date === '' ? (
          <span className={styles.unset}>{short}</span>
        ) : (
          formatTimeframe(date, granularity)
        )}
      </Button>
      <DatePicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        value={date === '' ? null : date}
        // The reader's zone: a project belongs to as many teams as it likes, so there is no
        // one team whose Friday this date is.
        timezone={browserTimezone()}
        actionId={actionId}
        actionGroup="Projects"
        label={title}
        clearLabel={`No ${title.toLowerCase()}`}
        onSelect={(day) => onChange(day, granularity)}
        footer={
          date === null || date === '' ? null : (
            <Select
              aria-label={`${title} granularity`}
              value={granularity}
              onChange={(event) => onChange(date, event.target.value as TimeframeGranularity)}
            >
              {GRANULARITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )
        }
      />
    </>
  );
}

interface RailSectionProps {
  /** The storage key for this section's folded state, and nothing else. */
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly children: ReactNode;
}

/**
 * One folding section of the rail.
 *
 * `components/Section` is the same drawing and deliberately does not remember its state —
 * a section somebody folded on one issue is not a decision about the next issue. The rail is
 * the case where it is: there is one project rail, a reader who never uses the graph folds
 * Progress once, and re-opening it on every project would be the software forgetting
 * something it was told. So the fold is kept where a folded group is kept, in localStorage
 * through `features/view/collapse`, and the heading is otherwise the same button.
 */
function RailSection({ id, title, count, children }: RailSectionProps) {
  const [shut, setShut] = useState(() => readCollapsed(COLLAPSE_PREFERENCE).has(id));
  const bodyId = `project-rail-${id}`;

  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>
          <button
            type="button"
            className={styles.sectionToggle}
            aria-expanded={!shut}
            aria-controls={bodyId}
            onClick={() => {
              const next = !shut;
              setShut(next);
              const held = new Set(readCollapsed(COLLAPSE_PREFERENCE));
              if (next) held.add(id);
              else held.delete(id);
              writeCollapsed(COLLAPSE_PREFERENCE, held);
            }}
          >
            <ChevronGlyph className={shut ? styles.chevron : `${styles.chevron} ${styles.open}`} />
            <span>{title}</span>
          </button>
        </h3>
        {count === undefined || count === 0 ? null : (
          <span className={styles.sectionCount}>{count}</span>
        )}
      </div>
      <div id={bodyId} className={styles.sectionBody} hidden={shut}>
        {children}
      </div>
    </section>
  );
}

/**
 * How much work the project holds, and how much of it has moved.
 *
 * Archived issues are left out, the way every other count of a project's scope leaves them
 * out; canceled work stays in the scope, because a project that dropped half its scope has
 * not thereby delivered it.
 */
export function projectScope(
  store: Store,
  projectId: UUID,
): { readonly total: number; readonly started: number; readonly completed: number } {
  let total = 0;
  let started = 0;
  let completed = 0;
  for (const id of store.index.byProject(projectId)) {
    const issue: Issue | undefined = store.issues.get(id);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    total++;
    if (issue.completedAt !== undefined) {
      completed++;
      continue;
    }
    if (store.workflowStates.get(issue.stateId)?.category === 'started') started++;
  }
  return { total, started, completed };
}

/**
 * A timeframe as a reader should see it: the day, cut back to whatever the granularity
 * claims to know. A quarter target is a real date in the database and a promise about a
 * three-month window on screen, and printing the day would be the client asserting a
 * precision nobody entered.
 */
export function formatTimeframe(day: string, granularity: TimeframeGranularity): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  const year = date.getUTCFullYear();
  switch (granularity) {
    case 'year':
      return String(year);
    case 'half':
      return `H${date.getUTCMonth() < 6 ? 1 : 2} ${year}`;
    case 'quarter':
      return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`;
    case 'month':
      return date.toLocaleDateString(undefined, {
        timeZone: 'UTC',
        month: 'short',
        year: 'numeric',
      });
    default:
      return date.toLocaleDateString(undefined, {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  }
}
