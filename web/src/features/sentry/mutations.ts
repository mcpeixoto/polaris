/**
 * Sentry writes. Connection settings are replicated, so the settings screen reads them
 * from the store; these mutations are the write path. The webhook secret is not
 * replicated and is fetched with SentrySettings.
 */

import { gql } from '~/sync/api';

export const SENTRY_CONNECTION_FIELDS = /* GraphQL */ `
  fragment SentryConnectionFields on SentryConnection {
    id
    workspaceId
    creatorId
    enabled
    defaultTeamId
    organizationSlug
    connectedAt
    createdAt
    updatedAt
  }
`;

export const SENTRY_SETTINGS_QUERY = /* GraphQL */ `
  query SentrySettings {
    sentryWebhook {
      url
      secret
    }
  }
`;

export const CREATE_SENTRY_CONNECTION = /* GraphQL */ `
  ${SENTRY_CONNECTION_FIELDS}
  mutation CreateSentryConnection($input: CreateSentryConnectionInput!) {
    createSentryConnection(input: $input) {
      version
      sentryConnection {
        ...SentryConnectionFields
      }
    }
  }
`;

export const UPDATE_SENTRY_CONNECTION = /* GraphQL */ `
  ${SENTRY_CONNECTION_FIELDS}
  mutation UpdateSentryConnection($input: UpdateSentryConnectionInput!) {
    updateSentryConnection(input: $input) {
      version
      sentryConnection {
        ...SentryConnectionFields
      }
    }
  }
`;

export const DELETE_SENTRY_CONNECTION = /* GraphQL */ `
  mutation DeleteSentryConnection {
    deleteSentryConnection {
      version
      id
    }
  }
`;

export interface SentrySettingsQuery {
  readonly sentryWebhook: { readonly url: string; readonly secret: string } | null;
}

export async function loadSentrySettings(): Promise<SentrySettingsQuery> {
  return gql<SentrySettingsQuery>(SENTRY_SETTINGS_QUERY);
}

export async function enableSentryConnection(input: {
  defaultTeamId: string;
  organizationSlug?: string;
}): Promise<void> {
  await gql(CREATE_SENTRY_CONNECTION, { input });
}

export async function updateSentryConnection(input: {
  defaultTeamId?: string;
  organizationSlug?: string;
  enabled?: boolean;
  webhookSecret?: string;
}): Promise<void> {
  await gql(UPDATE_SENTRY_CONNECTION, { input });
}

export async function disconnectSentry(): Promise<void> {
  await gql(DELETE_SENTRY_CONNECTION);
}
