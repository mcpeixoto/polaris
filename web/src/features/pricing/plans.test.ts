import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  annualMonthlyCents,
  annualYearlyCents,
  COMPARISON,
  formatEur,
  FREE_HISTORY_DAYS,
  FREE_SEATS,
  FREE_TEAMS,
  PLAN_ORDER,
  PLANS,
  planSummary,
  PRO_MONTHLY_CENTS,
} from './plans';

describe('price arithmetic', () => {
  it('takes the annual discount off the month', () => {
    expect(annualMonthlyCents(400, 20)).toBe(320);
    expect(formatEur(annualMonthlyCents())).toBe('€3.20');
  });

  it('bills twelve of the discounted month, not a discounted year', () => {
    // 12 × €3.20 = €38.40. Discounting €48 in one step gives the same figure here and would
    // not for every price — the page has to state the number twelve invoices add up to.
    expect(annualYearlyCents(400, 20)).toBe(3840);
    expect(annualYearlyCents(400, 20)).toBe(annualMonthlyCents(400, 20) * 12);
  });

  it('rounds to the cent instead of leaving a float in the page', () => {
    // 300 × 0.8 in floating-point euros is 2.4000000000000004, which renders verbatim.
    expect(annualMonthlyCents(300, 20)).toBe(240);
    expect(annualMonthlyCents(490, 20)).toBe(392);
    // A price that does not divide cleanly still lands on a whole cent.
    expect(annualMonthlyCents(499, 15)).toBe(424);
    expect(Number.isInteger(annualMonthlyCents(499, 15))).toBe(true);
  });

  it('a zero discount is the monthly price', () => {
    expect(annualMonthlyCents(400, 0)).toBe(400);
  });
});

describe('formatEur', () => {
  it('drops decimals from a whole euro and keeps them otherwise', () => {
    expect(formatEur(0)).toBe('€0');
    expect(formatEur(400)).toBe('€4');
    expect(formatEur(320)).toBe('€3.20');
    expect(formatEur(3840)).toBe('€38.40');
    // Two decimals, not one: "€3.2" is not a price.
    expect(formatEur(320)).not.toBe('€3.2');
  });
});

describe('the plan list', () => {
  it('is the four plans, in selling order', () => {
    expect(PLANS.map((plan) => plan.id)).toEqual([...PLAN_ORDER]);
  });

  it('prices Pro at least half of Linear’s entry', () => {
    // The packaging decision, asserted so a later edit to the headline is a deliberate one.
    // Linear's entry is ~$8/user/month; ours is €4 and the claim on the page depends on it.
    expect(PRO_MONTHLY_CENTS).toBeLessThanOrEqual(400);
  });

  it('offers Enterprise a conversation rather than a number', () => {
    expect(planSummary('enterprise')?.price).toBeNull();
  });

  it('answers null for a plan string the wire invented', () => {
    expect(planSummary('platinum')).toBeNull();
  });

  it('gives every comparison row a cell for every plan', () => {
    for (const row of COMPARISON) {
      for (const id of PLAN_ORDER) {
        expect(row.cells[id], `${row.label} / ${id}`).toBeDefined();
      }
    }
  });

  it('never ticks a feature that does not ship yet', () => {
    // SSO, SCIM and the audit log are the Enterprise pitch and none is in the hosted product.
    // A tick here is a promise somebody pays against; `coming` is the honest cell.
    for (const label of ['Single sign-on', 'SCIM provisioning', 'Audit log']) {
      const row = COMPARISON.find((candidate) => candidate.label === label);
      expect(row, label).toBeDefined();
      expect(row?.cells.enterprise.kind, label).toBe('coming');
    }
  });
});

/**
 * The page and the product cannot disagree about the Free tier.
 *
 * The server's matrix is the thing that actually refuses a sixth invitation, and this file
 * is the thing that told somebody five was the number. When they drift, nothing breaks and
 * nothing is logged — a customer simply hits a ceiling the pricing page said they did not
 * have, and finds out that the page lied. So the caps are read out of the Go source rather
 * than copied into a comment.
 *
 * Reading source text is crude and deliberate, the same trade `views/screens.test.ts` makes:
 * the alternative is a fixture that asserts the fixture.
 */
describe('agreement with the enforced matrix', () => {
  const MATRIX = join(__dirname, '../../../..', 'services/internal/entitlement/entitlement.go');

  function freeTier(): string {
    let source: string;
    try {
      source = readFileSync(MATRIX, 'utf8');
    } catch {
      throw new Error(
        `${MATRIX} could not be read, so the pricing page's Free caps are unchecked against ` +
          `the matrix that enforces them. Either the file moved — in which case this path ` +
          `follows it — or the web package is being tested outside the repository, which is ` +
          `not a case this guard can cover.`,
      );
    }
    const block = /PlanFree:\s*\{([\s\S]*?)\n\t\}/.exec(source);
    if (block === null) {
      throw new Error(
        'the PlanFree row of the matrix in entitlement.go did not parse. The matrix has ' +
          'changed shape and this guard has to learn the new one rather than be deleted — ' +
          'without it the pricing page can quote caps the server does not enforce.',
      );
    }
    return block[1]!;
  }

  function field(name: string): number {
    const found = new RegExp(`${name}:\\s*(-?\\d+)`).exec(freeTier());
    if (found === null) throw new Error(`PlanFree has no ${name} in entitlement.go`);
    return Number(found[1]);
  }

  it('quotes the seat cap the server enforces', () => {
    expect(FREE_SEATS).toBe(field('SeatLimit'));
  });

  it('quotes the team cap the server enforces', () => {
    expect(FREE_TEAMS).toBe(field('TeamLimit'));
  });

  it('quotes the history window the server enforces', () => {
    expect(FREE_HISTORY_DAYS).toBe(field('HistoryDays'));
  });

  it('states those caps in the comparison table too', () => {
    const cell = (label: string) => {
      const row = COMPARISON.find((candidate) => candidate.label === label);
      const free = row?.cells.free;
      return free !== undefined && free.kind === 'text' ? free.text : '';
    };
    expect(cell('People')).toContain(String(FREE_SEATS));
    expect(cell('Teams')).toContain(String(FREE_TEAMS));
    expect(cell('History')).toContain(String(FREE_HISTORY_DAYS));
  });
});
