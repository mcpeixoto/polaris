/**
 * Project list ordering — priority band first, then fractional sortOrder within the band.
 */

import type { Project } from '~/store';
import { priorityRank } from '~/store';

export function compareProjectsByPriority(a: Project, b: Project): number {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0) return byPriority;
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder < b.sortOrder ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort(compareProjectsByPriority);
}
