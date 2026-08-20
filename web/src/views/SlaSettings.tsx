/**
 * Workspace SLA rules: first match wins, ordered by position.
 *
 * An apply rule owns the issue's due date. A remove rule clears that date when the issue
 * no longer matches an apply rule above it. Changing a rule does not rewrite existing
 * issues; the next create or update re-evaluates.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Select } from '~/components';
import { featureBlock, useEntitlements } from '~/features/admin/entitlements';
import type { FilterNode } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';
import { report } from '~/features/issue/mutations';
import styles from '~/features/labels/LabelSettings.module.css';

import { createSlaRule, DEFAULT_SLA_RULES, deleteSlaRule } from '~/features/slas/mutations';

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

export function SlaSettings() {
  const engine = useEngine();
  const entitlements = useEntitlements();
  const blocked = featureBlock(entitlements, 'slas');
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchPreset>('urgent');
  const [action, setAction] = useState<'apply' | 'remove'>('apply');
  const [minutes, setMinutes] = useState(1440);

  const rules = useLiveQuery(
    (store: Store) => {
      return [...store.slaRules.values()].sort((a, b) => a.position.localeCompare(b.position));
    },
    ['slaRule'],
  );

  const fail = (failure: unknown) => {
    setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
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

  const onDefaults = () => {
    setError(null);
    void DEFAULT_SLA_RULES.reduce<Promise<string>>(
      (chain, rule) => chain.then(() => createSlaRule(engine, rule)),
      Promise.resolve(''),
    ).catch(fail);
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>SLAs</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {blocked === null ? null : (
          <p className={styles.error} role="status">
            {blocked}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            Rules are checked in order. The first match owns the issue's due date, or removes an
            SLA-owned date. Changing a rule does not rewrite existing issues; the next create or
            update re-evaluates.
          </p>

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
            ) : (
              <span />
            )}
            <Button type="submit" disabled={blocked !== null}>
              Add rule
            </Button>
          </form>

          {rules.length === 0 ? (
            <EmptyState
              title="No SLA rules"
              description="Load the usual priority defaults, or add a rule above."
              action={
                <Button onClick={onDefaults} disabled={blocked !== null}>
                  Load defaults
                </Button>
              }
            />
          ) : (
            <ul className={styles.tree}>
              {rules.map((rule) => (
                <li key={rule.id} className={styles.row}>
                  <span>
                    {describeFilter(rule.filter)}
                    {rule.action === 'apply'
                      ? ` → due in ${describeDuration(rule.durationMinutes)}`
                      : ' → remove SLA'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={blocked !== null}
                    onClick={() => {
                      setError(null);
                      deleteSlaRule(engine, rule.id).catch(fail);
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
