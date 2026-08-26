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

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

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
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { featureBlock, useEntitlements } from '~/features/admin/entitlements';
import { PlanBlock } from '~/features/admin/PlanBlock';
import { updateTeamArchive } from '~/features/archive/mutations';
import { inheritsCycleSchedule } from '~/features/cycles/inherit';
import { updateTeamCycles } from '~/features/cycles/mutations';
import {
  deleteGitHubTeamAutomation,
  loadGitHubTeamAutomation,
  updateGitHubTeamAutomation,
} from '~/features/github/mutations';
import {
  deleteGitLabTeamAutomation,
  loadGitLabTeamAutomation,
  updateGitLabTeamAutomation,
} from '~/features/gitlab/mutations';
import { updateTeamTriage } from '~/features/triage/mutations';
import { updateTeamEmailIntake } from '~/features/email/mutations';
import {
  archiveRecurringIssue,
  CADENCE_LABELS,
  createRecurringIssue,
  updateTeamTemplates,
} from '~/features/recurring/mutations';
import { RecurringFields } from '~/features/recurring/RecurringFields';
import { today } from '~/features/time';
import { listTimezones } from '~/features/locale';
import {
  archiveStatus,
  createStatus,
  moveStatus,
  updateStatus,
  updateTeam,
} from '~/features/team/mutations';
import { deleteTeam, retireTeam, unretireTeam } from '~/features/team-lifecycle/mutations';
import { moveTeam } from '~/features/team-lifecycle/move';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import {
  CATEGORY_ORDER,
  type RecurringCadence,
  type StateCategory,
  type Store,
  type UUID,
} from '~/store';
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

interface TemplateChoice {
  readonly id: UUID;
  readonly name: string;
  readonly workspace: boolean;
}

interface RecurringRow {
  readonly id: UUID;
  readonly title: string;
  readonly cadence: RecurringCadence;
  readonly nextDueDate: string;
}

interface TeamView {
  readonly id: UUID;
  readonly key: string;
  readonly name: string;
  readonly private: boolean;
  readonly retiredAt?: string;
  readonly parentTeamId?: UUID;
  readonly timezone: string;
  readonly cyclesEnabled: boolean;
  readonly cycleDurationWeeks: number;
  readonly cycleCooldownWeeks: number;
  readonly cycleStartDay: string;
  readonly cycleUpcomingCount: number;
  readonly cycleAutoAddStarted: boolean;
  readonly cycleAutoAddCompleted: boolean;
  readonly triageEnabled: boolean;
  readonly triageRequirePriority: boolean;
  readonly emailIntakeEnabled: boolean;
  readonly emailIntakeAddress?: string;
  readonly autoCloseDays: number;
  readonly autoArchiveDays: number;
  readonly autoCloseParent: boolean;
  readonly autoCloseChildren: boolean;
  readonly defaultTemplateForMembersId?: UUID;
  readonly defaultTemplateForNonMembersId?: UUID;
  readonly templates: readonly TemplateChoice[];
  readonly recurring: readonly RecurringRow[];
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
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const team = useLiveQuery(
    (store) => readTeam(store, teamKey),
    ['team', 'workflowState', 'issueTemplate', 'recurringIssue'],
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

  const run = (work: Promise<unknown>, onSuccess?: () => void, onFailure?: () => void) => {
    setError(null);
    work
      .then(() => onSuccess?.())
      .catch((failure: unknown) => {
        onFailure?.();
        setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      });
  };

  const readOnly = team?.retiredAt !== undefined;

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

        {readOnly ? (
          <p className={styles.sectionHint} role="status">
            This team is retired. Its issues and settings are read-only until you restore it.
          </p>
        ) : null}

        <fieldset className={styles.fieldset} disabled={readOnly}>
          <TeamForm
            team={team}
            onSave={(fields) => {
              /*
               * The route is keyed by the team's key, so a key change moves this screen.
               *
               * `updateTeam` patches the team optimistically, which means `readTeam` stops
               * matching the key in the path on the very next frame: a save that worked
               * replaced itself with "No such team. Nothing in this workspace has the key
               * ENG." on a URL that stayed broken across a reload. The redirect therefore
               * has to happen with the optimistic patch rather than after the server
               * answers, and be walked back if the server refuses — which it does whenever
               * the new key is already another team's.
               */
              const from = team.key;
              const moving = fields.key !== '' && fields.key !== from;
              if (moving) void navigate(`/team/${fields.key}/settings`, { replace: true });
              run(updateTeam(engine, team.id, fields), undefined, () => {
                if (moving) void navigate(`/team/${from}/settings`, { replace: true });
              });
            }}
          />

          <VisibilitySettings
            team={team}
            onChange={(isPrivate) => run(updateTeam(engine, team.id, { private: isPrivate }))}
          />

          <CycleCadence
            team={team}
            onChange={(cadence) => run(updateTeamCycles(engine, team.id, cadence))}
          />

          <TriageSettings
            team={team}
            onChange={(patch) => run(updateTeamTriage(engine, team.id, patch))}
          />

          <EmailIntakeSettings
            team={team}
            onChange={(enabled) => run(updateTeamEmailIntake(engine, team.id, enabled))}
          />

          <ArchiveSettings
            team={team}
            onChange={(patch) => run(updateTeamArchive(engine, team.id, patch))}
          />

          <GitHubTeamAutomations teamId={team.id} statuses={team.statuses} onError={setError} />
          <GitLabTeamAutomations teamId={team.id} statuses={team.statuses} onError={setError} />

          <DefaultTemplates
            team={team}
            onChange={(patch) => run(updateTeamTemplates(engine, team.id, patch))}
          />

          <RecurringIssues
            team={team}
            onCreate={(input) =>
              run(
                createRecurringIssue(engine, {
                  teamId: team.id,
                  title: input.title,
                  cadence: input.cadence,
                  firstDueDate: input.firstDueDate,
                }),
              )
            }
            onArchive={(id) => run(archiveRecurringIssue(engine, id))}
          />

          <section className={styles.section} aria-labelledby="statuses-heading">
            <h2 className={styles.sectionTitle} id="statuses-heading">
              Workflow statuses
            </h2>
            <p className={styles.sectionHint}>
              Issues move through these. The category decides what a status <em>means</em> to the
              rest of the product; the order inside it is the team&rsquo;s own.
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
        </fieldset>

        <ParentTeamSettings
          team={team}
          readOnly={readOnly}
          onMove={(parentTeamId) => run(moveTeam(engine, team.id, parentTeamId))}
        />

        <DangerZone
          team={team}
          onRetire={() => run(retireTeam(engine, team.id))}
          onUnretire={() => run(unretireTeam(engine, team.id))}
          onDelete={() => {
            run(deleteTeam(engine, team.id), () => {
              void navigate('/');
            });
          }}
        />
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
  onSave: (fields: { name: string; key: string; timezone: string }) => void;
}) {
  const [name, setName] = useState(team.name);
  const [key, setKey] = useState(team.key);
  const [timezone, setTimezone] = useState(team.timezone);

  const dirty =
    name.trim() !== team.name ||
    key.trim().toUpperCase() !== team.key ||
    timezone !== team.timezone;

  const zones = listTimezones().includes(team.timezone)
    ? listTimezones()
    : [team.timezone, ...listTimezones()];

  return (
    <form
      className={styles.section}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave({ name: name.trim(), key: key.trim().toUpperCase(), timezone });
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
        <Select
          label="Timezone"
          hint="Due dates and cycle start are midnight in this zone."
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </div>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={!dirty}>
          Save team
        </Button>
      </div>
    </form>
  );
}

/**
 * Who may see this team's work.
 *
 * Making a team private is immediate and irreversible in effect: non-members lose their
 * local copy on the next sync, external assignees are cleared, and watchers outside the team
 * are unsubscribed. The checkbox waits for confirmation before calling that in.
 */
function VisibilitySettings({
  team,
  onChange,
}: {
  team: TeamView;
  onChange: (isPrivate: boolean) => void;
}) {
  const entitlements = useEntitlements();
  const block = featureBlock(entitlements, 'privateTeams');
  const [confirmPrivate, setConfirmPrivate] = useState(false);

  const onToggle = (checked: boolean) => {
    if (checked && !team.private) {
      setConfirmPrivate(true);
      return;
    }
    onChange(checked);
  };

  return (
    <>
      <section className={styles.section} aria-labelledby="visibility-heading">
        <h2 className={styles.sectionTitle} id="visibility-heading">
          Visibility
        </h2>
        <p className={styles.sectionHint}>
          Private teams are visible only to their members. Workspace members who are not on the team
          cannot see its issues, be assigned to them, or stay subscribed.
        </p>
        <Checkbox
          label="Private team"
          checked={team.private}
          disabled={block !== null}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <PlanBlock block={block} className={styles.sectionHint} />
      </section>

      <ConfirmDialog
        open={confirmPrivate}
        title="Make this team private?"
        consequence="Non-members will lose access to this team's issues on their devices. Assignments to people outside the team will be cleared and their subscriptions removed."
        confirmLabel="Make private"
        destructive
        onClose={() => setConfirmPrivate(false)}
        onConfirm={() => {
          setConfirmPrivate(false);
          onChange(true);
        }}
      />
    </>
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
  const parent = useLiveQuery(
    (store) => (team.parentTeamId === undefined ? null : store.get('team', team.parentTeamId)),
    ['team'],
    [team.parentTeamId],
  );
  const inherited = inheritsCycleSchedule(team, parent);
  const inheritedFrom = inherited && parent != null ? parent : null;

  return (
    <section className={styles.section} aria-labelledby="cycles-heading">
      <h2 className={styles.sectionTitle} id="cycles-heading">
        Cycles
      </h2>
      {inheritedFrom !== null ? (
        <p className={styles.sectionHint}>
          This sub-team inherits {inheritedFrom.name}&rsquo;s cycle schedule and cannot set its own.{' '}
          <Link className={styles.link} to={`/team/${inheritedFrom.key}/settings`}>
            Open {inheritedFrom.key} settings
          </Link>
        </p>
      ) : (
        <p className={styles.sectionHint}>
          Dated windows that repeat. A cooldown is a gap, not a cycle — nothing can be filed into
          it. Unfinished work rolls into the next window on its own.
        </p>
      )}

      <fieldset className={styles.fieldset} disabled={inherited}>
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
      </fieldset>
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
        Unreviewed work from outside the team lands in a Triage status, hidden from ordinary views
        until somebody accepts, declines, merges or snoozes it.
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

/**
 * Create issues by email. The address is minted on the server; this screen copies it.
 */
function EmailIntakeSettings({
  team,
  onChange,
}: {
  team: TeamView;
  onChange: (enabled: boolean) => void;
}) {
  const copyAddress = () => {
    if (team.emailIntakeAddress === undefined) return;
    void navigator.clipboard?.writeText(team.emailIntakeAddress);
  };
  return (
    <section className={styles.section} aria-labelledby="email-intake-heading">
      <h2 className={styles.sectionTitle} id="email-intake-heading">
        Create issues by email
      </h2>
      <p className={styles.sectionHint}>
        Mail sent to this team&rsquo;s address becomes an issue. Replies do not create a second one.
        In development, POST JSON to <code>/webhooks/email</code> — no mail server required.
      </p>

      <Checkbox
        label="Create issues by email"
        checked={team.emailIntakeEnabled}
        onChange={(event) => onChange(event.target.checked)}
      />

      {team.emailIntakeEnabled && team.emailIntakeAddress !== undefined ? (
        <div className={styles.cadence}>
          <Input
            label="Intake address"
            value={team.emailIntakeAddress}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button size="sm" onClick={copyAddress}>
            Copy address
          </Button>
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
        Untouched issues close on their own, then archive after they have stayed closed. A parent,
        open sub-issues, or an unfinished project will block archival — that is what keeps a
        project&rsquo;s graph intact.
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

const NONE = '';

interface MappingValues {
  draftedStateId: string;
  openedStateId: string;
  reviewRequestedStateId: string;
  readyForMergeStateId: string;
  mergedStateId: string;
}

function firstOf(statuses: readonly StatusView[], category: StateCategory): string {
  return statuses.find((status) => status.category === category)?.id ?? NONE;
}

function mappingValuesFrom(
  auto: {
    configured: boolean;
    draftedStateId: string | null;
    openedStateId: string | null;
    reviewRequestedStateId: string | null;
    readyForMergeStateId: string | null;
    mergedStateId: string | null;
  },
  statuses: readonly StatusView[],
): MappingValues {
  if (!auto.configured) {
    return {
      draftedStateId: NONE,
      openedStateId: firstOf(statuses, 'started'),
      reviewRequestedStateId: NONE,
      readyForMergeStateId: NONE,
      mergedStateId: firstOf(statuses, 'completed'),
    };
  }
  return {
    draftedStateId: auto.draftedStateId ?? NONE,
    openedStateId: auto.openedStateId ?? NONE,
    reviewRequestedStateId: auto.reviewRequestedStateId ?? NONE,
    readyForMergeStateId: auto.readyForMergeStateId ?? NONE,
    mergedStateId: auto.mergedStateId ?? NONE,
  };
}

function asMappingId(value: string): string | null {
  return value === NONE ? null : value;
}

function GitHubTeamAutomations({
  teamId,
  statuses,
  onError,
}: {
  teamId: UUID;
  statuses: readonly StatusView[];
  onError: (message: string | null) => void;
}) {
  const [values, setValues] = useState<MappingValues | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadGitHubTeamAutomation(teamId)
      .then((auto) => {
        if (!live) return;
        setConfigured(auto.configured);
        setValues(mappingValuesFrom(auto, statuses));
      })
      .catch((failure: unknown) => {
        if (!live) return;
        onError(
          failure instanceof ApiError ? failure.message : 'GitHub automations could not be loaded.',
        );
      });
    return () => {
      live = false;
    };
    // statuses are the team's live workflow; the first paint already has them, and a later
    // rename must not refetch and clobber a select the user is holding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const save = (next: MappingValues) => {
    setValues(next);
    setBusy(true);
    onError(null);
    updateGitHubTeamAutomation(teamId, {
      draftedStateId: asMappingId(next.draftedStateId),
      openedStateId: asMappingId(next.openedStateId),
      reviewRequestedStateId: asMappingId(next.reviewRequestedStateId),
      readyForMergeStateId: asMappingId(next.readyForMergeStateId),
      mergedStateId: asMappingId(next.mergedStateId),
    })
      .then((auto) => {
        setConfigured(auto.configured);
        setValues(mappingValuesFrom(auto, statuses));
      })
      .catch((failure: unknown) => {
        onError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      })
      .finally(() => setBusy(false));
  };

  const restore = () => {
    setBusy(true);
    onError(null);
    deleteGitHubTeamAutomation(teamId)
      .then((auto) => {
        setConfigured(auto.configured);
        setValues(mappingValuesFrom(auto, statuses));
      })
      .catch((failure: unknown) => {
        onError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      })
      .finally(() => setBusy(false));
  };

  if (values === null) {
    return null;
  }

  const live = statuses.filter((status) => status.category !== 'duplicate');
  const patch = (key: keyof MappingValues, value: string) => save({ ...values, [key]: value });

  return (
    <section className={styles.section} aria-labelledby="github-automations-heading">
      <h2 className={styles.sectionTitle} id="github-automations-heading">
        GitHub status automations
      </h2>
      <p className={styles.sectionHint}>
        When a linked pull request changes, move the issue to a status. Unconfigured teams start an
        issue when a PR opens and complete it when every closing PR has merged. Choosing No action
        for an event leaves the issue where it is.
      </p>

      <div className={styles.cadence}>
        <GitHubMappingSelect
          label="PR drafted"
          value={values.draftedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('draftedStateId', value)}
        />
        <GitHubMappingSelect
          label="PR opened"
          value={values.openedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('openedStateId', value)}
        />
        <GitHubMappingSelect
          label="Review requested"
          value={values.reviewRequestedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('reviewRequestedStateId', value)}
        />
        <GitHubMappingSelect
          label="Ready to merge"
          value={values.readyForMergeStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('readyForMergeStateId', value)}
        />
        <GitHubMappingSelect
          label="PR merged"
          value={values.mergedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('mergedStateId', value)}
        />
      </div>

      {configured ? (
        <div className={styles.formActions}>
          <Button variant="secondary" disabled={busy} onClick={restore}>
            Restore defaults
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function GitLabTeamAutomations({
  teamId,
  statuses,
  onError,
}: {
  teamId: UUID;
  statuses: readonly StatusView[];
  onError: (message: string | null) => void;
}) {
  const [values, setValues] = useState<MappingValues | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadGitLabTeamAutomation(teamId)
      .then((auto) => {
        if (!live) return;
        setConfigured(auto.configured);
        setValues(mappingValuesFrom(auto, statuses));
      })
      .catch((failure: unknown) => {
        if (!live) return;
        onError(
          failure instanceof ApiError ? failure.message : 'GitLab automations could not be loaded.',
        );
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const save = (next: MappingValues) => {
    setValues(next);
    setBusy(true);
    onError(null);
    updateGitLabTeamAutomation(teamId, {
      draftedStateId: asMappingId(next.draftedStateId),
      openedStateId: asMappingId(next.openedStateId),
      reviewRequestedStateId: asMappingId(next.reviewRequestedStateId),
      readyForMergeStateId: asMappingId(next.readyForMergeStateId),
      mergedStateId: asMappingId(next.mergedStateId),
    })
      .then((auto) => {
        setConfigured(auto.configured);
        setValues(mappingValuesFrom(auto, statuses));
      })
      .catch((failure: unknown) => {
        onError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      })
      .finally(() => setBusy(false));
  };

  const restore = () => {
    setBusy(true);
    onError(null);
    deleteGitLabTeamAutomation(teamId)
      .then((auto) => {
        setConfigured(auto.configured);
        setValues(mappingValuesFrom(auto, statuses));
      })
      .catch((failure: unknown) => {
        onError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      })
      .finally(() => setBusy(false));
  };

  if (values === null) {
    return null;
  }

  const live = statuses.filter((status) => status.category !== 'duplicate');
  const patch = (key: keyof MappingValues, value: string) => save({ ...values, [key]: value });

  return (
    <section className={styles.section} aria-labelledby="gitlab-automations-heading">
      <h2 className={styles.sectionTitle} id="gitlab-automations-heading">
        GitLab status automations
      </h2>
      <p className={styles.sectionHint}>
        When a linked merge request changes, move the issue to a status. Unconfigured teams start an
        issue when an MR opens and complete it when every closing MR has merged. Choosing No action
        for an event leaves the issue where it is.
      </p>

      <div className={styles.cadence}>
        <GitHubMappingSelect
          label="MR drafted"
          value={values.draftedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('draftedStateId', value)}
        />
        <GitHubMappingSelect
          label="MR opened"
          value={values.openedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('openedStateId', value)}
        />
        <GitHubMappingSelect
          label="Review requested"
          value={values.reviewRequestedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('reviewRequestedStateId', value)}
        />
        <GitHubMappingSelect
          label="Ready to merge"
          value={values.readyForMergeStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('readyForMergeStateId', value)}
        />
        <GitHubMappingSelect
          label="MR merged"
          value={values.mergedStateId}
          statuses={live}
          disabled={busy}
          onChange={(value) => patch('mergedStateId', value)}
        />
      </div>

      {configured ? (
        <div className={styles.formActions}>
          <Button variant="secondary" disabled={busy} onClick={restore}>
            Restore defaults
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function GitHubMappingSelect({
  label,
  value,
  statuses,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  statuses: readonly StatusView[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={NONE}>No action</option>
      {statuses.map((status) => (
        <option key={status.id} value={status.id}>
          {status.name}
        </option>
      ))}
    </Select>
  );
}

function weeks(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

function DefaultTemplates({
  team,
  onChange,
}: {
  team: TeamView;
  onChange: (patch: Parameters<typeof updateTeamTemplates>[2]) => void;
}) {
  return (
    <section className={styles.section} aria-labelledby="defaults-heading">
      <h2 className={styles.sectionTitle} id="defaults-heading">
        Default templates
      </h2>
      <p className={styles.sectionHint}>
        Applied when a new issue is filed without a template. Members and everyone else get a
        different starting point, because a bug report the team files every day is not the form an
        outsider should land in.
      </p>

      <div className={styles.cadence}>
        <Select
          label="For members"
          value={team.defaultTemplateForMembersId ?? ''}
          onChange={(event) =>
            onChange({
              defaultTemplateForMembersId: event.target.value === '' ? null : event.target.value,
            })
          }
        >
          <option value="">None</option>
          {team.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.workspace ? `${template.name} · Workspace` : template.name}
            </option>
          ))}
        </Select>
        <Select
          label="For everyone else"
          value={team.defaultTemplateForNonMembersId ?? ''}
          onChange={(event) =>
            onChange({
              defaultTemplateForNonMembersId: event.target.value === '' ? null : event.target.value,
            })
          }
        >
          <option value="">None</option>
          {team.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.workspace ? `${template.name} · Workspace` : template.name}
            </option>
          ))}
        </Select>
      </div>
    </section>
  );
}

function RecurringIssues({
  team,
  onCreate,
  onArchive,
}: {
  team: TeamView;
  onCreate: (input: { title: string; cadence: RecurringCadence; firstDueDate: string }) => void;
  onArchive: (id: UUID) => void;
}) {
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<RecurringCadence>('weekly');
  const [firstDueDate, setFirstDueDate] = useState(today(team.timezone));

  return (
    <section className={styles.section} aria-labelledby="recurring-heading">
      <h2 className={styles.sectionTitle} id="recurring-heading">
        Recurring issues
      </h2>
      <p className={styles.sectionHint}>
        A snapshot plus a cadence. The next occurrence is filed after the current due date passes,
        at 00:01 in this team&rsquo;s timezone — not when the current issue is completed, and not by
        re-reading a template.
      </p>

      {team.recurring.length === 0 ? (
        <p className={styles.sectionHint}>No schedules yet.</p>
      ) : (
        <ul className={styles.recurringList}>
          {team.recurring.map((row) => (
            <li key={row.id} className={styles.recurringRow}>
              <div className={styles.recurringText}>
                <span className={styles.recurringTitle}>{row.title}</span>
                <span className={styles.recurringMeta}>
                  {CADENCE_LABELS[row.cadence]} · next {row.nextDueDate}
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => onArchive(row.id)}
                aria-label={`Archive ${row.title}`}
              >
                Archive
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className={styles.addRecurring}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const trimmed = title.trim();
          if (trimmed === '' || firstDueDate === '') return;
          onCreate({ title: trimmed, cadence, firstDueDate });
          setTitle('');
        }}
      >
        <Input
          label="New schedule"
          placeholder="Weekly status"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <RecurringFields
          cadence={cadence}
          firstDueDate={firstDueDate}
          onCadence={setCadence}
          onFirstDueDate={setFirstDueDate}
        />
        <Button type="submit" disabled={title.trim() === '' || firstDueDate === ''}>
          Add schedule
        </Button>
      </form>
    </section>
  );
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
 * Nest this team under a parent, or make it top-level again.
 *
 * Sits outside the fieldset the rest of the screen is disabled by, because it is next to the
 * danger zone rather than inside the settings form — which is why `readOnly` has to be
 * threaded in by hand. Without it a retired team offered a live "Move under" and a live
 * "Save parent" three inches under a banner saying its settings are read-only, and the
 * refusal only arrived from the server, as the sentence the server tells itself.
 */
function ParentTeamSettings({
  team,
  readOnly,
  onMove,
}: {
  team: TeamView;
  readOnly: boolean;
  onMove: (parentTeamId: UUID | null) => void;
}) {
  const candidates = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter(
          (candidate) =>
            candidate.id !== team.id &&
            candidate.parentTeamId === undefined &&
            candidate.retiredAt === undefined,
        )
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
    [team.id],
  );

  const parent = useLiveQuery(
    (store) => (team.parentTeamId === undefined ? null : store.get('team', team.parentTeamId)),
    ['team'],
    [team.parentTeamId],
  );

  const subTeams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((candidate) => candidate.parentTeamId === team.id)
        .sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
    [team.id],
  );

  const [parentId, setParentId] = useState(team.parentTeamId ?? '');
  const entitlements = useEntitlements();
  const block = featureBlock(entitlements, 'subTeams');

  return (
    <section className={styles.section} aria-labelledby="parent-heading">
      <h2 className={styles.sectionTitle} id="parent-heading">
        Parent team
      </h2>
      <p className={styles.sectionHint}>
        Sub-teams inherit private visibility from a private parent. Parent team owners are added as
        owners here automatically.
      </p>

      {parent === null && team.parentTeamId !== undefined ? (
        <p className={styles.sectionHint}>Parent team is no longer in your replica.</p>
      ) : parent !== null && parent !== undefined ? (
        <p className={styles.sectionHint}>
          Nested under <strong>{parent.name}</strong> ({parent.key}).
        </p>
      ) : (
        <p className={styles.sectionHint}>This is a top-level team.</p>
      )}

      {readOnly ? (
        <p className={styles.sectionHint} role="status">
          A retired team cannot be moved. Restore it first.
        </p>
      ) : null}

      <div className={styles.parentFields}>
        <Select
          label="Move under"
          value={parentId}
          disabled={readOnly || block !== null}
          onChange={(event) => setParentId(event.target.value)}
        >
          <option value="">Top level (no parent)</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.key} — {candidate.name}
            </option>
          ))}
        </Select>
        <Button
          onClick={() => onMove(parentId === '' ? null : (parentId as UUID))}
          disabled={readOnly || block !== null || parentId === (team.parentTeamId ?? '')}
          title={block?.reason}
        >
          Save parent
        </Button>
      </div>
      <PlanBlock block={block} className={styles.sectionHint} />

      {subTeams.length > 0 ? (
        <ul className={styles.subTeamList}>
          {subTeams.map((child) => (
            <li key={child.id}>
              <Link to={`/team/${child.key}/settings`}>
                {child.key} — {child.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Retire, restore, or delete the team. Lifecycle actions stay outside the read-only
 * fieldset because unretire and delete must remain reachable on a retired team.
 */
function DangerZone({
  team,
  onRetire,
  onUnretire,
  onDelete,
}: {
  team: TeamView;
  onRetire: () => void;
  onUnretire: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const retired = team.retiredAt !== undefined;

  return (
    <section className={styles.section} aria-labelledby="danger-heading">
      <h2 className={styles.sectionTitle} id="danger-heading">
        Danger zone
      </h2>
      <p className={styles.sectionHint}>
        Retiring freezes the team and hides it from the sidebar. Deleting removes the team and its
        issues; both can be undone — retired teams any time, deleted teams for thirty days from{' '}
        <Link to="/settings/deleted-teams">Recently deleted teams</Link>.
      </p>

      <div className={styles.dangerActions}>
        {retired ? (
          <Button onClick={onUnretire}>Restore team</Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirmRetire(true)}>
            Retire team
          </Button>
        )}
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete team
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRetire}
        title={`Retire ${team.name}?`}
        consequence="The team becomes read-only and disappears from the sidebar. Issues stay searchable. You can restore the team any time from here."
        confirmLabel="Retire team"
        destructive
        onConfirm={() => {
          setConfirmRetire(false);
          onRetire();
        }}
        onClose={() => setConfirmRetire(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${team.name}?`}
        consequence="The team and every issue in it move to Recently deleted teams for thirty days. Export or move issues first if you need them elsewhere."
        confirmLabel="Delete team"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </section>
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

  const templates: TemplateChoice[] = [...store.issueTemplates.values()]
    .filter(
      (template) =>
        template.archivedAt === undefined &&
        (template.teamId === undefined || template.teamId === team.id),
    )
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((template) => ({
      id: template.id,
      name: template.name,
      workspace: template.teamId === undefined,
    }));

  const recurring: RecurringRow[] = [];
  for (const id of store.recurringIssueIdsFor(team.id)) {
    const row = store.get('recurringIssue', id);
    if (row === undefined || row.archivedAt !== undefined) continue;
    recurring.push({
      id: row.id,
      title: row.title,
      cadence: row.cadence,
      nextDueDate: row.nextDueDate,
    });
  }
  recurring.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  return {
    id: team.id,
    key: team.key,
    name: team.name,
    private: team.private,
    retiredAt: team.retiredAt,
    parentTeamId: team.parentTeamId,
    cyclesEnabled: team.cyclesEnabled,
    cycleDurationWeeks: team.cycleDurationWeeks,
    cycleCooldownWeeks: team.cycleCooldownWeeks,
    cycleStartDay: team.cycleStartDay,
    cycleUpcomingCount: team.cycleUpcomingCount,
    cycleAutoAddStarted: team.cycleAutoAddStarted,
    cycleAutoAddCompleted: team.cycleAutoAddCompleted,
    triageEnabled: team.triageEnabled,
    triageRequirePriority: team.triageRequirePriority,
    emailIntakeEnabled: team.emailIntakeEnabled === true,
    emailIntakeAddress: team.emailIntakeAddress,
    autoCloseDays: team.autoCloseDays,
    autoArchiveDays: team.autoArchiveDays,
    autoCloseParent: team.autoCloseParent,
    autoCloseChildren: team.autoCloseChildren,
    defaultTemplateForMembersId: team.defaultTemplateForMembersId,
    defaultTemplateForNonMembersId: team.defaultTemplateForNonMembersId,
    timezone: team.timezone,
    templates,
    recurring,
    statuses,
  };
}
