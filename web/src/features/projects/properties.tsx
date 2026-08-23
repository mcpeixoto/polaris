/**
 * Project properties — status, priority, labels, dependencies on the shell sidebar.
 */

import { useActions, useKeyContext } from '~/app/keymap';
import { LabelChip, PriorityIcon, priorityLabel, StateIcon } from '~/components';
import { PriorityPicker } from '~/features/issue/pickers';
import { useEngine } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectLabel, UUID } from '~/store';

import { report } from '~/features/issue/mutations';
import { applyProjectLabel, removeProjectLabel } from '~/features/project-labels/mutations';
import { ProjectLabelPicker } from '~/features/project-labels/ProjectLabelPicker';
import { Select } from '~/components';
import type { ProjectUpdateSchedule } from '~/store';
import { updateProject } from './mutations';
import { ProjectDependencies } from './dependencies';
import { ProjectStatusPicker, PROJECT_STATUS_ICON } from './ProjectStatusPicker';
import styles from './properties.module.css';

interface ProjectPropertiesProps {
  readonly projectId: UUID;
}

export function ProjectProperties({ projectId }: ProjectPropertiesProps) {
  const engine = useEngine();
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const labels = useMenuTrigger();

  useKeyContext('detail');

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const currentStatus = useLiveQuery(
    (store) => {
      const row = store.projects.get(projectId);
      return row === undefined ? null : (store.projectStatuses.get(row.statusId) ?? null);
    },
    ['project', 'projectStatus'],
    [projectId],
  );

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
      <ProjectDependencies projectId={project.id} compact />
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
