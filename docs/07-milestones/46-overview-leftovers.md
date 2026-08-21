# Initiative and customer overview leftovers

**Status:** shipped on this branch
**Migration:** none
**Client schema:** unchanged

Create already wrote an initiative and a customer. The overview pages only edited a
description (initiatives) or added requests (customers). Status, owner, priority, lead
team, target date, domains, tier, revenue, size, logo, and archive were already on
`updateInitiative` / `updateCustomer` / `archiveInitiative` / `archiveCustomer`.

## Scope

- Initiative overview: name, status, priority, owner, lead team, target date, archive
- Customer page: name, domains, status, owner, tier, revenue, size, logo URL, archive
- Writes land on blur / change, same as Profile settings — no Save button
- Archive is a delete on the replica and returns to the list

## Deferred

- Initiative updates, health roll-up, labels, sub-initiatives
- Initiative / customer archives pages (restore is API-only)
- Merge customers, revenue-tier settings, workspace enable toggles
- Customer filter grammar
