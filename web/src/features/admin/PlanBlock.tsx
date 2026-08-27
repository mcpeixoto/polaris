/**
 * The sentence a gated control is disabled with, and the way out of it.
 *
 * One component, rendered everywhere a `Block` is, so the four screens that gate on a plan
 * cannot each invent their own arrangement of "you cannot do this" — and so that adding a
 * destination happened once rather than four times, in four wordings.
 *
 * `role="status"` because the reason a control is grey is exactly what somebody who cannot
 * see it being grey needs to be told, and it is information rather than an error: nothing
 * has gone wrong, the plan simply does not include this. `alert` would interrupt, which is
 * wrong for a sentence explaining a button that was never going to work.
 *
 * The link is rendered only when `block.upgrade` is set. That is not a styling choice — see
 * `entitlements.ts`: a lapse, a negotiated override and a self-hosted install are all
 * refusals that upgrading does not lift, and a "Compare plans" link under any of them is a
 * promise the pricing page cannot keep.
 */

import { Link } from 'react-router';

import type { Block } from './entitlements';
import styles from './PlanBlock.module.css';

export interface PlanBlockProps {
  /** Null renders nothing, so a caller can pass the result of `featureBlock` straight in. */
  block: Block | null;
  /** The screen's own treatment for this box, where it already has one. */
  className?: string | undefined;
  /**
   * `alert` for a refusal that answered something the user just tried, `status` — the
   * default — for one describing a control that was already disabled.
   *
   * The distinction is not cosmetic: `alert` interrupts whatever a screen reader is saying,
   * which is right when somebody pressed a button and it did not work, and wrong for a
   * sentence that has been sitting under a greyed-out control since the page loaded.
   */
  role?: 'status' | 'alert' | undefined;
}

export function PlanBlock({ block, className, role = 'status' }: PlanBlockProps) {
  if (block === null) return null;
  return (
    <p className={className ?? styles.block} role={role}>
      {block.reason}
      {block.upgrade === null ? null : (
        <>
          {' '}
          <Link to={block.upgrade.to} className={styles.link}>
            {block.upgrade.label}
          </Link>
        </>
      )}
    </p>
  );
}
