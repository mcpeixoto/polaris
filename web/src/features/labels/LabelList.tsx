/**
 * The labels on an issue, as they appear in a list row.
 *
 * Two constraints, and between them they decide the whole implementation.
 *
 * **It cannot change the row's height or the title's position.** A 32px row with a variable
 * number of chips in it is a column of titles that starts in a different place on every
 * line unless the run gives way first, so the run never wraps and never grows: what does not
 * fit collapses into a "+2".
 *
 * **Deciding what fits requires measuring.** There is no CSS that says "show as many of
 * these as fit and count the rest", so the widths are read from the DOM. The chips that do
 * not fit stay rendered and are taken out of flow rather than unmounted — an unmounted chip
 * has no width, so a run that dropped them could never find out that the window had grown
 * enough to bring one back. Measuring and hiding both happen in a layout effect, before the
 * browser paints, so nothing is ever seen appearing and then vanishing.
 *
 * It reads its own labels from the store, like the row it sits in: subscribing to
 * `issueLabel` and `label` means a title edited in another session does not re-render it,
 * and somebody adding a label two teams away does not either.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import { LabelChip } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';

import styles from './LabelList.module.css';

/** One chip's worth of label, resolved once so the run renders from plain data. */
interface AppliedLabel {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly groupName: string | undefined;
}

export interface LabelListProps {
  issueId: UUID;
  className?: string | undefined;
}

/**
 * The gap between two chips, in pixels, matching `gap` in the stylesheet.
 *
 * A number rather than a token because fitting is arithmetic, not styling — the same trade
 * the issue list makes for its row height. Being wrong costs one chip's place at the margin
 * and nothing else.
 */
const GAP_PX = 4;

/**
 * The width reserved for the "+2", rounded up from its minimum.
 *
 * Rounded up rather than measured: the count is only rendered once the run has decided to
 * collapse, so at the moment the decision is made there is nothing to measure. Over-reserving
 * drops a chip a few pixels early; under-reserving would push the count out of the row.
 */
const MORE_WIDTH_PX = 32;

export function LabelList({ issueId, className }: LabelListProps) {
  const labels = useLiveQuery(
    (store) => labelsOn(store, issueId),
    ['issueLabel', 'label'],
    [issueId],
  );

  const containerRef = useRef<HTMLUListElement | null>(null);
  const [shown, setShown] = useState(labels.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const fit = () => setShown(fittingCount(container, labels.length));
    fit();

    // The run's width is the row's leftovers, so it changes with the window and with the
    // title beside it — neither of which re-renders this component. jsdom has no
    // ResizeObserver; there the count settles on the measurement above and stays put.
    if (typeof window.ResizeObserver === 'undefined') return;
    const observer = new window.ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [labels]);

  // Nothing to draw, and nothing reserved for it either: an unlabelled issue's title should
  // run the full width of the row rather than stop short of a gap that is always empty.
  if (labels.length === 0) return null;

  const visible = Math.min(shown, labels.length);
  const hidden = labels.slice(visible);

  return (
    // role="list" although this is a <ul>: `list-style: none` strips list semantics in
    // Safari, and a run of labels that announces as loose text is the one thing a screen
    // reader user cannot tell from the title it sits next to.
    <ul
      ref={containerRef}
      role="list"
      className={[styles.list, className].filter(Boolean).join(' ')}
      aria-label="Labels"
    >
      {labels.map((label, at) => (
        <li
          key={label.id}
          className={[styles.item, at < visible ? null : styles.measured].filter(Boolean).join(' ')}
        >
          {/* Compact, which is also why no chip here offers removal: on a row the whole row
              is the click target, and the type makes the combination impossible. */}
          <LabelChip compact name={label.name} color={label.color} groupName={label.groupName} />
        </li>
      ))}
      {hidden.length === 0 ? null : (
        <li className={styles.item}>
          {/* "+2" on its own is meaningless read aloud, so the count carries the names it
              stands for. role="img" is what makes a span's own label announced at all. */}
          <span
            className={styles.more}
            role="img"
            aria-label={`${hidden.length} more: ${hidden.map(fullName).join(', ')}`}
            title={hidden.map(fullName).join(', ')}
          >
            +{hidden.length}
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * How many chips fit, given the widths the browser has already laid out.
 *
 * The chips that do not fit are still in the DOM and still have their natural width — see
 * `.measured` — so this is a plain walk over `container.children`, which are the chips in
 * order followed by the count when there is one.
 */
function fittingCount(container: HTMLElement, total: number): number {
  const available = container.offsetWidth;
  // Nothing has been laid out: jsdom, or a row inside a pane that is still display:none.
  // Collapsing everything behind a "+3" on a width of zero would hide the labels for good,
  // because a container that is never measured never grows back.
  if (available === 0) return total;

  const widths: number[] = [];
  for (let at = 0; at < total; at++) {
    const node = container.children[at];
    widths.push(node instanceof HTMLElement ? node.offsetWidth : 0);
  }

  let used = 0;
  let fits = 0;
  while (fits < total) {
    const next = used + (fits === 0 ? 0 : GAP_PX) + (widths[fits] ?? 0);
    if (next > available) break;
    used = next;
    fits += 1;
  }
  if (fits === total) return total;

  // The count needs room too, and it is the last thing to be given it rather than the first:
  // giving up a chip that would have fitted, in order to make space for a "+1" saying so, is
  // a worse trade at every width.
  while (fits > 0 && used + GAP_PX + MORE_WIDTH_PX > available) {
    fits -= 1;
    used -= (widths[fits] ?? 0) + (fits === 0 ? 0 : GAP_PX);
  }
  return fits;
}

/**
 * The labels on one issue, grouped ones last and alphabetical within each run.
 *
 * Grouped labels trail because their chips are the wide ones — a chip in a group is drawn as
 * "Priority: P0" — so putting them last is what makes the collapse take the widest chips
 * first, and leaves the most labels visible in the width the row has.
 */
function labelsOn(store: Store, issueId: UUID): AppliedLabel[] {
  const out: AppliedLabel[] = [];
  for (const id of store.labelIdsFor(issueId)) {
    const label = store.get('label', id);
    if (label === undefined) continue;
    const group = label.parentId === undefined ? undefined : store.get('label', label.parentId);
    out.push({ id: label.id, name: label.name, color: label.color, groupName: group?.name });
  }
  return out.sort((a, b) => {
    const byGroup = (a.groupName ?? '').localeCompare(b.groupName ?? '');
    return byGroup === 0 ? a.name.localeCompare(b.name) : byGroup;
  });
}

/** What a chip reads as, which is what the count has to say in its place. */
function fullName(label: AppliedLabel): string {
  return label.groupName === undefined ? label.name : `${label.groupName}: ${label.name}`;
}
