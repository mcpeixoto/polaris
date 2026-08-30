/**
 * Public pricing page.
 *
 * Routed for everybody — anonymous at `/pricing`, and signed in at the same path, outside
 * `AppShell`. Both audiences are real: somebody deciding whether to sign up, and somebody
 * already inside who has just been refused something and followed the link on the refusal.
 * That second path is the reason this is a route rather than a section of the landing page:
 * `features/admin/entitlements.ts` points a paywall here, and a paywall whose destination is
 * an anchor on a marketing page nobody signed-in can reach is a dead link.
 *
 * The numbers are not written here. `features/pricing/plans.ts` owns them, and its test reads
 * the server's matrix to prove the Free caps on this page are the caps the server enforces —
 * because a pricing page that promises five seats over a product that grants four is a lie
 * nothing in the system would ever report.
 *
 * ## The table is a table
 *
 * Real `<table>`, real `<th scope>`, one row per capability. A grid of divs reads to a screen
 * reader as a wall of ticks with nothing saying which plan each belongs to — the entire point
 * of a comparison is the association between the cell and its two headers, and only table
 * semantics carry it. The tick glyphs are `aria-hidden` with the word beside them, because
 * "✓" is announced as anything from "check mark" to silence depending on the reader.
 *
 * At 375px five columns do not fit, so the table lives in a labelled, focusable scroll region
 * — the pattern that keeps a horizontally scrolling area reachable without a mouse — and the
 * plan cards above it carry the price and the call to action, so the decision can be made
 * without scrolling sideways at all.
 */

import { Link } from 'react-router';

import {
  CELL_LABELS,
  COMPARISON,
  formatEur,
  annualMonthlyCents,
  annualYearlyCents,
  ANNUAL_DISCOUNT_PERCENT,
  PLAN_ORDER,
  PLANS,
  PRO_MONTHLY_CENTS,
  type Cell,
} from '~/features/pricing/plans';
import { isSignedIn } from '~/sync/api';

import styles from './Pricing.module.css';

const SOURCE = 'https://github.com/mcpeixoto/polaris';
const SELF_HOST_DOC =
  'https://github.com/mcpeixoto/polaris/blob/main/docs/05-infrastructure/11-self-hosting.md';

export function Pricing() {
  /**
   * Read once, at render, and not subscribed to.
   *
   * This page has no live data on it. Its only use for the session is deciding whether the
   * header offers "Sign in" or the way back into the workspace — and a signed-in reader who
   * arrived from a paywall must not be offered a sign-in form, which is a dead end that looks
   * like an error.
   */
  const signedIn = isSignedIn();

  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>

      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link to="/" className={styles.wordmark}>
            Polaris
          </Link>
          <div className={styles.navActions}>
            {signedIn ? (
              <Link to="/" className={styles.cta}>
                Back to your workspace
              </Link>
            ) : (
              <>
                <Link to="/signin" className={styles.navQuiet}>
                  Sign in
                </Link>
                <Link to="/signup" className={styles.cta}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="pricing-title">
          <p className={styles.kicker}>Pricing</p>
          <h1 id="pricing-title" className={styles.heroTitle}>
            {formatEur(PRO_MONTHLY_CENTS)} a seat, or nothing at all.
          </h1>
          <p className={styles.heroLead}>
            Run it yourself under the AGPL and pay us nothing, forever — that is the whole product,
            not a trial of it. Cloud is for teams who would rather not keep a Postgres alive.
          </p>
          <p className={styles.annual}>
            Prices are per user, per month, billed monthly.{' '}
            <strong>
              Pay for a year up front and it is {formatEur(annualMonthlyCents())} a month
            </strong>{' '}
            — {ANNUAL_DISCOUNT_PERCENT}% off, {formatEur(annualYearlyCents())} per user per year.
          </p>
        </section>

        <section className={styles.plans} aria-label="Plans">
          <ul className={styles.planGrid} role="list">
            {PLANS.map((plan) => (
              <li key={plan.id} className={styles.plan}>
                <h2 className={styles.planName}>{plan.name}</h2>
                <p className={styles.planPrice}>
                  {plan.price ?? 'Contact us'}
                  {plan.per === '' ? null : <span className={styles.planPer}>{plan.per}</span>}
                </p>
                <p className={styles.planBlurb}>{plan.blurb}</p>
                {plan.note === undefined ? null : (
                  <p className={styles.planNote}>{plan.note}</p>
                )}
                {plan.action.to.startsWith('/') ? (
                  <Link to={plan.action.to} className={styles.planCta}>
                    {plan.action.label}
                  </Link>
                ) : (
                  <a
                    href={plan.action.to === '#self-host' ? SELF_HOST_DOC : plan.action.to}
                    className={styles.planCta}
                  >
                    {plan.action.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.band} aria-labelledby="compare-title">
          <div className={styles.bandHead}>
            <h2 id="compare-title" className={styles.sectionTitle}>
              What each plan includes.
            </h2>
            <p className={styles.sectionLead}>
              The rows that say <em>Coming</em> are not shipped. They are the Enterprise pitch and
              they are named here so nobody buys a tick that is not there yet.
            </p>
          </div>

          {/*
            Focusable and named, because the table scrolls sideways below about 720px and a
            scroll container that cannot be reached by keyboard is content a keyboard user
            cannot read at all. `tabIndex` on a region is the accepted way to give the
            container a tab stop without inventing a widget role.

            Labelled with its own words rather than `aria-labelledby` on the section heading:
            the <section> above already takes role="region" from being named, and two nested
            regions sharing one name is two identical entries in the landmark list with no way
            to tell which one scrolls.
          */}
          <div
            className={styles.tableWrap}
            role="region"
            aria-label="Plan comparison table"
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption className={styles.caption}>
                Capabilities by plan. Self-hosted is what the AGPL build does on your own hardware;
                the other three are our cloud.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.rowHead}>
                    Capability
                  </th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} scope="col">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className={styles.rowHead}>
                      {row.label}
                      {row.note === undefined ? null : (
                        <span className={styles.note}>{row.note}</span>
                      )}
                    </th>
                    {PLAN_ORDER.map((id) => (
                      <td key={id}>
                        <CellValue cell={row.cells[id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.band} aria-labelledby="answers-title">
          <div className={styles.bandHead}>
            <h2 id="answers-title" className={styles.sectionTitle}>
              Common questions.
            </h2>
          </div>
          <dl className={styles.answers}>
            {ANSWERS.map((answer) => (
              <div key={answer.q}>
                <dt>{answer.q}</dt>
                <dd>{answer.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={styles.ctaBand} aria-labelledby="pricing-cta-title">
          <p className={styles.kicker}>Either way</p>
          <h2 id="pricing-cta-title" className={styles.sectionTitle}>
            Start free. Move when the caps start to hurt.
          </h2>
          <p className={styles.sectionLead}>
            Cloud Free is a real workspace, not a countdown. Self-hosting is the same tracker with
            no ceiling on anything, and the export is yours in both directions.
          </p>
          <div className={styles.ctas}>
            <Link to="/signup" className={styles.cta}>
              Get started
            </Link>
            <a href={SELF_HOST_DOC} className={styles.ctaGhost}>
              Self-hosting notes
            </a>
            <a href={SOURCE} className={styles.ctaGhost}>
              Source
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link to="/" className={styles.wordmark}>
          Polaris
        </Link>
        <p>Keyboard-first issue tracking. Local replica. AGPL-3.0.</p>
        <nav aria-label="Footer">
          <Link to="/">Product</Link>
          <Link to="/signup">Get started</Link>
          <a href={SOURCE}>GitHub</a>
        </nav>
      </footer>
    </div>
  );
}

/**
 * One cell of the comparison.
 *
 * The tick and the dash are `aria-hidden` with the word beside them in a visually hidden
 * span, because a bare "✓" is announced inconsistently — "check mark", "tick", or nothing —
 * and a table of nothings is a table that says every plan is identical. "Coming" is a word
 * already, so it is not doubled.
 */
function CellValue({ cell }: { cell: Cell }) {
  if (cell.kind === 'text') return <>{cell.text}</>;
  if (cell.kind === 'coming') return <span className={styles.coming}>{CELL_LABELS.coming}</span>;
  return (
    <>
      <span aria-hidden="true" className={cell.kind === 'yes' ? styles.yes : styles.no}>
        {cell.kind === 'yes' ? '✓' : '—'}
      </span>
      <span className={styles.hidden}>{CELL_LABELS[cell.kind]}</span>
    </>
  );
}

const ANSWERS: readonly { q: string; a: string }[] = [
  {
    q: 'What counts as a user?',
    a: 'Somebody active and not suspended. Suspending a person frees their seat the moment you do it, and bots and integrations are not seats.',
  },
  {
    q: 'Can I pay for Cloud Pro today?',
    a: 'Not yet. The price is settled and the server already enforces the plan, but the checkout that would take your money is still being built, so nothing on this page can charge a card. Write to us and we will arrange a workspace directly.',
  },
  {
    q: 'What happens when billing lapses?',
    a: 'Reading never stops. Your work stays where it is and stays readable; the changes that need the plan are paused until billing is current, and nothing is deleted.',
  },
  {
    q: 'Can I move between self-hosted and cloud?',
    a: 'Both directions. It is the same product and the same export, and the licence on the core is AGPL either way.',
  },
];
