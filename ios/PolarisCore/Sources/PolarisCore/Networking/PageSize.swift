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
}
