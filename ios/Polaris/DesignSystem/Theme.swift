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
/// The look is the web client's after its Linear parity pass: a flat page, hairline
/// separators, small radii, the system face at 13–15pt, and no decoration that is not a
/// fact about the data. The serif display face, the radial page gradient and the glow under
/// the primary button all went at the same time, for the same reason — none of them
/// survives next to a dense list, and the list is what the app is.
enum Theme {

    // MARK: - Motion

    /// The signature easing — cubic-bezier(0.22, 1, 0.36, 1), CSS easeOutQuint.
    ///
    /// Nearly every deliberate animation goes through this one curve, so motion reads as one
    /// product rather than as a pile of independently-tuned effects. The duration ladder is
    /// the convention: 0.12 press, 0.25 toggle, 0.3 selection, 0.4 step advance.
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
    /// One step up from the page: a grouped section, a sheet's field, a comment composer.
    static let surface = Color.semantic(\.bgSecondary)
    /// Two steps up: a group heading's tint, a pill's fill, a pressed chip.
    static let raised = Color.semantic(\.bgTertiary)
    /// The card fill. A wash, so it composites over whichever surface it lands on.
    static let card = Color.semantic(\.bgHover)
    static let border = Color.semantic(\.borderDefault)
    static let hairline = Color.semantic(\.borderSubtle)
    static let chipInactive = Color.semantic(\.bgHover)
    static let trackBg = Color.semantic(\.bgSelected)

    static let textPrimary = Color.semantic(\.textPrimary)
    static let textSecondary = Color.semantic(\.textSecondary)
    /// The quietest text: counts, timestamps, captions over a section.
    static let eyebrowText = Color.semantic(\.textTertiary)
    static let textTertiary = Color.semantic(\.textTertiary)

    /// Placeholder text inside a field. `textTertiary` measures 4.62:1 on the dark page and
    /// far more on the light one — a placeholder is real text, and WCAG exempts inactive
    /// *controls*, not the words inside an active one.
    static let placeholder = Color.semantic(\.textTertiary)
    /// The fill of a text field.
    static let fieldFill = Color.semantic(\.bgSecondary)
    static let fieldStroke = Color.semantic(\.borderSubtle)

    static let warn = Color.semantic(\.warn)
    static let danger = Color.semantic(\.danger)
    /// Kept as the medium-priority hue, which is what it was used for.
    static let gold = Color.adaptive { Palette.priority(.medium, $0) }

    /// The page, flat. It was a three-stop radial gradient; a list of hairline-separated rows
    /// over a gradient reads as rows of slightly different colours, and the web client
    /// dropped its own gradient for the same reason.
    static var background: Color { darkBase }

    // MARK: - Metrics

    /// Apple's minimum. Small text links look right at 12pt and are unusable at 12pt; the
    /// `hitTarget()` modifier separates what is drawn from what answers a tap.
    static let minimumHitTarget: CGFloat = 44

    /// The 4pt ladder from `tokens.css`, so a padding is a choice from a scale rather than
    /// whatever number looked right in the moment.
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

    /// The web's radius ladder, one point wider at each stop because a phone is held closer
    /// than a laptop. Small on purpose: a 44pt row with a 14pt corner reads as a card, and a
    /// screen full of cards is not a list anyone can scan.
    enum Radius {
        static let sm: CGFloat = 4
        static let md: CGFloat = 6
        static let lg: CGFloat = 8
        static let xl: CGFloat = 12
        static let full: CGFloat = 999
    }

    /// The width a reading column is allowed to reach.
    ///
    /// On a 1024pt iPad an unconstrained issue row is a 984pt-wide row holding a
    /// 40-character title. The auth screens already capped themselves at 460; this is the
    /// same cap, named, for everything else that is a single column.
    static let readableWidth: CGFloat = 620

    /// A list row. The web's `--row-height`; taller than Linear's desktop 32pt because a
    /// finger is not a pointer.
    static let rowHeight: CGFloat = 44

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
/// The system face only — SF Pro, which is what Linear's own app is set in. Anchored to text
/// styles rather than to point sizes, and this cost something worth naming: the scale these
/// screens were designed against uses exact half-point sizes (12.5, 13.5, 14.5), and two
/// earlier attempts to keep them both failed the accessibility audit — multiplying a fixed
/// size by a `@ScaledMetric` factor reports as "Dynamic Type font sizes are partially
/// unsupported", and wrapping a `UIFontMetrics`-scaled `UIFont` reports as "unsupported"
/// outright, because SwiftUI receives a font whose size was already resolved and cannot mark
/// it relative to anything.
///
/// Only a text style is a font the system understands as scalable. So the vocabulary is the
/// ten styles that exist, named for what they are used for — `PolarisText` below.
enum TypeScale {
    /// The nearest text style to a designed point size. Kept because the auth screens are
    /// written against sizes, and re-deriving every one of them is a separate change.
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
    /// A screen title, where one is drawn in content rather than in the navigation bar.
    static let screenTitle = Font.system(.title2).weight(.semibold)
    /// The issue's own title on the detail screen: large, but not a headline.
    static let issueTitle = Font.system(.title3).weight(.semibold)
    /// A small heading over a group of things: "Properties", "Comments", a settings section.
    static let sectionTitle = Font.system(.footnote).weight(.medium)
    /// The one line a list row gets. 15pt medium, which is `--font-size-lg` on the web.
    static let rowTitle = Font.system(.subheadline).weight(.medium)
    static let body = Font.system(.subheadline)
    /// Identifiers, counts, dates — read, not compared character by character, so the sans
    /// face with tabular digits rather than a monospace.
    static let rowMeta = Font.system(.footnote).monospacedDigit()
    static let label = Font.system(.subheadline)
    static let caption = Font.system(.footnote)
    static let captionSmall = Font.system(.caption)
}

extension View {
    /// Headlines and screen titles. System face; the serif variant this once selected is
    /// gone with the rest of the editorial styling.
    func displayFont(_ size: CGFloat, weight: Font.Weight = .semibold) -> some View {
        font(.system(TypeScale.style(for: size), design: .default).weight(weight))
    }

    func bodyFont(_ size: CGFloat, weight: Font.Weight = .regular) -> some View {
        font(.system(TypeScale.style(for: size), design: .default).weight(weight))
    }

    /// Keyboard hints and anything that genuinely is machine text. Identifiers are not —
    /// they use `PolarisText.rowMeta`.
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
