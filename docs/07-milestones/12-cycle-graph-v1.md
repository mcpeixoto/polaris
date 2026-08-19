# Cycle graph v1

**Goal:** a live burn-up on the cycle detail page — scope and completed cumulative lines plus cycle success — computed from the replica. Inventory 4.5 scoped down.

Target dotted line, started-over-time series, historical snapshots and capacity dial stay later slices.

---

## What stays true

**No new backend entities.** The graph reads issues, workflow states and cycle dates already on the stream.

**Live, not snapshotted.** Completed uses `completedAt`; scope steps up as issues are created during the window. A completed cycle's list may drift from the chart — that is expected until snapshots land.

**Estimate semantics.** With estimates disabled every issue counts as 1; otherwise unestimated issues count as 1 point.

**Cycle Success** matches Linear: completed at full weight, started at 25%.

---

## Done criterion

> Open an active cycle with a mix of done and open issues — the graph shows scope and completed lines plus a success percentage. Completing another issue moves the blue line without a reload.
