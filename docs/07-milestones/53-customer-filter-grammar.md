# Customer filter grammar

**Status:** shipped on this branch
**Migration:** none (`customer` / `customer_request` already exist; do not take 000077)
**Client schema:** 53, unchanged — no new replica columns

Issue views, search, and saved views can filter by the customers attributed onto an issue,
the way Linear does: name, count, status, tier, revenue, size, and whether any request is
marked important. Order by customer count is the display option that pairs with it.

## Scope

- Grammar fields: `customer`, `customerCount`, `customerStatus`, `customerTier`,
  `customerRevenue`, `customerSize`, `customerImportant`.
- Both evaluators: `web/src/filter` against the replica, `internal/filter` to SQL.
- Filter bar: a Customers group. Guests never see it, and a customer clause matches
  nothing for them — including `customerCount eq 0`, which would otherwise return the
  whole workspace from an empty replica.
- Display: order by customer count.

## Deferred

- Insights slices by customer / tier / revenue
- Project-view customer filters (the grammar is issue-scoped today)
- Passkeys, leave workspace, avatar file upload
