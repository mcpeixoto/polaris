import SwiftUI

/// The frame every auth screen sits in.
///
/// The footer is deliberately OUTSIDE the scroll view. When the CTA lived inside, a large
/// Dynamic Type setting pushed it below the fold and the only way to submit the form was to
/// scroll to a button the reader had no reason to believe existed.
///
/// `minHeight: geo.size.height` keeps short content optically centred while still allowing
/// scroll once it outgrows the viewport.
struct AuthScaffold<Content: View, Footer: View>: View {
    let eyebrow: String
    let title: String
    let accent: String
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                GeometryReader { geo in
                    ScrollView {
                        VStack(spacing: 0) {
                            Spacer(minLength: 0)

                            MonoEyebrow(text: eyebrow, color: Theme.accentBright)
                                .staggerRise(0)

                            (
                                Text(title).foregroundStyle(Theme.textPrimary)
                                    + Text(accent).foregroundStyle(Theme.accentBright)
                            )
                            .displayFont(28, weight: .semibold)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 10)
                            .staggerRise(1)

                            content()
                                .padding(.top, 26)
                                .staggerRise(2)

                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: geo.size.height)
                    }
                    .scrollIndicators(.hidden)
                    .scrollBounceBehavior(.basedOnSize)
                    .scrollDismissesKeyboard(.interactively)
                }

                footer()
                    .padding(.top, 8)
                    .staggerRise(3)
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 24)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
    }
}
