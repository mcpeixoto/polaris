import Foundation

/// The design tokens, as data.
///
/// This is the iOS half of `web/src/styles/tokens.css`, and it is in PolarisCore rather than
/// in the view layer for one reason: a colour that only exists as a `SwiftUI.Color` cannot be
/// measured. Contrast, and parity with the web client, are properties of the *numbers* — so
/// the numbers live where `swift test` can read them, and `Theme` in the app target does
/// nothing but hand them to SwiftUI.
///
/// The split mirrors the stylesheet exactly:
///
///   primitives — the raw ramps. Theme-independent.
///   semantics  — what a surface asks for (`bgPrimary`, `textSecondary`, `borderFocus`).
///                Every one is a reference to a primitive, never a fresh literal.
///
/// Views consume semantics only. A view that reaches for `Palette.neutral700` has baked in a
/// light-theme assumption; there is no way for it to be wrong if it asks for `textSecondary`.
public enum Palette {

    // MARK: - Primitives

    public static let white: UInt32 = 0xFFFFFF
    public static let black: UInt32 = 0x05070A

    public static let neutral50: UInt32 = 0xFAFBFC
    public static let neutral100: UInt32 = 0xEEF0F2
    public static let neutral200: UInt32 = 0xE1E4E9
    public static let neutral300: UInt32 = 0xC9CED6
    public static let neutral400: UInt32 = 0x9AA1AD
    public static let neutral500: UInt32 = 0x767D89
    /// An iOS-only stop, between 400 and 500.
    ///
    /// The web's `--text-tertiary` in dark is neutral-500, and on a *page* it is fine — 4.62:1.
    /// It is not fine on the raised surfaces this app draws tertiary text on: a placeholder
    /// inside a field, an eyebrow on a card. A placeholder is real text — WCAG exempts inactive
    /// controls, not the words inside an active one — and that failure is the one three
    /// separate accessibility audits of this app have caught.
    ///
    /// The value was picked against *solid* neutral-900, where it measured 4.86:1. No raised
    /// surface in this app is solid: `Theme.card`, `Theme.fieldFill` and `Theme.chipInactive`
    /// are `bgHover`, six percent of white composited over the page gradient, and
    /// `Theme.accentTint` is the accent at eighteen percent — both lighter than neutral-900,
    /// where the old `#838A96` measured 4.09:1 and 4.45:1. `CompositedSurfaceContrastTests`
    /// measures the surfaces as drawn; this stop clears 4.5:1 on the worst of them at 4.56:1,
    /// and is still a 1.18:1 step below `--text-secondary`.
    public static let neutral450: UInt32 = 0x8D949F
    public static let neutral600: UInt32 = 0x545A63
    public static let neutral700: UInt32 = 0x3C414A
    public static let neutral800: UInt32 = 0x282C33
    public static let neutral900: UInt32 = 0x1A1D22
    public static let neutral950: UInt32 = 0x0E1013

    public static let accent50: UInt32 = 0xEEF0FD
    public static let accent100: UInt32 = 0xDCE0FB
    public static let accent200: UInt32 = 0xBCC3F6
    public static let accent300: UInt32 = 0x97A1EF
    public static let accent400: UInt32 = 0x7A83E6
    public static let accent500: UInt32 = 0x5E6AD2
    public static let accent600: UInt32 = 0x4B56BA
    public static let accent700: UInt32 = 0x3C4599
    public static let accent800: UInt32 = 0x2E3577
    public static let accent900: UInt32 = 0x212650

    public static let blue400: UInt32 = 0x56B6D8
    public static let blue600: UInt32 = 0x21789B
    public static let amber400: UInt32 = 0xF2C94C
    public static let amber600: UInt32 = 0xB3862F
    public static let orange400: UInt32 = 0xFF9057
    public static let orange600: UInt32 = 0xE05A20
    public static let red400: UInt32 = 0xF26D70
    public static let red600: UInt32 = 0xCC3339

    // MARK: - Scheme

    public enum Scheme: Sendable, Hashable, CaseIterable {
        case light
        case dark
    }

    /// A token: a hex value and the opacity it is drawn at.
    ///
    /// Translucent washes are a token like any other, because the alternative — a view
    /// writing `Color.white.opacity(0.08)` — is exactly the literal this file exists to
    /// remove, and it is invisible to every check.
    public struct Token: Sendable, Hashable {
        public let hex: UInt32
        public let alpha: Double

        public init(_ hex: UInt32, alpha: Double = 1) {
            self.hex = hex
            self.alpha = alpha
        }
    }

    /// The semantic layer. One instance per scheme; nothing else in the app names a primitive.
    public struct Semantic: Sendable, Hashable {
        public let bgPrimary: Token
        public let bgSecondary: Token
        public let bgTertiary: Token
        public let bgElevated: Token
        public let bgHover: Token
        public let bgSelected: Token

        public let textPrimary: Token
        public let textSecondary: Token
        public let textTertiary: Token
        public let textDanger: Token
        public let textInverse: Token

        public let borderSubtle: Token
        public let borderDefault: Token
        public let borderStrong: Token
        public let borderFocus: Token

        public let accent: Token
        public let accentHover: Token
        public let accentText: Token
        public let accentContrast: Token
        public let accentSubtle: Token

        public let warn: Token
        public let danger: Token

        /// The three stops of the page gradient, lightest first.
        public let pageGradient: [Token]
    }

    public static let dark = Semantic(
        bgPrimary: Token(neutral950),
        bgSecondary: Token(neutral900),
        bgTertiary: Token(neutral800),
        bgElevated: Token(neutral900),
        bgHover: Token(white, alpha: 0.06),
        bgSelected: Token(white, alpha: 0.12),
        textPrimary: Token(neutral100),
        textSecondary: Token(neutral400),
        textTertiary: Token(neutral450),
        textDanger: Token(red400),
        textInverse: Token(neutral950),
        borderSubtle: Token(neutral800),
        borderDefault: Token(neutral700),
        borderStrong: Token(neutral600),
        borderFocus: Token(accent400),
        accent: Token(accent500),
        accentHover: Token(accent400),
        accentText: Token(accent400),
        accentContrast: Token(white),
        accentSubtle: Token(accent500, alpha: 0.18),
        warn: Token(amber400),
        danger: Token(red400),
        // Three stops rather than a flat fill, which is the clearest tell that a screen was
        // not designed. The ends are ramp stops and the middle is their midpoint, so the
        // gradient cannot drift away from the surfaces drawn on top of it.
        pageGradient: [Token(neutral900), Token(0x14161A), Token(neutral950)]
    )

    public static let light = Semantic(
        bgPrimary: Token(white),
        bgSecondary: Token(neutral50),
        bgTertiary: Token(neutral100),
        bgElevated: Token(white),
        bgHover: Token(black, alpha: 0.04),
        bgSelected: Token(black, alpha: 0.08),
        textPrimary: Token(neutral900),
        textSecondary: Token(neutral700),
        textTertiary: Token(neutral600),
        textDanger: Token(red600),
        textInverse: Token(neutral50),
        borderSubtle: Token(neutral200),
        borderDefault: Token(neutral300),
        borderStrong: Token(neutral400),
        borderFocus: Token(accent500),
        accent: Token(accent500),
        accentHover: Token(accent600),
        accentText: Token(accent600),
        accentContrast: Token(white),
        accentSubtle: Token(accent500, alpha: 0.12),
        warn: Token(amber600),
        danger: Token(red600),
        pageGradient: [Token(white), Token(neutral50), Token(neutral100)]
    )

    public static func semantic(_ scheme: Scheme) -> Semantic {
        switch scheme {
        case .light: light
        case .dark: dark
        }
    }

    // MARK: - Domain colour

    /// Priority and workflow state are the only two places in Polaris where hue carries
    /// meaning rather than decoration, and both clients must agree: two people looking at the
    /// same issue on a phone and a laptop must not see different colours for the same fact.
    public static func priority(_ priority: Priority, _ scheme: Scheme) -> Token {
        let dark = scheme == .dark
        return switch priority {
        case .urgent: Token(dark ? red400 : red600)
        case .high: Token(dark ? orange400 : orange600)
        case .medium: Token(dark ? amber400 : amber600)
        case .low: Token(dark ? blue400 : blue600)
        case .none: Token(neutral500)
        }
    }

    public static func state(_ category: StateCategory, _ scheme: Scheme) -> Token {
        let dark = scheme == .dark
        return switch category {
        case .triage: Token(dark ? orange400 : orange600)
        case .backlog: Token(dark ? neutral400 : neutral600)
        case .unstarted: Token(dark ? neutral300 : neutral700)
        case .started: Token(dark ? amber400 : amber600)
        case .completed: Token(dark ? accent400 : accent500)
        case .canceled, .duplicate: Token(neutral500)
        }
    }

    // MARK: - Contrast

    /// sRGB relative luminance, WCAG 2.1.
    ///
    /// Here rather than in the test suite because the app uses it: a workspace-configured
    /// state colour is arbitrary, and one chosen against a white web page can be unreadable
    /// on this background. `readable(_:on:)` is what clamps it.
    public static func luminance(_ hex: UInt32) -> Double {
        func channel(_ raw: UInt32) -> Double {
            let value = Double(raw) / 255
            return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel((hex >> 16) & 0xFF)
            + 0.7152 * channel((hex >> 8) & 0xFF)
            + 0.0722 * channel(hex & 0xFF)
    }

    public static func contrastRatio(_ a: UInt32, _ b: UInt32) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// Straight alpha compositing — what the renderer does to a translucent colour, and the
    /// only honest way to measure text drawn on a wash.
    public static func composite(_ foreground: Token, over background: UInt32) -> UInt32 {
        func blend(_ shift: UInt32) -> UInt32 {
            let fg = Double((foreground.hex >> shift) & 0xFF)
            let bg = Double((background >> shift) & 0xFF)
            return UInt32((foreground.alpha * fg + (1 - foreground.alpha) * bg).rounded())
        }
        return (blend(16) << 16) | (blend(8) << 8) | blend(0)
    }

    /// A workspace-configured hex, parsed, or nil if it is not one.
    ///
    /// Kept here rather than in `Theme` so a malformed value has one definition and one test,
    /// instead of a silent fallback inside a view helper.
    public static func parse(_ value: String?) -> UInt32? {
        guard var trimmed = value?.trimmingCharacters(in: .whitespaces), !trimmed.isEmpty else {
            return nil
        }
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let rgb = UInt32(trimmed, radix: 16) else { return nil }
        return rgb
    }

    /// The minimum a non-text graphic needs against its background, WCAG 1.4.11.
    public static let graphicContrastFloor = 3.0

    /// A workspace's chosen colour, or the category's, when the workspace's cannot be seen.
    ///
    /// A workspace may set a state to any hex it likes — including one picked against a white
    /// web page, which on this background is a status icon nobody can read. The category
    /// palette is the floor, not a decoration.
    public static func readableState(
        _ configured: String?,
        category: StateCategory,
        scheme: Scheme
    ) -> Token {
        let background = semantic(scheme).bgPrimary.hex
        guard let hex = parse(configured) else { return state(category, scheme) }
        guard contrastRatio(hex, background) >= graphicContrastFloor else {
            return state(category, scheme)
        }
        return Token(hex)
    }
}
