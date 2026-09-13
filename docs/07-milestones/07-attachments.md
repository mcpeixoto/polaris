# Attachments v1 (URL-idempotent links)

**Goal:** an issue can carry link cards, the same URL on the same issue is one card, and
those cards survive restore, duplicate-merge and a reload.

File upload for paste/drop images is a separate path (`internal/files`, `POST /files/upload`,
`GET /files/{id}`). Uploaded images may create a link card whose URL is the absolute
capability URL, and may also be inserted as markdown `![…](/files/…?token=…)` in
descriptions and comments. Webhooks stay a separate slice.

The visual bar is part of done. Links sit on the issue as a dense list, not a settings form.

---

## What stays true

**gqlgen still rewrites `schema.resolvers.go`.** Helpers stay in `domain/attachment.go`.

**The replica is the read path.** Attachments are `OpUpsert` / `OpDelete` on the change
stream. Client schema is 8 because a v7 replica has no object store for them.

**URL idempotency is load-bearing.** `UNIQUE (issue_id, url)` plus scheme/host normalisation
is the contract integrations rely on. `attachmentsForURL` is the lookup.

**A closed issue in an open project still never archives on its own.** Attachments do not
change that.

---

## Schema

`attachment`: issue, team, url, title, subtitle, icon_url, metadata jsonb, creator.
Hard delete. Cascade with the issue.

Duplicate merge moves unique URLs onto the canonical issue and drops a URL it already has.

---

## Done criterion

> Pasting `https://github.com/acme/app/pull/12` twice on ENG-4 yields one card. The same
> URL on ENG-5 is a second card. `attachmentsForURL` returns both. Marking ENG-5 a
> duplicate of ENG-4 leaves one card on ENG-4.
