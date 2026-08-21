/**
 * The keyboard help overlay.
 *
 * Entirely generated from the registry. There is no hand-written list of shortcuts here,
 * and that is the point: a hand-maintained help sheet is wrong within a fortnight of the
 * first feature landing, and a *wrong* help sheet is worse than none — it teaches people
 * keys that do nothing and they stop trusting the overlay at all.
 */

import { useMemo } from 'react';

import { formatKeySpec } from '~/keys';
import { os } from '~/platform/runtime';
import { useKeymap } from './keymap';
import styles from './HelpOverlay.module.css';

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { registry } = useKeymap();

  const groups = useMemo(() => {
    if (!open) return [];
    // `byGroup` is the registry's own answer to this question: every *bound* action, grouped,
    // with the `hidden` ones kept. Filtering `hidden` here — which this overlay used to do —
    // reads like the same idea but is the opposite one: `hidden` keeps a command out of the
    // command menu's search results, where "Move down" and "Dismiss" are noise. A keyboard
    // reference is exactly where they belong, and dropping them cost this sheet `J`/`K`, the
    // arrow keys, `Esc`, and every ⌘⏎ submit — the first shortcuts anybody looks up.
    return [...registry.byGroup().entries()]
      .map(([group, actions]) => ({
        group,
        entries: actions
          .map((action) => ({
            id: action.id,
            title: action.title,
            keys: (action.keys ?? []).map((k) => formatKeySpec(k, os === 'mac' ? 'mac' : 'other')),
          }))
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [open, registry]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-overlay-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className={styles.heading} id="help-overlay-title">
          Keyboard shortcuts
        </h2>

        <div className={styles.columns}>
          {groups.map(({ group, entries }) => (
            <section key={group} className={styles.section}>
              <h3 className={styles.group}>{group}</h3>
              <dl className={styles.list}>
                {entries.map((entry) => (
                  <div key={entry.id} className={styles.row}>
                    <dt className={styles.label}>{entry.title}</dt>
                    <dd className={styles.keys}>
                      {entry.keys.map((k) => (
                        <kbd key={k} className={styles.kbd}>
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
