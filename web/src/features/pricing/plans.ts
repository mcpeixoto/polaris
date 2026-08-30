/**
 * What each plan costs and what it includes — the one place the public answer lives.
 *
 * Two audiences read this module and that is why it is not inside the view. `/pricing`
 * renders it as a table, and `features/admin/entitlements.ts` points a refusal at it so a
 * paywall can name a destination instead of ending in "move to a larger plan" with nothing
 * to click. A second copy of the price in the upsell is a second copy that goes stale on the
 * day the first one changes.
 *
 * ## The numbers here are not the enforcement
 *
 * `services/internal/entitlement/entitlement.go` owns the matrix the server actually
 * enforces; this file is the packaging as a customer reads it. They can disagree, and the
 * disagreement is invisible until somebody hits a ceiling the page told them they did not
 * have — so `plans.test.ts` reads the Go matrix and asserts the Free caps quoted here are
 * the caps the server enforces. When that test fails, the page is wrong and the server is
 * right.
 *
 * ## Money is integer cents
 *
 * Every amount below is cents, and the discount is applied with `Math.round` over integers,
 * because euros as floats are wrong at exactly the sizes a price list uses: `3 * 0.8` is
 * `2.4000000000000004` in IEEE-754 and `4.9 * 0.8` is `3.9200000000000004`. Those render
 * verbatim into a page a customer is deciding from. Formatting is the last step and it
 * happens once, in `formatEur`.
 */

/** Where a paywall sends somebody. Declared here so no caller has to spell the path. */
export const PRICING_PATH = '/pricing';

/** Cloud Pro, per user, per month, billed monthly. */
export const PRO_MONTHLY_CENTS = 400;

/** Paying for a year up front. Whole percent — a fractional discount is a marketing bug. */
export const ANNUAL_DISCOUNT_PERCENT = 20;

/**
 * The per-month price when the year is paid up front.
 *
 * Rounded to the cent rather than truncated: truncation quietly hands the customer a
 * fraction of a cent per seat per month, which is not a discount anybody agreed to and does
 * not reconcile against an invoice.
 */
export function annualMonthlyCents(
  monthlyCents: number = PRO_MONTHLY_CENTS,
  discountPercent: number = ANNUAL_DISCOUNT_PERCENT,
): number {
  return Math.round((monthlyCents * (100 - discountPercent)) / 100);
}

/**
 * The per-year price when the year is paid up front.
 *
 * Twelve times the discounted month rather than the discounted year, so the figure on the
 * page is the figure twelve invoices add up to. Discounting the annual total instead can
 * leave the two differing by a cent, and a cent is enough for somebody to write in about.
 */
export function annualYearlyCents(
  monthlyCents: number = PRO_MONTHLY_CENTS,
  discountPercent: number = ANNUAL_DISCOUNT_PERCENT,
): number {
  return annualMonthlyCents(monthlyCents, discountPercent) * 12;
}

/**
 * Cents as a price a person reads.
 *
 * Whole euros lose the decimals — "€4" and not "€4.00" — because the trailing zeros in a
 * headline price read as precision that is not there, and the table beside it has to stay
 * scannable at 375px.
 */
export function formatEur(cents: number): string {
  if (cents % 100 === 0) return `€${cents / 100}`;
  return `€${(cents / 100).toFixed(2)}`;
}

/** The four things somebody can be on. Ids match `entitlement.Plan` on the server. */
export type PlanId = 'self_hosted' | 'free' | 'pro' | 'enterprise';

/** Cloud plans in the order they are sold, which is the order the table columns run. */
export const PLAN_ORDER: readonly PlanId[] = ['self_hosted', 'free', 'pro', 'enterprise'];

export interface PlanSummary {
  readonly id: PlanId;
  /** The name as it is sold. Not `entitlement.planLabel`, which names a plan in a sentence. */
  readonly name: string;
  /** The headline price, already formatted. Null when there is no number to show. */
  readonly price: string | null;
  /** What the price is per. Empty when `price` is null. */
  readonly per: string;
  /** One line on who this is for. */
  readonly blurb: string;
  /** The button under the column, and where it goes. */
  readonly action: { readonly label: string; readonly to: string };
  /**
   * Whether a reader can start this plan from the page today.
   *
   * `'now'` is the ordinary case. `'waitlist'` says the price is decided and the plan is
   * enforced by the server, but the checkout that would take the money does not exist yet —
   * `services/internal/domain/billing.go` has the entry point a payment provider would call
   * and nothing in production calls it. A "Get started" button on a plan nobody can buy sends
   * somebody to a sign-up that quietly hands them a different plan, so a plan that is not
   * purchasable says so and asks them to write instead.
   */
  readonly availability: 'now' | 'waitlist';
  /** Shown under the blurb when there is something the price alone does not say. */
  readonly note?: string;
}

/**
 * The cell states a comparison table can hold.
 *
 * `coming` exists because the alternative was a tick, and a tick on a row somebody is about
 * to pay for is a promise. SSO, SCIM and the audit log are the Enterprise pitch and none of
 * them is in the hosted product today.
 */
export type Cell =
  { readonly kind: 'yes' | 'no' | 'coming' } | { readonly kind: 'text'; readonly text: string };

const YES: Cell = { kind: 'yes' };
const NO: Cell = { kind: 'no' };
const COMING: Cell = { kind: 'coming' };
const text = (value: string): Cell => ({ kind: 'text', text: value });

/** How each cell state reads aloud. The glyph in the table is decorative and hidden. */
export const CELL_LABELS: Readonly<Record<'yes' | 'no' | 'coming', string>> = {
  yes: 'Included',
  no: 'Not included',
  coming: 'Coming',
};

export interface ComparisonRow {
  readonly label: string;
  /** Why this row matters, when the label alone does not say it. */
  readonly note?: string;
  readonly cells: Readonly<Record<PlanId, Cell>>;
}

/** The Free tier's ceilings, quoted from the server's matrix. `plans.test.ts` proves it. */
export const FREE_SEATS = 5;
export const FREE_TEAMS = 2;
export const FREE_HISTORY_DAYS = 90;

const UNLIMITED = 'Unlimited';

export const PLANS: readonly PlanSummary[] = [
  {
    id: 'self_hosted',
    name: 'Self-hosted',
    price: formatEur(0),
    per: 'forever',
    blurb: 'The whole tracker under the AGPL. You bring the machine.',
    action: { label: 'Self-hosting notes', to: '#self-host' },
    availability: 'now',
  },
  {
    id: 'free',
    name: 'Cloud Free',
    price: formatEur(0),
    per: 'up to 5 people',
    blurb: 'A real workspace on our hardware, free for up to five people.',
    action: { label: 'Get started', to: '/signup' },
    availability: 'now',
  },
  {
    id: 'pro',
    name: 'Cloud Pro',
    price: formatEur(PRO_MONTHLY_CENTS),
    per: 'per user / month',
    blurb: 'Our hardware, and no ceiling on people, teams or history.',
    action: {
      label: 'Talk to us',
      to: 'mailto:hello@peixotolabs.com?subject=Polaris%20Cloud%20Pro',
    },
    availability: 'waitlist',
    note: 'Checkout is not open yet. Write to us and we will arrange it directly.',
  },
  {
    id: 'enterprise',
    name: 'Cloud Enterprise',
    price: null,
    per: '',
    blurb: 'For teams with a procurement and security review. Tell us what it asks for.',
    action: {
      label: 'Contact us',
      to: 'mailto:hello@peixotolabs.com?subject=Polaris%20Enterprise',
    },
    availability: 'now',
  },
];

/**
 * The comparison, row by row.
 *
 * Ordered by what somebody choosing actually asks: how many of us, how many teams, how far
 * back, then the features that separate the tiers. Rows where every plan is identical are
 * still here — "API keys, everywhere" is the answer to a question people ask, and a row that
 * is all ticks is cheaper to read than a footnote saying it would have been.
 */
export const COMPARISON: readonly ComparisonRow[] = [
  {
    label: 'People',
    cells: {
      self_hosted: text(UNLIMITED),
      free: text(`Up to ${FREE_SEATS}`),
      pro: text(UNLIMITED),
      enterprise: text(UNLIMITED),
    },
  },
  {
    label: 'Teams',
    cells: {
      self_hosted: text(UNLIMITED),
      free: text(String(FREE_TEAMS)),
      pro: text(UNLIMITED),
      enterprise: text(UNLIMITED),
    },
  },
  {
    label: 'History',
    note: 'How far back the activity and archive go.',
    cells: {
      self_hosted: text(UNLIMITED),
      free: text(`${FREE_HISTORY_DAYS} days`),
      pro: text(UNLIMITED),
      enterprise: text(UNLIMITED),
    },
  },
  {
    label: 'Saved views',
    note: 'Saved filters are how the tracker is used at all, so they are never gated.',
    cells: { self_hosted: YES, free: YES, pro: YES, enterprise: YES },
  },
  {
    label: 'API keys',
    note: 'Free is rate-limited, not walled.',
    cells: { self_hosted: YES, free: YES, pro: YES, enterprise: YES },
  },
  {
    label: 'Slack',
    cells: { self_hosted: YES, free: YES, pro: YES, enterprise: YES },
  },
  {
    label: 'Private teams',
    cells: { self_hosted: YES, free: NO, pro: YES, enterprise: YES },
  },
  {
    label: 'Sub-teams',
    cells: { self_hosted: YES, free: NO, pro: YES, enterprise: YES },
  },
  {
    label: 'Nested sub-teams',
    cells: { self_hosted: YES, free: NO, pro: NO, enterprise: YES },
  },
  {
    label: 'SLAs',
    cells: { self_hosted: YES, free: NO, pro: YES, enterprise: YES },
  },
  {
    label: 'Single sign-on',
    cells: { self_hosted: NO, free: NO, pro: NO, enterprise: COMING },
  },
  {
    label: 'SCIM provisioning',
    cells: { self_hosted: NO, free: NO, pro: NO, enterprise: COMING },
  },
  {
    label: 'Audit log',
    cells: { self_hosted: NO, free: NO, pro: NO, enterprise: COMING },
  },
];

/** The plan a `PlanId` names, or null for a string the wire invented. */
export function planSummary(id: string): PlanSummary | null {
  return PLANS.find((plan) => plan.id === id) ?? null;
}

/**
 * The plan as the page should render it, given whether this server can actually sell.
 *
 * The static entry above is written for the pessimistic case, because that is the one that
 * cannot lie: a page that assumed checkout existed would put "Get started" on Cloud Pro on
 * every self-hosted deployment and on the hosted one until the day Stripe keys are set. When
 * `GET /billing/config` says billing is live, the waitlist wording is replaced by the
 * ordinary sign-up: the buyer makes an account, and the upgrade itself happens in
 * Settings → Billing, where the workspace whose seats are being bought is unambiguous.
 */
export function planAsSold(plan: PlanSummary, billingLive: boolean): PlanSummary {
  if (!billingLive || plan.availability !== 'waitlist') {
    return plan;
  }
  const { note: _note, ...rest } = plan;
  return { ...rest, availability: 'now', action: { label: 'Get started', to: '/signup' } };
}
