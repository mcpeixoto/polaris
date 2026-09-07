/**
 * Display menu for the projects list: every decision this screen makes about how it draws
 * itself, in one popover.
 *
 * The rows are the issue display menu's, deliberately — layout as a segmented pair at the
 * top, then grouping, ordering and direction as label-left/control-right rows, then the
 * columns as a grid of checkboxes, and each value that is not the default naming the default
 * it replaced. The two menus are the same control over different data, and a product with
 * two shapes for the same decision teaches neither.
 *
 * Everything writes immediately. There is no Apply button and there must not be one: the
 * list underneath is the preview, and `setDisplay` writes the URL with `replace`, so ticking
 * four columns is one history entry rather than four.
 *
 * The panel shell — the portal, the positioning, the Escape action, the focus hand-back — is
 * this file's own rather than the issue menu's, because that one is not a component yet.
 * When it becomes one, both should take it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, SegmentedControl, Select } from '~/components';
import { usePresence } from '~/hooks/usePresence';
import {
  changedProjectDisplayCount,
  DEFAULT_PROJECT_DISPLAY,
  PROJECT_COLUMN_ORDER,
  projectOrderingNote,
  sameProjectColumns,
  type ProjectColumn,
  type ProjectDirection,
  type ProjectDisplayOptions,
  type ProjectGrouping,
  type ProjectLayout,
  type ProjectOrdering,
  type ProjectTimelineZoom,
} from './display';
import styles from './ProjectDisplayMenu.module.css';

export type RequiredProjectDisplay = Required<ProjectDisplayOptions>;

export interface ProjectDisplayMenuProps {
  readonly display: RequiredProjectDisplay;
  onChange(patch: Partial<ProjectDisplayOptions>): void;
  readonly open: boolean;
  onClose(): void;
  readonly trigger: RefObject<HTMLElement | null>;
}

/*
 * The product's word for each value, as a total map rather than a list of pairs: adding a
 * grouping and forgetting to name it here is a type error at the moment it is added, rather
 * than a menu row reading "targetDate" that somebody notices in a screenshot a month later.
 */
const LAYOUT_LABELS: Readonly<Record<ProjectLayout, string>> = {
  list: 'List',
  board: 'Board',
  timeline: 'Timeline',
};

const GROUPING_LABELS: Readonly<Record<ProjectGrouping, string>> = {
  none: 'No grouping',
  status: 'Status',
  lead: 'Lead',
  team: 'Team',
  priority: 'Priority',
};

const ORDERING_LABELS: Readonly<Record<ProjectOrdering, string>> = {
  manual: 'Manual',
  name: 'Name',
  targetDate: 'Target date',
  priority: 'Priority',
  updated: 'Updated',
};

const DIRECTION_LABELS: Readonly<Record<ProjectDirection, string>> = {
  asc: 'Ascending',
  desc: 'Descending',
};

export const PROJECT_COLUMN_LABELS: Readonly<Record<ProjectColumn, string>> = {
  health: 'Health',
  priority: 'Priority',
  lead: 'Lead',
  targetDate: 'Target date',
  issues: 'Issues',
  status: 'Status',
};

const ZOOM_LABELS: Readonly<Record<ProjectTimelineZoom, string>> = {
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

const LAYOUT_ORDER: readonly ProjectLayout[] = ['list', 'board', 'timeline'];
const GROUPING_ORDER: readonly ProjectGrouping[] = ['none', 'status', 'lead', 'team', 'priority'];
const ORDERING_ORDER: readonly ProjectOrdering[] = [
  'manual',
  'name',
  'targetDate',
  'priority',
  'updated',
];
const DIRECTION_ORDER: readonly ProjectDirection[] = ['asc', 'desc'];
const ZOOM_ORDER: readonly ProjectTimelineZoom[] = ['week', 'month', 'quarter', 'year'];
const VIEWPORT_MARGIN_PX = 8;

interface Point {
  readonly top: number;
  readonly left: number;
}

export function ProjectDisplayMenu({
  display,
  onChange,
  open,
  onClose,
  trigger,
}: ProjectDisplayMenuProps) {
  const panelId = useId();
  const baseId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Point | null>(null);

  // Held on screen for the length of its fade. Nothing else in this file changes: the keyboard
  // context, the Escape binding and the focus hand-back all still key on `open`.
  const { present, exitProps } = usePresence(open, panelRef);

  const changed = changedProjectDisplayCount(display);

  /**
   * What the registered Escape reads. The registry captures `run` once, at registration, so
   * a closure over `onClose` would go on calling the callback the first render happened to
   * pass — the same reason the issue list's display panel reaches its close through a ref.
   */
  const state = useRef({ open, close: onClose });
  state.current = { open, close: onClose };

  // The panel has taken the keyboard, so the list's own chords stop competing with the
  // controls being tabbed through. `menu` is sealed, which is what makes that true.
  useKeyContext('menu', open);

  // This panel carries the same `role="dialog"` and the same "Display options" name as the
  // issue list's, which closes on Escape — and it takes focus on open. Without this it had
  // no keyboard way back out: a dialog dismissable only by clicking somewhere else is a
  // trap for anyone not using a mouse.
  useActions(
    [
      {
        id: 'projects.closeDisplay',
        title: 'Close the display menu',
        keys: ['Escape'],
        when: 'menu',
        group: 'Projects',
        // Not offered in the command menu: "close the thing you are looking at" is not
        // something anybody searches for. It still appears in the help overlay.
        hidden: true,
        // Disabled reads as unbound, so with the panel shut Escape falls through to the
        // shell's dismiss rather than being swallowed by a command with nothing to do.
        enabled: () => state.current.open,
        run: () => state.current.close(),
      },
    ],
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const triggerEl = trigger.current;
    const panel = panelRef.current;
    if (triggerEl === null || panel === null) return;

    const rect = triggerEl.getBoundingClientRect();
    panel.style.visibility = 'hidden';
    panel.style.top = `${rect.bottom}px`;
    panel.style.left = `${rect.left}px`;

    const panelRect = panel.getBoundingClientRect();
    let left = rect.left;
    if (panelRect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
      left = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - VIEWPORT_MARGIN_PX - panelRect.width);
    }
    // The answer goes back onto the element the same way the probe went on, and not only
    // into state: when a reopened panel works out the same position it had last time, the
    // style prop React holds has not changed, nothing is written to the DOM, and the
    // measuring position stays on screen — which is how the panel came to hang off the
    // right edge of the window on every open but the first, with its lower controls
    // unreachable.
    panel.style.top = `${rect.bottom}px`;
    panel.style.left = `${left}px`;
    setPosition({ top: rect.bottom, left });
    panel.style.visibility = '';
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const anchorAtOpen = trigger.current;
    return () => {
      const active = document.activeElement;
      if (active === null || active === document.body) anchorAtOpen?.focus();
    };
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (trigger.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, trigger]);

  const reset = useCallback(() => onChange(DEFAULT_PROJECT_DISPLAY), [onChange]);

  const columns = useMemo(() => new Set(display.columns), [display.columns]);

  /**
   * Ticks or unticks one column, always emitting the canonical order.
   *
   * The order is not cosmetic: `toProjectDisplayParams` compares the joined list against the
   * default's, so the same five columns in a different order would pin a `cols=` parameter
   * into every link somebody shares — a view claiming a choice nobody made.
   */
  const onColumn = useCallback(
    (column: ProjectColumn, on: boolean) => {
      onChange({
        columns: PROJECT_COLUMN_ORDER.filter((candidate) =>
          candidate === column ? on : columns.has(candidate),
        ),
      });
    },
    [onChange, columns],
  );

  const note = projectOrderingNote(display.ordering, display.grouping);
  const groupingId = `${baseId}-grouping`;
  const orderingId = `${baseId}-ordering`;
  const directionLabelId = `${baseId}-direction`;
  const columnsLabelId = `${baseId}-columns`;

  const panelStyle: CSSProperties | undefined = position
    ? { top: position.top, left: position.left }
    : undefined;

  if (!present) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      className={styles.panel}
      style={panelStyle}
      role="dialog"
      aria-label="Display options"
      tabIndex={-1}
      {...exitProps}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>Display</h2>
        {changed > 0 && (
          <>
            <span className={styles.count}>
              {changed} {changed === 1 ? 'change' : 'changes'}
            </span>
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          </>
        )}
      </div>

      <section className={styles.section}>
        <span className={styles.label}>Layout</span>
        <SegmentedControl
          aria-label="Layout"
          value={display.layout}
          onChange={(value) => onChange({ layout: value })}
          options={LAYOUT_ORDER.map((value) => ({ value, label: LAYOUT_LABELS[value] }))}
        />
        {display.layout === DEFAULT_PROJECT_DISPLAY.layout ? null : (
          <p className={styles.changed}>Default: {LAYOUT_LABELS[DEFAULT_PROJECT_DISPLAY.layout]}</p>
        )}
      </section>

      {/* Grouping, ordering and direction describe the list and the board alike. The
          timeline draws its own bands from dates, so they are left out of it below rather
          than drawn here and quietly ignored. */}
      {display.layout === 'timeline' ? null : (
        <section className={styles.section}>
          <div className={styles.row}>
            <label className={styles.rowLabel} htmlFor={groupingId}>
              Grouping
            </label>
            <Select
              id={groupingId}
              className={styles.control}
              value={display.grouping}
              onChange={(event) => {
                // Matched against the list this select was built from rather than cast: a
                // cast would be a promise about a string the DOM produced.
                const next = GROUPING_ORDER.find((candidate) => candidate === event.target.value);
                if (next !== undefined) onChange({ grouping: next });
              }}
            >
              {GROUPING_ORDER.map((value) => (
                <option key={value} value={value}>
                  {GROUPING_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          {display.grouping === DEFAULT_PROJECT_DISPLAY.grouping ? null : (
            <p className={styles.changed}>
              Default: {GROUPING_LABELS[DEFAULT_PROJECT_DISPLAY.grouping]}
            </p>
          )}

          <div className={styles.row}>
            <label className={styles.rowLabel} htmlFor={orderingId}>
              Ordering
            </label>
            <Select
              id={orderingId}
              className={styles.control}
              value={display.ordering}
              onChange={(event) => {
                const next = ORDERING_ORDER.find((candidate) => candidate === event.target.value);
                if (next !== undefined) onChange({ ordering: next });
              }}
            >
              {ORDERING_ORDER.map((value) => (
                <option key={value} value={value}>
                  {ORDERING_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          {display.ordering === DEFAULT_PROJECT_DISPLAY.ordering ? null : (
            <p className={styles.changed}>
              Default: {ORDERING_LABELS[DEFAULT_PROJECT_DISPLAY.ordering]}
            </p>
          )}

          {note === null ? null : (
            <p className={styles.note} role="note">
              {note}
            </p>
          )}

          <div className={styles.row}>
            <span className={styles.rowLabel} id={directionLabelId}>
              Direction
            </span>
            <SegmentedControl
              className={[styles.control, styles.segmentedControl].filter(Boolean).join(' ')}
              aria-label="Direction"
              value={display.direction}
              onChange={(value) => onChange({ direction: value })}
              options={DIRECTION_ORDER.map((value) => ({
                value,
                label: DIRECTION_LABELS[value],
              }))}
            />
          </div>
          {display.direction === DEFAULT_PROJECT_DISPLAY.direction ? null : (
            <p className={styles.changed}>
              Default: {DIRECTION_LABELS[DEFAULT_PROJECT_DISPLAY.direction]}
            </p>
          )}
        </section>
      )}

      {/* The columns of the table. Absent on the board and the timeline, which draw a card
          and a bar rather than a row of cells — a checkbox that changed nothing on the
          screen in front of somebody is worse than one that is not offered. */}
      {display.layout === 'list' ? (
        <section className={styles.section} role="group" aria-labelledby={columnsLabelId}>
          <span className={styles.label} id={columnsLabelId}>
            Columns
          </span>
          <div className={styles.columns}>
            {PROJECT_COLUMN_ORDER.map((value) => (
              <Checkbox
                key={value}
                className={styles.column}
                label={PROJECT_COLUMN_LABELS[value]}
                checked={columns.has(value)}
                onChange={(event) => onColumn(value, event.target.checked)}
              />
            ))}
          </div>
          {sameProjectColumns(display.columns, DEFAULT_PROJECT_DISPLAY.columns) ? null : (
            <p className={styles.changed}>
              Default:{' '}
              {DEFAULT_PROJECT_DISPLAY.columns
                .map((value) => PROJECT_COLUMN_LABELS[value])
                .join(', ')}
            </p>
          )}
        </section>
      ) : null}

      {display.layout === 'timeline' ? (
        <>
          <Select
            label="Zoom"
            value={display.zoom}
            onChange={(event) => onChange({ zoom: event.target.value as ProjectTimelineZoom })}
          >
            {ZOOM_ORDER.map((value) => (
              <option key={value} value={value}>
                {ZOOM_LABELS[value]}
              </option>
            ))}
          </Select>
          <Checkbox
            label="Show dependencies"
            checked={display.showDependencies}
            onChange={(event) => onChange({ showDependencies: event.target.checked })}
          />
          <Checkbox
            label="Show milestones"
            checked={display.showMilestones}
            onChange={(event) => onChange({ showMilestones: event.target.checked })}
          />
        </>
      ) : null}
    </div>,
    document.body,
  );
}
