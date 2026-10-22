import Foundation

/// How many rows each list call asks the server for.
///
/// One file, and deliberately not an integer at the call site. The API refuses any single
/// operation scoring over 10,000 complexity points, and the score of a paginated query is not
/// linear in the page size: `IssueFields` contains `labels`, an unpaginated list that inherits
/// the page size from its parent, so the inbox query costs roughly `1.6n² + 17n` points. That
/// curve crosses the ceiling between `first: 73` (9,768 points, served) and `first: 74`
/// (10,020 points, refused) — a cliff nothing about the call site suggests.
///
/// `first: 100` was written at one such call site and shipped, and every iOS inbox in
/// production answered "Too many requests. Try again shortly." until it was found. The gate in
/// `services/internal/complexity/ios_queries_test.go` now scores every document in
/// `GraphQLDocuments` at the largest number in this file, so a page size the client can request
/// is a page size CI has priced. That only works while the numbers live here: a literal at a
/// call site is a page size nothing checks, and the same test fails if it finds one.
public enum PageSize {
    /// The inbox. 4,850 points — under half the ceiling, and far below the cliff at 74.
    public static let inbox = 50

    /// Search results. Carried inside `SearchInput` rather than as a `first:` argument, so the
    /// scorer never sees it and charges the default 50 instead — on the server and in the gate
    /// alike, which is why the two still agree. 4,702 points either way.
    public static let search = 40

    /// The largest selection one bulk edit may send, and deliberately the same 50 the scorer
    /// charges a list the caller did not bound.
    ///
    /// `bulkUpdateIssues` takes no pagination argument, so there is no `first:` to tune — but
    /// `BulkIssuePayload.issues` is a list with `IssueFields` under it, and an unbounded list
    /// is priced at `DefaultPageSize`. Asking the server to change two hundred issues returns
    /// two hundred of them through a selection CI has only ever scored at fifty, which is the
    /// `Query.projects` mistake with the numbers moved around.
    ///
    /// Raising it is not free in the way it looks: the gate scores *every* document at the
    /// largest number in this file, so a cap of 100 here would re-price the inbox at `first:
    /// 100` — the 17,700-point request that caused the outage this file exists for.
    public static let bulkSelection = 50
}
