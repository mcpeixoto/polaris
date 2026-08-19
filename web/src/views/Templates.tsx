/**
 * Issue templates: the prefilled forms a workspace files instead of a blank one, and the
 * screen where they are written, edited and retired.
 *
 * Three rules shape everything here, and all three come out of the schema rather than out of
 * a preference this screen is free to have.
 *
 * **A template's scope is fixed when it is created.** `UpdateIssueTemplateInput` carries no
 * `teamId`, so nothing on this screen can move a template between a team and the workspace.
 * That is not an omission — moving one changes who is offered it, and the teams that would
 * lose it have to be told rather than have a COALESCE decide for them. So the scope is chosen
 * by *which section's* "New template" button was pressed, the editor says out loud that the
 * choice is permanent while it is still live, and an existing template's scope is a fact
 * rather than a control. A control that exists only to be refused is worse than no control.
 *
 * **A property is an id, and an id has a scope.** A workflow status belongs to exactly one
 * team; a team's label may only go on that team's issues. So a workspace template — one
 * offered in every team — can only safely prefill the things every team has: a priority, an
 * estimate, a workspace label, a person. It can never carry a status, because there is no
 * such thing as a status that every team has. The editor is the forward half of that bargain
 * and simply does not offer one; `templateDefaults` in the feature's mutations is the
 * backward half, dropping what a team cannot use at the moment an issue is filed. Both are
 * needed: this one stops ill-formed templates being written, that one stops the ill-formed
 * ones that already exist — from the API, from a team that has moved on — breaking a create.
 *
 * **Archiving is the end.** `archiveIssueTemplate` keeps the row in Postgres, because
 * `issue.template_id` points at it and the question that column exists to answer needs the
 * template to still be there. But the change it emits is a *delete*, every replica forgets
 * it, and there is no un-archive mutation and no query on this side that can show one again.
 * So there is no archive to browse — see `ArchivedTemplates` at the bottom, which is where
 * this screen says so instead of implying a bin that could be opened.
 */

import { useMemo, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  Select,
  StateIcon,
  Textarea,
} from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { estimateLabel, estimateOptions, estimatesEnabled } from '~/features/estimate';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { archiveTemplate, createTemplate, updateTemplate } from '~/features/templates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import type { IssueTemplate, StateCategory, Store, TemplateProperties, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './Templates.module.css';
import { FormTemplatesPanel } from '~/features/form-templates/FormTemplatesPanel';

/** Which template family the settings screen is editing. */
type TemplateKind = 'standard' | 'form';

/** The scope key a workspace template carries, mirroring the label screen's sentinel. */
const WORKSPACE_SCOPE = 'workspace';

interface Scope {
  readonly id: string;
  readonly label: string;
  /** Absent is the workspace: offered in every team, and able to prefill far less. */
  readonly teamId: UUID | undefined;
}

interface TemplateRow {
  readonly id: UUID;
  readonly teamId: UUID | undefined;
  readonly name: string;
  /**
   * What the template is *for*. Empty and absent are the same thing here, and both occur: a
   * template created without a description has NULL in the column, one whose description was
   * cleared has an empty string, and the server's COALESCE cannot reach NULL again.
   */
  readonly description: string;
  readonly title: string;
  readonly body: string;
  readonly properties: TemplateProperties;
  readonly position: string;
  readonly archived: boolean;
  /** What it prefills, resolved to names. Empty means it prefills nothing at all. */
  readonly prefills: readonly string[];
}

/** Which editor is open, if any. A screen shows one at a time; two would be two drafts. */
type Editing =
  | { readonly kind: 'create'; readonly scopeId: string }
  | { readonly kind: 'edit'; readonly templateId: UUID };

export function Templates() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [kind, setKind] = useState<TemplateKind>('standard');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [archiving, setArchiving] = useState<TemplateRow | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const { rows, scopes } = useLiveQuery(
    (store: Store) => {
      const teams = [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.key.localeCompare(b.key));

      return {
        rows: [...store.issueTemplates.values()].map((template) => rowOf(store, template)),
        scopes: [
          { id: WORKSPACE_SCOPE, label: 'Workspace', teamId: undefined },
          ...teams.map((team) => ({ id: team.id, label: team.name, teamId: team.id })),
        ] as Scope[],
      };
    },
    // Everything the summary line resolves an id against. Without them a renamed status or a
    // deleted label leaves "Status: Todo" on screen next to a template that no longer says
    // that, which is the one thing a screen listing prefills must not do.
    ['issueTemplate', 'team', 'workflowState', 'user', 'label'],
  );

  const grouped = useMemo(() => groupByScope(rows, scopes), [rows, scopes]);
  const archivedRows = useMemo(() => rows.filter((row) => row.archived).sort(byPosition), [rows]);

  /**
   * Writes, and rejects so the editor can keep the draft on screen beside the reason.
   *
   * Deliberately not caught here. A failure belongs next to the fields that caused it — a
   * name the server refuses is a name still in a box the user can fix — and a banner at the
   * top of a settings page beside an editor that has already closed is an error message with
   * nothing to act on.
   */
  const save = async (scope: Scope, template: TemplateRow | null, draft: TemplateDraft) => {
    if (template === null) {
      await createTemplate(engine, {
        teamId: scope.teamId,
        name: draft.name,
        description: draft.description,
        title: draft.title,
        body: draft.body,
        properties: draft.properties,
        createdBy: viewerId ?? undefined,
      });
    } else {
      await updateTemplate(engine, template.id, draft);
    }
    setEditing(null);
  };

  const confirmArchive = () => {
    if (archiving === null) return;
    setArchiveBusy(true);
    setArchiveError(null);
    archiveTemplate(engine, archiving.id)
      .then(() => {
        setArchiveBusy(false);
        setArchiving(null);
      })
      .catch((failure: unknown) => {
        setArchiveBusy(false);
        // The server's own words: the plausible refusals here are a permission this screen
        // does not know about and a template somebody else retired a moment ago, and both
        // are things the user can act on.
        setArchiveError(
          failure instanceof ApiError ? failure.message : 'That template could not be archived.',
        );
      });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Templates</h1>
        <div className={styles.tabs} role="tablist" aria-label="Template kind">
          <Button
            variant={kind === 'standard' ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={kind === 'standard'}
            onClick={() => {
              setKind('standard');
              setEditing(null);
            }}
          >
            Standard
          </Button>
          <Button
            variant={kind === 'form' ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={kind === 'form'}
            onClick={() => {
              setKind('form');
              setEditing(null);
            }}
          >
            Form
          </Button>
        </div>
      </header>

      {kind === 'form' ? (
        <FormTemplatesPanel />
      ) : (
        <>
          <div className={styles.body}>
            {grouped.map((scope) => (
              <section
                key={scope.id}
                className={styles.section}
                aria-labelledby={`scope-${scope.id}`}
              >
                <h2 className={styles.sectionTitle} id={`scope-${scope.id}`}>
                  {scope.label}
                  {scope.teamId === undefined ? <Badge tone="accent">Every team</Badge> : null}
                </h2>
                <p className={styles.sectionHint}>
                  {scope.teamId === undefined
                    ? 'Offered in every team. It can prefill a priority, an estimate, a person and the workspace’s own labels — never a status, because a status belongs to one team.'
                    : `Offered only when filing an issue in ${scope.label}. It can prefill that team’s statuses and labels.`}
                </p>

                {editing?.kind === 'create' && editing.scopeId === scope.id ? (
                  <TemplateEditor
                    key={`new-${scope.id}`}
                    scope={scope}
                    template={null}
                    onSave={(draft) => save(scope, null, draft)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className={styles.sectionActions}>
                    <Button
                      onClick={() => setEditing({ kind: 'create', scopeId: scope.id })}
                      aria-label={`New template for ${scope.label}`}
                    >
                      New template
                    </Button>
                  </div>
                )}

                {scope.templates.length === 0 ? (
                  <EmptyState
                    title="No templates yet"
                    description="A template is the issue somebody files over and over — the bug report with the three questions on it, the release checklist — written down once."
                  />
                ) : (
                  <ul className={styles.list}>
                    {scope.templates.map((row) =>
                      editing?.kind === 'edit' && editing.templateId === row.id ? (
                        <li key={row.id}>
                          <TemplateEditor
                            key={row.id}
                            scope={scope}
                            template={row}
                            onSave={(draft) => save(scope, row, draft)}
                            onCancel={() => setEditing(null)}
                          />
                        </li>
                      ) : (
                        <li key={row.id}>
                          <TemplateListRow
                            row={row}
                            onEdit={() => setEditing({ kind: 'edit', templateId: row.id })}
                            onArchive={() => {
                              setArchiveError(null);
                              setArchiving(row);
                            }}
                          />
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </section>
            ))}

            <ArchivedTemplates rows={archivedRows} />
          </div>

          <ConfirmDialog
            open={archiving !== null}
            title={`Archive ${archiving?.name ?? 'this template'}?`}
            consequence={
              `It stops being offered in every create dialog, for everybody, at once. There is no way back: ` +
              `the API has no un-archive and an archived template cannot be listed or read from this client again. ` +
              `Issues already filed from it keep their link to it, so “how much work came from this template” still has an answer.`
            }
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
        </>
      )}
    </div>
  );
}

interface TemplateListRowProps {
  row: TemplateRow;
  onEdit: () => void;
  onArchive: () => void;
}

function TemplateListRow({ row, onEdit, onArchive }: TemplateListRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowName}>{row.name}</span>
        {row.description === '' ? null : (
          <span className={styles.rowDescription}>{row.description}</span>
        )}
        <span className={styles.prefills}>
          {row.prefills.length === 0
            ? 'Prefills nothing yet — an empty form under a name.'
            : row.prefills.join(' · ')}
        </span>
      </div>

      <span className={styles.rowActions}>
        <Button size="sm" onClick={onEdit} aria-label={`Edit ${row.name}`}>
          Edit
        </Button>
        <IconButton aria-label={`Archive ${row.name}`} icon={<ArchiveIcon />} onClick={onArchive} />
      </span>
    </div>
  );
}

/**
 * Where this screen admits there is no archive to browse.
 *
 * Retiring a template emits a *delete* down the sync stream, so the replica forgets it: the
 * row survives in Postgres for the sake of `issue.template_id`, but no query on this side can
 * reach it and no mutation can bring it back. The list below is therefore almost always
 * empty, and it is here anyway for the case where it is not — a bootstrap that has not caught
 * up, or an IndexedDB snapshot restored from before the delete. Those must not be offered in
 * a create dialog, and they must not vanish from the one screen whose job is to account for
 * every template either.
 *
 * The paragraph is the honest part. "Archived" that cannot be un-archived is a word doing the
 * work of a sentence, and somebody has to read the sentence before they press the button, not
 * after.
 */
function ArchivedTemplates({ rows }: { rows: readonly TemplateRow[] }) {
  return (
    <section className={styles.section} aria-labelledby="scope-archived">
      <h2 className={styles.sectionTitle} id="scope-archived">
        Archived
      </h2>
      <p className={styles.sectionHint}>
        Archiving a template is permanent. It stops being offered everywhere at once, and there is
        no un-archive — not on this screen and not in the API. What survives is the link: issues
        filed from a template keep pointing at it, so the record of what a template produced
        outlives the template.
      </p>

      {rows.length === 0 ? (
        <p className={styles.quiet}>
          Nothing archived is held on this device. An archived template leaves every replica the
          moment it is retired, which is why there is no list here to restore from.
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowName}>{row.name}</span>
                  <span className={styles.prefills}>
                    Archived. It is no longer offered anywhere, and cannot be brought back.
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Everything an editor hands back. The scope is deliberately not in it; see the header. */
interface TemplateDraft {
  readonly name: string;
  readonly description: string;
  readonly title: string;
  readonly body: string;
  readonly properties: TemplateProperties;
}

interface TemplateEditorProps {
  /** The scope the template is in. Chosen by which section this was opened from, then fixed. */
  scope: Scope;
  /** The template being edited, or `null` for one being created. */
  template: TemplateRow | null;
  /** Resolves when the write has been accepted, and rejects with the server's own words. */
  onSave: (draft: TemplateDraft) => Promise<void>;
  onCancel: () => void;
}

/**
 * The editor, opened in place rather than in a dialog.
 *
 * That is not a stylistic choice. The property pickers are the product's Menu, which portals
 * to `document.body` at `--z-dropdown`, and a modal sits at `--z-modal` above it — so a menu
 * opened from inside a dialog renders *behind* the dialog. Inline, the same pickers the issue
 * detail view uses work exactly as they do there, which is worth more than the extra width a
 * dialog would have given: this way there is one status picker in the product, not two.
 *
 * What it offers depends on the scope, and the difference is the whole feature:
 *
 *   - **Status** — a team's only. A workspace template gets a sentence where the control would
 *     be, because a status id belongs to one team and there is no status every team has. Not a
 *     disabled control: a disabled control says "not yet", and this one is never.
 *   - **Labels** — the workspace's, plus this team's when there is a team. At most one from a
 *     group, enforced here by displacement rather than by a refusal at file time.
 *   - **Assignee** — anybody in the workspace, in both scopes. Membership is deliberately not
 *     checked: assigning outside the team is something the product allows, and a template that
 *     names a person is naming a person rather than a seat.
 *   - **Priority** — the same five levels everywhere. Nothing scoped about it.
 *   - **Estimate** — a bare number, which every estimating team can read on its own scale. A
 *     team that does not estimate is offered nothing, and neither is a workspace whose teams
 *     all have estimates turned off.
 */
function TemplateEditor({ scope, template, onSave, onCancel }: TemplateEditorProps) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [stateId, setStateId] = useState<UUID | null>(template?.properties.stateId ?? null);
  const [assigneeId, setAssigneeId] = useState<UUID | null>(
    template?.properties.assigneeId ?? null,
  );
  const [priority, setPriority] = useState(template?.properties.priority ?? 0);
  const [estimate, setEstimate] = useState<number | null>(template?.properties.estimate ?? null);
  const [labelIds, setLabelIds] = useState<readonly UUID[]>(template?.properties.labelIds ?? []);

  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  const priorityMenu = useMenuTrigger();

  const teamId = scope.teamId;
  const data = useLiveQuery(
    (store: Store) => editorData(store, teamId),
    ['label', 'team', 'workflowState', 'user'],
    [teamId],
  );

  const chosenState = data.statuses.find((state) => state.id === stateId);
  const statusName =
    stateId === null ? 'No status' : (chosenState?.name ?? 'A status this team no longer has');
  const assigneeName =
    assigneeId === null ? 'No assignee' : (data.people[assigneeId] ?? 'Somebody who has left');

  // An estimate the ladder no longer offers is still shown, and shown as itself. It happens
  // whenever a team narrows its scale or turns off the extension, and a select that quietly
  // fell back to its first option would display one number while the template held another —
  // and would then save the number on screen the next time anything else was edited.
  const estimates =
    estimate === null || data.estimates.some((option) => option.value === estimate)
      ? data.estimates
      : [
          ...data.estimates,
          { value: estimate, label: `${estimate} — no longer on this scale` },
        ].sort((a, b) => a.value - b.value);

  const toggleLabel = (option: LabelOption) => {
    setLabelIds((current) => {
      if (current.includes(option.id)) return current.filter((id) => id !== option.id);
      if (option.groupKey === null) return [...current, option.id];
      // At most one label from a group may sit on an issue, and the database enforces it. A
      // template carrying two group-mates would have its second application refused halfway
      // through filing an issue, about a template the person filing it did not write.
      const mates = new Set(
        data.sections
          .find((section) => section.key === option.groupKey)
          ?.options.map((mate) => mate.id) ?? [],
      );
      return [...current.filter((id) => !mates.has(id)), option.id];
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A template needs a name — it is what the create dialog offers.');
      return;
    }

    setSaving(true);
    setNameError(null);
    setSaveError(null);
    onSave({
      name: trimmed,
      description: description.trim(),
      title,
      body,
      properties: {
        ...(stateId === null ? null : { stateId }),
        ...(assigneeId === null ? null : { assigneeId }),
        // Zero is the absence of a priority rather than a value, so it is left out entirely
        // and the create dialog's own default stands.
        ...(priority === 0 ? null : { priority }),
        ...(estimate === null ? null : { estimate }),
        ...(labelIds.length === 0 ? null : { labelIds }),
      },
    }).catch((failure: unknown) => {
      setSaving(false);
      setSaveError(
        failure instanceof ApiError ? failure.message : 'That template could not be saved.',
      );
    });
  };

  return (
    <form className={styles.editor} onSubmit={submit} aria-label={editorLabel(scope, template)}>
      <p className={styles.scopeNote}>
        {template === null
          ? `${scopeSentence(scope)} A template’s scope is fixed when it is created and cannot be changed afterwards, so this is the moment to get it right.`
          : `${scopeSentence(scope)} That was fixed when it was created and cannot be changed.`}
      </p>

      <Input
        label="Name"
        value={name}
        error={nameError ?? undefined}
        placeholder="Bug report"
        autoComplete="off"
        hint="What the create dialog offers."
        onChange={(event) => {
          setName(event.target.value);
          if (nameError !== null) setNameError(null);
        }}
      />

      <Input
        label="What it is for"
        value={description}
        placeholder="For anything reproducible — asks for the steps and the build"
        autoComplete="off"
        hint="Shown beside the name in the create dialog, so two similar templates can be told apart."
        onChange={(event) => setDescription(event.target.value)}
      />

      <Input
        label="Issue title"
        value={title}
        placeholder="Bug: "
        autoComplete="off"
        hint="Left empty, the person filing the issue writes their own."
        onChange={(event) => setTitle(event.target.value)}
      />

      <Textarea
        label="Issue description"
        value={body}
        minRows={4}
        maxRows={16}
        hint="Markdown. The prompts and headings the filer fills in."
        onChange={(event) => setBody(event.target.value)}
      />

      <div className={styles.properties}>
        <div className={styles.property}>
          {/* The caption is a visual echo of the button's own accessible name — four
              identical-looking buttons in a row need to say which property they are, and a
              caption that is also announced would say it twice. */}
          <span className={styles.propertyLabel} aria-hidden="true">
            Status
          </span>
          {scope.teamId === undefined ? (
            <p className={styles.propertyNote}>
              A status belongs to one team, so a template offered in every team cannot name one. The
              issue starts in whichever status its team starts issues in.
            </p>
          ) : (
            <Button
              {...status.props}
              fullWidth
              aria-label={`Status: ${statusName}`}
              icon={
                chosenState === undefined ? undefined : (
                  <StateIcon category={chosenState.category} color={chosenState.color} decorative />
                )
              }
            >
              {statusName}
            </Button>
          )}
        </div>

        <div className={styles.property}>
          <span className={styles.propertyLabel} aria-hidden="true">
            Assignee
          </span>
          <Button {...assignee.props} fullWidth aria-label={`Assignee: ${assigneeName}`}>
            {assigneeName}
          </Button>
        </div>

        <div className={styles.property}>
          <span className={styles.propertyLabel} aria-hidden="true">
            Priority
          </span>
          <Button
            {...priorityMenu.props}
            fullWidth
            aria-label={`Priority: ${priorityLabel(priority)}`}
            icon={<PriorityIcon priority={priority} decorative />}
          >
            {priorityLabel(priority)}
          </Button>
        </div>

        <div className={styles.property}>
          {data.estimateNote === null ? (
            <Select
              label="Estimate"
              value={estimate === null ? '' : String(estimate)}
              hint={data.estimateHint ?? undefined}
              onChange={(event) =>
                setEstimate(event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">No estimate</option>
              {estimates.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <span className={styles.propertyLabel} aria-hidden="true">
                Estimate
              </span>
              <p className={styles.propertyNote}>{data.estimateNote}</p>
            </>
          )}
        </div>
      </div>

      <fieldset className={styles.labels}>
        <legend className={styles.legend}>Labels</legend>
        {data.sections.length === 0 ? (
          <p className={styles.quiet}>{data.labelNote}</p>
        ) : (
          data.sections.map((section) => (
            <div key={section.key} className={styles.labelGroup}>
              {section.heading === null ? null : (
                <p className={styles.labelGroupName}>{section.heading}</p>
              )}
              {section.options.map((option) => (
                <Checkbox
                  key={option.id}
                  checked={labelIds.includes(option.id)}
                  label={<LabelChip name={option.name} color={option.color} compact />}
                  onChange={() => toggleLabel(option)}
                />
              ))}
            </div>
          ))
        )}
      </fieldset>

      {saveError === null ? null : (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}

      <div className={styles.editorActions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          {template === null ? 'Create template' : 'Save template'}
        </Button>
      </div>

      {scope.teamId === undefined ? null : (
        <StatusPicker
          open={status.open}
          onClose={status.hide}
          trigger={status.ref}
          teamId={scope.teamId}
          value={stateId ?? undefined}
          onSelect={(chosen) => setStateId(chosen)}
        />
      )}
      <AssigneePicker
        open={assignee.open}
        onClose={assignee.hide}
        trigger={assignee.ref}
        value={assigneeId}
        onSelect={(chosen) => setAssigneeId(chosen)}
      />
      <PriorityPicker
        open={priorityMenu.open}
        onClose={priorityMenu.hide}
        trigger={priorityMenu.ref}
        value={priority}
        onSelect={(chosen) => setPriority(chosen)}
      />
    </form>
  );
}

/** The form's accessible name, so a screen reader lands somewhere that says what it is. */
function editorLabel(scope: Scope, template: TemplateRow | null): string {
  return template === null ? `New template for ${scope.label}` : `Editing ${template.name}`;
}

function scopeSentence(scope: Scope): string {
  return scope.teamId === undefined
    ? 'This template is offered in every team.'
    : `This template is offered only in ${scope.label}.`;
}

interface StatusOption {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly category: StateCategory;
}

interface LabelOption {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  /** The group it sits in, which at most one member of may go on an issue. */
  readonly groupKey: string | null;
}

interface LabelSection {
  readonly key: string;
  /** `null` for the ungrouped run, which leads the list with no heading over it. */
  readonly heading: string | null;
  readonly options: readonly LabelOption[];
}

interface EstimateOption {
  readonly value: number;
  readonly label: string;
}

interface EditorData {
  /** The team's live statuses, for naming the one already chosen. Empty in the workspace. */
  readonly statuses: readonly StatusOption[];
  readonly sections: readonly LabelSection[];
  /** Why there are no labels to offer, when there are none. */
  readonly labelNote: string;
  readonly estimates: readonly EstimateOption[];
  /** Why no estimate is offered, or `null` when one is. */
  readonly estimateNote: string | null;
  /** How the number will be read, when that is not obvious. */
  readonly estimateHint: string | null;
  readonly people: Readonly<Record<UUID, string>>;
}

/**
 * What this scope may prefill, resolved against the replica.
 *
 * The two halves that differ by scope are the statuses — a team's, or none at all — and the
 * estimate ladder. The estimate one is the subtler: a stored estimate is a bare number and
 * every team stores the same numbers, so a workspace template may carry one, but *which*
 * numbers are worth offering depends on the ladders the teams actually use. Offering the
 * union of them is the honest answer: every value offered is one some team's scale names, and
 * a team that reads 3 as "M" is doing exactly what the scale is for.
 */
function editorData(store: Store, teamId: UUID | undefined): EditorData {
  const statuses: StatusOption[] = [];
  if (teamId !== undefined) {
    for (const id of store.workflowStateIdsFor(teamId)) {
      const state = store.get('workflowState', id);
      if (state === undefined || state.archivedAt !== undefined) continue;
      statuses.push({
        id: state.id,
        name: state.name,
        color: state.color,
        category: state.category,
      });
    }
  }

  const people: Record<UUID, string> = {};
  for (const user of store.users.values()) people[user.id] = user.displayName;

  return {
    statuses,
    ...labelOfferings(store, teamId),
    ...estimateOffering(store, teamId),
    people,
  };
}

/** The labels this scope may carry, arranged into the sections the editor draws. */
function labelOfferings(
  store: Store,
  teamId: UUID | undefined,
): Pick<EditorData, 'sections' | 'labelNote'> {
  const groups = new Map<UUID, string>();
  const loose: LabelOption[] = [];
  const grouped = new Map<UUID, LabelOption[]>();

  for (const label of store.labels.values()) {
    if (label.archivedAt !== undefined) continue;
    // A team's label may only go on that team's issues, so a workspace template can never
    // carry one and a team template can only carry its own team's.
    if (label.teamId !== undefined && label.teamId !== teamId) continue;
    if (label.isGroup) {
      groups.set(label.id, label.name);
      continue;
    }
    const option: LabelOption = {
      id: label.id,
      name: label.name,
      color: label.color,
      groupKey: label.parentId ?? null,
    };
    if (label.parentId === undefined) {
      loose.push(option);
      continue;
    }
    const bucket = grouped.get(label.parentId);
    if (bucket === undefined) grouped.set(label.parentId, [option]);
    else bucket.push(option);
  }

  // A label whose group has been archived is still applicable; hiding it because its heading
  // has gone would take a working label away for a reason nobody can see.
  for (const [parentId, bucket] of grouped) {
    if (groups.has(parentId)) continue;
    loose.push(...bucket.map((option) => ({ ...option, groupKey: null })));
    grouped.delete(parentId);
  }

  const byLabelName = (a: LabelOption, b: LabelOption) => a.name.localeCompare(b.name);
  const sections: LabelSection[] = [];
  if (loose.length > 0) {
    sections.push({ key: 'ungrouped', heading: null, options: [...loose].sort(byLabelName) });
  }
  for (const [id, heading] of [...groups].sort((a, b) => a[1].localeCompare(b[1]))) {
    const bucket = grouped.get(id);
    if (bucket === undefined || bucket.length === 0) continue;
    sections.push({ key: id, heading, options: [...bucket].sort(byLabelName) });
  }

  return {
    sections,
    labelNote:
      teamId === undefined
        ? 'This workspace has no labels of its own. A team’s labels belong to that team, so a template offered in every team cannot carry them.'
        : 'Neither this team nor the workspace has a label yet.',
  };
}

/** The estimates this scope may prefill, and why it may not. */
function estimateOffering(
  store: Store,
  teamId: UUID | undefined,
): Pick<EditorData, 'estimates' | 'estimateNote' | 'estimateHint'> {
  if (teamId !== undefined) {
    const team = store.get('team', teamId);
    if (team === undefined || !estimatesEnabled(team)) {
      return {
        estimates: [],
        estimateNote: 'This team does not estimate, so there is nothing to prefill.',
        estimateHint: null,
      };
    }
    return {
      estimates: estimateOptions(team).map((value) => ({
        value,
        label: estimateLabel(value, team.estimateScale),
      })),
      estimateNote: null,
      estimateHint: null,
    };
  }

  // The workspace scope. Every estimating team stores the same numbers, so the union of
  // their ladders is exactly the set of values some team has a name for.
  const values = new Set<number>();
  for (const candidate of store.teams.values()) {
    if (candidate.archivedAt !== undefined || !estimatesEnabled(candidate)) continue;
    for (const value of estimateOptions(candidate)) values.add(value);
  }
  if (values.size === 0) {
    return {
      estimates: [],
      estimateNote: 'No team in this workspace estimates, so there is nothing to prefill.',
      estimateHint: null,
    };
  }
  return {
    estimates: [...values].sort((a, b) => a - b).map((value) => ({ value, label: String(value) })),
    estimateNote: null,
    estimateHint:
      'Stored as a number. Each team reads it on its own scale — 3 is 3 on Fibonacci and M on t-shirt sizes.',
  };
}

/** One template, with every id in it resolved to something a reader can check. */
function rowOf(store: Store, template: IssueTemplate): TemplateRow {
  return {
    id: template.id,
    teamId: template.teamId,
    name: template.name,
    description: (template.description ?? '').trim(),
    title: template.title,
    body: template.body,
    properties: template.properties,
    position: template.position,
    archived: template.archivedAt !== undefined,
    prefills: prefillsOf(store, template),
  };
}

/**
 * What a template prefills, in words.
 *
 * Every entry is resolved rather than counted, because the question this line answers is "is
 * this template still saying what I meant" — and a status that has been renamed, an assignee
 * who has left or a label somebody deleted are exactly the cases where the honest answer is
 * no. An id that resolves to nothing says so instead of being quietly dropped.
 */
function prefillsOf(store: Store, template: IssueTemplate): string[] {
  const out: string[] = [];
  if (template.title !== '') out.push('Title');
  if (template.body !== '') out.push('Description');

  const properties = template.properties;
  if (properties.stateId !== undefined) {
    const state = store.get('workflowState', properties.stateId);
    out.push(`Status: ${state?.name ?? 'a status that no longer exists'}`);
  }
  if (properties.assigneeId !== undefined) {
    const user = store.get('user', properties.assigneeId);
    out.push(user?.displayName ?? 'somebody who has left');
  }
  if (properties.priority !== undefined && properties.priority !== 0) {
    out.push(priorityLabel(properties.priority));
  }
  if (properties.estimate !== undefined) {
    const team = template.teamId === undefined ? undefined : store.get('team', template.teamId);
    out.push(
      `Estimate ${
        team === undefined || !estimatesEnabled(team)
          ? String(properties.estimate)
          : estimateLabel(properties.estimate, team.estimateScale)
      }`,
    );
  }

  const names: string[] = [];
  let missing = 0;
  for (const id of properties.labelIds ?? []) {
    const label = store.get('label', id);
    if (label === undefined) missing += 1;
    else names.push(label.name);
  }
  if (names.length > 0) out.push(names.join(', '));
  if (missing > 0)
    out.push(`${missing} ${missing === 1 ? 'label' : 'labels'} that no longer exist`);

  return out;
}

interface ScopeGroup extends Scope {
  readonly templates: readonly TemplateRow[];
}

/**
 * Splits the live templates into their scopes.
 *
 * Ordered by position, which for templates is minted across the whole workspace rather than
 * per scope — the server reads one maximum for the workspace — so unlike labels these keys
 * really are comparable between a team's templates and the workspace's. Name breaks ties, so
 * a list is never in an order that depends on insertion.
 */
function groupByScope(rows: readonly TemplateRow[], scopes: readonly Scope[]): ScopeGroup[] {
  return scopes.map((scope) => ({
    ...scope,
    templates: rows.filter((row) => !row.archived && row.teamId === scope.teamId).sort(byPosition),
  }));
}

function byPosition(a: TemplateRow, b: TemplateRow): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : a.name.localeCompare(b.name);
}

/* One 16px glyph, drawn here rather than pulled from a set: the component library has no icon
   module, and a dependency for one path is a dependency to keep current. */
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
