# Editor, documents, comments

**Depends on:** real-time sync, permissions.
**Depended on by:** issues, projects, initiatives, templates, agent guidance, Asks, updates.

## The editor

One rich-text editor powers issue descriptions, comments, documents, project/initiative descriptions, updates, templates, and agent guidance fields. Markdown in, rich text out — typed or pasted.

### Formatting
| Feature | Input |
|---|---|
| Bold / italic / strikethrough / underline / inline code | `**x**` `_x_` `~~x~~` · `Cmd/Ctrl+B / I (or >) / Shift+S / U / E` |
| Headings H1–H4 | `#`..`####` + space |
| Bulleted / numbered / checklist | `*`,`-`,`+` · `1.` · `[]` — or `Cmd/Ctrl+Shift+8 / 9 / 7` |
| Link | `Cmd/Ctrl+K`, or paste a URL onto selected text |
| Blockquote | `>` + space |
| Collapsible section | `>>>` + space, `/collapsible section`, or `+++ Title … +++` via API/markdown |
| Code block | `/code` or `Cmd/Ctrl+Shift+\` |
| Mermaid diagram | `/diagram`, or paste a ` ```mermaid ` block |
| Divider | `___` + space |
| Table | `\|--` or `/table` |
| Date | `/date` or `@Oct 1` |
| File attach | `/file`, `/insert`, `Cmd+Shift+U`, paperclip, or drag-and-drop |
| Emoji | native picker or `:name:` |
| Line break / escape block | `Shift+Enter` · `Enter Enter` |

### Slash menu
`/` opens: headings, lists, checklists, code blocks, dividers, blockquotes, tables, diagrams, collapsible sections, date, file insert.

### Mentions (`@`)
Mention users, issues, projects, documents, initiatives, dates. Mentioning a **user** notifies them and subscribes them. Pasting an issue ID or mentioning `@ENG-123` links it **and auto-creates a `related` relation**. In the API, mentions are expressed as plain resource URLs in the markdown, which render as mentions.

### Embeds
Auto-embeds for YouTube, Descript, Loom, and Figma (Figma requires the integration). "Keep as link" or `Esc` after pasting suppresses the embed. Figma previews are snapshots — they don't auto-refresh; a manual refresh button exists on the embed in edit mode.

### Attachments and images
Uploaded assets sit **behind authentication** — API consumers must authenticate to fetch them, and are advised to download and re-host if displaying externally.

### Useful commands
`Cmd/Ctrl+A` select all content · undo/redo · **Copy issue in Markdown** · **Copy as Markdown for LLMs** (`Cmd+Opt+C`, captures title, description, comments, and customer requests; works on multi-select).

## Documents

Long-form text attached to a **team, project, initiative, issue, or cycle**.

- Create with `+` in a project or team, an overflow menu, or the `Cmd/Ctrl+K` menu. Open a project's document list with `O` then `D`.
- **Collaborative real-time editing** with presence cursors; all changes synced live.
- **Version history** on every document *and* every project description — open from display options; restore earlier versions. Agent edits and loop-driven changes create their own checkpoints.
- **Show author names** — attribute text to the person (or loop) that wrote it. Toggle via `Cmd+K` or display options; requires enough window width.
- **AI editing**: `Cmd/Ctrl+J` to prompt the agent for an edit, or select text → "Add to chat". Agent-written text is highlighted separately for review, and the agent works within existing tables/formatting.
- **Templates**: document templates at workspace or team scope; selectable when creating a document in a project or issue.
- **Inline comments**: select text → comment button or `Cmd+Opt+M`. Reply, resolve (check icon), show resolved comments toggle. Also available on issue descriptions and project overviews.
- **Subscriptions**: bell icon; subscribing also covers the project overview description section. Creators auto-subscribe. Notifications for: comments/replies, material content changes, deletion, being subscribed/unsubscribed by someone, being mentioned.
- **References**: `@` a document from issues, comments, other documents, and **agent guidance fields** — where the agent will read the referenced doc before acting.
- **Header deep links**: hover the left of a header → Copy link.
- Team documents are the recommended home for runbooks, design-resource links, and meeting notes — things not tied to one project.

## Comments and reactions

- Anyone with issue access can comment and reply. `Cmd/Ctrl+Enter` (or `Enter`, configurable in Preferences) submits. Unsent comments persist and appear in **Drafts**.
- Attach files via paperclip, `Cmd/Ctrl+Shift+A`, or drag-and-drop.
- **Threads**: hover a comment → reply arrow. Threads are first-class, with their own subscription semantics — being @mentioned in a thread subscribes you to the *thread*, not the whole issue.
- **Resolve threads** from the root message's overflow menu, or from a specific reply to highlight that reply as the resolution. With *Enable resolved thread AI summaries* on (Business/Enterprise, team setting), Linear generates a summary of the resolved thread.
- Author-only editing; other menu actions: manage thread subscription, copy comment URL, create issue or sub-issue from the comment, delete.
- **Reactions**: all Unicode emoji plus custom uploads (JPG/GIF/PNG). Available on issues, comments, project updates, initiative updates.
- **`@Linear` in the comment box** is the in-context entry point to the agent — draft a status update, summarise the issue, produce action items ready to post.
- **Synced threads**: a comment thread can be bound to an external conversation (Slack thread, email thread, GitHub issue, Jira issue). Replies flow both ways. Comments made *outside* the synced thread stay private to Linear — this is the documented mechanism for private internal discussion alongside a public conversation.
