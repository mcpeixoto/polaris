/**
 * Webhook documents. Not replicated — same reason as API keys — so these queries are the
 * only read path, and they must never select `secret`.
 */

export const WEBHOOK_SUMMARY = /* GraphQL */ `
  fragment WebhookSummary on Webhook {
    id
    url
    enabled
    allPublicTeams
    teamId
    resourceTypes
    consecutiveFailures
    disabledAt
    createdAt
  }
`;

export const WEBHOOKS_QUERY = /* GraphQL */ `
  ${WEBHOOK_SUMMARY}
  query Webhooks {
    webhooks {
      ...WebhookSummary
    }
  }
`;

export const WEBHOOK_DELIVERIES_QUERY = /* GraphQL */ `
  query WebhookDeliveries($webhookId: UUID!) {
    webhookDeliveries(webhookId: $webhookId, first: 20) {
      id
      attempt
      lastStatus
      lastError
      deliveredAt
      createdAt
      entityType
    }
  }
`;

export const CREATE_WEBHOOK = /* GraphQL */ `
  ${WEBHOOK_SUMMARY}
  mutation CreateWebhook($input: CreateWebhookInput!) {
    createWebhook(input: $input) {
      version
      created {
        secret
        webhook {
          ...WebhookSummary
        }
      }
    }
  }
`;

export const UPDATE_WEBHOOK = /* GraphQL */ `
  ${WEBHOOK_SUMMARY}
  mutation UpdateWebhook($input: UpdateWebhookInput!) {
    updateWebhook(input: $input) {
      version
      webhook {
        ...WebhookSummary
      }
    }
  }
`;

export const DELETE_WEBHOOK = /* GraphQL */ `
  mutation DeleteWebhook($id: UUID!) {
    deleteWebhook(id: $id) {
      version
      id
    }
  }
`;
