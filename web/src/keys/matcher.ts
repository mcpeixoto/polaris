import type { Chord, KeyboardEventLike, Platform } from './types';

/**
 * The matching rules, kept pure and DOM-free.
 *
 * Everything that decides whether a keystroke *is* a shortcut lives in this file, and
 * nothing in it touches `window`, `document` or a real `KeyboardEvent`. That is not
 * fastidiousness: key matching is where the subtle bugs live (dead keys, layouts, Shift
 * on punctuation, half-typed sequences) and those bugs are only cheap to find if the
 * rules can be exercised as a table of plain objects.
 */

const FUNCTION_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [`f${i + 1}`, `F${i + 1}`]),
);

/** Spec spelling → the DOM `KeyboardEvent.key` value we normalise everything onto. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  ...FUNCTION_KEYS,
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  insert: 'Insert',
  ins: 'Insert',
  // Named aliases for characters the spec grammar would otherwise eat or that are
  // ambiguous to read in source.
  plus: '+',
  minus: '-',
  comma: ',',
  period: '.',
  dot: '.',
  slash: '/',
  backslash: '\\',
};

/** Keys that are only a modifier. Held alone they are not a chord, they are a prefix. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'OS',
  'Hyper',
  'Super',
]);

/**
 * detectPlatform reads the host without requiring a DOM. It is the default for every
 * platform-dependent function here so that call sites stay short, and it is always
 * overridable so that tests can assert both conventions without pretending to be a Mac.
 */
export function detectPlatform(): Platform {
  const nav = (globalThis as { navigator?: { userAgent?: string; platform?: string } }).navigator;
  const hint = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(hint) ? 'mac' : 'other';
}

function isLatinCharacter(key: string): boolean {
  return key.length === 1 && /[a-z0-9]/.test(key);
}

/**
 * Shift is part of a chord's identity for letters, digits and named keys — `⇧↑` is a
 * different gesture from `↑`, and `⇧X` from `X`. It is *not* part of the identity of a
 * punctuation key, because there the layout decides: `?` is Shift+/ on a US keyboard and
 * an unshifted key elsewhere, and a binding on `?` means the character, not the gesture.
 */
function shiftIsSignificant(key: string): boolean {
  return key.length > 1 || isLatinCharacter(key);
}

/** The character a physical key would produce on a Latin layout, if we can tell. */
function keyForCode(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return undefined;
}

/**
 * The physical fallback, used only when the logical key is untrustworthy — Alt+P
 * arriving as `π`, a dead key, an IME artefact. When the layout hands us a plain letter
 * or digit we take it at face value, because a Dvorak user pressing the key that types
 * `v` means `v` and would be baffled to trigger the shortcut printed on the QWERTY cap.
 */
function physicalFallbackKey(chord: Chord): string | undefined {
  if (isLatinCharacter(chord.key)) return undefined;
  return keyForCode(chord.code);
}

function normaliseEventKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) return key.toLowerCase();
  const named = NAMED_KEYS[key.toLowerCase()];
  return named ?? key;
}

/**
 * Spec keys are validated, event keys are not. A browser may hand us anything; a
 * developer writing `'excape'` has made a mistake that must surface at startup rather
 * than as a shortcut that mysteriously never fires.
 */
function normaliseSpecKey(raw: string, spec: string): string {
  if (raw.length === 1) return raw.toLowerCase();
  const named = NAMED_KEYS[raw.toLowerCase()];
  if (named === undefined) {
    throw new Error(`key spec "${spec}" names an unknown key "${raw}"`);
  }
  return named;
}

function makeChord(
  key: string,
  mods: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean },
  code?: string,
): Chord {
  return code === undefined
    ? { key, ctrl: mods.ctrl, meta: mods.meta, shift: mods.shift, alt: mods.alt }
    : { key, code, ctrl: mods.ctrl, meta: mods.meta, shift: mods.shift, alt: mods.alt };
}

function parseChord(token: string, spec: string, platform: Platform): Chord {
  const mods = { ctrl: false, meta: false, shift: false, alt: false };
  let key: string | undefined;

  // '+' is the separator, so the plus key is written doubled: 'mod++'. A single
  // trailing '+' stays an error, because it is far likelier to be a slip than a binding.
  let body = token;
  if (body === '+') {
    return makeChord('+', mods);
  }
  if (body.endsWith('++')) {
    body = body.slice(0, -2);
    key = '+';
  }

  for (const part of body.split('+')) {
    if (part === '') continue;
    switch (part.toLowerCase()) {
      case 'mod':
        // The one platform-dependent word in the grammar, resolved here so that nothing
        // downstream has to think about it again.
        if (platform === 'mac') mods.meta = true;
        else mods.ctrl = true;
        break;
      case 'cmd':
      case 'command':
      case 'meta':
      case 'super':
      case 'win':
        mods.meta = true;
        break;
      case 'ctrl':
      case 'control':
        mods.ctrl = true;
        break;
      case 'shift':
        mods.shift = true;
        break;
      case 'alt':
      case 'opt':
      case 'option':
        mods.alt = true;
        break;
      default:
        if (key !== undefined) {
          throw new Error(`key spec "${spec}" names more than one key ("${key}" and "${part}")`);
        }
        key = normaliseSpecKey(part, spec);
    }
  }

  if (key === undefined) {
    throw new Error(`key spec "${spec}" has modifiers but no key`);
  }
  return makeChord(key, mods);
}

/**
 * parseKeySpec turns a written binding into the chords it stands for: `'mod+k'` into
 * one, `'g i'` into two. Sequences are the reason a shortcut is a list rather than a
 * chord — Linear's navigation model is built on them, and a matcher written for single
 * chords has to be rewritten, not extended, to support them.
 *
 * It throws on anything it cannot read. A keymap is loaded at startup, so a malformed
 * spec should stop the app in development rather than produce a key that does nothing.
 */
export function parseKeySpec(spec: string, platform: Platform = detectPlatform()): Chord[] {
  const tokens = spec
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new Error('key spec is empty');
  }
  return tokens.map((token) => parseChord(token, spec, platform));
}

/**
 * chordFromEvent normalises a keystroke into the same shape a spec parses into, so that
 * matching is a comparison between like and like rather than a pile of special cases at
 * the call site.
 */
export function chordFromEvent(e: KeyboardEventLike): Chord {
  return makeChord(
    normaliseEventKey(e.key),
    { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey },
    e.code,
  );
}

/**
 * isModifierChord reports a press of a modifier on its own. The key handler must ignore
 * these rather than treat them as a non-matching chord: reaching for Shift halfway
 * through `g i` would otherwise cancel the sequence the user is in the middle of typing.
 */
export function isModifierChord(chord: Chord): boolean {
  return MODIFIER_KEYS.has(chord.key);
}

/**
 * chordsEqual is the matching rule itself. Modifiers must agree exactly, except for
 * Shift on punctuation where the layout — not the user — decides. The key matches
 * logically, or physically when the layout produced something we cannot read.
 */
export function chordsEqual(a: Chord, b: Chord): boolean {
  if (a.ctrl !== b.ctrl || a.meta !== b.meta || a.alt !== b.alt) return false;
  if (shiftIsSignificant(a.key) || shiftIsSignificant(b.key)) {
    if (a.shift !== b.shift) return false;
  }
  if (a.key === b.key) return true;
  return physicalFallbackKey(a) === b.key || physicalFallbackKey(b) === a.key;
}

/** chordSequencesEqual compares whole bindings, e.g. the two chords of `g i`. */
export function chordSequencesEqual(a: readonly Chord[], b: readonly Chord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((chord, i) => {
    const other = b[i];
    return other !== undefined && chordsEqual(chord, other);
  });
}

/**
 * chordId is a chord's identity as a string, used by the registry to detect that two
 * actions claimed the same binding. It encodes Shift only where Shift is significant, so
 * that `'shift+/'` and `'/'` — which the matcher cannot tell apart — collide loudly at
 * registration instead of quietly at runtime.
 */
export function chordId(chord: Chord): string {
  const mods =
    (chord.ctrl ? 'c' : '') +
    (chord.meta ? 'm' : '') +
    (chord.alt ? 'a' : '') +
    (chord.shift && shiftIsSignificant(chord.key) ? 's' : '');
  return `${mods}|${chord.key}`;
}

const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
  Enter: '⏎',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
};

const OTHER_KEY_LABELS: Readonly<Record<string, string>> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Del',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
};

/**
 * formatChord draws a chord the way the host platform draws it: `⌘K` on Apple, `Ctrl+K`
 * everywhere else. The help overlay and the command menu both render through this, which
 * is the point — a hand-written `⌘K` in a component would be a lie on Windows the moment
 * someone changes a binding.
 */
export function formatChord(chord: Chord, platform: Platform = detectPlatform()): string {
  const labels = platform === 'mac' ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
  const key = labels[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);

  if (platform === 'mac') {
    // Apple's canonical modifier order, which readers of Mac apps expect: ⌃⌥⇧⌘.
    return (
      (chord.ctrl ? '⌃' : '') +
      (chord.alt ? '⌥' : '') +
      (chord.shift ? '⇧' : '') +
      (chord.meta ? '⌘' : '') +
      key
    );
  }

  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** formatChords draws a whole binding; the chords of a sequence read as `G I`. */
export function formatChords(
  chords: readonly Chord[],
  platform: Platform = detectPlatform(),
): string {
  return chords.map((chord) => formatChord(chord, platform)).join(' ');
}

/** formatKeySpec is the shorthand the help overlay uses: a written spec, drawn. */
export function formatKeySpec(spec: string, platform: Platform = detectPlatform()): string {
  return formatChords(parseKeySpec(spec, platform), platform);
}

/** A binding the matcher can resolve: an action id and the chords that reach it. */
export interface SequenceBinding {
  readonly id: string;
  readonly chords: readonly Chord[];
}

/**
 * What one chord did to the matcher. `pending` matters as much as `match`: a keystroke
 * that opened a sequence has been consumed and must not also reach the page, or typing
 * `g` would scroll a list while waiting for the `i`.
 */
export type SequenceResult<B extends SequenceBinding = SequenceBinding> =
  | { readonly type: 'none' }
  | { readonly type: 'pending'; readonly chords: readonly Chord[] }
  | { readonly type: 'match'; readonly id: string; readonly binding: B };

/** How long a half-typed sequence stays live. A second is roughly Linear's feel. */
export const DEFAULT_SEQUENCE_TIMEOUT_MS = 1000;

export interface SequenceMatcherOptions {
  readonly timeoutMs?: number;
  /** Injectable clock. Tests advance it; production passes nothing and gets Date.now. */
  readonly now?: () => number;
}

/**
 * SequenceMatcher holds the one piece of state key matching needs: how much of a
 * sequence has been typed so far.
 *
 * The timeout is evaluated lazily, when the next chord arrives, rather than by a timer.
 * A pending prefix has no observable effect until something follows it, so a timer would
 * buy nothing and cost a scheduler entry per keystroke plus a cleanup path per unmount —
 * and it would make these tests need fake timers instead of a counter.
 */
export class SequenceMatcher {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private pendingChords: Chord[] = [];
  private lastAt = 0;

  constructor(options: SequenceMatcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SEQUENCE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** The chords typed so far, for a UI that wants to show `G…` while waiting. */
  get pending(): readonly Chord[] {
    return this.pendingChords;
  }

  reset(): void {
    this.pendingChords = [];
    this.lastAt = 0;
  }

  /**
   * feed advances the matcher by one chord against the bindings currently in scope.
   *
   * Bindings are supplied per call rather than held, because which ones apply depends on
   * the active context and on each action's `enabled` gate — both of which can change
   * between two keystrokes of the same sequence.
   *
   * The first exact match wins, so callers order bindings innermost-context-first.
   */
  feed<B extends SequenceBinding>(
    chord: Chord,
    bindings: readonly B[],
    at: number = this.now(),
  ): SequenceResult<B> {
    if (this.pendingChords.length > 0 && at - this.lastAt > this.timeoutMs) {
      this.reset();
    }

    const attempt = [...this.pendingChords, chord];

    for (const binding of bindings) {
      if (
        binding.chords.length === attempt.length &&
        chordSequencesEqual(binding.chords, attempt)
      ) {
        this.reset();
        return { type: 'match', id: binding.id, binding };
      }
    }

    for (const binding of bindings) {
      if (
        binding.chords.length > attempt.length &&
        chordSequencesEqual(binding.chords.slice(0, attempt.length), attempt)
      ) {
        this.pendingChords = attempt;
        this.lastAt = at;
        return { type: 'pending', chords: attempt };
      }
    }

    if (this.pendingChords.length > 0) {
      // A dead prefix must not also eat the keystroke that killed it: after `g x`, an
      // `x` that is bound on its own should still fire. One retry is enough — the
      // pending list is empty by the time we recurse.
      this.reset();
      return this.feed(chord, bindings, at);
    }

    this.reset();
    return { type: 'none' };
  }
}
