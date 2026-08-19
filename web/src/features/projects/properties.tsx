/**
 * Project properties — priority, labels, dependencies on the shell sidebar.
 */

import { useActions, useKeyContext } from '~/app/keymap';
import { LabelChip, PriorityIcon, priorityLabel } from '~/components';
import { PriorityPicker } from '~/features/issue/pickers';
import { useEngine } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { report } from '~/features/issue/mutations';
import {
  applyProjectLabel,
  removeProjectLabel,
} from '~/features/project-labels/mutations';
import { ProjectLabelPicker } from '~/features/project-labels/ProjectLabelPicker';
import { updateProject } from './mutations';
import { ProjectDependencies } from './dependencies';
import styles from './properties.module.css';

interface ProjectPropertiesProps {
  readonly projectId: UUID;
}

export function ProjectProperties({ projectId }: ProjectPropertiesProps) {
  const engine = useEngine();
  const priority = useMenuTrigger();
  const labels = useMenuTrigger();

  useKeyContext('detail');

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
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
        .filter((label) => label !== undefined && label.archivedAt === undefined),
    ['projectLabel', 'projectLabelLink'],
    [projectId],
  );

  useActions(
    [
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
      <ProjectDependencies projectId={project.id} compact />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={project.priority}
        onSelect={(level) =>
          updateProject(engine, project.id, { priority: level }).catch(report)
        }
      />
      <ProjectLabelPicker
        open={labels.open}
        onClose={labels.hide}
        trigger={labels.ref}
        value={labelIds}
        onApply={(labelId, displaced) =>
          applyProjectLabel(engine, project.id, labelId, displaced).catch(report)
        }
        onRemove={(labelId) =>
          removeProjectLabel(engine, project.id, labelId).catch(report)
        }
      />
    </div>
  );
}
