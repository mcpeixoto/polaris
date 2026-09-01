/**
 * The command menu.
 *
 * Commands still come from the keymap registry. Prefixes (`>`, `#`, `@`) are how the
 * same box also jumps to issues and people already in the replica — inventory 7.1's
 * scoped prefixes, without a second search surface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { Kbd } from '~/components';
import { usePresence } from '~/hooks/usePresence';
import { type Action, type Platform } from '~/keys';
import { os } from '~/platform/runtime';

import {
  matchIssues,
  matchUsers,
  parseCommandQuery,
  rankActions,
  type CommandScope,
  type EntityHit,
} from './commandMenuQuery';
import { useKeymap } from './keymap';
import styles from './CommandMenu.module.css';

type Row =
  | { kind: 'action'; id: string; group: string; action: Action }
  | { kind: 'entity'; id: string; group: string; hit: EntityHit };

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { registry, context } = useKeymap();
  const engine = useEngine();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Held on screen for the length of its exit. The two memos below switch from `open` to
  // `present` with it: they are what the panel is drawing, and a list that empties itself
  // halfway through a fade shows the user the surface being dismantled rather than leaving.
  const { present, exitProps } = usePresence(open, backdropRef);

  const candidates = useMemo(() => {
    if (!present) return [];
    return (
      registry
        .listForContext(context)
        .filter((a) => !a.hidden)
        // Both gates, because `invoke` honours both: an action offered here and then refused
        // on click is the "command that does nothing" this menu exists not to be. They are
        // one rule to every surface except the help overlay, which lists a merely-disabled
        // shortcut on purpose — see `available` in `keys/types.ts`.
        .filter(
          (a) =>
            (a.available?.({ source: 'menu', context }) ?? true) &&
            a.enabled?.({ source: 'menu', context }) !== false,
        )
    );
  }, [present, registry, context]);

  const parsed = useMemo(() => parseCommandQuery(query), [query]);

  const rows = useMemo((): Row[] => {
    if (!present) return [];
    const out: Row[] = [];
    const showCommands = parsed.scope === 'command' || parsed.scope === 'mixed';
    const showIssues =
      parsed.scope === 'issue' || (parsed.scope === 'mixed' && parsed.needle !== '');
    const showUsers = parsed.scope === 'user';

    if (showCommands) {
      for (const action of rankActions(candidates, parsed.needle)) {
        out.push({ kind: 'action', id: action.id, group: action.group ?? 'Commands', action });
      }
    }
    if (showIssues) {
      for (const hit of matchIssues(engine.store, parsed.needle)) {
        out.push({ kind: 'entity', id: `issue:${hit.id}`, group: 'Issues', hit });
      }
    }
    if (showUsers) {
      for (const hit of matchUsers(engine.store, parsed.needle)) {
        out.push({ kind: 'entity', id: `user:${hit.id}`, group: 'People', hit });
      }
    }
    return out;
  }, [present, candidates, parsed, engine.store]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = useCallback(
    (row: Row) => {
      onClose();
      queueMicrotask(() => {
        if (row.kind === 'action') {
          void registry.invoke(row.action.id, { source: 'menu', context });
        } else {
          void navigate(row.hit.href);
        }
      });
    },
    [onClose, registry, context, navigate],
  );

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => (rows.length === 0 ? 0 : (i + 1) % rows.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(Math.max(0, rows.length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const chosen = rows[active];
        if (chosen) run(chosen);
        break;
      }
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!present) return null;

  const activeRow = rows[active];

  return (
    <div ref={backdropRef} className={styles.backdrop} onMouseDown={onClose} {...exitProps}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Type > commands, # issues, @ people…"
          aria-label="Search commands"
          aria-controls="command-menu-results"
          aria-activedescendant={activeRow ? `command-${activeRow.id}` : undefined}
          role="combobox"
          aria-expanded="true"
          autoComplete="off"
          spellCheck={false}
        />

        <ul className={styles.results} id="command-menu-results" role="listbox" ref={listRef}>
          {rows.length === 0 && (
            <li className={styles.empty} role="presentation">
              <span className={styles.emptyTitle}>{emptyTitle(parsed.scope, parsed.needle)}</span>
              <span className={styles.emptyHint}>
                Try &gt; for commands, # for issues, @ for people, or press Esc
              </span>
            </li>
          )}
          {grouped(rows).flatMap((section) => {
            const header = (
              <li key={`group-${section.key}`} className={styles.groupHeader} role="presentation">
                {section.group}
              </li>
            );
            const items = section.rows.map((row) => {
              const i = rows.indexOf(row);
              return (
                <li
                  key={row.id}
                  id={`command-${row.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className={styles.item}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(row)}
                >
                  <span className={styles.title}>
                    {row.kind === 'action' ? row.action.title : row.hit.title}
                  </span>
                  {row.kind === 'action' && row.action.keys?.[0] && (
                    // The registry's own handwriting. This drew its own <kbd> and formatted
                    // the spec by hand, which is a second opinion about how a chord is
                    // spelled in the surface people learn chords from.
                    <Kbd keys={row.action.keys[0]} platform={platform()} />
                  )}
                </li>
              );
            });
            return [header, ...items];
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * Runs of rows that share a group, in the order they were ranked.
 *
 * Adjacent runs only, deliberately: the ranking decides what the reader sees first, and
 * hoisting a later row up to join an earlier heading of the same name would reorder the
 * results to tidy the headings. So one group CAN legitimately appear more than once —
 * `Issues` as a command group and `Issues` as matched issues is the common case.
 *
 * Which is why each section carries a key rather than being keyed by its name at the call
 * site. Two sections named `Issues` gave two `group-Issues` keys, and React answered with
 * "Encountered two children with the same key" on every keystroke that produced one.
 */
export function grouped<T extends { group: string }>(
  rows: readonly T[],
): { key: string; group: string; rows: T[] }[] {
  const sections: { key: string; group: string; rows: T[] }[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last !== undefined && last.group === row.group) last.rows.push(row);
    else sections.push({ key: `${sections.length}-${row.group}`, group: row.group, rows: [row] });
  }
  return sections;
}

/**
 * What "nothing" is, in the terms the query asked the question in.
 *
 * The box said "No matching command" whatever had been typed into it, so `#zz` — a search of
 * the issues in the replica — answered about commands, and a first-run workspace with no
 * issues in it at all read as a menu that had lost them. Which kind of empty this is, is the
 * whole of what the reader needs: an empty *result* is retyped, an empty *set* is not.
 *
 * This is deliberately not `EmptyState`, which is the rule for an empty list everywhere else.
 * That component holds itself invisible for --duration-normal before fading in, because a
 * local-first list renders before its rows have arrived and "No issues yet" must not flash on
 * the way to a full screen. Nothing here is waiting on a socket — the rows are ranked
 * synchronously from the replica on the keystroke — so the same delay would be a fifth of a
 * second of blank panel after every unmatched character.
 */
function emptyTitle(scope: CommandScope, needle: string): string {
  if (needle === '') {
    if (scope === 'issue') return 'No issues in this workspace yet';
    if (scope === 'user') return 'Nobody in this workspace yet';
    return 'Nothing to run on this screen';
  }
  if (scope === 'issue') return `No issue matches “${needle}”`;
  if (scope === 'user') return `Nobody matches “${needle}”`;
  if (scope === 'command') return `No command matches “${needle}”`;
  return `Nothing matches “${needle}”`;
}

function platform(): Platform {
  return os === 'mac' ? 'mac' : 'other';
}
