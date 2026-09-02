import SwiftUI
import UIKit
import PolarisCore

extension Color {
    /// Tokens are written as `0x5E6AD2`, not `"#5E6AD2"` — a hex literal is checked by the
    /// compiler, a string is checked by nobody.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    init(_ token: Palette.Token) {
        self.init(hex: token.hex, opacity: token.alpha)
    }

    /// A colour that resolves itself against whatever appearance it is drawn in.
    ///
    /// This is the mechanism the whole theme rests on: one `Color` that asks the trait
    /// collection which scheme it is in and looks the answer up in `Palette`. Without it,
    /// light mode means a second copy of every declaration in this file — which is precisely
    /// why the app was pinned to dark before.
    static func adaptive(_ resolve: @escaping @Sendable (Palette.Scheme) -> Palette.Token) -> Color {
        Color(uiColor: UIColor { traits in
            let token = resolve(traits.userInterfaceStyle == .dark ? .dark : .light)
            return UIColor(
                red: CGFloat((token.hex >> 16) & 0xFF) / 255,
                green: CGFloat((token.hex >> 8) & 0xFF) / 255,
                blue: CGFloat(token.hex & 0xFF) / 255,
                alpha: token.alpha
            )
        })
    }

    static func semantic(_ path: @escaping @Sendable (Palette.Semantic) -> Palette.Token) -> Color {
        adaptive { path(Palette.semantic($0)) }
    }
}

/// Colour, motion, spacing and type for the whole app.
///
/// Every value here is a reference into `PolarisCore.Palette`, which is the iOS half of
/// `web/src/styles/tokens.css`. Nothing in this file invents a colour, and nothing outside it
/// names one: a view that writes `Color.white.opacity(0.08)` has baked in a dark-theme
/// assumption and will be wrong the moment the appearance changes.
///
/// The app follows the system appearance. It was pinned to `.preferredColorScheme(.dark)`
/// before, which had two costs: the two clients disagreed about what Polaris looks like — the
/// web app ships light, dark and system — and the launch screen, whose light appearance was
/// pure white, flashed white before snapping to a near-black app on every cold start for
/// anybody whose phone is in Light mode.
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

    static let accent = Color.semantic(\.accent)
    /// The accent as *text* on an ordinary surface. The fill value cannot carry small text on
    /// a dark background, which is the distinction `--accent-text` draws in the stylesheet.
    static let accentBright = Color.semantic(\.accentText)
    static let accentDark = Color.semantic(\.accentHover)
    static let accentTint = Color.semantic(\.accentSubtle)
    /// What white-on-accent is: the label colour for the primary CTA.
    static let accentContrast = Color.semantic(\.accentContrast)

    /// The page. Named `darkBase` historically; it is whichever base the appearance calls for.
    static let darkBase = Color.semantic(\.bgPrimary)
    static let surface = Color.semantic(\.bgSecondary)
    /// The card fill. A wash rather than a solid, so it composites over the page gradient.
    static let card = Color.semantic(\.bgHover)
    static let border = Color.semantic(\.borderDefault)
    static let hairline = Color.semantic(\.borderSubtle)
    static let chipInactive = Color.semantic(\.bgHover)
    static let trackBg = Color.semantic(\.bgSelected)

    static let textPrimary = Color.semantic(\.textPrimary)
    static let textSecondary = Color.semantic(\.textSecondary)
    static let eyebrowText = Color.semantic(\.textTertiary)

    /// Placeholder text inside a field. `textTertiary` measures 4.62:1 on the dark page and
    /// far more on the light one — a placeholder is real text, and WCAG exempts inactive
    /// *controls*, not the words inside an active one.
    static let placeholder = Color.semantic(\.textTertiary)
    /// The fill of a text field.
    static let fieldFill = Color.semantic(\.bgHover)
    static let fieldStroke = Color.semantic(\.borderDefault)

    static let warn = Color.semantic(\.warn)
    static let danger = Color.semantic(\.danger)
    /// Kept as the medium-priority hue, which is what it was used for.
    static let gold = Color.adaptive { Palette.priority(.medium, $0) }

    /// Three stops, origin off-centre near the top. A flat fill is the single clearest tell
    /// that a screen was not designed.
    static var background: RadialGradient {
        RadialGradient(
            colors: (0..<3).map { index in
                Color.adaptive { Palette.semantic($0).pageGradient[index] }
            },
            center: UnitPoint(x: 0.5, y: 0.0),
            startRadius: 0,
            endRadius: 900
        )
    }

    // MARK: - Metrics

    /// Apple's minimum. Small text links look right at 12pt and are unusable at 12pt; the
    /// `hitTarget()` modifier separates what is drawn from what answers a tap.
    static let minimumHitTarget: CGFloat = 44

    /// The 4pt ladder from `tokens.css`, so a padding is a choice from a scale rather than
    /// whatever number looked right in the moment. Every inset in the app was a literal
    /// before this — 3, 6, 8, 10, 11, 12, 14, 16, 18, 20, 22, 26, 28, 30, 32.
    enum Space {
        static let xxs: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let xxxl: CGFloat = 32
    }

    /// Four radii, not one per component. Larger than the web's ladder on purpose: a phone
    /// row is a touch target with a lot of air around it, and 3pt corners on a 64pt row read
    /// as a rendering artefact rather than a choice.
    enum Radius {
        static let sm: CGFloat = 8
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let full: CGFloat = 999
    }

    /// The width a reading column is allowed to reach.
    ///
    /// On a 1024pt iPad an unconstrained issue row is a 984pt-wide card holding a
    /// 40-character title. The auth screens already capped themselves at 460; this is the
    /// same cap, named, for everything else that is a single column.
    static let readableWidth: CGFloat = 620

    // MARK: - Domain colour

    static func priority(_ priority: Priority) -> Color {
        .adaptive { Palette.priority(priority, $0) }
    }

    static func state(_ category: StateCategory) -> Color {
        .adaptive { Palette.state(category, $0) }
    }

    /// The workspace's colour for a state, clamped to something that can actually be seen.
    ///
    /// A workspace may set a state to any hex it likes, including one chosen against a white
    /// web page. `StateIcon` used to render that value unconditionally, so a badly-configured
    /// workspace produced status icons nobody could read and the category palette — which
    /// exists for exactly this — was never consulted.
    static func stateColor(_ state: WorkflowState) -> Color {
        .adaptive { Palette.readableState(state.color, category: state.category, scheme: $0) }
    }

    /// Workspace-defined colours arrive as `#rrggbb`. A malformed value falls back to the
    /// accent rather than to black, which would read as a deliberate choice.
    static func hex(_ value: String?) -> Color {
        guard let parsed = Palette.parse(value) else { return accent }
        return Color(hex: parsed)
    }
}

/// The type scale.
///
/// System faces with a serif display variant rather than bundled custom fonts. A custom font
/// with a wrong PostScript name renders as San Francisco with no error at all, and shipping
/// that trap for a v1 buys nothing here.
///
/// Anchored to text styles — `.system(.body, design:)` — rather than to point sizes, and this
/// cost something worth naming. The scale these screens were designed against uses exact
/// half-point sizes (12.5, 13.5, 14.5), and two earlier attempts to keep them both failed the
/// accessibility audit: multiplying a fixed size by a `@ScaledMetric` factor reports as
/// "Dynamic Type font sizes are partially unsupported", and wrapping a `UIFontMetrics`-scaled
/// `UIFont` reports as "unsupported" outright, because SwiftUI receives a font whose size was
/// already resolved and cannot mark it relative to anything.
///
/// Only a text style is a font the system understands as scalable. So the vocabulary is the
/// ten styles that exist, named for what they are used for — `PolarisText` below. The
/// half-point call sites that preceded this were a fiction: `13.5` and `14.5` both landed on
/// `.subheadline` and rendered identically while the code claimed they differed.
enum TypeScale {
    /// The nearest text style to a designed point size. Kept because the auth screens and the
    /// design-system primitives are written against sizes, and re-deriving every one of them
    /// is a separate change from the one this file is making.
    static func style(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case ..<11.5: .caption2
        case ..<12.5: .caption
        case ..<13.5: .footnote
        case ..<15: .subheadline
        case ..<16.5: .callout
        case ..<19: .body
        case ..<22: .title3
        case ..<27: .title2
        case ..<33: .title
        default: .largeTitle
        }
    }
}

/// The named roles, which is what call sites should reach for.
///
/// One name per rendered size, so two call sites that read differently cannot render
/// identically — the failure the point-size vocabulary had.
enum PolarisText {
    /// A screen title. Serif, because it is the one thing that stops a SwiftUI app looking
    /// like the Settings app.
    static let screenTitle = Font.system(.title, design: .serif).weight(.bold)
    static let sectionTitle = Font.system(.title3, design: .serif).weight(.semibold)
    static let rowTitle = Font.system(.subheadline).weight(.medium)
    static let body = Font.system(.body)
    static let rowMeta = Font.system(.caption, design: .monospaced).weight(.medium)
    static let label = Font.system(.subheadline)
    static let caption = Font.system(.footnote)
}

extension View {
    /// Headlines and screen titles.
    func displayFont(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        font(.system(TypeScale.style(for: size), design: .serif).weight(weight))
    }

    func bodyFont(_ size: CGFloat, weight: Font.Weight = .regular) -> some View {
        font(.system(TypeScale.style(for: size), design: .default).weight(weight))
    }

    /// Eyebrows, identifiers, keyboard hints — anything that should read as machine text.
    func monoFont(_ size: CGFloat = 11, weight: Font.Weight = .medium) -> some View {
        font(.system(TypeScale.style(for: size), design: .monospaced).weight(weight))
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

    /// Caps a single column at a readable width and centres it.
    ///
    /// Applied to the content of every screen that is a list or a form, so an iPad in
    /// landscape is a readable column rather than a 1000pt-wide row.
    func readableColumn(_ width: CGFloat = Theme.readableWidth) -> some View {
        frame(maxWidth: width).frame(maxWidth: .infinity)
    }
}
