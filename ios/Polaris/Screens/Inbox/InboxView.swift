import SwiftUI
import PolarisCore

/// The inbox: what happened, and what to do about it.
///
/// `unreadNotificationCount` was plumbed end to end and called by nothing — no tab badge, no
/// list, no read, snooze or delete. This is the screen that uses it.
///
/// Pull-only, and that is a backend fact rather than an iOS omission: the server has no
/// device-token schema and no APNs sender, so there is nothing to register for. Rows arrive
/// when this screen loads and when the shell's thirty-second poll refreshes the badge.
struct InboxView: View {
    @Environment(AppModel.self) private var model
    @State private var actions = 0
    @State private var failures = 0

    private var inbox: InboxStore { model.inbox }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, Theme.Space.xl)
                .padding(.top, Theme.Space.sm)
                .readableColumn()

            if let error = inbox.actionError {
                InlineErrorLabel(text: error.displayMessage)
                    .padding(.horizontal, Theme.Space.xl)
                    .padding(.top, Theme.Space.sm)
                    .readableColumn()
            }

            content
        }
        .background(Theme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task { await inbox.load() }
        .sensoryFeedback(.success, trigger: actions)
        .sensoryFeedback(.error, trigger: failures)
        .onChange(of: inbox.actionError == nil) { _, isClear in
            if !isClear { failures += 1 }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            MonoEyebrow(text: unreadLabel)
            HStack {
                Text("Inbox")
                    .displayFont(30, weight: .bold)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Button {
                    actions += 1
                    Task { await inbox.markAllRead() }
                } label: {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.accentBright)
                        .frame(width: 38, height: 38)
                        .background(Theme.accentTint)
                        .clipShape(Circle())
                        .hitTarget()
                }
                .buttonStyle(PressableStyle())
                .disabled(inbox.unreadCount == 0)
                .opacity(inbox.unreadCount == 0 ? 0.4 : 1)
                .accessibilityLabel(Text("Mark all read"))
                .accessibilityIdentifier("inbox.markAllRead")
            }
        }
    }

    private var unreadLabel: String {
        if case .failed(let error) = inbox.notifications {
            return error.isRetryable
                ? String(localized: "Can't reach Polaris")
                : String(localized: "Error")
        }
        guard inbox.notifications.value != nil else { return String(localized: "Loading") }
        return inbox.unreadCount == 0
            ? String(localized: "All read")
            : String(localized: "\(inbox.unreadCount) unread")
    }

    @ViewBuilder
    private var content: some View {
        switch inbox.notifications {
        case .idle, .loading:
            SkeletonIssueList(rows: 3)
                .readableColumn()
                .padding(.top, Theme.Space.sm)
            Spacer(minLength: 0)

        case .failed(let error):
            ErrorStateView(error: error) { Task { await inbox.load() } }
                .readableColumn()

        case .loaded(let rows) where rows.isEmpty:
            ScrollView {
                EmptyStateView(
                    symbol: "tray",
                    title: String(localized: "You're all caught up"),
                    message: String(localized: "Assignments, mentions and comments on issues you follow land here.")
                )
                .padding(.horizontal, Theme.Space.xl)
                .padding(.top, Theme.Space.md)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await inbox.load() }

        case .loaded(let rows):
            List {
                ForEach(rows) { row in
                    notificationRow(row)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .scrollIndicators(.hidden)
            .animation(Theme.easing(0.3), value: rows.map(\.id))
            .readableColumn()
            .refreshable { await inbox.load() }
        }
    }

    @ViewBuilder
    private func notificationRow(_ row: PolarisNotification) -> some View {
        Group {
            if let issue = row.issue {
                NavigationLink(value: issue) { InboxRow(notification: row) }
            } else {
                // No issue means the row outlived what it pointed at. Rendered, because it is
                // still a thing that happened, but not tappable — a link to nothing is worse
                // than no link.
                InboxRow(notification: row)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(
            top: Theme.Space.xs, leading: Theme.Space.xl,
            bottom: Theme.Space.xs, trailing: Theme.Space.xl
        ))
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                actions += 1
                Task { await inbox.markRead(row, read: !row.isRead) }
            } label: {
                SwiftUI.Label(
                    row.isRead ? String(localized: "Unread") : String(localized: "Read"),
                    systemImage: row.isRead ? "envelope.badge" : "envelope.open"
                )
            }
            .tint(Theme.accent)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                actions += 1
                Task { await inbox.delete(row) }
            } label: {
                SwiftUI.Label("Delete", systemImage: "trash")
            }
            Button {
                actions += 1
                // A day, which is the only snooze a phone screen has room to offer without a
                // date picker nobody wants in a swipe action.
                Task { await inbox.snooze(row, until: Date().addingTimeInterval(24 * 60 * 60)) }
            } label: {
                SwiftUI.Label("Snooze", systemImage: "clock")
            }
            .tint(Theme.warn)
        }
        .accessibilityIdentifier("inbox.row.\(row.id)")
    }
}

private struct InboxRow: View {
    let notification: PolarisNotification

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.md) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: notification.type.symbolName)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(notification.isRead ? Theme.textSecondary : Theme.accentBright)
                    .frame(width: 22, height: 22)
                if !notification.isRead {
                    Circle()
                        .fill(Theme.accent)
                        .frame(width: 6, height: 6)
                        .offset(x: 3, y: -2)
                }
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(spacing: Theme.Space.sm) {
                    Text(notification.type.summary)
                        .bodyFont(14, weight: notification.isRead ? .medium : .semibold)
                        .foregroundStyle(Theme.textPrimary)
                    Spacer(minLength: 0)
                    Text(notification.createdAt, format: .relative(presentation: .numeric))
                        .monoFont(10.5)
                        .foregroundStyle(Theme.eyebrowText)
                }
                Text(notification.subtitle)
                    .bodyFont(12.5)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if notification.snoozedUntil != nil {
                    SwiftUI.Label {
                        Text("Snoozed")
                    } icon: {
                        Image(systemName: "clock")
                    }
                    .monoFont(10)
                    .foregroundStyle(Theme.warn)
                }
            }
        }
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.md)
        .background(notification.isRead ? Theme.card : Theme.accentTint)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        // One label, in the order a person would say it, rather than four fragments.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spokenLabel))
    }

    private var spokenLabel: String {
        let state = notification.isRead
            ? String(localized: "Read")
            : String(localized: "Unread")
        return "\(state), \(notification.type.summary), \(notification.subtitle)"
    }
}
