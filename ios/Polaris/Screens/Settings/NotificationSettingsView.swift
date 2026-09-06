import SwiftUI
import PolarisCore

/// The twenty notification types the server sends, as the six switches a phone has room for.
///
/// One switch per type would be a settings screen nobody reads to the end. Grouped by what
/// the reader would say they want — "tell me about comments", not "tell me about COMMENT and
/// MENTION" — and a group is off only when every type in it is muted, so a group somebody
/// half-muted on the web still reads as on here rather than silently muting the rest.
enum NotificationGroup: String, CaseIterable, Identifiable {
    case assignments
    case statusChanges
    case commentsAndMentions
    case dueDatesAndBlocking
    case projectsAndInitiatives
    case customers

    var id: String { rawValue }

    var title: String {
        switch self {
        case .assignments: String(localized: "Assignments")
        case .statusChanges: String(localized: "Status changes")
        case .commentsAndMentions: String(localized: "Comments & mentions")
        case .dueDatesAndBlocking: String(localized: "Due dates & blocking")
        case .projectsAndInitiatives: String(localized: "Projects & initiatives")
        case .customers: String(localized: "Customers")
        }
    }

    var detail: String {
        switch self {
        case .assignments: String(localized: "When an issue is assigned to you")
        case .statusChanges: String(localized: "Status, priority and sub-issue changes on issues you follow")
        case .commentsAndMentions: String(localized: "Comments on issues you follow, and anywhere you are mentioned")
        case .dueDatesAndBlocking: String(localized: "Deadlines coming up, and issues that get blocked")
        case .projectsAndInitiatives: String(localized: "Updates, digests and issues in projects, initiatives and views you follow")
        case .customers: String(localized: "Customer requests added, escalated or completed")
        }
    }

    var symbolName: String {
        switch self {
        case .assignments: "person.crop.circle.badge.checkmark"
        case .statusChanges: "arrow.triangle.swap"
        case .commentsAndMentions: "bubble.left"
        case .dueDatesAndBlocking: "calendar.badge.exclamationmark"
        case .projectsAndInitiatives: "folder"
        case .customers: "person.2"
        }
    }

    /// Every type the server has, each in exactly one group. `.other` is the decoder's
    /// fallback for types this build does not know, not a type, so it belongs to none.
    var types: [PolarisNotificationType] {
        switch self {
        case .assignments:
            [.issueAssigned]
        case .statusChanges:
            [.issueStatusChanged, .issuePriorityRaised, .subIssueCompleted]
        case .commentsAndMentions:
            [.comment, .mention]
        case .dueDatesAndBlocking:
            [.issueDue, .issueBlocked]
        case .projectsAndInitiatives:
            [.projectIssueAdded, .projectIssueCompleted, .projectUpdate,
             .initiativeIssueAdded, .initiativeIssueCompleted, .initiativeUpdate,
             .pulseDigest, .viewIssueAdded, .viewIssueCompleted]
        case .customers:
            [.customerRequestAdded, .customerRequestImportant, .customerRequestCompleted]
        }
    }

    /// On unless every type in the group is muted.
    func isEnabled(in prefs: NotificationPrefs) -> Bool {
        !types.allSatisfy { prefs.isMuted($0) }
    }

    /// Switching a group mutes or unmutes every type in it; nothing outside it moves.
    func setEnabled(_ enabled: Bool, in prefs: inout NotificationPrefs) {
        for type in types { prefs.setMuted(type, !enabled) }
    }
}

/// How often the email arrives. The server's four words, spelled for a person.
enum EmailDigest: String, CaseIterable, Identifiable {
    case off, hourly, daily, weekly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .off: String(localized: "Off")
        case .hourly: String(localized: "Hourly")
        case .daily: String(localized: "Daily")
        case .weekly: String(localized: "Weekly")
        }
    }

    /// Absent on the wire means daily — `NotificationPrefs.emailDigest` documents the default.
    static func from(_ prefs: NotificationPrefs) -> EmailDigest {
        prefs.emailDigest.flatMap(EmailDigest.init(rawValue:)) ?? .daily
    }
}

/// Which notifications reach the reader, and how the email behaves.
///
/// Optimistic, like every other write in the app: the switch moves at once, the bag goes to
/// the server whole — it replaces rather than merges — and a refusal moves the switch back
/// and says so.
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var prefs: Loadable<NotificationPrefs> = .idle
    @State private var error: PolarisError?
    @State private var isSaving = false

    var body: some View {
        List {
            switch prefs {
            case .idle, .loading:
                Section {
                    HStack {
                        Spacer()
                        ProgressView().tint(Theme.textSecondary)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                }
            case .failed(let failure):
                Section {
                    ErrorStateView(error: failure) { Task { await load() } }
                        .listRowBackground(Color.clear)
                }
            case .loaded(let current):
                Section {
                    ForEach(NotificationGroup.allCases) { group in
                        Toggle(isOn: binding(for: group, in: current)) {
                            HStack(spacing: Theme.Space.sm + 2) {
                                Image(systemName: group.symbolName)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.textSecondary)
                                    .frame(width: 20)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(group.title)
                                        .font(PolarisText.body)
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(group.detail)
                                        .font(PolarisText.captionSmall)
                                        .foregroundStyle(Theme.textTertiary)
                                }
                            }
                        }
                        .tint(Theme.accent)
                        .accessibilityIdentifier("notifications.\(group.rawValue)")
                    }
                } header: {
                    header(String(localized: "Notify me about"))
                }

                Section {
                    Picker(selection: digestBinding(current)) {
                        ForEach(EmailDigest.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    } label: {
                        Text("Email digest")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.textPrimary)
                    .accessibilityIdentifier("notifications.emailDigest")

                    Toggle(isOn: perNotificationBinding(current)) {
                        Text("Email every notification")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                    }
                    .tint(Theme.accent)
                    .accessibilityIdentifier("notifications.emailPerNotification")
                } header: {
                    header(String(localized: "Email"))
                } footer: {
                    Text("A digest bundles what happened since the last one. Every notification means one email each, as it happens.")
                        .font(PolarisText.captionSmall)
                        .foregroundStyle(Theme.textTertiary)
                }

                if let error {
                    Section {
                        InlineErrorLabel(text: error.displayMessage)
                            .listRowBackground(Color.clear)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Notifications"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(PolarisText.sectionTitle)
            .foregroundStyle(Theme.textTertiary)
            .textCase(nil)
    }

    private func load() async {
        guard prefs.value == nil else { return }
        // The viewer already carries the bag; asking again on open only costs a round trip
        // when the viewer's copy could not be decoded.
        if let carried = model.currentUser?.notificationPrefs {
            prefs = .loaded(carried)
            return
        }
        prefs = .loading
        do {
            prefs = .loaded(try await model.api.notificationPrefs())
        } catch {
            prefs = .failed(PolarisError.mapped(error))
        }
    }

    private func binding(for group: NotificationGroup, in current: NotificationPrefs) -> Binding<Bool> {
        Binding(
            get: { group.isEnabled(in: current) },
            set: { enabled in
                var next = current
                group.setEnabled(enabled, in: &next)
                commit(next, from: current)
            }
        )
    }

    private func digestBinding(_ current: NotificationPrefs) -> Binding<EmailDigest> {
        Binding(
            get: { EmailDigest.from(current) },
            set: { choice in
                var next = current
                next.emailDigest = choice.rawValue
                commit(next, from: current)
            }
        )
    }

    private func perNotificationBinding(_ current: NotificationPrefs) -> Binding<Bool> {
        Binding(
            get: { current.emailPerNotification ?? false },
            set: { on in
                var next = current
                next.emailPerNotification = on
                commit(next, from: current)
            }
        )
    }

    /// Apply first, ask after, put back on refusal.
    private func commit(_ next: NotificationPrefs, from previous: NotificationPrefs) {
        guard next != previous else { return }
        prefs = .loaded(next)
        error = nil
        isSaving = true
        Task {
            do {
                prefs = .loaded(try await model.api.updateNotificationPrefs(next))
            } catch {
                prefs = .loaded(previous)
                withAnimation(Theme.easing(0.3)) { self.error = PolarisError.mapped(error) }
            }
            isSaving = false
        }
    }
}
