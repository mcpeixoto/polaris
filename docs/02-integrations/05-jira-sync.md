# Jira sync

Designed for teams **not ready to fully switch** — pilots and gradual transitions. Pair with the Jira importer for historical data (see `01-features/18-import-export-migration.md`).

**Critical ordering rule:** imported issues only become *synced* issues if the Jira integration is configured **before** the import runs. Space↔team mappings do not have to exist beforehand.

## Permissions

The user creating the API token must hold the Jira **ADMINISTER** permission so Linear can install the required webhooks. The permission can be removed afterwards without breaking the integration.

- **Jira Cloud**: API key (default expiry is one week — choose a year).
- **Jira Server**: personal access token (same expiry advice).

**Manual webhook alternative** for organisations that won't store ADMINISTER credentials in Linear: the Linear admin (needs BROWSE PROJECTS) chooses *Manual Webhook* in Linear's Jira settings, generates the webhook URL and instructions, hands them to a Jira ADMINISTER holder who creates the webhook in Jira, and receives the webhook secret back (via a password manager) to paste into Linear.

**Per-user OAuth consent** (needed to reply in synced threads): `User → View → me` twice — once to capture each user's Jira Account ID for mapping, once to create issues and comments on their behalf. It does **not** grant read access to issues/comments the user didn't create. Jira Server users paste their own PAT instead.

## Configuration

Workspace Settings → Integrations → Jira: personal access token, email, and the installation/cloud hostname (strip `http://` and anything after `.net`). Then map **Jira spaces → Linear teams**.

- A Jira space maps to exactly **one** Linear team.
- Multiple Jira spaces may map to the **same** Linear team.
- **Sub-teams are ignored** by the mapping: issues created in a bidirectionally synced parent team sync to Jira; issues created in its sub-teams do not. Sub-teams can be mapped to their own spaces independently.
- Users should connect personal Jira accounts (Settings → Integrations → Jira → Connect accounts) for correct assignee/creator handling.

## What syncs

**Issues**

| Linear | Jira |
|---|---|
| Title | Title |
| Description | Description |
| Assignee* | Assignee* |
| Creator* | Creator/Reporter* |
| Priority | Priority |
| Status** | Status** |
| Labels*** | Labels*** |
| Due date | Due date |

**Epics ↔ Projects** — Jira epics automatically sync as Linear **projects**, preserving parent-child relationships:

| Linear | Jira |
|---|---|
| Project title / status / labels / priority / description | Epic title / status / labels / priority / description |
| Project lead* | Epic assignee* |

\* Requires the relevant user to have connected their Jira account; otherwise assignee is empty and creator becomes whoever configured the integration.
\** Deleting a synced issue on either side does not delete or affect status on the other. If a Jira issue moves to a status with no Linear equivalent, the Linear status simply doesn't update until it moves to a mappable status or is changed in Linear.
\*** Jira → Linear label sync requires the label to **already exist in Linear** (from an import, manual creation, or the API). Linear → Jira creates labels in Jira as needed.

## Sync direction

Per mapping: **unidirectional** (Jira → Linear only; Linear changes don't propagate) or **bidirectional** (creation in either service creates a synced copy; updates flow both ways). Sync banners on issues/projects show current status or surface errors.

## Scope control

By default every issue created in a mapped space syncs. To narrow it, edit the webhook in Jira: Settings → System → Advanced → Webhooks → the Linear webhook → Edit, and set a **JQL filter** on *Issue related events* (e.g. only `labels = Bug`). This applies both at creation time and when an issue is later updated to match.

JQL filters applied during **import** do **not** carry over to sync.

## Pre-existing content

Sync is forward-looking: issues that existed before the mapping don't create Linear issues — but **when an old Jira issue is updated, it is then created and synced**. Moving a Jira issue from an unsynced space into a synced space creates a Linear issue. Moving a Linear issue between teams does *not* create a Jira issue — only direct creation in the synced team does.

## Structural limitations (product philosophy differences)

| Jira concept | Behaviour |
|---|---|
| **Required fields** | If a Jira workflow demands them, Linear will **not create** the synced issue. If the Linear issue already existed, the sync error is posted as a comment on the Linear issue |
| **Issue type** | Native required field in Jira. Issues created in Linear become type `Task` if that type exists, otherwise the first type in the list. If yours becomes `Story`, create a `Task` type |
| **Constraints** | Jira constraints can block updates — the Linear issue updates, the Jira issue doesn't |
| **Components** | Appear as Linear labels (`Component: Engineering`). Cannot be grouped or deleted. Removing the label removes the component in Jira |
| **Hierarchy** | Linear (Project > Issue > Sub-issue) and Jira (Epic > Story/Bug/Task > Sub-task) differ; removing a parent relationship in Linear that violates Jira's hierarchy causes sync failures or discrepancies |
| **Custom fields** | Not supported |
| **Epics previously imported/synced as issues** | Do **not** retroactively become projects — only newly created epics do |

## Operational notes

- **Routing synced issues into Triage**: a documented workaround — rename your first Started-category status to something other than "To do"; when the integration can't determine the right status at creation it falls back to **Triage**.
- **Metadata drift**: changing metadata in a synced Jira space can desync issues. Clicking refresh on the synced-spaces list in Linear updates available spaces and metadata, but only fixes things going forward.
- **Diagnosing permission errors**: Jira's permissions helper, checked against the user shown as *Enabled by* in Linear's Jira settings, with permission `Create issues`.
- Imports from other services never create synced Jira copies — the one exception is importing from a Jira project that is itself set up as synced.

## Jira terminology mapping

Publish this for migrating users (full table in `00-overview/04-glossary.md`): Epic→Project, Story→Issue, Sub-task→Sub-issue, Sprint→Cycle, Kanban→Board layout, Swimlane→Rows, Burndown→Burn-up, Scrum→the Linear Method, Jira Project→Linear Team.

---

## Appendix: the GUS pattern (custom enterprise sync)

Linear publishes a full architecture for syncing Salesforce's internal **GUS** system to Linear. It is the best available template for *any* bespoke enterprise two-way sync, and is worth copying as a reference implementation:

- **Tiered migration**: Tier 1 = move entirely to Linear; Tier 2 = bidirectional sync where legacy infrastructure still consumes the old system; Tier 3 = stays external, surfaced in Linear only as external links.
- **Entity mapping**: Portfolio→Workspace, Program→Initiative, Project→metadata/external links on the Initiative, **Epic→Project**, Work Item→Issue, Task→*don't sync* (recreate as sub-issues), Sprint→Cycle, Team→Team, Product Tag→Label, Team Dependency→Issue Relation, Release→Project Milestone.
- **Status mapping**: map the source's status **categories** to Linear state *types* first, then match by name inside the type, with normalised string comparison (lowercase, strip non-letters) — far more resilient than exact name matching.
- **Mapping table**: one table of `(entity_type, external_id, linear_id, linear_entity, last_synced_at)`, mirroring Linear's own `ExternalEntityRelation` pattern.
- **Reconciliation**: hourly, in dependency order Teams → Cycles → Projects → Issues → Relations; last-writer-wins on `updatedAt` vs the source's modified date; source-only fields (IDs, URLs, hierarchy links) always flow one way.
- **Loop prevention**: a `disableSyncBack` flag plus a recency guard on `last_synced_at` (Linear's own `disableSyncToSourceOnSave` pattern).
- **Rate limiting**: batches of 50, exponential backoff on 429, cache statuses/labels/users for the duration of a batch.
- **Error handling matrix**: rate limit → backoff; user not found → warn and skip assignment; team not found → fail that entity and alert; duplicate → reuse mapping; source API down → retry, alert after 15 min; unmatched status → fall back to Backlog/Triage and log; bad webhook signature → reject and raise a security alert.
- **Monitoring**: sync job failure, sync lag >2h, unmapped entity count, >80% of the complexity budget, webhook 5xx rate. Audit log of every sync operation retained ≥90 days.
