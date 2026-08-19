import { describe, expect, it } from 'vitest';

import { KeymapRegistry, type KeymapOptions } from './registry';
import type { Action, ActionContext, Context, KeyboardEventLike } from './types';

/**
 * The registry is parameterised with a context that carries a log, which is both how
 * these tests observe what ran and a working demonstration of the injection seam: an
 * action's dependencies travel in its ActionContext, not in a module import the test
 * would have to stub.
 */
interface TestContext extends ActionContext {
  readonly log: string[];
}

function press(key: string, mods: Partial<Omit<KeyboardEventLike, 'key'>> = {}): KeyboardEventLike {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    ...(mods.code === undefined ? null : { code: mods.code }),
    ...(mods.repeat === undefined ? null : { repeat: mods.repeat }),
  };
}

type ActionOverrides = Partial<Action<TestContext>> & Pick<Action<TestContext>, 'id'>;

/** An action whose only behaviour is to say that it ran. */
function testAction(over: ActionOverrides): Action<TestContext> {
  return {
    title: over.id,
    group: 'Test',
    run: (ctx) => {
      ctx.log.push(over.id);
    },
    ...over,
  };
}

function harness(options: KeymapOptions<TestContext> = {}) {
  const log: string[] = [];
  const clock = { now: 0 };
  const registry = new KeymapRegistry<TestContext>({
    platform: 'other',
    now: () => clock.now,
    ...options,
  });

  return {
    log,
    clock,
    registry,
    register: (...actions: ActionOverrides[]) =>
      registry.registerAll(actions.map((a) => testAction(a))),
    /** One keystroke through the real entry point, in the innermost live context. */
    fire(key: string, mods: Partial<Omit<KeyboardEventLike, 'key'>> = {}): boolean {
      const context = registry.activeContext;
      return registry.handle(press(key, mods), context, { source: 'key', context, log });
    },
    fireUp(key: string, mods: Partial<Omit<KeyboardEventLike, 'key'>> = {}): boolean {
      const context = registry.activeContext;
      return registry.handleKeyUp(press(key, mods), context, { source: 'key', context, log });
    },
  };
}

describe('registration', () => {
  it('refuses a second action with the same id', () => {
    const { register } = harness();
    register({ id: 'issue.create' });
    expect(
      () => register({ id: 'issue.create' }),
      'a silent overwrite is how a shortcut mysteriously stops working',
    ).toThrow(/already registered/);
  });

  it('refuses two actions on one key in one context, naming both', () => {
    const { register } = harness();
    register({ id: 'issue.create', keys: ['c'], when: 'list' });
    let message = '';
    try {
      register({ id: 'issue.comment', keys: ['c'], when: 'list' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message, 'a conflict must be findable at startup, not by a user').not.toBe('');
    expect(message, 'the message must name the loser').toContain('issue.comment');
    expect(message, 'the message must name the incumbent, or the fix is a hunt').toContain(
      'issue.create',
    );
    expect(message).toContain('list');
  });

  it('allows two guarded actions to share a key in one context', () => {
    const { register, registry, log } = harness();
    let filterEditorOpen = false;
    let displayPanelOpen = false;

    // Two popovers on one screen, each owning Escape while it is open. The `menu` context is
    // sealed and shared by every popover, so refusing this made "one popover per screen" a
    // rule the keyboard imposed on what a screen was allowed to contain.
    expect(() =>
      register(
        {
          id: 'filterBar.closeEditor',
          keys: ['Escape'],
          when: 'menu',
          enabled: () => filterEditorOpen,
        },
        {
          id: 'view.closeDisplay',
          keys: ['Escape'],
          when: 'menu',
          enabled: () => displayPanelOpen,
        },
      ),
    ).not.toThrow();

    registry.pushContext('menu');

    // Neither open: Escape reaches neither, because a disabled action is treated as unbound.
    expect(registry.handle(press('Escape'), 'menu', { source: 'key', context: 'menu', log })).toBe(
      false,
    );
    expect(log).toEqual([]);

    displayPanelOpen = true;
    registry.handle(press('Escape'), 'menu', { source: 'key', context: 'menu', log });
    expect(log, 'the live one runs, and only the live one').toEqual(['view.closeDisplay']);

    displayPanelOpen = false;
    filterEditorOpen = true;
    registry.handle(press('Escape'), 'menu', { source: 'key', context: 'menu', log });
    expect(log).toEqual(['view.closeDisplay', 'filterBar.closeEditor']);
  });

  it('still refuses a guarded action against an unguarded one on the same key', () => {
    const { register } = harness();
    // The case the check exists for is unchanged: one binding permanently live means the
    // other simply never fires, and nobody finds out until they press it.
    register({ id: 'issue.create', keys: ['c'], when: 'list' });
    expect(() =>
      register({ id: 'issue.comment', keys: ['c'], when: 'list', enabled: () => true }),
    ).toThrow(/issue\.create/);
  });

  it('refuses a binding that shadows a sequence in the same context', () => {
    const { register } = harness();
    register({ id: 'nav.goToIssues', keys: ['g i'] });
    expect(
      () => register({ id: 'nav.group', keys: ['g'] }),
      'with both g and g i bound, g fires first and g i is unreachable',
    ).toThrow(/nav\.goToIssues/);
  });

  it('refuses two specs of one action that shadow each other', () => {
    const { register } = harness();
    expect(
      () => register({ id: 'nav.goToIssues', keys: ['g', 'g i'] }),
      'an action can conflict with itself, and that is still a conflict',
    ).toThrow(/shadows/);
  });

  it('allows the same key in different contexts', () => {
    const { register, registry } = harness();
    expect(() => {
      register({ id: 'list.clearSelection', keys: ['Escape'], when: 'list' });
      register({ id: 'modal.close', keys: ['Escape'], when: 'modal' });
    }, 'Escape means something different on every surface; that is the point of contexts').not.toThrow();
    expect(registry.list()).toHaveLength(2);
  });

  it('refuses an id that is not dot-namespaced', () => {
    const { register } = harness();
    expect(
      () => register({ id: 'create' }),
      'a flat id collides across features and cannot be namespaced later without a migration',
    ).toThrow(/dot-namespaced/);
  });

  it('rolls back a whole batch when one action in it is rejected', () => {
    const { register, registry } = harness();
    expect(() =>
      register({ id: 'issue.create', keys: ['c'] }, { id: 'issue.comment', keys: ['c'] }),
    ).toThrow();
    expect(
      registry.list(),
      'a half-registered feature reports a duplicate id next time and buries the real conflict',
    ).toHaveLength(0);
  });

  it('frees the id and the key when an action is unregistered', () => {
    const { registry, log } = harness();
    const off = registry.register(testAction({ id: 'issue.create', keys: ['c'] }));
    off();
    expect(registry.get('issue.create')).toBeUndefined();
    expect(() => registry.register(testAction({ id: 'issue.other', keys: ['c'] }))).not.toThrow();
    registry.handle(press('c'), 'global', { source: 'key', context: 'global', log });
    expect(log, 'the unregistered action must not still be reachable by key').toEqual([
      'issue.other',
    ]);
  });

  it('ignores a stale unregister after the same id was registered again', () => {
    const { registry } = harness();
    const off = registry.register(testAction({ id: 'issue.create' }));
    off();
    const replacement = testAction({ id: 'issue.create' });
    registry.register(replacement);
    off();
    expect(
      registry.get('issue.create'),
      'a closure from a previous mount must not unregister the current one',
    ).toBe(replacement);
  });
});

describe('context stack', () => {
  it('lets the innermost context win', () => {
    const { register, registry, log, fire } = harness();
    register(
      { id: 'list.clearSelection', keys: ['Escape'], when: 'list' },
      { id: 'modal.close', keys: ['Escape'], when: 'modal' },
    );
    registry.pushContext('list');
    registry.pushContext('modal');

    expect(fire('Escape'), 'the modal consumed it, so the caller must preventDefault').toBe(true);
    expect(
      log,
      'a modal must swallow Escape without the list underneath also acting on it',
    ).toEqual(['modal.close']);

    registry.popContext();
    fire('Escape');
    expect(log, 'closing the modal must give the list its Escape back').toEqual([
      'modal.close',
      'list.clearSelection',
    ]);
  });

  it('does not leak an unclaimed key from a modal to the surface behind it', () => {
    const { register, registry, log, fire } = harness();
    register({ id: 'list.moveDown', keys: ['j'], when: 'list' });
    registry.pushContext('list');
    registry.pushContext('modal');

    expect(fire('j'), 'the modal binds nothing for j, so the key is not consumed').toBe(false);
    expect(log, 'typing j in a modal must not scroll the list underneath it').toEqual([]);
  });

  it('keeps global actions reachable from a modal', () => {
    const { register, registry, log, fire } = harness();
    register({ id: 'help.open', keys: ['?'] });
    registry.pushContext('modal');
    fire('?', { shiftKey: true, code: 'Slash' });
    expect(log, 'global means everywhere, including over a modal').toEqual(['help.open']);
  });

  it('falls back outward through contexts that do not mask', () => {
    const { register, registry, log, fire } = harness();
    register({ id: 'list.moveDown', keys: ['j'], when: 'list' });
    registry.pushContext('list');
    registry.pushContext('detail');
    fire('j');
    expect(log, 'a detail pane opened beside a list still leaves the list navigable').toEqual([
      'list.moveDown',
    ]);
  });

  it('never pops the global floor', () => {
    const { registry } = harness();
    expect(registry.popContext()).toBeUndefined();
    expect(
      registry.activeContext,
      'one unbalanced pop would otherwise disable every shortcut in the product',
    ).toBe('global');
  });

  it('pops a context that is no longer on top', () => {
    const { registry } = harness();
    registry.pushContext('list');
    const closeModal = registry.pushContext('modal');
    registry.pushContext('menu');
    closeModal();
    expect(
      registry.contextStack(),
      'surfaces unmount out of order and the stack must survive it',
    ).toEqual(['global', 'list', 'menu']);
  });
});

describe('handle', () => {
  it('reports whether it consumed the event', () => {
    const { register, fire } = harness();
    register({ id: 'command.open', keys: ['mod+k'] });
    expect(fire('k', { ctrlKey: true, code: 'KeyK' }), 'a match is consumed').toBe(true);
    expect(fire('q', { code: 'KeyQ' }), 'an unbound key must reach the page untouched').toBe(false);
  });

  it('runs a sequence: g then i', () => {
    const { register, log, fire } = harness();
    register({ id: 'nav.goToIssues', keys: ['g i'] }, { id: 'nav.goToMyIssues', keys: ['g m'] });

    expect(fire('g', { code: 'KeyG' }), 'g on its way to g i must not reach the page').toBe(true);
    expect(log, 'a prefix must not fire anything yet').toEqual([]);
    expect(fire('i', { code: 'KeyI' })).toBe(true);
    expect(log).toEqual(['nav.goToIssues']);
  });

  it('forgets a half-typed sequence after a second', () => {
    const { register, log, fire, clock } = harness();
    register({ id: 'nav.goToIssues', keys: ['g i'] });

    fire('g', { code: 'KeyG' });
    clock.now = 1100;
    expect(fire('i', { code: 'KeyI' }), 'a stale prefix must not consume the next keystroke').toBe(
      false,
    );
    expect(log, 'a g typed a second ago is not part of the i typed now').toEqual([]);
  });

  it('recovers from a sequence that went nowhere', () => {
    const { register, log, fire, clock } = harness();
    register({ id: 'nav.goToIssues', keys: ['g i'] });

    fire('g', { code: 'KeyG' });
    expect(fire('z', { code: 'KeyZ' }), 'g then an unbound key is nothing at all').toBe(false);

    clock.now = 10;
    fire('g', { code: 'KeyG' });
    fire('i', { code: 'KeyI' });
    expect(log, 'a failed sequence must not poison the next one').toEqual(['nav.goToIssues']);
  });

  it('does not let a modifier press cancel a pending sequence', () => {
    const { register, log, fire } = harness();
    register({ id: 'nav.goToIssues', keys: ['g i'] });

    fire('g', { code: 'KeyG' });
    expect(fire('Shift', { shiftKey: true }), 'a modifier alone is not a chord').toBe(false);
    fire('i', { code: 'KeyI' });
    expect(log, 'reaching for Shift mid-sequence must not cancel what the user is typing').toEqual([
      'nav.goToIssues',
    ]);
  });

  it('drops a pending sequence when the surface changes underneath it', () => {
    const { register, registry, log, fire } = harness();
    register({ id: 'nav.goToIssues', keys: ['g i'], when: ['list', 'global'] });

    registry.pushContext('list');
    fire('g', { code: 'KeyG' });
    registry.pushContext('modal');
    registry.popContext();
    fire('i', { code: 'KeyI' });
    expect(log, 'g typed at a list and i typed after a modal were never one gesture').toEqual([]);
  });

  it('does not run a disabled action', () => {
    const { register, log, fire } = harness();
    register({ id: 'issue.assign', keys: ['a'], enabled: () => false });
    expect(fire('a', { code: 'KeyA' }), 'a disabled action consumes nothing').toBe(false);
    expect(log, 'enabled() is the gate; run() must not fire behind it').toEqual([]);
  });

  it('lets a key fall through when the inner action is disabled', () => {
    const { register, registry, log, fire } = harness();
    register(
      { id: 'list.archive', keys: ['e'], when: 'list', enabled: () => false },
      { id: 'app.archive', keys: ['e'] },
    );
    registry.pushContext('list');
    fire('e', { code: 'KeyE' });
    expect(log, 'a command that cannot run must not swallow the key on the way past').toEqual([
      'app.archive',
    ]);
  });

  it('tells the action how it was invoked', () => {
    const { registry, log } = harness();
    let seen: TestContext | undefined;
    registry.register(
      testAction({
        id: 'issue.create',
        keys: ['c'],
        when: 'list',
        run: (ctx) => {
          seen = ctx;
        },
      }),
    );
    registry.pushContext('list');
    const event = press('c', { code: 'KeyC' });
    registry.handle(event, 'list', { source: 'menu', context: 'global', log });

    expect(seen?.source, 'the registry, not the caller, knows how the action was reached').toBe(
      'key',
    );
    expect(seen?.context, 'the context reported is the one whose binding matched').toBe('list');
    expect(seen?.event, 'an action that wants the event must be given the real one').toBe(event);
  });

  it('survives an action that throws', () => {
    const errors: unknown[] = [];
    const { register, log, fire } = harness({ onError: (error) => errors.push(error) });
    register(
      {
        id: 'issue.explode',
        keys: ['b'],
        run: () => {
          throw new Error('boom');
        },
      },
      { id: 'issue.fine', keys: ['n'] },
    );

    expect(
      fire('b', { code: 'KeyB' }),
      'the action ran; that it failed is not the callers business',
    ).toBe(true);
    expect(errors, 'the failure must be reported, not swallowed').toHaveLength(1);
    fire('n', { code: 'KeyN' });
    expect(log, 'one broken action must not take the keyboard down with it').toEqual([
      'issue.fine',
    ]);
  });

  it('reports a rejected async action', async () => {
    const errors: unknown[] = [];
    const { register, fire } = harness({ onError: (error) => errors.push(error) });
    register({ id: 'issue.save', keys: ['s'], run: () => Promise.reject(new Error('offline')) });

    fire('s', { code: 'KeyS' });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      errors,
      'an async action that fails must not become an unhandled rejection',
    ).toHaveLength(1);
  });
});

describe('views over the registry', () => {
  it('lists what applies in a context, innermost declarations first', () => {
    const { register, registry } = harness();
    register(
      { id: 'command.open', keys: ['mod+k'] },
      { id: 'issue.create', keys: ['c'], when: 'list' },
      { id: 'comment.reply', keys: ['r'], when: 'detail' },
    );

    expect(registry.listForContext('list').map((a) => a.id)).toEqual([
      'issue.create',
      'command.open',
    ]);
    expect(
      registry.listForContext('detail').map((a) => a.id),
      'global actions are available everywhere, so they belong in every list',
    ).toEqual(['comment.reply', 'command.open']);
  });

  it('groups bound actions for the help overlay', () => {
    const { register, registry } = harness();
    register(
      { id: 'issue.create', keys: ['c'], group: 'Issues' },
      { id: 'issue.assign', keys: ['a'], group: 'Issues' },
      { id: 'nav.goToIssues', keys: ['g i'], group: 'Navigation' },
      { id: 'issue.duplicate', group: 'Issues' },
    );

    const groups = registry.byGroup();
    expect([...groups.keys()]).toEqual(['Issues', 'Navigation']);
    expect(
      groups.get('Issues')?.map((a) => a.id),
      'an action with no key has nothing to show in a keyboard reference',
    ).toEqual(['issue.create', 'issue.assign']);
  });

  it('keeps hidden actions bound and documented, only out of the command menu', () => {
    const { register, registry, log, fire } = harness();
    register({ id: 'list.moveDown', keys: ['j'], group: 'Navigation', hidden: true });

    fire('j', { code: 'KeyJ' });
    expect(log, 'hidden means unlisted, not unbound').toEqual(['list.moveDown']);
    expect(
      registry
        .byGroup()
        .get('Navigation')
        ?.map((a) => a.id),
    ).toEqual(['list.moveDown']);
    expect(
      registry.listForContext('global').filter((a) => a.hidden !== true),
      'a command menu filters on hidden, and this one has nothing left to show',
    ).toHaveLength(0);
  });

  it('invokes an action by id for the menus, honouring its gate', () => {
    const { register, registry, log } = harness();
    let seen: TestContext | undefined;
    registry.register(
      testAction({
        id: 'issue.create',
        keys: ['c'],
        run: (ctx) => {
          seen = ctx;
        },
      }),
    );
    register({ id: 'issue.assign', enabled: () => false });

    expect(registry.invoke('issue.create', { source: 'key', context: 'global', log })).toBe(true);
    expect(seen?.source, 'the menu is not the keyboard, and the action should know').toBe('menu');
    expect(
      registry.invoke('issue.assign', { source: 'menu', context: 'global', log }),
      'a gate that stops a shortcut must stop the menu entry too, or they disagree',
    ).toBe(false);
    expect(registry.invoke('issue.nothing', { source: 'menu', context: 'global', log })).toBe(
      false,
    );
  });
});

describe('platform', () => {
  const layouts: ReadonlyArray<{
    readonly platform: 'mac' | 'other';
    readonly mods: Partial<Omit<KeyboardEventLike, 'key'>>;
    readonly why: string;
  }> = [
    { platform: 'mac', mods: { metaKey: true }, why: 'mod is Command on Apple platforms' },
    { platform: 'other', mods: { ctrlKey: true }, why: 'mod is Control everywhere else' },
  ];

  for (const layout of layouts) {
    it(`binds mod+k to the right modifier on ${layout.platform}`, () => {
      const { register, log, fire } = harness({ platform: layout.platform });
      register({ id: 'command.open', keys: ['mod+k'] });
      fire('k', { ...layout.mods, code: 'KeyK' });
      expect(log, layout.why).toEqual(['command.open']);
    });
  }
});

describe('the exported registry', () => {
  it('is a single instance shared by every view', async () => {
    const first = await import('./index');
    const second = await import('./index');
    expect(first.keymap, 'two registries mean two answers to "what does this key do"').toBe(
      second.keymap,
    );
  });
});

/** A Context value that is not on the stack must still resolve, hence this guard. */
const UNPUSHED: Context = 'detail';

describe('an active context that was never pushed', () => {
  it('still resolves outward to global', () => {
    const { register, registry, log } = harness();
    register(
      { id: 'help.open', keys: ['?'] },
      { id: 'comment.reply', keys: ['r'], when: 'detail' },
    );

    registry.handle(press('r', { code: 'KeyR' }), UNPUSHED, {
      source: 'key',
      context: UNPUSHED,
      log,
    });
    registry.handle(press('?', { shiftKey: true, code: 'Slash' }), UNPUSHED, {
      source: 'key',
      context: UNPUSHED,
      log,
    });
    expect(log, 'a caller that tracks its own context must not lose the global keymap').toEqual([
      'comment.reply',
      'help.open',
    ]);
  });
});

/**
 * The keymap milestone 0 froze, transcribed from the scope document. It is here as a
 * test because the registry's claim is that the whole product's keyboard fits in it
 * without a single component-level handler — a claim worth checking against the real
 * keymap rather than against inventions that happen to be convenient.
 */
const M0_KEYMAP: readonly ActionOverrides[] = [
  { id: 'command.open', keys: ['mod+k'], group: 'General' },
  { id: 'help.open', keys: ['?'], group: 'General' },
  { id: 'issue.create', keys: ['c'], group: 'Issues' },
  { id: 'nav.goToIssues', keys: ['g i'], group: 'Navigation' },
  { id: 'nav.goToMyIssues', keys: ['g m'], group: 'Navigation' },
  { id: 'list.moveUp', keys: ['ArrowUp', 'k'], when: 'list', group: 'Navigation', hidden: true },
  {
    id: 'list.moveDown',
    keys: ['ArrowDown', 'j'],
    when: 'list',
    group: 'Navigation',
    hidden: true,
  },
  { id: 'list.select', keys: ['x'], when: 'list', group: 'Selection' },
  {
    id: 'list.extendUp',
    keys: ['shift+ArrowUp'],
    when: 'list',
    group: 'Selection',
  },
  {
    id: 'list.extendDown',
    keys: ['shift+ArrowDown'],
    when: 'list',
    group: 'Selection',
  },
  { id: 'issue.archive', keys: ['e'], when: ['list', 'detail'], group: 'Issues' },
  { id: 'issue.assign', keys: ['a'], when: ['list', 'detail'], group: 'Issues' },
  { id: 'issue.setStatus', keys: ['s'], when: ['list', 'detail'], group: 'Issues' },
  { id: 'issue.setPriority', keys: ['p'], when: ['list', 'detail'], group: 'Issues' },
  { id: 'modal.close', keys: ['Escape'], when: 'modal', group: 'General', hidden: true },
  { id: 'modal.submit', keys: ['mod+Enter'], when: ['modal', 'editor'], group: 'General' },
];

describe('the M0 keymap', () => {
  it('registers whole, with no conflict anywhere in it', () => {
    const { register, registry } = harness();
    expect(() => register(...M0_KEYMAP)).not.toThrow();
    expect(registry.list()).toHaveLength(M0_KEYMAP.length);
  });

  it('generates the help overlay instead of anyone hand-writing it', () => {
    const { register, registry } = harness();
    register(...M0_KEYMAP);
    const groups = registry.byGroup();

    expect(
      [...groups.keys()],
      'the overlay sections come from the actions, so they cannot drift from them',
    ).toEqual(['General', 'Issues', 'Navigation', 'Selection']);
    expect(
      [...groups.values()].flat().length,
      'every action in the M0 keymap is bound, so every one is documented',
    ).toBe(M0_KEYMAP.length);
  });

  it('routes each frozen gesture to exactly one action', () => {
    const { register, registry, log, fire } = harness();
    register(...M0_KEYMAP);

    registry.pushContext('list');
    fire('k', { ctrlKey: true, code: 'KeyK' });
    fire('j', { code: 'KeyJ' });
    fire('ArrowDown', { shiftKey: true });
    fire('x', { code: 'KeyX' });
    fire('g', { code: 'KeyG' });
    fire('m', { code: 'KeyM' });

    registry.pushContext('modal');
    fire('Enter', { ctrlKey: true });
    fire('j', { code: 'KeyJ' });
    fire('Escape');

    expect(log, 'the M0 keymap must work end to end with no component owning a key').toEqual([
      'command.open',
      'list.moveDown',
      'list.extendDown',
      'list.select',
      'nav.goToMyIssues',
      'modal.submit',
      'modal.close',
    ]);
  });
});

describe('hold-to-preview', () => {
  it('consumes a held key without running the toggle again', () => {
    const { register, registry, log, fire } = harness();
    register({ id: 'list.peek', keys: ['space'], when: 'list', ignoreRepeat: true });
    registry.pushContext('list');

    expect(fire(' ')).toBe(true);
    expect(fire(' ', { repeat: true })).toBe(true);
    expect(log, 'a held Space must not toggle Peek on every repeat').toEqual(['list.peek']);
  });

  it('runs keyup on the matching release so a hold can put the preview away', () => {
    const { register, registry, log, fire, fireUp } = harness();
    register({
      id: 'list.peek',
      keys: ['space'],
      when: 'list',
      ignoreRepeat: true,
      keyup: (ctx) => {
        ctx.log.push('list.peek.up');
      },
    });
    registry.pushContext('list');

    fire(' ');
    expect(fireUp(' ')).toBe(true);
    expect(log).toEqual(['list.peek', 'list.peek.up']);
  });

  it('does not run keyup for a different key', () => {
    const { register, registry, log, fire, fireUp } = harness();
    register({
      id: 'list.peek',
      keys: ['space'],
      when: 'list',
      keyup: (ctx) => {
        ctx.log.push('list.peek.up');
      },
    });
    registry.pushContext('list');

    fire(' ');
    expect(fireUp('j')).toBe(false);
    expect(log).toEqual(['list.peek']);
  });
});
