import SwiftUI
import PolarisCore

/// Privacy Policy and Terms of Use, as Settings rows.
///
/// Guideline 5.1.1 wants the privacy policy inside the app, not only in App Store Connect.
/// 3.1.2 wants both links on the subscription screen as well; Cloud Pro reuses these rows.
struct LegalLinkRows: View {
    var body: some View {
        outbound("Privacy Policy", url: LegalLinks.privacyPolicy, id: "legal.privacy")
        outbound("Terms of Use", url: LegalLinks.termsOfUse, id: "legal.terms")
    }

    private func outbound(_ title: String, url: URL, id: String) -> some View {
        Link(destination: url) {
            HStack {
                Text(title)
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier(id)
    }
}

/// Compact pair of links for auth screens, where a full Settings section would not fit.
struct LegalLinkCaption: View {
    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            Link("Privacy Policy", destination: LegalLinks.privacyPolicy)
                .accessibilityIdentifier("legal.privacy")
            Text("·")
                .foregroundStyle(Theme.textTertiary)
            Link("Terms of Use", destination: LegalLinks.termsOfUse)
                .accessibilityIdentifier("legal.terms")
        }
        .font(PolarisText.caption)
        .foregroundStyle(Theme.textSecondary)
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.Space.xs)
    }
}
