import { KeymapRegistry } from './registry';

/**
 * The keymap package. Everything the rest of the client needs to know about the keyboard
 * is exported from here, and nothing outside this directory may listen for a key —
 * CI greps for `onKeyDown` and friends and fails the build.
 */

export type {
  Action,
  ActionContext,
  ActionSource,
  Chord,
  Context,
  KeyboardEventLike,
  Platform,
} from './types';
export { CONTEXTS } from './types';

export {
  chordFromEvent,
  chordId,
  chordSequencesEqual,
  chordsEqual,
  detectPlatform,
  formatChord,
  formatChords,
  formatKeySpec,
  isModifierChord,
  parseKeySpec,
  SequenceMatcher,
  DEFAULT_SEQUENCE_TIMEOUT_MS,
} from './matcher';
export type { SequenceBinding, SequenceMatcherOptions, SequenceResult } from './matcher';

export { KeymapRegistry } from './registry';
export type { KeymapOptions } from './registry';

/**
 * keymap is *the* registry — the one the app registers into, the one the command menu
 * lists, the one the help overlay is generated from, and the one the single key listener
 * consults.
 *
 * A module-level instance rather than a React context because the registry outlives and
 * underlies the component tree: a shortcut is a property of the application, not of
 * whichever provider happens to be mounted, and passing it through props is exactly the
 * pressure that makes a developer give up and write `onKeyDown` instead.
 *
 * Construct a `KeymapRegistry` directly only in tests, or where an injected
 * ActionContext is genuinely needed; two live registries mean two answers to "what does
 * this key do", which is the thing this design exists to prevent.
 */
export const keymap = new KeymapRegistry();
