import SwiftUI
import PolarisCore

/// The children under an issue: a progress bar, the rows, and a field to add one.
///
/// Rows are the same `IssueRow` the lists draw, so a sub-issue reads exactly like the issue
/// it will be once tapped. The field is inline rather than a sheet because "add sub-issue"
/// is a title and nothing else — everything else it inherits from the parent.
struct SubIssuesSection: View {
    let children: [Issue]
    let progress: IssueProgress?
    let onOpen: (Issue) -> Void
    let onAdd: (String) async -> Bool
    @State private var draft = ""
    @State private var isAdding = false
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack(spacing: Theme.Space.sm) {
                SectionLabel(text: String(localized: "Sub-issues"))
                if !children.isEmpty {
                    Text("\(children.count)")
                        .font(PolarisText.sectionTitle.monospacedDigit())
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            if let bar = completion {
                HStack(spacing: Theme.Space.sm) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.trackBg)
                            Capsule()
                                .fill(Theme.state(.completed))
                                .frame(width: geo.size.width * bar.fraction)
                        }
                    }
                    .frame(height: 4)
                    Text("\(bar.completed) of \(bar.total) done")
                        .font(PolarisText.captionSmall.monospacedDigit())
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("\(bar.completed) of \(bar.total) sub-issues done"))
                .accessibilityIdentifier("issue.subIssues.progress")
            }

            VStack(spacing: 0) {
                ForEach(children) { child in
                    Button {
                        onOpen(child)
                    } label: {
                        IssueRow(issue: child, isPending: child.identifier.hasSuffix("…"))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityIdentifier("issue.subIssue.\(child.identifier)")
                    HairlineDivider()
                }
            }

            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityHidden(true)
                TextField(
                    "",
                    text: $draft,
                    prompt: Text("Add sub-issue").foregroundStyle(Theme.placeholder)
                )
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .tint(Theme.accentBright)
                .focused($fieldFocused)
                .submitLabel(.done)
                .disabled(isAdding)
                .onSubmit { submit() }
                .accessibilityLabel(Text("Add sub-issue"))
                .accessibilityIdentifier("issue.addSubIssue")
                if isAdding {
                    ProgressView().controlSize(.small).tint(Theme.textSecondary)
                }
            }
            .frame(minHeight: 36)
        }
    }

    private struct Completion {
        let completed: Int
        let total: Int
        var fraction: CGFloat { total > 0 ? CGFloat(completed) / CGFloat(total) : 0 }
    }

    /// The server's roll-up when it sent one, else counted from the rows on screen — which
    /// is what keeps the bar honest the moment a child is added optimistically.
    private var completion: Completion? {
        if let progress, progress.total > 0, children.count == progress.total {
            return Completion(completed: progress.completed, total: progress.total - progress.canceled)
        }
        guard !children.isEmpty else { return nil }
        let live = children.filter { $0.state.category != .canceled && $0.state.category != .duplicate }
        return Completion(completed: live.filter { $0.state.category == .completed }.count, total: live.count)
    }

    private func submit() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !isAdding else { return }
        isAdding = true
        Task { @MainActor in
            // Cleared only once it landed, for the reason the comment composer gives.
            if await onAdd(title) { draft = "" }
            isAdding = false
        }
    }
}

/// How this issue is tied to others. Every row opens the other end.
struct RelationsSection: View {
    enum Choice: String, CaseIterable, Identifiable {
        case blocks, blockedBy, related, duplicateOf
        var id: String { rawValue }

        var title: String {
            switch self {
            case .blocks: String(localized: "Blocks")
            case .blockedBy: String(localized: "Blocked by")
            case .related: String(localized: "Related to")
            case .duplicateOf: String(localized: "Duplicate of")
            }
        }
    }

    struct Row: Identifiable {
        let relation: IssueRelation
        let kind: String
        let other: IssueRef
        var id: String { "\(kind)-\(relation.id)" }
    }

    let issueId: String
    let relations: [IssueRelation]
    let blockedBy: [IssueRelation]
    let error: PolarisError?
    let onOpen: (IssueRef) -> Void
    let onAdd: (Choice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            SectionLabel(text: String(localized: "Relations"))

            VStack(spacing: 0) {
                ForEach(rows) { row in
                    Button {
                        onOpen(row.other)
                    } label: {
                        HStack(spacing: Theme.Space.sm) {
                            Text(row.kind)
                                .font(PolarisText.caption)
                                .foregroundStyle(Theme.textSecondary)
                                .frame(minWidth: 76, alignment: .leading)
                            Text(row.other.identifier)
                                .font(PolarisText.rowMeta)
                                .foregroundStyle(Theme.textSecondary)
                            Text(row.other.title)
                                .font(PolarisText.rowTitle)
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text("\(row.kind), \(row.other.identifier), \(row.other.title)"))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("issue.relation.\(row.other.identifier)")
                    HairlineDivider()
                }
            }

            Menu {
                ForEach(Choice.allCases) { choice in
                    Button { onAdd(choice) } label: { Text(choice.title) }
                }
            } label: {
                HStack(spacing: Theme.Space.sm) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .medium))
                    Text("Add relation")
                        .font(PolarisText.body)
                }
                .foregroundStyle(Theme.textSecondary)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .accessibilityLabel(Text("Add relation"))
            .accessibilityIdentifier("issue.addRelation")

            if let error {
                InlineErrorLabel(text: error.displayMessage)
            }
        }
    }

    /// Blocked by first — the one that says why nothing is moving — then what this blocks,
    /// then the rest.
    private var rows: [Row] {
        let blockers = blockedBy.map {
            Row(relation: $0, kind: String(localized: "Blocked by"), other: $0.counterpart(of: issueId))
        }
        let outgoing = relations.map { relation in
            let kind: String = switch relation.type {
            case .blocks: String(localized: "Blocks")
            case .related: String(localized: "Related")
            case .duplicate: String(localized: "Duplicate of")
            }
            return Row(relation: relation, kind: kind, other: relation.counterpart(of: issueId))
        }
        let order: [RelationType] = [.blocks, .related, .duplicate]
        return blockers + outgoing.sorted {
            (order.firstIndex(of: $0.relation.type) ?? 9) < (order.firstIndex(of: $1.relation.type) ?? 9)
        }
    }
}

/// The link cards on an issue. Each opens in Safari; nothing here previews a page.
struct LinksSection: View {
    let attachments: [Attachment]
    let onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            SectionLabel(text: String(localized: "Links"))

            VStack(spacing: 0) {
                ForEach(attachments) { attachment in
                    if let url = URL(string: attachment.url) {
                        Link(destination: url) {
                            row(attachment)
                        }
                        .accessibilityLabel(Text("\(attachment.title), \(subtitle(attachment))"))
                        .accessibilityIdentifier("issue.link.\(attachment.id)")
                    } else {
                        row(attachment)
                    }
                    HairlineDivider()
                }
            }

            Button(action: onAdd) {
                HStack(spacing: Theme.Space.sm) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .medium))
                    Text("Add link")
                        .font(PolarisText.body)
                }
                .foregroundStyle(Theme.textSecondary)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("issue.addLink")
        }
    }

    private func row(_ attachment: Attachment) -> some View {
        HStack(spacing: Theme.Space.sm + 2) {
            Image(systemName: "link")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.title)
                    .font(PolarisText.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(subtitle(attachment))
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if attachment.id.hasPrefix("pending-") {
                ProgressView().controlSize(.small).tint(Theme.textSecondary)
            } else {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(.vertical, Theme.Space.sm)
        .frame(minHeight: Theme.rowHeight)
        .contentShape(Rectangle())
    }

    /// The server's subtitle when it wrote one, else the host — "github.com" says more than
    /// the URL a second time.
    private func subtitle(_ attachment: Attachment) -> String {
        if let subtitle = attachment.subtitle, !subtitle.isEmpty { return subtitle }
        return URL(string: attachment.url)?.host ?? attachment.url
    }
}
