/**
 * Project templates settings: prefilled projects with milestones and starter issues.
 */

import { useMemo, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Badge, Button, EmptyState, Input, Select, Textarea, priorityLabel } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  archiveProjectTemplate,
  createProjectTemplate,
  createProjectTemplateIssue,
  createProjectTemplateMilestone,
  deleteProjectTemplateIssue,
  deleteProjectTemplateMilestone,
  issuesForTemplate,
  milestonesForTemplate,
  updateProjectTemplate,
} from '~/features/project-templates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import { byOrderKey } from '~/store';
import type {
  ProjectTemplate,
  ProjectTemplateIssue,
  ProjectTemplateMilestone,
  ProjectTemplateProperties,
  Store,
  UUID,
} from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/views/Templates.module.css';

const WORKSPACE_SCOPE = 'workspace';

interface Scope {
  readonly id: string;
  readonly label: string;
  readonly teamId: UUID | undefined;
}

interface ProjectTemplateRow {
  readonly id: UUID;
  readonly teamId: UUID | undefined;
  readonly name: string;
  readonly description: string;
  readonly summary: string;
  readonly body: string;
  readonly properties: ProjectTemplateProperties;
  readonly position: string;
  readonly milestones: readonly ProjectTemplateMilestone[];
  readonly issues: readonly ProjectTemplateIssue[];
}

type Editing =
  | { readonly kind: 'create'; readonly scopeId: string }
  | { readonly kind: 'edit'; readonly templateId: UUID };

export function ProjectTemplatesPanel() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [archiving, setArchiving] = useState<ProjectTemplateRow | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const { rows, scopes } = useLiveQuery(
    (store: Store) => {
      const teams = [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.key.localeCompare(b.key));

      return {
        rows: [...store.projectTemplates.values()].map((template) => rowOf(store, template)),
        scopes: [
          { id: WORKSPACE_SCOPE, label: 'Workspace', teamId: undefined },
          ...teams.map((team) => ({ id: team.id, label: team.name, teamId: team.id })),
        ] as Scope[],
      };
    },
    ['projectTemplate', 'projectTemplateMilestone', 'projectTemplateIssue', 'team'],
  );

  const grouped = useMemo(() => {
    const byScope = new Map<string, ProjectTemplateRow[]>();
    for (const scope of scopes) byScope.set(scope.id, []);
    for (const row of rows) {
      if (row.teamId === undefined) byScope.get(WORKSPACE_SCOPE)?.push(row);
      else byScope.get(row.teamId)?.push(row);
    }
    return scopes.map((scope) => ({
      ...scope,
      templates: (byScope.get(scope.id) ?? []).sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name),
      ),
    }));
  }, [rows, scopes]);

  const save = async (scope: Scope, existing: ProjectTemplateRow | null, draft: TemplateDraft) => {
    if (existing === null) {
      await createProjectTemplate(engine, {
        teamId: scope.teamId,
        name: draft.name,
        description: draft.description,
        summary: draft.summary,
        body: draft.body,
        properties: draft.properties,
        createdBy: viewerId ?? undefined,
      });
    } else {
      await updateProjectTemplate(engine, existing.id, draft);
    }
    setEditing(null);
  };

  const confirmArchive = () => {
    if (archiving === null) return;
    setArchiveBusy(true);
    archiveProjectTemplate(engine, archiving.id)
      .then(() => {
        setArchiving(null);
        setArchiveError(null);
      })
      .catch((failure: unknown) => {
        setArchiveError(
          failure instanceof ApiError
            ? failure.message
            : 'That project template could not be archived.',
        );
      })
      .finally(() => setArchiveBusy(false));
  };

  return (
    <div className={styles.body}>
      {grouped.map((scope) => (
        <section
          key={scope.id}
          className={styles.section}
          aria-labelledby={`project-scope-${scope.id}`}
        >
          <h2 className={styles.sectionTitle} id={`project-scope-${scope.id}`}>
            {scope.label}
            {scope.teamId === undefined ? <Badge tone="accent">Every team</Badge> : null}
          </h2>
          <p className={styles.sectionHint}>
            Prefilled projects with milestones and starter issues. Choosing one at create time
            copies its name, summary and properties.
          </p>

          {editing?.kind === 'create' && editing.scopeId === scope.id ? (
            <ProjectTemplateEditor
              scope={scope}
              template={null}
              onSave={(draft) => save(scope, null, draft)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className={styles.sectionActions}>
              <Button onClick={() => setEditing({ kind: 'create', scopeId: scope.id })}>
                New project template
              </Button>
            </div>
          )}

          {scope.templates.length === 0 ? (
            <EmptyState
              title="No project templates yet"
              description="Project templates prefill a new project with milestones and starter issues."
            />
          ) : (
            <ul className={styles.list}>
              {scope.templates.map((row) =>
                editing?.kind === 'edit' && editing.templateId === row.id ? (
                  <li key={row.id}>
                    <ProjectTemplateEditor
                      scope={scope}
                      template={row}
                      onSave={(draft) => save(scope, row, draft)}
                      onCancel={() => setEditing(null)}
                      onAddMilestone={(name) =>
                        createProjectTemplateMilestone(engine, {
                          projectTemplateId: row.id,
                          name,
                        })
                      }
                      onDeleteMilestone={(id) => deleteProjectTemplateMilestone(engine, id)}
                      onAddIssue={(title) =>
                        createProjectTemplateIssue(engine, {
                          projectTemplateId: row.id,
                          title,
                        })
                      }
                      onDeleteIssue={(id) => deleteProjectTemplateIssue(engine, id)}
                    />
                  </li>
                ) : (
                  <li key={row.id}>
                    <div className={styles.row}>
                      <div className={styles.rowText}>
                        <span className={styles.rowName}>{row.name}</span>
                        {row.description !== '' ? (
                          <span className={styles.rowDescription}>{row.description}</span>
                        ) : null}
                        <span className={styles.prefills}>
                          {row.milestones.length === 0 && row.issues.length === 0
                            ? 'No milestones or issues yet'
                            : `${row.milestones.length} milestone${row.milestones.length === 1 ? '' : 's'} · ${row.issues.length} issue${row.issues.length === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <span className={styles.rowActions}>
                        <Button
                          size="sm"
                          onClick={() => setEditing({ kind: 'edit', templateId: row.id })}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setArchiving(row)}>
                          Archive
                        </Button>
                      </span>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      ))}

      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? 'this project template'}?`}
        consequence="It stops being offered in create dialogs. Projects already created from it keep their link."
        confirmLabel="Archive it"
        destructive
        busy={archiveBusy}
        error={archiveError ?? undefined}
        onConfirm={confirmArchive}
        onClose={() => {
          setArchiving(null);
          setArchiveError(null);
        }}
      />
    </div>
  );
}

interface TemplateDraft {
  readonly name: string;
  readonly description: string;
  readonly summary: string;
  readonly body: string;
  readonly properties: ProjectTemplateProperties;
}

function ProjectTemplateEditor({
  scope,
  template,
  onSave,
  onCancel,
  onAddMilestone,
  onDeleteMilestone,
  onAddIssue,
  onDeleteIssue,
}: {
  scope: Scope;
  template: ProjectTemplateRow | null;
  onSave: (draft: TemplateDraft) => void;
  onCancel: () => void;
  onAddMilestone?: (name: string) => void;
  onDeleteMilestone?: (id: UUID) => void;
  onAddIssue?: (title: string) => void;
  onDeleteIssue?: (id: UUID) => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [summary, setSummary] = useState(template?.summary ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [statusId, setStatusId] = useState(template?.properties.statusId ?? '');
  const [priority, setPriority] = useState(String(template?.properties.priority ?? 0));
  const [leadId, setLeadId] = useState(template?.properties.leadId ?? '');
  const [startDate, setStartDate] = useState(template?.properties.startDate ?? '');
  const [targetDate, setTargetDate] = useState(template?.properties.targetDate ?? '');
  const [color, setColor] = useState(template?.properties.color ?? '');
  const [milestoneName, setMilestoneName] = useState('');
  const [issueTitle, setIssueTitle] = useState('');

  const editorData = useLiveQuery(
    (store: Store) => ({
      statuses: [...store.projectStatuses.values()]
        .filter((status) => status.archivedAt === undefined)
        .sort(byOrderKey('position')),
      users: [...store.users.values()]
        .filter((user) => user.archivedAt === undefined)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }),
    ['projectStatus', 'user'],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;

    const properties: ProjectTemplateProperties = {
      ...(statusId === '' ? null : { statusId }),
      ...(priority === '0' ? null : { priority: Number(priority) }),
      ...(leadId === '' ? null : { leadId }),
      ...(startDate === '' ? null : { startDate }),
      ...(targetDate === '' ? null : { targetDate }),
      ...(color.trim() === '' ? null : { color: color.trim() }),
    };

    onSave({
      name: trimmed,
      description: description.trim(),
      summary: summary.trim(),
      body,
      properties,
    });
  };

  const addMilestone = (event: FormEvent) => {
    event.preventDefault();
    if (onAddMilestone === undefined || milestoneName.trim() === '') return;
    onAddMilestone(milestoneName.trim());
    setMilestoneName('');
  };

  const addIssue = (event: FormEvent) => {
    event.preventDefault();
    if (onAddIssue === undefined || issueTitle.trim() === '') return;
    onAddIssue(issueTitle.trim());
    setIssueTitle('');
  };

  return (
    <form className={styles.editor} onSubmit={submit}>
      <p className={styles.scopeNote}>
        {template === null
          ? `This template is offered in ${scope.teamId === undefined ? 'every team' : scope.label}.`
          : `Scope: ${scope.teamId === undefined ? 'every team' : scope.label}.`}
      </p>

      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label="What it is for"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        hint="Shown beside the name in the create dialog."
      />
      <Input
        label="Project summary"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        hint="Prefills the summary on a new project."
      />
      <Textarea
        label="Project description"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        minRows={4}
        maxRows={16}
        hint="Markdown. Prefills the project description."
      />

      <div className={styles.properties}>
        <Select label="Status" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
          <option value="">No status</option>
          {editorData.statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </Select>

        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {[0, 1, 2, 3, 4].map((level) => (
            <option key={level} value={String(level)}>
              {priorityLabel(level)}
            </option>
          ))}
        </Select>

        <Select label="Lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
          <option value="">No lead</option>
          {editorData.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </Select>

        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />

        <Input
          label="Target date"
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />

        <Input
          label="Color"
          value={color}
          placeholder="#5e6ad2"
          onChange={(e) => setColor(e.target.value)}
        />
      </div>

      {template === null ? null : (
        <>
          <h3 className={styles.legend}>Milestones</h3>
          <ul className={styles.list}>
            {template.milestones.map((milestone) => (
              <li key={milestone.id} className={styles.row}>
                <span>{milestone.name}</span>
                {onDeleteMilestone === undefined ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onDeleteMilestone(milestone.id)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {onAddMilestone === undefined ? null : (
            <div className={styles.fieldAdd}>
              <Input
                label="Milestone name"
                value={milestoneName}
                onChange={(e) => setMilestoneName(e.target.value)}
              />
              <Button type="button" onClick={addMilestone}>
                Add milestone
              </Button>
            </div>
          )}

          <h3 className={styles.legend}>Starter issues</h3>
          <ul className={styles.list}>
            {template.issues.map((issue) => (
              <li key={issue.id} className={styles.row}>
                <span>{issue.title}</span>
                {onDeleteIssue === undefined ? null : (
                  <Button type="button" variant="ghost" onClick={() => onDeleteIssue(issue.id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {onAddIssue === undefined ? null : (
            <div className={styles.fieldAdd}>
              <Input
                label="Issue title"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
              />
              <Button type="button" onClick={addIssue}>
                Add issue
              </Button>
            </div>
          )}
        </>
      )}

      <div className={styles.editorActions}>
        <Button type="submit">Save</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function rowOf(store: Store, template: ProjectTemplate): ProjectTemplateRow {
  return {
    id: template.id,
    teamId: template.teamId,
    name: template.name,
    description: (template.description ?? '').trim(),
    summary: template.summary,
    body: template.body,
    properties: template.properties,
    position: template.position,
    milestones: milestonesForTemplate(store, template.id),
    issues: issuesForTemplate(store, template.id),
  };
}
