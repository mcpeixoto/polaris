/**
 * Project properties — everything the project *is*, editable, on the shell sidebar.
 *
 * The rail used to hold status, priority, labels and the update schedule, which left the
 * lead, both ends of the timeframe, the summary and the description with no editor
 * anywhere in the client: fields the API accepts, the store replicates and the timeline
 * draws, that nobody could set. They are here now, in the rail's own label treatment.
 */

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Input,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  StateIcon,
  Textarea,
} from '~/components';
import { AssigneePicker, PriorityPicker } from '~/features/issue/pickers';
import { useEngine } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectLabel, TimeframeGranularity, UUID } from '~/store';

import { report } from '~/features/issue/mutations';
import { applyProjectLabel, removeProjectLabel } from '~/features/project-labels/mutations';
import { ProjectLabelPicker } from '~/features/project-labels/ProjectLabelPicker';
import { Select } from '~/components';
import type { ProjectUpdateSchedule } from '~/store';
import { updateProject } from './mutations';
import { ProjectDependencies } from './dependencies';
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
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Status</h3>
        <button
          type="button"
          className={styles.propertyButton}
          {...status.props}
          aria-label="Set status"
        >
          {currentStatus === null ? (
            'Set status'
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
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Priority</h3>
        <button
          type="button"
          className={styles.propertyButton}
          {...priority.props}
          aria-label="Set priority"
        >
          <PriorityIcon priority={project.priority} decorative />
          {priorityLabel(project.priority)}
        </button>
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Lead</h3>
        <button
          type="button"
          className={styles.propertyButton}
          {...lead.props}
          aria-label="Set lead"
        >
          {currentLead === null ? (
            'No lead'
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
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Labels</h3>
        <button
          type="button"
          className={styles.propertyButton}
          {...labels.props}
          aria-label="Set labels"
        >
          {appliedLabels.length === 0 ? (
            'Add labels'
          ) : (
            <span className={styles.labelRun}>
              {appliedLabels.map((label) => (
                <LabelChip key={label.id} name={label.name} color={label.color} compact />
              ))}
            </span>
          )}
        </button>
      </section>
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
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Summary</h3>
        {/* Saved on blur rather than per keystroke: this is prose, and a mutation per
            character would put a hundred entries in the activity feed for one sentence. */}
        <Textarea
          aria-label="Summary"
          value={project.summary ?? ''}
          minRows={2}
          placeholder="What does done look like?"
          onBlur={(event) => {
            const summary = event.target.value.trim();
            if (summary === (project.summary ?? '')) return;
            updateProject(engine, project.id, { summary }).catch(report);
          }}
        />
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Description</h3>
        <Textarea
          aria-label="Description"
          value={project.description}
          minRows={3}
          maxRows={12}
          placeholder="Background, scope, links."
          onBlur={(event) => {
            const description = event.target.value;
            if (description === project.description) return;
            updateProject(engine, project.id, { description }).catch(report);
          }}
        />
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Update schedule</h3>
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
          <label className={styles.customField}>
            <span className={styles.customLabel}>Every (days)</span>
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
                  {days} days
                </option>
              ))}
            </Select>
          </label>
        )}
      </section>
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
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.dateRow}>
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
      </div>
    </section>
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
