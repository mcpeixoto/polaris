# Code review in Linear (Reviews / Diffs)

**Depends on:** GitHub integration with **code access**, personal GitHub account connections.
**Plan:** the Reviews surface follows the GitHub integration; **Guides** are Business/Enterprise (free during beta).

Adds a **Reviews** section to the sidebar so pull requests are read, discussed, approved, and merged without leaving Linear. Everything syncs bidirectionally with GitHub.

## Setup

**Organisation:** a Linear owner/admin configures the GitHub integration and grants **code access** for the selected repositories. Existing PR links and history are preserved; code access only adds the permission needed to render diffs and file contents.

**GitHub IP allow lists:** because review actions are performed on behalf of the authenticated GitHub user, org IP allow lists apply even with the Linear app installed. Add Linear's egress IPs (GitHub → Org Settings → Security → IP allow list):

```
35.231.147.226  35.243.134.228  35.196.141.51
34.140.253.14   34.38.87.206    34.62.119.29
34.134.222.122  35.222.25.142   34.60.255.158
```

**Personal:** each user connects their own GitHub account (required for per-user PR/repo/review data), and turns on Settings → Code & reviews → **Enable code reviews**. No diffs showing usually means code access wasn't granted for that repo.

Navigation: `G`+`R` for the Reviews section, `O`+`R` to open a specific review.

## The Reviews list

Two tabs: **For me** (PRs you're involved in or responsible for) and **Created** (everything you authored).

- Group by status, author, or repository; sort and filter; hide draft and closed PRs.
- Optional fields: repository, failed checks, preview links.
- **GitHub team reviewers**: display options control whether team-level review requests appear and whether they count toward the Reviews badge — noise control for large review groups. Team review requests are only delivered for GitHub teams with **≤10 members**.

## Reviewing a pull request

- All PR activity in one place: comments, reviews, discussions, CI checks, changed files, diffs.
- **Line counts** show *implementation* changes by default, excluding things like tests and docs. When that differs from total changed lines a `[*]` indicator appears; hover for the full total.
- Inline comments render alongside the code; start threads, reply, react.
- Complete a review from Linear — approve, request changes, or comment — and it syncs to GitHub.
- **Merge** from Linear when the PR is ready and you have permission.
- Open any GitHub PR in Linear by swapping the host: `github.com/owner/repo/pull/123` → `linear.review/owner/repo/pull/123`.

## Guides (Business/Enterprise beta)

AI-structured walkthrough of large PRs. Groups related changes into sections, surfaces the core implementation first and relegates supporting/low-signal changes, and pairs each section with an explanation of **why** it exists plus links into the relevant diff. Lives in a dedicated **Guide** tab next to the diff view. Disable with *Generate Pull Request guides* in the GitHub integration's Pull Requests section.

## Diff view options

- **Unified** vs **Split** (side-by-side); toggle with `Cmd/Ctrl+B`. Split may be unavailable on narrow screens.
- **Structural highlighting**: off = standard line-based diff; on = syntax-aware highlighting of the specific parts of a line that changed (renamed variables, edited expressions, moved blocks).
- **Code theme & font**: separate light/dark syntax themes, font family, size, weight, line height — shared with code blocks elsewhere.

## Notifications (Settings → Code & reviews)

| Setting | Controls |
|---|---|
| Comments & reviews | Comments, mentions, submitted reviews. Choose all activity or exclude bot actors |
| Review requests | Requests for your personal review |
| Team review requests | Requests via your GitHub teams (≤10-member teams only) |
| Checks & merge queue | Failed checks and merge-queue updates |

Coarse presets also exist: All activity / All activity by people / Reviews and comments / Reviews and comments by people / none.

## Related account preferences (Settings → Account → Code & reviews)

- **Auto-convert draft pull requests** — mark a draft PR ready when a review is requested or it's approved.
- **Configure coding tools** — which external tools can open Linear issues (Claude Code, Codex, Cursor, …), prompt templates, default terminal app.
- **Git attachment format** — Title, or Title + Repository.
- **On git branch copy, move issue to started status** — hold `Option` to skip for one action.
- **On open in coding tool, move issue to started status** — same escape hatch.

Pair with Preferences → *Auto-assign to self* and *On move to started status, assign to yourself* for a fully hands-off "start work" flow.

## Preview links

PRs containing preview URLs add a preview-link shortcut to the Linear issue. Auto-detected for Vercel, Netlify, Cloudflare, and AWS Amplify; custom links are parsed from PR descriptions and comments when the markdown link text ends with "preview". Multiple previews appear in a dropdown with auto-chosen icons (e.g. a mobile icon for a mobile link). Removed after **30 days** of PR inactivity.

## Documented limitations (decide whether to inherit them)

- **No per-commit review** — review is submitted at PR level; you can comment on lines but not organise the review commit-by-commit.
- Some GitHub inline comments can't be displayed or created from Linear because of GitHub API constraints.
- No rich check annotations (inline CI failure locations, detailed external tool output) — only overall check status and basic details.
- **Draft reviews don't sync** — a review started but not submitted in GitHub isn't mirrored.
- A missed webhook can leave a PR showing a stale state; the documented workaround is editing the PR description in GitHub to force a resync.
- `@mentions` from Linear only notify GitHub users whose accounts are mapped — i.e. who have connected GitHub in Linear.
