# Initiative labels and sub-initiatives v1

**Goal:** workspace-scoped initiative labels with optional groups, plus parent→child
nests up to five levels — inventory 5.13 leftovers / `01-features/07-initiatives.md`.

---

## What stays true

**Separate from issue and project labels.** `initiative_label` and `initiative_label_link`
are their own tables. Pickers never mix.

**One label per group.** Enforced by `initiative_label_link_one_per_group`; the picker
swaps rather than refuses.

**Sub-initiatives are a DAG.** An initiative may have multiple parents. Depth and cycles
are domain checks (`MaxInitiativeNesting = 5`), not SQL. Self-links are a CHECK.

**The replica is the read path.** Client schema is **52** because a v51 replica has no
stores for `initiativeLabel` / `initiativeLabelLink` / `initiativeRelation`. Schema 50
was reserved and left unused when template sub-issues shipped as 51.

**Active Projects walks descendants.** `linkedProjectHealths` includes projects on nested
initiatives.

---

## Schema

Migration `000073`: `initiative_label`, `initiative_label_link`, `initiative_relation`.

Bootstrap order: `initiativeLabel` → `initiativeLabelLink` → `initiativeRelation`, after
`initiativeUpdate`.

---

## UI

- **Settings → Initiative labels** — create, rename, recolour, group, archive
- **Initiative overview** — label picker (`L`), chips on Properties; Sub-initiatives
  (create nested, nest existing, un-nest)
- **Create initiative** — optional parent
- **`/initiatives`** — nested indent, label chips

---

## Done criterion

> In settings, create a group "Team" with labels Platform and Growth. Open an initiative,
> press `L`, apply Platform — chip appears on Properties and on `/initiatives`. Apply
> Growth — Platform is replaced. Reload — both survive. Archive a label still in use —
> refused with a count. Create with a parent; Overview shows the child; `/initiatives`
> nests. A cycle and a sixth level are refused. Active Projects includes descendant
> projects.
