import SwiftUI
import PolarisCore

/// Settings, as the platform draws them: inset grouped sections on the page colour.
struct SettingsView: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model
    @State private var isConfirmingSignOut = false
    @State private var switchError: PolarisError?
    /// The account as this screen shows it. Seeded from the viewer and written by the profile
    /// screen on save, so a renamed reader sees the new name here at once rather than after
    /// the next viewer load — which nothing on this screen triggers.
    @State private var user: User
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system

    /// Where feedback goes. The address the web client's pricing page uses, with a subject
    /// that says which client it came from.
    private static let feedbackURL = URL(string: "mailto:hello@peixotolabs.com?subject=Polaris%20for%20iOS")!

    init(viewer: Viewer) {
        self.viewer = viewer
        _user = State(initialValue: viewer.user)
    }

    var body: some View {
        List {
            Section {
                NavigationLink {
                    ProfileView(user: $user)
                } label: {
                    HStack(spacing: Theme.Space.md) {
                        // Hidden here: AvatarView's label reads "Assigned to …", which is
                        // right on an issue row and wrong on your own account. The name and
                        // email beside it already say who this is.
                        AvatarView(user: user, size: 40)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                            Text(user.displayName)
                                .font(.system(.subheadline).weight(.semibold))
                                .foregroundStyle(Theme.textPrimary)
                            if let email = user.email {
                                Text(email)
                                    .font(PolarisText.caption)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, Theme.Space.xs)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("settings.profile")
            } header: {
                header("Account")
            }

            Section {
                row("Name", viewer.workspace.name)
                row("Address", viewer.workspace.urlKey)
                planRow
                if viewer.workspaces.count > 1 {
                    workspaceSwitcher
                }
                if let switchError {
                    InlineErrorLabel(text: switchError.displayMessage)
                }
            } header: {
                header("Workspace")
            }

            Section {
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    HStack {
                        Text("Notifications")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                    }
                }
                .accessibilityIdentifier("settings.notifications")
                appearanceRow
                // In Preferences rather than an About section of its own: the extra header
                // pushed Sign out under the tab bar on a phone, and a settings screen whose
                // last row needs a scroll to find is one people give up on.
                Link(destination: Self.feedbackURL) {
                    HStack {
                        Text("Send feedback")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("settings.feedback")
            } header: {
                header(String(localized: "Preferences"))
            }

            Section {
                Button {
                    isConfirmingSignOut = true
                } label: {
                    Text("Sign out")
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings.signOut")
            } footer: {
                Text("Polaris \(Bundle.main.shortVersion) (\(Bundle.main.buildNumber))")
                    .font(PolarisText.captionSmall.monospacedDigit())
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, Theme.Space.sm)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Settings"))
        .navigationBarTitleDisplayMode(.inline)
        // A workspace switch hands this screen a new viewer under the same identity.
        .onChange(of: viewer.user) { _, fresh in user = fresh }
        .confirmationDialog(
            Text("Sign out of Polaris?"),
            isPresented: $isConfirmingSignOut,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.signOut() }
            } label: {
                Text("Sign out")
            }
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: {
            Text("Your work stays on the server. You'll need your password to sign back in.")
        }
    }

    /// Sentence case, not the platform's uppercase: the web's section headings are sentence
    /// case and the two clients should read the same way.
    private func header(_ title: String) -> some View {
        Text(title)
            .font(PolarisText.sectionTitle)
            .foregroundStyle(Theme.textTertiary)
            .textCase(nil)
    }

    /// The plan, with the accent reserved for a paid tier.
    ///
    /// A self-hosted install is unlimited and is not an upsell target, so it is stated plainly
    /// rather than dressed as a tier somebody should move off.
    private var planRow: some View {
        HStack {
            Text("Plan")
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(viewer.workspace.planLabel)
                .font(.system(.caption).weight(.semibold))
                .foregroundStyle(isPaid ? Theme.accentBright : Theme.textPrimary)
                .padding(.horizontal, Theme.Space.sm)
                .frame(minHeight: 22)
                .background(isPaid ? Theme.accentTint : Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Plan: \(viewer.workspace.planLabel)")
    }

    /// The switcher that replaced a row reading `Workspaces  2`.
    ///
    /// It showed the *count* — the app knew there was more than one workspace and offered no
    /// way to reach any of them, though `useWorkspace(id:)` has been there all along. Every
    /// store is rebuilt behind this, because they hold issues, teams, states and people
    /// belonging to the workspace being left.
    private var workspaceSwitcher: some View {
        Menu {
            ForEach(viewer.workspaces) { workspace in
                Button {
                    Task {
                        if let failure = await model.switchWorkspace(to: workspace) {
                            withAnimation(Theme.easing(0.3)) { switchError = failure }
                        }
                    }
                } label: {
                    if workspace.id == viewer.workspace.id {
                        SwiftUI.Label(workspace.name, systemImage: "checkmark")
                    } else {
                        Text(workspace.name)
                    }
                }
            }
        } label: {
            HStack {
                Text("Workspace")
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                if model.isSwitchingWorkspace {
                    ProgressView().controlSize(.small).tint(Theme.textSecondary)
                } else {
                    Text(viewer.workspace.name)
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .disabled(model.isSwitchingWorkspace)
        .accessibilityLabel(Text("Switch workspace"))
        .accessibilityIdentifier("settings.workspaceSwitcher")
    }

    /// Light, dark or system.
    ///
    /// The app was pinned to dark and the web client has shipped all three since day one, so
    /// the two clients disagreed about what Polaris looks like. Stored on the device rather
    /// than in the workspace: it must survive a sign-out and be readable before there is a
    /// session to read it from.
    private var appearanceRow: some View {
        Picker(selection: $appearance) {
            ForEach(AppearancePreference.allCases) { option in
                Text(option.label).tag(option)
            }
        } label: {
            Text("Appearance")
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
        }
        .pickerStyle(.menu)
        .tint(Theme.textPrimary)
        .accessibilityIdentifier("settings.appearance")
    }

    private var isPaid: Bool {
        viewer.workspace.plan == "pro" || viewer.workspace.plan == "enterprise"
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .accessibilityElement(children: .combine)
    }
}

extension Bundle {
    /// "unknown", not "0". Both keys interpolate from the build settings, and
    /// `PolarisTests/AppSmokeTests` asserts they do — so the fallback is unreachable in a good
    /// build. It is reachable in a broken one, and "Polaris 0 (0)" is a plausible-looking
    /// version number that hides the breakage in a screenshot.
    var shortVersion: String {
        object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    }

    var buildNumber: String {
        object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    }
}
