# SLAs v1 (3.22)

**Status:** shipped on main  
**Migration:** `000050_sla_rules`  
**Client schema:** 30

Workspace SLA rules that own an issue's due date. First matching rule wins. Durations are minutes; the due date is the calendar day they land on in the issue's team timezone.

## Scope

- Replica entity `slaRule` (workspace-scoped; guests excluded)
- Apply / remove actions; apply sets `dueDate` + `dueDateSource=sla`
- Re-evaluate on issue create (after labels), update, and label add/remove
- Do not reset the clock if `dueDateSource` is already `sla`
- Human due-date edits refused while an SLA owns the date
- Settings → SLAs; Set / Clear SLA on the due-date picker
- Entitlement: Business+ (`FeatureSLAs`). Free is refused; Pro, Enterprise, and self-hosted allow it

## Deferred

- Business-day calendar and `workspace.slaBusinessWeek`
- Hour-precision `slaBreachesAt`
- Notifications, Slack, Insights SLA slice, webhooks
