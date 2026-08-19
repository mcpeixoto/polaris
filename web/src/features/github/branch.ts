/**
 * Git branch names, mirrored from the server's FormatGitBranchName.
 *
 * Copy git branch name has to work offline from the replica, so the same expansion lives
 * here rather than waiting on a round trip. The tests pin the two implementations to the
 * same strings; drift would mean a copied name that GitHub then fails to auto-link.
 */

export const DEFAULT_GIT_BRANCH_FORMAT = '{identifier}-{title}';
export const MAX_GIT_BRANCH_LEN = 80;

export interface GitBranchParts {
  readonly identifier: string;
  readonly title: string;
  readonly user: string;
}

export function formatGitBranchName(format: string, parts: GitBranchParts): string {
  const template = format.trim() === '' ? DEFAULT_GIT_BRANCH_FORMAT : format;
  const repl: Record<string, string> = {
    identifier: slug(parts.identifier, false),
    title: slug(parts.title, true),
    user: slug(parts.user, true),
  };
  let out = '';
  let s = template;
  while (s.length > 0) {
    const start = s.indexOf('{');
    if (start < 0) {
      out += s;
      break;
    }
    out += s.slice(0, start);
    const endRel = s.slice(start).indexOf('}');
    if (endRel < 0) break;
    const end = start + endRel;
    const key = s
      .slice(start + 1, end)
      .trim()
      .toLowerCase();
    if (key in repl) out += repl[key] ?? '';
    s = s.slice(end + 1);
  }
  return clipBranch(collapseSlashes(out));
}

function slug(value: string, allowEmpty: boolean): string {
  let out = '';
  let prevHyphen = false;
  for (const ch of value.trim().toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      prevHyphen = false;
    } else {
      if (out.length === 0 || prevHyphen) continue;
      out += '-';
      prevHyphen = true;
    }
  }
  out = out.replace(/^-+|-+$/g, '');
  if (out === '' && !allowEmpty) return 'issue';
  return out;
}

function collapseSlashes(value: string): string {
  let s = value;
  while (s.includes('//')) s = s.replaceAll('//', '/');
  return s.replace(/^[/-]+|[/-]+$/g, '');
}

function clipBranch(value: string): string {
  if (value.length <= MAX_GIT_BRANCH_LEN) return value.replace(/^[/-]+|[/-]+$/g, '');
  return value.slice(0, MAX_GIT_BRANCH_LEN).replace(/[/-]+$/g, '');
}
