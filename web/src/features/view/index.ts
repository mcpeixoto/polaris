/**
 * What a view is, on the client.
 *
 * A view is a filter, a set of display options and the issues that fall out of them. The
 * three files here are the whole of that, and they are deliberately plain functions rather
 * than hooks: the same code runs in the list, in the board, in the command menu's preview
 * and in a test, and a hook would make three of those four awkward.
 *
 *   `context.ts`  the bridge from the replica to the filter grammar
 *   `group.ts`    grouping and ordering — the other half of the display options
 */

export { filterContextFor } from './context';
export type { ViewClock } from './context';

export { groupIssues, sortIssues, subGroupIssues } from './group';
export type { IssueGroup } from './group';
