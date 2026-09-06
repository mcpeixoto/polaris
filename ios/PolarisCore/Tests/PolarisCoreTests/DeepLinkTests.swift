import Foundation
import Testing
@testable import PolarisCore

// Every link form the app accepts, in both the `polaris://` and the web shape, and the
// inputs it must refuse. The parser is pure, so this is the whole of its contract.

@Suite("DeepLink")
struct DeepLinkTests {
    private func parse(_ string: String) -> DeepLink? {
        DeepLink.parse(URL(string: string)!)
    }

    // MARK: - Issues

    @Test("an issue by identifier, in both shapes")
    func issueByIdentifier() {
        #expect(parse("polaris://issue/ENG-1") == .issue(.identifier("ENG-1")))
        #expect(parse("https://polaris.peixotolabs.com/issue/ENG-1") == .issue(.identifier("ENG-1")))
        #expect(parse("http://localhost:5173/issue/ENG-1") == .issue(.identifier("ENG-1")))
    }

    @Test("an identifier typed in lowercase still lands")
    func issueIdentifierCase() {
        #expect(parse("polaris://issue/eng-12") == .issue(.identifier("ENG-12")))
    }

    @Test("an issue by UUID")
    func issueByID() {
        let id = "019212ab-5a4b-7c2d-8e9f-0a1b2c3d4e5f"
        #expect(parse("polaris://issue/\(id)") == .issue(.id(id)))
        #expect(parse("https://polaris.example/issue/\(id.uppercased())") == .issue(.id(id)))
    }

    @Test("a fragment or query on an issue link does not change where it goes")
    func issueWithFragment() {
        #expect(parse("polaris://issue/ENG-1#comment-5") == .issue(.identifier("ENG-1")))
        #expect(parse("https://h/issue/ENG-1?from=slack") == .issue(.identifier("ENG-1")))
    }

    @Test("a trailing slash is tolerated")
    func trailingSlash() {
        #expect(parse("https://h/issue/ENG-1/") == .issue(.identifier("ENG-1")))
        #expect(parse("https://h/inbox/") == .inbox)
    }

    // MARK: - Places

    @Test("the inbox and my issues")
    func places() {
        #expect(parse("polaris://inbox") == .inbox)
        #expect(parse("polaris://my-issues") == .myIssues)
        #expect(parse("https://polaris.peixotolabs.com/inbox") == .inbox)
        #expect(parse("https://polaris.peixotolabs.com/my-issues") == .myIssues)
    }

    @Test("search, with and without a query")
    func search() {
        #expect(parse("polaris://search") == .search(query: nil))
        #expect(parse("polaris://search?q=sync%20drops") == .search(query: "sync drops"))
        #expect(parse("https://h/search?q=login") == .search(query: "login"))
        // A blank query is no query.
        #expect(parse("polaris://search?q=") == .search(query: nil))
        #expect(parse("polaris://search?q=%20%20") == .search(query: nil))
    }

    @Test("a team, its bare route and each of its pages")
    func team() {
        #expect(parse("polaris://team/ENG") == .team(key: "ENG", page: .issues))
        #expect(parse("https://h/team/ENG") == .team(key: "ENG", page: .issues))
        #expect(parse("https://h/team/ENG/triage") == .team(key: "ENG", page: .triage))
        #expect(parse("https://h/team/ENG/cycles") == .team(key: "ENG", page: .cycles))
        #expect(parse("https://h/team/ENG/projects") == .team(key: "ENG", page: .projects))
        #expect(parse("polaris://team/eng/cycles") == .team(key: "ENG", page: .cycles))
    }

    @Test("projects, and one project")
    func projects() {
        #expect(parse("polaris://projects") == .projects)
        #expect(parse("https://h/projects") == .projects)
        #expect(parse("https://h/project/p-42") == .project(id: "p-42"))
        #expect(parse("polaris://project/019212ab-5a4b-7c2d-8e9f-0a1b2c3d4e5f")
            == .project(id: "019212ab-5a4b-7c2d-8e9f-0a1b2c3d4e5f"))
    }

    @Test("the host of a web link is not checked")
    func anyHost() {
        #expect(parse("https://polaris.example.org/inbox") == .inbox)
        #expect(parse("https://192.168.1.10:8080/issue/OPS-7") == .issue(.identifier("OPS-7")))
    }

    // MARK: - Refusals

    @Test("an unknown scheme is not a link")
    func unknownScheme() {
        #expect(parse("mailto:dev@polaris.local") == nil)
        #expect(parse("ftp://h/issue/ENG-1") == nil)
        #expect(parse("linear://issue/ENG-1") == nil)
    }

    @Test("a bare scheme or root is not a link")
    func bare() {
        #expect(parse("polaris://") == nil)
        #expect(parse("https://polaris.peixotolabs.com") == nil)
        #expect(parse("https://polaris.peixotolabs.com/") == nil)
    }

    @Test("a place this client does not have is refused, not rerouted")
    func unknownPlace() {
        #expect(parse("polaris://settings") == nil)
        #expect(parse("https://h/login") == nil)
        #expect(parse("https://h/cycles") == nil)
        #expect(parse("https://h/issue") == nil)
        #expect(parse("polaris://issue") == nil)
        #expect(parse("polaris://issue/") == nil)
        #expect(parse("polaris://team") == nil)
        #expect(parse("https://h/team/ENG/bogus") == nil)
        // `/team/ENG/issues` is not a route the web client has; the bare key is.
        #expect(parse("https://h/team/ENG/issues") == nil)
        #expect(parse("https://h/issue/ENG-1/extra") == nil)
        #expect(parse("https://h/project") == nil)
    }

    @Test("an issue reference that is neither an identifier nor a UUID is refused")
    func badIssueReference() {
        #expect(parse("polaris://issue/ENG") == nil)
        #expect(parse("polaris://issue/ENG-") == nil)
        #expect(parse("polaris://issue/-1") == nil)
        #expect(parse("polaris://issue/ENG-1-2") == nil)
        #expect(parse("polaris://issue/not%20an%20id") == nil)
        #expect(parse("polaris://issue/ENG_1") == nil)
    }

    @Test("a team key with anything but letters and digits is refused")
    func badTeamKey() {
        #expect(parse("polaris://team/E-NG") == nil)
        #expect(parse("polaris://team/eng%20ops") == nil)
    }
}
