# Support and CRM: Intercom, Zendesk, Front, Salesforce, Gong

These integrations share a shape: **create or link an issue from a customer conversation → show issue state inside the support tool → attach a customer request → re-open the conversation when the issue resolves.** Build the shape once.

Common contract:
1. Widget/sidebar in the support tool: create issue, link existing issue, view linked issues (ID, status, assignee), unlink.
2. A link **attachment** on the Linear issue pointing back to the conversation, filterable via `F` → Links → \<source\>.
3. Optional **customer request** created automatically, with the customer resolved by email domain.
4. Optional **internal note** posted into the conversation on create/complete/cancel/status-change/comment.
5. Optional **re-open** of the conversation when the issue completes or cancels.
6. Up to 10 **templates** exposed for consistent property capture.
7. Merging duplicates moves attachments + comments to the canonical issue and re-points the external conversation.
8. Triage: issues land in the team's Triage when enabled, otherwise the team's default (falling back to the first Backlog status).

---

## Intercom (Business/Enterprise)

- Enable in Settings → Features → Integrations → Intercom. A Linear app appears in Intercom's Conversation details sidebar (pin it via *Edit apps*).
- **Access model**: anyone in Intercom can create/link issues and see details in the sidebar; only Linear users can open them in Linear. If the creator is a Linear member the issue shows as created by them and appears in their *My Issues → Created*; otherwise it shows as created by Intercom.
- **Create with Linear Agent**: analyses the entire conversation — customer messages, support replies, metadata, attachments — identifies the underlying request or bug, and drafts title + description with the relevant context. Enable in Settings → Integrations → Intercom. Per-invocation optional instructions, plus admin-configured **persistent guidance** for routing to the right team/template.
- Linking a conversation automatically creates a **customer request** from the contact and company info.
- **Customer attributes**: Intercom is a supported *data source* for Linear customer attributes (Owner, Revenue, Size, Status, Tier), synced **in real time** (all other sources are 12-hourly).
- Re-open behaviour is separately configurable for completed issues, canceled issues, and new comments. Internal notes are posted on create/cancel/complete, optionally on every status change. Notes left in Intercom do **not** sync back to Linear.
- Uninstall/reinstall on the same workspace resumes syncing for existing links, but changes made while disconnected don't backfill and settings reset to defaults.
- Cannot create or link issues in **private teams**.

---

## Zendesk (Business/Enterprise)

Two-step install: (1) install Linear from the Zendesk Marketplace to add the sidebar widget; (2) enable Zendesk automation from Linear's Zendesk settings (requires Zendesk admin). Each agent must log into their Linear account from the widget — issues are created in their name, so **every agent needs a Linear account**.

- Create from the widget (title + team required; optional priority, assignee, labels; "include message" pulls ticket content and images into the description).
- **Create with Linear Agent**: same as Intercom, and it will create **multiple issues** if the conversation contains distinct problems. Creates a customer request where applicable and routes to the chosen team. Optional routing guidance.
- Up to 10 templates.
- Re-open on completed/canceled/comment; internal notes for comments and status changes.
- Link Zendesk tickets from Linear via issue ⋯ → Add link → Zendesk ticket.
- Cannot target private teams.
- **Domain changes are not supported**: after changing your Zendesk URL, previously linked tickets stop appearing in the widget; some note automations may still work.

---

## Front (Business/Enterprise)

Three ordered install steps: install/approve Linear in Front (adds the sidebar widget) → enable Front automation in Linear's Front settings → sign into Linear from the Front sidebar and pick the workspace. Front users need Linear accounts; the Front desktop app is recommended.

- Create issues with team, title, and optional description/priority/assignee/labels; link existing issues by ID or title.
- Link Front conversations from Linear (⋯ → Add link → Front conversation, or command menu).
- Automate re-opening plus an internal note when the issue completes, cancels, or receives a comment.
- Many-to-many linking supported.
- **Unlike Intercom/Zendesk, Front can create and link issues in private teams** if the user has access.
- Limitations: Front internal notes don't flow into Linear; templates are unsupported; conversations in **private inboxes** support neither automated comments nor re-opening.

---

## Salesforce (Enterprise add-on)

Sold separately — contact sales for licences, then assign them to Salesforce users. Only licensed users see the app.

**Install**: from Salesforce AgentExchange → find *Linear Development* in the App Launcher → Login with Linear → select workspace → confirm. Then in Linear: Settings → Integrations → Salesforce → Enable → paste any Salesforce page URL. Finally, edit a Case detail page layout and drop the Linear component where you want it.

**Permission sets** (three, in Salesforce):
| Set | Capability |
|---|---|
| Linear Admin | Full access and configuration |
| Linear Create Issues | Create and/or link issues and projects |
| Linear Link Only | Link existing issues only — for large support teams that want to limit new-issue noise |

**Settings**
- **Restrict issue visibility** — only issues created from or previously linked to Salesforce are searchable from the component.
- **Internal notes** on completion/cancellation, added to the case's *All updates*.
- **Automatic case reopening** to a chosen case status (statuses refresh when Salesforce ones change).
- **Templates** — all issue creation is template-driven; expose templates with `+`.

**Customer attribute mapping**: map Salesforce account fields to Linear's Owner (string/email), Tier (string), Status (string), Revenue (number), Size (number). Lookup fields need a Salesforce **formula field** to expose the underlying value (e.g. account owner → email). With "reduced personal information" enabled in Linear, additional customer info isn't fetched, so issues may show an unknown customer.

**Usage**: from a case, *Create issue* (template → title → description, with an "include case description" toggle that becomes the customer request) or *Link issue or project*. From Linear, attach a case URL with `Ctrl+L`.

**Sync**: linked issue status and priority are always current in Salesforce. If the Salesforce user is also a Linear user they show as creator; otherwise the creator displays as the Salesforce developer account name plus the acting user's email.

**Extras**: triage rules can use **Salesforce case properties** as conditions (routing team/status/assignee/label/project/priority); Linear data inside Salesforce is queryable with **SOQL** for custom dashboards; Linear views can filter by *Salesforce case properties* — but these are **not supported in Insights or Dashboards**.

Duplicate handling: when a linked issue is closed as a duplicate, the case re-opens (the issue was canceled). Cases are never merged; relink to the canonical issue manually.

---

## Gong (Enterprise)

Fully automatic — no per-user seats, no manual action.

- Linear periodically checks new Gong recordings and processes qualifying calls: **customer-facing only**, internal/private calls and recordings **under 10 minutes** are skipped.
- Filters out non-actionable content: sales questions, beta-access requests, general enquiries, internal commentary.
- Each actionable finding becomes an issue containing a concise summary, the customer's motivation, transcript excerpts **with speaker attribution**, and a link to the exact **timestamp** in the recording. A single call can produce multiple issues.
- Issues land in the configured team's **Triage**.
- Setup: Settings → Integrations → Gong → enable → enable recording intake → select the receiving team. Optional routing guidance (examples, team mentions, internal rules for the agent) and a toggle to **mention call participants** in created issues.
- With Customer Requests enabled, Gong creates customers just-in-time on first request, reusing an existing matching customer.
