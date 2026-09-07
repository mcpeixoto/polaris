import Foundation
import Testing
@testable import PolarisCore

/// Parity with `web/src/components/Logo.tsx`, asserted rather than assumed.
///
/// The product carried four different marks at once: the web component's star inside a tilted
/// orbit, a matching tab icon, a desktop icon drawn from an older star with a different waist
/// and no orbit at all, and an iOS "mark" that was Apple's `sparkle` SF Symbol. Nobody decided
/// any of that — three files simply did not change when the fourth one did.
///
/// The web coordinates are checked in here as literals on purpose, exactly as `PaletteTests`
/// does with the colour ramp. Reading Logo.tsx at test time would make this pass whenever the
/// two agreed *and* whenever both were wrong; a second copy is what makes a one-sided change
/// fail. When the mark genuinely changes, this file changes with it, in the same commit.
@Suite("Mark parity with the web client")
struct MarkGeometryTests {

    /// From web/src/components/Logo.tsx: `STAR`, `FACET`, `RAYS` and the orbit ellipse.
    private enum Web {
        static let grid = 40.0
        static let star = "M20 4.5Q23.2 16.8 35.5 20 23.2 23.2 20 35.5 16.8 23.2 4.5 20 16.8 16.8 20 4.5Z"
        static let facet = "M20 4.5Q23.2 16.8 20 20 16.8 16.8 20 4.5ZM20 35.5Q23.2 23.2 20 20 16.8 23.2 20 35.5Z"
        static let rays: [[Double]] = [
            [26.01, 13.99, 29.55, 10.45],
            [13.99, 13.99, 10.45, 10.45],
            [13.99, 26.01, 10.45, 29.55],
            [26.01, 26.01, 29.55, 29.55],
        ]
        static let orbitRX = 17.5
        static let orbitRY = 6.8
        static let orbitRotation = -24.0
    }

    /// Every number in the star path, in order, so a changed control point cannot slip past.
    private func numbers(in path: String) -> [Double] {
        path
            .replacingOccurrences(of: "[MQZ]", with: " ", options: .regularExpression)
            .split(whereSeparator: { $0 == " " || $0 == "," })
            .compactMap { Double($0) }
    }

    @Test("the star is the same four concave sides as the web path")
    func star() {
        let flat = Mark.sides.flatMap { [$0.control.x, $0.control.y, $0.to.x, $0.to.y] }
        // The path opens with a moveto at the north point, then four `Q control end` pairs.
        #expect(numbers(in: Web.star) == [Mark.north.x, Mark.north.y] + flat)
        #expect(Mark.grid == Web.grid)
    }

    @Test("the waist is pulled to the depth that makes the points sharp")
    func waist() {
        // The whole character of the mark is this one ratio. A control point at 0.71 of the
        // tip gives a diamond; 3.2 off centre against a 15.5 tip is what gives a star.
        #expect(Mark.control == 3.2)
        #expect(Mark.tip == 15.5)
        for side in Mark.sides {
            // A tolerance rather than equality: 23.2 - 20 is not 3.2 in binary floating point,
            // and a test that fails on the last bit of a coordinate teaches nobody anything.
            #expect(abs(abs(side.control.x - Mark.centre.x) - Mark.control) < 1e-9)
            #expect(abs(abs(side.control.y - Mark.centre.y) - Mark.control) < 1e-9)
        }
        // Every point is exactly the tip distance from the centre, on an axis.
        for point in [Mark.north, Mark.east, Mark.south, Mark.west] {
            let dx = abs(point.x - Mark.centre.x), dy = abs(point.y - Mark.centre.y)
            #expect(dx + dy == Mark.tip)
            #expect(dx == 0 || dy == 0)
        }
    }

    @Test("the facet is the two vertical points, and nothing else")
    func facet() {
        let flat = Mark.facets.flatMap { subpath in
            [subpath[0].from.x, subpath[0].from.y]
                + subpath.flatMap { [$0.control.x, $0.control.y, $0.to.x, $0.to.y] }
        }
        #expect(numbers(in: Web.facet) == flat)
        // Both facets meet at the centre: that is what makes them read as facets of the star
        // rather than as two loose slivers laid on top of it.
        for subpath in Mark.facets {
            #expect(subpath[0].to == Mark.centre)
            #expect(subpath[1].from == Mark.centre)
        }
    }

    @Test("the four rays run r=8.5 to r=13.5 in the diagonal gaps")
    func rays() {
        #expect(Mark.rays.count == Web.rays.count)
        for (ray, web) in zip(Mark.rays, Web.rays) {
            #expect([ray.from.x, ray.from.y, ray.to.x, ray.to.y] == web)
        }
        for ray in Mark.rays {
            let inner = hypot(ray.from.x - Mark.centre.x, ray.from.y - Mark.centre.y)
            let outer = hypot(ray.to.x - Mark.centre.x, ray.to.y - Mark.centre.y)
            #expect(abs(inner - 8.5) < 0.01)
            #expect(abs(outer - 13.5) < 0.01)
            // Five units long, which is what the stylesheet's `stroke-dasharray: 5` covers.
            #expect(abs(hypot(ray.to.x - ray.from.x, ray.to.y - ray.from.y) - 5) < 0.01)
            // Outside the waist and inside the bounding box, or the burst would start under
            // the star and end off the edge of the icon.
            #expect(inner > 4.5)
            #expect(outer < Mark.grid / 2)
        }
    }

    @Test("the orbit is the same tilted ellipse")
    func orbit() {
        #expect(Mark.orbitRX == Web.orbitRX)
        #expect(Mark.orbitRY == Web.orbitRY)
        #expect(Mark.orbitDegrees == Web.orbitRotation)
        // It reaches past the star's points, which is what makes it an orbit around the mark
        // rather than a ring drawn through it.
        #expect(Mark.orbitRX > Mark.tip)
    }
}
