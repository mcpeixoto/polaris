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
 *
 * The sheet routinely lists forty rows, so it has a filter. That is not a convenience: a
 * reference somebody has to read in full to find one line is a reference they close and guess
 * from instead, and the ranking this reuses is the same one the command menu already applies
 * to the same shape of data.
 */

import { useMemo, useRef, useState } from 'react';

import { EmptyState, Input, Kbd, Modal } from '~/components';
import type { Platform } from '~/keys';
import { os } from '~/platform/runtime';
import { subsequenceScore } from './commandMenuQuery';
import { useKeymap } from './keymap';
import styles from './HelpOverlay.module.css';

interface HelpEntry {
  readonly id: string;
  readonly title: string;
  readonly keys: readonly string[];
}

interface HelpGroup {
  readonly group: string;
  readonly entries: readonly HelpEntry[];
}

/**
 * The order the sheet reads in, which is not alphabetical.
 *
 * It was, and that put "General" — ⌘K, `?`, Escape, the three keys anybody opening this sheet
 * for the first time is looking for — between "Editor" and "Issues". A reference is ordered by
 * what the reader wants first, and a group not named here follows in alphabetical order rather
 * than being dropped, so a new feature's shortcuts appear without anybody editing this list.
 */
const GROUP_ORDER = ['General', 'Navigation', 'Issues', 'Views', 'Editor'];

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { registry, context } = useKeymap();
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);

  const groups = useMemo((): HelpGroup[] => {
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
        // Registration order within a group, deliberately, and not `localeCompare`. The
        // order a feature registers its actions in is the order it thinks about them —
        // "Open", then "Edit", then "Delete" — and alphabetising that produced a column
        // whose sequence meant nothing.
        entries: actions.map((action) => ({
          id: action.id,
          title: action.title,
          // The specs, not strings drawn from them. `Kbd` is what turns a spec into
          // glyphs everywhere else in the product, and formatting them here left this
          // sheet drawing `G I` as one chip where the command menu drew two.
          keys: action.keys ?? [],
        })),
      }))
      .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group));
  }, [open, registry, context]);

  /**
   * The last sheet that had anything in it.
   *
   * `groups` empties the moment `open` goes false, and the overlay is now handed `open` so it
   * can run `Modal`'s exit — which means the memo above would take the content apart under the
   * reader's eyes for the fifty milliseconds of the fade. This holds the last non-empty
   * computation so the sheet leaves holding what it was showing, which is the same trick
   * `UndoToast` uses for the same reason. `byGroup` can also legitimately answer with nothing
   * — a context with no bound menu-source actions — and that case still has to reach the
   * empty state rather than being masked, so it is only substituted while closing.
   */
  const lastGroups = useRef<HelpGroup[]>([]);
  if (open) lastGroups.current = groups;
  const shown = open ? groups : lastGroups.current;

  const matched = useMemo((): HelpGroup[] => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return shown;
    return shown
      .map((section) => ({
        group: section.group,
        // Matched against the key text as well as the title, because half of looking a
        // shortcut up is arriving with the keys and wanting the name.
        entries: section.entries.filter(
          (entry) =>
            subsequenceScore(
              `${section.group} ${entry.title} ${entry.keys.join(' ')}`.toLowerCase(),
              needle,
            ) !== null,
        ),
      }))
      .filter((section) => section.entries.length > 0);
  }, [shown, filter]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="lg"
      initialFocus={filterRef}
    >
      <Input
        ref={filterRef}
        label="Filter shortcuts"
        hideLabel
        placeholder="Filter shortcuts…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className={styles.filter}
      />
      {matched.length === 0 ? (
        <EmptyState
          title={filter.trim() === '' ? 'No shortcuts on this screen' : 'No shortcuts match'}
          description={
            filter.trim() === ''
              ? 'Nothing here is bound to a key yet. Try the command menu instead.'
              : 'Try fewer letters, or the name of what the shortcut does.'
          }
        />
      ) : (
        <div className={styles.columns}>
          {matched.map(({ group, entries }) => (
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
      )}
    </Modal>
  );
}

function platform(): Platform {
  return os === 'mac' ? 'mac' : 'other';
}
