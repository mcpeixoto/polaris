import SwiftUI
import PolarisCore

struct SettingsView: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model
    @State private var isConfirmingSignOut = false

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        header.staggerRise(0)

                        section("Account") {
                            HStack(spacing: 12) {
                                AvatarView(user: viewer.user, size: 44)
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
                                    row("Workspaces", "\(viewer.workspaces.count)")
                                }
                            }
                        }
                        .padding(.top, 18)
                        .staggerRise(2)

                        section("Session") {
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
                        }
                        .padding(.top, 18)
                        .staggerRise(3)

                        Text("Polaris \(Bundle.main.shortVersion) (\(Bundle.main.buildNumber))")
                            .monoFont(10.5)
                            .foregroundStyle(Theme.eyebrowText)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 26)
                            .staggerRise(4)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                }
                .scrollIndicators(.hidden)
            }
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog(
                "Sign out of Polaris?",
                isPresented: $isConfirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    Task { await model.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your work stays on the server. You'll need your password to sign back in.")
            }
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
    var shortVersion: String {
        object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    var buildNumber: String {
        object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }
}
