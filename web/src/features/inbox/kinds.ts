/**
 * Why a notification arrived, in the four or five words somebody would use to ask for it.
 *
 * The inbox's main affordance at volume is "show me only the things that were addressed to
 * me" — a mention is a request, a status change on an issue you follow is a fact — and the
 * store answers a narrower question than that: it holds twenty `NotificationType`s, which
 * is a taxonomy of events rather than of reasons. A menu of twenty is not a filter anybody
 * uses, and half of its rows would be things nobody has ever wanted to see on their own.
 *
 * So the types are folded into six reasons, and the fold is total: every type belongs to
 * exactly one kind, which the test beside this file proves against `GLYPH_TYPES` rather
 * than against a list written out a second time here. A type this build has not heard of
 * falls to `activity`, for the same reason `describeEvent` falls back to "updated" — a
 * newer server can deliver one, and a row that no filter can reach is a row that vanishes.
 *
 * Each kind names a type to draw for it, so the menu uses the glyphs the rows already use
 * rather than growing a second set that can drift from them.
 */

import type { NotificationType } from '~/store';

export type InboxKind = 'assigned' | 'mentioned' | 'commented' | 'status' | 'due' | 'activity';

export const INBOX_KINDS: readonly InboxKind[] = [
  'assigned',
  'mentioned',
  'commented',
  'status',
  'due',
  'activity',
];

export const INBOX_KIND_NAMES: Readonly<Record<InboxKind, string>> = {
  assigned: 'Assigned',
  mentioned: 'Mentioned',
  commented: 'Comments',
  status: 'Status changes',
  due: 'Due dates',
  activity: 'Subscribed activity',
};

/** The type whose glyph stands for the whole kind in the filter menu. */
export const INBOX_KIND_GLYPH_TYPES: Readonly<Record<InboxKind, NotificationType>> = {
  assigned: 'issue_assigned',
  mentioned: 'mention',
  commented: 'comment',
  status: 'issue_status_changed',
  due: 'issue_due',
  activity: 'project_update',
};

const KIND_OF: Partial<Record<NotificationType, InboxKind>> = {
  issue_assigned: 'assigned',
  mention: 'mentioned',
  comment: 'commented',
  issue_status_changed: 'status',
  issue_priority_raised: 'status',
  issue_blocked: 'status',
  sub_issue_completed: 'status',
  issue_due: 'due',
};

export function kindOf(type: NotificationType): InboxKind {
  return KIND_OF[type] ?? 'activity';
}

/**
 * Whether a row survives the filter, where nothing chosen means everything.
 *
 * An empty set is "no filter" rather than "no rows". The alternative — starting with every
 * kind ticked — makes clearing the last tick empty the screen, which reads as a fault and
 * is the commonest way a filter menu loses somebody.
 */
export function matchesKinds(type: NotificationType, kinds: ReadonlySet<InboxKind>): boolean {
  return kinds.size === 0 || kinds.has(kindOf(type));
}
