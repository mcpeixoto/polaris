# Milestone 2 — Projects v1

**Goal:** work can be grouped by outcome, not only by team. A project is a named unit with
a lead, a status, and the issues that belong to it — and filing into one is as fast as
filing into a team.

This is the first slice of M2, not the whole of `docs/01-features/06-projects.md`. Overview
tabs, the project graph, updates and health, dependencies, the timeline, project templates,
attached views and converting an issue into a project stay out until a later freeze. Taking
any of those into this slice means this slice does not ship.

Written after M1 shipped. The visual bar is part of done: M1's web UI was judged horrible
on first real use, and nothing in this milestone is allowed to look like a form builder
again. See the web tokens and shared components, not a one-off Projects skin.

---

## What M1 taught, and what changes because of it

**Sets are rows.** Labels taught this and projects repeat it without argument. Teams on a
project and members of a project are `project_team` and `project_member` rows with their
own ids on the change stream. A set written as a whole still loses concurrent adds.

**gqlgen still rewrites `schema.resolvers.go`.** Project converters and hydrators live in
`convert_m2.go`. A helper in the resolver file is a build break waiting for the next
`make gqlgen`.

**The replica is still the read path.** The Projects screen, the picker and the issue's
project chip all read IndexedDB. GraphQL is mutations plus bootstrap. Client schema is 4
because five new entity types cannot be added to a v3 database in place.

**Status is never a rollup.** Completing every issue in a project does not move it. There
is no trigger that would, and the schema test asserts that. Health and progress remain
later slices; inventing them here as a derived status would paint a lie onto the first
thing people look at.

---

## Schema decisions closed here

### An issue belongs to at most one project, as a column

`issue.project_id`, not a join table. Two projects on one issue is a state the schema
cannot represent, which is the only way the product rule stays true when the writer is an
importer. The documented workaround for shared work is sub-issues in different projects,
and it is documented rather than encoded because encoding it would be a second project
column.

### A milestone implies its project

`issue.project_milestone_id` is nullable and, when set, must name a milestone of the same
project the issue is in. Enforced in the domain, not as a clever CHECK across two FKs:
Postgres cannot say "this uuid's parent equals that column" without a trigger, and a
trigger that the application also has to know about is two definitions.

### Workspace project statuses, seeded, always manual

Five rows per workspace (Backlog, Planned, In Progress, Completed, Canceled), categories
fixed, names and colours editable later. `started` is the identifier; the UI says In
Progress. Same vocabulary as issue workflow, so a later rollup branches once.

A project created without a status lands on the default. Completing work never writes
`project.status_id`.

### Bootstrap order puts project types before issues

An issue may name a project and a milestone. Streaming issues first would mean a replica
that briefly holds foreign keys it cannot resolve, and the first paint of a project view
would be an empty list that fills in a frame later. `ENTITY_TYPES` and the server's
bootstrap order are the same list.

---

## What ships

| Surface | What it is |
|---|---|
| `/projects`, `/team/:teamKey/projects` | Dense list: mark, name, summary, status, lead, issue count. Empty state creates. |
| `/project/:id` | The issue list, sourced by project. Not a second virtualiser. |
| `Shift+P` | Project picker on the list and the detail, ranked (lead → member → created by you → overlapping teams → active → recent → completed). |
| `C` from a project | Files into that project. Clearing the picker opts out. |
| `G P` | Workspace projects. Command menu also offers **Create project**. |
| `C` | Still create issue, everywhere, including the projects list. |

Properties on v1: name, summary, colour (from the status default), status, priority,
lead, teams, members. Timeframe, icon, description-as-doc, labels, health, resources and
the overview tab are later.

Milestones exist in the schema and the API so an issue can name one without a second
migration. There is no milestone UI in this slice.

---

## Deliberately still out

Project graph, updates, health, staleness, dependencies, timeline, project templates,
attached views, convert-issue-to-project, convert-milestone-to-project, initiatives,
customer-request tabs, Cmd+I project details sidebar.

Cycles, documents, GitHub, and everything else M1 already named as later.

---

## Traps specific to this slice

| Trap | Why it bites |
|---|---|
| Whole-set writes for teams or members | Same failure as labels. Two concurrent adds, one lost. |
| Deriving status from issue completion | Looks helpful, then a cancelled issue or a scope cut silently "completes" a launch. |
| A second issue list for projects | Shortcuts get fixed in one copy. `/project/:id` is `IssueList` with a different source. |
| Binding `C` to create project on `/projects` | Global `C` is create issue. Create project is command-menu (and the button). |
| Copying Linear assets or copy | Craft and density, not their logo. `NOTICE` still holds. |
| Literal colours in CSS | `scripts/lint-tokens.sh`. Project marks use the *data* colour from the row. |

---

## Acceptance tests

The M0 fifteen and the M1 ten still have to pass. These are additional.

**Correctness**
1. Two clients add different teams to one project at the same moment → both survive.
   (`TestAddProjectTeam_ConcurrentAddsOfDifferentTeamsBothSurvive`)
2. An issue belongs to one project; moving it replaces, it does not accumulate.
   (`TestIssue_OneProjectAtATime`)
3. A milestone from another project is rejected.
   (`TestIssue_MilestoneImpliesProject`)
4. Completing the last issue does not change project status.
   (`TestUpdateIssue_CompletingWorkDoesNotMoveProjectStatus`)
5. Name and at least one team are required.
   (`TestCreateProject_NameAndTeamAreRequired`)

**Schema**
6. `issue.project_id` is a column, not a join table. (`schema_invariants_test.go`)
7. Every project model field exists on its GraphQL type. (`schema_drift_test.go`)
8. Every new entity carries `workspace_id` and appears on the change stream with a scope.
   (`change_scope_test.go`, `bootstrap_scope_test.go`)

**Contract**
9. Create, update, team and member mutations are reachable over the public API.
10. Client schema 4: a v3 replica is dropped and bootstrapped, not migrated in place.

---

## Done criterion

> Somebody can name a project, file issues into it with `C`, move existing work with
> `Shift+P`, and find it again from `G P` — without opening a second tracker to remember
> what the launch was for.
