import { useEffect, useId, useRef, useState } from 'react';

import { Input } from './Input';
import styles from './ColorPicker.module.css';

/**
 * The swatches offered first.
 *
 * These are literals, and they are the one kind this component is allowed to hold: a label's
 * colour is *data* — written to the row, sent over the wire, rendered by every client and by
 * every theme — so it cannot be a custom property. There is no `var()` that survives being
 * stored in Postgres.
 *
 * What the grid is not is a restriction. The hex field beside it takes any value, which is
 * the argument the two stylesheets that resisted a palette were making; they were right that
 * a workspace decides its own colours and wrong that the conclusion is an unlabelled OS
 * swatch with no readable value in it. A default and a warning take nothing away.
 *
 * All sixteen clear 3:1 against *both* page colours, which is what the non-text contrast rule
 * asks of a glyph that carries meaning — a `StateIcon`'s ring, a `LabelChip`. That is a
 * narrower band than it sounds: a colour bright enough to read on the dark page is usually
 * too pale for the light one, which is why the set is mid-tone throughout and why the pastels
 * a picker would otherwise offer are not here. `ColorPicker.test.tsx` checks every one of
 * them, so a swatch cannot be swapped for a prettier value that fails.
 */
export const SWATCHES: readonly string[] = [
  '#64748b',
  '#ef4444',
  '#ea580c',
  '#d97706',
  '#65a30d',
  '#16a34a',
  '#059669',
  '#0d9488',
  '#0891b2',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#c026d3',
  '#d946ef',
  '#db2777',
  '#ec4899',
];

export interface ColorPickerProps {
  /** Names what is being coloured: "Colour of Bug". Required — it is the group's name. */
  label: string;
  /** The stored value, `#rrggbb`. */
  value: string;
  /**
   * Called once per chosen colour, never per frame.
   *
   * The native picker's `onChange` is the DOM `input` event, which fires continuously while
   * the picker is dragged — so the previous version of this control emitted dozens of
   * mutations for one colour, each with its own version and change row, fanned out to every
   * other client. Everything here commits on a discrete act instead.
   */
  onChange: (color: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/** `#rgb` and `#rrggbb`, the two forms a person types. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;

export function ColorPicker({ label, value, onChange, disabled, className }: ColorPickerProps) {
  const [draft, setDraft] = useState(value);
  // The value the parent last told us about, so an edit from elsewhere — another client's
  // delta — replaces a draft nobody is typing into rather than being overwritten by it.
  const known = useRef(value);
  useEffect(() => {
    if (known.current !== value) {
      known.current = value;
      setDraft(value);
    }
  }, [value]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (!HEX.test(trimmed)) {
      setDraft(value);
      return;
    }
    const full = expand(trimmed).toLowerCase();
    known.current = full;
    setDraft(full);
    if (full !== value.toLowerCase()) onChange(full);
  };

  const faint = contrastRatio(value) < 3;

  // A trigger and a popover, not a permanent grid. Sixteen swatches per label row turned the
  // labels page into a wall of colour where the names were the hardest thing to find; the
  // colour is one property of the row and is drawn as one control until it is being changed.
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={[styles.root, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={styles.current}
          // Inline because the value is data. Every other colour in this component comes
          // from the token layer.
          style={{ backgroundColor: normalise(value) }}
          aria-hidden="true"
        />
        <span className={styles.value}>{value.toLowerCase()}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-label={`${label}: choose a colour`}
          onKeyDown={
            /* keymap-lint-allow: Escape closes this popover the way it closes every other
               layer; the registry has no context for a picker that is not a Menu. */ (event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              close();
            }
          }
        >
          <div className={styles.swatches}>
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={styles.swatch}
                style={{ backgroundColor: swatch }}
                aria-label={swatch}
                aria-pressed={swatch.toLowerCase() === value.toLowerCase()}
                disabled={disabled}
                onClick={() => {
                  commit(swatch);
                  close();
                }}
              />
            ))}
          </div>

          <div className={styles.custom}>
            <Input
              label="Hex"
              hideLabel
              className={styles.hex}
              value={draft}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              maxLength={7}
              aria-label={`${label}: hex value`}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => commit(event.target.value)}
              onKeyDown={
                /* keymap-lint-allow: supplies the activation a form would have given Enter, for a field that may not be in one */ (
                  event,
                ) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  commit(event.currentTarget.value);
                }
              }
            />
            <input
              type="color"
              className={styles.native}
              value={normalise(value)}
              disabled={disabled}
              aria-label={`${label}: colour picker`}
              // `onBlur`, not `onChange`. The DOM `change` event on a colour input is the one
              // that means "the user is done"; React's `onChange` is `input` and fires per frame.
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => commit(event.target.value)}
            />
          </div>

          {faint ? (
            <p className={styles.warning} role="status">
              This colour is faint against at least one of the two page colours. A label is drawn on
              both.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** `#abc` → `#aabbcc`. Anything already long comes back unchanged. */
function expand(hex: string): string {
  if (hex.length !== 4) return hex;
  const [, r, g, b] = hex;
  return `#${r ?? ''}${r ?? ''}${g ?? ''}${g ?? ''}${b ?? ''}${b ?? ''}`;
}

/** A value the native input will accept — it refuses anything but `#rrggbb`. */
function normalise(hex: string): string {
  const expanded = expand(hex.trim());
  return HEX.test(expanded) ? expanded.toLowerCase() : '#000000';
}

/**
 * The worse of the colour's two contrast ratios, against white and against near-black.
 *
 * A label colour is chosen once and then rendered on every issue row in both themes, so the
 * question is not "does it work here" but "does it work on either page". Taking the minimum
 * is what makes the warning honest.
 *
 * The two grounds are the light and dark page colours as literals rather than as tokens,
 * because this is arithmetic and not paint: it has to be done against a number, and reading
 * a custom property back out of the cascade to get one would make the check depend on where
 * the component happened to be mounted.
 */
export function contrastRatio(hex: string): number {
  const rgb = parse(hex);
  if (rgb === null) return 21;
  const l = luminance(rgb);
  const onLight = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (0.0233 + 0.05);
  return Math.min(onLight, onDark);
}

function parse(hex: string): [number, number, number] | null {
  const expanded = expand(hex.trim());
  if (!HEX.test(expanded)) return null;
  return [
    Number.parseInt(expanded.slice(1, 3), 16) / 255,
    Number.parseInt(expanded.slice(3, 5), 16) / 255,
    Number.parseInt(expanded.slice(5, 7), 16) / 255,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
