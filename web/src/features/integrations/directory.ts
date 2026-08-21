/**
 * First-party integrations as a directory, not as a second settings tree.
 *
 * Linear's directory is how you find Slack, GitHub, and the rest in one place. Polaris
 * already has per-integration screens; this file is the index: what ships, what is
 * connected on this replica, and what is still a documented gap. Status is derived from
 * the replica rather than stored, so a GitHub install appearing on another device is
 * enough to flip the badge.
 */

import type { Store } from '~/store';

export type IntegrationStatus = 'connected' | 'available' | 'coming';

export interface DirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly summary: string;
  /** Settings screen when this clone ships the integration. Absent means not built yet. */
  readonly href?: string;
}

export const DIRECTORY: readonly DirectoryEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'Source control',
    summary: 'Link PRs and commits, post linkbacks, run per-team automations.',
    href: '/settings/github',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'Source control',
    summary: 'Link merge requests and commits, including self-hosted instances.',
    href: '/settings/gitlab',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'Monitoring',
    summary: 'Create or link a Polaris issue from a Sentry alert webhook.',
    href: '/settings/sentry',
  },
  {
    id: 'asks',
    name: 'Asks',
    category: 'Intake',
    summary: 'Shareable forms and Slack 🎫 / `/asks` that file a triage issue.',
    href: '/settings/asks',
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    category: 'Platform',
    summary: 'Signed outbound events for Issue, Comment, and the rest of the public set.',
    href: '/settings/webhooks',
  },
  {
    id: 'oauth',
    name: 'OAuth apps',
    category: 'Platform',
    summary: 'Workspace applications that act with OAuth 2.0, including actor=app.',
    href: '/settings/oauth-apps',
  },
  {
    id: 'mcp',
    name: 'MCP',
    category: 'AI',
    summary: 'Streamable HTTP MCP so an external agent can read and write this workspace.',
    href: '/settings/mcp',
  },
  {
    id: 'api-keys',
    name: 'API keys',
    category: 'Platform',
    summary: 'Personal bearer keys with scopes. Same credential MCP and scripts use.',
    href: '/settings/api-keys',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Chat',
    summary: 'Notify a channel, slash-create issues, unfurl links, and post magic-word linkbacks.',
    href: '/settings/slack',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'Chat',
    summary: '@Linear agent and project channel connection.',
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'Chat',
    summary: '/linear issue, search, wrap, and message linking.',
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'Support',
    summary: 'Create and link issues from conversations, with customer attributes.',
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'Support',
    summary: 'Create and link issues from tickets.',
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'Design',
    summary: 'Embedded previews and a plugin to create issues from frames.',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'Docs',
    summary: 'Embed issues, projects, initiatives, and views in Notion pages.',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    category: 'Automation',
    summary: 'No-code actions and triggers over the public GraphQL API.',
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'Sync',
    summary: 'Two-way space ↔ team sync plus the importer.',
  },
];

export function directoryStatus(store: Store, entry: DirectoryEntry): IntegrationStatus {
  if (entry.href === undefined) return 'coming';
  if (entry.id === 'github') return store.githubConnections.size > 0 ? 'connected' : 'available';
  if (entry.id === 'gitlab') return store.gitlabConnections.size > 0 ? 'connected' : 'available';
  if (entry.id === 'sentry') return store.sentryConnections.size > 0 ? 'connected' : 'available';
  if (entry.id === 'slack') return store.slackConnections.size > 0 ? 'connected' : 'available';
  if (entry.id === 'asks') return store.askForms.size > 0 ? 'connected' : 'available';
  return 'available';
}

export const STATUS_LABEL: Readonly<Record<IntegrationStatus, string>> = {
  connected: 'Connected',
  available: 'Available',
  coming: 'Not yet',
};
