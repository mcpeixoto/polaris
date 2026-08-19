/**
 * The vocabulary of the keymap. Nothing in this file executes; it exists so that the
 * matcher, the registry, the command menu and the help overlay all agree on what an
 * action *is* before any of them is written.
 */

/**
 * Context names the surface a keystroke lands on. It is deliberately a closed union
 * rather than an open string: a typo in `when` would otherwise register a binding into a
 * context that is never active, and the shortcut would simply never fire — the exact
 * class of bug the central registry exists to make impossible.
 *
 * `global` is the floor. Every other context is pushed on top of it and popped again,
 * and `global` is the only context that is always reachable.
 */
export type Context = 'global' | 'list' | 'detail' | 'editor' | 'modal' | 'menu';

/**
 * CONTEXTS is the enumeration behind the union, for callers that need to iterate (a
 * settings screen listing shortcuts per surface, a test asserting exhaustiveness). It is
 * ordered outermost-first, which is also the order a chain falls back through.
 */
export const CONTEXTS: readonly Context[] = ['global', 'list', 'detail', 'editor', 'modal', 'menu'];

/**
 * Platform decides what `mod` means and how a chord is drawn. Only two values exist
 * because only two conventions exist: Apple platforms put the primary modifier on
 * Command and draw it as a glyph, everything else puts it on Control and spells it out.
 */
export type Platform = 'mac' | 'other';

/**
 * KeyboardEventLike is the subset of `KeyboardEvent` the matcher reads. Depending on the
 * DOM type would drag jsdom into every test of the matching rules, which are pure logic
 * and the part most likely to be wrong; a real `KeyboardEvent` satisfies this shape, so
 * production code passes the event straight through.
 *
 * `code` is optional because tests construct minimal events, but production events always
 * carry it and the matcher needs it: on Apple keyboards Alt composes characters, so
 * Alt+P arrives with `key: 'π'` and only `code: 'KeyP'` still says which key was struck.
 */
export interface KeyboardEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /**
   * A held key's repeats. Optional because tests construct minimal events; a real
   * `keydown` always carries it. Navigation may honour repeats; a toggle must not.
   */
  readonly repeat?: boolean;
}

/**
 * Chord is one simultaneous press: a key plus the modifiers held with it. A shortcut is
 * a *list* of chords, so that `g i` and `mod+k` are the same kind of thing and sequences
 * need no second code path.
 *
 * `mod` is resolved away at parse time — a chord always names concrete `ctrl`/`meta` —
 * so that comparing a parsed spec to a live event is a field comparison with no
 * platform lookup in the hot path.
 */
export interface Chord {
  /**
   * The logical key, normalised: single characters lowercased (`'k'`, `'?'`), named keys
   * in DOM spelling (`'Escape'`, `'ArrowUp'`), and the space bar as `'Space'` because a
   * literal space is the sequence separator.
   */
  readonly key: string;
  /**
   * The physical key, present only on chords derived from events. It is the fallback for
   * keystrokes whose `key` the layout mangled, never the primary identity: a Dvorak user
   * pressing the key that types `v` means `v`, not the QWERTY letter under their finger.
   */
  readonly code?: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/**
 * ActionSource records how an action was reached. It travels to `run` because the same
 * action legitimately behaves differently per entry point — a command-menu invocation
 * has no event to `preventDefault`, and a context-menu invocation already knows its
 * target — and because "which surface fired this" is the first question asked of any
 * telemetry the product later grows.
 */
export type ActionSource = 'key' | 'menu' | 'context-menu' | 'api';

/**
 * ActionContext is what an action is handed when it runs. It carries dispatch facts
 * only: the registry fills these in itself, so an action can always trust them.
 *
 * It deliberately does not carry the store, the router or a toaster. Actions import what
 * they need like any other module; threading application services through the keymap
 * would make this package depend on every feature it dispatches into, and the direction
 * of that dependency is the whole reason the registry can be tested in isolation.
 * Where injection *is* wanted — tests, or a feature that must be constructed per
 * workspace — extend this interface and parameterise the registry with it.
 */
export interface ActionContext {
  readonly source: ActionSource;
  /** The context whose binding matched, not necessarily the innermost one active. */
  readonly context: Context;
  /** The keystroke that fired this, absent for menu and programmatic invocations. */
  readonly event?: KeyboardEventLike;
}

/**
 * Action is the single unit of behaviour in the client. Every command in the product is
 * registered exactly once as one of these, and the command menu, the help overlay, the
 * context menus and the key handler are all views over that registration — none of them
 * owns a shortcut, and none of them can drift from the others.
 *
 * The consequence to accept: a behaviour that is not an Action is unreachable by
 * keyboard, invisible in help, and absent from the command menu. That is the intended
 * pressure. Write the Action first.
 */
export interface Action<Ctx extends ActionContext = ActionContext> {
  /**
   * Stable and dot-namespaced (`issue.create`). Stable because it is what the command
   * menu's recency ranking, user rebindings and telemetry all key on; renaming one is a
   * migration, not a rename.
   */
  readonly id: string;
  /** Sentence-case label, shown verbatim in the command menu and the help overlay. */
  readonly title: string;
  /**
   * Bindings, each either a chord (`'mod+k'`) or a space-separated sequence (`'g i'`).
   * Omitted or empty means the action is reachable from the command menu and menus but
   * has no shortcut — which is the normal case for most of a mature product.
   */
  readonly keys?: readonly string[];
  /** Where the binding applies. Defaults to `'global'`, i.e. everywhere. */
  readonly when?: Context | readonly Context[];
  /** Help-overlay section: 'Issues', 'Navigation', 'Selection'. */
  readonly group: string;
  readonly run: (ctx: Ctx) => void | Promise<void>;
  /**
   * Fired on the matching key's `keyup`, for hold-to-preview: Space opens on the way
   * down and this decides whether to keep it (a tap) or put it away (a hold).
   */
  readonly keyup?: (ctx: Ctx) => void;
  /**
   * A held key's extra `keydown`s are ignored. Toggles need this — Space opening Peek
   * twenty times a second is the bug — and navigation does not, because holding `J`
   * should walk the list.
   */
  readonly ignoreRepeat?: boolean;
  /**
   * Gate for actions that only make sense sometimes — "Assign to…" with nothing
   * selected. A disabled action is treated as unbound, so the keystroke falls through to
   * an outer context instead of being silently swallowed.
   */
  readonly enabled?: (ctx: Ctx) => boolean;
  /**
   * Registered and bound, but not offered in the command menu. For actions whose title
   * would be noise in a searchable list — `Escape`, arrow navigation — that still belong
   * in one registry so the help overlay and the conflict check can see them.
   */
  readonly hidden?: boolean;
}
