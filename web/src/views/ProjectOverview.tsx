/**
 * Project overview — the project as a document: what it is for, how it is going, and the
 * checkpoints on the way.
 *
 * One centred column of about 720px, which is a measure rather than a layout decision: the
 * summary, the description and an update are prose, and prose set across a 1600px window is
 * not read, it is skimmed twice.
 *
 * It reads top to bottom the way Linear's does. The summary first, because it is the
 * sentence somebody arriving from the list is looking for. Then the properties as a row of
 * pills — the same facts the rail carries, stated where the reader already is, so checking
 * the lead does not mean crossing the screen. Then the resources, the standing answer to
 * "how is it going", the description, and the milestones. Everything that is a property of
 * the project rather than its content is *editable* in the rail; this row is the copy you
 * can also click.
 *
 * The name is the shell's, in the breadcrumb, which is also where it is renamed. The graph
 * is the rail's, beside the dates it is drawn against.
 *
 * The update *feed* is the activity tab's, not this one's. Both used to draw every update,
 * with different affordances on each copy — edit here, edit and delete there — which made
 * "where do I delete this from" a question about which tab you happened to be on. This tab
 * keeps the composer and the standing answer to "how is it going"; the history is one click
 * away and says so.
 */

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useKeymap } from '~/app/keymap';
import {
  Avatar,
  Button,
  DatePicker,
  IconButton,
  Input,
  Menu,
  PriorityIcon,
  priorityLabel,
  PropertyPill,
  SaveIndicator,
  StateIcon,
  Textarea,
  Tooltip,
  useSaveState,
  type MenuNode,
} from '~/components';
import { DescriptionEditor } from '~/editor/DescriptionEditor';
import { report } from '~/features/issue/mutations';
import { AssigneePicker, PriorityPicker } from '~/features/issue/pickers';
import { browserTimezone } from '~/features/locale';
import { UserPicker } from '~/features/members/UserPicker';
import { MembersGlyph, NoPersonGlyph, PlusGlyph } from '~/features/projects/glyphs';
import { formatTimeframe } from '~/features/projects/properties';
import { ProjectStatusPicker } from '~/features/projects/ProjectStatusPicker';
import { PROJECT_STATUS_ICON } from '~/features/projects/statusCategories';
import {
  addProjectMember,
  removeProjectMember,
  updateProject,
} from '~/features/projects/mutations';
import { MilestoneSection } from '~/features/project-milestones/MilestoneSection';
import { createProjectUpdate } from '~/features/project-updates/mutations';
import { HealthDot, ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { HealthGlyph, PencilGlyph } from '~/features/project-updates/glyphs';
import { ProjectUpdateEditor } from '~/features/project-updates/ProjectUpdateEditor';
import {
  listProjectUpdates,
  PROJECT_UPDATE_HEALTH_LABEL,
  PROJECT_UPDATE_HEALTH_TOKEN,
} from '~/features/project-updates/helpers';
import { personName } from '~/features/prefs/prefs';
import { exact, when } from '~/features/time';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { IssueCustomers } from '~/features/customers/IssueCustomers';
import type { ProjectUpdateHealth, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './ProjectOverview.module.css';

const HEALTHS: readonly ProjectUpdateHealth[] = ['on_track', 'at_risk', 'off_track'];

export function ProjectOverview() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [editingLatest, setEditingLatest] = useState(false);
  const healthMenu = useMenuTrigger();

  // Autosave with nothing to show for it was the state of three detail screens: the summary
  // and the description both write on blur, and a refused write looked exactly like a
  // successful one. This says which of the two just happened.
  const save = useSaveState((failure) =>
    failure instanceof ApiError ? failure.message : 'That change could not be saved.',
  );

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const latest = useLiveQuery(
    (store) => {
      const [first] = listProjectUpdates(store, projectId);
      if (first === undefined) return null;
      return { update: first, author: store.users.get(first.authorId)?.displayName ?? null };
    },
    ['projectUpdate', 'user'],
    [projectId],
  );

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = personName(user);
      return out;
    },
    ['user'],
  );

  if (project === null) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || viewerId === null) return;
    // A blank post is a health change with nothing said about it, and the feed reads as a
    // row of empty entries. Refused here rather than at the API, so the answer is instant.
    const written = body.trim();
    if (written === '') {
      setPostError('An update needs something to say.');
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      await createProjectUpdate(engine, {
        projectId: project.id,
        health,
        body: written,
        authorId: viewerId,
      });
      setBody('');
    } catch (failure) {
      // Without this the promise rejected into nothing: the form cleared its posting flag
      // in `finally` and looked exactly as it does after a successful post, so a refused
      // update — offline, a server that said no — read as one that had gone out.
      setPostError(failure instanceof ApiError ? failure.message : 'That update was not posted.');
    } finally {
      setPosting(false);
    }
  };

  const healthItems: MenuNode[] = HEALTHS.map((value) => ({
    id: value,
    label: PROJECT_UPDATE_HEALTH_LABEL[value],
    icon: <HealthGlyph health={value} />,
    selected: value === health,
    onSelect: () => setHealth(value),
  }));

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        {/* Summary and description are the page, not a form, so they are unboxed and save on
            blur: prose, and a mutation per keystroke would put a hundred entries in the
            activity feed for one sentence. */}
        <div className={styles.saveRow}>
          <SaveIndicator state={save.state} />
        </div>
        <SummaryField
          key={`summary:${project.summary ?? ''}`}
          stored={project.summary ?? ''}
          onSave={(summary) => void save.run(() => updateProject(engine, project.id, { summary }))}
        />
        {save.error === undefined ? null : (
          <p className={styles.error} role="alert">
            {save.error}
          </p>
        )}

        <PropertyRow projectId={project.id} />
        <ResourceRow projectId={project.id} />

        <section className={styles.updateSection} aria-labelledby={`updates-${project.id}`}>
          <h3 className={styles.sectionTitle} id={`updates-${project.id}`}>
            {latest === null ? 'Write first project update' : 'Latest update'}
          </h3>
          {latest === null ? null : (
            <ul className={styles.updates}>
              <li
                className={styles.card}
                style={{
                  borderInlineStartColor: `var(${PROJECT_UPDATE_HEALTH_TOKEN[latest.update.health]})`,
                }}
              >
                <div className={styles.cardHead}>
                  <ProjectHealthBadge health={latest.update.health} />
                  {latest.author !== null && (
                    <span className={styles.cardMeta} title={exact(latest.update.createdAt)}>
                      {latest.author} · {when(latest.update.createdAt)}
                      {latest.update.editedAt === undefined ? '' : ' · edited'}
                    </span>
                  )}
                  {/* Author-only, because the server refuses anybody else's edit. */}
                  {viewerId === latest.update.authorId && !editingLatest && (
                    <IconButton
                      size="sm"
                      className={styles.cardEdit}
                      icon={<PencilGlyph />}
                      aria-label="Edit update"
                      tooltip="Edit update"
                      onClick={() => setEditingLatest(true)}
                    />
                  )}
                </div>
                {editingLatest ? (
                  <ProjectUpdateEditor
                    update={latest.update}
                    onDone={() => setEditingLatest(false)}
                  />
                ) : (
                  latest.update.body !== '' && (
                    <p className={styles.cardBody}>{latest.update.body}</p>
                  )
                )}
              </li>
            </ul>
          )}

          {/* Correcting a post and writing the next one are the same decision made twice,
              so the composer stands down while the editor is open — which also keeps one
              "Health" control on the screen rather than two identically named ones. */}
          {!editingLatest && (
            <form className={styles.composer} onSubmit={onSubmit}>
              <Textarea
                label="Update"
                hideLabel
                surface="plain"
                value={body}
                minRows={2}
                placeholder="What changed since the last update?"
                onChange={(event) => {
                  setBody(event.target.value);
                  if (postError !== null) setPostError(null);
                }}
              />
              {postError === null ? null : (
                <p className={styles.error} role="alert">
                  {postError}
                </p>
              )}
              <div className={styles.composerFoot}>
                <Button
                  {...healthMenu.props}
                  variant="secondary"
                  aria-label="Health"
                  icon={<HealthDot health={health} />}
                >
                  {PROJECT_UPDATE_HEALTH_LABEL[health]}
                </Button>
                <Menu
                  open={healthMenu.open}
                  onClose={healthMenu.hide}
                  trigger={healthMenu.ref}
                  label="Health"
                  items={healthItems}
                />
                <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
                  Post update
                </Button>
              </div>
            </form>
          )}
        </section>

        {/* The rich editor rather than a keyed `Textarea`. The key was the bug: a change
            arriving over sync remounted the field, so somebody else's edit threw away the
            paragraph you were part-way through typing. The editor keeps a draft that only
            exists while the field has focus, which is the same fix the title made. */}
        <section className={styles.proseSection}>
          <h3 className={styles.rowLabel}>Description</h3>
          <div className={styles.description}>
            <DescriptionEditor
              target={{ kind: 'project', id: project.id }}
              description={project.description}
              names={names}
              viewerId={viewerId}
              enterSubmits={false}
              onSave={(description) =>
                void save.run(() => updateProject(engine, project.id, { description }))
              }
            />
          </div>
        </section>

        <MilestoneSection projectId={project.id} />

        {/* Dependencies and the graph are drawn once, in the properties rail. They used to be
            here as well, which put two copies of the same lists on one screen — and the two
            disagreed about whether you could add to them. */}
        <IssueCustomers projectId={project.id} />
      </div>
    </div>
  );
}

/**
 * The project's properties, inline, as the row of pills the create dialogue already uses.
 *
 * The same values the rail edits, and this is the one place in the product where saying a
 * thing twice is right: the rail can be folded away, the reader is looking at the top of the
 * document, and "who leads this" should not cost a glance across a 1600px window. Each pill
 * carries its value's glyph and is described by its property name, per the standing
 * exception in `docs/03-architecture/08-ui-composition.md`.
 */
function PropertyRow({ projectId }: { readonly projectId: UUID }) {
  const engine = useEngine();
  const status = useMenuTrigger();
  const priority = useMenuTrigger();
  const lead = useMenuTrigger();
  const members = useMenuTrigger();
  const startDate = useMenuTrigger<HTMLButtonElement>('dialog');
  const targetDate = useMenuTrigger<HTMLButtonElement>('dialog');

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

  const teams = useLiveQuery(
    (store) =>
      [...store.projectTeamIdsFor(projectId)]
        .map((id) => store.projectTeams.get(id))
        .map((link) => (link === undefined ? undefined : store.teams.get(link.teamId)))
        .filter((team): team is NonNullable<typeof team> => team !== undefined)
        .map((team) => ({ id: team.id, key: team.key })),
    ['projectTeam', 'team'],
    [projectId],
  );

  if (row === null) return null;
  const { project } = row;
  const memberIds = new Set(memberRows.map((user) => user.id));

  return (
    <div className={styles.propertyRow}>
      <span className={styles.rowLabel}>Properties</span>
      <div className={styles.pills}>
        <PropertyPill
          {...status.props}
          name="Status"
          describe={`${projectId}-overview-status`}
          empty={row.status === null ? 'No status' : undefined}
          icon={
            row.status === null ? undefined : (
              <StateIcon
                category={PROJECT_STATUS_ICON[row.status.category]}
                color={row.status.color}
                decorative
              />
            )
          }
        >
          {row.status === null ? 'Status' : row.status.name}
        </PropertyPill>
        <PropertyPill
          {...priority.props}
          name="Priority"
          describe={`${projectId}-overview-priority`}
          empty={project.priority === 0 ? 'No priority' : undefined}
          icon={<PriorityIcon priority={project.priority} decorative />}
        >
          {priorityLabel(project.priority)}
        </PropertyPill>
        <PropertyPill
          {...lead.props}
          name="Lead"
          describe={`${projectId}-overview-lead`}
          empty={row.lead === null ? 'No lead' : undefined}
          icon={
            row.lead === null ? (
              <NoPersonGlyph />
            ) : (
              <Avatar
                name={row.lead.displayName}
                src={row.lead.avatarUrl ?? null}
                size="xs"
                colorKey={row.lead.id}
                decorative
              />
            )
          }
        >
          {row.lead === null ? 'Lead' : row.lead.displayName}
        </PropertyPill>
        <PropertyPill
          {...members.props}
          name="Members"
          describe={`${projectId}-overview-members`}
          empty={memberRows.length === 0 ? 'No members' : undefined}
          icon={memberRows.length === 0 ? <MembersGlyph /> : undefined}
        >
          {memberRows.length === 0 ? (
            'Members'
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
              </span>
            </Tooltip>
          )}
        </PropertyPill>
        <PropertyPill
          {...startDate.props}
          name="Start date"
          describe={`${projectId}-overview-start`}
          empty={project.startDate === undefined ? 'No start date' : undefined}
        >
          {project.startDate === undefined
            ? 'Start'
            : formatTimeframe(project.startDate, project.startDateGranularity ?? 'day')}
        </PropertyPill>
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
        <PropertyPill
          {...targetDate.props}
          name="Target date"
          describe={`${projectId}-overview-target`}
          empty={project.targetDate === undefined ? 'No target date' : undefined}
        >
          {project.targetDate === undefined
            ? 'Target'
            : formatTimeframe(project.targetDate, project.targetDateGranularity ?? 'day')}
        </PropertyPill>
        {teams.length === 0 ? null : (
          // Stated, not offered: a project's teams are written from its own settings, and a
          // pill here would look like a second, half-informed way to change them.
          <span className={styles.staticPill}>
            <span className={styles.srOnly}>Teams</span>
            {teams.map((team) => team.key).join(', ')}
          </span>
        )}
      </div>

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
      {/* The granularity a date is meant at is chosen in the rail, which has the room to
          explain it; this row keeps whatever the project already claims. */}
      <DatePicker
        open={startDate.open}
        onClose={startDate.hide}
        trigger={startDate.ref}
        value={project.startDate ?? null}
        // The reader's zone rather than a team's: a project belongs to as many teams as it
        // likes, so there is no one team whose Friday this date is.
        timezone={browserTimezone()}
        actionId="projectOverview.closeStartPicker"
        actionGroup="Projects"
        label="Start date"
        clearLabel="No start date"
        onSelect={(startDate) =>
          updateProject(engine, project.id, {
            startDate,
            startDateGranularity: project.startDateGranularity ?? 'day',
          }).catch(report)
        }
      />
      <DatePicker
        open={targetDate.open}
        onClose={targetDate.hide}
        trigger={targetDate.ref}
        value={project.targetDate ?? null}
        timezone={browserTimezone()}
        actionId="projectOverview.closeTargetPicker"
        actionGroup="Projects"
        label="Target date"
        clearLabel="No target date"
        onSelect={(targetDate) =>
          updateProject(engine, project.id, {
            targetDate,
            targetDateGranularity: project.targetDateGranularity ?? 'day',
          }).catch(report)
        }
      />
    </div>
  );
}

/**
 * The project's documents, and the way to write another.
 *
 * Documents are already a project's resources — they carry a `projectId`, the shell routes
 * `/project/:id/documents` inside itself, and the list screen groups by project — but the
 * overview never named them, so the one place a reader looks for "the spec" listed
 * everything about the project except the spec. The add goes through the registered
 * `document.create` action rather than a second dialogue, which is also what seeds the new
 * document with the project you are standing in.
 */
function ResourceRow({ projectId }: { readonly projectId: UUID }) {
  const { registry, context } = useKeymap();
  const documents = useLiveQuery(
    (store) =>
      [...store.documentIdsForProject(projectId)]
        .map((id) => store.get('document', id))
        .filter((found): found is NonNullable<typeof found> => found !== undefined)
        .map((found) => ({ id: found.id, title: found.title })),
    ['document'],
    [projectId],
  );

  return (
    <div className={styles.propertyRow}>
      <span className={styles.rowLabel}>Resources</span>
      <div className={styles.pills}>
        {documents.map((document) => (
          <Link key={document.id} to={`/document/${document.id}`} className={styles.resource}>
            {document.title === '' ? 'Untitled document' : document.title}
          </Link>
        ))}
        <Button
          variant="ghost"
          size="sm"
          icon={<PlusGlyph />}
          className={styles.addResource}
          onClick={() => registry.invoke('document.create', { source: 'menu', context })}
        >
          Add document
        </Button>
      </div>
    </div>
  );
}

interface ProseFieldProps {
  readonly stored: string;
  readonly onSave: (value: string) => void;
}

/** The one-line summary, unboxed, saved on blur when it changed. */
function SummaryField({ stored, onSave }: ProseFieldProps) {
  const [draft, setDraft] = useState(stored);
  return (
    <Input
      surface="plain"
      aria-label="Summary"
      className={styles.summary}
      value={draft}
      placeholder="Add a short summary…"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const summary = draft.trim();
        if (summary !== stored) onSave(summary);
      }}
    />
  );
}
