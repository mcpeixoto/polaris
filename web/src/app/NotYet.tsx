/**
 * A placeholder for a route that exists but whose screen is a later milestone.
 *
 * It says which milestone, on purpose. "Coming soon" is the kind of message that stays in
 * a product for two years; naming the milestone makes it a claim somebody can check, and
 * an embarrassing one to leave stale.
 */
import styles from './NotYet.module.css';

export function NotYet({ feature, milestone }: { feature: string; milestone: string }) {
  return (
    <div className={styles.wrap} role="status">
      <h1 className={styles.title}>{feature}</h1>
      <p className={styles.body}>Not built yet — scheduled for {milestone}.</p>
    </div>
  );
}
