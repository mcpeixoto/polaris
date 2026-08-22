/**
 * The trash's two documents: what can still be brought back, and the call that brings one back.
 *
 * They live here rather than in `~/gql/operations` for the reason every feature's documents do
 * — codegen scans `src/**` and a feature's documents belong beside the code that sends them —
 * but the query is unlike every other read in the client and it is worth saying why.
 *
 * **`deletedIssues` cannot be answered from the store.** A deleted issue is precisely what the
 * replica threw away: the server emits a delete for it, the client keeps no residue by design,
 * and deleted rows are not carried on the sync stream afterwards. So this is a network read
 * whose answer lives in the screen's own state and never enters the store — the one listing in
 * the product that is not a query over the local replica, and the one place where a loading
 * spinner and a retry button are the honest thing to render.
 *
 * Both documents select the shared `IssueFields` fragment rather than the handful of columns
 * the screen shows. A restored issue arrives twice — once as this mutation's response, once as
 * an upsert on the socket — and the two have to be the same shape, or an issue that came back
 * through this screen differs from the same issue after a reload in a field nobody thought to
 * look at.
 */

import { ISSUE_FIELDS } from '~/gql/operations';

/**
 * The recycle bin: everything this caller could still restore, newest deletion first.
 *
 * The order is the server's (`ORDER BY deleted_at DESC`) and the screen keeps it, because the
 * only question this listing is asked is "what did I just lose" and the answer to that is
 * ordered by when it was lost.
 *
 * `deletedAt` and `deletedBy` are selected here and not in `IssueFields`, which is the shape
 * every other issue read shares. On every one of those reads the two are null by contract —
 * deleted rows are filtered out, so a non-null `deletedAt` anywhere else would mean the API
 * had handed somebody a row out of the trash — and asking for a field that is always null is
 * how a fragment starts describing something other than the thing it names. This is the one
 * read where they are always set, so this is the one place that asks for them.
 */
export const DELETED_ISSUES_QUERY = /* GraphQL */ `
  ${ISSUE_FIELDS}
  query DeletedIssues {
    deletedIssues {
      ...IssueFields
      deletedAt
      deletedBy
    }
  }
`;

/**
 * Brings one back, with its comments and its relations.
 *
 * Idempotent, and it has to be: the same restore may reach the server twice — once from the
 * button and once from the outbox replaying it after a dropped response — and the second
 * attempt must return the first one's answer rather than fail because the issue is no longer
 * deleted.
 */
export const RESTORE_ISSUE = /* GraphQL */ `
  ${ISSUE_FIELDS}
  mutation RestoreIssue($id: UUID!, $clientId: UUID!, $opId: UUID!) {
    restoreIssue(id: $id, clientId: $clientId, opId: $opId) {
      version
      issue {
        ...IssueFields
      }
    }
  }
`;
