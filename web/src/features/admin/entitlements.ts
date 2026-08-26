/**
 * What this workspace's plan permits, and what to say when it does not.
 *
 * The rule the administration screens follow is that a gated control is **disabled with a
 * reason**, never hidden. A hidden feature is a support ticket — somebody read the pricing
 * page, cannot find the button, and asks where it went; a disabled one that names the plan
 * is the only upgrade prompt the product needs, and it is honest about what is missing.
 *
 * A reason on its own was still half an answer. Every refusal here now carries a destination
 * too — `/pricing`, and only when going there would actually lift it — because "move to a
 * larger plan" with nothing to click leaves somebody stopped mid-task to go and find the
 * price list themselves, from a settings screen that does not link to one. `PlanBlock`
 * renders the pair. Nothing is hidden either way.
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

import { PRICING_PATH } from '~/features/pricing/plans';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError, gql } from '~/sync/api';
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
  readonly subTeams: boolean;
  readonly multiLevelSubTeams: boolean;
  readonly customViews: boolean;
  readonly apiKeys: boolean;
  readonly sso: boolean;
  readonly auditLog: boolean;
  readonly slas: boolean;
  readonly slack: boolean;
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
export type GatedFeature =
  'apiKeys' | 'privateTeams' | 'subTeams' | 'customViews' | 'sso' | 'auditLog' | 'slas' | 'slack';

/** How each one is named to a person. The wire's key is not a phrase anybody reads. */
const FEATURE_LABELS: Readonly<Record<GatedFeature, string>> = {
  apiKeys: 'API keys',
  privateTeams: 'Private teams',
  subTeams: 'Sub-teams',
  customViews: 'Custom views',
  sso: 'Single sign-on',
  auditLog: 'The audit log',
  slas: 'SLAs',
  slack: 'Slack',
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
 * A refusal, as a screen renders it: the sentence, and somewhere to go about it.
 *
 * The second half is the point. Every upsell in this file used to end in prose with no
 * destination — "move to a larger plan" with nothing to click — which leaves somebody who
 * has just been stopped to go and find the pricing themselves, from inside a settings screen
 * that does not link to it. `PlanBlock` renders this shape; the reason is always shown and
 * the control stays disabled with it, per the rule at the top of this file.
 */
export interface Block {
  readonly reason: string;
  /**
   * Where to send the reader, or null when sending them anywhere would be a lie.
   *
   * Null is not the unusual case. A negotiated seat override is not lifted by upgrading, a
   * self-hosted install has no billing screen to visit, and a lapse needs billing details
   * rather than a bigger plan. Offering "see plans" to any of those is an upsell that does
   * not work, and the reader finds that out only after following it.
   */
  readonly upgrade: { readonly label: string; readonly to: string } | null;
}

/** The one upgrade destination. Spelled once so no screen invents a second path. */
const SEE_PLANS = { label: 'Compare plans', to: PRICING_PATH } as const;

/**
 * Why a feature-gated control cannot be used, or null when it can.
 *
 * The message names the plan, because "not available on your plan" leaves the reader to go
 * and find out which plan that is, and the answer is on the screen they are already looking
 * at.
 */
export function featureBlock(entitlements: Entitlements, feature: GatedFeature): Block | null {
  const { features, facts } = entitlements;
  // Unknown is not denied. See the note at the top of this file.
  if (features !== null && !features[feature]) {
    return {
      reason: `${FEATURE_LABELS[feature]} are not part of the ${planLabel(facts.plan)} plan.`,
      // A self-hosted install buys a licence key, not a plan, and has no billing screen to
      // land on. Sending one to the cloud price list is sending them somewhere that cannot
      // help — the server says the same thing in `denyFeature`.
      upgrade: facts.plan === 'self_hosted' ? null : SEE_PLANS,
    };
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
export function seatBlock(entitlements: Entitlements): Block | null {
  const { facts } = entitlements;
  const lapse = lapsedBlock(facts);
  if (lapse !== null) return lapse;
  if (facts.seatLimit === null || facts.seatsUsed < facts.seatLimit) return null;
  return {
    reason: `The ${planLabel(facts.plan)} plan includes ${facts.seatLimit} ${
      facts.seatLimit === 1 ? 'seat' : 'seats'
    } and all of them are in use. Suspend somebody to free one, or move to a larger plan.`,
    upgrade: facts.plan === 'self_hosted' ? null : SEE_PLANS,
  };
}

/** A lapsed plan stops gated writes and nothing else. Reads keep working, always. */
function lapsedBlock(facts: PlanFacts): Block | null {
  if (!facts.lapsed) return null;
  return {
    reason: `Billing for the ${planLabel(facts.plan)} plan has lapsed, so changes like this one are paused. Your work is still here and still readable.`,
    // Deliberately no destination. What fixes a lapse is billing details, not a bigger plan,
    // and the server draws the same distinction in `denyFeature` for the same reason: telling
    // somebody to upgrade the plan they already pay for is how a support thread starts.
    upgrade: null,
  };
}

/**
 * A refusal the server made, as the same Block a client-side check produces.
 *
 * The two paths exist because the client cannot always know first — it does not hold the
 * feature matrix offline, and the seat count it compares against is a replica that can be one
 * delta behind the transaction that consumed the last seat. So a request goes out, comes back
 * PLAN_LIMIT, and the screen has to say something. Before this, that something was
 * `error.message` in a red box: a sentence with no destination, from a refusal that had
 * always known which plan would lift it.
 *
 * Returns null for anything that is not an entitlement refusal, so a caller can use it as the
 * first branch of its error handler and fall through to its own wording.
 */
export function refusalOf(error: unknown): Block | null {
  if (!(error instanceof ApiError) || error.code !== 'PLAN_LIMIT') return null;
  const paywall = error.paywall;
  return {
    reason: error.message,
    // `needsPlan` absent is the server saying no plan lifts this — an override, a lapse, a
    // self-hosted install. It is not "we forgot to say", and rendering a link anyway would be
    // this screen contradicting the sentence printed directly above it. A payload with no
    // structure at all lands here too, which is right: an older API cannot promise a
    // destination, so none is offered.
    upgrade: paywall?.needsPlan === undefined || paywall.lapsed === true ? null : SEE_PLANS,
  };
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
      readonly subTeams: boolean;
      readonly multiLevelSubTeams: boolean;
      readonly customViews: boolean;
      readonly apiKeys: boolean;
      readonly sso: boolean;
      readonly auditLog: boolean;
      readonly slas: boolean;
      readonly slack: boolean;
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
      subTeams: answer.subTeams,
      multiLevelSubTeams: answer.multiLevelSubTeams,
      customViews: answer.customViews,
      apiKeys: answer.apiKeys,
      sso: answer.sso,
      auditLog: answer.auditLog,
      slas: answer.slas,
      slack: answer.slack,
    },
    confirmed: true,
    reload,
  };
}
