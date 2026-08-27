import Foundation
import Testing
@testable import PolarisCore

/// Contrast, computed rather than sampled.
///
/// XCUITest's `performAccessibilityAudit` has a contrast check, and on these screens it is not
/// trustworthy: it flags the welcome headline, which is pure white on a dark background at
/// 16.2:1, and the set of elements it objects to changes when the background gradient is
/// flattened. It appears unable to resolve an effective background through SwiftUI's
/// compositing of a gradient and a blurred shadow. Suppressing it and asserting nothing would
/// leave the palette unguarded, so the guard lives here instead, where the arithmetic is
/// exact and the failure names the pair.
///
/// This is sRGB relative luminance per WCAG 2.1, and the pairs are the ones that actually
/// appear on screen — three of them were genuinely failing when this was first written:
/// the primary CTA label at 4.47:1, placeholder text at 3.59:1, and the disabled CTA label
/// at 4.02:1.
@Suite("Palette contrast")
struct ContrastTests {
    private struct RGB { let r: Double, g: Double, b: Double }

    private func rgb(_ hex: UInt32) -> RGB {
        RGB(
            r: Double((hex >> 16) & 0xFF),
            g: Double((hex >> 8) & 0xFF),
            b: Double(hex & 0xFF)
        )
    }

    /// Straight alpha compositing, which is what the renderer does to a translucent colour.
    private func over(_ fg: RGB, _ alpha: Double, _ bg: RGB) -> RGB {
        RGB(
            r: alpha * fg.r + (1 - alpha) * bg.r,
            g: alpha * fg.g + (1 - alpha) * bg.g,
            b: alpha * fg.b + (1 - alpha) * bg.b
        )
    }

    private func luminance(_ c: RGB) -> Double {
        func channel(_ value: Double) -> Double {
            let s = value / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    private func ratio(_ a: RGB, _ b: RGB) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    // The tokens, as they are declared in Theme.swift.
    private var white: RGB { rgb(0xFFFFFF) }
    private var accent: RGB { rgb(0x5A5DE8) }
    private var accentBright: RGB { rgb(0x8B93FF) }
    private var danger: RGB { rgb(0xFF5C5C) }
    /// The gradient's lightest stop — the worst case for light text.
    private var pageLightest: RGB { rgb(0x1B2030) }
    private var pageMid: RGB { rgb(0x141822) }
    private var fieldFill: RGB { over(white, 0.08, pageMid) }

    /// 4.5:1 for normal text. Large text may use 3:1, but nothing here relies on that, so the
    /// stricter floor is applied everywhere rather than argued per label.
    private let floor = 4.5

    @Test("every text pair on the auth screens clears 4.5:1")
    func authScreens() {
        let pairs: [(String, RGB, RGB)] = [
            ("primary CTA label", white, accent),
            // The label stays full white; only the fill is dimmed. Fading the whole button
            // faded the label with it and measured 4.02:1 — which is what this line asserted
            // in its first draft, describing the bug rather than the fix.
            ("disabled CTA label", white, over(accent, 0.55, pageMid)),
            ("field text", white, fieldFill),
            ("placeholder", over(white, 0.55, fieldFill), fieldFill),
            ("error text", danger, pageMid),
            ("eyebrow", over(white, 0.48, pageLightest), pageLightest),
            ("secondary text", over(white, 0.62, pageLightest), pageLightest),
            ("accent eyebrow", accentBright, pageLightest),
            ("headline", white, pageLightest),
        ]
        for (name, fg, bg) in pairs {
            let measured = ratio(fg, bg)
            #expect(measured >= floor, "\(name) is \(String(format: "%.2f", measured)):1, under \(floor):1")
        }
    }

    @Test("the accent is dark enough to carry white label text")
    func accentCarriesWhite() {
        // #6366F1 measured 4.47:1 — under the floor by three hundredths, which is the band
        // Apple's audit reports as "Contrast nearly passed". Any future change to the accent
        // has to keep this true.
        #expect(ratio(white, accent) >= floor)
    }
}
