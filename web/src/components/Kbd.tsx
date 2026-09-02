import { useMemo } from 'react';

import { detectPlatform, formatChord, parseKeySpec, type Chord, type Platform } from '../keys';
import styles from './Kbd.module.css';

/**
 * Which ground the chips are drawn on.
 *
 * A key cap is a small filled box, and a filled box is only visible against a *different*
 * fill. `page` is the default and steps up from the page; `raised` steps up again, for a
 * chip inside a menu, a tooltip or any other panel that has already taken the raised grey.
 * This is the prop that replaced two stylesheets reaching in with a bare `kbd` descendant
 * selector to override the surface — element names are not hashed by CSS modules, so those
 * rules restyled every `<kbd>` in the subtree, including ones written years later.
 */
export type KbdSurface = 'page' | 'raised';

export interface KbdProps {
  /**
   * A key spec in the keymap's own grammar — `'mod+k'`, `'shift+/'`, `'g i'`. Deliberately
   * the same string the action was registered with, so a hint is copied from the registry
   * rather than transcribed from it.
   */
  keys: string;
  surface?: KbdSurface | undefined;
  /** Overridable so a test, or a "shortcuts on Windows" doc, can draw the other convention. */
  platform?: Platform | undefined;
  className?: string | undefined;
}

/**
 * One cap per key that is actually pressed.
 *
 * `⌘⇧K` in a single box draws a chord as though it were one key; three boxes draw it as the
 * three things the hand does. Both halves are asked of `formatChord` rather than spelled
 * here, because how a modifier is written is a platform convention the keymap already owns —
 * the bare key comes from a chord with the modifiers stripped, and the modifiers come from
 * one with the key stripped, which on Apple is a run of glyphs and elsewhere a `+`-joined
 * list. A hand-written `⌘` in this file would be a second opinion, and eventually a wrong one.
 */
function capsOf(chord: Chord, platform: Platform): string[] {
  const key = formatChord(
    { ...chord, ctrl: false, alt: false, shift: false, meta: false },
    platform,
  );
  const drawn = formatChord({ ...chord, key: '' }, platform);
  const modifiers =
    platform === 'mac' ? [...drawn] : drawn.split('+').filter((part) => part !== '');
  return [...modifiers, key];
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
export function Kbd({ keys, surface = 'page', platform, className }: KbdProps) {
  const resolved = platform ?? detectPlatform();
  const chords = useMemo(() => parseKeySpec(keys, resolved), [keys, resolved]);

  return (
    <span className={[styles.kbd, className].filter(Boolean).join(' ')}>
      {chords.map((chord, chordIndex) => (
        // Index as key, twice over: the list is derived from one immutable string, so a
        // chord's position in it — and a cap's position in the chord — is its identity.
        <span key={chordIndex} className={styles.chord}>
          {capsOf(chord, resolved).map((cap, capIndex) => (
            <kbd key={capIndex} className={[styles.key, styles[surface]].join(' ')}>
              {cap}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
