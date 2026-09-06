/**
 * Project properties — everything the project *is*, editable, in the shell's rail.
 *
 * One row per property: its name at the left in the rail's grey, its value at the right
 * as a ghost trigger wearing the value's own glyph — a state icon, a priority glyph, an
 * avatar. An unset value says what setting it would do ("Add lead") rather than "None".
 * The summary and the description are not here: they are the project's content, and they
 * read and edit as prose on the overview.
 */

import { useActions, useKeyContext } from '~/app/keymap';
import { Avatar, Input, LabelChip, PriorityIcon, priorityLabel, StateIcon } from '~/components';
import { AssigneePicker, PriorityPicker } from '~/features/issue/pickers';
import { useEngine } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectLabel, TimeframeGranularity, UUID } from '~/store';

import { report } from '~/features/issue/mutations';
import { applyProjectLabel, removeProjectLabel } from '~/features/project-labels/mutations';
import { ProjectLabelPicker } from '~/features/project-labels/ProjectLabelPicker';
import { listProjectMilestones } from '~/features/project-milestones/helpers';
import { Select } from '~/components';
import type { ProjectUpdateSchedule } from '~/store';
import { updateProject } from './mutations';
import { ProjectDependencies } from './dependencies';
import { CalendarGlyph, LabelGlyph, MembersGlyph, MilestoneGlyph, NoPersonGlyph } from './glyphs';
import { ProgressRing } from './ProgressRing';
import { ProjectStatusPicker } from './ProjectStatusPicker';
import { PROJECT_STATUS_ICON } from './statusCategories';
import styles from './properties.module.css';

interface ProjectPropertiesProps {
  readonly projectId: UUID;
}

export function ProjectProperties({ projectId }: ProjectPropertiesProps) {
  const engine = useEngine();
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const labels = useMenuTrigger();
  const lead = useMenuTrigger();

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

  const members = useLiveQuery(
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

  const milestones = useLiveQuery(
    (store) => listProjectMilestones(store, projectId),
    ['projectMilestone', 'issue', 'workflowState'],
    [projectId],
  );

  useActions(
    [
      {
        id: 'projectDetail.status',
        title: 'Set status',
        keys: ['s'],
        when: 'detail',
        group: 'Projects',
        run: () => status.show(),
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
    ],
    [projectId],
  );

  if (project === null) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <span className={styles.label}>Status</span>
        <button type="button" className={styles.trigger} {...status.props} aria-label="Set status">
          {currentStatus === null ? (
            <span className={styles.unset}>Set status</span>
          ) : (
            <>
              <StateIcon
                category={PROJECT_STATUS_ICON[currentStatus.category]}
                color={currentStatus.color}
                decorative
              />
              {currentStatus.name}
            </>
          )}
        </button>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Priority</span>
        <button
          type="button"
          className={styles.trigger}
          {...priority.props}
          aria-label="Set priority"
        >
          <PriorityIcon priority={project.priority} decorative />
          {priorityLabel(project.priority)}
        </button>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Lead</span>
        <button type="button" className={styles.trigger} {...lead.props} aria-label="Set lead">
          {currentLead === null ? (
            <>
              <span className={styles.glyph}>
                <NoPersonGlyph />
              </span>
              <span className={styles.unset}>Add lead</span>
            </>
          ) : (
            <>
              <Avatar
                name={currentLead.displayName}
                src={currentLead.avatarUrl ?? null}
                size="xs"
                colorKey={currentLead.id}
                decorative
              />
              {currentLead.displayName}
            </>
          )}
        </button>
      </div>
      {/* Read-only: membership is written by the server as people are assigned work in
          the project, and there is no editor for it in the client yet. */}
      <div className={styles.row}>
        <span className={styles.label}>Members</span>
        <span className={styles.value}>
          {members.length === 0 ? (
            <>
              <span className={styles.glyph}>
                <MembersGlyph />
              </span>
              <span className={styles.unset}>No members</span>
            </>
          ) : (
            <span className={styles.avatars} title={members.map((user) => user.name).join(', ')}>
              {members.slice(0, 5).map((user) => (
                <Avatar
                  key={user.id}
                  name={user.name}
                  src={user.avatarUrl}
                  size="xs"
                  colorKey={user.id}
                />
              ))}
              {members.length > 5 && <span className={styles.more}>+{members.length - 5}</span>}
            </span>
          )}
        </span>
      </div>
      {/* Both ends of the timeframe, each with the granularity that says how much of the
          day to believe. The API refuses a granularity without a day, and "Q3" is a day
          nobody is meant to read too closely — so the two controls are one row and the
          write always carries both. */}
      <TimeframeField
        title="Start date"
        date={project.startDate ?? ''}
        granularity={project.startDateGranularity ?? 'day'}
        onChange={(startDate, startDateGranularity) =>
          updateProject(engine, project.id, { startDate, startDateGranularity }).catch(report)
        }
      />
      <TimeframeField
        title="Target date"
        date={project.targetDate ?? ''}
        granularity={project.targetDateGranularity ?? 'day'}
        onChange={(targetDate, targetDateGranularity) =>
          updateProject(engine, project.id, { targetDate, targetDateGranularity }).catch(report)
        }
      />
      <div className={styles.row}>
        <span className={styles.label}>Labels</span>
        <button type="button" className={styles.trigger} {...labels.props} aria-label="Set labels">
          {appliedLabels.length === 0 ? (
            <>
              <span className={styles.glyph}>
                <LabelGlyph />
              </span>
              <span className={styles.unset}>Add labels</span>
            </>
          ) : (
            <span className={styles.labelRun}>
              {appliedLabels.map((label) => (
                <LabelChip key={label.id} name={label.name} color={label.color} compact />
              ))}
            </span>
          )}
        </button>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Updates</span>
        <span className={styles.value}>
          <Select
            value={project.updateSchedule}
            onChange={(event) =>
              updateProject(engine, project.id, {
                updateSchedule: event.target.value as ProjectUpdateSchedule,
              }).catch(report)
            }
            aria-label="Update schedule"
          >
            <option value="default">Workspace default</option>
            <option value="custom">Custom</option>
            <option value="never">Never</option>
          </Select>
          {project.updateSchedule === 'custom' && (
            <Select
              value={String(project.updateReminderIntervalDays ?? 7)}
              onChange={(event) =>
                updateProject(engine, project.id, {
                  updateReminderIntervalDays: Number.parseInt(event.target.value, 10),
                }).catch(report)
              }
              aria-label="Custom reminder interval"
            >
              {[7, 14, 21, 28].map((days) => (
                <option key={days} value={days}>
                  Every {days} days
                </option>
              ))}
            </Select>
          )}
        </span>
      </div>

      {/* The checkpoints, each with how far along it is. Editing them is the overview's
          job; the rail is where a reader checks which one is current. */}
      {milestones.length > 0 && (
        <section className={styles.group} aria-label="Milestones">
          <h3 className={styles.groupTitle}>Milestones</h3>
          <ul className={styles.milestones}>
            {milestones.map((row) => (
              <li
                key={row.milestone.id}
                className={
                  row.current ? `${styles.milestone} ${styles.milestoneCurrent}` : styles.milestone
                }
              >
                <span className={styles.glyph}>
                  <MilestoneGlyph />
                </span>
                <span className={styles.milestoneName}>{row.milestone.name}</span>
                <ProgressRing
                  percent={row.percent}
                  label={row.milestone.name}
                  detail={
                    row.total === 0
                      ? 'no issues yet'
                      : `${row.done} of ${row.total} issues completed`
                  }
                />
                <span className={styles.milestonePercent} aria-hidden="true">
                  {row.percent}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProjectDependencies projectId={project.id} compact addable />
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

interface TimeframeFieldProps {
  readonly title: string;
  readonly date: string;
  readonly granularity: TimeframeGranularity;
  readonly onChange: (date: string | null, granularity: TimeframeGranularity) => void;
}

const GRANULARITIES: readonly { readonly value: TimeframeGranularity; readonly label: string }[] = [
  { value: 'day', label: 'Exact day' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'half', label: 'Half-year' },
  { value: 'year', label: 'Year' },
];

/** One end of the timeframe: the day, and how precisely it is meant. */
function TimeframeField({ title, date, granularity, onChange }: TimeframeFieldProps) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{title}</span>
      <span className={`${styles.value ?? ''} ${styles.dateRow ?? ''}`}>
        <span className={styles.glyph}>
          <CalendarGlyph />
        </span>
        <Input
          type="date"
          aria-label={title}
          className={styles.dateInput}
          value={date}
          // An emptied field is a request to take the date off, which the API spells as its
          // own flag; `null` is how `ProjectFields` says so.
          onChange={(event) =>
            onChange(event.target.value === '' ? null : event.target.value, granularity)
          }
        />
        {date === '' ? null : (
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
        )}
      </span>
    </div>
  );
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
