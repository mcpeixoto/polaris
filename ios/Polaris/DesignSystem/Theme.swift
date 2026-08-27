import SwiftUI
import PolarisCore

extension Color {
    /// Tokens are written as `0x6366F1`, not `"#6366F1"` — a hex literal is checked by the
    /// compiler, a string is checked by nobody.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Colour, motion and metrics for the whole app.
///
/// Dark-first and deliberately not theme-switching. Polaris is a night-sky name and the web
/// client is dark by default; supporting two palettes would double every surface for a v1
/// that has one. `.preferredColorScheme(.dark)` is pinned at the root so the system cannot
/// hand us a light background under white text.
enum Theme {

    // MARK: - Motion

    /// The signature easing — cubic-bezier(0.22, 1, 0.36, 1), CSS easeOutQuint.
    ///
    /// Nearly every deliberate animation goes through this one curve, so motion reads as one
    /// product rather than as a pile of independently-tuned effects. The duration ladder is
    /// the convention: 0.12 press, 0.25 toggle, 0.3 selection, 0.4 step advance, 0.5 entrance.
    static let easing = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.5)
    static func easing(_ duration: Double) -> Animation {
        .timingCurve(0.22, 1, 0.36, 1, duration: duration)
    }

    // MARK: - Colour

    /// Indigo — the north star.
    ///
    /// Darkened from #6366F1, which put white label text at **4.47:1** — under the 4.5:1
    /// floor by three hundredths, which is exactly the band Apple's audit reports as
    /// "Contrast nearly passed". This value is 5.04:1 and keeps the hue.
    ///
    /// The measurement that matters is white ON this colour, because that is the primary CTA
    /// on every screen. Anything reading this as a *background* is a separate calculation.
    static let accent = Color(hex: 0x5A5DE8)
    static let accentBright = Color(hex: 0x8B93FF)    // on dark, for small text and dots
    static let accentDark = Color(hex: 0x4F46E5)      // pressed
    static let accentTint = Color(hex: 0x6366F1).opacity(0.16)

    static let darkBase = Color(hex: 0x0E1116)
    static let card = Color.white.opacity(0.05)
    static let border = Color.white.opacity(0.12)
    static let hairline = Color.white.opacity(0.08)
    static let chipInactive = Color.white.opacity(0.07)
    static let trackBg = Color.white.opacity(0.14)

    static let textPrimary = Color.white
    /// Stops at 0.62 deliberately. Below roughly 0.55 on this background, body text drops
    /// under the 4.5:1 contrast floor — the same failure the web client's dark theme has.
    static let textSecondary = Color.white.opacity(0.62)
    static let eyebrowText = Color.white.opacity(0.48)

    /// Placeholder text inside a field.
    ///
    /// 0.55, not the 0.40 this started at: over the field's own fill that measured **3.59:1**,
    /// under the 4.5:1 floor. A placeholder is real text — WCAG exempts inactive *controls*,
    /// not the words inside an active one — and it appeared on every field of every auth
    /// screen, which is why three separate audits failed on it. This measures 5.42:1.
    static let placeholder = Color.white.opacity(0.55)

    static let warn = Color(hex: 0xF5A623)
    static let danger = Color(hex: 0xFF5C5C)
    static let gold = Color(hex: 0xF6D68B)

    /// Three stops, origin off-centre near the top. A flat fill is the single clearest tell
    /// that a screen was not designed.
    static var background: RadialGradient {
        RadialGradient(
            colors: [Color(hex: 0x1B2030), Color(hex: 0x141822), Color(hex: 0x0E1116)],
            center: UnitPoint(x: 0.5, y: 0.0),
            startRadius: 0,
            endRadius: 900
        )
    }

    // MARK: - Metrics

    /// Apple's minimum. Small text links look right at 12pt and are unusable at 12pt; the
    /// `hitTarget()` modifier separates what is drawn from what answers a tap.
    static let minimumHitTarget: CGFloat = 44

    // MARK: - Domain colour

    static func priority(_ priority: Priority) -> Color {
        switch priority {
        case .urgent: danger
        case .high: warn
        case .medium: gold
        case .low: accentBright
        case .none: Color.white.opacity(0.3)
        }
    }

    static func state(_ category: StateCategory) -> Color {
        switch category {
        case .triage: Color(hex: 0xA78BFA)
        case .backlog: Color.white.opacity(0.35)
        case .unstarted: Color.white.opacity(0.55)
        case .started: warn
        case .completed: Color(hex: 0x3FB950)
        case .canceled, .duplicate: Color.white.opacity(0.3)
        }
    }

    /// Workspace-defined colours arrive as `#rrggbb`. A malformed value falls back to the
    /// accent rather than to black, which would read as a deliberate choice.
    static func hex(_ value: String?) -> Color {
        guard let value else { return accent }
        var trimmed = value.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let rgb = UInt32(trimmed, radix: 16) else { return accent }
        return Color(hex: rgb)
    }
}

/// The type scale, as view modifiers rather than `Font` values.
///
/// System faces with a serif display variant rather than bundled custom fonts. A custom font
/// with a wrong PostScript name renders as San Francisco with no error at all, and shipping
/// that trap for a v1 buys nothing here — `.serif` gives the display sizes their editorial
/// voice without a font file to get wrong.
///
/// These are modifiers because `Font.system(size:)` is a *fixed* size: it does not grow with
/// the reader's Dynamic Type setting, and only `Font.custom(_:size:relativeTo:)` takes an
/// anchor. Multiplying by a `@ScaledMetric` factor is what puts the scaling back, and it keeps
/// the exact half-point sizes the scale is built on (12.5, 13.5, 14.5) instead of rounding
/// them to the nearest text style.
private struct ScaledFont: ViewModifier {
    /// A metric whose base value is 1 resolves to the reader's current scale factor.
    @ScaledMetric(relativeTo: .body) private var factor: CGFloat = 1

    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design

    func body(content: Content) -> some View {
        content.font(.system(size: size * factor, weight: weight, design: design))
    }
}

extension View {
    /// Headlines and screen titles. Serif, because it is the one thing that stops a SwiftUI
    /// app looking like the Settings app.
    func displayFont(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: .serif))
    }

    func bodyFont(_ size: CGFloat, weight: Font.Weight = .regular) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: .default))
    }

    /// Eyebrows, identifiers, keyboard hints — anything that should read as machine text.
    func monoFont(_ size: CGFloat = 11, weight: Font.Weight = .medium) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: .monospaced))
    }
}

extension View {
    /// Grow the region that answers a tap to at least 44pt without growing what is drawn.
    func hitTarget(
        minWidth: CGFloat = Theme.minimumHitTarget,
        minHeight: CGFloat = Theme.minimumHitTarget
    ) -> some View {
        frame(minWidth: minWidth, minHeight: minHeight).contentShape(Rectangle())
    }
}
