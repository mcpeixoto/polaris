import SwiftUI
import PolarisCore

struct SettingsView: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    HStack(spacing: 12) {
                        AvatarView(user: viewer.user, size: 40)
                        VStack(alignment: .leading) {
                            Text(viewer.user.displayName).font(.headline)
                            if let email = viewer.user.email {
                                Text(email)
                                    .font(TypeScale.rowMeta)
                                    .foregroundStyle(Theme.secondaryText)
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                }

                Section("Workspace") {
                    LabeledContent("Name", value: viewer.workspace.name)
                    LabeledContent("URL key", value: viewer.workspace.urlKey)
                    if viewer.workspaces.count > 1 {
                        LabeledContent("Workspaces", value: "\(viewer.workspaces.count)")
                    }
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        Task { await model.signOut() }
                    }
                } footer: {
                    Text("Polaris \(Bundle.main.shortVersion) (\(Bundle.main.buildNumber))")
                }
            }
            .navigationTitle("Settings")
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
