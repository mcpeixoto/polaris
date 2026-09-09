/**
 * The one way a project's or initiative's icon is drawn.
 *
 * The `icon` column holds one of three things: nothing, an emoji (or any short text a person
 * typed), or an `icon:<name>` token naming a line glyph from `./glyphs`. Before this
 * component every surface that showed a project — the list row, the board card, the shell's
 * breadcrumb mark, the issue list's project pill, the rail — carried its own copy of
 * `icon === '' ? <ProjectGlyph /> : <span style={{color}}>{icon}</span>`, and the moment a
 * second kind of value existed, every copy was wrong in the same way. This is that branch,
 * written once, with the token case added.
 *
 * The colour is applied inline because it is workspace data, not a design decision — the
 * same reason `LabelChip` and `ColorPicker` do. Every other value here is a token.
 */

import type { CSSProperties, ReactNode } from 'react';

import { iconGlyph, iconTokenName } from './glyphs';
import styles from './EntityIcon.module.css';

export type EntityIconSize = 'sm' | 'md' | 'lg';

export interface EntityIconProps {
  /** The stored value: an emoji, an `icon:<name>` token, or nothing. */
  readonly icon: string | undefined;
  /** The stored colour, `#rrggbb`. Empty or undefined leaves the glyph in the text colour. */
  readonly color: string | undefined;
  /** Drawn when there is no icon — the generic shape for the kind of entity. */
  readonly fallback: ReactNode;
  /** `sm` is a table row (14px), `md` a pill or header (16px), `lg` the detail mark (20px). */
  readonly size?: EntityIconSize | undefined;
  readonly className?: string | undefined;
}

const PX: Record<EntityIconSize, number> = { sm: 14, md: 16, lg: 20 };

export function EntityIcon({ icon, color, fallback, size = 'sm', className }: EntityIconProps) {
  if (icon === undefined || icon === '') return <>{fallback}</>;

  const tint: CSSProperties | undefined =
    color === undefined || color === '' ? undefined : { color };
  const classes = [styles.root, styles[size], className].filter(Boolean).join(' ');

  const name = iconTokenName(icon);
  if (name !== null) {
    const glyph = iconGlyph(name);
    // A token this build has no glyph for — a name renamed, or written by a newer client —
    // falls back to the generic shape rather than printing `icon:whatever` in a table cell.
    if (glyph === undefined) return <>{fallback}</>;
    const px = PX[size];
    return (
      <span className={classes} style={tint} aria-hidden="true" data-icon={name}>
        <svg
          width={px}
          height={px}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={glyph.path} />
        </svg>
      </span>
    );
  }

  return (
    <span className={classes} style={tint} aria-hidden="true">
      {icon}
    </span>
  );
}
