import XCTest
import PolarisCore
@testable import Polaris

/// The pure helpers behind the team, cycles and projects screens: how a team's cycles are
/// bucketed, how long one has left, and how a planning date range is said. Every one takes
/// its clock as an argument, so these hold at midnight and at noon alike.
final class PlanningPresentationTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }()

    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    /// A cycle from the wire shape, since `Cycle` has no memberwise initialiser on purpose.
    private func makeCycle(
        id: String, number: Int, name: String = "",
        starts: String, ends: String, completed: String? = nil
    ) throws -> Cycle {
        let json = """
        {"id":"\(id)","teamId":"t1","number":\(number),"name":"\(name)","description":null,
         "startsAt":"\(starts)","endsAt":"\(ends)","completedAt":\(completed.map { "\"\($0)\"" } ?? "null")}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Cycle.self, from: Data(json.utf8))
    }

    // MARK: - Bucketing

    func testBucketsSplitRunningQueuedAndFinished() throws {
        let now = date("2026-09-06T12:00:00Z")
        let past = try makeCycle(id: "a", number: 1, starts: "2026-08-01T00:00:00Z", ends: "2026-08-15T00:00:00Z")
        let older = try makeCycle(id: "b", number: 2, starts: "2026-07-01T00:00:00Z", ends: "2026-07-15T00:00:00Z")
        let active = try makeCycle(id: "c", number: 3, starts: "2026-09-01T00:00:00Z", ends: "2026-09-15T00:00:00Z")
        let later = try makeCycle(id: "d", number: 5, starts: "2026-10-01T00:00:00Z", ends: "2026-10-15T00:00:00Z")
        let next = try makeCycle(id: "e", number: 4, starts: "2026-09-15T00:00:00Z", ends: "2026-10-01T00:00:00Z")

        let buckets = CycleBuckets.bucket([later, past, next, older, active], at: now)

        XCTAssertEqual(buckets.active.map(\.id), ["c"])
        XCTAssertEqual(buckets.upcoming.map(\.id), ["e", "d"], "soonest start first")
        XCTAssertEqual(buckets.past.map(\.id), ["a", "b"], "most recently ended first")
    }

    func testACycleClosedEarlyIsPastEvenInsideItsDates() throws {
        let now = date("2026-09-06T12:00:00Z")
        let closed = try makeCycle(
            id: "a", number: 1,
            starts: "2026-09-01T00:00:00Z", ends: "2026-09-15T00:00:00Z",
            completed: "2026-09-05T00:00:00Z"
        )
        let buckets = CycleBuckets.bucket([closed], at: now)
        XCTAssertTrue(buckets.active.isEmpty, "a completed cycle is not running, whatever its dates say")
        XCTAssertEqual(buckets.past.map(\.id), ["a"])
    }

    func testTheFixtureCyclesBucketAsTheScreensExpect() {
        let now = Date()
        let buckets = CycleBuckets.bucket(FixtureData.cycles, at: now)
        XCTAssertEqual(buckets.active.map(\.id), ["cy1"])
        XCTAssertEqual(buckets.upcoming.map(\.id), ["cy2"])
        XCTAssertTrue(buckets.past.isEmpty)

        // A month on, both are over, the later one first.
        let later = CycleBuckets.bucket(FixtureData.cycles, at: now.addingTimeInterval(30 * 86_400))
        XCTAssertEqual(later.past.map(\.id), ["cy2", "cy1"])
    }

    func testBucketingNothingIsNothing() {
        let buckets = CycleBuckets.bucket([], at: .now)
        XCTAssertTrue(buckets.active.isEmpty && buckets.upcoming.isEmpty && buckets.past.isEmpty)
    }

    // MARK: - Days remaining

    /// The rows compute their count without a store; it must be the count the detail screen
    /// gets from `CycleStore`, or the two screens disagree about the same cycle.
    @MainActor
    func testDaysRemainingAgreesWithCycleStore() {
        let cycle = FixtureData.activeCycle
        let store = CycleStore(api: FixturePolarisClient(), cycle: cycle)
        for offset in [0.0, 0.4, 1.0, 3.5, 6.9, 7.0, 9.0] {
            let now = cycle.startsAt.addingTimeInterval(offset * 86_400)
            XCTAssertEqual(
                CycleBuckets.daysRemaining(cycle, at: now),
                store.daysRemaining(at: now),
                "at \(offset) days in"
            )
        }
    }

    func testTimingWordsForEachPhase() throws {
        let cycle = try makeCycle(id: "a", number: 1, starts: "2026-09-01T00:00:00Z", ends: "2026-09-15T00:00:00Z")

        XCTAssertEqual(CycleBuckets.timing(cycle, at: date("2026-09-05T00:00:00Z")), "10 days left")
        XCTAssertEqual(CycleBuckets.timing(cycle, at: date("2026-09-14T06:00:00Z")), "1 day left")
        XCTAssertEqual(CycleBuckets.timing(cycle, at: date("2026-09-15T00:00:00Z")), "Ended")
        XCTAssertEqual(CycleBuckets.timing(cycle, at: date("2026-08-25T00:00:00Z")), "Starts in 7 days")
        XCTAssertEqual(CycleBuckets.timing(cycle, at: date("2026-08-31T06:00:00Z")), "Starts tomorrow")

        let closed = try makeCycle(
            id: "b", number: 2, starts: "2026-09-01T00:00:00Z", ends: "2026-09-15T00:00:00Z",
            completed: "2026-09-10T00:00:00Z"
        )
        XCTAssertEqual(CycleBuckets.timing(closed, at: date("2026-09-05T00:00:00Z")), "Completed")
    }

    // MARK: - Dates

    func testRangeOmitsTheYearWhenBothEndsAreThisYear() {
        let now = date("2026-09-06T12:00:00Z")
        let text = PlanningDates.range(
            date("2026-08-30T00:00:00Z"), date("2026-09-13T00:00:00Z"),
            now: now, calendar: utc
        )
        XCTAssertTrue(text.contains("30"), text)
        XCTAssertTrue(text.contains("13"), text)
        XCTAssertFalse(text.contains("2026"), "same year, so no year: \(text)")
        XCTAssertTrue(text.contains("–"), "the two ends are joined by an en dash: \(text)")
    }

    func testRangeSaysTheYearWhenEitherEndIsOutsideThisOne() {
        let now = date("2026-09-06T12:00:00Z")
        let text = PlanningDates.range(
            date("2026-12-20T00:00:00Z"), date("2027-01-10T00:00:00Z"),
            now: now, calendar: utc
        )
        XCTAssertTrue(text.contains("2027"), "a cycle crossing the year boundary has to say so: \(text)")
    }

    func testSpanCoversEveryCombinationOfProjectDates() {
        let now = date("2026-09-06T12:00:00Z")
        let both = PlanningDates.span(start: "2026-08-01", target: "2026-10-15", now: now, calendar: utc)
        XCTAssertNotNil(both)
        XCTAssertTrue(both!.contains("→"), both!)
        XCTAssertTrue(PlanningDates.span(start: nil, target: "2026-10-15", now: now, calendar: utc)!.hasPrefix("Due"))
        XCTAssertTrue(PlanningDates.span(start: "2026-08-01", target: nil, now: now, calendar: utc)!.hasPrefix("From"))
        XCTAssertNil(PlanningDates.span(start: nil, target: nil, now: now, calendar: utc))
        XCTAssertNil(PlanningDates.day("not a day", now: now, calendar: utc), "a malformed day is no day, not a lie")
    }
}
