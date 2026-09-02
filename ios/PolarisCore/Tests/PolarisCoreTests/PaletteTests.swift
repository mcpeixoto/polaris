import Foundation
import Testing
@testable import PolarisCore

/// Parity with the web client, and contrast, computed rather than eyeballed.
///
/// The two clients had drifted a long way: the accent was `#5A5DE8` against the web's
/// `#5e6ad2`, priority high and medium were a whole hue-step apart, `low` was the accent on
/// iOS and blue on the web, and `completed` was green on one and indigo on the other. Two
/// people looking at the same issue on a phone and a laptop saw different colours for the
/// same fact.
///
/// The web values are checked in here as literals on purpose. Reading `tokens.css` at test
/// time would make this test pass whenever the two files agreed *and* whenever both were
/// wrong; a second copy is what makes a one-sided change fail.
@Suite("Palette parity with the web client")
struct PaletteParityTests {
    /// From web/src/styles/tokens.css, the primitives section.
    private enum Web {
        static let neutral100: UInt32 = 0xEEF0F2
        static let neutral400: UInt32 = 0x9AA1AD
        static let neutral500: UInt32 = 0x767D89
        static let neutral950: UInt32 = 0x0E1013
        static let accent400: UInt32 = 0x7A83E6
        static let accent500: UInt32 = 0x5E6AD2
        static let accent600: UInt32 = 0x4B56BA
        static let blue400: UInt32 = 0x56B6D8
        static let amber400: UInt32 = 0xF2C94C
        static let orange400: UInt32 = 0xFF9057
        static let red400: UInt32 = 0xF26D70
    }

    @Test("the brand accent is the web's accent-500")
    func accentMatches() {
        #expect(Palette.accent500 == Web.accent500)
        #expect(Palette.dark.accent.hex == Web.accent500)
        #expect(Palette.light.accent.hex == Web.accent500)
    }

    @Test("every priority hue matches the web's dark theme")
    func priorityMatches() {
        #expect(Palette.priority(.urgent, .dark).hex == Web.red400)
        #expect(Palette.priority(.high, .dark).hex == Web.orange400)
        #expect(Palette.priority(.medium, .dark).hex == Web.amber400)
        #expect(Palette.priority(.low, .dark).hex == Web.blue400)
        #expect(Palette.priority(.none, .dark).hex == Web.neutral500)
    }

    @Test("every state hue matches the web's dark theme")
    func stateMatches() {
        #expect(Palette.state(.triage, .dark).hex == Web.orange400)
        #expect(Palette.state(.backlog, .dark).hex == Web.neutral400)
        #expect(Palette.state(.started, .dark).hex == Web.amber400)
        // Indigo, not green. The web treats a completed issue as accent-coloured, and the two
        // clients disagreeing about the colour of "done" is the worst place to disagree.
        #expect(Palette.state(.completed, .dark).hex == Web.accent400)
        #expect(Palette.state(.canceled, .dark).hex == Web.neutral500)
    }

    @Test("the semantic layer references the ramp the web references")
    func semanticsMatch() {
        #expect(Palette.dark.bgPrimary.hex == Web.neutral950)
        #expect(Palette.dark.textPrimary.hex == Web.neutral100)
        #expect(Palette.dark.textSecondary.hex == Web.neutral400)
        #expect(Palette.dark.accentText.hex == Web.accent400)
        #expect(Palette.light.accentText.hex == Web.accent600)
    }
}

@Suite("Palette contrast")
struct PaletteContrastTests {
    /// 4.5:1 for normal text. Large text may use 3:1, but nothing here relies on that, so the
    /// stricter floor is applied everywhere rather than argued per label.
    private let textFloor = 4.5

    private func check(_ name: String, _ foreground: Palette.Token, on background: Palette.Token, floor: Double) {
        let composited = Palette.composite(foreground, over: background.hex)
        let measured = Palette.contrastRatio(composited, background.hex)
        #expect(measured >= floor, "\(name) is \(String(format: "%.2f", measured)):1, under \(floor):1")
    }

    /// The accent's whole job is to carry white label text on the primary CTA.
    ///
    /// `#6366F1` measured 4.47:1 — under the floor by three hundredths, the band Apple's audit
    /// calls "Contrast nearly passed" — and the fix at the time was to invent a darker indigo
    /// the web app does not use. The web's own `#5e6ad2` clears it at 4.70:1, which is why the
    /// parity above costs nothing here.
    @Test("white on the accent clears 4.5:1 in both schemes")
    func accentCarriesWhite() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            check("CTA label", semantic.accentContrast, on: semantic.accent, floor: textFloor)
        }
    }

    @Test("every text role clears 4.5:1 on the surfaces it is drawn on")
    func textRoles() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            for surface in [semantic.bgPrimary, semantic.bgSecondary, semantic.bgElevated] {
                check("primary text", semantic.textPrimary, on: surface, floor: textFloor)
                check("secondary text", semantic.textSecondary, on: surface, floor: textFloor)
                // Placeholders and eyebrows are real text, whatever their role name says. WCAG
                // exempts inactive *controls*, not the words inside an active one.
                check("tertiary text", semantic.textTertiary, on: surface, floor: textFloor)
                check("danger text", semantic.textDanger, on: surface, floor: textFloor)
                check("accent text", semantic.accentText, on: surface, floor: textFloor)
            }
        }
    }

    /// A status icon nobody can see is a status nobody sets — WCAG 1.4.11's 3:1 for
    /// non-text graphics.
    @Test("every priority and state hue clears 3:1 as a graphic")
    func domainHues() {
        for scheme in Palette.Scheme.allCases {
            let page = Palette.semantic(scheme).bgPrimary
            for priority in Priority.allCases {
                check("priority \(priority.label)", Palette.priority(priority, scheme),
                      on: page, floor: Palette.graphicContrastFloor)
            }
            for category in [StateCategory.triage, .backlog, .unstarted, .started, .completed, .canceled] {
                check("state \(category.rawValue)", Palette.state(category, scheme),
                      on: page, floor: Palette.graphicContrastFloor)
            }
        }
    }

    /// The page gradient's stops are surfaces text is drawn over, so its lightest stop is the
    /// worst case in dark and its darkest is the worst case in light.
    @Test("secondary text survives every stop of the page gradient")
    func gradientStops() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            for stop in semantic.pageGradient {
                check("secondary text on a gradient stop", semantic.textSecondary,
                      on: stop, floor: textFloor)
            }
        }
    }
}

@Suite("Workspace colours")
struct WorkspaceColourTests {
    @Test("a malformed hex is rejected rather than silently rendered as black")
    func malformedHex() {
        #expect(Palette.parse("#5B8DEF") == 0x5B8DEF)
        #expect(Palette.parse("5B8DEF") == 0x5B8DEF)
        #expect(Palette.parse("  #5B8DEF ") == 0x5B8DEF)
        #expect(Palette.parse(nil) == nil)
        #expect(Palette.parse("") == nil)
        #expect(Palette.parse("#5B8") == nil)
        #expect(Palette.parse("rebeccapurple") == nil)
        #expect(Palette.parse("#GGGGGG") == nil)
    }

    /// A workspace may set a state to any hex it likes, including one picked against a white
    /// web page. Rendering it unconditionally on a near-black background is a status icon
    /// nobody can read; the category palette is the floor.
    @Test("an unreadable workspace colour falls back to the category")
    func clampsUnreadableColours() {
        let readable = Palette.readableState("#3FB950", category: .completed, scheme: .dark)
        #expect(readable.hex == 0x3FB950)

        // Near-black on a near-black page.
        let clamped = Palette.readableState("#0F1114", category: .completed, scheme: .dark)
        #expect(clamped.hex == Palette.state(.completed, .dark).hex)

        let malformed = Palette.readableState("not a colour", category: .started, scheme: .dark)
        #expect(malformed.hex == Palette.state(.started, .dark).hex)
    }
}
