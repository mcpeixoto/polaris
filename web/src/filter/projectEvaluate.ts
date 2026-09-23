/**
 * The project half of the one filter grammar.
 *
 * The AST, the operators and the comparison rules are the issue evaluator's — see
 * `evaluate.ts`, which is where those rules are explained. This file only says where a
 * project keeps each field. A second set of operators here would be a second grammar, which
 * is the failure the conformance fixture exists to catch: the project cases in
 * `schema/filter-conformance.json` run this predicate and the server's SQL over the same
 * rows.
 */

import { foldExact } from '~/store/indexes';
import type { Project, UUID } from '~/store/types';

import { resolveRelative, type TimeContext } from './relative';
import { isFilterClause, type FilterClause, type FilterNode } from './types';
import { FilterError } from './validate';

export interface ProjectFilterContext {
  readonly time: TimeContext;
  /** The category of a project status, when the replica has the status. */
  readonly categoryOf: (statusId: UUID) => string | undefined;
  /** Every team the project belongs to. Absent means none. */
  readonly teamsOf: (projectId: UUID) => ReadonlySet<UUID> | undefined;
}

type Predicate = (project: Project) => boolean;

const ALWAYS: Predicate = () => true;
const NEVER: Predicate = () => false;

/**
 * Projects the filter matches, archived and deleted excluded unless a later field says
 * otherwise.
 *
 * Those two fields are issue-only, so a project filter cannot ask for them. The default
 * is the same one the SQL compiler appends: a view that did not mention the recycle bin
 * does not contain it.
 */
export function filterProjects(
  projects: Iterable<Project>,
  filter: FilterNode,
  context: ProjectFilterContext,
): UUID[] {
  const matches = compile(filter, context);
  const ids: UUID[] = [];
  for (const project of projects) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (matches(project)) ids.push(project.id);
  }
  return ids;
}

function compile(node: FilterNode, context: ProjectFilterContext): Predicate {
  if (isFilterClause(node)) return compileClause(node, context);
  const parts = (node.nodes ?? []).map((child) => compile(child, context));
  return node.conj === 'or' ? any(parts) : all(parts);
}

function all(parts: readonly Predicate[]): Predicate {
  if (parts.length === 0) return ALWAYS;
  const only = parts[0];
  if (parts.length === 1 && only !== undefined) return only;
  return (project) => {
    for (const part of parts) {
      if (!part(project)) return false;
    }
    return true;
  };
}

function any(parts: readonly Predicate[]): Predicate {
  if (parts.length === 0) return NEVER;
  const only = parts[0];
  if (parts.length === 1 && only !== undefined) return only;
  return (project) => {
    for (const part of parts) {
      if (part(project)) return true;
    }
    return false;
  };
}

function compileClause(clause: FilterClause, context: ProjectFilterContext): Predicate {
  switch (clause.field) {
    case 'status':
      return equality(clause, (project) => project.statusId);
    case 'statusCategory':
      return equality(clause, (project) => context.categoryOf(project.statusId));
    case 'lead':
      return equality(clause, (project) => project.leadId);
    case 'priority':
      return ordered(clause, (project) => project.priority, Number);
    case 'team':
      return membership(clause, (project) => context.teamsOf(project.id));
    case 'name':
      return text(clause, (project) => project.name);
    case 'startDate':
      return ordered(clause, (project) => project.startDate, day(context.time));
    case 'targetDate':
      return ordered(clause, (project) => project.targetDate, day(context.time));
    case 'createdAt':
      return timestamp(clause, (project) => project.createdAt, context.time);
    case 'updatedAt':
      return timestamp(clause, (project) => project.updatedAt, context.time);
    default:
      throw new FilterError('', `field "${clause.field}" does not apply to projects`);
  }
}

type Read<T> = (project: Project) => T | undefined;

function equality<T extends string | number>(
  clause: FilterClause,
  read: Read<T>,
  parse: (value: string) => T = (value) => value as T,
): Predicate {
  switch (clause.op) {
    case 'isNull':
      return (project) => read(project) === undefined;
    case 'isNotNull':
      return (project) => read(project) !== undefined;
    case 'eq': {
      const wanted = parse(one(clause));
      return (project) => read(project) === wanted;
    }
    case 'neq': {
      const wanted = parse(one(clause));
      return (project) => {
        const value = read(project);
        return value === undefined || value !== wanted;
      };
    }
    case 'in': {
      const wanted = new Set((clause.values ?? []).map(parse));
      if (wanted.size === 0) return NEVER;
      return (project) => {
        const value = read(project);
        return value !== undefined && wanted.has(value);
      };
    }
    case 'notIn': {
      const wanted = new Set((clause.values ?? []).map(parse));
      if (wanted.size === 0) return ALWAYS;
      return (project) => {
        const value = read(project);
        return value === undefined || !wanted.has(value);
      };
    }
    default:
      throw new FilterError('', `operator "${clause.op}" does not apply to ${clause.field}`);
  }
}

function ordered<T extends string | number>(
  clause: FilterClause,
  read: Read<T>,
  parse: (value: string) => T,
): Predicate {
  switch (clause.op) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const bound = parse(one(clause));
      return (project) => {
        const value = read(project);
        if (value === undefined) return false;
        if (clause.op === 'gt') return value > bound;
        if (clause.op === 'gte') return value >= bound;
        if (clause.op === 'lt') return value < bound;
        return value <= bound;
      };
    }
    default:
      return equality(clause, read, parse);
  }
}

function timestamp(clause: FilterClause, read: Read<string>, time: TimeContext): Predicate {
  if (clause.op === 'isNull') return (project) => read(project) === undefined;
  if (clause.op === 'isNotNull') return (project) => read(project) !== undefined;
  return ordered(
    clause,
    (project) => {
      const raw = read(project);
      return raw === undefined ? undefined : Date.parse(raw);
    },
    instant(time),
  );
}

function text(clause: FilterClause, read: Read<string>): Predicate {
  if (clause.op !== 'contains' && clause.op !== 'notContains') {
    return equality(clause, read);
  }
  const needle = foldExact(one(clause));
  const negated = clause.op === 'notContains';
  return (project) => {
    const value = read(project);
    const hit = value !== undefined && foldExact(value).includes(needle);
    return negated ? !hit : hit;
  };
}

/** `notIn` means "on none of these teams", not "on some team outside the set". */
function membership(
  clause: FilterClause,
  read: (project: Project) => ReadonlySet<UUID> | undefined,
): Predicate {
  switch (clause.op) {
    case 'eq': {
      const wanted = one(clause);
      return (project) => read(project)?.has(wanted) === true;
    }
    case 'neq': {
      const wanted = one(clause);
      return (project) => read(project)?.has(wanted) !== true;
    }
    case 'in': {
      const wanted = clause.values ?? [];
      if (wanted.length === 0) return NEVER;
      return (project) => wanted.some((id) => read(project)?.has(id) === true);
    }
    case 'notIn': {
      const wanted = clause.values ?? [];
      if (wanted.length === 0) return ALWAYS;
      return (project) => !wanted.some((id) => read(project)?.has(id) === true);
    }
    default:
      throw new FilterError('', `operator "${clause.op}" does not apply to ${clause.field}`);
  }
}

function one(clause: FilterClause): string {
  const value = clause.values?.[0];
  if (value === undefined) {
    throw new FilterError('', `"${clause.op}" requires values; compile a validated filter`);
  }
  return value;
}

function day(time: TimeContext): (value: string) => string {
  return (value) => (isAbsolute(value) ? value : resolveRelative(value, time).date);
}

function instant(time: TimeContext): (value: string) => number {
  return (value) => (isAbsolute(value) ? Date.parse(value) : resolveRelative(value, time).instant);
}

function isAbsolute(value: string): boolean {
  const first = value.charCodeAt(0);
  return first >= 48 && first <= 57;
}
