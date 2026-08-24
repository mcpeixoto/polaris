/**
 * Display menu for the projects list — list vs timeline and timeline zoom.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Select } from '~/components';
import { usePresence } from '~/hooks/usePresence';
import {
  changedProjectDisplayCount,
  DEFAULT_PROJECT_DISPLAY,
  type ProjectDisplayOptions,
  type ProjectLayout,
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

const LAYOUT_LABELS: Readonly<Record<ProjectLayout, string>> = {
  list: 'List',
  timeline: 'Timeline',
};

const ZOOM_LABELS: Readonly<Record<ProjectTimelineZoom, string>> = {
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

const LAYOUT_ORDER: readonly ProjectLayout[] = ['list', 'timeline'];
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
        <div className={styles.segment}>
          {LAYOUT_ORDER.map((value) => (
            <Button
              key={value}
              variant={display.layout === value ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onChange({ layout: value })}
              aria-pressed={display.layout === value}
            >
              {LAYOUT_LABELS[value]}
            </Button>
          ))}
        </div>
      </section>

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
