/**
 * "An update is ready — Restart."
 *
 * The shell downloads a new version in the background and, until this existed, told nobody:
 * the update was applied on the next quit, and on a laptop that is never quit that is several
 * versions behind indefinitely. A modal would be the wrong shape — nothing is wrong, and
 * nothing has to happen now — so this is a quiet row at the bottom of the sidebar that waits
 * for a moment between things.
 *
 * Renders nothing at all in a browser tab, where the page is whatever the server last served
 * and there is nothing to restart into.
 */

import { useEffect, useState } from 'react';

import { Button } from '~/components';
import { installUpdate, isDesktop, onUpdateStatus, type UpdateStatus } from './runtime';

import styles from './UpdateBanner.module.css';

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onUpdateStatus(setStatus), []);

  // Only the finished download is worth a row. "Checking" and "downloading" are the shell
  // doing its job, and narrating background work is how a status area becomes noise people
  // learn to look past.
  if (!isDesktop || status.state !== 'ready' || dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>Polaris {status.version} is ready</span>
      <Button type="button" variant="primary" size="sm" onClick={installUpdate}>
        Restart
      </Button>
      {/* Dismissable, because the update installs on the next quit regardless — this row is
          an offer to do it sooner, and an offer that cannot be declined is a demand. */}
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
