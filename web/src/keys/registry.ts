import {
  chordId,
  chordFromEvent,
  detectPlatform,
  isModifierChord,
  parseKeySpec,
  SequenceMatcher,
  type SequenceBinding,
} from './matcher';
import type { Action, ActionContext, Chord, Context, KeyboardEventLike, Platform } from './types';

/**
 * The registry: one table of every action in the client, and the only thing that turns a
 * keystroke into behaviour.
 *
 * The command menu, the help overlay, the context menus and the key handler are views
 * over this object. None of them owns a shortcut, none of them can disagree with the
 * others about what a key does, and a shortcut that stopped working is a question with
 * exactly one place to look. CI enforces the other half of the bargain by refusing any
 * `onKeyDown` outside this directory.
 */

/** Actions must be dot-namespaced: `issue.create`, `nav.goToMyIssues`. */
const ACTION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * Contexts that mask the ones beneath them. An open modal must not let `j` scroll the
 * list behind it, and a text editor must not let every letter fire a shortcut — so a
 * keystroke that a sealed context does not claim falls straight through to `global`
 * rather than walking back out through the surfaces the user cannot currently see.
 */
const DEFAULT_SEALED_CONTEXTS: readonly Context[] = ['modal', 'menu', 'editor'];

export interface KeymapOptions<Ctx extends ActionContext = ActionContext> {
  /** Decides what `mod` resolves to. Detected from the host unless a test says otherwise. */
  readonly platform?: Platform;
  readonly sequenceTimeoutMs?: number;
  readonly now?: () => number;
  readonly sealedContexts?: readonly Context[];
  /**
   * Where a failing action goes. The default rethrows asynchronously so the error
   * reaches the window's error reporter intact while the key handler survives: one
   * broken action must not take the keyboard down with it.
   */
  readonly onError?: (error: unknown, action: Action<Ctx>) => void;
}

/** One `keys` entry of one action, parsed once at registration. */
interface Binding<Ctx extends ActionContext> extends SequenceBinding {
  readonly id: string;
  readonly chords: readonly Chord[];
  /** Canonical per-chord identities, used for conflict detection rather than matching. */
  readonly chordIds: readonly string[];
  readonly spec: string;
  readonly context: Context;
  readonly action: Action<Ctx>;
}

function isPrefix(a: readonly string[], b: readonly string[]): boolean {
  return a.length <= b.length && a.every((id, i) => b[i] === id);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

export class KeymapRegistry<Ctx extends ActionContext = ActionContext> {
  private readonly actions = new Map<string, Action<Ctx>>();
  private readonly bindings = new Map<Context, Binding<Ctx>[]>();
  private readonly groups = new Map<string, Action<Ctx>[]>();
  private readonly stack: Context[] = ['global'];
  private readonly sealed: ReadonlySet<Context>;
  private readonly platform: Platform;
  private readonly matcher: SequenceMatcher;
  private readonly onError: (error: unknown, action: Action<Ctx>) => void;
  private lastHandledContext: Context = 'global';

  constructor(options: KeymapOptions<Ctx> = {}) {
    this.platform = options.platform ?? detectPlatform();
    this.sealed = new Set(options.sealedContexts ?? DEFAULT_SEALED_CONTEXTS);
    this.onError =
      options.onError ??
      ((error, action) => {
        queueMicrotask(() => {
          const failure = new Error(`keymap action "${action.id}" failed`);
          // Attached rather than passed to the constructor so this file needs nothing
          // from the ES2022 lib; the cause is what makes the report readable.
          (failure as Error & { cause?: unknown }).cause = error;
          throw failure;
        });
      });
    const matcherOptions: { timeoutMs?: number; now?: () => number } = {};
    if (options.sequenceTimeoutMs !== undefined)
      matcherOptions.timeoutMs = options.sequenceTimeoutMs;
    if (options.now !== undefined) matcherOptions.now = options.now;
    this.matcher = new SequenceMatcher(matcherOptions);
  }

  /**
   * register validates an action, claims its keys, and hands back the undo.
   *
   * Everything it can reject, it rejects here — duplicate ids, unreadable specs, two
   * actions on one key in one context. Startup is the only moment when a keymap mistake
   * is cheap; the alternative is a user discovering it, and a bug report that says "the
   * shortcut doesn't work sometimes".
   */
  register(action: Action<Ctx>): () => void {
    if (!ACTION_ID_PATTERN.test(action.id)) {
      throw new Error(
        `action id "${action.id}" is not dot-namespaced (expected something like "issue.create")`,
      );
    }
    if (this.actions.has(action.id)) {
      // Overwriting silently is precisely how a shortcut mysteriously stops working:
      // the loser is a file nobody thinks to open.
      throw new Error(`action "${action.id}" is already registered`);
    }
    if (action.title.trim() === '') {
      throw new Error(
        `action "${action.id}" has no title; it would be invisible in the command menu`,
      );
    }
    if (action.group.trim() === '') {
      throw new Error(`action "${action.id}" has no group; the help overlay has nowhere to put it`);
    }

    const contexts = contextsOf(action.when);
    const parsed: Binding<Ctx>[] = [];
    for (const spec of action.keys ?? []) {
      const chords = parseKeySpec(spec, this.platform);
      const chordIds = chords.map(chordId);
      for (const context of contexts) {
        this.assertNoConflict(action, spec, chordIds, context);
        // Two `keys` entries of one action can still collide with each other.
        for (const pending of parsed) {
          if (pending.context === context && isPrefix(pending.chordIds, chordIds)) {
            throw new Error(
              `action "${action.id}" binds "${pending.spec}" and "${spec}" in context "${context}"; one shadows the other`,
            );
          }
        }
        parsed.push({ id: action.id, chords, chordIds, spec, context, action });
      }
    }

    this.actions.set(action.id, action);
    for (const binding of parsed) {
      const list = this.bindings.get(binding.context);
      if (list === undefined) this.bindings.set(binding.context, [binding]);
      else list.push(binding);
    }
    const group = this.groups.get(action.group);
    if (group === undefined) this.groups.set(action.group, [action]);
    else group.push(action);

    return () => this.unregister(action);
  }

  /**
   * registerAll registers a feature's whole keymap as one unit, rolling back if any of
   * it is rejected. A half-registered feature would report a duplicate-id error on the
   * next attempt and bury the conflict that actually caused the failure.
   */
  registerAll(actions: readonly Action<Ctx>[]): () => void {
    const undo: Array<() => void> = [];
    try {
      for (const action of actions) undo.push(this.register(action));
    } catch (error) {
      for (const off of undo) off();
      throw error;
    }
    return () => {
      for (const off of undo) off();
    };
  }

  get(id: string): Action<Ctx> | undefined {
    return this.actions.get(id);
  }

  /** Every action, in registration order. */
  list(): Action<Ctx>[] {
    return [...this.actions.values()];
  }

  /**
   * listForContext answers "what can the user do right now": the actions declared for
   * this context first, then the global ones, which are available everywhere by
   * definition. Command menus render this and drop the `hidden` ones; keeping that
   * filter at the view means a context menu can still offer what the menu suppresses.
   */
  listForContext(context: Context): Action<Ctx>[] {
    const own: Action<Ctx>[] = [];
    const global: Action<Ctx>[] = [];
    for (const action of this.actions.values()) {
      const contexts = contextsOf(action.when);
      if (contexts.includes(context)) own.push(action);
      else if (contexts.includes('global')) global.push(action);
    }
    return [...own, ...global];
  }

  /**
   * byGroup is the help overlay, which is why it is generated and never hand-written:
   * a shortcut that exists is listed, a shortcut that was removed disappears, and the
   * two cannot drift apart.
   *
   * Only bound actions appear — an action with no key has nothing to say in a keyboard
   * reference — and `hidden` ones do appear, because hiding is about keeping the command
   * menu's search results clean, not about keeping a shortcut secret.
   */
  byGroup(): Map<string, Action<Ctx>[]> {
    const out = new Map<string, Action<Ctx>[]>();
    for (const [group, actions] of this.groups) {
      const bound = actions.filter((action) => (action.keys?.length ?? 0) > 0);
      if (bound.length > 0) out.set(group, bound);
    }
    return out;
  }

  /** The innermost context currently pushed. */
  get activeContext(): Context {
    return this.stack[this.stack.length - 1] ?? 'global';
  }

  /** The stack, outermost first, for debugging and for tests. */
  contextStack(): readonly Context[] {
    return [...this.stack];
  }

  /**
   * pushContext is how a surface takes the keyboard: a list on mount, a modal on open.
   * A half-typed sequence dies with the change, because `g` typed at a list and `i`
   * typed at whatever replaced it were never one gesture.
   */
  pushContext(context: Context): () => void {
    this.stack.push(context);
    this.matcher.reset();
    return () => this.popContext(context);
  }

  /**
   * popContext releases a context. Popping a context that is not on top removes it from
   * where it sits rather than corrupting the stack — surfaces unmount out of order and
   * the alternative is a keyboard that quietly stops responding.
   *
   * The base `global` context is never popped: one unbalanced call would otherwise
   * disable every shortcut in the product.
   */
  popContext(context?: Context): Context | undefined {
    if (this.stack.length <= 1) return undefined;
    const index = context === undefined ? this.stack.length - 1 : this.stack.lastIndexOf(context);
    if (index <= 0) return undefined;
    const [removed] = this.stack.splice(index, 1);
    this.matcher.reset();
    return removed;
  }

  /**
   * handle resolves one keystroke and reports whether it was consumed, so the caller
   * knows whether to `preventDefault`. Returning a boolean rather than calling
   * `preventDefault` here keeps this class free of the DOM, and keeps the decision with
   * the code that owns the event.
   *
   * A chord that only opens a sequence counts as consumed: `g` on its way to `g i` must
   * not also reach the page.
   */
  handle(event: KeyboardEventLike, activeContext: Context, actionCtx: Ctx): boolean {
    const chord = chordFromEvent(event);
    if (isModifierChord(chord)) return false;

    if (activeContext !== this.lastHandledContext) {
      this.matcher.reset();
      this.lastHandledContext = activeContext;
    }

    const chain = this.resolveChain(activeContext);
    const probes = new Map<Context, Ctx>();
    const candidates: Binding<Ctx>[] = [];
    for (const context of chain) {
      for (const binding of this.bindings.get(context) ?? []) {
        const { enabled } = binding.action;
        if (enabled !== undefined) {
          let probe = probes.get(context);
          if (probe === undefined) {
            probe = this.dispatchContext(actionCtx, context, event);
            probes.set(context, probe);
          }
          // A disabled action is treated as unbound so the keystroke can still reach an
          // outer context, rather than being swallowed by a command that cannot run.
          if (!enabled(probe)) continue;
        }
        candidates.push(binding);
      }
    }

    const result = this.matcher.feed(chord, candidates);
    if (result.type === 'match') {
      this.dispatch(
        result.binding.action,
        this.dispatchContext(actionCtx, result.binding.context, event),
      );
      return true;
    }
    return result.type === 'pending';
  }

  /**
   * invoke runs an action by id, for the command menu and the context menus.
   *
   * They call this rather than `action.run` directly so that a disabled action stays
   * disabled on every surface: the gate belongs to the action, not to whichever menu
   * happens to be listing it. Returns whether the action ran.
   */
  invoke(
    id: string,
    actionCtx: Ctx,
    source: Exclude<ActionContext['source'], 'key'> = 'menu',
  ): boolean {
    const action = this.actions.get(id);
    if (action === undefined) return false;
    // The caller's `context` is kept: a menu knows which surface it was opened over,
    // and the registry does not.
    const ctx = { ...actionCtx, source };
    if (action.enabled !== undefined && !action.enabled(ctx)) return false;
    // Invoking a command ends whatever sequence was half-typed; the user has moved on.
    this.matcher.reset();
    this.dispatch(action, ctx);
    return true;
  }

  /**
   * resolveChain turns the context stack into the ordered list of contexts a keystroke
   * is offered to: innermost first, falling back outward, and always ending at `global`.
   * A sealed context cuts the walk short — that is what lets a modal swallow Escape
   * without the list underneath acting on it too.
   */
  private resolveChain(activeContext: Context): Context[] {
    const walk: Context[] = [];
    const index = this.stack.lastIndexOf(activeContext);
    if (index === -1) walk.push(activeContext);
    for (let i = index === -1 ? this.stack.length - 1 : index; i >= 0; i--) {
      const context = this.stack[i];
      if (context !== undefined) walk.push(context);
    }

    const chain: Context[] = [];
    for (const context of walk) {
      if (!chain.includes(context)) chain.push(context);
      if (this.sealed.has(context)) break;
    }
    if (!chain.includes('global')) chain.push('global');
    return chain;
  }

  private assertNoConflict(
    action: Action<Ctx>,
    spec: string,
    chordIds: readonly string[],
    context: Context,
  ): void {
    for (const existing of this.bindings.get(context) ?? []) {
      // A prefix relation is a conflict too: with both `g` and `g i` bound in one
      // context, `g` fires immediately and `g i` is unreachable.
      if (!isPrefix(existing.chordIds, chordIds) && !isPrefix(chordIds, existing.chordIds))
        continue;
      const relation =
        existing.chordIds.length === chordIds.length ? 'is already bound by' : 'collides with';
      throw new Error(
        `key "${spec}" for "${action.id}" ${relation} "${existing.spec}" for "${existing.id}" in context "${context}"`,
      );
    }
  }

  private unregister(action: Action<Ctx>): void {
    // Identity, not id: re-registering the same id after an unmount must not be undone
    // by a stale closure from the previous mount.
    if (this.actions.get(action.id) !== action) return;
    this.actions.delete(action.id);
    for (const [context, list] of this.bindings) {
      const kept = list.filter((binding) => binding.action !== action);
      if (kept.length === 0) this.bindings.delete(context);
      else this.bindings.set(context, kept);
    }
    const group = this.groups.get(action.group);
    if (group !== undefined) {
      const kept = group.filter((candidate) => candidate !== action);
      if (kept.length === 0) this.groups.delete(action.group);
      else this.groups.set(action.group, kept);
    }
    this.matcher.reset();
  }

  private dispatchContext(actionCtx: Ctx, context: Context, event: KeyboardEventLike): Ctx {
    // The registry overwrites the dispatch facts rather than trusting the caller's, so
    // that an action can always believe what its context tells it about how it ran.
    return { ...actionCtx, source: 'key' as const, context, event };
  }

  private dispatch(action: Action<Ctx>, ctx: Ctx): void {
    try {
      const outcome: unknown = action.run(ctx);
      if (isPromiseLike(outcome)) {
        void Promise.resolve(outcome).then(undefined, (error: unknown) =>
          this.onError(error, action),
        );
      }
    } catch (error) {
      this.onError(error, action);
    }
  }
}

/** `when` is normalised in one place so that "unspecified" means `global` everywhere. */
function contextsOf(when: Context | readonly Context[] | undefined): readonly Context[] {
  if (when === undefined) return ['global'];
  if (typeof when === 'string') return [when];
  return when.length === 0 ? ['global'] : when;
}
