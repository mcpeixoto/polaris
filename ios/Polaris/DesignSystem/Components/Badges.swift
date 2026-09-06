import SwiftUI
import PolarisCore

/// A workflow state, as the glyph the web client draws for the same category.
///
/// The shape carries the meaning and the colour agrees with it: a dashed ring for work that
/// is not in the workflow yet, an open ring for work that has not begun, a half-filled ring
/// for work under way, a disc for work that is finished one way or the other. Backlog and
/// unstarted are both grey by design, so a reader scanning two hundred rows is reading
/// silhouettes rather than hues.
///
/// Drawn from the *category*, never the name: a workspace may rename a started state to
/// anything it likes, and the icon still has to mean "in progress".
struct StateIcon: View {
    let state: WorkflowState
    var size: CGFloat = 16

    var body: some View {
        StateGlyph(category: state.category)
            .frame(width: size, height: size)
            // The workspace's colour when it can be seen against the page, the category's
            // when it cannot. Rendering the configured hex unconditionally meant a workspace
            // with badly-chosen state colours drew status icons nobody could read, and the
            // category palette that exists for exactly this was never consulted.
            .foregroundStyle(Theme.stateColor(state))
            // A status change swaps one glyph for another on the one control whose whole job
            // is to show change, so it crossfades rather than cutting.
            .animation(Theme.easing(0.25), value: state.category)
            .accessibilityHidden(true)
    }
}

/// The six category shapes on a 16-unit grid, sized by the frame they are given.
///
/// The marks inside a disc are painted in the page colour rather than cut out of it. They are
/// entirely surrounded by the fill, so nothing about them touches the surface behind the icon
/// and the illusion holds on a selected row or inside a menu.
private struct StateGlyph: View {
    let category: StateCategory

    var body: some View {
        GeometryReader { geo in
            let unit = min(geo.size.width, geo.size.height) / 16
            let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            let ringRadius = 6 * unit
            let stroke = 2 * unit
            ZStack {
                switch category {
                case .triage:
                    ring(dashed: true, radius: ringRadius, stroke: stroke, unit: unit)
                    Capsule()
                        .frame(width: 1.5 * unit, height: 4.2 * unit)
                        .offset(y: -1.5 * unit)
                    Circle()
                        .frame(width: 1.9 * unit, height: 1.9 * unit)
                        .offset(y: 2.7 * unit)
                case .backlog:
                    ring(dashed: true, radius: ringRadius, stroke: stroke, unit: unit)
                case .unstarted:
                    ring(dashed: false, radius: ringRadius, stroke: stroke, unit: unit)
                case .started:
                    ring(dashed: false, radius: ringRadius, stroke: stroke, unit: unit)
                    // Halfway, because "in progress" is what the glyph has to say and an
                    // empty pie says "not started".
                    Pie(fraction: 0.5)
                        .frame(width: 7.5 * unit, height: 7.5 * unit)
                case .completed:
                    Circle().frame(width: 14 * unit, height: 14 * unit)
                    Check()
                        .stroke(
                            Theme.darkBase,
                            style: StrokeStyle(lineWidth: 1.75 * unit, lineCap: .round, lineJoin: .round)
                        )
                        .frame(width: 16 * unit, height: 16 * unit)
                case .canceled, .duplicate:
                    Circle().frame(width: 14 * unit, height: 14 * unit)
                    Cross()
                        .stroke(Theme.darkBase, style: StrokeStyle(lineWidth: 1.75 * unit, lineCap: .round))
                        .frame(width: 16 * unit, height: 16 * unit)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .position(center)
        }
    }

    private func ring(dashed: Bool, radius: CGFloat, stroke: CGFloat, unit: CGFloat) -> some View {
        Circle()
            .stroke(
                style: StrokeStyle(
                    lineWidth: stroke,
                    // Eight even dashes on a circumference of 2π×6 ≈ 37.7, so they close
                    // cleanly at twelve o'clock instead of leaving a short last segment.
                    dash: dashed ? [2.4 * unit, 2.31 * unit] : []
                )
            )
            .frame(width: radius * 2, height: radius * 2)
    }
}

/// A wedge from twelve o'clock, clockwise.
private struct Pie: Shape {
    let fraction: Double

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        path.move(to: center)
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .degrees(-90),
            endAngle: .degrees(-90 + 360 * min(max(fraction, 0), 1)),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

private struct Check: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = rect.width / 16
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 4.9 * unit, y: rect.minY + 8.2 * unit))
        path.addLine(to: CGPoint(x: rect.minX + 7 * unit, y: rect.minY + 10.3 * unit))
        path.addLine(to: CGPoint(x: rect.minX + 11.1 * unit, y: rect.minY + 5.9 * unit))
        return path
    }
}

private struct Cross: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = rect.width / 16
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 5.6 * unit, y: rect.minY + 5.6 * unit))
        path.addLine(to: CGPoint(x: rect.minX + 10.4 * unit, y: rect.minY + 10.4 * unit))
        path.move(to: CGPoint(x: rect.minX + 10.4 * unit, y: rect.minY + 5.6 * unit))
        path.addLine(to: CGPoint(x: rect.minX + 5.6 * unit, y: rect.minY + 10.4 * unit))
        return path
    }
}

/// The five priority levels, each a different *shape* so they survive being read without
/// colour: a filled square with an exclamation for urgent, then three, two and one lit bars
/// against the unlit remainder of the same scale, then three level dashes for no priority.
///
/// The unlit bars are drawn rather than omitted so all five glyphs occupy the same box. A
/// list whose icons change width shifts every title in it by a pixel or two per row, and
/// that is visible as noise long before anyone works out what is causing it.
struct PriorityIcon: View {
    let priority: Priority
    var size: CGFloat = 16

    /// The unlit part of the scale.
    private static let trackOpacity = 0.28

    var body: some View {
        GeometryReader { geo in
            let unit = min(geo.size.width, geo.size.height) / 16
            ZStack {
                switch priority {
                case .urgent:
                    RoundedRectangle(cornerRadius: 3 * unit, style: .continuous)
                        .frame(width: 14 * unit, height: 14 * unit)
                    Capsule()
                        .fill(Theme.darkBase)
                        .frame(width: 1.5 * unit, height: 5.5 * unit)
                        .offset(y: -1.75 * unit)
                    Circle()
                        .fill(Theme.darkBase)
                        .frame(width: 2 * unit, height: 2 * unit)
                        .offset(y: 3.5 * unit)
                case .high, .medium, .low:
                    bars(lit: litBars, unit: unit)
                case .none:
                    VStack(spacing: 2 * unit) {
                        ForEach(0..<3, id: \.self) { _ in
                            Capsule().frame(width: 10 * unit, height: 2 * unit)
                        }
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(width: size, height: size)
        .foregroundStyle(Theme.priority(priority))
        .accessibilityHidden(true)
    }

    private var litBars: Int {
        switch priority {
        case .high: 3
        case .medium: 2
        case .low: 1
        case .urgent, .none: 0
        }
    }

    private func bars(lit: Int, unit: CGFloat) -> some View {
        HStack(alignment: .bottom, spacing: 2 * unit) {
            ForEach(Array([5.0, 8.5, 12.0].enumerated()), id: \.offset) { index, height in
                RoundedRectangle(cornerRadius: unit, style: .continuous)
                    .frame(width: 3 * unit, height: height * unit)
                    .opacity(index < lit ? 1 : Self.trackOpacity)
            }
        }
        .frame(width: 13 * unit, height: 12 * unit, alignment: .bottom)
        .offset(y: 0.5 * unit)
    }
}

struct LabelChip: View {
    let label: PolarisCore.Label

    var body: some View {
        HStack(spacing: Theme.Space.xs + 1) {
            Circle()
                .fill(Theme.hex(label.color))
                .frame(width: 7, height: 7)
            Text(label.name)
                .font(.system(.caption).weight(.medium))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, Theme.Space.sm)
        .frame(minHeight: 22)
        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
        .accessibilityLabel("Label: \(label.name)")
    }
}

/// The labels on a list row: the first two as dots, and a count for the rest.
///
/// A row is one line and a label name is not worth a title's width. Colour dots say "labelled,
/// and with what colour" — the names are on the detail screen, a tap away.
struct LabelDots: View {
    let labels: [PolarisCore.Label]
    var shown: Int = 2

    var body: some View {
        if !labels.isEmpty {
            HStack(spacing: Theme.Space.xs) {
                ForEach(labels.prefix(shown)) { label in
                    Circle()
                        .fill(Theme.hex(label.color))
                        .frame(width: 8, height: 8)
                }
                if labels.count > shown {
                    Text("+\(labels.count - shown)")
                        .font(PolarisText.captionSmall.monospacedDigit())
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .accessibilityHidden(true)
        }
    }
}

/// The assignee's picture, or their initials when they have none — which is most seeded
/// accounts. Unassigned keeps the footprint as a dashed ring, so the titles above and below
/// end at the same place.
struct AvatarView: View {
    let user: User?
    var size: CGFloat = 22

    var body: some View {
        Group {
            if let user {
                if let url = user.avatarUrl.flatMap(URL.init(string:)) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            initials(user)
                        }
                    }
                    .clipShape(Circle())
                } else {
                    initials(user)
                }
            } else {
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
                    .foregroundStyle(Theme.border)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(user.map { "Assigned to \($0.displayName)" } ?? "Unassigned")
    }

    private func initials(_ user: User) -> some View {
        Circle()
            .fill(Theme.accentTint)
            .overlay(
                Text(user.initials)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Theme.accentBright)
            )
    }
}
