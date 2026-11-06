import SwiftUI
import PolarisCore

/// "Share anonymous usage stats" — the one switch for `Metrics`, on by default.
///
/// The same view in Settings and on the first connect screen, so the person sees exactly what
/// they agreed to before the first ping can go out. Turning it off forgets the metrics id and
/// any counts still waiting, at once rather than at the next foreground.
struct UsageStatsToggle: View {
    @AppStorage(Metrics.Keys.share) private var share = true

    var body: some View {
        Toggle(isOn: $share) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Share anonymous usage stats")
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textPrimary)
                Text("Once a day: the app version, your country, and how many issues and comments you created. Never what they say.")
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(Theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Theme.accent)
        .onChange(of: share) { _, on in
            if !on { Metrics.forget() }
        }
        .accessibilityIdentifier("settings.shareUsage")
    }
}
