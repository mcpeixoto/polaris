/**
 * What this workspace's plan permits, and what to say when it does not.
 *
 * The rule the administration screens follow is that a gated control is **disabled with a
 * reason**, never hidden. A hidden feature is a support ticket — somebody read the pricing
 * page, cannot find the button, and asks where it went; a disabled one that names the plan
 * is the only upgrade prompt the product needs, and it is honest about what is missing.
 *
 * Two sources, deliberately, and the split is the whole of this file:
 *
 *   **The workspace's own facts** — which plan, any seat override, whether billing has
 *   lapsed — are read from the replica. They arrive with the bootstrap, they are already on
 *   screen before the first frame, and a screen that waited on the network to tell somebody
 *   which plan they are on would show a settings page that reflows once the answer lands.
 *
 *   **The feature matrix** — private teams, custom views, API keys, SSO, the audit log, and
 *   the plan's default seat count — comes from the server, because it is Go and not data:
 *   which plan may use which feature changes with a release. Restating the matrix here would
 *   be a second definition of policy that disagrees with the first one the week either
 *   changes, and the disagreement is silent.
 *
 * That second half can be absent — offline, or a deployment whose `Workspace.entitlements`
 * resolver is not wired (see the note in the report accompanying these screens). When it is,
 * `features` is null and a caller must NOT treat that as "denied": an unknown answer means
 * the control stays live and the server gets to refuse it with its own message. Guessing
 * "no" would lock people out of features they are paying for, which is a worse failure than
 * letting a request be rejected.
 */

import { useCallback, useEffect, useState } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import { gql } from '~/sync/api';
import { ENTITLEMENTS_QUERY } from './operations';

/** The plan's numeric limits use `null` for "no ceiling", matching the wire's nullable Int. */
export type Limit = number | null;

/** The facts about this particular workspace, as opposed to about its plan. */
export interface PlanFacts {
  readonly plan: string;
  /** Seats the plan or an override allows. Null is unlimited, or not yet known. */
  readonly seatLimit: Limit;
  readonly seatsUsed: number;
  /** A paid plan whose billing has failed. Reads keep working; gated writes do not. */
  readonly lapsed: boolean;
}

/** What the plan includes. Only the server can answer this; see the note above. */
export interface FeatureMatrix {
  readonly teamLimit: Limit;
  readonly historyDays: Limit;
  readonly privateTeams: boolean;
  readonly customViews: boolean;
  readonly apiKeys: boolean;
  readonly sso: boolean;
  readonly auditLog: boolean;
}

export interface Entitlements {
  readonly facts: PlanFacts;
  /** Null while the answer is in flight, and for as long as it cannot be had. */
  readonly features: FeatureMatrix | null;
  /** True once the server's own numbers are in hand rather than the replica's. */
  readonly confirmed: boolean;
  /** Re-asks. Removing somebody frees a seat, and the count on screen has to move. */
  reload(): void;
}

/** The features a screen in this milestone can gate on. */
export type GatedFeature = 'apiKeys' | 'privateTeams' | 'customViews' | 'sso' | 'auditLog';

/** How each one is named to a person. The wire's key is not a phrase anybody reads. */
const FEATURE_LABELS: Readonly<Record<GatedFeature, string>> = {
  apiKeys: 'API keys',
  privateTeams: 'Private teams',
  customViews: 'Custom views',
  sso: 'Single sign-on',
  auditLog: 'The audit log',
};

/**
 * The plan's name as a person reads it.
 *
 * Mirrors `entitlement.Plan.Label` on the server rather than capitalising the column value,
 * for the reason that function gives: `self_hosted` title-cased is "Self_hosted", in a
 * sentence a customer sees.
 */
export function planLabel(plan: string): string {
  switch (plan) {
    case 'free':
      return 'Free';
    case 'pro':
      return 'Pro';
    case 'enterprise':
      return 'Enterprise';
    case 'self_hosted':
      return 'self-hosted';
    default:
      return plan;
  }
}

/**
 * Why a feature-gated control cannot be used, or null when it can.
 *
 * The message names the plan, because "not available on your plan" leaves the reader to go
 * and find out which plan that is, and the answer is on the screen they are already looking
 * at.
 */
export function featureBlock(entitlements: Entitlements, feature: GatedFeature): string | null {
  const { features, facts } = entitlements;
  // Unknown is not denied. See the note at the top of this file.
  if (features !== null && !features[feature]) {
    return `${FEATURE_LABELS[feature]} are not part of the ${planLabel(facts.plan)} plan.`;
  }
  return lapsedBlock(facts);
}

/**
 * Why a seat cannot be taken, or null when one is free.
 *
 * Checked before the invitation rather than after it because the server counts seats inside
 * the transaction that would consume one, and a refusal that arrives after somebody has
 * typed an address and chosen two teams is a form they have to fill in twice.
 */
export function seatBlock(entitlements: Entitlements): string | null {
  const { facts } = entitlements;
  const lapse = lapsedBlock(facts);
  if (lapse !== null) return lapse;
  if (facts.seatLimit === null || facts.seatsUsed < facts.seatLimit) return null;
  return `The ${planLabel(facts.plan)} plan includes ${facts.seatLimit} ${
    facts.seatLimit === 1 ? 'seat' : 'seats'
  } and all of them are in use. Suspend somebody to free one, or move to a larger plan.`;
}

/** A lapsed plan stops gated writes and nothing else. Reads keep working, always. */
function lapsedBlock(facts: PlanFacts): string | null {
  if (!facts.lapsed) return null;
  return `Billing for the ${planLabel(facts.plan)} plan has lapsed, so changes like this one are paused. Your work is still here and still readable.`;
}

/** How the seat count reads in a sentence, with or without a ceiling to compare against. */
export function seatSummary(facts: PlanFacts): string {
  const used = `${facts.seatsUsed} ${facts.seatsUsed === 1 ? 'seat' : 'seats'}`;
  if (facts.seatLimit === null) return `${used} in use on the ${planLabel(facts.plan)} plan.`;
  return `${facts.seatsUsed} of ${facts.seatLimit} seats in use on the ${planLabel(facts.plan)} plan.`;
}

interface EntitlementsResponse {
  readonly workspace: {
    readonly plan: string;
    readonly seatLimit: number | null;
    readonly planLapsedAt: string | null;
    readonly entitlements: {
      readonly plan: string;
      readonly seatLimit: number | null;
      readonly seatsUsed: number;
      readonly teamLimit: number | null;
      readonly historyDays: number | null;
      readonly privateTeams: boolean;
      readonly customViews: boolean;
      readonly apiKeys: boolean;
      readonly sso: boolean;
      readonly auditLog: boolean;
      readonly lapsed: boolean;
    };
  };
}

export function useEntitlements(): Entitlements {
  /**
   * The replica's answer: available synchronously, correct about this workspace, and silent
   * about what the plan includes.
   *
   * The seat count mirrors the server's one seat query — humans, active, not archived —
   * because those three conditions are what suspension exists to change: suspending
   * somebody is how an admin frees a seat, and a count that ignored `status` would tell
   * them it had not worked.
   */
  const local = useLiveQuery(
    (store) => {
      const workspace = [...store.workspaces.values()][0];
      let seatsUsed = 0;
      for (const user of store.users.values()) {
        if (user.kind === 'human' && user.status === 'active' && user.archivedAt === undefined) {
          seatsUsed++;
        }
      }
      return {
        plan: workspace?.plan ?? 'free',
        seatLimit: workspace?.seatLimit ?? null,
        lapsed: workspace?.planLapsedAt !== undefined,
        seatsUsed,
      };
    },
    ['workspace', 'user'],
  );

  const [server, setServer] = useState<EntitlementsResponse['workspace'] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    gql<EntitlementsResponse>(ENTITLEMENTS_QUERY)
      .then((data) => {
        if (live) setServer(data.workspace);
      })
      .catch(() => {
        // Deliberately swallowed. The screens still work from the replica's facts, and a
        // banner reading "could not load entitlements" would be an error message about an
        // implementation detail in place of a settings page.
        if (live) setServer(null);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  if (server === null) {
    return {
      facts: {
        plan: local.plan,
        seatLimit: local.seatLimit,
        seatsUsed: local.seatsUsed,
        lapsed: local.lapsed,
      },
      features: null,
      confirmed: false,
      reload,
    };
  }

  const answer = server.entitlements;
  return {
    facts: {
      plan: answer.plan,
      seatLimit: answer.seatLimit,
      seatsUsed: answer.seatsUsed,
      lapsed: answer.lapsed,
    },
    features: {
      teamLimit: answer.teamLimit,
      historyDays: answer.historyDays,
      privateTeams: answer.privateTeams,
      customViews: answer.customViews,
      apiKeys: answer.apiKeys,
      sso: answer.sso,
      auditLog: answer.auditLog,
    },
    confirmed: true,
    reload,
  };
}
