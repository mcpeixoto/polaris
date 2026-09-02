/**
 * Which commands this person actually runs.
 *
 * Opening the palette and typing nothing used to list every available command in whatever
 * order `AppShell` happened to register them — which is to say, in an order decided by the
 * source file and identical for everybody. The palette is the surface a keyboard-first
 * product is driven from, and its empty state is the one screen where knowing the user is
 * worth more than any amount of ranking cleverness: nearly every ⌘K is one of the four
 * things you did yesterday.
 *
 * Frecency rather than a plain most-recent list, because the two answer different questions
 * and only the combination is stable. Pure recency lets one exploratory command a week ago
 * outrank the one run forty times; pure frequency freezes the list against a change in what
 * somebody is working on. So an action's weight is the sum of a decay over each of its
 * remembered uses, and the memory is short — see `RECENT_USES` — which is what keeps a
 * command that has fallen out of use from sitting at the top of the list forever.
 *
 * Everything here is pure except the two storage functions, and storage failures are not
 * errors: Safari's private mode and a sandboxed iframe both throw on `localStorage`, and
 * forgetting which commands were recent is a smaller loss than a palette that will not open.
 */

const STORAGE_KEY = 'polaris.commandMenu.recents';

/** How many uses of one command are remembered. Enough to tell habit from an accident. */
const RECENT_USES = 5;

/** How many commands are remembered at all, so the entry cannot grow with the session. */
const RECENT_ACTIONS = 40;

/**
 * The half-life of a use, in milliseconds.
 *
 * A day. Something run this morning should beat something run last week without the list
 * churning every hour, and a week away from work should not reset it.
 */
const HALF_LIFE_MS = 24 * 60 * 60 * 1000;

/** Timestamps per action id, newest last. */
export type RecentUses = Readonly<Record<string, readonly number[]>>;

export const NO_RECENTS: RecentUses = {};

/** Records one use, dropping the oldest of both dimensions. */
export function record(recents: RecentUses, actionId: string, now: number): RecentUses {
  const uses = [...(recents[actionId] ?? []), now].slice(-RECENT_USES);
  const next: Record<string, readonly number[]> = { ...recents, [actionId]: uses };

  const ids = Object.keys(next);
  if (ids.length <= RECENT_ACTIONS) return next;
  // Evict by the oldest *most recent* use, so a command used once long ago goes before one
  // used once this morning.
  ids.sort((a, b) => lastUse(next[b]) - lastUse(next[a]));
  const kept: Record<string, readonly number[]> = {};
  for (const id of ids.slice(0, RECENT_ACTIONS)) kept[id] = next[id] as readonly number[];
  return kept;
}

function lastUse(uses: readonly number[] | undefined): number {
  return uses === undefined || uses.length === 0 ? 0 : (uses[uses.length - 1] as number);
}

/**
 * How strongly this person reaches for a command, or 0 if they never have.
 *
 * Exported so ranking can add it as a term rather than sort by it alone: a recency bias that
 * overrides the typed query would make the box stop answering the question it was asked.
 */
export function frecency(recents: RecentUses, actionId: string, now: number): number {
  const uses = recents[actionId];
  if (uses === undefined) return 0;
  let weight = 0;
  for (const at of uses) weight += Math.pow(2, -Math.max(now - at, 0) / HALF_LIFE_MS);
  return weight;
}

/** The remembered commands, most wanted first. Ids only; the caller resolves them. */
export function order(recents: RecentUses, now: number): string[] {
  return Object.keys(recents)
    .filter((id) => frecency(recents, id, now) > 0)
    .sort((a, b) => frecency(recents, b, now) - frecency(recents, a, now));
}

export function load(): RecentUses {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return NO_RECENTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return NO_RECENTS;
    // Validated rather than trusted: this is storage a previous version of the app wrote,
    // and a shape change must degrade to "no history" rather than to a crashed palette.
    const out: Record<string, readonly number[]> = {};
    for (const [id, uses] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(uses) && uses.every((n) => typeof n === 'number')) out[id] = uses;
    }
    return out;
  } catch {
    return NO_RECENTS;
  }
}

export function save(recents: RecentUses): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  } catch {
    /* see the note at the top of this file */
  }
}
