/**
 * Which plan this workspace is on, at the foot of the sidebar.
 *
 * For an owner or admin it opens Billing, because the pill is where people look when they
 * want to change the plan — and Settings → Administration → Billing is three steps nobody
 * guesses from a label that does nothing when clicked. For everybody else it stays a label:
 * a member cannot change the plan, and a button that leads to "Only admins can open this"
 * is worse than one that is not there.
 *
 * A button rather than a link. The workspace sidebar keeps no `/settings` links (see
 * AppShell.test.tsx), and this is an action on the plan rather than a place in the list.
 */

import styles from './AppShell.module.css';

export interface PlanPillProps {
  name: string;
  canManage: boolean;
  onManage: () => void;
}

export function PlanPill({ name, canManage, onManage }: PlanPillProps) {
  if (!canManage) return <span className={styles.plan}>{name}</span>;
  return (
    <button
      type="button"
      className={`${styles.plan} ${styles.planButton}`}
      title="Manage plan and billing"
      aria-label={`${name}, manage plan and billing`}
      onClick={onManage}
    >
      {name}
    </button>
  );
}
