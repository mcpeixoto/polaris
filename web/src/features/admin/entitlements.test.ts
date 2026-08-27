import { describe, expect, it } from 'vitest';

import { PRICING_PATH } from '~/features/pricing/plans';
import { ApiError } from '~/sync/api';

import { featureBlock, refusalOf, seatBlock, type Entitlements } from './entitlements';

/**
 * A refusal has to say why and, when there is one, where to go about it.
 *
 * Both halves are load-bearing and they fail in opposite directions. A missing reason hides
 * a control with no explanation, which is the rule at the top of entitlements.ts. A destination
 * offered where none exists — a lapse, a negotiated override, a self-hosted install — sends
 * somebody to a price list that cannot help, and they find that out only after following it.
 */

function entitlementsFor(facts: Partial<Entitlements['facts']>): Entitlements {
  return {
    facts: { plan: 'free', seatLimit: 5, seatsUsed: 1, lapsed: false, ...facts },
    features: {
      teamLimit: 2,
      historyDays: 90,
      privateTeams: false,
      subTeams: false,
      multiLevelSubTeams: false,
      customViews: true,
      apiKeys: true,
      sso: false,
      auditLog: false,
      slas: false,
      slack: true,
    },
    confirmed: true,
    reload: () => {},
  };
}

describe('featureBlock', () => {
  it('names the plan and points at the price list', () => {
    const block = featureBlock(entitlementsFor({}), 'privateTeams');
    expect(block?.reason).toContain('Free');
    expect(block?.upgrade?.to).toBe(PRICING_PATH);
  });

  it('offers nothing when the plan includes the feature', () => {
    expect(featureBlock(entitlementsFor({}), 'customViews')).toBeNull();
  });

  /**
   * Unknown is not denied. A client that has not heard from the server — offline, or a
   * deployment whose resolver is not wired — must leave the control live and let the server
   * refuse it, or people are locked out of what they are paying for.
   */
  it('does not refuse on an answer it has not got', () => {
    const unknown: Entitlements = { ...entitlementsFor({}), features: null };
    expect(featureBlock(unknown, 'sso')).toBeNull();
  });

  it('sends a self-hosted install nowhere, because it has no billing screen', () => {
    const block = featureBlock(entitlementsFor({ plan: 'self_hosted' }), 'sso');
    expect(block?.reason).toBeTruthy();
    expect(block?.upgrade).toBeNull();
  });

  it('treats a lapse as billing rather than as an upsell', () => {
    // Slack, which the matrix above includes — so the only reason it can be missing is the
    // lapse. Telling somebody to upgrade the plan they already pay for is how a support
    // thread starts, so this gets the sentence and deliberately no link. The server draws the
    // same distinction in `denyFeature`, and in the same order: a feature the plan does not
    // include is a packaging refusal even when billing has also lapsed.
    const block = featureBlock(entitlementsFor({ plan: 'pro', lapsed: true }), 'slack');
    expect(block?.reason).toContain('lapsed');
    expect(block?.upgrade).toBeNull();
  });
});

describe('seatBlock', () => {
  it('says nothing while a seat is free', () => {
    expect(seatBlock(entitlementsFor({ seatsUsed: 4, seatLimit: 5 }))).toBeNull();
  });

  it('offers the price list once the seats are gone', () => {
    const block = seatBlock(entitlementsFor({ seatsUsed: 5, seatLimit: 5 }));
    expect(block?.reason).toContain('5 seats');
    expect(block?.upgrade?.to).toBe(PRICING_PATH);
  });

  it('never blocks a plan with no ceiling', () => {
    expect(seatBlock(entitlementsFor({ seatLimit: null, seatsUsed: 900 }))).toBeNull();
  });
});

describe('refusalOf', () => {
  it('ignores anything that is not an entitlement refusal', () => {
    expect(refusalOf(new ApiError('VALIDATION', 'that email is not an address'))).toBeNull();
    expect(refusalOf(new Error('boom'))).toBeNull();
    expect(refusalOf(undefined)).toBeNull();
  });

  /**
   * The whole point of the wiring. The server has always known which plan lifts a refusal;
   * until the structured payload crossed the wire, the client had a sentence and a code, and
   * the only way to render a specific paywall was to string-match the message.
   */
  it('turns a structured 402 into a destination', () => {
    const error = new ApiError('PLAN_LIMIT', 'Private teams require the Pro plan.', undefined, {
      plan: 'free',
      needsPlan: 'pro',
      feature: 'private_teams',
    });
    const block = refusalOf(error);
    expect(block?.reason).toBe('Private teams require the Pro plan.');
    expect(block?.upgrade?.to).toBe(PRICING_PATH);
  });

  it('carries the server sentence rather than inventing one', () => {
    const error = new ApiError(
      'PLAN_LIMIT',
      'The Free plan includes 2 teams. Upgrade to Pro to add more.',
      undefined,
      { plan: 'free', needsPlan: 'pro', limit: 'teams', cap: 2 },
    );
    expect(refusalOf(error)?.reason).toContain('2 teams');
  });

  it('offers no link when the server names no plan that would lift it', () => {
    // A negotiated seat override is not lifted by upgrading, and the server says so by
    // leaving needsPlan empty. A link here would contradict the sentence above it.
    const error = new ApiError(
      'PLAN_LIMIT',
      'This workspace is limited to 3 members. Contact us to raise the limit.',
      undefined,
      { plan: 'enterprise', limit: 'seats', cap: 3 },
    );
    expect(refusalOf(error)?.upgrade).toBeNull();
  });

  it('sends a lapse to billing rather than to the price list', () => {
    const error = new ApiError('PLAN_LIMIT', 'Your Pro subscription has lapsed.', undefined, {
      plan: 'pro',
      needsPlan: 'enterprise',
      lapsed: true,
    });
    expect(refusalOf(error)?.upgrade).toBeNull();
  });

  /**
   * An older API sends the code and the message and none of the structure. That must degrade
   * to the sentence, not to a guess: rendering "Compare plans" on a refusal the server never
   * said was liftable is the same wrong link, arrived at by assuming instead of by reading.
   */
  it('degrades to the sentence when the payload carries no structure', () => {
    const block = refusalOf(new ApiError('PLAN_LIMIT', 'That is not available.'));
    expect(block?.reason).toBe('That is not available.');
    expect(block?.upgrade).toBeNull();
  });
});
