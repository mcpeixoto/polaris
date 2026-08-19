# Project timeline v1 (7.5)

**Goal:** projects-only timeline layout on `/projects` and team projects — Display → Timeline, zoom, dependency lines, milestones on bars. No backend changes; dates and dependencies already live in the replica.

Drag-to-create dependencies and cycle overlay stay later slices.

---

## What ships

- **Display menu** on the projects list: List | Timeline
- **Timeline grid:** fixed project labels, horizontally scrollable date canvas
- **Bars** from `startDate` / `targetDate` (single-day bar when only one is set)
- **Unscheduled** section for projects with no dates
- **Zoom:** week / month / quarter / year (URL `zoom` param)
- **Dependencies:** blue satisfied / red violated SVG curves (same rules as `dependencyHelpers`)
- **Milestones:** ticks on bars when `targetDate` is set (toggle in Display)

Display options persist in the URL (`layout`, `zoom`, `deps`, `milestones`).

---

## Done criterion

> Open `/projects`, Display → Timeline. Projects with start/target dates appear as bars; a blocking→blocked link draws a line; a violated link is red. Toggle zoom — the grid rescales. A project with no dates appears under Unscheduled. Reload — layout and zoom survive in the URL.

---

## Deferred

- Initiative / team grouping swimlanes
- Cycle overlay
- Drag bars to move dates
- Drag from bar end to create dependencies
- Timeline inside initiative detail
