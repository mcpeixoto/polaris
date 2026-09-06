import Foundation
import PolarisCore

/// One activity entry as a sentence, the way the web client says it.
///
/// The server records a status change as its *values* — `{id, name}` — and an assignee
/// change as an id, because a status renamed later should not rewrite what the feed says
/// happened, while a person renamed later should be called by their current name. `Names`
/// is what resolves the ids; a value that resolves to nothing is shown as it came, which is
/// wrong-looking rather than silent.
enum HistoryText {
    /// Whatever the screen can look an id up in. Plain dictionaries rather than the store,
    /// so the formatter is a function of its inputs and a test can hand it three names.
    struct Names {
        var users: [String: String] = [:]
        var states: [String: String] = [:]
        var labels: [String: String] = [:]
        var projects: [String: String] = [:]
        var cycles: [String: String] = [:]
        var issues: [String: String] = [:]

        init(
            users: [String: String] = [:],
            states: [String: String] = [:],
            labels: [String: String] = [:],
            projects: [String: String] = [:],
            cycles: [String: String] = [:],
            issues: [String: String] = [:]
        ) {
            self.users = users
            self.states = states
            self.labels = labels
            self.projects = projects
            self.cycles = cycles
            self.issues = issues
        }
    }

    /// "Ana Silva changed status from Todo to In Progress" — the actor and the sentence.
    static func line(for entry: IssueHistoryEntry, names: Names) -> String {
        "\(actorName(entry.actor, names: names)) \(describe(entry, names: names))"
    }

    static func describe(_ entry: IssueHistoryEntry, names: Names) -> String {
        describe(kind: entry.kind, from: entry.fromValue, to: entry.toValue, names: names)
    }

    static func actorName(_ actor: Actor, names: Names) -> String {
        switch actor.type {
        case .system: return "Polaris"
        case .integration: return "An integration"
        case .user, .appUser:
            guard let id = actor.id else { return "Somebody" }
            return names.users[id] ?? "Somebody"
        }
    }

    /// The sentence after the actor's name. Kinds arrive as the server spells them —
    /// `due_date` from the Go side, `dueDate` from a feed the web wrote — so both are read.
    static func describe(kind: String, from: JSONValue?, to: JSONValue?, names: Names) -> String {
        switch kind {
        case "created":
            return "created the issue"
        case "state", "status":
            if let previous = value(from, lookup: names.states) {
                return "changed status from \(previous) to \(value(to, lookup: names.states) ?? "nothing")"
            }
            return "set status to \(value(to, lookup: names.states) ?? "nothing")"
        case "assignee":
            if isEmpty(to) {
                return "unassigned \(value(from, lookup: names.users) ?? "nobody")"
            }
            return "assigned it to \(value(to, lookup: names.users) ?? "somebody")"
        case "priority":
            return "changed priority from \(priority(from)) to \(priority(to))"
        case "title":
            return "renamed it from “\(value(from) ?? "nothing")” to “\(value(to) ?? "nothing")”"
        case "description":
            return "edited the description"
        case "archived":
            return "archived the issue"
        case "unarchived", "restored":
            return "restored the issue"
        case "deleted":
            return "deleted the issue"
        case "label", "labels", "label_added", "label_removed":
            if isEmpty(to) {
                return "removed the label \(value(from, lookup: names.labels) ?? "nothing")"
            }
            return "added the label \(value(to, lookup: names.labels) ?? "nothing")"
        case "project":
            return moved(to, lookup: names.projects, cleared: "took it out of the project", moved: "put it in")
        case "cycle":
            return moved(to, lookup: names.cycles, cleared: "took it out of the cycle", moved: "moved it to")
        case "parent":
            return moved(to, lookup: names.issues, cleared: "made it a top-level issue", moved: "made it a sub-issue of")
        case "estimate":
            if isEmpty(to) { return "removed the estimate" }
            return "estimated it at \(value(to) ?? "nothing")"
        case "due_date", "dueDate":
            if isEmpty(to) { return "cleared the due date" }
            let raw = value(to) ?? "nothing"
            return "set the due date to \(DueDateFormat.present(raw)?.text ?? raw)"
        case "relation":
            return moved(to, lookup: names.issues, cleared: "removed a link", moved: "linked it to")
        case "subscribe", "subscription":
            if case .bool(false) = to { return "stopped watching the issue" }
            return "started watching the issue"
        default:
            // A newer server may record a kind this build has never heard of. Naming it is
            // better than dropping the row — a gap in a permanent record — and `due_date`
            // reads "due date" rather than raw.
            return "changed the \(humanise(kind))"
        }
    }

    // MARK: - Values

    /// The display form of a history value: an object's `name`, a string resolved through
    /// the lookup when it is an id, a number as digits. Nil for nothing.
    private static func value(_ json: JSONValue?, lookup: [String: String] = [:]) -> String? {
        switch json {
        case .string(let raw):
            return lookup[raw] ?? raw
        case .object(let fields):
            if let name = fields["name"]?.stringValue { return name }
            if let identifier = fields["identifier"]?.stringValue { return identifier }
            if let id = fields["id"]?.stringValue { return lookup[id] ?? id }
            return nil
        case .int(let number):
            return String(number)
        case .double(let number):
            return number.rounded() == number ? String(Int(number)) : String(number)
        case .bool(let flag):
            return flag ? "yes" : "no"
        case .array, .null, .none:
            return nil
        }
    }

    private static func isEmpty(_ json: JSONValue?) -> Bool {
        switch json {
        case .none, .null: true
        case .string(let raw): raw.isEmpty
        default: false
        }
    }

    private static func priority(_ json: JSONValue?) -> String {
        let raw: Int? = switch json {
        case .int(let number): number
        case .double(let number): Int(number)
        case .string(let text): Int(text)
        default: nil
        }
        if let raw, let level = Priority(rawValue: raw) { return level.label }
        return value(json) ?? "none"
    }

    private static func moved(_ to: JSONValue?, lookup: [String: String], cleared: String, moved: String) -> String {
        if isEmpty(to) { return cleared }
        return "\(moved) \(value(to, lookup: lookup) ?? "nothing")"
    }

    /// `dueDate` and `due_date` both become "due date".
    private static func humanise(_ kind: String) -> String {
        var out = ""
        var previousWasLower = false
        for character in kind {
            if character == "_" || character == "-" {
                out.append(" ")
                previousWasLower = false
            } else if character.isUppercase, previousWasLower {
                out.append(" ")
                out.append(character.lowercased())
                previousWasLower = false
            } else {
                out.append(character.lowercased())
                previousWasLower = character.isLowercase || character.isNumber
            }
        }
        return out
    }
}

/// The thread under an issue: history and comments, one list, oldest first.
enum IssueActivity {
    enum Item: Identifiable {
        case event(IssueHistoryEntry)
        case comment(Comment)

        var id: String {
            switch self {
            case .event(let entry): "event-\(entry.id)"
            case .comment(let comment): "comment-\(comment.id)"
            }
        }

        var date: Date {
            switch self {
            case .event(let entry): entry.createdAt
            case .comment(let comment): comment.createdAt
            }
        }
    }

    /// Stable on ties, so a comment and the system event it caused keep the order the server
    /// wrote them in rather than swapping on every render.
    static func merge(history: [IssueHistoryEntry], comments: [Comment]) -> [Item] {
        let items = history.map(Item.event) + comments.map(Item.comment)
        return items.enumerated().sorted { left, right in
            if left.element.date != right.element.date { return left.element.date < right.element.date }
            return left.offset < right.offset
        }.map(\.element)
    }
}
