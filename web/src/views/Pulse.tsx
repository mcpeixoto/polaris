/**
 * Pulse: the workspace feed of project updates.
 *
 * A dense list of status posts already in the replica. Tabs rank the same rows —
 * For me, Popular (comment engagement), Recent, and personal named feeds.
 * Guests do not see it: Pulse is a workspace-level surface.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, EmptyState, Input, Modal } from '~/components';
import { dayKeyOf } from '~/features/inbox/inbox';
import { browserTimezone } from '~/features/locale';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { createPulseFeed, deletePulseFeed, updatePulseFeed } from '~/features/pulse/mutations';
import { feedIdOf, listPulse, listPulseFeeds, type PulseTab } from '~/features/pulse/pulse';
import { when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId, useViewerRole } from '~/hooks/useViewer';
import type { Project, PulseFeed, Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './Pulse.module.css';

export function Pulse() {
  const navigate = useNavigate();
  const viewerRole = useViewerRole();
  const viewerId = useViewerId();
  const timezone = browserTimezone();
  const [tab, setTab] = useState<PulseTab>('for-me');
  const [cursor, setCursor] = useState(0);
  const [editor, setEditor] = useState<'new' | UUID | null>(null);

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
    [],
  );
  const feeds = useLiveQuery(
    (store: Store) => listPulseFeeds(store, viewerId),
    ['pulseFeed'],
    [viewerId],
  );
  const days = useLiveQuery(
    (store: Store) => listPulse(store, viewerId, tab, timezone),
    ['project', 'projectMember', 'projectUpdate', 'pulseFeed', 'issue', 'comment', 'user'],
    [viewerId, tab, timezone],
  );

  const flat = days.flatMap((day) => day.events);
  const active = flat[cursor];
  const editing = editor === 'new' ? null : (feeds.find((feed) => feed.id === editor) ?? null);
  const selectedFeed = (() => {
    const id = feedIdOf(tab);
    return id === null ? null : (feeds.find((feed) => feed.id === id) ?? null);
  })();

  /**
   * Pulse owns the keyboard while it is on screen, and says so with a context.
   *
   * These were registered into `global`, which is what an action with no `when` gets, and
   * `pulse.open` claimed a bare `o` there. `O` is the shell's picker prefix — `o i`, `o p`,
   * `o t` and eight more — and a one-chord binding is a prefix of every one of them, so the
   * registry refused the whole shell keymap the moment this screen mounted: `registerAll`
   * rolled it back, and the command menu, the help overlay and every G and O chord stopped
   * working here.
   *
   * `o` is gone with it rather than merely re-scoped. Even in `list` it would win the race
   * against `o i` — the matcher takes the first exact match and a one-chord binding is exact
   * immediately — so keeping it would trade a crash for eleven navigation chords silently
   * dying on this one screen. `Enter` opens an update, which is what it does everywhere else.
   */
  useKeyContext('list');

  useActions(
    [
      {
        id: 'pulse.up',
        title: 'Previous update',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Pulse',
        run: () => setCursor((current) => Math.max(0, current - 1)),
      },
      {
        id: 'pulse.down',
        title: 'Next update',
        keys: ['j', 'ArrowDown'],
        when: 'list',
        group: 'Pulse',
        run: () => setCursor((current) => Math.min(Math.max(flat.length - 1, 0), current + 1)),
      },
      {
        id: 'pulse.open',
        title: 'Open update',
        keys: ['Enter'],
        when: 'list',
        group: 'Pulse',
        run: () => {
          if (active !== undefined) void navigate(active.href);
        },
      },
    ],
    [cursor, flat.length, active, navigate],
  );

  /**
   * Guests never see Pulse, and the role has to come from the session to say so.
   *
   * This read the profile out of the replica, and a guest's replica holds no `user` rows —
   * the directory is workspace-scoped and guests are not handed it. So `viewer` was
   * permanently null for exactly the person this gate is for, the condition never fired,
   * and a guest was served the whole feed along with a sidebar link to it. The session
   * query answers for everybody.
   */
  if (viewerRole === 'guest') {
    return <Navigate to="/" replace />;
  }

  if (workspace !== null && !workspace.pulseEnabled) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <h1 className={styles.title}>Pulse</h1>
        </header>
        <div className={styles.empty}>
          <EmptyState
            title="Pulse is off"
            description="An admin can turn it back on in Settings → Pulse. Morning inbox summaries stay off while it is."
          />
        </div>
      </div>
    );
  }

  const empty = emptyCopy(tab);
  const selectTab = (next: PulseTab) => {
    setTab(next);
    setCursor(0);
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Pulse</h1>
        {/*
          The add button is a sibling of the tablist, not a member of it.

          It sat inside, so a screen reader counted it as a tab — "tab, five of five" for a
          control that selects nothing and opens a dialog instead — and arrow-key support
          would have had to walk through it. It is also the one control here that should not
          scroll away with the tabs when a workspace has more feeds than the header can hold.
        */}
        <div className={styles.tabs}>
          <div className={styles.tabList} role="tablist" aria-label="Pulse tabs">
            <TabButton current={tab} id="for-me" onSelect={selectTab}>
              For me
            </TabButton>
            <TabButton current={tab} id="popular" onSelect={selectTab}>
              Popular
            </TabButton>
            <TabButton current={tab} id="recent" onSelect={selectTab}>
              Recent
            </TabButton>
            {feeds.map((feed) => (
              <TabButton key={feed.id} current={tab} id={`feed:${feed.id}`} onSelect={selectTab}>
                {feed.name}
              </TabButton>
            ))}
          </div>
          <button
            type="button"
            className={styles.tabAdd}
            onClick={() => setEditor('new')}
            aria-label="New feed"
          >
            + New feed
          </button>
        </div>
        {selectedFeed !== null && (
          <div className={styles.feedActions}>
            <Button onClick={() => setEditor(selectedFeed.id)}>Edit feed</Button>
          </div>
        )}
      </header>

      {flat.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState title={empty.title} description={empty.description} />
        </div>
      ) : (
        <div className={styles.list}>
          {days.map((day) => (
            <section key={day.key}>
              <h2 className={styles.day}>{labelDay(day.key, timezone)}</h2>
              <ul className={styles.rows}>
                {day.events.map((row, offset) => {
                  const index = indexOfDay(days, day.key) + offset;
                  return (
                    <li key={row.id}>
                      <Link
                        to={row.href}
                        className={[styles.row, index === cursor ? styles.active : null]
                          .filter(Boolean)
                          .join(' ')}
                        onFocus={() => setCursor(index)}
                      >
                        <div className={styles.meta}>
                          <ProjectHealthBadge health={row.health} compact />
                          <span className={styles.project}>{row.projectName}</span>
                          <span className={styles.actor}>{row.actor}</span>
                          <time className={styles.when} dateTime={row.at} title={row.at}>
                            {when(row.at)}
                          </time>
                        </div>
                        {row.body !== '' && <p className={styles.body}>{row.body}</p>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editor !== null && viewerId !== null && (editor === 'new' || editing !== null) && (
        <PulseFeedEditor
          feed={editor === 'new' ? null : editing}
          viewerId={viewerId}
          onClose={() => setEditor(null)}
          onCreated={(id) => {
            setEditor(null);
            selectTab(`feed:${id}`);
          }}
          onDeleted={() => {
            setEditor(null);
            selectTab('for-me');
          }}
        />
      )}
    </div>
  );
}

function PulseFeedEditor({
  feed,
  viewerId,
  onClose,
  onCreated,
  onDeleted,
}: {
  feed: PulseFeed | null;
  viewerId: UUID;
  onClose: () => void;
  onCreated: (id: UUID) => void;
  onDeleted: () => void;
}) {
  const engine = useEngine();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(feed?.name ?? '');
  const [selected, setSelected] = useState<ReadonlySet<UUID>>(
    () => new Set(feed?.projectIds ?? []),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const projects = useLiveQuery((store: Store) => liveProjects(store), ['project'], []);

  useKeyContext('modal');

  const toggle = (id: UUID) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setProjectsError(null);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('A feed needs a name');
      nameRef.current?.focus();
      return;
    }
    if (selected.size === 0) {
      setProjectsError('Pick at least one project');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const projectIds = [...selected];
    try {
      if (feed === null) {
        const id = await createPulseFeed(engine, { userId: viewerId, name: trimmed, projectIds });
        onCreated(id);
        return;
      }
      await updatePulseFeed(engine, { id: feed.id, name: trimmed, projectIds });
      onClose();
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not save the feed');
    }
  };

  const remove = async () => {
    if (feed === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await deletePulseFeed(engine, feed.id);
      onDeleted();
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof ApiError ? error.message : 'Could not delete the feed');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={feed === null ? 'New feed' : 'Edit feed'}
      description="A personal subset of project status updates. Only you see it."
      size="md"
      initialFocus={nameRef}
      footer={
        // Three buttons of one weight is three claims about what Enter does. The footer rule
        // is one primary, at most one secondary, and cancel demoted to ghost — so the only
        // bordered control left beside the primary is the destructive one, which is also the
        // one that most needs to look unlike the button next to it.
        <>
          {feed !== null && (
            <Button variant="danger" onClick={() => void remove()} disabled={saving}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            {feed === null ? 'Create feed' : 'Save feed'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          error={nameError ?? undefined}
          placeholder="Shipping"
          maxLength={64}
        />
        <fieldset className={styles.projects}>
          <legend className={styles.projectsLegend}>Projects</legend>
          {projects.length === 0 ? (
            <p className={styles.hint}>Create a project first, then a feed can follow it.</p>
          ) : (
            projects.map((project) => (
              <Checkbox
                key={project.id}
                label={project.name}
                checked={selected.has(project.id)}
                onChange={() => toggle(project.id)}
              />
            ))
          )}
          {projectsError !== null && (
            <p className={styles.error} role="alert">
              {projectsError}
            </p>
          )}
        </fieldset>
        {saveError !== null && (
          <p className={styles.error} role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}

function liveProjects(store: Store): readonly Project[] {
  const out: Project[] = [];
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    out.push(project);
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function emptyCopy(tab: PulseTab): { title: string; description: string } {
  if (tab === 'for-me') {
    return {
      title: 'Nothing for you yet',
      description: 'Project status updates in this workspace will land here as they are posted.',
    };
  }
  if (tab === 'popular') {
    return {
      title: 'Nothing popular yet',
      description:
        'Comments on issues after a status post rank it here. Emoji reactions are later.',
    };
  }
  if (tab === 'recent') {
    return {
      title: 'No updates yet',
      description: 'Project status updates in this workspace will land here as they are posted.',
    };
  }
  return {
    title: 'Nothing in this feed yet',
    description: 'Status updates in the projects this feed follows will land here.',
  };
}

function indexOfDay(
  days: readonly { readonly key: string; readonly events: readonly unknown[] }[],
  key: string,
): number {
  let index = 0;
  for (const day of days) {
    if (day.key === key) return index;
    index += day.events.length;
  }
  return index;
}

function TabButton({
  current,
  id,
  onSelect,
  children,
}: {
  current: PulseTab;
  id: PulseTab;
  onSelect: (tab: PulseTab) => void;
  children: string;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={[styles.tab, selected ? styles.tabActive : null].filter(Boolean).join(' ')}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

function labelDay(key: string, timezone: string): string {
  const today = dayKeyOf(new Date().toISOString(), timezone);
  if (key === today) return 'Today';
  const parsed = Date.parse(`${key}T12:00:00Z`);
  if (Number.isNaN(parsed)) return key;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(parsed);
}
