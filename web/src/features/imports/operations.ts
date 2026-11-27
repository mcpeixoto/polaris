/**
 * Import documents.
 *
 * They live here rather than in `~/gql/operations` for the reason every feature's documents
 * do — codegen scans `src/**` and a document belongs beside the code that sends it — and,
 * as with API keys, the filing is load-bearing. There is no import entity on the sync
 * stream, so these three documents are the only path to the data. A screen that wants a
 * current list has to ask for one.
 *
 * `ImportJobFields` must never grow an API key. There is none on `ImportJob` to select:
 * the source credential exists in the mutation's variables and in the job row only while
 * the job can still run, and nowhere a query can reach.
 */

/**
 * A job as this screen draws it. `error` is the failure the admin is owed; the other
 * timestamps are how the row says whether the job has actually begun.
 */
export const IMPORT_JOB_FIELDS = /* GraphQL */ `
  fragment ImportJobFields on ImportJob {
    id
    source
    status
    progress {
      entity
      done
      total
    }
    error
    createdAt
    startedAt
    finishedAt
  }
`;

/**
 * The workspace's recent imports, newest first.
 *
 * Admins only, which is the server's decision: a member has nothing to do with a job
 * they cannot start, and the list is not a directory of other people's credentials.
 */
export const IMPORT_JOBS_QUERY = /* GraphQL */ `
  ${IMPORT_JOB_FIELDS}
  query ImportJobs {
    importJobs {
      ...ImportJobFields
    }
  }
`;

/** One import. The list is what the screen polls; this is the same shape for one id. */
export const IMPORT_JOB_QUERY = /* GraphQL */ `
  ${IMPORT_JOB_FIELDS}
  query ImportJob($id: UUID!) {
    importJob(id: $id) {
      ...ImportJobFields
    }
  }
`;

/**
 * Queue an import of the Linear workspace the key belongs to.
 *
 * The key is a variable, not a selection. The response is the job, which is all the
 * caller is allowed to keep: the server checks the key before queueing and drops it
 * when the job ends.
 */
export const START_LINEAR_IMPORT = /* GraphQL */ `
  ${IMPORT_JOB_FIELDS}
  mutation StartLinearImport($apiKey: String!) {
    startLinearImport(apiKey: $apiKey) {
      ...ImportJobFields
    }
  }
`;
