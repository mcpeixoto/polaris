import Foundation

/// A link into the app, parsed from either the `polaris://` scheme or a web URL.
///
/// The two forms name the same places: `polaris://issue/ENG-1` is what the desktop app
/// registers (`desktop/src/main/main.ts`, `routeOf`) and `https://<host>/issue/ENG-1` is the
/// web client's own route for it, so a link copied from any client opens the issue in
/// whichever client the receiving device has. The host of a web link is deliberately not
/// checked here — the associated-domains entitlement is what decides which hosts reach the
/// app at all, and a parser that second-guessed it would have to be updated every time a
/// self-hosted instance changed its domain.
///
/// Pure: no I/O, no lookups. Resolving `ENG-1` to an issue is the caller's job, because it
/// needs a session and this does not.
public enum DeepLink: Equatable, Sendable {
    /// How an issue link names its issue. Both forms are on the wire: the web client links by
    /// identifier, and a notification payload carries the UUID.
    public enum IssueReference: Equatable, Sendable {
        case identifier(String)
        case id(String)
    }

    /// The pages of a team's hub. `issues` is the bare `/team/<KEY>` route.
    public enum TeamPage: String, Equatable, Sendable, CaseIterable {
        case issues
        case triage
        case cycles
        case projects
    }

    case issue(IssueReference)
    case inbox
    case myIssues
    case search(query: String?)
    case team(key: String, page: TeamPage)
    case projects
    case project(id: String)

    /// The parsed link, or nil for anything that is not one — including a well-formed URL to
    /// a page this client does not have. Nil, not a fallback to the home screen: a link that
    /// silently lands somewhere else is worse than one that does nothing.
    public static func parse(_ url: URL) -> DeepLink? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased()
        else { return nil }

        // `polaris://issue/ENG-1` puts the first segment in the host; `https://h/issue/ENG-1`
        // puts every segment in the path. Normalising to one list is what lets the two forms
        // share a single table below.
        var segments = url.pathComponents.filter { $0 != "/" }
        switch scheme {
        case "polaris":
            guard let host = components.host, !host.isEmpty else { return nil }
            segments.insert(host, at: 0)
        case "http", "https":
            break
        default:
            return nil
        }

        let query = components.queryItems ?? []

        switch segments.count {
        case 1:
            switch segments[0].lowercased() {
            case "inbox": return .inbox
            case "my-issues": return .myIssues
            case "search":
                let q = query.first { $0.name == "q" }?.value?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return .search(query: (q?.isEmpty ?? true) ? nil : q)
            case "projects": return .projects
            default: return nil
            }
        case 2:
            let value = segments[1]
            switch segments[0].lowercased() {
            case "issue": return issueReference(value).map(DeepLink.issue)
            case "team": return teamKey(value).map { .team(key: $0, page: .issues) }
            case "project": return isPlausibleID(value) ? .project(id: value) : nil
            default: return nil
            }
        case 3:
            guard segments[0].lowercased() == "team",
                  let key = teamKey(segments[1]),
                  let page = TeamPage(rawValue: segments[2].lowercased()),
                  page != .issues
            else { return nil }
            return .team(key: key, page: page)
        default:
            return nil
        }
    }

    /// `ENG-1` or a UUID. Identifiers are uppercased because that is how the server mints
    /// them (`WorkspaceDraft.teamKey(from:)`), and a link typed by hand in lowercase should
    /// still land.
    static func issueReference(_ raw: String) -> IssueReference? {
        if UUID(uuidString: raw) != nil { return .id(raw.lowercased()) }
        let upper = raw.uppercased()
        guard upper.range(of: "^[A-Z0-9]+-[0-9]+$", options: .regularExpression) != nil else {
            return nil
        }
        return .identifier(upper)
    }

    /// A team key: letters and digits only, as `WorkspaceDraft.teamKey(from:)` produces.
    static func teamKey(_ raw: String) -> String? {
        let upper = raw.uppercased()
        guard !upper.isEmpty,
              upper.range(of: "^[A-Z0-9]+$", options: .regularExpression) != nil
        else { return nil }
        return upper
    }

    /// Server ids are UUIDs, but the parser does not insist: an id it cannot resolve fails
    /// at the lookup with a `notFound`, which is the right place for that to surface. What it
    /// rejects is the obviously wrong — whitespace, slashes and the empty string.
    static func isPlausibleID(_ raw: String) -> Bool {
        !raw.isEmpty && raw.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
    }
}
