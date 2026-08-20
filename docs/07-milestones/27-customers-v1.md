# Customers + customer requests v1 (13.1, 13.2)

**Status:** shipped on main  
**Migration:** `000045_customers`  
**Client schema:** 25

Workspace customers with unique domains, and requests that attach feedback to an issue and/or a project.

## Scope

- Customer CRUD for members (guests see nothing, including the live stream)
- Domain uniqueness per workspace (`acme.com` cannot be claimed twice)
- Customer requests with an importance flag, attached to an issue, a project, or both
- `/customers`, `/customer/:id`, `G` then `Q`
- Issue Customers section and `Ctrl+R` (mac) / `Ctrl+Alt+R` (Windows)
- Project overview Customers section
- Command menu: create customer, create customer request

## Deferred

- Workspace toggle / default feedback team / revenue tiers as settings
- Merge customers, Slack channel link, Intercom/Zendesk/Front/Salesforce
- Customer filter grammar and Insights slices
- Export CSV, page subscriptions, Ask/Gong automatic attribution
