import SwiftUI
import PolarisCore

/// The first screen anybody sees.
///
/// It exists because the app used to open on a bare email/password `Form`, which tells a new
/// arrival nothing about what they have opened and offers no way to create an account — on a
/// fresh server, a locked door with no key.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    @State private var route: Route?

    private enum Route: Hashable { case signIn, signUp }

    let error: PolarisError?

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    Spacer(minLength: 0)

                    PolarisMark()
                        .staggerRise(0)

                    MonoEyebrow(text: "Polaris", color: Theme.accentBright)
                        .padding(.top, 28)
                        .staggerRise(1)

                    // Two-tone headline: the roman lead-in carries the sentence, the serif
                    // italic run carries the name. One `Text` concatenation rather than two
                    // views, so it wraps as a single paragraph.
                    (
                        Text("The issue tracker that keeps up with ")
                            .foregroundStyle(Theme.textPrimary)
                            + Text("your team")
                            .foregroundStyle(Theme.accentBright)
                    )
                    .displayFont(30, weight: .semibold)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                    .padding(.horizontal, 8)
                    .staggerRise(2)

                    Text("Issues, projects and cycles, on the same API your team already uses on the web.")
                        .bodyFont(14)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 14)
                        .staggerRise(3)

                    if let error {
                        InlineErrorLabel(text: error.displayMessage)
                            .padding(.top, 18)
                    }

                    Spacer(minLength: 0)

                    VStack(spacing: 12) {
                        PrimaryButton(title: "Create an account") { route = .signUp }
                        Button { route = .signIn } label: {
                            Text("I already have an account")
                                .bodyFont(13, weight: .semibold)
                                .foregroundStyle(Theme.textSecondary)
                                .hitTarget(minWidth: 0)
                        }
                        .buttonStyle(.plain)
                    }
                    .staggerRise(4)
                }
                .padding(.horizontal, 26)
                .padding(.bottom, 24)
            }
            .navigationDestination(item: $route) { destination in
                switch destination {
                case .signIn: SignInView()
                case .signUp: SignUpView()
                }
            }
        }
    }
}
