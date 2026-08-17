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
    const byGroup = new Map<string, { title: string; keys: string[] }[]>();

    for (const action of registry.list()) {
      // An action with no binding has nothing to teach here; it lives in the command menu.
      if (!action.keys?.length || action.hidden) continue;
      const entries = byGroup.get(action.group) ?? [];
      entries.push({
        title: action.title,
        keys: action.keys.map((k) => formatKeySpec(k, os === 'mac' ? 'mac' : 'other')),
      });
      byGroup.set(action.group, entries);
    }

    return [...byGroup.entries()]
      .map(([group, entries]) => ({
        group,
        entries: entries.sort((a, b) => a.title.localeCompare(b.title)),
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
                  <div key={entry.title} className={styles.row}>
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
