import SwiftUI
import PolarisCore

/// How the dates on a cycle or a project are said: short, and with the year only when it is
/// not this one. The same rule `DueDateFormat` applies to a row's due date, so a cycle's end
/// and an issue's deadline in the same list read the same way.
enum PlanningDates {
    /// "Aug 30 – Sep 13". Both ends carry the year when either falls outside the current one.
    static func range(
        _ start: Date,
        _ end: Date,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> String {
        let thisYear = calendar.component(.year, from: now)
        let sameYear = calendar.component(.year, from: start) == thisYear
            && calendar.component(.year, from: end) == thisYear
        var style = Date.FormatStyle(calendar: calendar).month(.abbreviated).day()
        if !sameYear { style = style.year() }
        return "\(start.formatted(style)) – \(end.formatted(style))"
    }

    /// A wire calendar day (`2026-10-15`) as "Oct 15", or nil for a value that is not one.
    static func day(
        _ wire: String?,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> String? {
        guard let wire else { return nil }
        return DueDateFormat.present(wire, relativeTo: now, calendar: calendar)?.text
    }

    /// "Aug 1 → Oct 15", or whichever end exists, or nil when a project has no dates at all.
    static func span(start: String?, target: String?, now: Date = .now, calendar: Calendar = .current) -> String? {
        let from = day(start, now: now, calendar: calendar)
        let to = day(target, now: now, calendar: calendar)
        switch (from, to) {
        case (let from?, let to?): return "\(from) → \(to)"
        case (let from?, nil): return String(localized: "From \(from)")
        case (nil, let to?): return String(localized: "Due \(to)")
        case (nil, nil): return nil
        }
    }
}

/// Completion as a bar: the finished share in the completed-state colour over the track.
///
/// Four points tall and flat, which is the bar on Linear's cycle and project rows. The
/// percentage is not drawn inside it — a caller that wants the number puts it beside the bar,
/// where a reader can read it at any width.
struct WorkProgressBar: View {
    let progress: WorkProgress
    var height: CGFloat = 4

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.trackBg)
                Capsule()
                    .fill(Theme.state(.completed))
                    .frame(width: geo.size.width * CGFloat(progress.percent) / 100)
            }
        }
        .frame(height: height)
        .animation(Theme.easing(0.3), value: progress.percent)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(progress.percent) percent complete"))
    }
}

/// The band over a group of cycles or projects: the same raised strip a status group gets,
/// so the two kinds of list read as one product.
struct PlanningSectionHeader: View {
    let title: String
    let count: Int
    var identifier: String

    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            Text(title)
                .font(.system(.footnote).weight(.medium))
                .foregroundStyle(Theme.textPrimary)
            Text("\(count)")
                .font(.system(.footnote).monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Space.lg)
        .frame(minHeight: 32)
        .background(Theme.raised)
        .textCase(nil)
        .listRowInsets(EdgeInsets())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier(identifier)
    }
}

/// A count in a small capsule, for the triage row on the hub.
struct CountBadge: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(PolarisText.captionSmall.monospacedDigit().weight(.medium))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, Theme.Space.sm - 1)
            .frame(minWidth: 20, minHeight: 20)
            .background(Theme.raised)
            .clipShape(Capsule())
    }
}

/// A team's mark: its icon on a raised tile, or the first letter of its key in the team's
/// colour. Emoji icons arrive as text; symbol names arrive as text too, so the tile checks
/// which it was handed rather than guessing from the length.
struct TeamIconView: View {
    let team: Team
    var size: CGFloat = 28

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
            .fill(Theme.raised)
            .frame(width: size, height: size)
            .overlay(glyph)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var glyph: some View {
        if let icon = team.icon, !icon.isEmpty {
            if UIImage(systemName: icon) != nil {
                Image(systemName: icon)
                    .font(.system(size: size * 0.5, weight: .medium))
                    .foregroundStyle(Theme.hex(team.color))
            } else {
                Text(icon).font(.system(size: size * 0.5))
            }
        } else {
            Text(String(team.key.prefix(1)))
                .font(.system(size: size * 0.45, weight: .semibold))
                .foregroundStyle(Theme.hex(team.color))
        }
    }
}

/// A project's mark, the same way. Linear's default is a hexagon; so is this one.
struct ProjectIconView: View {
    let project: Project
    var size: CGFloat = 20

    var body: some View {
        Group {
            if let icon = project.icon, !icon.isEmpty {
                if UIImage(systemName: icon) != nil {
                    Image(systemName: icon).font(.system(size: size * 0.7, weight: .medium))
                } else {
                    Text(icon).font(.system(size: size * 0.7))
                }
            } else {
                Image(systemName: "hexagon").font(.system(size: size * 0.7, weight: .medium))
            }
        }
        .foregroundStyle(Theme.hex(project.color))
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A project's status as a small bordered pill: the category's glyph in the status colour,
/// then the workspace's name for it.
struct ProjectStatusPill: View {
    let status: ProjectStatus

    var body: some View {
        HStack(spacing: Theme.Space.xs) {
            Image(systemName: status.category.symbolName)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Theme.hex(status.color))
            Text(status.name)
                .font(.system(.caption).weight(.medium))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, Theme.Space.sm)
        .frame(minHeight: 22)
        .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Status: \(status.name)"))
    }
}

/// The cycle glyph: a ring whose filled arc is how much of the cycle is done, which is what
/// Linear draws beside a cycle wherever it names one.
struct CycleRing: View {
    let percent: Int
    var size: CGFloat = 14

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.trackBg, lineWidth: 2)
            Circle()
                .trim(from: 0, to: CGFloat(min(max(percent, 0), 100)) / 100)
                .stroke(Theme.state(.completed), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
