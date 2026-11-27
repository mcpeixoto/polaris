/**
 * Import reads and the one write.
 *
 * None of them go through `engine.mutate`. There is no replica row for an import job, so
 * there is no optimistic patch for the outbox to protect — and the write's variable is a
 * Linear API key. The outbox replays a queued mutation by re-sending its variables and
 * discarding the result, which would store that key on the device until the network came
 * back and then throw the job away. The key has to be handed over now, in front of the
 * person who pasted it, or not at all.
 *
 * Nothing here logs the key. It is a function argument and a GraphQL variable, and it is
 * not on any type this module returns.
 */

import { gql } from '~/sync/api';
import { IMPORT_JOB_QUERY, IMPORT_JOBS_QUERY, START_LINEAR_IMPORT } from './operations';

export interface ImportProgress {
  readonly entity: string;
  readonly done: number;
  readonly total: number;
}

/** A job as the listing may hold it. The source API key is not a field. */
export interface ImportJob {
  readonly id: string;
  readonly source: string;
  readonly status: string;
  readonly progress: readonly ImportProgress[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** queued or running: the screen keeps asking. done and failed are the answer. */
export function importInFlight(job: ImportJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

export async function listImportJobs(signal?: AbortSignal): Promise<readonly ImportJob[]> {
  const data = await gql<{ importJobs: readonly ImportJob[] }>(IMPORT_JOBS_QUERY, undefined, {
    signal,
  });
  return data.importJobs;
}

/** One job. Null when the id is not one of this workspace's. */
export async function fetchImportJob(id: string, signal?: AbortSignal): Promise<ImportJob | null> {
  const data = await gql<{ importJob: ImportJob | null }>(IMPORT_JOB_QUERY, { id }, { signal });
  return data.importJob;
}

/**
 * Queues the import and returns the job.
 *
 * The key is trimmed by the caller. This sends exactly what it is given: a key that
 * fails Linear's check fails here, in this call, rather than as a job that sits queued
 * and then dies where nobody is looking.
 */
export async function startLinearImport(apiKey: string): Promise<ImportJob> {
  const data = await gql<{ startLinearImport: ImportJob }>(START_LINEAR_IMPORT, { apiKey });
  return data.startLinearImport;
}
