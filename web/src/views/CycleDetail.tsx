/**
 * One cycle: its issues, under its name, with a properties rail and a per-member panel.
 *
 * The issue list with a different source, same as a project. Creating an issue with C
 * from here files it into this cycle. Clicking a member filters the list the same way the
 * filter bar would.
 *
 * The header is what makes this a cycle rather than a list that happens to be filtered to
 * one. A sprint is read as a position in a series — which window is this, how far through
 * is it, what came before — so it carries the trail back to the team's cycles and a step to
 * either neighbour. The step is bound through the keymap registry like every other movement
 * in the product, so it appears in the help overlay and the command menu rather than being a
 * key this one screen happens to listen for.
 *
 * Two things here were wrong rather than missing. The switcher's tooltips taught `[` and `]`
 * while the actions were bound to `alt+Arrow`, so the product was teaching a chord that did
 * nothing; they are `[` and `]` now, and the sidebar toggle that also claims `[` keeps it
 * everywhere else, because an inner context wins and this one is only pushed while a cycle
 * is on screen. And the actions were registered without a `when:`, which put a cycle's
 * navigation in `global` — live on every screen in the workspace, including the ones with no
 * cycle to step from. They are `detail` actions, like every other detail screen's.
 *
 * The rail is where a cycle's own properties live. Before it, the description could only be
 * reached through the edit dialog and the dates could not be read at all without opening it,
 * which made the window — the one fact the whole screen is about — the one fact you had to
 * open a modal to see. A `Textarea` and `useSaveState` rather than `DescriptionEditor`: one
 * field, no mentions, no mark overlay, and nothing a full editor would add.
 */

import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import {
  Badge,
  Breadcrumb,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  IconButton,
  Menu,
  Progress,
  SaveIndicator,
  Textarea,
  useSaveState,
} from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity } from '~/features/cycles/computeCapacity';
import { buildCycleGraph, cycleScopeChange } from '~/features/cycles/computeCycleGraph';
import { CycleCalendarModal } from '~/features/cycles/CycleCalendarModal';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { CycleMembers } from '~/features/cycles/CycleMembers';
import { cycleMemberShares } from '~/features/cycles/cycleDistribution';
import { CycleEditModal, isNextUpcoming, phaseOf } from '~/features/cycles/CycleEditModal';
import { cycleDay, cycleWindow, daysLeftLabel } from '~/features/cycles/format';
import { CycleMembersGlyph, NextCycleGlyph, PreviousCycleGlyph } from '~/features/cycles/glyphs';
import { inheritsCycleSchedule } from '~/features/cycles/inherit';
import { startCycleToday, updateCycle } from '~/features/cycles/mutations';
import { useNow } from '~/features/cycles/useNow';
import { dayIn, withDay } from '~/features/cycles/zone';
// The three-dot glyph is the issue screens', not a fourth copy of three circles: two views
// and a board had each drawn their own, and a shared one is the only way they stay alike.
import { CalendarGlyph, DotsGlyph, PencilGlyph } from '~/features/issue/glyphs';
import { useActions, useKeyContext } from '~/app/keymap';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle } from '~/store';
import { ApiError } from '~/sync/api';
import { IssueList, type IssueListSource } from './IssueList';
import styles from './CycleDetail.module.css';

export function CycleDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { cycleId = '' } = useParams<{ cycleId: string }>();
  const [membersOpen, setMembersOpen] = useState(true);
  const now = useNow();
  const cycle = useLiveQuery((store) => store.cycles.get(cycleId) ?? null, ['cycle'], [cycleId]);
  const cycleState = useEntityState(cycle);

  // Read from the clock rather than from the render, so a screen left open across the end
  // of a cycle stops calling it Current and stops offering to move its end date.
  const phase = cycle === null ? null : phaseOf(cycle, now);
  const capacity = useLiveQuery(
    (store) => (cycle === null || phase !== 'Upcoming' ? null : cycleCapacity(store, cycle.id)),
    ['cycle', 'issue', 'team', 'teamMembership', 'workflowState'],
    [cycle?.id ?? '', phase],
  );
  const shares = useLiveQuery(
    (store) => (cycle === null ? [] : cycleMemberShares(store, cycle.id)),
    ['cycle', 'issue', 'user', 'team', 'workflowState'],
    [cycle?.id ?? ''],
  );
  const team = useLiveQuery(
    (store) => (cycle === null ? null : (store.teams.get(cycle.teamId) ?? null)),
    ['team', 'cycle'],
    [cycle?.teamId ?? ''],
  );
  const parent = useLiveQuery(
    (store) =>
      team === null || team.parentTeamId === undefined
        ? null
        : (store.get('team', team.parentTeamId) ?? null),
    ['team'],
    [team?.parentTeamId ?? ''],
  );
  const unitLabel = team === null || team.estimateScale === 'none' ? 'issues' : 'points';

  /** The team's cycles in cadence order, which is the order the switcher steps through. */
  const siblings = useLiveQuery(
    (store) =>
      cycle === null
        ? []
        : [...store.cycleIdsFor(cycle.teamId)]
            .map((id) => store.cycles.get(id))
            .filter((c): c is Cycle => c !== undefined && c.archivedAt === undefined)
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    ['cycle', 'team'],
    [cycle?.teamId ?? ''],
  );
  const graph = useLiveQuery(
    (store) => (cycle === null ? null : buildCycleGraph(store, cycle.id)),
    ['cycle', 'issue', 'team', 'workflowState', 'user'],
    [cycle?.id ?? ''],
  );

  const index = siblings.findIndex((candidate) => candidate.id === cycleId);
  const previous = index > 0 ? (siblings[index - 1] ?? null) : null;
  const next = index >= 0 && index < siblings.length - 1 ? (siblings[index + 1] ?? null) : null;

  const source = useMemo<IssueListSource | null>(
    () => (cycle === null ? null : { kind: 'cycle', cycleId: cycle.id }),
    [cycle],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [endPickerOpen, setEndPickerOpen] = useState(false);
  const startTriggerRef = useRef<HTMLButtonElement>(null);
  const endTriggerRef = useRef<HTMLButtonElement>(null);
  const description = useSaveState();

  const go = (target: Cycle | null) => {
    if (target !== null) void navigate(`/cycle/${target.id}`);
  };

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'cycle.toggleMembers',
        title: 'Toggle cycle members',
        keys: ['mod+i'],
        when: 'detail',
        group: 'Views',
        run: () => setMembersOpen((open) => !open),
      },
      {
        id: 'cycle.previous',
        title: 'Previous cycle',
        keys: ['['],
        when: 'detail',
        group: 'Navigation',
        enabled: () => previous !== null,
        run: () => go(previous),
      },
      {
        id: 'cycle.next',
        title: 'Next cycle',
        keys: [']'],
        when: 'detail',
        group: 'Navigation',
        enabled: () => next !== null,
        run: () => go(next),
      },
    ],
    [],
  );

  if (cycleState === 'loading') {
    return (
      <div className={styles.screen}>
        <EntityLoading label="Loading cycle…" lines={4} className={styles.loading} />
      </div>
    );
  }

  if (cycle === null || source === null) {
    return (
      <EmptyState
        title="No such cycle"
        description="It may have been removed when cycles were turned off, or it belongs to a team you are not in."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  const zone = team?.timezone ?? 'UTC';
  const inherited = team !== null && inheritsCycleSchedule(team, parent);
  const canStartToday = !inherited && phase === 'Upcoming' && isNextUpcoming(cycle, siblings, now);
  const running = siblings.find((candidate) => phaseOf(candidate, now) === 'Current') ?? null;
  const percent =
    graph === null || graph.totalScope === 0
      ? null
      : Math.round((graph.totalCompleted / graph.totalScope) * 100);
  // The dates follow the same rules the edit dialog states: a running window can only move
  // its end, a finished one moves neither, and a sub-team that inherits its schedule moves
  // nothing at all.
  const canEditStart = !inherited && phase === 'Upcoming';
  const canEditEnd = !inherited && phase !== 'Previous';
  const scope = graph === null ? null : cycleScopeChange(graph);

  const saveDay = (field: 'startsAt' | 'endsAt', day: string | null) => {
    if (day === null) return;
    const iso = withDay(day, cycle[field], zone);
    const start = Date.parse(field === 'startsAt' ? iso : cycle.startsAt);
    const end = Date.parse(field === 'endsAt' ? iso : cycle.endsAt);
    // The same refusal the dialog makes, for the same reason: an inverted window collapses
    // the burn-up to a single point, and the server rejects it a round trip later.
    if (end <= start) return;
    void updateCycle(engine, cycle.id, field === 'startsAt' ? { startsAt: iso } : { endsAt: iso });
  };

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {/* Named, because the issue list below draws a header of its own and two unnamed
            banners on one screen are two things a screen reader cannot tell apart. */}
        <header className={styles.header} aria-label="Cycle">
          {/* The trail is the title here, as it is on an issue: the heading beside it is for
              the accessibility tree and for anything that reads a page by its headings. */}
          <h1 className={styles.screenTitle}>{cycle.name}</h1>
          <Breadcrumb
            className={styles.crumbs}
            items={[
              ...(team === null
                ? []
                : [
                    { label: team.name, to: `/team/${team.key}`, icon: team.icon },
                    { label: 'Cycles', to: `/team/${team.key}/cycles` },
                  ]),
              { label: cycle.name },
            ]}
          />
          <Badge tone={phase === 'Current' ? 'accent' : 'neutral'}>{phase}</Badge>
          <span className={styles.window}>
            {cycleWindow(cycle.startsAt, cycle.endsAt, zone, now)}
            {phase === 'Current' ? ` · ${daysLeftLabel(cycle.endsAt, zone, now)}` : ''}
          </span>
          {percent === null || graph === null ? null : (
            <span className={styles.progress}>
              <Progress
                percent={percent}
                label={`${cycle.name} progress`}
                detail={`${graph.totalCompleted} of ${graph.totalScope} ${graph.unitLabel} completed`}
                size="sm"
              />
              <span className={styles.ratio}>
                {graph.totalCompleted}/{graph.totalScope}
              </span>
            </span>
          )}
          <span className={styles.switcher}>
            <IconButton
              aria-label="Previous cycle"
              keys="["
              size="sm"
              disabled={previous === null}
              onClick={() => go(previous)}
              icon={<PreviousCycleGlyph />}
            />
            <IconButton
              aria-label="Next cycle"
              keys="]"
              size="sm"
              disabled={next === null}
              onClick={() => go(next)}
              icon={<NextCycleGlyph />}
            />
          </span>
          {/* The members panel was reachable by ⌘I and by nothing else, which is a panel
              only the person who wrote it knows about. */}
          <IconButton
            aria-label={membersOpen ? 'Hide cycle members' : 'Show cycle members'}
            aria-pressed={membersOpen}
            keys="mod+i"
            size="sm"
            onClick={() => setMembersOpen((open) => !open)}
            icon={<CycleMembersGlyph />}
          />
          <IconButton
            ref={menuTriggerRef}
            aria-label={`Options for ${cycle.name}`}
            size="sm"
            onClick={() => setMenuOpen(true)}
            icon={<DotsGlyph />}
          />
        </header>
        {capacity !== null && <CapacityDial data={capacity} />}
        <CycleGraph cycleId={cycle.id} />
        <IssueList source={source} heading={cycle.name} />
      </div>

      <aside className={styles.rail} aria-label="Properties">
        <h2 className={styles.railTitle}>Properties</h2>

        <div className={styles.railRow}>
          <span className={styles.railLabel}>Dates</span>
          <div className={styles.dates}>
            <button
              type="button"
              ref={startTriggerRef}
              className={styles.dateButton}
              disabled={!canEditStart}
              onClick={() => setStartPickerOpen(true)}
            >
              <CalendarGlyph className={styles.dateGlyph} />
              <span className={styles.srOnly}>Start date</span>
              {cycleDay(cycle.startsAt, zone, now)}
            </button>
            <span className={styles.dateDash} aria-hidden="true">
              –
            </span>
            <button
              type="button"
              ref={endTriggerRef}
              className={styles.dateButton}
              disabled={!canEditEnd}
              onClick={() => setEndPickerOpen(true)}
            >
              <span className={styles.srOnly}>End date</span>
              {cycleDay(cycle.endsAt, zone, now)}
            </button>
          </div>
          {inherited ? (
            <p className={styles.railNote}>
              This team inherits its parent’s cycle dates. Change the schedule on the parent team.
            </p>
          ) : null}
        </div>

        {/* The question a sprint review opens with, and the one a completion ratio cannot
            answer: eight of ten finished reads very differently once four of them arrived
            after the window opened. */}
        {scope === null || graph === null || graph.issueCount === 0 ? null : (
          <div className={styles.railRow}>
            <span className={styles.railLabel}>Scope change</span>
            <span className={styles.scopeChange}>
              {scope.delta === 0
                ? `No change from ${scope.opening} ${graph.unitLabel}`
                : `${scope.delta > 0 ? '+' : '−'}${Math.abs(scope.delta)} ${graph.unitLabel} since it opened at ${scope.opening}`}
            </span>
          </div>
        )}

        <div className={styles.railRow}>
          <span className={styles.railHead}>
            <span className={styles.railLabel} id="cycle-description-label">
              Description
            </span>
            <SaveIndicator state={description.state} />
          </span>
          <Textarea
            key={`description-${cycle.id}`}
            aria-labelledby="cycle-description-label"
            surface="plain"
            minRows={3}
            maxRows={12}
            placeholder="What is this cycle for?"
            value={cycle.description ?? ''}
            // On blur rather than per keystroke: one field, one write, and a draft that is
            // still being typed is not yet a description.
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (next === (cycle.description ?? '')) return;
              void description.run(() =>
                updateCycle(engine, cycle.id, {
                  description: next,
                  clearDescription: next === '',
                }),
              );
            }}
          />
          {description.error === undefined ? null : (
            <p className={styles.railError} role="alert">
              {description.error}
            </p>
          )}
        </div>
      </aside>

      {membersOpen ? <CycleMembers rows={shares} unitLabel={unitLabel} /> : null}

      <DatePicker
        open={startPickerOpen}
        onClose={() => setStartPickerOpen(false)}
        trigger={startTriggerRef}
        value={dayIn(cycle.startsAt, zone)}
        timezone={zone}
        actionId="cycleDetail.closeStartPicker"
        actionGroup="Views"
        label="Start date"
        onSelect={(day) => {
          setStartPickerOpen(false);
          saveDay('startsAt', day);
        }}
      />
      <DatePicker
        open={endPickerOpen}
        onClose={() => setEndPickerOpen(false)}
        trigger={endTriggerRef}
        value={dayIn(cycle.endsAt, zone)}
        timezone={zone}
        actionId="cycleDetail.closeEndPicker"
        actionGroup="Views"
        label="End date"
        onSelect={(day) => {
          setEndPickerOpen(false);
          saveDay('endsAt', day);
        }}
      />

      {/* The same three commands the list's ⋯ menu offers, because a cycle opened directly
          is the same cycle and should not have fewer things you can do to it. */}
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        trigger={menuTriggerRef}
        label="Cycle options"
        placement="bottom-end"
        items={[
          {
            id: 'edit',
            label: 'Edit cycle',
            icon: <PencilGlyph />,
            onSelect: () => {
              setMenuOpen(false);
              setEditOpen(true);
            },
          },
          {
            id: 'subscribe',
            label: 'Subscribe to cycle calendar',
            icon: <CalendarGlyph />,
            onSelect: () => {
              setMenuOpen(false);
              setCalendarOpen(true);
            },
          },
          ...(canStartToday
            ? [
                {
                  id: 'start-today',
                  label: 'Start cycle today',
                  icon: <NextCycleGlyph />,
                  // Danger, unlike the two above it: it completes whatever is running and
                  // moves its open work, and the spec calls that irreversible.
                  danger: true,
                  onSelect: () => {
                    setMenuOpen(false);
                    setStartError(null);
                    setConfirmStart(true);
                  },
                },
              ]
            : []),
        ]}
      />

      <CycleEditModal
        open={editOpen}
        cycle={cycle}
        phase={phase ?? 'Previous'}
        timezone={zone}
        datesLocked={inherited}
        onClose={() => setEditOpen(false)}
        onSave={async (edit) => {
          await updateCycle(engine, cycle.id, {
            name: edit.name,
            description: edit.description,
            clearDescription: edit.clearDescription,
            startsAt: edit.startsAt,
            endsAt: edit.endsAt,
          });
        }}
      />
      <ConfirmDialog
        open={confirmStart}
        title={`Start ${cycle.name} today?`}
        consequence={
          running === null
            ? 'The cycle starts at 12:00 AM today in the team’s timezone and the pause before it ends. This cannot be undone.'
            : `${running.name} is completed immediately and its open issues move into this cycle. This cannot be undone.`
        }
        confirmLabel="Start cycle today"
        destructive
        busy={startBusy}
        error={startError ?? undefined}
        onClose={() => {
          setConfirmStart(false);
          setStartError(null);
        }}
        onConfirm={() => {
          setStartBusy(true);
          setStartError(null);
          void startCycleToday(engine, cycle.id).then(
            () => {
              setStartBusy(false);
              setConfirmStart(false);
            },
            (cause: unknown) => {
              setStartBusy(false);
              setStartError(
                cause instanceof ApiError ? cause.message : 'Could not start this cycle.',
              );
            },
          );
        }}
      />
      <CycleCalendarModal
        open={calendarOpen}
        teamId={cycle.teamId}
        teamName={team?.name ?? ''}
        onClose={() => setCalendarOpen(false)}
      />
    </div>
  );
}
