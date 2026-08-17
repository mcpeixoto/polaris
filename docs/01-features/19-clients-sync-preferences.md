# Clients, real-time sync, preferences

**Depends on:** nothing.
**Depended on by:** the entire perceived quality of the product. This is the hardest thing to copy.

## Real-time sync and offline

- All changes sync in real time to every client. Mutations made via the API are observed live by all clients.
- If the backend can't be reached, changes are **stored locally and retried** when connectivity returns. Changes survive an app restart before reconnection.
- The workspace name in the sidebar shows **"Syncing N"** when the queue is large or slow.
- Offline mode is explicitly a **failsafe, not a feature**: Linear does *not* compare change creation dates before applying, so heavy offline editing can overwrite a teammate's changes (description or status).
- Archived issues are deliberately **not** kept in the client cache — the archives page loads on demand and is noticeably slower.

**[INFERRED]** Architecture implications for a clone: a local object store per client, an operation log with server reconciliation, server-authoritative IDs with client-side optimistic IDs, and a delta-sync protocol keyed on `updatedAt`. Linear's public API exposes `updatedAt` ordering and cursor pagination, which is consistent with that shape.

## Desktop app

- macOS Intel, macOS Apple Silicon, Windows. Downloaded from `linear.app/download`.
- Benefits Linear lists: native OS notifications (necessary for Safari users, since Safari lacks Push API support), always-on with dock/taskbar unread badge, fewer keyboard-shortcut conflicts, in-app tabs.
- **Localhost probing**: the web app checks ports `44450`, `18450`, `33234` to detect a running desktop app so links can hand off. Chromium browsers may need *Local network access* allowed for `linear.app`, otherwise "Couldn't open in desktop app".
- **Deep link**: `linear://linear.app/issue/ENG-123`.
- **Auto-update** in the background. Disable on macOS with
  `defaults write /Users/$USER/Library/Preferences/com.linear AutoUpdateDisabled -bool YES` (relaunch required), or ship a `com.linear.plist` via MDM with `AutoUpdateDisabled`.
- Brave users must disable Shields for `linear.app` to allow the desktop handoff; and allow cross-site cookies for authenticated Figma embeds.
- Terminal-based coding tools require the desktop app; on macOS the default terminal for `.command` files can be changed via Finder → Get Info → Open with → Change All, `duti -s com.googlecode.iterm2 .command all`, or `defaults write com.apple.LaunchServices/...`.

## Mobile

Tabs: **Home** (My issues, favorites, teams → issues/cycles/triage), **Inbox** (read, snooze, delete, comment, update issues), **Create** (with camera-roll media and rich formatting incl. code blocks and quotes), **Search**, **Settings** (switch workspace, notification schedule, theme, feedback).

## Account preferences (Settings → Account → Preferences)

**General**
- **Default home view** — the view opened on launch/login; any default or favorited view (and, by default, a new Linear Agent chat).
- Display full names vs usernames.
- First day of the week (calendars).
- Convert text emoticons into emojis.
- Comment submit key: `Cmd/Ctrl+Enter` or `Enter`.

**Interface and theme**
- Font size, pointer cursor on interactive elements, underlined links.
- Light/dark presets, custom themes, or follow system. (Community theme gallery at `linear.style`.)

**Desktop application**
- Open Linear URLs in the desktop app.
- Notification badges on the app icon.
- Spell check.

**Automations and workflows**
- **Auto-assign to self** on issues you create.
- **On move to started status, assign to yourself.**
- (Git-related behaviours live in Code & reviews: branch attachment format, move-to-started on branch copy, move-to-started on open-in-coding-tool.)

Linear explicitly does *not* offer a default assignee for all new issues — the documented workarounds are templates, triage responsibility, and triage rules.

## Profile (Settings → Account → Profile)

Avatar (initials by default), name and username, email address, connected accounts, leave workspace.

**Email change flow:** the address is the account identity across every workspace. Changing it sends confirmation to **both** old and new addresses and requires clicking both. To change it in only one workspace, invite the new address as a new user and leave from the old one. Org-wide domain changes go through support.

## Connected accounts

Per-user links to third-party services so activity attributes correctly: **Slack** (personal notifications, being mentioned in synced comments), **GitHub** (assignee sync, PR reviews, coding sessions, diffs), **Google Calendar** (out-of-office status shown in Linear so colleagues know you're unavailable for assignment), **Jira**, **Microsoft**, **Figma**, **Intercom/Zendesk/Front agents** (via their own apps).

## Open in coding tools

- Enable one or more tools in Settings → Code & reviews (Cursor, Claude Code, Codex, …), optionally with a **custom prompt template** carrying standing instructions ("always give me a plan before writing code").
- Open from an issue via the **Work on issue** menu (`W` then `O`), the button, or `Cmd+Option+.` / `Ctrl+Alt+.`.
- Custom tools: a **custom link** with query params, or a **local script**.

### Custom scripts
Enable *Custom script* in Configure coding tools; define commands in `~/.linear/coding-tools.json` (a starter file is generated on first use). Schema:

```json
{
  "openIssue": {
    "path": "/absolute/path/to/executable",
    "args": ["--issue", "{{issue.identifier}}", "--branch", "{{issue.branchName}}", "{{prompt}}"],
    "env": ["LINEAR_PROMPT", "LINEAR_WORK_DIR", "LINEAR_PROJECT_NAME"]
  }
}
```

Template variables: `prompt`, `issue.identifier`, `issue.branchName`, `project.name`, `pullRequestComment.id`, `workDir`, `tool.command`.
Environment variables: `LINEAR_PROMPT`, `LINEAR_ISSUE_IDENTIFIER`, `LINEAR_ISSUE_BRANCH_NAME`, `LINEAR_WORK_DIR`, `LINEAR_PROJECT_NAME` (only when the issue is in a project), `LINEAR_PULL_REQUEST_COMMENT_ID` (only when triggered from a PR comment), `LINEAR_TOOL_COMMAND`.

## Performance as a feature

Linear runs a formal **performance issue report** flow — a written description, a screen recording, a Chrome DevTools performance profile (Screenshots off, Memory on, `.json` download), and explicit consent for the team to access obfuscated workspace data. A clone that wants Linear's reputation needs the same posture: performance regressions are bugs with a triage path, not tuning work.

## Keyboard shortcut reference (from the docs)

Navigation: `?` help · `Cmd+/` shortcut list · `/` search · `Cmd/Ctrl+F` find in view · `Cmd/Ctrl+K` command menu · `G`+`I` inbox · `G`+`M` my issues · `G`+`A` active · `G`+`B` backlog · `G`+`T` triage · `G`+`X` archive · `G`+`R` reviews · `G`+`Q` customers · `G`+`S` settings · `O`+`I` issue picker · `O`+`P` project · `O`+`U` user · `O`+`T` team · `O`+`L` label · `O`+`V` view · `O`+`D` documents · `O`+`F` favorites · `O`+`Q` customer · `O`+`R` review · `O`+`W` switch workspace.

Issue actions: `C` create · `V` full-screen create · `Alt+C` create from template · `E` edit · `A` assign · `I` assign to me · `S` status · `P` priority · `L` label · `Shift+E` estimate · `Shift+D` due date · `Shift+M` milestone · `Shift+P` project · `Cmd+Shift+P` parent · `Cmd/Ctrl+Shift+M` move team · `Cmd/Ctrl+Shift+O` sub-issue · `M`+`R`/`B`/`X` relations · `MM` mark duplicate · `Shift+S` subscribe · `Cmd/Ctrl+Shift+S` manage subscribers · `Cmd/Ctrl+Delete` delete · `#` restore · `Ctrl+L` add link · `Ctrl+R` (mac) / `Ctrl+Alt+R` customer request · `Cmd/Ctrl+Shift+.` copy git branch name · `W`+`O` work on issue.

View actions: `F` filter · `Shift+V` display options · `Cmd/Ctrl+B` list/board · `Cmd/Ctrl+I` sidebar · `X` select · `Shift+X` multi-select · `Cmd/Ctrl+A` select all · `T` collapse group/swimlane · `Space` peek · `Option/Alt+V` save view · `Alt+F` favorite · `H` snooze/remind · `1`/`2`/`3` triage accept/duplicate/decline · `J`/`K` navigate · `Esc` clear.

Editor: `Cmd/Ctrl+B/I/U/E` · `Cmd/Ctrl+Shift+S` strikethrough · `Cmd/Ctrl+Shift+7/8/9` lists · `Cmd/Ctrl+Shift+\` code block · `Cmd/Ctrl+K` link · `Cmd+Opt+M` inline comment · `Cmd+Shift+U` upload · `Cmd+Opt+C` copy as markdown · `Cmd/Ctrl+J` agent.
