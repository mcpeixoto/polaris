/**
 * Slack writes. Connection settings are replicated, so the settings screen reads them
 * from the store; these mutations are the write path. The webhook URL is not replicated
 * and is fetched as a configured/not flag with SlackInbound.
 */

import { gql } from '~/sync/api';

export const SLACK_CONNECTION_FIELDS = /* GraphQL */ `
  fragment SlackConnectionFields on SlackConnection {
    id
    workspaceId
    creatorId
    enabled
    defaultTeamId
    channelName
    notifyIssues
    notifyComments
    connectedAt
    createdAt
    updatedAt
  }
`;

export const SLACK_INBOUND_QUERY = /* GraphQL */ `
  query SlackInbound {
    slackInbound {
      commandUrl
      eventsUrl
      webhookConfigured
      signingSecretConfigured
      botTokenConfigured
    }
  }
`;

export const CREATE_SLACK_CONNECTION = /* GraphQL */ `
  ${SLACK_CONNECTION_FIELDS}
  mutation CreateSlackConnection($input: CreateSlackConnectionInput!) {
    createSlackConnection(input: $input) {
      version
      slackConnection {
        ...SlackConnectionFields
      }
    }
  }
`;

export const UPDATE_SLACK_CONNECTION = /* GraphQL */ `
  ${SLACK_CONNECTION_FIELDS}
  mutation UpdateSlackConnection($input: UpdateSlackConnectionInput!) {
    updateSlackConnection(input: $input) {
      version
      slackConnection {
        ...SlackConnectionFields
      }
    }
  }
`;

export const DELETE_SLACK_CONNECTION = /* GraphQL */ `
  mutation DeleteSlackConnection {
    deleteSlackConnection {
      version
      id
    }
  }
`;

export interface SlackInboundQuery {
  readonly slackInbound: {
    readonly commandUrl: string;
    readonly eventsUrl: string;
    readonly webhookConfigured: boolean;
    readonly signingSecretConfigured: boolean;
    readonly botTokenConfigured: boolean;
  } | null;
}

export async function loadSlackInbound(): Promise<SlackInboundQuery> {
  return gql<SlackInboundQuery>(SLACK_INBOUND_QUERY);
}

export async function enableSlackConnection(input: {
  defaultTeamId: string;
  channelName?: string;
  webhookUrl?: string;
  notifyIssues?: boolean;
  notifyComments?: boolean;
}): Promise<void> {
  await gql(CREATE_SLACK_CONNECTION, { input });
}

export async function updateSlackConnection(input: {
  defaultTeamId?: string;
  channelName?: string;
  webhookUrl?: string;
  notifyIssues?: boolean;
  notifyComments?: boolean;
  enabled?: boolean;
}): Promise<void> {
  await gql(UPDATE_SLACK_CONNECTION, { input });
}

export async function disconnectSlack(): Promise<void> {
  await gql(DELETE_SLACK_CONNECTION);
}
