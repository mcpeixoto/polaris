/**
 * The menu that puts labels on an issue.
 *
 * It is a controlled Menu and nothing else, in the mould of the three property pickers: it
 * does not own its trigger, it does not perform the write, and it reports a decision that
 * the caller turns into mutations. What it does own is everything the *user* should never
 * have to find out, because the database owns three rules and would otherwise teach them one
 * refusal at a time:
 *
 * **A group is not a label.** A group is a label with `isGroup` set, it exists to name a
 * heading, and it can never be applied to an issue. So it is a heading here and never an
 * item — not a disabled item, which would only invite the click that fails.
 *
 * **A team's label only goes on that team's issues.** The picker is filtered by the issue's
 * team rather than showing the workspace's labels and letting the server say no. A label that
 * is not offered is a rule nobody has to learn.
 *
 * **At most one label from a group.** Choosing "P1" while "P0" is on the issue replaces it
 * rather than being refused — the two possible interactions are "work out for yourself that
 * P0 is in the way" and "swap them", and only the second is a product. The row says so
 * before it is chosen: the displaced label is named in the hint, so the swap is visible
 * rather than something the user notices afterwards.
 *
 * Selecting a label already on the issue takes it off, which is what makes the same list
 * both the add menu and the remove menu. The menu closes after each choice because that is
 * Menu's contract for every picker in the product — applying a second label is `L` again.
 */

import type { CSSProperties, RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Label, Store, UUID } from '~/store';

import styles from './LabelPicker.module.css';

/** One applicable label, resolved against the issue the picker was opened on. */
export interface LabelOption {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  /** Already on the issue: the row is ticked, and choosing it takes the label off. */
  readonly applied: boolean;
  /**
   * The group-mates applying this label would displace. At most one, because at most one
   * label from a group may sit on an issue — it is a list because that is what the caller
   * has to remove, and a list of one is cheaper than a nullable id everywhere downstream.
   */
  readonly displaces: readonly UUID[];
  /** Their names, so the row can say what it replaces rather than replacing it silently. */
  readonly displacedNames: readonly string[];
}

/** A group and the labels under it, or the ungrouped run that leads the list. */
export interface LabelSection {
  readonly key: string;
  /** `null` for the ungrouped labels, which lead the menu with no heading over them. */
  readonly heading: string | null;
  readonly options: readonly LabelOption[];
}

export interface LabelPickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the menu belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The issue being labelled. Its team decides what is offered; its labels, what is ticked. */
  issueId: UUID;
  /** Apply a label, having removed the group-mates it displaces. See `applyLabel`. */
  onApply: (labelId: UUID, displaced: readonly UUID[]) => void;
  onRemove: (labelId: UUID) => void;
}

export function LabelPicker({
  open,
  onClose,
  trigger,
  placement,
  issueId,
  onApply,
  onRemove,
}: LabelPickerProps) {
  const sections = useLiveQuery(
    (store) => offerings(store, issueId),
    ['label', 'issueLabel', 'issue'],
    [issueId],
  );

  const items: MenuNode[] = [];
  for (const section of sections) {
    if (section.heading !== null) items.push({ kind: 'heading', label: section.heading });
    for (const option of section.options) {
      items.push({
        id: option.id,
        label: option.name,
        // The group's name matches too, so typing "priority" narrows to that group's labels
        // rather than to the one label somebody happened to call Priority.
        text: section.heading === null ? option.name : `${section.heading} ${option.name}`,
        icon: (
          <span
            className={styles.swatch}
            // Inline because the value is workspace data, not design; the stylesheet reads it
            // back through the custom property. Same arrangement as LabelChip.
            style={{ '--label-color': option.color } as CSSProperties}
          />
        ),
        selected: option.applied,
        hint:
          option.displacedNames.length === 0
            ? undefined
            : `Replaces ${option.displacedNames.join(', ')}`,
        onSelect: () =>
          option.applied ? onRemove(option.id) : onApply(option.id, option.displaces),
      });
    }
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Labels"
      placement={placement}
      filterable
      filterPlaceholder="Label…"
      // Two different facts, and a list that said "no matches" to a workspace with no labels
      // would send somebody looking for a filter they never typed.
      emptyLabel={items.length === 0 ? 'No labels for this team yet' : 'No labels match'}
    />
  );
}

/**
 * The labels this issue may carry, arranged into the sections the menu renders.
 *
 * Sorted by name throughout, and deliberately not by `position`. Positions are fractional
 * indices minted per scope — once for the workspace, once per team — so the ungrouped run,
 * which mixes a workspace's labels with a team's, has no meaningful order to sort by. A
 * filterable menu is searched rather than scanned, and alphabetical is the only order that is
 * correct for every block in it.
 */
function offerings(store: Store, issueId: UUID): LabelSection[] {
  const issue = store.get('issue', issueId);
  if (issue === undefined) return [];

  const applied = store.labelIdsFor(issueId);
  const groups = new Map<UUID, Label>();
  const children = new Map<UUID, Label[]>();
  const loose: Label[] = [];

  for (const label of store.labels.values()) {
    if (label.archivedAt !== undefined) continue;
    // A team's label may only go on that team's issues; a workspace label carries no team
    // and goes on any of them.
    if (label.teamId !== undefined && label.teamId !== issue.teamId) continue;
    if (label.isGroup) {
      groups.set(label.id, label);
      continue;
    }
    if (label.parentId === undefined) {
      loose.push(label);
      continue;
    }
    const bucket = children.get(label.parentId);
    if (bucket === undefined) children.set(label.parentId, [label]);
    else bucket.push(label);
  }

  // A label whose group has been archived is still applicable, and hiding it because its
  // heading has gone would take a working label out of the picker for a reason the user
  // cannot see. It joins the ungrouped run.
  for (const [parentId, bucket] of children) {
    if (groups.has(parentId)) continue;
    loose.push(...bucket);
    children.delete(parentId);
  }

  /** The applied labels sharing a group with this one, which applying it would displace. */
  const displacedBy = (label: Label): Label[] => {
    if (label.parentId === undefined || applied.has(label.id)) return [];
    const out: Label[] = [];
    for (const id of applied) {
      const other = store.get('label', id);
      if (other !== undefined && other.id !== label.id && other.parentId === label.parentId) {
        out.push(other);
      }
    }
    return out.sort(byName);
  };

  const optionsOf = (labels: readonly Label[]): LabelOption[] =>
    [...labels].sort(byName).map((label) => {
      const displaced = displacedBy(label);
      return {
        id: label.id,
        name: label.name,
        color: label.color,
        applied: applied.has(label.id),
        displaces: displaced.map((other) => other.id),
        displacedNames: displaced.map((other) => other.name),
      };
    });

  const sections: LabelSection[] = [];
  // Ungrouped first and unheaded: they are the labels most workspaces have most of, and a
  // heading over the top of a menu is a row of text nobody can choose.
  if (loose.length > 0)
    sections.push({ key: 'ungrouped', heading: null, options: optionsOf(loose) });
  for (const group of [...groups.values()].sort(byName)) {
    const bucket = children.get(group.id);
    // A group with nothing in it has nothing to head. It is not an error — a group created a
    // moment ago is empty by definition — so it is simply not drawn.
    if (bucket === undefined || bucket.length === 0) continue;
    sections.push({ key: group.id, heading: group.name, options: optionsOf(bucket) });
  }
  return sections;
}

function byName(a: Label, b: Label): number {
  return a.name.localeCompare(b.name);
}
