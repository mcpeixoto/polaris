/**
 * Workspace Settings → Customer requests: the toggle, default feedback team, revenue unit,
 * and named tiers. The mutations already lived on workspace; this is the screen.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Input,
  SaveIndicator,
  Select,
  SettingsPage,
  SettingsSection,
  useSaveState,
} from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { report } from '~/features/issue/mutations';
import { updateWorkspaceCustomers } from '~/features/workspace/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './CustomerRequestSettings.module.css';

export function CustomerRequestSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const [tierName, setTierName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const unit = useSaveState();

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

  const workspaceState = useEntityState(workspace);

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

  const confirmRemove = async () => {
    if (removing === null || workspace === null || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await updateWorkspaceCustomers(engine, {
        customerTiers: workspace.customerTiers.filter((name) => name !== removing),
      });
      setRemoving(null);
    } catch (failure) {
      setRemoveError(
        failure instanceof ApiError ? failure.message : 'That tier could not be removed.',
      );
      report(failure);
    } finally {
      setRemoveBusy(false);
    }
  };

  // A workspace row that has not arrived yet is not a workspace without settings. This used
  // to return null, so a cold deep link to this page rendered nothing at all — no heading, no
  // explanation, no indication that anything was on its way.
  if (workspace === null) {
    return (
      <SettingsPage title="Customer requests">
        {workspaceState === 'loading' ? (
          <EntityLoading label="Loading customer request settings…" lines={4} />
        ) : (
          <p className={styles.hint}>
            This workspace could not be read. Reload the page, or check that you are still signed
            in.
          </p>
        )}
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="Customer requests" error={error ?? undefined}>
      <SettingsSection
        description="Link feedback to customers, then to issues and projects. Guests never see this. Turning it off hides the pages and refuses new requests; existing data stays."
        status={<SaveIndicator state={unit.state} />}
        error={unit.error}
      >
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

        <RevenueUnit
          value={workspace.customerRevenueUnit}
          disabled={!workspace.customerRequestsEnabled}
          save={unit}
          onSave={(next) => updateWorkspaceCustomers(engine, { customerRevenueUnit: next })}
        />
      </SettingsSection>

      <SettingsSection
        title="Tiers"
        description="Named plans offered when attributing a customer — Enterprise, Pro, self-serve. The customer's tier field stores the name."
        flush
      >
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
          <p className={styles.hint}>No tiers yet. The customer page accepts any label.</p>
        ) : (
          <ul className={styles.tiers}>
            {workspace.customerTiers.map((tier) => (
              <li key={tier} className={styles.tier}>
                <span>{tier}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${tier}`}
                  disabled={!workspace.customerRequestsEnabled}
                  onClick={() => {
                    setRemoveError(null);
                    setRemoving(tier);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={removing !== null}
        title={removing === null ? '' : `Remove the ${removing} tier?`}
        consequence="Customers already marked with it keep the word — the tier field stores the name, not a reference — but it stops being offered when somebody attributes a new one, and nothing here puts it back except typing it again."
        confirmLabel="Remove this tier"
        destructive
        busy={removeBusy}
        error={removeError ?? undefined}
        onConfirm={() => void confirmRemove()}
        onClose={() => {
          if (removeBusy) return;
          setRemoving(null);
          setRemoveError(null);
        }}
      />
    </SettingsPage>
  );
}

interface RevenueUnitProps {
  value: string;
  disabled: boolean;
  save: ReturnType<typeof useSaveState>;
  onSave: (value: string) => Promise<unknown>;
}

/**
 * The revenue unit, saved on blur — and now saying so.
 *
 * Two things were wrong with it. It was uncontrolled with a `key={`unit:${value}`}`, so every
 * save remounted the field: the caret went to the end and the focus ring went out, on a
 * control the user had only just left. And the save itself was silent, which on a screen with
 * no other feedback is indistinguishable from the field having done nothing at all.
 *
 * So it is controlled, and the remote value is adopted only while the field is not focused —
 * which is what the remount was really for, and the one moment adopting it cannot destroy
 * something somebody is in the middle of typing.
 */
function RevenueUnit({ value, disabled, save, onSave }: RevenueUnitProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <Input
      label="Revenue unit"
      hint="Shown next to a customer's revenue. USD, seats, or leave blank."
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
        save.clear();
      }}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const next = draft.trim();
        if (next === value) {
          setDraft(value);
          return;
        }
        void save
          .run(() => onSave(next))
          .then((landed) => {
            // A refusal leaves the typed value in the box beside the reason, rather than
            // silently reverting to a value the user has just decided against.
            if (landed) setDraft(next);
          });
      }}
    />
  );
}
