# Customer request settings + merge (13.1 leftovers)

**Status:** shipped on this branch
**Migration:** `000070_customer_request_settings`
**Client schema:** 49

Workspace Settings → Customer requests, and merge from a customer page.

## Scope

- Admin toggle. Off hides the sidebar, `G Q` / `O Q`, and create commands; writes that
  create or edit customers and requests are refused. Archive and delete still work so an
  admin can clean up.
- Default public team for issues created from a customer page (stored now; the create
  dialog on that page still picks a team until it is wired).
- Revenue unit label (shown next to the revenue field) and a named tier list. `customer.tier`
  stays a string matching one of those names.
- Merge: domains and requests move onto the survivor, empty attributes fill in, the source
  is archived.

## Deferred

- Customer attribute sync from Intercom / Zendesk / Front / Salesforce
- Slack channel link on a customer
- Excluded domains, CSV export, page subscriptions
- Template sub-issues / Aa placeholders (shipped in 49)
