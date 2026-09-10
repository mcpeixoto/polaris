import Foundation
import Testing
@testable import PolarisCore

/// Done is green, and it is the *same* green everywhere.
///
/// Four places have to hold one hex — the Go seed in `services/internal/domain`, migration
/// 000088, `--color-green-500` in `web/src/styles/tokens.css` and `Palette.green500` here —
/// because the colour of a completed state is domain data, not decoration: a workspace
/// stores it, both clients render the stored value, and two clients disagreeing about the
/// colour of "done" is the worst place to disagree.
///
/// The web's values are literals here for the same reason `PaletteParityTests` writes them
/// out: reading `tokens.css` at test time would pass whenever the two files agreed *and*
/// whenever both were wrong.
@Suite("Done is green")
struct DoneIsGreenTests {
    /// From web/src/styles/tokens.css.
    private enum Web {
        static let green400: UInt32 = 0x20B670
        static let green500: UInt32 = 0x188A55
    }

    /// The hex a newly seeded Done state holds in the database, and the one migration 000088
    /// writes over the old accent.
    private let seeded: UInt32 = 0x188A55

    @Test("the green ramp matches the web's")
    func rampMatchesWeb() {
        #expect(Palette.green400 == Web.green400)
        #expect(Palette.green500 == Web.green500)
    }

    @Test("the stored Done colour is the palette's green-500")
    func seedMatchesThePalette() {
        #expect(Palette.green500 == seeded)
    }

    @Test("the completed category is green in both schemes")
    func completedIsGreen() {
        #expect(Palette.state(.completed, .light).hex == Web.green500)
        #expect(Palette.state(.completed, .dark).hex == Web.green400)
    }

    /// The regression this exists for: completed was `accent400`/`accent500`, which is also
    /// the selected row, the focused field and the primary button. A disc drawn in the accent
    /// is the one mark on an issue row that says nothing by being coloured.
    @Test("completed is not the accent")
    func completedIsNotTheAccent() {
        for scheme in Palette.Scheme.allCases {
            let completed = Palette.state(.completed, scheme).hex
            #expect(completed != Palette.accent400)
            #expect(completed != Palette.accent500)
            #expect(completed != Palette.semantic(scheme).accent.hex)
        }
    }

    /// Google's mark is brand colour, not ours to reuse — the sign-in button is the only
    /// place it may appear.
    @Test("the domain green is not Google's green")
    func notGooglesGreen() {
        #expect(Palette.green400 != Palette.GoogleMark.green.hex)
        #expect(Palette.green500 != Palette.GoogleMark.green.hex)
    }

    /// A status icon nobody can see is a status nobody sets — WCAG 1.4.11's 3:1 for non-text
    /// graphics. `green500` carries the stricter version of this: it is the value a workspace
    /// *stores*, so the one hex is drawn on a white page and on a near-black one and has to
    /// clear the floor on both rather than on the scheme it was picked against.
    @Test("green-500 clears 3:1 on both schemes' pages, because the stored hex is theme-blind")
    func storedGreenSurvivesBothSchemes() {
        for scheme in Palette.Scheme.allCases {
            let page = Palette.semantic(scheme).bgPrimary
            let measured = Palette.contrastRatio(Palette.green500, page.hex)
            #expect(
                measured >= Palette.graphicContrastFloor,
                "green-500 on \(scheme) bgPrimary is \(String(format: "%.2f", measured)):1"
            )
        }
    }

    /// And the palette's own pair clears it on every stop of the page gradient, not just the
    /// one stop `bgPrimary` happens to be.
    @Test("the completed token clears 3:1 on every stop of the page gradient")
    func completedSurvivesTheGradient() {
        for scheme in Palette.Scheme.allCases {
            let semantic = Palette.semantic(scheme)
            let token = Palette.state(.completed, scheme)
            for stop in semantic.pageGradient {
                let measured = Palette.contrastRatio(
                    Palette.composite(token, over: stop.hex), stop.hex)
                let where_ = "\(scheme) stop \(String(format: "%06X", stop.hex))"
                #expect(
                    measured >= Palette.graphicContrastFloor,
                    "completed on \(where_) is \(String(format: "%.2f", measured)):1"
                )
            }
        }
    }
}
