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
                    // Scrolls, with the footer pinned outside it. Without this the two CTAs
                    // land below the bottom edge at accessibility text sizes and cannot be
                    // reached at all — on the one screen whose entire job is to offer them.
                    GeometryReader { geo in
                        ScrollView {
                            VStack(spacing: 0) {
                                Spacer(minLength: 0)
                                heroContent
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, minHeight: geo.size.height)
                        }
                        .scrollIndicators(.hidden)
                        .scrollBounceBehavior(.basedOnSize)
                        // Overflowing content fades under the pinned footer rather than being
                        // cut off mid-letter. A hard edge reads as a layout bug; a fade reads
                        // as "there is more, keep scrolling".
                        .mask(
                            LinearGradient(
                                stops: [
                                    .init(color: .black, location: 0),
                                    .init(color: .black, location: max(0, 1 - 34 / max(geo.size.height, 1))),
                                    .init(color: .clear, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                    }

                    footer
                }
                // Auth screens are a column of text and two buttons; letting that run the full
                // width of an iPad gives a 1000pt-wide button with dead space around it.
                .frame(maxWidth: 460)
                .padding(.horizontal, Theme.Space.xxl)
                .padding(.bottom, Theme.Space.xxl)
            }
            .navigationDestination(item: $route) { destination in
                switch destination {
                case .signIn: SignInView()
                case .signUp: SignUpView()
                }
            }
        }
    }

    private var heroContent: some View {
        VStack(spacing: 0) {
            PolarisMark()

            Text("Polaris")
                .font(PolarisText.sectionTitle)
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, Theme.Space.xl)

            Text("The issue tracker that keeps up with your team")
                .font(PolarisText.screenTitle)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Theme.Space.sm)
                .padding(.horizontal, Theme.Space.sm)

            Text("Issues, projects and cycles, on the same API your team already uses on the web.")
                .font(PolarisText.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Theme.Space.md)

            if let error {
                InlineErrorLabel(text: error.displayMessage)
                    .padding(.top, Theme.Space.lg)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: Theme.Space.sm) {
            PrimaryButton(title: "Create an account") { route = .signUp }
            SecondaryButton(title: "I already have an account") { route = .signIn }
        }
        .padding(.top, Theme.Space.sm)
    }
}
