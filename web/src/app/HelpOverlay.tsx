/**
 * The keyboard help overlay.
 *
 * Entirely generated from the registry. There is no hand-written list of shortcuts here,
 * and that is the point: a hand-maintained help sheet is wrong within a fortnight of the
 * first feature landing, and a *wrong* help sheet is worse than none — it teaches people
 * keys that do nothing and they stop trusting the overlay at all.
 *
 * It is a `Modal` rather than a div wearing `role="dialog"`, which is what it was. The
 * difference is everything a modal owes: focus went nowhere when the sheet opened, so a
 * screen reader carried on reading the page behind it and a `?` pressed from the issue list
 * put a dialog on screen that its user was never told about; Tab walked straight out the back
 * of it; there was no close button, so a pointer user who had not guessed at Escape had only
 * the backdrop; and the page kept scrolling underneath. Modal's own header names this overlay
 * as one of the three things it exists for, and it had been the one not using it.
 *
 * Escape stays the registry's `app.dismiss` as well as Modal's own handler — Modal stops the
 * press reaching the window, so the two do not both fire. Nothing about the keymap changed
 * here.
 */

import { useMemo } from 'react';

import { Kbd, Modal } from '~/components';
import type { Platform } from '~/keys';
import { os } from '~/platform/runtime';
import { useKeymap } from './keymap';
import styles from './HelpOverlay.module.css';

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { registry, context } = useKeymap();

  const groups = useMemo(() => {
    if (!open) return [];
    // `byGroup` is the registry's own answer to this question: every *bound* action that
    // applies here, grouped, with the `hidden` ones kept. Filtering `hidden` here — which
    // this overlay used to do — reads like the same idea but is the opposite one: `hidden`
    // keeps a command out of the command menu's search results, where "Move down" and
    // "Dismiss" are noise. A keyboard reference is exactly where they belong, and dropping
    // them cost this sheet `J`/`K`, the arrow keys, `Esc`, and every ⌘⏎ submit — the first
    // shortcuts anybody looks up.
    //
    // What it does drop is an action that says it does not apply on this screen at all. The
    // sheet used to have no way to ask, so a permanently-ungated binding printed as a
    // reference row that did nothing — an ordinary team list drew a "Triage" section
    // teaching four keys that could not fire anywhere on it. It deliberately does not ask
    // `enabled`: "not right now" is not "not here", and a sheet that dropped `Esc` because
    // nothing was selected would be missing the shortcut people look up most.
    return [...registry.byGroup({ source: 'menu', context }).entries()]
      .map(([group, actions]) => ({
        group,
        entries: actions
          .map((action) => ({
            id: action.id,
            title: action.title,
            // The specs, not strings drawn from them. `Kbd` is what turns a spec into
            // glyphs everywhere else in the product, and formatting them here left this
            // sheet drawing `G I` as one chip where the command menu drew two.
            keys: action.keys ?? [],
          }))
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [open, registry, context]);

  // Returned before the Modal rather than handed `open`, so the memo above keeps its guard:
  // a sheet that emptied itself on the way out would show the reader the list being taken
  // apart. It costs the exit animation, which this overlay never had.
  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Keyboard shortcuts" size="lg">
      <div className={styles.columns}>
        {groups.map(({ group, entries }) => (
          <section key={group} className={styles.section}>
            <h3 className={styles.group}>{group}</h3>
            <dl className={styles.list}>
              {entries.map((entry) => (
                <div key={entry.id} className={styles.row}>
                  <dt className={styles.label}>{entry.title}</dt>
                  <dd className={styles.keys}>
                    {entry.keys.map((spec) => (
                      <Kbd key={spec} keys={spec} platform={platform()} />
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function platform(): Platform {
  return os === 'mac' ? 'mac' : 'other';
}
