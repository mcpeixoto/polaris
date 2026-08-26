import SwiftUI
import PolarisCore

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.phase {
        case .launching:
            LoadingView(label: "Signing you in")
        case .signedOut(let error):
            SignInView(error: error)
        case .ready(let viewer):
            MainTabView(viewer: viewer)
        }
    }
}

struct MainTabView: View {
    let viewer: Viewer
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            MyIssuesView()
                .tabItem { SwiftUI.Label("My Issues", systemImage: "checklist") }
                .tag("issues")

            SettingsView(viewer: viewer)
                .tabItem { SwiftUI.Label("Settings", systemImage: "gearshape") }
                .tag("settings")
        }
        // This client holds no replica and opens no socket; coming back to the foreground is
        // the moment its data is most likely to be stale, so that is when it checks. The check
        // itself is one cheap query and refetches nothing unless the workspace actually moved.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await model.issues.refreshIfStale() }
        }
    }
}

struct SignInView: View {
    let error: PolarisError?
    @Environment(AppModel.self) private var model

    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                } footer: {
                    if let error {
                        Text(error.displayMessage)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        isSubmitting = true
                        Task {
                            await model.signIn(email: email, password: password)
                            isSubmitting = false
                        }
                    } label: {
                        HStack {
                            Text("Sign in")
                            if isSubmitting {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(!canSubmit)
                }
            }
            .navigationTitle("Polaris")
        }
    }
}
