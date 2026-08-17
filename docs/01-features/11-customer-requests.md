# Customer requests

**Depends on:** issues, projects, attachments, integrations (Intercom/Zendesk/Front/Salesforce/Slack/Asks/Gong), API.
**Depended on by:** views and insights that slice by customer, triage rules, product prioritisation flows.

Brings the voice of the customer into the tracker: link user feedback to issues and projects, attribute it to customer organisations, and prioritise by aggregate demand.

## Enabling and configuration

Admin toggle in **Workspace Settings → Customer requests**. Once on, everyone in the workspace (except guests) can view customer pages, create/update customers, and add requests.

Configuration options:
- **Default team** for issues created from a customer page (Linear recommends a team used exclusively for feedback).
- **Revenue units and tiers** for your plans/products.
- **Customer attributes data source**: Intercom, Zendesk, Front, or *None* (API/manual control). Once a source is set, company name and domain sync automatically; `Owner`, `Revenue`, `Size`, `Status`, `Tier` can be **mapped** to source-tool fields and are kept in sync. Unmapped attributes can optionally be made manually editable; the API can always write them regardless.
- **Excluded domains and emails** — prevent specific domains from creating customers (e.g. your own company). Common consumer providers are auto-excluded (Linear ships a list of ~65: gmail.com, outlook.com, icloud.com, proton.me, qq.com, yandex.ru, temp-mail services, etc.).
- Sync cadence: **Intercom is real-time**; all other sources sync every **12 hours**.

## Customers

A `Customer` represents an external organisation: unique domain(s), name, logo, and attributes (revenue, size, tier, status, owner).

- **Customer pages** show every issue and project carrying a request from that customer, groupable and orderable; click through to see the request in full. Attributes render on the page. Pages are favoritable.
- Navigation: `O` then `Q` (open a customer), `G` then `Q` (full customer list), or `Cmd/Ctrl+K`.
- **Creation**: automatic from integrations (domain-matched from the reporter's email) or manual (`Cmd+K` → "Create new customer").
- **Merge** duplicates from the customer page dropdown → *Merge with*. Linear prevents most duplicates via the domain uniqueness constraint.
- **Link to a Slack channel** (⋯ → Link to Slack channel) so every Ask raised in a shared channel attributes to that customer automatically — the recommended fix for Slack Connect privacy variability.

## Requests

A `CustomerNeed` attaches feedback to an issue or a project, and optionally to a customer.

- Created automatically whenever an issue/project is created from or linked to a supported integration; the request quotes the original message, links back to the source, and records the reporter and timestamp. Editable afterwards to add images/video/context.
- Manual creation: from the Customers section of an issue, the button on a customer page, or `Ctrl+R` (macOS) / `Ctrl+Alt+R` (Windows). On projects, `Ctrl+R` or the *+ Customer Request* button — the first request adds a dedicated Customer requests tab.
- **Mark as important** — a binary per-request flag rendered as a triangle, letting customer-facing teams separate critical needs from nice-to-haves. Different customers can flag the same issue differently.
- Attribution rules: for **Asks**, the customer follows the email of the person who sent the *first* message in the thread, not the Ask creator. Slack users with Linear accounts can pick a customer manually; users without accounts never see the customer list, but automatic domain matching still applies.

## Integration coverage

| Source | Behaviour |
|---|---|
| **Intercom** | Requests on create/link; customer attributes (size, revenue, …) sync from Intercom in real time |
| **Zendesk / Front** | Requests on create/link from conversations |
| **Salesforce** | Requests when creating from a case or linking a case; account attributes mappable |
| **Asks** | Every Ask creates a request tying feedback + customer to the issue |
| **Slack** | Optional Customer field during issue creation, prefilled by domain; channel-level default via customer→channel link |
| **Gong** | Creates customers just-in-time when the first request from a call arrives; reuses an existing matching customer |
| **API** | `customerCreate`, `customerUpsert`, `customerNeedCreate` (see `03-platform/01-graphql-api.md`) |

Plan gating (Linear's own table): manual and Slack on all plans; Asks on Business+; Intercom/Zendesk/Front on Business+; Salesforce Service Cloud on Enterprise.

## Views, insights, notifications

- Customer data feeds the filter grammar: customer name, **customer count**, customer status, tier, revenue, size — on both issue and project views. Canonical example: "issues with requests from Enterprise-tier customers with ≥20 requests, ordered by customer count", with importance triangles surfacing urgency. Recommended input to cycle planning.
- Inbox notifications fire automatically when a request is added to an issue you subscribe to. Additional notification styles are configurable.
- **View subscriptions** are the recommended targeted alerting mechanism (e.g. "issues raised by churned customers, ordered by revenue" → bell, or Slack channel).
- Customer page subscription: notify when a request is added, marked important, completed, or cancelled.

## Export

`Cmd/Ctrl+K` → **Export customer requests as CSV** — scoped to a customer, an issue, or a project. Appears when requests exist.

## Access control

- Admins and Members see customer requests in Linear and in Slack dropdowns (Asks and the Slack integration).
- **Guests see nothing** related to customer requests, including views that use customer filters.
- Slack users without Linear accounts never see the customer list; matching still happens by domain.
- Support-tool integrations each have a toggle to stop them creating customers/requests.

## API notes

Available operations: create/edit/delete customers, requests, tiers, and statuses; query and filter customers; query/filter requests by issue, project, priority, and customer. Bulk import (e.g. rETL from a warehouse) is explicitly awkward today — GraphQL isn't optimised for it and there is no REST API. **[OPEN]** for a clone: ship a bulk-import endpoint for customers from day one.
