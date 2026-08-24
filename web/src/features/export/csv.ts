/**
 * CSV export of the replica.
 *
 * View and project exports are the issues (or projects) already on screen, which is the
 * replica after the same visibility predicate the rest of the product uses. Workspace
 * export is the same list without a view filter, capped the way the docs cap it: 250 for
 * members, 2,000 for admins. Guests cannot export.
 *
 * The file is built here rather than asked of the server so a filtered view of 40 issues
 * does not become a round trip that re-implements the filter. Permission filtering still
 * has one definition: the replica never held a row the caller could not see.
 */

import { priorityLabel } from '~/components';
import type { Issue, Project, Store, User, UUID } from '~/store';

export type ExportRole = 'owner' | 'admin' | 'member' | 'guest';

const MEMBER_ISSUE_CAP = 250;
const ADMIN_ISSUE_CAP = 2000;
const PROJECT_CAP = 200;

export function exportCap(role: ExportRole, kind: 'issues' | 'projects'): number {
  if (role === 'guest') return 0;
  if (kind === 'projects') return PROJECT_CAP;
  return role === 'member' ? MEMBER_ISSUE_CAP : ADMIN_ISSUE_CAP;
}

/**
 * The sentence to show when the cap took rows out of the file, or null when it did not.
 *
 * Lives here, beside `exportCap`, because the cap and the admission that it applied are one
 * fact. The workspace page told people ("Exported the first 250 issues…") and the two
 * command-menu exports — the view and the project list, which are where most exports
 * actually happen — silently handed back a short file: a member exporting a 300-issue view
 * received 250 rows, no message, no toast, nothing on screen. A truncated export that says
 * nothing is worse than a refused one, because the file looks complete and is acted on.
 *
 * `total` is the number of rows the caller *would* have written, not the size of the
 * replica: counting rows that were never candidates announces a truncation that did not
 * happen.
 */
export function exportCapNote(
  total: number,
  cap: number,
  noun: 'issues' | 'projects',
): string | null {
  if (total <= cap) return null;
  const shown = cap.toLocaleString('en-US');
  const all = total.toLocaleString('en-US');
  return `Exported the first ${shown} of ${all} ${noun}. Narrow the list with a filter and export again for the rest.`;
}

/**
 * Cells a spreadsheet would run instead of read.
 *
 * Excel, LibreOffice and Sheets all treat a cell that opens with `=`, `+`, `-` or `@` as a
 * formula, and `\t` / `\r` as leading whitespace they strip before applying that same rule.
 * An issue titled `=SUM(A1:A9)+cmd|'/c calc'!A0` is therefore not text in the exported file;
 * it is a DDE payload that fires when somebody opens their own export. The title arrived
 * through a normal issue form, so nothing upstream of here will ever refuse it.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A plain number, which is the one thing we must NOT defuse.
 *
 * `-5` and `+5` open with a guarded character and is not a formula, and an estimate or a burndown
 * delta that arrived as text instead of a number turns every downstream SUM into a zero.
 * Numbers are recognised and left alone; everything else that opens dangerously is quoted.
 */
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Neutralise a cell a spreadsheet would otherwise execute.
 *
 * The apostrophe is the mitigation every spreadsheet understands, and it is a real cost: it
 * is part of the field on the wire, so a reader that does not strip it sees one extra
 * character, and a naive re-import would store the apostrophe in the title. That cost is
 * paid only by the cells that would otherwise be code — a title starting with `=` — and it
 * is the cheaper half of the trade. The alternative is shipping a file that runs a stranger's
 * formula on the machine of whoever opens it, and no amount of clean round-tripping is worth
 * that. Polaris has no CSV importer today, so nothing in the product reads these files back;
 * if one is ever written, it strips a leading apostrophe from a formula-leading cell and the
 * round trip closes.
 */
export function csvGuard(value: string): string {
  if (!FORMULA_LEAD.test(value)) return value;
  if (PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

export function csvEscape(value: string): string {
  const guarded = csvGuard(value);
  if (/[",\n\r]/.test(guarded) || guarded !== value) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }
  return guarded;
}

/**
 * Rows joined with CRLF, because RFC 4180 says CRLF and Excel believes it.
 *
 * A newline *inside* a quoted field is left exactly as the value had it: that one is data,
 * not a record separator, and rewriting it would edit somebody's description.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell)).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The byte-order mark Excel needs to believe a .csv is UTF-8.
 *
 * Without it Excel on Windows decodes the file in the system ANSI codepage, so `é` arrives as
 * `Ã©` and `日本語` as mojibake — for a workspace that does not write in English that is every
 * row, not an edge case. It lives here rather than in `toCsv` because it is a property of the
 * file being handed to an operating system, not of the CSV text: a caller that wants the text
 * still gets text.
 */
const UTF8_BOM = '\uFEFF';

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM, csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const ISSUE_HEADERS = [
  'ID',
  'Team',
  'Title',
  'Description',
  'Status',
  'Estimate',
  'Priority',
  'Project ID',
  'Project',
  'Creator',
  'Assignee',
  'Labels',
  'Cycle Number',
  'Cycle Name',
  'Cycle Start',
  'Cycle End',
  'Created',
  'Updated',
  'Started',
  'Completed',
  'Canceled',
  'Archived',
  'Due Date',
  'Parent issue',
  'Project Milestone ID',
  'Project Milestone',
] as const;

const PROJECT_HEADERS = [
  'Name',
  'Summary',
  'Status',
  'Milestones',
  'Creator',
  'Lead',
  'Members',
  'Created At',
  'Started At',
  'Target Date',
  'Teams',
] as const;

export function issuesToCsv(store: Store, ids: readonly UUID[]): string {
  const rows = ids.map((id) => issueRow(store, store.issues.get(id))).filter((row) => row !== null);
  return toCsv(ISSUE_HEADERS, rows);
}

export function projectsToCsv(store: Store, ids: readonly UUID[]): string {
  const rows = ids
    .map((id) => projectRow(store, store.projects.get(id)))
    .filter((row) => row !== null);
  return toCsv(PROJECT_HEADERS, rows);
}

function issueRow(store: Store, issue: Issue | undefined): string[] | null {
  if (issue === undefined) return null;
  const team = store.teams.get(issue.teamId);
  const state = store.workflowStates.get(issue.stateId);
  const project = issue.projectId === undefined ? undefined : store.projects.get(issue.projectId);
  const creator = issue.creatorId === undefined ? undefined : store.users.get(issue.creatorId);
  const assignee = issue.assigneeId === undefined ? undefined : store.users.get(issue.assigneeId);
  const cycle = issue.cycleId === undefined ? undefined : store.cycles.get(issue.cycleId);
  const parent = issue.parentId === undefined ? undefined : store.issues.get(issue.parentId);
  const milestone =
    issue.projectMilestoneId === undefined
      ? undefined
      : store.projectMilestones.get(issue.projectMilestoneId);

  const labels: string[] = [];
  for (const labelId of store.labelIdsFor(issue.id)) {
    const label = store.labels.get(labelId);
    if (label !== undefined) labels.push(label.name);
  }

  return [
    store.identifierOf(issue),
    team?.key ?? '',
    issue.title,
    issue.description,
    state?.name ?? '',
    issue.estimate === undefined ? '' : String(issue.estimate),
    priorityLabel(issue.priority),
    project?.id ?? '',
    project?.name ?? '',
    nameOf(creator),
    nameOf(assignee),
    labels.join(', '),
    cycle === undefined ? '' : String(cycle.number),
    cycle?.name ?? '',
    cycle?.startsAt ?? '',
    cycle?.endsAt ?? '',
    issue.createdAt,
    issue.updatedAt,
    issue.startedAt ?? '',
    issue.completedAt ?? '',
    issue.canceledAt ?? '',
    issue.archivedAt ?? '',
    issue.dueDate ?? '',
    parent === undefined ? '' : store.identifierOf(parent),
    milestone?.id ?? '',
    milestone?.name ?? '',
  ];
}

function projectRow(store: Store, project: Project | undefined): string[] | null {
  if (project === undefined) return null;
  const status = store.projectStatuses.get(project.statusId);
  const creator = project.creatorId === undefined ? undefined : store.users.get(project.creatorId);
  const lead = project.leadId === undefined ? undefined : store.users.get(project.leadId);

  const milestones: string[] = [];
  for (const id of store.projectMilestoneIdsFor(project.id)) {
    const milestone = store.projectMilestones.get(id);
    if (milestone !== undefined && milestone.archivedAt === undefined)
      milestones.push(milestone.name);
  }

  const members: string[] = [];
  for (const id of store.projectMemberIdsFor(project.id)) {
    const membership = store.projectMembers.get(id);
    if (membership === undefined) continue;
    const user = store.users.get(membership.userId);
    if (user !== undefined) members.push(nameOf(user));
  }

  const teams: string[] = [];
  for (const id of store.projectTeamIdsFor(project.id)) {
    const link = store.projectTeams.get(id);
    if (link === undefined) continue;
    const team = store.teams.get(link.teamId);
    if (team !== undefined) teams.push(team.key);
  }

  return [
    project.name,
    project.summary ?? '',
    status?.name ?? '',
    milestones.join(', '),
    nameOf(creator),
    nameOf(lead),
    members.join(', '),
    project.createdAt,
    project.startDate ?? '',
    project.targetDate ?? '',
    teams.join(', '),
  ];
}

function nameOf(user: User | undefined): string {
  return user?.displayName ?? '';
}
