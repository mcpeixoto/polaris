/**
 * The reaction row under a comment: the pills, and the control that adds one.
 *
 * Read from the replica, so a click draws its own pill on the same frame and the same pill
 * survives the reload a second later. A pill is a toggle rather than a display — clicking
 * one you are already in takes you out of it, which is the behaviour every product with
 * these has trained people to expect.
 *
 * The picker is a popover rather than a menu: the choices are a grid of glyphs with no
 * shortcuts and nothing to filter, which is the case `Menu` is explicitly not for. It
 * follows `components/ColorPicker.tsx` in every other respect — `aria-haspopup="dialog"`,
 * Escape closing it and handing focus back to the trigger, and a capture-phase
 * `pointerdown` closing it when the next click lands somewhere else.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useEngine } from '~/app/context';
import { IconButton, Tooltip } from '~/components';
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Reaction, UUID } from '~/store';

import { toggleReaction } from './mutations';
import styles from './Reactions.module.css';

/**
 * What the picker offers.
 *
 * A named set rather than a full emoji keyboard, for the same reason `ColorPicker` ships
 * sixteen swatches: the answer is nearly always one of a handful, and a grid of two
 * thousand glyphs is a search problem nobody asked for. The name is not decoration — it is
 * the button's accessible name, because a screen reader handed a bare glyph announces the
 * Unicode name of whatever the platform thinks it is, and in a grid of twenty that is
 * twenty controls called nothing useful.
 */
export const REACTIONS: readonly { readonly emoji: string; readonly name: string }[] = [
  { emoji: '👍', name: 'Thumbs up' },
  { emoji: '👎', name: 'Thumbs down' },
  { emoji: '😄', name: 'Smile' },
  { emoji: '🎉', name: 'Celebration' },
  { emoji: '😕', name: 'Confused' },
  { emoji: '❤️', name: 'Heart' },
  { emoji: '🚀', name: 'Rocket' },
  { emoji: '👀', name: 'Eyes' },
  { emoji: '🙏', name: 'Thank you' },
  { emoji: '🔥', name: 'Fire' },
  { emoji: '💯', name: 'Hundred' },
  { emoji: '🤔', name: 'Thinking' },
];

/** The name for an emoji that is not in the set above — somebody else's client had more. */
export function reactionName(emoji: string): string {
  return REACTIONS.find((one) => one.emoji === emoji)?.name ?? emoji;
}

interface ReactionsProps {
  commentId: UUID;
  /** Null while the viewer is unknown: the pills are still shown, and nothing is clickable. */
  viewerId: UUID | null;
  /** User id to display name, the same map the comment header reads. */
  names: Record<string, string>;
  /**
   * What this row belongs to, for the accessible names — "the comment from Ada, 2 hours ago".
   * A thread of six otherwise has six controls announced as "Add reaction".
   */
  subject: string;
}

interface Group {
  readonly emoji: string;
  readonly count: number;
  /** Whether the viewer is one of them. Drives the pressed state and the toggle's direction. */
  readonly mine: boolean;
  readonly who: readonly string[];
}

export function Reactions({ commentId, viewerId, names, subject }: ReactionsProps) {
  const engine = useEngine();

  const rows = useLiveQuery(
    (store) =>
      [...store.reactionIdsFor(commentId)]
        .map((id) => store.get('reaction', id))
        .filter((row): row is Reaction => row !== undefined)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ['reaction'],
    [commentId],
  );

  const groups = useMemo(() => group(rows, viewerId, names), [rows, viewerId, names]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Opening it puts the keyboard where the choices are. A popover that opens behind the
  // caret costs a Tab that nothing on screen tells you to press.
  useEffect(() => {
    if (open) firstChoiceRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const toggle = (emoji: string) => {
    if (viewerId === null) return;
    toggleReaction(engine, commentId, emoji, viewerId).catch(report);
  };

  // Nothing to show and nobody to react: the row is not drawn at all rather than left as an
  // empty strip under every comment in a read-only thread.
  if (groups.length === 0 && viewerId === null) return null;

  return (
    <div ref={rootRef} className={styles.root}>
      <ul className={styles.pills}>
        {groups.map((one) => (
          <li key={one.emoji}>
            {/* `describe={false}`: the names are already in the accessible name, and hearing
                them twice is worse than hearing them once. The tip is for the eye. */}
            <Tooltip
              label={`${list(one.who)} reacted with ${reactionName(one.emoji).toLowerCase()}`}
              describe={false}
            >
              <button
                type="button"
                className={[styles.pill, one.mine ? styles.mine : null].filter(Boolean).join(' ')}
                aria-pressed={one.mine}
                aria-label={pillLabel(one, subject)}
                disabled={viewerId === null}
                onClick={() => toggle(one.emoji)}
              >
                <span className={styles.emoji} aria-hidden="true">
                  {one.emoji}
                </span>
                <span className={styles.count}>{one.count}</span>
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>

      {viewerId === null ? null : (
        <div
          className={styles.picker}
          onKeyDown={
            /* keymap-lint-allow: Escape closes this popover the way it closes every other
               layer, and it is handled here rather than in the panel so that it also works
               with focus still on the trigger. The registry has no context for a picker
               that is not a Menu. */ (event) => {
              if (event.key !== 'Escape' || !open) return;
              event.stopPropagation();
              close();
            }
          }
        >
          <IconButton
            ref={triggerRef}
            size="sm"
            icon={<AddReactionGlyph />}
            aria-label={`React to ${subject}`}
            tooltip="Add reaction"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((current) => !current)}
          />

          {open ? (
            <div
              id={panelId}
              className={styles.panel}
              role="dialog"
              aria-label={`React to ${subject}`}
            >
              <div className={styles.grid}>
                {REACTIONS.map(({ emoji, name }, position) => (
                  <button
                    key={emoji}
                    ref={position === 0 ? firstChoiceRef : undefined}
                    type="button"
                    className={styles.choice}
                    aria-label={name}
                    aria-pressed={groups.some((one) => one.emoji === emoji && one.mine)}
                    onClick={() => {
                      toggle(emoji);
                      close();
                    }}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One entry per emoji, in the order the first of each arrived.
 *
 * Ordering by first use rather than by count keeps the row still: a pill that overtakes its
 * neighbour moves every pill after it, under somebody's pointer, mid-click.
 */
function group(
  rows: readonly Reaction[],
  viewerId: UUID | null,
  names: Record<string, string>,
): readonly Group[] {
  const byEmoji = new Map<string, { count: number; mine: boolean; who: string[] }>();
  for (const row of rows) {
    const entry = byEmoji.get(row.emoji) ?? { count: 0, mine: false, who: [] };
    entry.count += 1;
    if (viewerId !== null && row.userId === viewerId) entry.mine = true;
    entry.who.push(names[row.userId] ?? 'Somebody');
    byEmoji.set(row.emoji, entry);
  }
  return [...byEmoji].map(([emoji, entry]) => ({ emoji, ...entry }));
}

/**
 * What a screen reader says on a pill.
 *
 * The emoji is not read out — it is `aria-hidden`, because a glyph announced by its Unicode
 * name in the middle of a sentence is noise. So the name is spelled here, with who reacted,
 * because "thumbs up, 3" tells a person nothing they could act on and the names are the
 * whole reason the pill is hovered.
 */
function pillLabel(one: Group, subject: string): string {
  const who = one.who.length <= 3 ? list(one.who) : `${list(one.who.slice(0, 3))} and others`;
  const name = reactionName(one.emoji).toLowerCase();
  return one.mine
    ? `Remove your ${name} reaction to ${subject}. ${who} reacted`
    : `React with ${name} to ${subject}. ${who} reacted`;
}

function list(who: readonly string[]): string {
  if (who.length <= 1) return who[0] ?? 'Nobody';
  return `${who.slice(0, -1).join(', ')} and ${who[who.length - 1] ?? ''}`;
}

/** A face with a plus. Drawn here because nothing else in the product adds a reaction. */
function AddReactionGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle
        cx="6.5"
        cy="7.5"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="24 6"
      />
      <circle cx="4.7" cy="6" r="0.8" fill="currentColor" />
      <circle cx="8.3" cy="6" r="0.8" fill="currentColor" />
      <path
        d="M4.4 9.2a2.8 2.8 0 0 0 4.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M11.5 1v3.4M9.8 2.7h3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
