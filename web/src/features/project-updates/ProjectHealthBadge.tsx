/**
 * Health badge for a project update — on track, at risk, or off track.
 *
 * The glyph and the word travel together, always. Health is the one thing on a project list
 * a reader scans for, and a bare coloured mark puts the whole meaning in a hue: the third
 * of readers who cannot separate amber from green would be reading a list that says
 * nothing. The glyph is the fast path — and since it is a tick, a bang or a cross rather
 * than a disc, it is a fast path that works in greyscale; the word is the answer.
 *
 * `HealthDot` is the older disc on its own, for the one place the word is already supplied
 * by something else — the leading glyph inside a health `<select>`, where the chosen
 * option *is* the text.
 */

import type { ProjectUpdateHealth } from '~/store';

import { HealthGlyph } from './glyphs';
import { PROJECT_UPDATE_HEALTH_LABEL, PROJECT_UPDATE_HEALTH_TOKEN } from './helpers';
import styles from './ProjectHealthBadge.module.css';

interface ProjectHealthBadgeProps {
  readonly health: ProjectUpdateHealth;
  readonly compact?: boolean | undefined;
  /**
   * How old the update is — "8w" — drawn after the word as "At risk · 8w". Its own span,
   * so the word stays a text node of its own and a test or a screen reader can find it.
   */
  readonly since?: string | undefined;
}

export function ProjectHealthBadge({ health, compact = false, since }: ProjectHealthBadgeProps) {
  return (
    <span
      className={compact ? styles.compact : styles.badge}
      style={{ color: `var(${PROJECT_UPDATE_HEALTH_TOKEN[health]})` }}
    >
      <HealthGlyph health={health} />
      <span>{PROJECT_UPDATE_HEALTH_LABEL[health]}</span>
      {since === undefined ? null : <span className={styles.since}>· {since}</span>}
    </span>
  );
}

/**
 * The dot alone. Decorative by construction — it is only ever drawn beside its own word,
 * so there is nothing here for a screen reader that the text does not already say.
 */
export function HealthDot({ health }: { readonly health: ProjectUpdateHealth }) {
  // `color` rather than `background`, because the disc is drawn by the box's ::before and
  // painted with currentColor. A background here would fill the whole 16px glyph box.
  return (
    <span
      className={styles.dot}
      style={{ color: `var(${PROJECT_UPDATE_HEALTH_TOKEN[health]})` }}
      aria-hidden="true"
    />
  );
}
