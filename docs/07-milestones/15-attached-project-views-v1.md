# Attached project views v1

**Goal:** saved, filtered views of a project's issues shown as reorderable tabs on the project shell — spec 5.12 / `01-features/06-projects.md` Attached views. Workspace Projects page portfolio views stay later.

---

## What stays true

**Project scope, not sidebar.** `view.project_id` set means the row is a tab on that project. Sidebar listings omit project-attached views; bootstrap and change scope use `ScopeProject`.

**Shared only.** Attached views cannot be private and cannot carry a `team_id` — the DB check enforces it.

**Corpus is the project's issues.** The saved filter runs over `byProject`, not a team index.

**Positions are per project.** Tab reorder uses `afterViewId` with fractional keys scoped to the project.

**Client schema is 13** because a v12 replica has no `projectId` on `View`.

---

## Schema

Migration `000034`: nullable `view.project_id` → `project(id)` ON DELETE CASCADE, index, scope check.

---

## UI

- Project shell tabs after **Issues** — dynamic view tabs, **+** to create, drag to reorder
- Right-click tab — copy link, favorite, rename, delete
- Route `/project/:id/view/:viewId` — same URL-is-state bargain as `/view/:id`

---

## Done criterion

> On a project, click **+** next to Issues, name a view "Bugs", land on the tab. Filter to a label, reload — filter persists in the URL. Drag the tab before Issues neighbor; order holds for another member. Copy link, open in another tab — same view. Delete the tab — gone for everyone after sync.
