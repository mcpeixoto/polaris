import Foundation

/// What the composer holds between openings: the words and every property set beside them.
///
/// Linear keeps an unfinished draft when the create sheet is dismissed and brings it back the
/// next time. Before this the typed text was gone on reopen, which is why the composer had to
/// confirm every cancel — and still lost the draft to a swipe-down or a killed app.
struct ComposeDraft: Codable, Equatable {
    var title = ""
    var details = ""
    var teamId: String?
    var priority = 0
    var stateId: String?
    /// Nil is unassigned. The reader's own id is what "Assign to me" means.
    var assigneeId: String?
    var labelIds: [String] = []
    /// A calendar day, `2006-01-02`, the wire form.
    var dueDate: String?
    var estimate: Int?
    var projectId: String?
    var cycleId: String?

    /// Nothing typed. Properties alone are not a draft worth restoring — a team choice with
    /// no words behind it is the default, not somebody's work.
    var isEmpty: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Where the draft lives: `UserDefaults` on a real device, memory in the fixture app.
///
/// In memory for the fixture app for the reason `InMemoryIssueCache` exists — a UI test that
/// ends with words in the composer must not hand them to the next test's composer.
final class ComposeDraftStore {
    static let storageKey = "polaris.compose.draft"

    private let defaults: UserDefaults?
    private var memory: ComposeDraft?

    init(defaults: UserDefaults?) {
        self.defaults = defaults
    }

    func load() -> ComposeDraft? {
        if let defaults {
            guard let data = defaults.data(forKey: Self.storageKey) else { return nil }
            return try? JSONDecoder().decode(ComposeDraft.self, from: data)
        }
        return memory
    }

    /// Writes a draft with words in it, and removes one without. An empty draft on disk would
    /// restore as a blank composer, which is what a blank composer already is.
    func save(_ draft: ComposeDraft) {
        guard !draft.isEmpty else { return clear() }
        if let defaults {
            defaults.set(try? JSONEncoder().encode(draft), forKey: Self.storageKey)
        } else {
            memory = draft
        }
    }

    func clear() {
        defaults?.removeObject(forKey: Self.storageKey)
        memory = nil
    }
}
