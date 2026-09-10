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
///
/// Rows are grouped by the day they happened — Today, Yesterday, then dated — the way
/// Linear's inbox is.
struct InboxView: View {
    @Environment(AppModel.self) private var model
    @State private var actions = 0
    @State private var failures = 0
    /// Linear's "Unread only" switch. Client-side: the list is already on the phone, and a
    /// second request for a subset of it would be a request for nothing new.
    @State private var unreadOnly = false

    private var inbox: InboxStore { model.inbox }

    var body: some View {
        VStack(spacing: 0) {
            if let error = inbox.actionError {
                InlineErrorLabel(text: error.displayMessage)
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.sm)
                    .readableColumn()
            }
            content
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Inbox"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                filterMenu
                Button {
                    // Counted on the way out, not on the way in: this button is enabled off
                    // the badge, which the poll can set without the list ever having loaded,
                    // and it used to play a success haptic over an inbox nothing had touched.
                    Task { if await inbox.markAllRead() { actions += 1 } }
                } label: {
                    Image(systemName: "checkmark.circle")
                }
                .disabled(inbox.unreadCount == 0)
                .accessibilityLabel(Text("Mark all read"))
                .accessibilityIdentifier("inbox.markAllRead")
            }
        }
        .task { await inbox.load() }
        .sensoryFeedback(.success, trigger: actions)
        .sensoryFeedback(.error, trigger: failures)
        .onChange(of: inbox.actionError == nil) { _, isClear in
            if !isClear { failures += 1 }
        }
    }

    /// Everything, or only what is still unread.
    private var filterMenu: some View {
        Menu {
            Picker(selection: $unreadOnly) {
                Text("All").tag(false)
                Text("Unread only").tag(true)
            } label: {
                Text("Show")
            }
            .pickerStyle(.inline)
        } label: {
            Image(systemName: unreadOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .accessibilityLabel(Text("Filter"))
        .accessibilityIdentifier("inbox.filter")
    }

    @ViewBuilder
    private var content: some View {
        switch inbox.notifications {
        case .idle, .loading:
            SkeletonIssueList(rows: 3)
                .readableColumn()
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
                .padding(.top, Theme.Space.xxxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await inbox.load() }

        case .loaded(let all) where unreadOnly && !all.contains(where: { !$0.isRead }):
            // A filter that hides everything must say so, or it reads as an empty inbox with
            // the badge still lit.
            ScrollView {
                EmptyStateView(
                    symbol: "envelope.open",
                    title: String(localized: "Nothing unread"),
                    message: String(localized: "Everything here has been read. Show all from the filter above."),
                    actionTitle: String(localized: "Show all"),
                    action: { unreadOnly = false }
                )
                .padding(.top, Theme.Space.xxxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await inbox.load() }

        case .loaded(let all):
            let rows = unreadOnly ? all.filter { !$0.isRead } : all
            List {
                ForEach(DayGrouping.group(rows, date: \.createdAt)) { day in
                    Section {
                        ForEach(day.items) { row in
                            notificationRow(row)
                        }
                    } header: {
                        DayHeader(title: day.title)
                    }
                }
            }
            .listStyle(.plain)
            .listSectionSeparator(.hidden)
            .listSectionSpacing(0)
            .contentMargins(.top, 0, for: .scrollContent)
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
                InboxRow(notification: row, actor: actor(for: row), opensIssue: true)
                    .background(NavigationLink(value: issue) { EmptyView() }.opacity(0))
                    // Opening the issue is reading the notification — Linear marks it read
                    // on the way in. Simultaneous, so the link behind the row still fires.
                    .simultaneousGesture(TapGesture().onEnded {
                        guard !row.isRead else { return }
                        Task { await inbox.markRead(row) }
                    })
            } else {
                // No issue means the row outlived what it pointed at. Rendered, because it is
                // still a thing that happened, but not tappable — a link to nothing is worse
                // than no link.
                InboxRow(notification: row, actor: actor(for: row), opensIssue: false)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparatorTint(Theme.hairline)
        .listRowInsets(EdgeInsets(
            top: 0, leading: Theme.Space.lg,
            bottom: 0, trailing: Theme.Space.lg
        ))
        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
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
                // Tomorrow morning, the one snooze a swipe can offer without a menu. The
                // other two are in the context menu.
                Task { await inbox.snooze(row, until: SnoozeOption.tomorrow.date()) }
            } label: {
                SwiftUI.Label("Snooze", systemImage: "clock")
            }
            .tint(Theme.warn)
        }
        .contextMenu {
            Button {
                actions += 1
                Task { await inbox.markRead(row, read: !row.isRead) }
            } label: {
                SwiftUI.Label(
                    row.isRead ? String(localized: "Mark unread") : String(localized: "Mark read"),
                    systemImage: row.isRead ? "envelope.badge" : "envelope.open"
                )
            }
            if row.snoozedUntil == nil {
                SnoozeMenu { until in
                    actions += 1
                    Task { await inbox.snooze(row, until: until) }
                }
            } else {
                Button {
                    actions += 1
                    Task { await inbox.snooze(row, until: nil) }
                } label: {
                    SwiftUI.Label("Unsnooze", systemImage: "clock.badge.xmark")
                }
            }
            Divider()
            Button(role: .destructive) {
                actions += 1
                Task { await inbox.delete(row) }
            } label: {
                SwiftUI.Label("Delete", systemImage: "trash")
            }
        }
        .accessibilityIdentifier("inbox.row.\(row.id)")
    }

    /// Who did it, when the workspace knows them. Integrations and the system have no face.
    private func actor(for row: PolarisNotification) -> User? {
        switch row.actor.type {
        case .user, .appUser: model.workspaceData.user(id: row.actor.id)
        case .integration, .system: nil
        }
    }
}

/// The day a group of rows belongs to. Plain and small; the rows are the point.
private struct DayHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(.footnote).weight(.medium))
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Theme.Space.lg)
            .frame(minHeight: 30)
            .background(Theme.raised)
            .textCase(nil)
            .listRowInsets(EdgeInsets())
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("inbox.day.\(title)")
    }
}

/// One thing that happened: the unread mark, who did it, what it was, on which issue, when.
private struct InboxRow: View {
    let notification: PolarisNotification
    let actor: User?
    /// Whether a tap goes somewhere. The link that takes it there sits behind the row with
    /// no label of its own, so the row is what says it is a button.
    let opensIssue: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm + 2) {
            Circle()
                .fill(notification.isRead ? Color.clear : Theme.accent)
                .frame(width: 7, height: 7)
                .padding(.top, 6)

            ZStack(alignment: .bottomTrailing) {
                AvatarView(user: actor, size: 28)
                Image(systemName: notification.type.symbolName)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 14, height: 14)
                    .background(Theme.darkBase)
                    .clipShape(Circle())
                    .offset(x: 3, y: 3)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Theme.Space.xxs + 1) {
                Text(sentence)
                    .font(.system(.subheadline).weight(notification.isRead ? .regular : .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(notification.subtitle)
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let until = notification.snoozedUntil {
                    SwiftUI.Label {
                        Text("Snoozed until \(until, format: .dateTime.weekday(.abbreviated).hour().minute())")
                    } icon: {
                        Image(systemName: "clock")
                    }
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(Theme.warn)
                }
            }

            Spacer(minLength: Theme.Space.sm)

            Text(notification.createdAt, format: .relative(presentation: .numeric))
                .font(PolarisText.captionSmall)
                .foregroundStyle(Theme.textTertiary)
                .lineLimit(1)
                .padding(.top, 2)
        }
        .padding(.vertical, Theme.Space.sm + 2)
        .frame(minHeight: Theme.rowHeight)
        .contentShape(Rectangle())
        // One label, in the order a person would say it, rather than four fragments.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(spokenLabel))
        .accessibilityAddTraits(opensIssue ? .isButton : [])
    }

    private var sentence: String { InboxSentence.text(for: notification, actor: actor) }

    private var spokenLabel: String {
        let state = notification.isRead
            ? String(localized: "Read")
            : String(localized: "Unread")
        return "\(state), \(sentence), \(notification.subtitle)"
    }
}
