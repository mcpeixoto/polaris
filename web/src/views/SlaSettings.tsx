/**
 * Workspace SLA rules: first match wins, ordered by position.
 *
 * An apply rule owns the issue's due date. A remove rule clears that date when the issue
 * no longer matches an apply rule above it. Changing a rule does not rewrite existing
 * issues; the next create or update re-evaluates.
 *
 * Because first match wins, the order *is* the behaviour, which is why every row carries
 * move controls. They are buttons and not a drag handle: a drag needs a keyboard fallback
 * anyway, and once the fallback exists the drag is the part that could be left out.
 *
 * "Up" is implemented as moving the rule above this one down past it. That is the same
 * permutation, and it is the only one the API can express — `UpdateSlaRuleInput` takes an
 * `afterId` and has no way to say "move to the top". See `moveSlaRule`.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Select,
  SettingsPage,
  SettingsSection,
} from '~/components';
import {
  featureBlock,
  refusalOf,
  useEntitlements,
  type Block,
} from '~/features/admin/entitlements';
import { PlanBlock } from '~/features/admin/PlanBlock';
import type { FilterNode } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { byOrderKey } from '~/store';
import type { EntityOf, Store } from '~/store';
import { ApiError } from '~/sync/api';
import { report } from '~/features/issue/mutations';
import styles from './SlaSettings.module.css';

import {
  createSlaRule,
  DEFAULT_SLA_RULES,
  deleteSlaRule,
  moveSlaRule,
} from '~/features/slas/mutations';

type SlaRule = EntityOf<'slaRule'>;

const DURATIONS: ReadonlyArray<{ readonly minutes: number; readonly label: string }> = [
  { minutes: 720, label: '12 hours' },
  { minutes: 1440, label: '24 hours' },
  { minutes: 2880, label: '48 hours' },
  { minutes: 10080, label: '1 week' },
  { minutes: 20160, label: '2 weeks' },
  { minutes: 40320, label: '4 weeks' },
];

type MatchPreset = 'urgent' | 'high' | 'rest' | 'all';

function filterFor(preset: MatchPreset): FilterNode {
  switch (preset) {
    case 'urgent':
      return { field: 'priority', op: 'eq', values: ['1'] };
    case 'high':
      return { field: 'priority', op: 'eq', values: ['2'] };
    case 'rest':
      return { field: 'priority', op: 'in', values: ['0', '3', '4'] };
    case 'all':
      return {};
  }
}

function describeFilter(filter: FilterNode): string {
  if (
    'field' in filter &&
    filter.field === 'priority' &&
    filter.op === 'eq' &&
    filter.values?.[0] === '1'
  ) {
    return 'Priority is Urgent';
  }
  if (
    'field' in filter &&
    filter.field === 'priority' &&
    filter.op === 'eq' &&
    filter.values?.[0] === '2'
  ) {
    return 'Priority is High';
  }
  if (
    'field' in filter &&
    filter.field === 'priority' &&
    filter.op === 'in' &&
    (filter.values ?? []).join(',') === '0,3,4'
  ) {
    return 'Priority is Medium, Low, or none';
  }
  if (!('field' in filter) && (filter.nodes === undefined || filter.nodes.length === 0)) {
    return 'Every issue';
  }
  return 'Custom filter';
}

function describeDuration(minutes: number | undefined): string {
  if (minutes === undefined) return '';
  const found = DURATIONS.find((d) => d.minutes === minutes);
  return found?.label ?? `${minutes} minutes`;
}

/** The whole rule as one sentence — used in the list, the move labels and the confirmation. */
function describeRule(rule: SlaRule): string {
  return rule.action === 'apply'
    ? `${describeFilter(rule.filter)} → due in ${describeDuration(rule.durationMinutes)}`
    : `${describeFilter(rule.filter)} → remove SLA`;
}

export function SlaSettings() {
  const engine = useEngine();
  const entitlements = useEntitlements();
  const blocked = featureBlock(entitlements, 'slas');
  const [error, setError] = useState<Block | null>(null);
  const [match, setMatch] = useState<MatchPreset>('urgent');
  const [action, setAction] = useState<'apply' | 'remove'>('apply');
  const [minutes, setMinutes] = useState(1440);
  const [deleting, setDeleting] = useState<SlaRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const rules = useLiveQuery(
    (store: Store) => {
      return [...store.slaRules.values()].sort(byOrderKey('position'));
    },
    ['slaRule'],
  );

  /**
   * A refusal the server made, rather than one this screen predicted.
   *
   * Held as a Block and not a string so a PLAN_LIMIT that arrives here — the client's matrix
   * can be absent offline, and this screen is live in that case by design — renders with the
   * same link as the check above it. Before this it rendered as bare prose, which is the one
   * case where somebody has actually tried the thing and most needs somewhere to go.
   */
  const fail = (failure: unknown) => {
    const refusal = refusalOf(failure);
    setError(
      refusal ??
        (failure instanceof ApiError
          ? { reason: failure.message, upgrade: null }
          : { reason: 'That change could not be saved.', upgrade: null }),
    );
    report(failure);
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createSlaRule(engine, {
      filter: filterFor(match),
      action,
      ...(action === 'apply' ? { durationMinutes: minutes } : null),
    }).catch(fail);
  };

  /**
   * Load the defaults, and say how far it got when it does not finish.
   *
   * The creates are chained rather than fired together because position is assigned in
   * arrival order and the set is only meaningful in the order it is written. That makes a
   * failure partway through the normal shape of a failure here, and reporting it as one
   * refusal used to leave somebody looking at a rule set that was half a rule set with
   * nothing on screen saying so.
   */
  const onDefaults = async () => {
    setError(null);
    let landed = 0;
    for (const rule of DEFAULT_SLA_RULES) {
      try {
        await createSlaRule(engine, rule);
        landed += 1;
      } catch (failure) {
        const refusal = refusalOf(failure);
        const reason =
          refusal?.reason ??
          (failure instanceof ApiError ? failure.message : 'That change could not be saved.');
        setError({
          reason:
            landed === 0
              ? reason
              : `${reason} ${countLabel(landed)} of ${DEFAULT_SLA_RULES.length} had already been added — the rest were not.`,
          upgrade: refusal?.upgrade ?? null,
        });
        report(failure);
        return;
      }
    }
  };

  /**
   * Move `rule` one place, by naming the rule it should sit after.
   *
   * Sequentialised behind `moving` because two moves in flight at once are two servers
   * minting positions from the same stale order, and the second one lands somewhere nobody
   * asked for.
   */
  const move = async (id: string, afterId: string) => {
    if (moving) return;
    setMoving(true);
    setError(null);
    try {
      await moveSlaRule(engine, id, afterId);
    } catch (failure) {
      fail(failure);
    } finally {
      setMoving(false);
    }
  };

  const confirmDelete = async () => {
    if (deleting === null || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteSlaRule(engine, deleting.id);
      setDeleting(null);
    } catch (failure) {
      setDeleteError(
        failure instanceof ApiError ? failure.message : 'That rule could not be deleted.',
      );
      report(failure);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <SettingsPage title="SLAs">
      <PlanBlock block={error} className={styles.error} role="alert" />
      <PlanBlock block={blocked} className={styles.error} />

      <SettingsSection
        description="Rules are checked in order. The first match owns the issue's due date, or removes an SLA-owned date. Changing a rule does not rewrite existing issues; the next create or update re-evaluates."
        flush
      >
        <form className={styles.create} onSubmit={onCreate}>
          <Select
            label="When"
            value={match}
            disabled={blocked !== null}
            onChange={(event) => setMatch(event.target.value as MatchPreset)}
          >
            <option value="urgent">Priority is Urgent</option>
            <option value="high">Priority is High</option>
            <option value="rest">Priority is Medium, Low, or none</option>
            <option value="all">Every issue</option>
          </Select>
          <Select
            label="Do"
            value={action}
            disabled={blocked !== null}
            onChange={(event) => setAction(event.target.value as 'apply' | 'remove')}
          >
            <option value="apply">Apply an SLA</option>
            <option value="remove">Remove the SLA</option>
          </Select>
          {/*
            The duration cell keeps its place in the grid when the action has no duration.
            It used to be a bare `<span />` spacer holding a column open in a stylesheet
            borrowed from the labels screen; the grid is this screen's own now, and an empty
            cell is expressed by not rendering one.
          */}
          {action === 'apply' ? (
            <Select
              label="Duration"
              value={String(minutes)}
              disabled={blocked !== null}
              onChange={(event) => setMinutes(Number.parseInt(event.target.value, 10))}
            >
              {DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Button type="submit" disabled={blocked !== null}>
            Add rule
          </Button>
        </form>

        {rules.length === 0 ? (
          <EmptyState
            title="No SLA rules"
            description="Load the usual priority defaults, or add a rule above."
            action={
              <Button onClick={() => void onDefaults()} disabled={blocked !== null}>
                Load defaults
              </Button>
            }
          />
        ) : (
          <ol className={styles.rules}>
            {rules.map((rule, index) => {
              const previous = rules[index - 1];
              const next = rules[index + 1];
              return (
                <li key={rule.id} className={styles.rule}>
                  <span className={styles.rank} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className={styles.ruleText}>{describeRule(rule)}</span>
                  <div className={styles.ruleActions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={blocked !== null || previous === undefined}
                      loading={moving}
                      // Named with the rule rather than "Up", because a column of identical
                      // arrows names nothing and this list is read one rule at a time.
                      aria-label={`Move ${describeRule(rule)} earlier`}
                      onClick={() => {
                        if (previous === undefined) return;
                        void move(previous.id, rule.id);
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={blocked !== null || next === undefined}
                      loading={moving}
                      aria-label={`Move ${describeRule(rule)} later`}
                      onClick={() => {
                        if (next === undefined) return;
                        void move(rule.id, next.id);
                      }}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={blocked !== null}
                      aria-label={`Delete ${describeRule(rule)}`}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(rule);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this rule?"
        consequence={
          deleting === null
            ? ''
            : `"${describeRule(deleting)}" stops being checked. Issues whose due date this rule set keep it — nothing already dated is rewritten — but the next issue that would have matched falls through to the rule below it, or to no SLA at all.`
        }
        confirmLabel="Delete this rule"
        destructive
        busy={deleteBusy}
        error={deleteError ?? undefined}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (deleteBusy) return;
          setDeleting(null);
          setDeleteError(null);
        }}
      />
    </SettingsPage>
  );
}

/** Numbers in prose read as prose — "1 rule", not "1 rules". */
function countLabel(total: number): string {
  return total === 1 ? '1 rule' : `${total} rules`;
}
