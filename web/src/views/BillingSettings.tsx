/**
 * Billing: what this workspace is on, and the two buttons that change it.
 *
 * Both buttons hand the browser to Stripe. Nothing here touches a card, an address or a VAT
 * number — Checkout collects them and the portal edits them — because the moment this
 * product renders a card field it inherits PCI scope it has no reason to want.
 *
 * The screen renders from `GET /billing` rather than from the replica. The plan on the
 * workspace row is replicated and would be enough for a badge, but the seats being billed,
 * the period end and whether there is a customer to open a portal for live on the
 * subscription row, which is deliberately not on the sync stream: it is money, it is
 * admin-only, and putting it in every member's IndexedDB would be the wrong default forever.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button, SettingsPage, SettingsSection, Spinner } from '~/components';
import { SettingsRow } from '~/components/SettingsSection';
import { formatEur, PRO_MONTHLY_CENTS, annualMonthlyCents } from '~/features/pricing/plans';
import { exact } from '~/features/time';
import { useViewer } from '~/hooks/useViewer';
import { openExternalUrl } from '~/platform/runtime';
import { ApiError, billing, type BillingState } from '~/sync/api';

import styles from './BillingSettings.module.css';

/** The plan's name as a name, not as the enum the wire carries. */
const PLAN_LABELS: Readonly<Record<string, string>> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/** How a subscription status reads to somebody who is not an accountant. */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Payment failed',
  canceled: 'Cancelled',
  paused: 'Paused',
};

export function BillingSettings() {
  const viewer = useViewer();
  const isAdmin = viewer !== null && (viewer.role === 'owner' || viewer.role === 'admin');

  const [state, setState] = useState<BillingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    billing
      .state()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof ApiError ? cause.message : 'Could not read billing.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  /**
   * Sends the viewer to Stripe.
   *
   * Minted per click rather than rendered into an href: the URL is single-use and expires,
   * so a link left on the page would be dead for whoever clicked it an hour later.
   */
  const go = useCallback(async (open: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      openExternalUrl(await open());
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Stripe could not be reached.');
    } finally {
      // `finally`, not the catch alone. `openExternalUrl` hands off to a new tab or to the
      // desktop shell and resolves nothing, so clearing `busy` only on failure left every
      // button on this page permanently dead the moment one of them worked — and a reload
      // was the only cure.
      setBusy(false);
    }
  }, []);

  if (!isAdmin) {
    return (
      <SettingsPage title="Billing">
        <SettingsSection>
          <SettingsRow>
            <p className={styles.note}>Only a workspace administrator can see billing.</p>
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
    );
  }

  if (loading) {
    return (
      <SettingsPage title="Billing">
        <SettingsSection>
          <SettingsRow>
            <div className={styles.loading}>
              <Spinner />
            </div>
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
    );
  }

  const plan = state?.plan ?? 'free';
  const paid = plan === 'pro' || plan === 'enterprise';

  if (state?.enabled === false) {
    /* Self-hosted, or a cloud deployment with no Stripe credentials. Saying so is the
       whole message: there is nothing to buy here and no button that would work. */
    return (
      <SettingsPage title="Billing" error={error ?? undefined}>
        <SettingsSection>
          <SettingsRow>
            <p className={styles.note}>
              This server has no payment provider configured, so there is nothing to buy. Every
              feature the plan allows is already on.
            </p>
          </SettingsRow>
        </SettingsSection>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="Billing" error={error ?? undefined}>
      <SettingsSection
        title="Plan"
        // The lapse is the section's own failure: it is about the plan on this card, and the
        // portal button beside the heading is the way out of it.
        error={
          state?.lapsed === true
            ? 'A payment has failed and the plan has lapsed. Everything is still readable; changes that need the plan are paused until billing is current.'
            : undefined
        }
        actions={
          state?.canManage === true ? (
            <Button loading={busy} onClick={() => void go(() => billing.portal())}>
              Manage billing
            </Button>
          ) : undefined
        }
      >
        <SettingsRow label="Plan">
          <span className={styles.value}>{PLAN_LABELS[plan] ?? plan}</span>
        </SettingsRow>
        <SettingsRow label="People">
          <span className={styles.value}>
            {state?.seatsUsed ?? 0}
            {state?.seatsPaid == null ? null : ` of ${state.seatsPaid} billed`}
          </span>
        </SettingsRow>
        {state?.hasSubscription !== true ? null : (
          <SettingsRow label="Status">
            <span className={styles.value}>{STATUS_LABELS[state.status] ?? state.status}</span>
          </SettingsRow>
        )}
        {state?.currentPeriodEnd == null ? null : (
          <SettingsRow label={state.status === 'canceled' ? 'Access until' : 'Renews'}>
            <span className={styles.value}>{exact(state.currentPeriodEnd)}</span>
          </SettingsRow>
        )}
      </SettingsSection>

      {paid ? null : (
        <SettingsSection
          title="Upgrade"
          description={`Pro is ${formatEur(PRO_MONTHLY_CENTS)} per person per month, or ${formatEur(annualMonthlyCents())} a month with the year paid up front. Seats are billed at the ${String(state?.seatsUsed ?? 0)} people in this workspace today.`}
        >
          <SettingsRow>
            <div className={styles.actions}>
              <Button
                variant="primary"
                loading={busy}
                onClick={() => void go(() => billing.checkout('monthly'))}
              >
                Upgrade to Pro
              </Button>
              <Button loading={busy} onClick={() => void go(() => billing.checkout('yearly'))}>
                Pay yearly
              </Button>
            </div>
          </SettingsRow>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
