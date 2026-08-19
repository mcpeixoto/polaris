/**
 * Project properties — priority on the shell sidebar and command menu.
 */

import { useActions, useKeyContext } from '~/app/keymap';
import { PriorityIcon, priorityLabel } from '~/components';
import { PriorityPicker } from '~/features/issue/pickers';
import { useEngine } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { report } from '~/features/issue/mutations';
import { updateProject } from './mutations';
import { ProjectDependencies } from './dependencies';
import styles from './properties.module.css';

interface ProjectPropertiesProps {
  readonly projectId: UUID;
}

export function ProjectProperties({ projectId }: ProjectPropertiesProps) {
  const engine = useEngine();
  const priority = useMenuTrigger();

  useKeyContext('detail');

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
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
    </div>
  );
}
