import SwiftUI
import PolarisCore

/// Find one issue by searching for it: the parent picker, the relation picker.
///
/// Search rather than a list, because the space of issues an issue can point at is the
/// whole workspace. The request goes out a quarter second after typing stops, so a
/// twelve-character query is one search and not twelve.
struct IssuePicker: View {
    let title: String
    let api: any PolarisAPI
    /// Issues that must not be offered — the issue itself, and anything it already links to.
    var excluding: Set<String> = []
    /// A row that hands back nil: "Remove parent". Absent when there is nothing to remove.
    var clearTitle: String? = nil
    let onPick: (IssueRef?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [Issue] = []
    @State private var isSearching = false
    @State private var failure: PolarisError?
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if let clearTitle {
                    Button {
                        onPick(nil)
                        dismiss()
                    } label: {
                        HStack(spacing: Theme.Space.md) {
                            Image(systemName: "xmark.circle")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textSecondary)
                            Text(clearTitle)
                                .font(PolarisText.body)
                                .foregroundStyle(Theme.textPrimary)
                        }
                        .frame(minHeight: Theme.rowHeight - Theme.Space.lg)
                        .contentShape(Rectangle())
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                    .accessibilityIdentifier("issuePicker.clear")
                }

                if let failure {
                    InlineErrorLabel(text: failure.displayMessage)
                        .listRowBackground(Color.clear)
                } else if isSearching, results.isEmpty {
                    HStack(spacing: Theme.Space.md) {
                        ProgressView().controlSize(.small).tint(Theme.textSecondary)
                        Text("Searching")
                            .font(PolarisText.caption)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .listRowBackground(Color.clear)
                } else if results.isEmpty, !query.trimmingCharacters(in: .whitespaces).isEmpty, !isSearching {
                    Text("Nothing matches.")
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textTertiary)
                        .listRowBackground(Color.clear)
                }

                ForEach(results) { issue in
                    Button {
                        onPick(issue.ref)
                        dismiss()
                    } label: {
                        HStack(spacing: Theme.Space.sm) {
                            StateIcon(state: issue.state, size: 14)
                            Text(issue.identifier)
                                .font(PolarisText.rowMeta)
                                .foregroundStyle(Theme.textSecondary)
                            Text(issue.title)
                                .font(PolarisText.body)
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                        }
                        .frame(minHeight: Theme.rowHeight - Theme.Space.lg)
                        .contentShape(Rectangle())
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Theme.hairline)
                    .accessibilityLabel(Text("\(issue.identifier), \(issue.title)"))
                    .accessibilityIdentifier("issuePicker.result.\(issue.identifier)")
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .safeAreaInset(edge: .top, spacing: 0) {
                searchField
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.sm)
                    .background(Theme.background)
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Text("Cancel") }
                        .tint(Theme.textSecondary)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onChange(of: query) { _, updated in schedule(updated) }
        .onDisappear { searchTask?.cancel() }
    }

    private var searchField: some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
                .accessibilityHidden(true)
            TextField(
                "",
                text: $query,
                prompt: Text("Search issues").foregroundStyle(Theme.placeholder)
            )
            .font(PolarisText.body)
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accentBright)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .submitLabel(.search)
            .accessibilityIdentifier("issuePicker.search")
        }
        .padding(.horizontal, Theme.Space.md)
        .frame(minHeight: 36)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .fill(Theme.fieldFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    private func schedule(_ text: String) {
        searchTask?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            results = []
            isSearching = false
            failure = nil
            return
        }
        isSearching = true
        failure = nil
        let api = self.api
        let excluded = excluding
        searchTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            do {
                let found = try await api.search(query: trimmed)
                guard !Task.isCancelled else { return }
                results = found.issues.filter { !excluded.contains($0.id) }
                isSearching = false
            } catch {
                guard !Task.isCancelled else { return }
                failure = PolarisError.mapped(error)
                isSearching = false
            }
        }
    }
}
