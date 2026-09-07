import SwiftUI
import PolarisCore

/// The press response, on every interactive control in the app.
///
/// 0.98 is deliberately small: enough that a tap feels answered, not so much that a list of
/// them looks like it is breathing. Applied to buttons, chips and rows — the only opt-out is
/// `.plain` for inline text links.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// The small heading over a group of things.
///
/// Plain, sentence-case, tertiary. It replaced a tracked uppercase monospace eyebrow: a label
/// that has to be decoded is a label that slows the scan, and the scan is what a list is for.
struct SectionLabel: View {
    let text: String
    var color: Color = Theme.eyebrowText

    var body: some View {
        Text(text)
            .font(PolarisText.sectionTitle)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A 1pt separator. Not `Divider()`, which insets itself differently inside different
/// containers and cannot be coloured reliably.
struct HairlineDivider: View {
    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
    }
}

/// A grouped surface: one step up from the page, hairline edge, small radius. Callers own
/// their inner padding, because a card wrapping a dense row and a card wrapping a form want
/// different insets and baking one in makes the other wrong.
struct Card<Content: View>: View {
    var radius: CGFloat = Theme.Radius.lg
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            )
    }
}

/// The primary call to action: a flat accent fill at the row height, nothing under it.
///
/// `isBusy` swaps the label for a spinner in place rather than disabling into ambiguity, so
/// the button never changes size mid-tap.
struct PrimaryButton: View {
    let title: String
    var isBusy: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(.system(.subheadline).weight(.semibold))
                    .opacity(isBusy ? 0 : 1)
                if isBusy {
                    ProgressView().tint(Theme.accentContrast)
                }
            }
            .foregroundStyle(Theme.accentContrast)
            .frame(maxWidth: .infinity)
            .frame(minHeight: Theme.rowHeight)
            .background(Theme.accent.opacity(isEnabled && !isBusy ? 1 : 0.55))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(!isEnabled || isBusy)
    }
}

/// A secondary action: bordered, on the surface colour, the same height as the primary.
struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(.subheadline).weight(.medium))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(minHeight: Theme.rowHeight)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        }
        .buttonStyle(PressableStyle())
    }
}

/// A field on the page.
///
/// `prompt:` rather than the bare `TextField("Email", …)` label, because only the prompt form
/// lets the placeholder colour be set — the default is near-invisible here.
struct DarkFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(.body))
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accentBright)
            .padding(.horizontal, Theme.Space.md)
            .padding(.vertical, Theme.Space.md)
            // The fill is drawn *behind* the text rather than clipped around it. `.clipShape`
            // on the field itself trims whatever does not fit the padded frame, so at larger
            // Dynamic Type sizes the text was cut off inside its own box — which the
            // accessibility audit reports as "Text clipped". A background shape has no such
            // effect: the field grows and the text stays whole.
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .fill(Theme.fieldFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

extension View {
    func darkField() -> some View { modifier(DarkFieldStyle()) }
}

/// A property pill: an icon and a value, bordered, at the pill height. The detail screen's
/// status, priority and assignee are these; so are the composer's.
struct PropertyChip<Icon: View>: View {
    let text: String
    var tint: Color = Theme.textPrimary
    @ViewBuilder var icon: () -> Icon

    var body: some View {
        HStack(spacing: Theme.Space.xs + 2) {
            icon()
            Text(text)
                .font(.system(.footnote).weight(.medium))
                .foregroundStyle(tint)
                .lineLimit(1)
        }
        .padding(.horizontal, Theme.Space.sm + 2)
        .frame(minHeight: 30)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
    }
}

/// The Polaris mark: the four-point star inside its tilted orbit, drawn.
///
/// It was `Image(systemName: "sparkle")` on an accent tile — Apple's glyph, on the welcome
/// screen, standing in for the logo. Meanwhile the web client, the browser tab and the desktop
/// dock icon all drew the actual mark, so the first thing a new user saw on iOS was the one
/// surface that did not show it.
///
/// The geometry is `PolarisCore.Mark`, which is `web/src/components/Logo.tsx` as numbers, on a
/// 40x40 grid scaled to whatever `size` asks for. Nothing here invents a coordinate and nothing
/// here names a colour: both come from Core, for the same reason — a number that exists in one
/// place cannot fall out of step with itself.
///
/// ## The entrance
///
/// The web lockup's timeline, at the same beats: the orbit draws itself round, the star unwinds
/// in from a rotation, and the four rays burst outward one after another. It runs once, on
/// appear. The old mark instead breathed forever, which is a thing a welcome screen should not
/// do — a permanently-moving element is precisely what Reduce Motion exists to stop, and it also
/// reads as a progress indicator for something that is not loading.
///
/// Under Reduce Motion the mark is painted in its finished state with no animation at all — not
/// slowed, removed — which is what `prefers-reduced-motion` does to the web one.
struct PolarisMark: View {
    var size: CGFloat = 64
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false

    /// The spring the web logo uses: cubic-bezier(0.22, 1.35, 0.36, 1). It overshoots slightly,
    /// which is what makes the star look thrown into place rather than faded up. `Theme.easing`
    /// is the product's ordinary curve and does not overshoot; this is the one exception, and
    /// it is here rather than in Theme because the logo is the only thing that uses it.
    private func spring(_ duration: Double, delay: Double) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.22, 1.35, 0.36, 1, duration: duration).delay(delay)
    }

    private func ease(_ duration: Double, delay: Double) -> Animation? {
        reduceMotion ? nil : Theme.easing(duration).delay(delay)
    }

    /// One grid unit in points. Every stroke width below is a Core value times this.
    private var unit: CGFloat { size / CGFloat(Mark.grid) }

    /// Below `Mark.thinDetailMinimum` the orbit and the rays are a fraction of a point wide and
    /// paint as haze around the star rather than as hairlines, so a small mark is the star
    /// alone. The same threshold, for the same reason, as `desktop/assets/make-icon.py`.
    private var thinDetail: Bool { size >= CGFloat(Mark.thinDetailMinimum) }

    var body: some View {
        ZStack {
            if thinDetail {
                MarkOrbit()
                    .trim(from: 0, to: entered ? 1 : 0)
                    .stroke(
                        Theme.accent.opacity(Mark.orbitOpacity),
                        lineWidth: CGFloat(Mark.orbitStroke) * unit
                    )
                    .animation(ease(1.0, delay: 0.06), value: entered)

                ForEach(Array(Mark.rays.enumerated()), id: \.offset) { index, ray in
                    MarkRay(ray: ray)
                        .trim(from: 0, to: entered ? 1 : 0)
                        .stroke(
                            Theme.accent.opacity(Mark.rayOpacity),
                            style: StrokeStyle(
                                lineWidth: CGFloat(Mark.rayStroke) * unit, lineCap: .round
                            )
                        )
                        .animation(spring(0.62, delay: 0.42 + Double(index) * 0.06), value: entered)
                }
            }

            ZStack {
                // Two strengths of one colour rather than two colours: the facet needs the star
                // to fall away underneath it, not to change hue.
                MarkStar()
                    .fill(
                        LinearGradient(
                            colors: [Theme.accent, Theme.accent.opacity(Mark.starFadeOpacity)],
                            startPoint: .init(x: 0.35, y: 0),
                            endPoint: .init(x: 0.7, y: 1)
                        )
                    )
                MarkFacet()
                    .fill(Theme.accent.opacity(Mark.facetOpacity))
                Circle()
                    .fill(Theme.background)
                    .frame(
                        width: CGFloat(Mark.coreRadius) * 2 * unit,
                        height: CGFloat(Mark.coreRadius) * 2 * unit
                    )
            }
            // The star arrives unwinding, which is the beat the web entrance opens on. It is one
            // transform on the group rather than three on the parts, so the facet and the core
            // cannot drift off the star while it turns.
            .rotationEffect(.degrees(entered ? 0 : -140))
            .scaleEffect(entered ? 1 : 0.2)
            .opacity(entered ? 1 : 0)
            .animation(spring(0.7, delay: 0.14), value: entered)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onAppear {
            // Under Reduce Motion every animation above is nil, so this sets the finished state
            // with no transition rather than being skipped: the mark must still be visible.
            entered = true
        }
    }
}

/// The star silhouette. `Mark.sides`, which is `STAR` in Logo.tsx.
///
/// The three mark shapes are separate `Shape`s rather than one path with holes because each is
/// painted differently — a gradient, a flat accent, the page colour — and because `trim` on a
/// combined path would trim across all of them at once.
private struct MarkStar: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: rect.point(Mark.sides[0].from))
        for side in Mark.sides {
            path.addQuadCurve(to: rect.point(side.to), control: rect.point(side.control))
        }
        path.closeSubpath()
        return path
    }
}

/// The two vertical points, painted again over the star. One shape, and the star stops being a
/// silhouette and starts being faceted like a compass rose.
private struct MarkFacet: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for subpath in Mark.facets {
            path.move(to: rect.point(subpath[0].from))
            for side in subpath {
                path.addQuadCurve(to: rect.point(side.to), control: rect.point(side.control))
            }
            path.closeSubpath()
        }
        return path
    }
}

/// One diagonal ray, as its own shape so the four can burst in sequence.
private struct MarkRay: Shape {
    let ray: Mark.Ray

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: rect.point(ray.from))
        path.addLine(to: rect.point(ray.to))
        return path
    }
}

/// The orbit: a hairline ellipse turned about the centre. It describes the star rather than
/// being a second shape competing with it, which is why it is drawn at 42% and one unit wide.
private struct MarkOrbit: Shape {
    func path(in rect: CGRect) -> Path {
        let centre = rect.point(Mark.centre)
        let scale = rect.width / CGFloat(Mark.grid)
        let box = CGRect(
            x: centre.x - CGFloat(Mark.orbitRX) * scale,
            y: centre.y - CGFloat(Mark.orbitRY) * scale,
            width: CGFloat(Mark.orbitRX) * 2 * scale,
            height: CGFloat(Mark.orbitRY) * 2 * scale
        )
        // Rotated inside the path rather than with `.rotationEffect`, so that `trim` measures
        // the ellipse the viewer sees and the draw-on starts where it appears to start.
        let turn = CGAffineTransform(translationX: centre.x, y: centre.y)
            .rotated(by: CGFloat(Mark.orbitDegrees) * .pi / 180)
            .translatedBy(x: -centre.x, y: -centre.y)
        return Path(ellipseIn: box).applying(turn)
    }
}

private extension CGRect {
    /// A point on Mark's 40x40 grid, in this rect. The mark is always square — callers frame it
    /// — so the width is the scale for both axes.
    func point(_ point: Mark.Point) -> CGPoint {
        let scale = width / CGFloat(Mark.grid)
        return CGPoint(x: minX + CGFloat(point.x) * scale, y: minY + CGFloat(point.y) * scale)
    }
}

/// Lays its children out left to right and wraps to a new line when the width runs out.
///
/// For the property chips on the detail screen and the pills in the composer: a fixed grid
/// would leave holes where a chip is absent, and an `HStack` would push the last chip off
/// the edge on a narrow phone.
struct FlowLayout: Layout {
    var spacing: CGFloat = Theme.Space.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        return place(in: width, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = place(in: bounds.width, subviews: subviews)
        for (subview, origin) in zip(subviews, layout.origins) {
            subview.place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                proposal: .unspecified
            )
        }
    }

    private func place(in width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            lineHeight = max(lineHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + lineHeight), origins)
    }
}
