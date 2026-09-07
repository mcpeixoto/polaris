import Foundation

/// The Polaris mark, as numbers.
///
/// This is the iOS half of `web/src/components/Logo.tsx`, and it is in PolarisCore for the
/// same reason `Palette` is: a shape that only exists as a `SwiftUI.Shape` cannot be measured,
/// and parity with the web client is a property of the *numbers*. `PolarisMark` in the app
/// target does nothing but hand these to SwiftUI.
///
/// It exists because the iOS app did not have the mark at all. `PolarisMark` was Apple's
/// `sparkle` SF Symbol on an accent tile — a perfectly nice glyph belonging to somebody else,
/// shipped on the welcome screen as though it were the logo. The web client, the tab icon and
/// the desktop icon have all drawn a four-point star inside a tilted orbit for a while now.
///
/// Logo.tsx is the source of truth. The values below are a second copy of it, checked in
/// deliberately and asserted in `MarkGeometryTests` — reading the stylesheet at test time
/// would make the test pass whenever the two files agreed *and* whenever both were wrong.
///
/// ## The grid
///
/// Everything is on Logo.tsx's 40x40 grid, centred on (20, 20):
///
///   - the points reach r=15.5 and the waist is pulled to r~4.5 by quadratic control points
///     3.2 off centre, which is what makes the points read as sharp rather than as a rounded
///     plus sign;
///   - the two vertical points are painted again over the star, so it is faceted like a
///     compass rose rather than being one flat silhouette;
///   - four rays sit in the diagonal gaps, r=8.5 out to r=13.5;
///   - the orbit is an ellipse rx=17.5 ry=6.8 turned 24 degrees anticlockwise;
///   - the core is a disc of r=1.7 in the page colour, which is what pierces the centre.
public enum Mark {

    /// A point on the 40x40 grid. Not `CGPoint`: PolarisCore stays portable so `swift test`
    /// runs host-side, and CoreGraphics is not portable.
    public struct Point: Sendable, Hashable {
        public let x: Double
        public let y: Double
        public init(_ x: Double, _ y: Double) {
            self.x = x
            self.y = y
        }
    }

    /// The side of the square the mark is drawn on. Every value below is in these units.
    public static let grid: Double = 40
    public static let centre = Point(20, 20)
    /// Centre to a point. `M20 4.5` in Logo.tsx.
    public static let tip: Double = 15.5
    /// How far the quadratic control points sit off the centre line. `Q23.2 16.8` there.
    public static let control: Double = 3.2

    public static let orbitRX: Double = 17.5
    public static let orbitRY: Double = 6.8
    /// Anticlockwise on screen — `rotate(-24 20 20)` in SVG's y-down space.
    public static let orbitDegrees: Double = -24
    /// `.ring { stroke-width: 1 }` and `.ray { stroke-width: 1.4 }` in Logo.module.css.
    public static let orbitStroke: Double = 1
    public static let rayStroke: Double = 1.4
    public static let coreRadius: Double = 1.7

    /// The stylesheet's own opacities, so the three renderings are the same weight of ink.
    public static let orbitOpacity: Double = 0.42
    public static let rayOpacity: Double = 0.55
    public static let facetOpacity: Double = 0.9
    /// The star's gradient runs from the accent to a fainter version of itself — the facet
    /// needs two strengths of one colour, not two colours.
    public static let starFadeOpacity: Double = 0.62

    /// One side of the star: from a point, round the concave waist, to the next point.
    public struct Side: Sendable, Hashable {
        public let from: Point
        public let control: Point
        public let to: Point
    }

    /// A ray, as the two ends of a 5-unit line.
    public struct Ray: Sendable, Hashable {
        public let from: Point
        public let to: Point
    }

    public static let north = Point(20, 4.5)
    public static let east = Point(35.5, 20)
    public static let south = Point(20, 35.5)
    public static let west = Point(4.5, 20)

    /// The four concave sides, clockwise from the north point. `STAR` in Logo.tsx.
    public static let sides: [Side] = [
        Side(from: north, control: Point(23.2, 16.8), to: east),
        Side(from: east, control: Point(23.2, 23.2), to: south),
        Side(from: south, control: Point(16.8, 23.2), to: west),
        Side(from: west, control: Point(16.8, 16.8), to: north),
    ]

    /// The two vertical points on their own, each a closed pair of sides meeting at the
    /// centre. `FACET` in Logo.tsx, which paints them again over the star.
    public static let facets: [[Side]] = [
        [
            Side(from: north, control: Point(23.2, 16.8), to: centre),
            Side(from: centre, control: Point(16.8, 16.8), to: north),
        ],
        [
            Side(from: south, control: Point(23.2, 23.2), to: centre),
            Side(from: centre, control: Point(16.8, 23.2), to: south),
        ],
    ]

    /// The four diagonal rays: r=8.5 out to r=13.5 at 45, 135, 225 and 315 degrees, which is
    /// the empty quarter between two of the star's points.
    public static let rays: [Ray] = [
        Ray(from: Point(26.01, 13.99), to: Point(29.55, 10.45)),
        Ray(from: Point(13.99, 13.99), to: Point(10.45, 10.45)),
        Ray(from: Point(13.99, 26.01), to: Point(10.45, 29.55)),
        Ray(from: Point(26.01, 26.01), to: Point(29.55, 29.55)),
    ]

    /// Below this many points the orbit and the rays are a fraction of a pixel wide and paint
    /// as haze rather than as hairlines, so the small renderings drop them and keep the star.
    /// The same threshold, for the same reason, as `desktop/assets/make-icon.py`.
    public static let thinDetailMinimum: Double = 64
}
