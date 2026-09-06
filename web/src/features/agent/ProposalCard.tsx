/**
 * The writes the agent wants to make, and the two buttons that decide.
 *
 * The card lists the steps rather than summarising them, because the summary is the model's
 * account of its own plan and the steps are what will actually run. A person approving a
 * change they have not been shown is not approving anything.
 *
 * A settled proposal keeps its card. Removing it would leave a transcript in which the
 * agent asked for something and nothing answered — and "what did I approve last Tuesday" is
 * the question this record exists for. It is drawn plainly and has no buttons: applying
 * twice is not a thing the server will do, and offering it is a lie about what will happen.
 */

import { Button } from '~/components';

import type { AgentProposal, AgentProposalState } from './api';
import styles from './AgentPanel.module.css';

export interface ProposalCardProps {
  proposal: AgentProposal;
  state: AgentProposalState;
  /** What the approved steps did, once they have run. One line each, from the server. */
  applied?: readonly string[] | undefined;
  /** This card's decision is in flight. */
  busy?: boolean | undefined;
  onApply: () => void;
  onDecline: () => void;
}

export function ProposalCard({
  proposal,
  state,
  applied,
  busy = false,
  onApply,
  onDecline,
}: ProposalCardProps) {
  const pending = state === 'pending';

  return (
    <section className={styles.proposal} aria-label="Proposed changes">
      <p className={styles.proposalSummary}>{proposal.summary}</p>

      <ol className={styles.steps}>
        {proposal.steps.map((step, index) => (
          // Index, because a step has no id and its position in the plan is its identity —
          // the list is fixed the moment the proposal is recorded and never reorders.
          <li key={index} className={styles.step}>
            <span className={styles.stepTool}>{step.tool}</span>
            <span className={styles.stepDescription}>{step.description}</span>
          </li>
        ))}
      </ol>

      {pending ? (
        <div className={styles.proposalActions}>
          <Button variant="primary" size="sm" loading={busy} onClick={onApply}>
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={onDecline}>
            Decline
          </Button>
        </div>
      ) : (
        <p className={styles.proposalSettled}>
          {state === 'applied' ? 'Applied' : 'Declined — nothing was written'}
        </p>
      )}

      {applied === undefined || applied.length === 0 ? null : (
        <ul className={styles.appliedList} aria-label="What changed">
          {applied.map((line) => (
            <li key={line} className={styles.appliedLine}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
