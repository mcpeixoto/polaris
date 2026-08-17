# Source control: GitHub, GitHub Enterprise, GitLab

The most load-bearing integration in the product. It drives status automation, the Reviews surface, Code Intelligence, and coding sessions.

---

## GitHub

Two core capabilities: **link PRs/commits** and **sync GitHub Issues**. Code access additionally unlocks Diffs/Reviews, Code Intelligence, and coding sessions.

### Permissions requested
- **Read**: checks, commit statuses, deployments, members, merge queues, metadata.
- **Read + write**: actions, code, issues, pull requests, workflows.
- Org-level access requires a GitHub **organization owner** to install; repo-level can be installed by a repo admin.
- Two apps exist — the Linear application and **Linear Code** (codebase access). Both are needed for full functionality.

### Setup
Settings → Features → Integrations → GitHub → Enable → choose org → All repositories or selected repositories → Install → authenticate your personal GitHub account.

**Multiple GitHub organisations** are supported for PR automation only (commit linking works with a single org). One GitHub org can be connected to only **one** Linear workspace — a GitHub App limitation.

**Personal connection** (Settings → Connected accounts) is required per user so activity, synced comments, and assignees attribute correctly.

**Commit linking** requires an extra manual webhook: enable *Link commits to issues with magic words*, then add a webhook in GitHub (org or repo) with the provided payload URL + secret, content type `application/json`, Push events.

### GitHub Enterprise (Enterprise plan)

| Feature | GitHub.com | GHE Cloud (`*.ghe.com`) | GHE Server (self-hosted) |
|---|---|---|---|
| Installation | Linear GitHub App | Linear GitHub App | **Separate GHES app** |
| IP requirements | none | IP allow-list config if enabled | none |
| Multiple GitHub orgs | ✔ | ✔ | ✖ |
| PR linking | ✔ | ✔ | ✔ |
| Branch name formatting | ✔ | ✔ | ✔ |
| Status automation from PRs | ✔ | ✔ | ✔ |
| Magic words | ✔ | ✔ | **PR description only** |
| Commit linking | ✔ | ✔ | ✖ |
| GitHub Issues sync | ✔ | ✔ | ✖ |
| Multi-repo → single team sync | ✔ | ✔ | ✖ |

GHEC setup: Settings → Integrations → GitHub Enterprise Cloud → Enable → enter the `.ghe` domain → one org per install (repeat for more) → users add personal connections. Orgs with IP allow lists must enable *Enable IP allow list configuration for installed GitHub Apps*, or allow Linear's IPs directly.

GHES setup gotchas: you must save the provided **webhook secret** during app creation (without it Linear can't verify requests), and you must install the created app onto the orgs/repos you want linked. Missing step 1 requires a full disconnect/reinstall.

### Linking issues to PRs

Three mechanisms:
1. **Branch name** contains the issue ID — use *Copy git branch name* (`Cmd/Ctrl+Shift+.`). Branch format is configurable in integration settings.
2. **Issue ID in the PR title** (`ENG-123`).
3. **Magic word + issue ID** in the PR title or description, including full issue URLs. If the issue is unassigned at link time, the linker becomes the assignee.

**Magic words**

| Class | Words | Effect |
|---|---|---|
| Closing | close, closes, closed, closing, fix, fixes, fixed, fixing, resolve, resolves, resolved, resolving, complete, completes, completed, completing, implement, implements, implemented, implementing, `linear issue` | Moves through the workflow and applies the *On PR or commit merge* status on merge |
| Non-closing | ref, refs, references, part of, contributes to, toward, towards | Moves through other statuses but never applies the merge status |
| Relation | relates to, related to | Marks related; no status changes |
| Suppress | skip, ignore | Prevents auto-linking — the documented fix when the branch name contains an ID you don't want linked |

**Create an issue from a PR**: put `{TEAM}-NEW` (e.g. `ENG-NEW`) in the PR description. The new issue is created in **Started** status and assigned to the PR author where possible. On Business/Enterprise, Linear uses AI to write the title and description and to set labels, project, and milestone from the PR content and the author's recent work; on other plans it just uses the PR title. Skipped if the PR already has a linked issue or an existing issue reference.

**Multi-linking**: several issue IDs after one magic word (`Fixes ENG-123, DES-5, and ENG-256`) — magic words in PR *comments* don't create links. Several PRs can link to one issue; the status only advances when the **final** linked PR reaches the required state.

**Commit linking**: magic word before an issue ID in a commit message → In Progress on push, Done when the commit reaches the default branch.

### Workflow automation (per team: Settings → Team → Workflows & automations)

Configurable status transitions for: PR **drafted**, **opened**, **review requested**, **ready for merge**, **merged**. Defaults: opened → In Progress, merged → Done.

- **Ready for merge** depends on GitHub reporting a stable/mergeable PR. Any failing check — *including non-required checks* — makes GitHub report unstable and the automation won't fire. It also won't fire unless a "review request or activity" automation is configured, and without branch protection rules a PR is always mergeable so the review-request state is skipped entirely.
- **Custom merge queues** that merge then close a PR: add the `externally-merged` label **before** closing so Linear treats it as merged.
- **Branch-specific rules** on the **target** branch (never the source): e.g. merged to `staging` → In QA; merged to `main` → Deployed. Regex supported (`^fea/.*`). A branch rule can be set to "no action" to override the default.

### GitHub Issues sync
See `01-features/18-import-export-migration.md`. Configure repo ↔ team pairs in the GitHub Issues section; one-way (many repos → one team) or two-way (one repo per team). Synced properties: title, description, status (open/closed only; GitHub Project custom statuses don't sync), assignee (needs linked accounts), labels, sub-issues (multi-level and cross-repo/team; if the parent isn't synced the child syncs parentless), comments (only those in the synced thread). Moving a synced issue between Linear teams preserves the relationship; transferring a GitHub issue between synced repos updates the Linear team. Stop syncing by removing the attachment. Banners on the issue show sync status or errors.

### Other behaviours
- **Linkbacks** — a comment on the PR/commit/issue with the Linear issue title, description, images and attachments; all linked PRs are listed on the issue. Private teams get link-only linkbacks. Disableable (also the fix for "I get a notification every time a PR opens").
- **PR review state** — reviewer avatars and their actions render on the GitHub attachment in Linear; team review requests show "review requested"/"in review" instead of avatars.
- **Preview links** — see `01-features/16-code-review-and-diffs.md`.
- **Autolink references** — configure GitHub autolinks so `ENG-123` in PRs resolves to `https://linear.app/<workspace>/issue/ENG-123`. Per-team prefix, needs reconfiguring if a team key changes.
- **Squash merges**: merging several already-merged PRs into a new branch does **not** re-detect the original issues; re-link explicitly.
- Failure recovery: disconnect on GitHub's side, reset the local DB at `linear.app/reset`, reconnect.

---

## GitLab

Supports hosted and self-hosted GitLab, provided the instance is **publicly reachable** (earliest supported version **15.6**).

### Setup
1. Settings → Features → Integrations → GitLab → Enable.
2. Create a GitLab **personal access token** or **project access token** with `api` (or `read_api`) scope. `read_api` disables linkbacks; project tokens need **Reporter** or higher.
   *GitLab has no bot accounts, so linkbacks are posted as the token owner — Linear recommends creating a dedicated user for Linear.*
3. Optional: set the custom URL for a self-hosted instance (no path), and allow-list Linear's IPs.
4. Connect → Linear generates a webhook URL → add it to a **Group** webhook (Premium/Ultimate, covers all projects) or a **Project** webhook.
5. Enable triggers: **Push events, Comments, Merge request events, Pipeline events**; keep SSL verification on.

### Linking merge requests
- Branch name containing the issue ID (`Copy git branch name`, format configurable in settings).
- Issue ID in the MR title.
- Magic word + ID in the **MR description** — comments and commit messages cannot link.
  Closing words: close/closes/closed/closing, fix/fixes/fixed/fixing, resolve/resolves/resolved/resolving, complete/completes/completed/completing, implement/implements/implemented/implementing.
  Non-closing: ref, references, part of, related to, contributes to, towards.
- Multi-link by listing IDs after a magic word; the issue doesn't close until **all** MRs are closed/merged.

### Automation
Per-team MR workflow settings mirroring GitHub's (drafted/opened/review requested/ready to merge/merged), plus:
- **Ready for merge** requires: Pipeline events enabled on the webhook, pipelines configured as *merge request pipelines*, and "Pipelines must succeed" checked in project settings. For approvals, MR approvals must be required. As with GitHub, a status must be configured for "MR review request or activity" or the ready-for-merge transition won't fire.
- `externally-merged` label for custom merge queues.
- Branch-specific target-branch rules with regex, including "no action" overrides.
- Auto-assign and move-to-started on branch copy (Preferences → Behavior).
- **Auto-linking**: GitLab can render Linear URLs for issue IDs — configured on GitLab's side.

### Limitations
- Only **one GitLab instance** per Linear workspace.
- No GitLab Issues import or sync — the documented path is a CSV export reshaped for the CLI importer.
- Token usage is exhaustively documented (supplemental MR info, linkbacks, rich attachments, mergeability status on pipeline completion) — reproduce this transparency.
