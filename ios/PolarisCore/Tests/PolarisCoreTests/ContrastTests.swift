import Foundation
import Testing
@testable import PolarisCore

/// Contrast on the surfaces the app actually composites, computed rather than sampled.
///
/// XCUITest's `performAccessibilityAudit` has a contrast check, and on these screens it is not
/// trustworthy: it flags the welcome headline, which is pure white on a dark background at
/// 16.2:1, and the set of elements it objects to changes when the background gradient is
/// flattened. It appears unable to resolve an effective background through SwiftUI's
/// compositing of a gradient and a blurred shadow. Suppressing it and asserting nothing would
/// leave the palette unguarded, so the guard lives here instead, where the arithmetic is
/// exact and the failure names the pair.
///
/// This file used to hold its own copy of the palette as hex literals, which is how it came to
/// assert 4.5:1 for `#5A5DE8` and `#1B2030` — colours the app stopped shipping when the tokens
/// were aligned with the web's. A duplicated palette measures whatever it was last edited to
/// contain. Every value here is now read from `Palette`, so a token change either keeps
/// clearing the floor or fails this suite.
///
/// `PaletteContrastTests` covers the solid roles — a text token on `bgPrimary`, `bgSecondary`,
/// `bgElevated`. This suite covers what those miss: **nothing in this app is drawn on a solid
/// background**. A card, a field and an inbox row are translucent washes over a three-stop page
/// gradient (`Theme.card`, `Theme.fieldFill` and `Theme.chipInactive` are all `bgHover`;
/// `Theme.accentTint` is `accentSubtle`), and a wash over the gradient's lightest stop is
/// several hundredths lighter than any solid surface the other suite measures. That gap is not
/// academic: the tertiary token, whose whole reason for existing is placeholder and eyebrow
/// text on raised surfaces, measured 4.86:1 on solid `neutral900` and 4.09:1 on the field fill
/// that is actually drawn.
@Suite("Composited surface contrast")
struct CompositedSurfaceContrastTests {

    /// 4.5:1 for normal text. Large text may use 3:1, but nothing here relies on that, so the
    /// stricter floor is applied everywhere rather than argued per label.
    private let textFloor = 4.5

    /// A surface as it is rendered: a token composited over the page stop beneath it.
    private struct Surface {
        let name: String
        let hex: UInt32
    }

    /// Every raised surface the app draws text on, over every stop of the page gradient.
    ///
    /// The gradient's stops are all worst cases for something — the lightest is the worst case
    /// for light text and the darkest for dark text — and a card can be anywhere on the page,
    /// so each stop is measured rather than the one a screenshot happened to be taken over.
    private func surfaces(_ scheme: Palette.Scheme) -> [Surface] {
        let semantic = Palette.semantic(scheme)
        return semantic.pageGradient.flatMap { stop -> [Surface] in
            let page = String(format: "%06X", stop.hex)
            return [
                Surface(name: "page \(page)", hex: stop.hex),
                // Theme.card / Theme.fieldFill / Theme.chipInactive.
                Surface(name: "card on \(page)", hex: Palette.composite(semantic.bgHover, over: stop.hex)),
                // Theme.accentTint — the unread inbox row, which carries a tertiary timestamp.
                Surface(name: "accent tint on \(page)", hex: Palette.composite(semantic.accentSubtle, over: stop.hex)),
            ]
        }
    }

    private func check(_ name: String, _ foreground: Palette.Token, on surface: Surface, floor: Double) {
        let composited = Palette.composite(foreground, over: surface.hex)
        let measured = Palette.contrastRatio(composited, surface.hex)
        #expect(
            measured >= floor,
            "\(name) on \(surface.name) is \(String(format: "%.2f", measured)):1, under \(String(format: "%.1f", floor)):1"
        )
    }

    @Test("every text role clears 4.5:1 on every raised surface, in both schemes")
    func textOnRaisedSurfaces() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            for surface in surfaces(scheme) {
                check("primary text", semantic.textPrimary, on: surface, floor: textFloor)
                check("secondary text", semantic.textSecondary, on: surface, floor: textFloor)
                // Placeholders and eyebrows are real text, whatever their role name says. WCAG
                // exempts inactive *controls*, not the words inside an active one.
                check("tertiary text", semantic.textTertiary, on: surface, floor: textFloor)
            }
        }
    }

    /// The accent's whole job on a raised surface is the primary CTA's label.
    @Test("the CTA label clears 4.5:1 on the accent fill, in both schemes")
    func ctaLabel() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            check(
                "CTA label",
                semantic.accentContrast,
                on: Surface(name: "the accent fill", hex: semantic.accent.hex),
                floor: textFloor
            )
        }
    }

    /// `Theme.accentBright` on a card is an icon or a tint — the unread inbox glyph, a
    /// progress spinner, the avatar's initials ring — not body text, so WCAG 1.4.11's 3:1 for
    /// non-text graphics is the floor that applies. It is worth asserting because it is
    /// genuinely close: 4.21:1 on a card over the dark gradient's lightest stop. A future
    /// accent that is one ramp stop darker would take it under 3:1 without touching any test
    /// that measures the accent on a page.
    @Test("the accent stays visible as a glyph on every raised surface")
    func accentAsGraphic() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            for surface in surfaces(scheme) {
                check("accent glyph", semantic.accentText, on: surface, floor: Palette.graphicContrastFloor)
            }
        }
    }

    /// Borders are what separate a wash from the page it is drawn on. `borderDefault` is a
    /// hairline rather than a control boundary, so 3:1 is the right floor; the point is that a
    /// card whose fill is six percent of white does not become invisible when its outline is
    /// also dropped a step.
    @Test("a card's outline stays visible against the page beneath it")
    func cardOutline() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            for stop in semantic.pageGradient {
                let page = Surface(name: "page \(String(format: "%06X", stop.hex))", hex: stop.hex)
                check("focus ring", semantic.borderFocus, on: page, floor: Palette.graphicContrastFloor)
            }
        }
    }

    // Two pairs are deliberately not asserted here, because both need a design decision rather
    // than a token nudge, and asserting them at a floor they happen to clear would be a test
    // that describes the bug:
    //
    //   * The disabled primary CTA in light. `PrimaryButton` dims its fill to `accent * 0.55`
    //     and keeps the label at full `accentContrast`, which over the light page composites to
    //     2.16:1 — in dark the same rule measures 8.61:1, because dimming toward a near-black
    //     page darkens the fill instead of washing it out. WCAG 1.4.3 exempts inactive
    //     controls, so this is not a conformance failure, but "Sign in" is invisible while it
    //     is disabled, which is exactly when a user is looking for it.
    //
    //   * `Theme.warn` as text in light. `warn` is `amber600`, a graphic-grade hue: the
    //     "Snoozed" label in the inbox measures 3.06:1 on the white stop and 2.66:1 on a card
    //     over the lightest one. The web has the same value, so a fix is a token both clients
    //     have to take.
}
