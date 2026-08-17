import { useMemo } from 'react';

import { detectPlatform, formatChord, parseKeySpec, type Platform } from '../keys';
import styles from './Kbd.module.css';

export interface KbdProps {
  /**
   * A key spec in the keymap's own grammar — `'mod+k'`, `'shift+/'`, `'g i'`. Deliberately
   * the same string the action was registered with, so a hint is copied from the registry
   * rather than transcribed from it.
   */
  keys: string;
  /** Overridable so a test, or a "shortcuts on Windows" doc, can draw the other convention. */
  platform?: Platform | undefined;
  className?: string | undefined;
}

/**
 * Kbd draws a shortcut the way the host platform draws it: `⌘K` on Apple, `Ctrl+K`
 * elsewhere, `G I` for a sequence.
 *
 * It takes the spec and not the drawn string because the drawn string is platform
 * dependent, and a hand-written `⌘K` in a menu is a lie on Windows the moment someone
 * looks at it. Everything about how a chord is spelled lives in web/src/keys — this
 * component is the registry's handwriting, not a second opinion.
 *
 * An unreadable spec throws, here as everywhere else in the keymap. A shortcut hint that
 * silently renders nothing is how a binding stays broken for a release; failing loudly in
 * development is the whole reason the spec grammar validates at all.
 */
export function Kbd({ keys, platform, className }: KbdProps) {
  const resolved = platform ?? detectPlatform();
  const chords = useMemo(() => parseKeySpec(keys, resolved), [keys, resolved]);

  return (
    <span className={[styles.kbd, className].filter(Boolean).join(' ')}>
      {chords.map((chord, index) => (
        // Index as key: the list is derived from one immutable string, so a chord's
        // position in it is its identity.
        <kbd key={index} className={styles.key}>
          {formatChord(chord, resolved)}
        </kbd>
      ))}
    </span>
  );
}
