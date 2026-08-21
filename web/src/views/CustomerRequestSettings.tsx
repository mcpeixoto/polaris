/**
 * Workspace Settings → Customer requests: the toggle, default feedback team, revenue unit,
 * and named tiers. The mutations already lived on workspace; this is the screen.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, Checkbox, Input, Select } from '~/components';
import { report } from '~/features/issue/mutations';
import { updateWorkspaceCustomers } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from '~/features/labels/LabelSettings.module.css';

export function CustomerRequestSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const [tierName, setTierName] = useState('');

  const workspace = useLiveQuery(
    (store: Store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
    [],
  );

  const teams = useLiveQuery(
    (store: Store) =>
      [...store.teams.values()]
        .filter(
          (team) => !team.private && team.retiredAt === undefined && team.archivedAt === undefined,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['team'],
    [],
  );

  const save = (fields: Parameters<typeof updateWorkspaceCustomers>[1]) => {
    setError(null);
    updateWorkspaceCustomers(engine, fields).catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
      report(failure);
    });
  };

  const addTier = (event: FormEvent) => {
    event.preventDefault();
    if (workspace === null) return;
    const name = tierName.trim();
    if (name === '') return;
    const existing = workspace.customerTiers.map((tier) => tier.toLowerCase());
    if (existing.includes(name.toLowerCase())) {
      setError('That tier is already on the list.');
      return;
    }
    setTierName('');
    save({ customerTiers: [...workspace.customerTiers, name] });
  };

  if (workspace === null) {
    return null;
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Customer requests</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            Link feedback to customers, then to issues and projects. Guests never see this. Turning
            it off hides the pages and refuses new requests; existing data stays.
          </p>

          <Checkbox
            label="Enable customer requests"
            checked={workspace.customerRequestsEnabled}
            onChange={(event) => save({ customerRequestsEnabled: event.target.checked })}
          />

          <Select
            label="Default team"
            hint="Used when creating an issue from a customer page. Public teams only."
            value={workspace.customerDefaultTeamId ?? ''}
            disabled={!workspace.customerRequestsEnabled}
            onChange={(event) =>
              save({
                customerDefaultTeamId: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">No default — the creator picks</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>

          <Input
            label="Revenue unit"
            hint="Shown next to a customer's revenue. USD, seats, or leave blank."
            defaultValue={workspace.customerRevenueUnit}
            key={`unit:${workspace.customerRevenueUnit}`}
            disabled={!workspace.customerRequestsEnabled}
            onBlur={(event) => {
              const unit = event.target.value.trim();
              if (unit === workspace.customerRevenueUnit) return;
              save({ customerRevenueUnit: unit });
            }}
          />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Tiers</h2>
          <p className={styles.sectionHint}>
            Named plans offered when attributing a customer — Enterprise, Pro, self-serve. The
            customer's tier field stores the name.
          </p>

          <form className={styles.create} onSubmit={addTier}>
            <Input
              label="Tier name"
              value={tierName}
              disabled={!workspace.customerRequestsEnabled}
              onChange={(event) => setTierName(event.target.value)}
            />
            <Button type="submit" disabled={!workspace.customerRequestsEnabled}>
              Add
            </Button>
          </form>

          {workspace.customerTiers.length === 0 ? (
            <p className={styles.quiet}>No tiers yet. The customer page accepts any label.</p>
          ) : (
            <ul className={styles.tree}>
              {workspace.customerTiers.map((tier) => (
                <li key={tier} className={styles.row}>
                  <span>{tier}</span>
                  <Button
                    variant="ghost"
                    disabled={!workspace.customerRequestsEnabled}
                    onClick={() =>
                      save({
                        customerTiers: workspace.customerTiers.filter((name) => name !== tier),
                      })
                    }
                  >
                    Remove
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
