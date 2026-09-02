import SwiftUI
import PolarisCore

struct SettingsView: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model
    @State private var isConfirmingSignOut = false
    @State private var switchError: PolarisError?
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header.staggerRise(0)

                    section("Account") {
                        HStack(spacing: 12) {
                            // Hidden here: AvatarView's label reads "Assigned to …",
                            // which is right on an issue row and wrong on your own
                            // account. The name and email beside it already say who this
                            // is.
                            AvatarView(user: viewer.user, size: 44)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(viewer.user.displayName)
                                    .bodyFont(15, weight: .semibold)
                                    .foregroundStyle(Theme.textPrimary)
                                if let email = viewer.user.email {
                                    Text(email)
                                        .bodyFont(12.5)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(16)
                        .accessibilityElement(children: .combine)
                    }
                    .padding(.top, 22)
                    .staggerRise(1)

                    section("Workspace") {
                        VStack(spacing: 0) {
                            row("Name", viewer.workspace.name)
                            HairlineDivider().padding(.horizontal, 16)
                            row("Address", viewer.workspace.urlKey)
                            HairlineDivider().padding(.horizontal, 16)
                            planRow
                            if viewer.workspaces.count > 1 {
                                HairlineDivider().padding(.horizontal, 16)
                                workspaceSwitcher
                            }
                        }
                    }
                    .padding(.top, 18)
                    .staggerRise(2)

                    if let switchError {
                        InlineErrorLabel(text: switchError.displayMessage)
                            .padding(.top, Theme.Space.sm)
                    }

                    section(String(localized: "Preferences")) {
                        appearanceRow
                    }
                    .padding(.top, 18)
                    .staggerRise(3)

                    section(String(localized: "Session")) {
                        Button {
                            isConfirmingSignOut = true
                        } label: {
                            HStack {
                                Text("Sign out")
                                    .bodyFont(14, weight: .semibold)
                                    .foregroundStyle(Theme.danger)
                                Spacer()
                            }
                            .padding(16)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("settings.signOut")
                    }
                    .padding(.top, 18)
                    .staggerRise(4)

                    Text("Polaris \(Bundle.main.shortVersion) (\(Bundle.main.buildNumber))")
                        .monoFont(10.5)
                        .foregroundStyle(Theme.eyebrowText)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 26)
                        .staggerRise(5)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
        }
        .toolbar(.hidden, for: .navigationBar)
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            MonoEyebrow(text: viewer.workspace.planLabel)
            Text("Settings")
                .displayFont(30, weight: .bold)
                .foregroundStyle(Theme.textPrimary)
        }
    }

    /// The plan, with the accent reserved for a paid tier.
    ///
    /// A self-hosted install is unlimited and is not an upsell target, so it is stated plainly
    /// rather than dressed as a tier somebody should move off.
    private var planRow: some View {
        HStack {
            Text("Plan")
                .bodyFont(14)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(viewer.workspace.planLabel)
                .bodyFont(12.5, weight: .bold)
                .foregroundStyle(isPaid ? Theme.accentBright : Theme.textPrimary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Capsule().fill(isPaid ? Theme.accentTint : Theme.chipInactive))
                .overlay(Capsule().stroke(isPaid ? Theme.accent.opacity(0.4) : Theme.border, lineWidth: 1))
        }
        .padding(16)
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
                    .bodyFont(14)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                if model.isSwitchingWorkspace {
                    ProgressView().controlSize(.small).tint(Theme.accentBright)
                } else {
                    Text(viewer.workspace.name)
                        .bodyFont(14, weight: .medium)
                        .foregroundStyle(Theme.accentBright)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.eyebrowText)
                }
            }
            .padding(Theme.Space.lg)
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
                SwiftUI.Label(option.label, systemImage: option.symbolName).tag(option)
            }
        } label: {
            Text("Appearance").bodyFont(14).foregroundStyle(Theme.textSecondary)
        }
        .tint(Theme.accentBright)
        .padding(.horizontal, Theme.Space.lg)
        .padding(.vertical, Theme.Space.xs)
        .accessibilityIdentifier("settings.appearance")
    }

    private var isPaid: Bool {
        viewer.workspace.plan == "pro" || viewer.workspace.plan == "enterprise"
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .bodyFont(14)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .bodyFont(14, weight: .medium)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoEyebrow(text: title)
            Card { content() }
        }
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
