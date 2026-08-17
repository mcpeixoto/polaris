/**
 * The command menu.
 *
 * It is a *view over the registry*, not a list of commands. Nothing is enumerated here:
 * everything offered is whatever is registered and enabled in the current context, which
 * is what makes the menu correct by construction rather than by somebody remembering to
 * add an entry when they add a feature.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatKeySpec, type Action, type Platform } from '~/keys';
import { os } from '~/platform/runtime';
import { useKeymap } from './keymap';
import styles from './CommandMenu.module.css';

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { registry, context } = useKeymap();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const candidates = useMemo(() => {
    if (!open) return [];
    return registry
      .listForContext(context)
      .filter((a) => !a.hidden)
      .filter((a) => a.enabled?.({ source: 'menu', context }) ?? true);
  }, [open, registry, context]);

  const results = useMemo(() => rank(candidates, query), [candidates, query]);

  // Reset on open rather than on close: resetting on close is visible as the list
  // flickering back to its unfiltered state during the dismissal animation.
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
    (action: Action) => {
      onClose();
      // After the menu is gone, so an action that opens a modal is not fighting the
      // menu's own focus restoration for the same frame.
      queueMicrotask(() => {
        void registry.invoke(action.id, { source: 'menu', context });
      });
    },
    [onClose, registry, context],
  );

  // Arrow keys, Enter and Escape are handled here rather than through the registry
  // because they are the menu's own internal navigation, exactly as with Menu and Modal.
  // Registering them as actions would mean the menu's list navigation competed with the
  // list underneath it.
  const onInputKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(Math.max(0, results.length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const chosen = results[active];
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

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
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
          placeholder="Type a command…"
          aria-label="Type a command"
          aria-controls="command-menu-results"
          aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
          role="combobox"
          aria-expanded="true"
          autoComplete="off"
          spellCheck={false}
        />

        <ul className={styles.results} id="command-menu-results" role="listbox" ref={listRef}>
          {results.length === 0 && <li className={styles.empty}>No matching command</li>}
          {results.map((action, i) => (
            <li
              key={action.id}
              id={`command-${action.id}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              className={styles.item}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(action)}
            >
              <span className={styles.group}>{action.group}</span>
              <span className={styles.title}>{action.title}</span>
              {action.keys?.[0] && (
                <kbd className={styles.keys}>{formatKeySpec(action.keys[0], platform())}</kbd>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The keymap's platform naming, derived from the runtime shim's.
 *
 * They are separate vocabularies on purpose: the shim answers "which OS is this" for
 * badges, notifications and update channels, while the keymap only cares whether the
 * command modifier renders as ⌘ or Ctrl. Collapsing them would put an OS check inside the
 * matcher, which is pure logic and deliberately DOM- and platform-free.
 */
function platform(): Platform {
  return os === 'mac' ? 'mac' : 'other';
}

/**
 * Ranks actions against the query.
 *
 * Subsequence matching, not substring: "cri" should find "Create issue", because that is
 * how people actually type into one of these. Scoring prefers matches that start a word,
 * so "issue" surfaces "Issue: change status" above "Archive issue" — the thing named by
 * the query rather than the thing that merely mentions it.
 */
function rank(actions: readonly Action[], query: string): Action[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...actions];

  const scored: Array<{ action: Action; score: number }> = [];
  for (const action of actions) {
    const haystack = `${action.group} ${action.title}`.toLowerCase();
    const score = subsequenceScore(haystack, needle);
    if (score !== null) scored.push({ action, score });
  }

  scored.sort((a, b) => b.score - a.score || a.action.title.localeCompare(b.action.title));
  return scored.map((s) => s.action);
}

function subsequenceScore(haystack: string, needle: string): number | null {
  let score = 0;
  let h = 0;

  for (const ch of needle) {
    let found = -1;
    for (let i = h; i < haystack.length; i++) {
      if (haystack[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;

    // A character that begins a word is worth far more than one in the middle, which is
    // what makes an acronym-ish query land on the command the user meant.
    const atWordStart = found === 0 || haystack[found - 1] === ' ';
    score += atWordStart ? 10 : 1;
    // Adjacency keeps a literal substring ahead of a scattered subsequence.
    if (found === h) score += 5;
    h = found + 1;
  }
  return score;
}
