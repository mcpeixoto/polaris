/**
 * Pulse: the workspace feed of project updates, read from the replica.
 *
 * Linear Pulse is status posts teams already write — health plus body. For me and
 * Recent rank by recency. Popular ranks by comments on that project's issues posted
 * at or after the update. Custom feeds are personal named subsets of the same rows.
 * Emoji reactions and initiative updates stay later.
 */

import { dayKeyOf } from '~/features/inbox/inbox';
import type { ProjectUpdateHealth, PulseFeed, Store, UUID } from '~/store';

/** How many posts the page keeps. Project updates are rare; this is a busy quarter, not a busy hour. */
export const PULSE_LIMIT = 100;

export type PulseTab = 'for-me' | 'popular' | 'recent' | `feed:${string}`;

export function feedIdOf(tab: PulseTab): UUID | null {
  return tab.startsWith('feed:') ? tab.slice(5) : null;
}

export interface PulseEvent {
  readonly id: UUID;
  readonly at: string;
  readonly href: string;
  readonly actor: string;
  readonly projectId: UUID;
  readonly projectName: string;
  readonly health: ProjectUpdateHealth;
  readonly body: string;
  readonly forMe: boolean;
}

export interface PulseDay {
  readonly key: string;
  readonly events: readonly PulseEvent[];
}

export function listPulseFeeds(store: Store, viewerId: UUID | null): readonly PulseFeed[] {
  if (viewerId === null) return [];
  const out: PulseFeed[] = [];
  for (const feed of store.pulseFeeds.values()) {
    if (feed.userId === viewerId) out.push(feed);
  }
  out.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

export function listPulse(
  store: Store,
  viewerId: UUID | null,
  tab: PulseTab,
  timezone: string,
): readonly PulseDay[] {
  const mine = membership(store, viewerId);
  const names = userNames(store);
  const feedId = feedIdOf(tab);
  const allowed = feedId === null ? null : new Set(store.pulseFeeds.get(feedId)?.projectIds ?? []);

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
    if (allowed !== null && !allowed.has(project.id)) continue;
    events.push({
      id: update.id,
      at: update.createdAt,
      href: `/project/${project.id}/activity`,
      actor: names.get(update.authorId) ?? 'Someone',
      projectId: project.id,
      projectName: project.name,
      health: update.health,
      body: update.body,
      forMe: mine.has(project.id),
    });
  }

  const visible = tab === 'for-me' ? events.filter((row) => row.forMe) : events;
  if (tab === 'popular') {
    const scores = commentTimesByProject(store);
    visible.sort((a, b) => {
      const byScore = scoreOf(scores, b) - scoreOf(scores, a);
      if (byScore !== 0) return byScore;
      return byRecency(a, b);
    });
  } else {
    visible.sort(byRecency);
  }

  const sliced = visible.slice(0, PULSE_LIMIT);
  const days: PulseDay[] = [];
  const byKey = new Map<string, PulseEvent[]>();
  for (const event of sliced) {
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

/** Comment timestamps on issues, grouped by the issue's project. */
function commentTimesByProject(store: Store): Map<UUID, number[]> {
  const issueProject = new Map<UUID, UUID>();
  for (const issue of store.issues.values()) {
    if (issue.projectId === undefined) continue;
    issueProject.set(issue.id, issue.projectId);
  }
  const byProject = new Map<UUID, number[]>();
  for (const comment of store.comments.values()) {
    const projectId = issueProject.get(comment.issueId);
    if (projectId === undefined) continue;
    const at = Date.parse(comment.createdAt);
    if (Number.isNaN(at)) continue;
    const times = byProject.get(projectId);
    if (times !== undefined) times.push(at);
    else byProject.set(projectId, [at]);
  }
  return byProject;
}

function scoreOf(scores: Map<UUID, number[]>, event: PulseEvent): number {
  const times = scores.get(event.projectId);
  if (times === undefined) return 0;
  const at = Date.parse(event.at);
  if (Number.isNaN(at)) return 0;
  let n = 0;
  for (const commentAt of times) {
    if (commentAt >= at) n += 1;
  }
  return n;
}

function byRecency(a: PulseEvent, b: PulseEvent): number {
  const aAt = Date.parse(a.at);
  const bAt = Date.parse(b.at);
  if (aAt !== bAt) return (Number.isNaN(bAt) ? 0 : bAt) - (Number.isNaN(aAt) ? 0 : aAt);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
