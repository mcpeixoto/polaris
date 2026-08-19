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
 */
export function useActions(actions: readonly Action[], deps: readonly unknown[] = []): void {
  const { registry } = useKeymap();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(
    () => registry.registerAll(actionsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, ...deps],
  );
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
  return event.key === 'k' || event.key === 'K' || event.key === 'Enter';
}
