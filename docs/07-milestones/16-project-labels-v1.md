# Project labels v1

**Goal:** workspace-scoped project labels with optional groups (mutually exclusive within a group), shown on project properties and as list columns on `/projects` — spec 5.8 / `01-features/06-projects.md` Labels row.

---

## What stays true

**Separate from issue labels.** `project_label` and `project_label_link` are their own tables. Issue label pickers and project label pickers never mix.

**Workspace scope only.** No team column — every project label is offered on every project the member can edit.

**One row per application.** `addProjectLabel` upserts one link; `removeProjectLabel` deletes one. Two people labelling the same project differently both survive.

**One label per group.** Enforced by `project_label_link_one_per_group`; the picker swaps rather than refuses.

**Client schema is 14** because a v13 replica has no stores for `projectLabel` / `projectLabelLink`.

---

## Schema

Migration `000035`: `project_label`, `project_label_link`, parent integrity and group denormalisation triggers.

---

## UI

- **Settings → Project labels** — create, rename, recolour, group, archive
- **Project shell sidebar** — label picker (`L`), chips on the property row
- **`/projects` list** — label chips column per row

---

## Done criterion

> In settings, create a group "Team" with labels Platform and Growth. Open a project, press `L`, apply Platform — chip appears on the sidebar and on `/projects`. Apply Growth — Platform is replaced. Reload — both survive. Archive a label still in use — refused with a count.
