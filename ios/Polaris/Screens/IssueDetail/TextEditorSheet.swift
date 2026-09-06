import SwiftUI

/// A sheet needs an `Identifiable` item, and a bare `String?` is not one.
struct TextDraft: Identifiable {
    let text: String
    var id: String { text }
}

/// A multi-paragraph body, edited in a sheet rather than in place.
///
/// In-place editing of a long text inside a scroll view that also holds a thread fights the
/// keyboard for the same space; a sheet has the whole screen and an explicit Save. The
/// description and a comment being edited are the same sheet with a different title.
struct TextEditorSheet: View {
    let title: String
    let prompt: String
    var identifier: String = "issue.descriptionEditor"
    @State private var draft: String
    @Environment(\.dismiss) private var dismiss
    private let onSave: (String) -> Void

    init(
        title: String,
        prompt: String,
        text: String,
        identifier: String = "issue.descriptionEditor",
        onSave: @escaping (String) -> Void
    ) {
        self.title = title
        self.prompt = prompt
        self.identifier = identifier
        _draft = State(initialValue: text)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                TextField(
                    "",
                    text: $draft,
                    prompt: Text(prompt).foregroundStyle(Theme.placeholder),
                    axis: .vertical
                )
                .lineLimit(6...30)
                .font(PolarisText.body)
                .foregroundStyle(Theme.textPrimary)
                .tint(Theme.accentBright)
                .padding(Theme.Space.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityIdentifier(identifier)
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Text("Cancel") }
                        .tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onSave(draft)
                        dismiss()
                    } label: {
                        Text("Save").font(.system(.body).weight(.semibold))
                    }
                    .tint(Theme.accentBright)
                    .accessibilityIdentifier("\(identifier).save")
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// A URL and an optional title, for a link card.
struct AddLinkSheet: View {
    let onSave: (String, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var title = ""
    @FocusState private var urlFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    TextField(
                        "",
                        text: $url,
                        prompt: Text("https://").foregroundStyle(Theme.placeholder)
                    )
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .darkField()
                    .focused($urlFocused)
                    .accessibilityLabel(Text("Link URL"))
                    .accessibilityIdentifier("link.url")

                    TextField(
                        "",
                        text: $title,
                        prompt: Text("Title (optional)").foregroundStyle(Theme.placeholder)
                    )
                    .darkField()
                    .accessibilityLabel(Text("Link title"))
                    .accessibilityIdentifier("link.title")

                    if !url.isEmpty, parsed == nil {
                        InlineErrorLabel(text: String(localized: "That doesn't look like a web address."))
                    }
                    Spacer(minLength: 0)
                }
                .padding(Theme.Space.lg)
            }
            .navigationTitle(Text("Add link"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Text("Cancel") }
                        .tint(Theme.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        guard let parsed else { return }
                        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
                        onSave(parsed.absoluteString, trimmedTitle.isEmpty ? nil : trimmedTitle)
                        dismiss()
                    } label: {
                        Text("Save").font(.system(.body).weight(.semibold))
                    }
                    .tint(Theme.accentBright)
                    .disabled(parsed == nil)
                    .accessibilityIdentifier("link.save")
                }
            }
            .onAppear { urlFocused = true }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    /// A URL with a web scheme and a host. "github.com/x" is accepted and given https, because
    /// that is what people type; "notes" is not, because a link card to nowhere is a bug.
    private var parsed: URL? {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let candidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let parsed = URL(string: candidate),
              let scheme = parsed.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parsed.host, host.contains(".") || host == "localhost"
        else { return nil }
        return parsed
    }
}
