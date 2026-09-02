/**
 * The application's keymap: one registry, and the React plumbing that drives it.
 *
 * Every action in the product is registered here or by a screen that mounts. The command
 * menu, the help overlay and the key handler are all views over that registry — no
 * component owns a shortcut, and CI greps for `onKeyDown` outside `web/src/keys/` to keep
 * it that way.
 *
 * The reason is not tidiness. A keyboard-first product accumulates a few hundred
 * bindings, and the questions that matter — what does `E` do here, does anything already
 * use `⌘⇧K`, what can I do right now — are answerable in O(1) against a registry and
 * unanswerable against handlers scattered through a component tree.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  chordFromEvent,
  KeymapRegistry,
  type Action,
  type ActionContext,
  type Context,
} from '~/keys';

interface KeymapValue {
  registry: KeymapRegistry;
  /** The innermost active context. Screens push and pop as they mount and open. */
  context: Context;
  pushContext(c: Context): () => void;
}

const KeymapContext = createContext<KeymapValue | null>(null);

export function KeymapProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new KeymapRegistry(), []);
  const [context, setContext] = useState<Context>('global');

  const pushContext = useCallback(
    (c: Context) => {
      const pop = registry.pushContext(c);
      setContext(registry.activeContext);
      return () => {
        pop();
        setContext(registry.activeContext);
      };
    },
    [registry],
  );

  // One listener for the whole application, on the window.
  //
  // Attaching per component would mean the handler that fires depends on where focus
  // happens to be, which is exactly the ambiguity the context stack exists to resolve.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A keystroke aimed at a text field belongs to that field. The exceptions are the
      // chords that must work everywhere — Escape to dismiss, ⌘K to open the menu,
      // ⌘Enter to submit — because a user typing a comment still needs to close the modal
      // they are typing in.
      if (isTypingTarget(event.target) && !isGlobalChord(event)) return;
      if (isActivationOnControl(event)) return;

      const chord = chordFromEvent(event);
      const actionCtx: ActionContext = {
        source: 'key',
        context: registry.activeContext,
        event: chord ? event : undefined,
      };

      if (registry.handle(event, registry.activeContext, actionCtx)) {
        // Only prevented when something actually ran. Swallowing unhandled keys breaks
        // browser shortcuts the user expects to keep working.
        event.preventDefault();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) && !isGlobalChord(event)) return;
      if (isActivationOnControl(event)) return;
      const chord = chordFromEvent(event);
      const actionCtx: ActionContext = {
        source: 'key',
        context: registry.activeContext,
        event: chord ? event : undefined,
      };
      registry.handleKeyUp(event, registry.activeContext, actionCtx);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [registry]);

  const value = useMemo<KeymapValue>(
    () => ({ registry, context, pushContext }),
    [registry, context, pushContext],
  );

  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

export function useKeymap(): KeymapValue {
  const ctx = useContext(KeymapContext);
  if (!ctx) throw new Error('useKeymap must be used inside a KeymapProvider');
  return ctx;
}

/**
 * Registers actions while the calling component is mounted.
 *
 * Screen-local actions live with their screen so that "Change status" is only bound while
 * something is selected — and so the command menu offers exactly what is available now,
 * rather than a list of things that will fail if chosen.
 *
 * What the registry is handed is a *forwarder*, not the caller's object. The registry
 * stores what it is given and dispatches through it forever, so an action written the
 * obvious way —
 *
 *     run: () => void save()          // `save` closes over this render's state
 *
 * — would run the first render's `save` for the life of the screen: the chord fires, the
 * mutation is correct, and the values it sends are the ones on screen when the surface
 * mounted. That is silent by construction, which is why it was written five separate times
 * before anybody noticed. Forwarding through the ref removes the hazard here, once,
 * instead of asking every call site to remember a ref of its own.
 *
 * `deps` still re-registers, for the case refs cannot cover: a call site whose *set* of
 * actions changes, where the registry has to learn ids and keys it has never parsed.
 */
export function useActions(actions: readonly Action[], deps: readonly unknown[] = []): void {
  const { registry } = useKeymap();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(
    () => registry.registerAll(actionsRef.current.map((action) => forwarder(actionsRef, action))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, ...deps],
  );
}

/**
 * A stable stand-in for one action, whose behaviour is looked up fresh at dispatch.
 *
 * Only the callbacks are forwarded. `keys`, `when` and `id` are parsed into bindings once
 * at registration and cannot change without re-registering, and the display fields go with
 * them so the command menu and the help overlay keep reading one consistent object.
 *
 * `enabled`, `available` and `keyup` are forwarded only when the registered action declared
 * them, because the registry reads `=== undefined` on each as a fact about the action:
 * `assertNoConflict` lets two *guarded* bindings share a key, and `byGroup` lists an action
 * with no `available` unconditionally. A forwarder that always carried an `enabled` would
 * make every binding in the product look guarded and quietly retire the duplicate-key
 * check; one that always carried an `available` would put every action in the product on
 * the help overlay's conditional path.
 */
function forwarder(ref: { current: readonly Action[] }, action: Action): Action {
  // By id rather than by index: a call site whose list is built conditionally can change
  // length between renders, and the id is the identity the registry itself uses. An id the
  // current render no longer offers falls back to the registered object — that action is
  // no longer rendered, and unregistering it needs a `deps` change, not a ref.
  const latest = (): Action => ref.current.find((c) => c.id === action.id) ?? action;
  const { enabled, available, keyup } = action;
  return {
    ...action,
    run: (ctx) => latest().run(ctx),
    ...(enabled === undefined ? null : { enabled: (ctx) => (latest().enabled ?? enabled)(ctx) }),
    ...(available === undefined
      ? null
      : { available: (ctx) => (latest().available ?? available)(ctx) }),
    ...(keyup === undefined ? null : { keyup: (ctx) => (latest().keyup ?? keyup)(ctx) }),
  };
}

/**
 * Pushes a keyboard context while the calling component is mounted.
 *
 * A modal pushes `'modal'` so Escape closes the modal and not the list underneath it, and
 * so the list's `J`/`K` navigation stops competing with the text the user is typing.
 */
export function useKeyContext(context: Context, active = true): void {
  const { pushContext } = useKeymap();
  useEffect(() => {
    if (!active) return;
    return pushContext(context);
  }, [pushContext, context, active]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** What a focused control activates on, and therefore what the registry must not also see. */
const ACTIVATABLE = 'button, summary, a[href], [role="button"], [role="link"]';

/**
 * Enter or Space aimed at a control that activates on it.
 *
 * A focused button consumes those two keys itself — that is what makes it operable
 * without a mouse. Letting them reach the registry as well means one keystroke does two
 * things, and the second one is usually the surprising one: on a team's issue list,
 * pressing Enter on the Insights panel's own bar filtered the view *and* ran the list's
 * Enter-to-open, dropping the user on an unrelated issue. The same keystroke on the
 * header's Insights or Display buttons did it too.
 *
 * The list keeps its Enter. Focus there lives on the `role="listbox"` scroller and the
 * cursor is an `aria-activedescendant`, not a focused element, so nothing matches here.
 *
 * Modified chords are not activation: ⌘Enter still submits from a button, and the
 * text-field rule above still runs first.
 */
function isActivationOnControl(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.target instanceof Element && event.target.closest(ACTIVATABLE) !== null;
}

/** The chords that must reach the registry even from inside a text field. */
function isGlobalChord(event: KeyboardEvent): boolean {
  if (event.key === 'Escape') return true;
  // Enter-to-submit is a preference, not a global chord for every field. The comment
  // composer opts in with `data-submit-chord="enter"` so a newline in a title still types
  // a newline, and so lint-keymap never has to allow a per-component handler.
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    event.target instanceof HTMLElement &&
    event.target.dataset.submitChord === 'enter'
  ) {
    return true;
  }
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return false;
  if (event.key === 'k' || event.key === 'K' || event.key === 'Enter') return true;
  // The shortcut sheet, which is most wanted from exactly where it could not be reached:
  // somebody stuck halfway through a comment, wondering what submits it. `⌘/` and not the
  // bare `?` the same action also binds — a question mark typed into a comment is a question
  // mark, and a text field that swallowed it to open a dialog would be the worse bug.
  if (event.key === '/' || event.code === 'Slash') return true;
  // Inline comment: ⌘⌥M / Ctrl+Alt+M. Option on Apple layouts turns M into µ, so the
  // physical key is the one that still says what was struck.
  return (
    event.altKey &&
    (event.code === 'KeyM' || event.key === 'm' || event.key === 'M' || event.key === 'µ')
  );
}
