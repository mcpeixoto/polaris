import SwiftUI
import PolarisCore

/// The thread under an issue: comments and the history feed, one list, oldest first, the
/// way Linear's activity reads. A history entry is one quiet line; a comment is a card.
///
/// The heading stays "Comments" — it is what the rest of the suite waits for, and it is
/// what the reader is here for. The events are context between them, not the point.
struct ActivityThreadView: View {
    let store: IssueDetailStore
    let names: HistoryText.Names
    let viewerId: String?
    let author: (Comment) -> User?
    let authorName: (Comment) -> String
    let onEdit: (Comment) -> Void
    let onDelete: (Comment) -> Void
    let onReact: (Comment, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            SectionLabel(text: String(localized: "Comments"))

            switch store.comments {
            case .idle, .loading:
                HStack(spacing: Theme.Space.md) {
                    ProgressView().controlSize(.small).tint(Theme.textSecondary)
                    Text("Loading comments")
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.vertical, Theme.Space.sm)

            case .failed(let error):
                InlineErrorLabel(
                    text: error.displayMessage,
                    retryLabel: error.isRetryable ? String(localized: "Try again") : nil,
                    onRetry: error.isRetryable ? { Task { await store.load() } } : nil
                )

            case .loaded(let comments):
                let items = IssueActivity.merge(history: store.history.value ?? [], comments: comments)
                if comments.isEmpty {
                    Text("No comments yet.")
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.vertical, Theme.Space.xs)
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(items) { item in
                        switch item {
                        case .event(let entry):
                            HistoryEventRow(entry: entry, names: names)
                        case .comment(let comment):
                            CommentRow(
                                comment: comment,
                                author: author(comment),
                                name: authorName(comment),
                                isOwn: isOwn(comment),
                                viewerId: viewerId,
                                onEdit: { onEdit(comment) },
                                onDelete: { onDelete(comment) },
                                onReact: { onReact(comment, $0) }
                            )
                        }
                    }
                }
            }

            if let error = store.commentError {
                InlineErrorLabel(text: error.displayMessage)
            }
        }
    }

    private func isOwn(_ comment: Comment) -> Bool {
        guard let viewerId else { return false }
        switch comment.actor.type {
        case .user, .appUser: return comment.actor.id == viewerId
        case .integration, .system: return false
        }
    }
}

/// One line of history: a glyph for what changed, who did it and what, and when.
struct HistoryEventRow: View {
    let entry: IssueHistoryEntry
    let names: HistoryText.Names

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.sm) {
            Image(systemName: Self.symbol(for: entry.kind))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 16)
                .accessibilityHidden(true)
            (
                Text(HistoryText.line(for: entry, names: names))
                    .foregroundStyle(Theme.textSecondary)
                + Text(verbatim: " · ")
                    .foregroundStyle(Theme.textTertiary)
                + Text(entry.createdAt, format: .relative(presentation: .numeric))
                    .foregroundStyle(Theme.textTertiary)
            )
            .font(PolarisText.caption)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, Theme.Space.xs + 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("activity.event.\(entry.id)")
    }

    /// The property that changed, as the web's feed glyphs draw it; a dot for the rest.
    static func symbol(for kind: String) -> String {
        switch kind {
        case "created": "plus"
        case "title", "description": "pencil"
        case "state", "status": "circle.lefthalf.filled"
        case "assignee": "person"
        case "priority": "chart.bar"
        case "label", "labels": "tag"
        case "project": "square.stack.3d.up"
        case "cycle": "arrow.triangle.2.circlepath"
        case "parent": "arrow.turn.down.right"
        case "estimate": "number"
        case "due_date", "dueDate": "calendar"
        case "relation": "link"
        case "subscribe", "subscription": "bell"
        case "deleted", "archived": "archivebox"
        default: "circle.fill"
        }
    }
}

/// One comment in the thread: avatar, name and time on a line, the body under them, the
/// reactions under that. Flat; the hairline between rows is the only separation the
/// thread gets.
struct CommentRow: View {
    let comment: Comment
    let author: User?
    let name: String
    let isOwn: Bool
    let viewerId: String?
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onReact: (String) -> Void
    @State private var showsAbsoluteDate = false

    /// The eight the web's picker offers first.
    static let quickEmoji = ["👍", "❤️", "🎉", "👀", "😄", "🚀", "🙏", "😕"]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack(alignment: .top, spacing: Theme.Space.sm + 2) {
                AvatarView(user: author, size: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    HStack(spacing: Theme.Space.sm) {
                        Text(name)
                            .font(.system(.footnote).weight(.semibold))
                            .foregroundStyle(Theme.textPrimary)
                        // Relative by default, because "2h ago" is what a thread is read in.
                        // The absolute date is a tap away rather than gone.
                        Group {
                            if showsAbsoluteDate {
                                Text(comment.createdAt.formatted(date: .abbreviated, time: .shortened))
                            } else {
                                Text(comment.createdAt, format: .relative(presentation: .numeric))
                            }
                        }
                        .font(PolarisText.captionSmall)
                        .foregroundStyle(Theme.textTertiary)
                        if comment.editedAt != nil {
                            Text("edited")
                                .font(PolarisText.captionSmall)
                                .foregroundStyle(Theme.textTertiary)
                                .accessibilityIdentifier("comment.edited.\(comment.id)")
                        }
                    }
                    .accessibilityElement(children: .combine)
                    Text(comment.body)
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(Theme.easing(0.25)) { showsAbsoluteDate.toggle() } }
            .contextMenu {
                // The way to add the first reaction. The chip row only draws its picker once
                // there is a reaction to sit beside; a smiley under every comment was noise.
                Menu {
                    ForEach(Self.quickEmoji, id: \.self) { emoji in
                        Button { onReact(emoji) } label: { Text(emoji) }
                    }
                } label: {
                    SwiftUI.Label("React", systemImage: "face.smiling")
                }
                if isOwn {
                    Button(action: onEdit) {
                        SwiftUI.Label("Edit", systemImage: "pencil")
                    }
                }
                Button {
                    UIPasteboard.general.string = comment.body
                } label: {
                    SwiftUI.Label("Copy text", systemImage: "doc.on.doc")
                }
                if isOwn {
                    Divider()
                    Button(role: .destructive, action: onDelete) {
                        SwiftUI.Label("Delete", systemImage: "trash")
                    }
                }
            }

            // Only once somebody has reacted: the first reaction comes from the long-press
            // menu, so a comment nobody has reacted to carries no control under it.
            if !tallies.isEmpty {
                reactions
                    .padding(.leading, 24 + Theme.Space.sm + 2)
            }
        }
        .padding(.vertical, Theme.Space.md)
        .overlay(alignment: .bottom) { HairlineDivider() }
        // No identifier on the row itself: one set on a container is inherited by every
        // child, and it replaced the reaction chips' own identifiers.
    }

    private struct Tally: Identifiable {
        let emoji: String
        let count: Int
        let mine: Bool
        var id: String { emoji }
    }

    /// One chip per emoji, in the order they first appeared, so a chip does not jump when
    /// somebody else adds the same one.
    private var tallies: [Tally] {
        var order: [String] = []
        var counts: [String: Int] = [:]
        var mine: Set<String> = []
        for reaction in comment.reactions {
            if counts[reaction.emoji] == nil { order.append(reaction.emoji) }
            counts[reaction.emoji, default: 0] += 1
            if reaction.userId == viewerId { mine.insert(reaction.emoji) }
        }
        return order.map { Tally(emoji: $0, count: counts[$0] ?? 0, mine: mine.contains($0)) }
    }

    private var reactions: some View {
        HStack(spacing: Theme.Space.xs + 2) {
            ForEach(tallies) { tally in
                Button {
                    onReact(tally.emoji)
                } label: {
                    HStack(spacing: Theme.Space.xs) {
                        Text(tally.emoji)
                            .font(.system(size: 13))
                        Text("\(tally.count)")
                            .font(PolarisText.captionSmall.monospacedDigit())
                            .foregroundStyle(tally.mine ? Theme.accentBright : Theme.textSecondary)
                    }
                    .padding(.horizontal, Theme.Space.sm)
                    .frame(minHeight: 24)
                    .background(tally.mine ? Theme.accentTint : Theme.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(tally.mine ? Theme.accent : Theme.border, lineWidth: 1))
                    .hitTarget(minWidth: 0, minHeight: 32)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(Text("\(tally.emoji) \(tally.count)"))
                .accessibilityValue(Text(tally.mine ? "You reacted" : ""))
                .accessibilityIdentifier("comment.reaction.\(tally.emoji)")
            }

            Menu {
                ForEach(Self.quickEmoji, id: \.self) { emoji in
                    Button { onReact(emoji) } label: { Text(emoji) }
                }
            } label: {
                Image(systemName: "face.smiling")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 28, height: 24)
                    .background(Theme.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
                    .hitTarget(minWidth: 0, minHeight: 32)
            }
            .accessibilityLabel(Text("Add reaction"))
            .accessibilityIdentifier("comment.addReaction.\(comment.id)")
        }
    }
}
