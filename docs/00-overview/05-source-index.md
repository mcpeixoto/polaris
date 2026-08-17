# Source index

Every page crawled on **2026-08-14**, for traceability. If Linear changes a page, re-crawl it and update the feature doc that cites it.

## linear.app/docs — 138 pages

- `/docs/account-preferences`
- `/docs/agents-api-deprecated`
- `/docs/agents-in-linear`
- `/docs/ai-at-linear`
- `/docs/ai-credits`
- `/docs/airbyte`
- `/docs/api-and-webhooks`
- `/docs/assigning-issues`
- `/docs/audit-log`
- `/docs/beta-project-planning`
- `/docs/billing-and-plans`
- `/docs/board-layout`
- `/docs/changes-to-linears-pricing-plans`
- `/docs/changes-to-user-roles-when-upgrading-to-enterprise`
- `/docs/code-and-reviews`
- `/docs/code-intelligence`
- `/docs/coding-sessions`
- `/docs/comment-on-issues`
- `/docs/conceptual-model`
- `/docs/configuring-workflows`
- `/docs/connect-mcp-servers`
- `/docs/creating-issues`
- `/docs/custom-views`
- `/docs/customer-requests`
- `/docs/cycle-graph`
- `/docs/dashboards`
- `/docs/default-team-pages`
- `/docs/delete-archive-issues`
- `/docs/diffs`
- `/docs/discord`
- `/docs/display-options`
- `/docs/documents`
- `/docs/due-dates`
- `/docs/editing-issues`
- `/docs/editor`
- `/docs/estimates`
- `/docs/exporting-data`
- `/docs/favorites`
- `/docs/figma`
- `/docs/filters`
- `/docs/front`
- `/docs/get-the-app`
- `/docs/github`
- `/docs/github-enterprise-cloud-beta`
- `/docs/github-integration`
- `/docs/github-to-linear`
- `/docs/gitlab`
- `/docs/gong`
- `/docs/google-sheets`
- `/docs/gus-integration`
- `/docs/how-to-use-linear`
- `/docs/how-to-use-linear-large-scaling-companies`
- `/docs/how-to-use-linear-small-teams`
- `/docs/how-to-use-linear-startups-mid-size-companies`
- `/docs/import-issues`
- `/docs/inbox`
- `/docs/initiative-and-project-updates`
- `/docs/initiatives`
- `/docs/insights`
- `/docs/integration-directory`
- `/docs/intercom`
- `/docs/invite-members`
- `/docs/issue-relations`
- `/docs/issue-templates`
- `/docs/jira`
- `/docs/jira-terminology-translated`
- `/docs/jira-to-linear`
- `/docs/joining-your-team-on-linear`
- `/docs/label-views`
- `/docs/labels`
- `/docs/linear-agent`
- `/docs/linear-asks`
- `/docs/linear-asks-email`
- `/docs/linear-asks-slack`
- `/docs/linear-asks-web-forms`
- `/docs/linear-for-growth`
- `/docs/linear-for-product-managers`
- `/docs/login-methods`
- `/docs/loops`
- `/docs/making-the-most-of-linear`
- `/docs/making-the-most-of-linear-business`
- `/docs/mcp`
- `/docs/members-roles`
- `/docs/microsoft-teams`
- `/docs/my-issues`
- `/docs/notifications`
- `/docs/notion`
- `/docs/open-issues-with-custom-scripts`
- `/docs/ops-and-marketing`
- `/docs/parent-and-sub-issues`
- `/docs/peek`
- `/docs/priority`
- `/docs/private-issue-sharing`
- `/docs/private-teams`
- `/docs/profile`
- `/docs/project-dependencies`
- `/docs/project-graph`
- `/docs/project-labels`
- `/docs/project-milestones`
- `/docs/project-notifications`
- `/docs/project-overview`
- `/docs/project-priority`
- `/docs/project-status`
- `/docs/project-templates`
- `/docs/projects`
- `/docs/pulse`
- `/docs/releases`
- `/docs/report-performance-issues`
- `/docs/salesforce`
- `/docs/saml-and-access-control`
- `/docs/scim`
- `/docs/search`
- `/docs/security`
- `/docs/security-and-access`
- `/docs/select-issues`
- `/docs/sentry`
- `/docs/sla`
- `/docs/slack`
- `/docs/start-guide`
- `/docs/sub-initiatives`
- `/docs/sub-teams`
- `/docs/team-issue-limit`
- `/docs/team-owner`
- `/docs/teams`
- `/docs/terms-update-summary-june-2026`
- `/docs/third-party-application-approvals`
- `/docs/timeline`
- `/docs/triage`
- `/docs/triage-intelligence`
- `/docs/triage-manage-unplanned-work`
- `/docs/update-cycles`
- `/docs/use-cycles`
- `/docs/user-views`
- `/docs/view-demos`
- `/docs/workspace-owner`
- `/docs/workspaces`
- `/docs/zapier`
- `/docs/zendesk`

## linear.app/developers — 11 pages read

- `/developers/graphql`
- `/developers/pagination`
- `/developers/filtering`
- `/developers/rate-limiting`
- `/developers/webhooks`
- `/developers/oauth-2-0-authentication`
- `/developers/agents`
- `/developers/attachments`
- `/developers/managing-customers`
- `/developers/advanced-usage`
- `/developers/sdk`

Remaining developer pages not read in full (agent-interaction, agent-signals, agent-best-practices, aig, oauth-actor-authorization, oauth-app-manifests, oauth-app-manifests, deprecations, file-storage-authentication, how-to-upload-a-file-to-linear, create-issues-using-linear-new, integration-directory, migrating-from-1-x-to-2-x, sdk-errors, sdk-fetching-and-modifying-data, sdk-webhooks) — worth reading before implementing the agent platform and file storage in detail.

## Method

1. `curl https://linear.app/sitemap.xml` → extracted all `/docs/` URLs (138) and `/developers/` URLs (28).
2. Fetched each page, stripped scripts/styles/tags, cut nav and footer chrome.
3. Read every extracted page in full; wrote the docs in this repo from those readings.

No Linear source code, assets, or trademarks were copied. Prose here is original; behaviour described is factual.
