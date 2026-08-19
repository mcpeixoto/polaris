/**
 * Webhook writes. Plain `gql`, not `engine.mutate`: there is no replica entity, and the
 * create response carries a signing secret that must be shown now or lost.
 */

import type { UUID } from '~/store';
import { gql } from '~/sync/api';
import { CREATE_WEBHOOK, DELETE_WEBHOOK, UPDATE_WEBHOOK } from './operations';

export const WEBHOOK_RESOURCE_TYPES = [
  'Issue',
  'Comment',
  'IssueLabel',
  'Attachment',
  'Project',
  'Cycle',
] as const;

export type WebhookResourceType = (typeof WEBHOOK_RESOURCE_TYPES)[number];

export interface WebhookSummary {
  readonly id: UUID;
  readonly url: string;
  readonly enabled: boolean;
  readonly allPublicTeams: boolean;
  readonly teamId: UUID | null;
  readonly resourceTypes: readonly string[];
  readonly consecutiveFailures: number;
  readonly disabledAt: string | null;
  readonly createdAt: string;
}

export interface CreatedWebhook {
  readonly webhook: WebhookSummary;
  readonly secret: string;
}

export interface NewWebhook {
  readonly url: string;
  readonly allPublicTeams: boolean;
  readonly teamId?: UUID;
  readonly resourceTypes: readonly string[];
}

export async function createWebhook(input: NewWebhook): Promise<CreatedWebhook> {
  const data = await gql<{
    createWebhook: { created: { secret: string; webhook: WebhookSummary } };
  }>(CREATE_WEBHOOK, { input });
  return {
    webhook: data.createWebhook.created.webhook,
    secret: data.createWebhook.created.secret,
  };
}

export async function setWebhookEnabled(id: UUID, enabled: boolean): Promise<WebhookSummary> {
  const data = await gql<{ updateWebhook: { webhook: WebhookSummary } }>(UPDATE_WEBHOOK, {
    input: { id, enabled },
  });
  return data.updateWebhook.webhook;
}

export async function deleteWebhook(id: UUID): Promise<void> {
  await gql(DELETE_WEBHOOK, { id });
}
