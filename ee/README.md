# Enterprise edition

Commercially licensed features. Everything here is excluded from the AGPL core — see
[`LICENSE`](LICENSE) and [`../docs/06-product-model/01-licensing-and-distribution.md`](../docs/06-product-model/01-licensing-and-distribution.md).

## What belongs here

Only these, and the list is deliberately short:

- SAML SSO and SCIM provisioning
- The audit log and its SIEM streaming
- Dashboards
- Advanced Asks (private channels, web forms, multi-workspace)
- Third-party application approvals
- The workspace Owner role and workspace restrictions

## What does NOT belong here

Private teams, guests, the API, SLAs, triage rules and basic Insights are **core**.

Gating a security boundary is user-hostile: a team that cannot make a channel private
without a purchase order will keep sensitive work in the tool that lets them, and the
product loses the use case rather than winning the upsell. The paid pitch is "you don't
want to run this yourself", plus the compliance surface above — not "your data isn't safe
on the free tier".

## How the separation is enforced

Not by a runtime flag. Go files here carry `//go:build ee` and TypeScript is resolved
through a Vite alias, so the community build does not *contain* this code — it is absent
from the binary and the bundle rather than present and disabled. A licence check that can
be flipped by editing a boolean is not a licence check.
