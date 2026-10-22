import { detectPlatform, parseKeySpec } from './matcher';
import type { Chord, Platform } from './types';

/**
 * The accessibility tree's spelling of a shortcut, which is not the product's.
 *
 * `formatChord` draws what a person reads — `⌘K` on a Mac, `Ctrl+K` elsewhere — and that
 * string is worthless in `aria-keyshortcuts`, which is parsed rather than read: a screen
 * reader is meant to recover the modifiers and the key from it and announce them in the
 * user's own language. ARIA therefore fixes the vocabulary to the UI Events key values —
 * `Meta`, `Control`, `Shift`, `Alt`, `AltGraph` for modifiers, and the `KeyboardEvent.key`
 * name for everything else — so `⌘⇧K` is `Meta+Shift+K` and `⌥↑` is `Alt+ArrowUp`.
 *
 * That is the whole reason this lives beside the matcher instead of in a component: the
 * chord is already parsed once, and a second hand-written spelling of the same binding is
 * a second thing to keep in step.
 */

/**
 * The matcher's normalised key names are already the key values ARIA asks for —
 * `ArrowUp`, `Escape`, `PageDown`, `F7` — including the space bar, which it stores as
 * `Space` rather than as the single space `KeyboardEvent.key` reports, and which could
 * not survive in a space-delimited attribute any other way.
 *
 * So only `+` needs translating: `plus` is a name ARIA invents for a key it has spent the
 * delimiter on, not a key value.
 */
function ariaKeyName(key: string): string {
  if (key === '+') return 'plus';
  // Single characters are written as the character; a letter reads better capitalised and
  // the attribute is case-insensitive either way. Longer names are already key values.
  return key.length === 1 ? key.toUpperCase() : key;
}

function ariaChord(chord: Chord): string {
  const parts: string[] = [];
  // Modifier order is not significant to a parser, so this follows the order the
  // non-Apple display spelling already uses — one less convention in the codebase.
  if (chord.ctrl) parts.push('Control');
  if (chord.alt) parts.push('Alt');
  // Shift is emitted whenever it is held, including on punctuation where the matcher
  // ignores it: the attribute describes the keys a person presses, and on the layout the
  // binding was written for `shift+/` is two keys.
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push('Meta');
  parts.push(ariaKeyName(chord.key));
  return parts.join('+');
}

/**
 * ariaKeyShortcuts renders a key spec for the `aria-keyshortcuts` attribute, or returns
 * `undefined` when the spec has no honest representation there.
 *
 * The `undefined` case is a multi-chord sequence such as `g i`, and it is a deliberate
 * omission rather than a gap. The attribute's value is a space-delimited list of
 * *alternative* shortcuts — `"Meta+C Meta+Shift+C"` means either one activates the
 * control — so writing `"G I"` would tell a screen reader that `G` alone works and that
 * `I` alone works, and both are false. There is no syntax for "then", so the choice is
 * between saying nothing and saying something wrong, and a control whose shortcut is a
 * sequence keeps its tooltip and its place in the help overlay regardless.
 *
 * `platform` is threaded through because `mod` resolves to Meta on Apple hardware and
 * Control everywhere else, and the announcement has to match the keyboard in front of
 * the person rather than the one the binding was written on.
 */
export function ariaKeyShortcuts(
  spec: string,
  platform: Platform = detectPlatform(),
): string | undefined {
  const chords = parseKeySpec(spec, platform);
  if (chords.length !== 1) return undefined;
  return ariaChord(chords[0]!);
}
