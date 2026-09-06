import SwiftUI

/// The frame every auth screen sits in: a small caption, a plain headline, the form, and the
/// call to action pinned under it all.
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

                            Text(eyebrow)
                                .font(PolarisText.sectionTitle)
                                .foregroundStyle(Theme.textSecondary)

                            // One `Text` rather than two views, so the headline wraps as a
                            // single paragraph. The two halves are the same colour now; the
                            // accent word was the last of the editorial flourishes.
                            (Text(title) + Text(accent))
                                .font(PolarisText.screenTitle)
                                .foregroundStyle(Theme.textPrimary)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, Theme.Space.sm)

                            content()
                                .padding(.top, Theme.Space.xxl)

                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: geo.size.height)
                    }
                    .scrollIndicators(.hidden)
                    .scrollBounceBehavior(.basedOnSize)
                    .scrollDismissesKeyboard(.interactively)
                }

                footer()
                    .padding(.top, Theme.Space.sm)
            }
            .frame(maxWidth: 460)
            .padding(.horizontal, Theme.Space.xxl)
            .padding(.bottom, Theme.Space.xxl)
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}
