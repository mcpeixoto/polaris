/**
 * Team settings: the team's name and key, and the statuses its issues move through.
 *
 * Two things here are heavier than they look.
 *
 * The **key** is the prefix in every identifier the team owns. Changing `ENG` to `PLAT`
 * renames sixty thousand issues, and it costs one row: identifiers are derived from the team
 * rather than stored on each issue, so the optimistic patch to the team relabels the whole
 * list on the next frame. That is the payoff for a decision taken in the store, and this
 * screen is where a user finds out about it.
 *
 * The **statuses** are grouped by category and can only be reordered within one, because a
 * status's position is a fractional index that is only comparable against its siblings.
 * Categories themselves are fixed by the product — cycle completion, project progress and the
 * git integrations all branch on them — so a team names and orders statuses inside a
 * category and never invents one.
 *
 * Everything except retiring a status is applied before the server answers. Retiring waits,
 * because the server refuses while issues still sit in the status and that refusal is the
 * useful half of the interaction rather than an exception to it.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  Select,
  StateIcon,
  STATE_LABELS,
} from '~/components';
import { updateTeamArchive } from '~/features/archive/mutations';
import { updateTeamCycles } from '~/features/cycles/mutations';
import { updateTeamTriage } from '~/features/triage/mutations';
import {
  archiveStatus,
  createStatus,
  moveStatus,
  updateStatus,
  updateTeam,
} from '~/features/team/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { CATEGORY_ORDER, type StateCategory, type Store, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './TeamSettings.module.css';

interface StatusView {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly category: StateCategory;
  readonly position: string;
  readonly isDefault: boolean;
}

interface TeamView {
  readonly id: UUID;
  readonly key: string;
  readonly name: string;
  readonly cyclesEnabled: boolean;
  readonly cycleDurationWeeks: number;
  readonly cycleCooldownWeeks: number;
  readonly cycleStartDay: string;
  readonly cycleUpcomingCount: number;
  readonly cycleAutoAddStarted: boolean;
  readonly cycleAutoAddCompleted: boolean;
  readonly triageEnabled: boolean;
  readonly triageRequirePriority: boolean;
  readonly autoCloseDays: number;
  readonly autoArchiveDays: number;
  readonly autoCloseParent: boolean;
  readonly autoCloseChildren: boolean;
  readonly statuses: readonly StatusView[];
}

/**
 * The categories a team may put a status in.
 *
 * `duplicate` is missing on purpose: it is system-managed, assigned when an issue is closed
 * as a duplicate of another, and never chosen by hand. Offering it would let a team create a
 * status the product has no way to explain.
 */
const CATEGORIES: readonly StateCategory[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
];

/**
 * Only a status in one of these can be the one new issues are born in.
 *
 * The server enforces it; the screen agrees rather than offering a button that will be
 * refused. An issue that started life completed has no history worth reading.
 */
const CAN_BE_DEFAULT: readonly StateCategory[] = ['backlog', 'unstarted'];

/**
 * What a new status is coloured until somebody chooses otherwise.
 *
 * A literal, and the one in this whole directory. A status's colour is *data* — it is written
 * to the row, sent over the wire and rendered by every client — so it cannot be a token: a
 * theme is a list of custom properties, and there is no custom property for a value that has
 * to survive being stored in Postgres. The value is the server's own default for a status
 * created without one, so a status added here and a status added through the API are the same
 * grey rather than two greys somebody has to notice.
 */
const DEFAULT_STATUS_COLOR = '#6b7280';

export function TeamSettings() {
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const team = useLiveQuery(
    (store) => readTeam(store, teamKey),
    ['team', 'workflowState'],
    [teamKey],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<StateCategory, StatusView[]>();
    for (const category of CATEGORIES) groups.set(category, []);
    for (const status of team?.statuses ?? []) {
      groups.get(status.category)?.push(status);
    }
    return groups;
  }, [team]);

  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
    });
  };

  if (team === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="No such team"
          description={`Nothing in this workspace has the key ${teamKey}.`}
        />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{team.name}</h1>
        <Badge>{team.key}</Badge>
        <div className={styles.spacer} />
        <Link className={styles.link} to={`/team/${team.key}/cycles`}>
          Cycles
        </Link>
        <Link className={styles.link} to={`/team/${team.key}/triage`}>
          Triage
        </Link>
        <Link className={styles.link} to={`/team/${team.key}/archives`}>
          Archives
        </Link>
        <Link className={styles.link} to={`/team/${team.key}`}>
          Back to issues
        </Link>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <TeamForm team={team} onSave={(fields) => run(updateTeam(engine, team.id, fields))} />

        <CycleCadence team={team} onChange={(cadence) => run(updateTeamCycles(engine, team.id, cadence))} />

        <TriageSettings
          team={team}
          onChange={(patch) => run(updateTeamTriage(engine, team.id, patch))}
        />

        <ArchiveSettings
          team={team}
          onChange={(patch) => run(updateTeamArchive(engine, team.id, patch))}
        />

        <section className={styles.section} aria-labelledby="statuses-heading">
          <h2 className={styles.sectionTitle} id="statuses-heading">
            Workflow statuses
          </h2>
          <p className={styles.sectionHint}>
            Issues move through these. The category decides what a status <em>means</em> to the rest
            of the product; the order inside it is the team&rsquo;s own.
          </p>

          {CATEGORIES.map((category) => {
            const statuses = byCategory.get(category) ?? [];
            if (statuses.length === 0) return null;
            const siblings = statuses.map((status) => status.id);
            return (
              <div key={category} className={styles.category}>
                <h3 className={styles.categoryTitle}>{STATE_LABELS[category]}</h3>
                <ul className={styles.statusList}>
                  {statuses.map((status, index) => (
                    <StatusRow
                      key={status.id}
                      status={status}
                      first={index === 0}
                      last={index === statuses.length - 1}
                      onRename={(name) => run(updateStatus(engine, status.id, { name }))}
                      onRecolor={(color) => run(updateStatus(engine, status.id, { color }))}
                      onMakeDefault={() =>
                        run(updateStatus(engine, status.id, { makeDefault: true }))
                      }
                      onMove={(delta) => run(moveStatus(engine, siblings, status.id, delta))}
                      onArchive={() => run(archiveStatus(engine, status.id))}
                    />
                  ))}
                </ul>
              </div>
            );
          })}

          <AddStatusForm
            onAdd={(name, category, color) =>
              run(createStatus(engine, { teamId: team.id, name, category, color }))
            }
          />
        </section>
      </div>
    </div>
  );
}

/**
 * The team's name and key.
 *
 * Both are drafted and saved together, rather than on blur like the fields on an issue. A
 * key change is a rename of every issue in the team, and a change that large should be the
 * result of pressing a button rather than of tabbing out of a field.
 */
function TeamForm({
  team,
  onSave,
}: {
  team: TeamView;
  onSave: (fields: { name: string; key: string }) => void;
}) {
  const [name, setName] = useState(team.name);
  const [key, setKey] = useState(team.key);

  const dirty = name.trim() !== team.name || key.trim().toUpperCase() !== team.key;

  return (
    <form
      className={styles.section}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave({ name: name.trim(), key: key.trim().toUpperCase() });
      }}
    >
      <h2 className={styles.sectionTitle}>Team</h2>
      <div className={styles.teamFields}>
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Input
          label="Key"
          value={key}
          hint="The prefix in every identifier this team owns."
          maxLength={6}
          className={styles.keyField}
          onChange={(event) => setKey(event.target.value.toUpperCase())}
        />
      </div>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={!dirty}>
          Save team
        </Button>
      </div>
    </form>
  );
}

const START_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * The cadence, not a cycle editor.
 *
 * Enabling mints the current window and the upcoming ones; disabling completes the current
 * and deletes the rest. Duration, cooldown and start day are four compact selects rather
 * than a settings form, because this is a rhythm you set once and then forget.
 */
function CycleCadence({
  team,
  onChange,
}: {
  team: TeamView;
  onChange: (cadence: Parameters<typeof updateTeamCycles>[2]) => void;
}) {
  return (
    <section className={styles.section} aria-labelledby="cycles-heading">
      <h2 className={styles.sectionTitle} id="cycles-heading">
        Cycles
      </h2>
      <p className={styles.sectionHint}>
        Dated windows that repeat. A cooldown is a gap, not a cycle — nothing can be filed
        into it. Unfinished work rolls into the next window on its own.
      </p>

      <Checkbox
        label="Run cycles"
        checked={team.cyclesEnabled}
        onChange={(event) => onChange({ enabled: event.target.checked })}
      />

      {team.cyclesEnabled ? (
        <>
          <div className={styles.cadence}>
            <Select
              label="Duration"
              value={String(team.cycleDurationWeeks)}
              onChange={(event) => onChange({ durationWeeks: Number(event.target.value) })}
            >
              {weeks(1, 8).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 week' : `${n} weeks`}
                </option>
              ))}
            </Select>
            <Select
              label="Cooldown"
              value={String(team.cycleCooldownWeeks)}
              onChange={(event) => onChange({ cooldownWeeks: Number(event.target.value) })}
            >
              {weeks(0, 8).map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'None' : n === 1 ? '1 week' : `${n} weeks`}
                </option>
              ))}
            </Select>
            <Select
              label="Starts on"
              value={team.cycleStartDay}
              onChange={(event) => onChange({ startDay: event.target.value })}
            >
              {START_DAYS.map((day) => (
                <option key={day} value={day}>
                  {day.slice(0, 1).toUpperCase() + day.slice(1)}
                </option>
              ))}
            </Select>
            <Select
              label="Upcoming"
              value={String(team.cycleUpcomingCount)}
              onChange={(event) => onChange({ upcomingCount: Number(event.target.value) })}
            >
              {weeks(1, 15).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className={styles.autoAdd}>
            <Checkbox
              label="Add started issues to the current cycle"
              checked={team.cycleAutoAddStarted}
              onChange={(event) => onChange({ autoAddStarted: event.target.checked })}
            />
            <Checkbox
              label="Add completed issues to the current cycle"
              checked={team.cycleAutoAddCompleted}
              onChange={(event) => onChange({ autoAddCompleted: event.target.checked })}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * The intake queue, not a fake view.
 *
 * Enabling creates the Triage status and the reserved Duplicate status if they are missing.
 * Disabling does not delete them. Require-priority is the only extra switch: leaving the
 * inbox without a number is refused, so `1` opens the priority picker instead.
 */
function TriageSettings({
  team,
  onChange,
}: {
  team: TeamView;
  onChange: (patch: Parameters<typeof updateTeamTriage>[2]) => void;
}) {
  return (
    <section className={styles.section} aria-labelledby="triage-heading">
      <h2 className={styles.sectionTitle} id="triage-heading">
        Triage
      </h2>
      <p className={styles.sectionHint}>
        Unreviewed work from outside the team lands in a Triage status, hidden from ordinary
        views until somebody accepts, declines, merges or snoozes it.
      </p>

      <Checkbox
        label="Run triage"
        checked={team.triageEnabled}
        onChange={(event) => onChange({ enabled: event.target.checked })}
      />

      {team.triageEnabled ? (
        <div className={styles.autoAdd}>
          <Checkbox
            label="Require a priority before an issue can leave triage"
            checked={team.triageRequirePriority}
            onChange={(event) => onChange({ requirePriority: event.target.checked })}
          />
        </div>
      ) : null}
    </section>
  );
}

const CLOSE_PERIODS = [0, 30, 60, 90, 180] as const;
const ARCHIVE_PERIODS = [0, 30, 60, 90, 180, 365] as const;

function ArchiveSettings({
  team,
  onChange,
}: {
  team: TeamView;
  onChange: (patch: Parameters<typeof updateTeamArchive>[2]) => void;
}) {
  return (
    <section className={styles.section} aria-labelledby="archive-heading">
      <h2 className={styles.sectionTitle} id="archive-heading">
        Auto-close and archive
      </h2>
      <p className={styles.sectionHint}>
        Untouched issues close on their own, then archive after they have stayed closed.
        A parent, open sub-issues, or an unfinished project will block archival — that is
        what keeps a project&rsquo;s graph intact.
      </p>

      <div className={styles.cadence}>
        <Select
          label="Auto-close after"
          value={String(team.autoCloseDays)}
          onChange={(event) => onChange({ autoCloseDays: Number(event.target.value) })}
        >
          {CLOSE_PERIODS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Never' : `${n} days`}
            </option>
          ))}
        </Select>
        <Select
          label="Auto-archive after"
          value={String(team.autoArchiveDays)}
          onChange={(event) => onChange({ autoArchiveDays: Number(event.target.value) })}
        >
          {ARCHIVE_PERIODS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Never' : n === 365 ? '1 year' : `${n} days`}
            </option>
          ))}
        </Select>
      </div>

      <div className={styles.autoAdd}>
        <Checkbox
          label="Close the parent when every sub-issue is done"
          checked={team.autoCloseParent}
          onChange={(event) => onChange({ autoCloseParent: event.target.checked })}
        />
        <Checkbox
          label="Close remaining sub-issues when the parent is done"
          checked={team.autoCloseChildren}
          onChange={(event) => onChange({ autoCloseChildren: event.target.checked })}
        />
      </div>
    </section>
  );
}

function weeks(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

interface StatusRowProps {
  status: StatusView;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onMakeDefault: () => void;
  onMove: (delta: 1 | -1) => void;
  onArchive: () => void;
}

/**
 * One status.
 *
 * The row is a group named by the status, so its two unlabelled fields can be called "Name"
 * and "Colour" without every row in the list announcing the same two words. The draft exists
 * only while the field has focus, which is what lets a rename made in another session appear
 * here immediately without overwriting what somebody is typing.
 */
function StatusRow({
  status,
  first,
  last,
  onRename,
  onRecolor,
  onMakeDefault,
  onMove,
  onArchive,
}: StatusRowProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <li className={styles.status} role="group" aria-label={`${status.name} status`}>
      <StateIcon category={status.category} color={status.color} decorative />

      <Input
        label="Name"
        hideLabel
        className={styles.statusName}
        value={draft ?? status.name}
        onFocus={() => setDraft(status.name)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft?.trim();
          setDraft(null);
          if (next !== undefined && next !== '' && next !== status.name) onRename(next);
        }}
      />

      <Input
        label="Colour"
        hideLabel
        type="color"
        className={styles.statusColor}
        value={status.color}
        onChange={(event) => onRecolor(event.target.value)}
      />

      {status.isDefault ? (
        <Badge tone="accent">Default</Badge>
      ) : CAN_BE_DEFAULT.includes(status.category) ? (
        <Button size="sm" onClick={onMakeDefault}>
          Make default
        </Button>
      ) : (
        <span className={styles.defaultSpacer} />
      )}

      <IconButton
        aria-label={`Move ${status.name} up`}
        size="sm"
        disabled={first}
        onClick={() => onMove(-1)}
        icon={<Chevron up />}
      />
      <IconButton
        aria-label={`Move ${status.name} down`}
        size="sm"
        disabled={last}
        onClick={() => onMove(1)}
        icon={<Chevron />}
      />
      <IconButton
        aria-label={`Retire ${status.name}`}
        tooltip="Retire this status"
        size="sm"
        variant="danger"
        onClick={onArchive}
        icon={
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M3.5 5h9m-7 0V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m-6.5 0 .6 7a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-7"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        }
      />
    </li>
  );
}

/** Adds a status. One form for every category rather than one per section, which would be six. */
function AddStatusForm({
  onAdd,
}: {
  onAdd: (name: string, category: StateCategory, color: string) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StateCategory>('unstarted');
  const [color, setColor] = useState(DEFAULT_STATUS_COLOR);

  return (
    <form
      className={styles.addStatus}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === '') return;
        onAdd(trimmed, category, color);
        setName('');
      }}
    >
      <Input
        label="New status"
        placeholder="Needs QA"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Select
        label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value as StateCategory)}
      >
        {CATEGORIES.map((option) => (
          <option key={option} value={option}>
            {STATE_LABELS[option]}
          </option>
        ))}
      </Select>
      <Input
        label="Colour"
        type="color"
        className={styles.statusColor}
        value={color}
        onChange={(event) => setColor(event.target.value)}
      />
      <Button type="submit" disabled={name.trim() === ''}>
        Add status
      </Button>
    </form>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={up ? { transform: 'rotate(180deg)' } : undefined}>
      <path
        d="m4.5 6.5 3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The team and its statuses, ordered the way the product orders them: category first, then
 * the team's own fractional position inside it. Positions are only comparable within a
 * category, so comparing them across one would interleave "In Progress" with "Backlog".
 */
function readTeam(store: Store, teamKey: string): TeamView | null {
  const team = [...store.teams.values()].find((candidate) => candidate.key === teamKey);
  if (team === undefined) return null;

  const statuses: StatusView[] = [];
  for (const id of store.workflowStateIdsFor(team.id)) {
    const state = store.get('workflowState', id);
    if (state === undefined || state.archivedAt !== undefined || state.isSystem) continue;
    statuses.push({
      id: state.id,
      name: state.name,
      color: state.color,
      category: state.category,
      position: state.position,
      isDefault: state.isDefault,
    });
  }
  statuses.sort((a, b) => {
    const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (byCategory !== 0) return byCategory;
    return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  });

  return {
    id: team.id,
    key: team.key,
    name: team.name,
    cyclesEnabled: team.cyclesEnabled,
    cycleDurationWeeks: team.cycleDurationWeeks,
    cycleCooldownWeeks: team.cycleCooldownWeeks,
    cycleStartDay: team.cycleStartDay,
    cycleUpcomingCount: team.cycleUpcomingCount,
    cycleAutoAddStarted: team.cycleAutoAddStarted,
    cycleAutoAddCompleted: team.cycleAutoAddCompleted,
    triageEnabled: team.triageEnabled,
    triageRequirePriority: team.triageRequirePriority,
    autoCloseDays: team.autoCloseDays,
    autoArchiveDays: team.autoArchiveDays,
    autoCloseParent: team.autoCloseParent,
    autoCloseChildren: team.autoCloseChildren,
    statuses,
  };
}
