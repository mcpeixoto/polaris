/**
 * Directory submissions: a proposal to list a third-party integration.
 *
 * Not on the replica — same data path as invitations. The catalogue itself is derived
 * from live connection rows; this is the inbox of "please list this tool".
 */

import { gql } from '~/sync/api';

export const INTEGRATION_SUBMISSIONS_QUERY = /* GraphQL */ `
  query IntegrationSubmissions {
    integrationSubmissions {
      id
      workspaceId
      submittedBy
      name
      website
      summary
      createdAt
      updatedAt
    }
  }
`;

export const SUBMIT_INTEGRATION = /* GraphQL */ `
  mutation SubmitIntegration($input: SubmitIntegrationInput!) {
    submitIntegration(input: $input) {
      submission {
        id
        workspaceId
        submittedBy
        name
        website
        summary
        createdAt
        updatedAt
      }
    }
  }
`;

export interface IntegrationSubmission {
  readonly id: string;
  readonly workspaceId: string;
  readonly submittedBy: string;
  readonly name: string;
  readonly website: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubmitIntegrationInput {
  readonly name: string;
  readonly website: string;
  readonly summary: string;
}

export async function fetchIntegrationSubmissions(
  signal?: AbortSignal,
): Promise<readonly IntegrationSubmission[]> {
  const data = await gql<{
    integrationSubmissions: readonly IntegrationSubmission[];
  }>(INTEGRATION_SUBMISSIONS_QUERY, undefined, { signal });
  return data.integrationSubmissions;
}

export async function submitIntegration(
  input: SubmitIntegrationInput,
): Promise<IntegrationSubmission> {
  const data = await gql<{
    submitIntegration: { submission: IntegrationSubmission };
  }>(SUBMIT_INTEGRATION, { input });
  return data.submitIntegration.submission;
}
