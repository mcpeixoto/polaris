/**
 * Pulse: the workspace feed of project updates, read from the replica.
 *
 * Linear Pulse is not a second history of every issue edit. It is the status posts
 * teams already write — health plus body — ranked by recency. Inbox digests, custom
 * feeds, Popular, and initiative updates stay later; this slice only ranks rows the
 * replica already holds.
 */

import { dayKeyOf } from '~/features/inbox/inbox';
import type { ProjectUpdateHealth, Store, UUID } from '~/store';

/** How many posts the page keeps. Project updates are rare; this is a busy quarter, not a busy hour. */
export const PULSE_LIMIT = 100;

export type PulseTab = 'for-me' | 'recent';

export interface PulseEvent {
  readonly id: UUID;
  readonly at: string;
  readonly href: string;
  readonly actor: string;
  readonly projectName: string;
  readonly health: ProjectUpdateHealth;
  readonly body: string;
  readonly forMe: boolean;
}

export interface PulseDay {
  readonly key: string;
  readonly events: readonly PulseEvent[];
}

export function listPulse(
  store: Store,
  viewerId: UUID | null,
  tab: PulseTab,
  timezone: string,
): readonly PulseDay[] {
  const mine = membership(store, viewerId);
  const names = userNames(store);
  const events: PulseEvent[] = [];

  for (const update of store.projectUpdates.values()) {
    if (update.deletedAt !== undefined) continue;
    const project = store.projects.get(update.projectId);
    if (
      project === undefined ||
      project.archivedAt !== undefined ||
      project.deletedAt !== undefined
    ) {
      continue;
    }
    events.push({
      id: update.id,
      at: update.createdAt,
      href: `/project/${project.id}/activity`,
      actor: names.get(update.authorId) ?? 'Someone',
      projectName: project.name,
      health: update.health,
      body: update.body,
      forMe: mine.has(project.id),
    });
  }

  events.sort(byRecency);
  const sliced = events.slice(0, PULSE_LIMIT);
  const visible = tab === 'for-me' ? sliced.filter((row) => row.forMe) : sliced;

  const days: PulseDay[] = [];
  const byKey = new Map<string, PulseEvent[]>();
  for (const event of visible) {
    const key = dayKeyOf(event.at, timezone);
    const bucket = byKey.get(key);
    if (bucket !== undefined) {
      bucket.push(event);
      continue;
    }
    const next = [event];
    byKey.set(key, next);
    days.push({ key, events: next });
  }
  return days;
}

function membership(store: Store, viewerId: UUID | null): Set<UUID> {
  const ids = new Set<UUID>();
  if (viewerId === null) return ids;
  for (const project of store.projects.values()) {
    if (project.leadId === viewerId || project.creatorId === viewerId) ids.add(project.id);
  }
  for (const member of store.projectMembers.values()) {
    if (member.userId === viewerId) ids.add(member.projectId);
  }
  return ids;
}

function userNames(store: Store): Map<UUID, string> {
  const names = new Map<UUID, string>();
  for (const user of store.users.values()) {
    names.set(user.id, user.displayName);
  }
  return names;
}

function byRecency(a: PulseEvent, b: PulseEvent): number {
  const aAt = Date.parse(a.at);
  const bAt = Date.parse(b.at);
  if (aAt !== bAt) return (Number.isNaN(bAt) ? 0 : bAt) - (Number.isNaN(aAt) ? 0 : aAt);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
