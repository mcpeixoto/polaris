# Analytics: insights, dashboards, graphs

**Depends on:** issues, views, filters, estimates, cycles, projects.
**Depended on by:** planning rituals, exec reporting.

Four distinct analytical surfaces: **Insights** (on views), **Dashboards** (Enterprise), **Cycle graph**, **Project graph** / **Initiative graph**.

## Insights (Business/Enterprise)

A panel on nearly every issue view — `Cmd/Ctrl+Shift+I`. Present in custom views and in team, project, and cycle views. Most powerful on workspace-level custom views, where data crosses all teams.

### Model
`Measure` (y-axis) × `Slice` (x-axis) × optional `Segment` (colour).

| Measure | What it is | Chart | Implicit filter |
|---|---|---|---|
| Issue count | Number of issues | Bar | — |
| Effort | Total estimate value | Bar | — |
| Cycle time | Start → completion | Scatterplot | Only issues that spent time in progress before completing |
| Lead time | Creation → completion | Scatterplot | Only completed issues |
| Triage time | Time spent in Triage | Scatterplot | Only triaged issues |
| Issue age | Time since creation | Scatterplot | — |
| Burn-up | Cumulative flow over time | Area/line | Historical data, monthly by default, switchable to weekly |

Available slice/segment values depend on the issues in the view. Documented dimensions include assignee, delegate/agent, label, project, project label, team, priority, milestone (segmentable by status type), SLA status, template, and status type.

### Filters that matter for insights
`Created at`, `Completed at`, `Status type` (works across teams with differently-named statuses), and Label/Project/Team for narrowing. Insight options additionally offer filtering out unprioritised issues.

**Show archived issues — deliberately not offered here.** Linear has it; this clone does not, and the reason is architectural rather than an omission. Archiving an issue emits a *delete* to every connected replica and archived issues are never in the bootstrap snapshot (`Service.ArchiveIssue`, and `02-issues.md`: "deliberately loaded on demand rather than kept in the client cache"). Insights are computed live over the replica, so there is no archived row for the option to widen to, on any view — a checkbox there can only ever be inert. Fetching the archive per team and merging it in does not rescue it either: `archivedIssues` returns the issue rows without their label or customer-request edges, so every slice but assignee, priority, team and status type would file archived work under "No label" / "No customer". Analysis over archived work belongs to a surface that queries the server, not to a panel over the local replica. Archived work stays reachable through the team's archives page.

### Interactions
- **Bar**: hover for values and percentile breakdowns; click a bar or segment to temporarily filter the view; hovering highlights the corresponding table rows.
- **Scatterplot**: percentile markers at 25/50/75/95%; click a marker to zoom the y-axis; hover a point for issue details; click a point to open the issue.
- **Table beneath the graph**: hover a row/cell to highlight the graph; click a row, column, or cell to temporarily filter the issue view.
- **Full screen** view; **share** via link (workspace-visible) or **export to CSV**.
- An in-app **Insights examples** help centre offers one-click application of common analyses.

Questions Linear positions Insights to answer: which projects consume the most resource, how fast bugs get fixed, how consistently issues are prioritised, whether estimates are accurate, where bottlenecks and blocking dependencies are.

## Dashboards (Enterprise)

A page combining insights.

- Create from the **Dashboards tab** on the workspace or a team's Views page, or from an existing insight's context menu → *Add to dashboard*. One insight can live on many dashboards.
- Each tile renders as a **chart, table, or metric block** (same formats as Insights) and is independently filterable and clickable-through to the underlying issues.
- **Dashboard-level filters** apply globally to every tile; they can be visually hidden ("saved filters") without being disabled. **Insight-level filters** refine a single tile. An existing insight added to a dashboard **inherits** the dashboard filters, so it may look different than in its original view.
- Ownership transferable; **Move to…** team, workspace, or **Personal** (personal dashboards appear under their own heading on the workspace Views page and are visible only to you).
- **Refresh data** action in the context menu.
- **Private teams**: workspace-level dashboards exclude private-team data. To include it, create the dashboard inside that private team or move it to personal.

## Cycle graph

See `05-cycles.md`. Scope/target/started/completed lines, cycle success percentage, historical snapshot semantics.

## Project graph and initiative graph

See `06-projects.md` and `07-initiatives.md`. Scope vs started vs completed, velocity-based prediction with optimistic/pessimistic band, assignee/label breakdowns; initiative graph plots per-project completion rates.

## Data out

For analysis outside the product:

| Path | Detail |
|---|---|
| **CSV exports** | Workspace-wide (admin/owner), member list, any issue view, project/initiative lists, customer requests. See `18-import-export.md` |
| **Google Sheets** | Hourly sync of issues, projects, initiatives from public teams |
| **Airbyte** (Enterprise) | ETL into warehouses/lakes; ~22 models; ≥12h cadence; full-refresh/append only |
| **GraphQL API** | Arbitrary queries with filtering + pagination |
| **Webhooks** | Event stream for building your own store |
| **Audit log** | Security events, 90 days, streamable to SIEM |

## Notes for a clone

- Insights are computed **live over the current view's filter set**, not over a pre-aggregated warehouse. Design the query layer for this — it is the single biggest analytics performance constraint.
- Effort/estimate semantics must be shared between the graph, capacity, insights, and progress percentage code paths, including "unestimated counts as 1" and the T-shirt→Fibonacci mapping. That includes the *unit*: a team whose scale is `none` contributes 1 per issue, so its effort total is an issue count and is labelled `issues`, matching the cycle graph and the capacity dial. Insights is the only one of the three that can span teams, and a selection mixing a team that estimates with one that does not has no common unit — it is labelled `effort`, because naming it after either ladder would be a claim about the other.
- Cycle graphs and completed-cycle statistics are **snapshots**; project graph stats refresh hourly. Decide snapshot-vs-live per surface deliberately.
- **[OPEN]** Insights on Salesforce case properties are explicitly unsupported in Linear; decide whether to match that limitation or exceed it.
