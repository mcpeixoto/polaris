import SwiftUI
import PolarisCore

/// The team's cycles: the one running now first, then what is coming, then what is over.
///
/// Loaded here rather than held in `WorkspaceDataStore`, because cycles are per team and
/// dated — the "active" one is a property of today — and a picker opened once a week is not
/// worth a collection kept warm for the whole session.
struct CyclePicker: View {
    let api: any PolarisAPI
    let teamId: String
    let selected: String?
    let onPick: (CycleRef?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var cycles: Loadable<[Cycle]> = .idle

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                    dismiss()
                } label: {
                    row(name: String(localized: "No cycle"), detail: nil, isSelected: selected == nil)
                }
                .listRowBackground(Color.clear)
                .listRowSeparatorTint(Theme.hairline)
                .accessibilityIdentifier("cyclePicker.none")

                switch cycles {
                case .idle, .loading:
                    HStack(spacing: Theme.Space.md) {
                        ProgressView().controlSize(.small).tint(Theme.textSecondary)
                        Text("Loading cycles")
                            .font(PolarisText.caption)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .listRowBackground(Color.clear)
                case .failed(let error):
                    InlineErrorLabel(
                        text: error.displayMessage,
                        retryLabel: error.isRetryable ? String(localized: "Try again") : nil,
                        onRetry: error.isRetryable ? { Task { await load() } } : nil
                    )
                    .listRowBackground(Color.clear)
                case .loaded(let all) where all.isEmpty:
                    Text("This team has no cycles.")
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textTertiary)
                        .listRowBackground(Color.clear)
                case .loaded(let all):
                    ForEach(Self.sections(all)) { section in
                        Section {
                            ForEach(section.cycles) { cycle in
                                Button {
                                    onPick(cycle.ref)
                                    dismiss()
                                } label: {
                                    row(name: cycle.displayName, detail: span(cycle), isSelected: cycle.id == selected)
                                }
                                .listRowBackground(Color.clear)
                                .listRowSeparatorTint(Theme.hairline)
                                .accessibilityIdentifier("cyclePicker.option.\(cycle.number)")
                            }
                        } header: {
                            SectionLabel(text: section.title)
                                .textCase(nil)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(Text("Cycle"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private func load() async {
        cycles = .loading
        do {
            cycles = .loaded(try await api.cycles(teamId: teamId))
        } catch {
            cycles = .failed(PolarisError.mapped(error))
        }
    }

    struct CycleSection: Identifiable {
        let title: String
        let cycles: [Cycle]
        var id: String { title }
    }

    /// Active, then upcoming soonest first, then past most recent first. Sections with
    /// nothing in them are left out rather than shown as empty headings.
    static func sections(_ all: [Cycle], now: Date = .now) -> [CycleSection] {
        let active = all.filter { $0.isActive(at: now) }.sorted { $0.startsAt < $1.startsAt }
        let upcoming = all.filter { $0.isUpcoming(at: now) }.sorted { $0.startsAt < $1.startsAt }
        let past = all.filter { !$0.isActive(at: now) && !$0.isUpcoming(at: now) }
            .sorted { $0.startsAt > $1.startsAt }
        return [
            CycleSection(title: String(localized: "Active"), cycles: active),
            CycleSection(title: String(localized: "Upcoming"), cycles: upcoming),
            CycleSection(title: String(localized: "Past"), cycles: past),
        ].filter { !$0.cycles.isEmpty }
    }

    private func span(_ cycle: Cycle) -> String {
        let style = Date.FormatStyle().month(.abbreviated).day()
        return "\(cycle.startsAt.formatted(style)) – \(cycle.endsAt.formatted(style))"
    }

    private func row(name: String, detail: String?, isSelected: Bool) -> some View {
        HStack(spacing: Theme.Space.md) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(name)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            if let detail {
                Text(detail)
                    .font(PolarisText.captionSmall)
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.accentBright)
            }
        }
        .frame(minHeight: Theme.rowHeight - Theme.Space.lg)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
