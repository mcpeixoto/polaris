import XCTest
import PolarisCore
@testable import Polaris

/// The pure helpers behind the inbox, search and settings work: when a snooze lands, how the
/// recent-search list is kept, how the twenty notification types fold into six switches, and
/// what an inbox row says.
final class ComposeInboxSettingsHelperTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }()

    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    private func components(_ date: Date) -> DateComponents {
        utc.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: date)
    }

    // MARK: - Snooze

    func testLaterTodayIsThreeHoursOut() {
        let now = date("2026-09-02T14:20:00Z")  // a Wednesday
        XCTAssertEqual(SnoozeOption.laterToday.date(from: now, calendar: utc), date("2026-09-02T17:20:00Z"))
    }

    func testTomorrowLandsAtNineInTheMorning() {
        let now = date("2026-09-02T23:50:00Z")
        let parts = components(SnoozeOption.tomorrow.date(from: now, calendar: utc))
        XCTAssertEqual(parts.day, 3)
        XCTAssertEqual(parts.hour, 9)
        XCTAssertEqual(parts.minute, 0)
    }

    func testNextWeekIsTheComingMondayAtNine() {
        let wednesday = date("2026-09-02T14:20:00Z")
        let parts = components(SnoozeOption.nextWeek.date(from: wednesday, calendar: utc))
        XCTAssertEqual(parts.weekday, 2, "Monday")
        XCTAssertEqual(parts.day, 7)
        XCTAssertEqual(parts.hour, 9)
    }

    func testNextWeekOnAMondayIsSevenDaysAwayNotToday() {
        let monday = date("2026-09-07T08:00:00Z")
        let parts = components(SnoozeOption.nextWeek.date(from: monday, calendar: utc))
        XCTAssertEqual(parts.weekday, 2)
        XCTAssertEqual(parts.day, 14, "a Monday morning's 'next week' is next Monday, not later today")
    }

    func testNextWeekOnASundayIsTomorrow() {
        let sunday = date("2026-09-06T20:00:00Z")
        let parts = components(SnoozeOption.nextWeek.date(from: sunday, calendar: utc))
        XCTAssertEqual(parts.weekday, 2)
        XCTAssertEqual(parts.day, 7)
    }

    // MARK: - Recent searches

    func testRecentSearchesDedupeCaseInsensitivelyAndMoveToFront() {
        var list = RecentSearches.adding("sync", to: [])
        list = RecentSearches.adding("reconnect", to: list)
        list = RecentSearches.adding("  Sync ", to: list)
        XCTAssertEqual(list, ["Sync", "reconnect"], "the newer spelling wins and moves to the front")
    }

    func testRecentSearchesIgnoreBlankAndCapAtEight() {
        var list: [String] = []
        for index in 1...10 { list = RecentSearches.adding("q\(index)", to: list) }
        XCTAssertEqual(list.count, RecentSearches.limit)
        XCTAssertEqual(list.first, "q10")
        XCTAssertEqual(list.last, "q3", "the two oldest fell off")
        XCTAssertEqual(RecentSearches.adding("   ", to: list), list, "blank is not a search")
    }

    @MainActor
    func testRecentSearchesRoundTripThroughDefaults() {
        let suite = "polaris.tests.recent.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let first = RecentSearches(defaults: defaults)
        first.remember("alpha")
        first.remember("beta")
        let second = RecentSearches(defaults: defaults)
        XCTAssertEqual(second.items, ["beta", "alpha"])
        second.remove("alpha")
        XCTAssertEqual(RecentSearches(defaults: defaults).items, ["beta"])
        second.clear()
        XCTAssertEqual(RecentSearches(defaults: defaults).items, [])
    }

    @MainActor
    func testRecentSearchesWithoutDefaultsStayInMemory() {
        let store = RecentSearches(defaults: nil)
        store.remember("ephemeral")
        XCTAssertEqual(store.items, ["ephemeral"])
        XCTAssertEqual(RecentSearches(defaults: nil).items, [], "nothing is written anywhere")
    }

    // MARK: - Notification groups

    func testEveryNotificationTypeBelongsToExactlyOneGroup() {
        let all: [PolarisNotificationType] = [
            .issueAssigned, .issueStatusChanged, .issuePriorityRaised, .issueDue, .issueBlocked,
            .comment, .mention, .subIssueCompleted, .viewIssueAdded, .viewIssueCompleted,
            .pulseDigest, .projectIssueAdded, .projectIssueCompleted, .projectUpdate,
            .initiativeIssueAdded, .initiativeIssueCompleted, .initiativeUpdate,
            .customerRequestAdded, .customerRequestImportant, .customerRequestCompleted,
        ]
        let grouped = NotificationGroup.allCases.flatMap(\.types)
        XCTAssertEqual(grouped.count, 20)
        XCTAssertEqual(Set(grouped), Set(all), "twenty server types, each in one group")
        XCTAssertEqual(Set(grouped).count, grouped.count, "no type sits in two groups")
    }

    func testGroupIsOffOnlyWhenEveryTypeInItIsMuted() {
        var prefs = NotificationPrefs(muted: ["COMMENT"])
        XCTAssertTrue(NotificationGroup.commentsAndMentions.isEnabled(in: prefs), "half-muted still reads as on")
        prefs.setMuted(.mention, true)
        XCTAssertFalse(NotificationGroup.commentsAndMentions.isEnabled(in: prefs))
        XCTAssertTrue(NotificationGroup.assignments.isEnabled(in: prefs), "other groups untouched")
    }

    func testSwitchingAGroupMutesAndUnmutesEveryTypeInIt() {
        var prefs = NotificationPrefs(muted: ["PULSE_DIGEST"])
        NotificationGroup.projectsAndInitiatives.setEnabled(false, in: &prefs)
        XCTAssertEqual(Set(prefs.muted), Set(NotificationGroup.projectsAndInitiatives.types.map(\.rawValue)))
        NotificationGroup.projectsAndInitiatives.setEnabled(true, in: &prefs)
        XCTAssertEqual(prefs.muted, [], "the digest that was muted before is unmuted with the rest of its group")
    }

    func testEmailDigestDefaultsToDailyWhenAbsent() {
        XCTAssertEqual(EmailDigest.from(NotificationPrefs()), .daily)
        XCTAssertEqual(EmailDigest.from(NotificationPrefs(emailDigest: "weekly")), .weekly)
        XCTAssertEqual(EmailDigest.from(NotificationPrefs(emailDigest: "fortnightly")), .daily, "an unknown cadence is the default, not a crash")
    }

    // MARK: - Inbox sentences

    func testInboxSentenceNamesTheActorForEveryType() {
        for group in NotificationGroup.allCases {
            for type in group.types {
                let sentence = InboxSentence.text(type: type, actor: "Ana Silva")
                XCTAssertFalse(sentence.isEmpty)
                XCTAssertNotEqual(sentence, PolarisNotificationType.other.summary, "\(type) must not fall back to 'Update'")
                if type != .issueDue, type != .pulseDigest {
                    XCTAssertTrue(sentence.contains("Ana Silva"), "\(type): \(sentence)")
                }
            }
        }
    }

    func testInboxSentenceFallsBackToTheSummaryWithoutAnActor() {
        XCTAssertEqual(InboxSentence.text(type: .mention, actor: nil), PolarisNotificationType.mention.summary)
        XCTAssertEqual(InboxSentence.text(type: .comment, count: 3, actor: nil), "\(PolarisNotificationType.comment.summary) · 3")
        XCTAssertTrue(InboxSentence.text(type: .comment, count: 3, actor: "Ana Silva").contains("3"))
    }

    // MARK: - Compose draft

    func testComposeDraftIsEmptyWithoutWordsAndRoundTrips() throws {
        var draft = ComposeDraft(teamId: "t1", priority: 1, labelIds: ["lab1"])
        XCTAssertTrue(draft.isEmpty, "properties alone are not a draft")
        draft.title = "  "
        XCTAssertTrue(draft.isEmpty)
        draft.details = "a thought"
        XCTAssertFalse(draft.isEmpty)

        let data = try JSONEncoder().encode(draft)
        XCTAssertEqual(try JSONDecoder().decode(ComposeDraft.self, from: data), draft)
    }

    func testComposeDraftStoreKeepsWordsAndDropsEmpties() {
        let suite = "polaris.tests.draft.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let store = ComposeDraftStore(defaults: defaults)
        store.save(ComposeDraft(title: "half-written", teamId: "t1"))
        XCTAssertEqual(ComposeDraftStore(defaults: defaults).load()?.title, "half-written")
        store.save(ComposeDraft(title: "", teamId: "t1"))
        XCTAssertNil(ComposeDraftStore(defaults: defaults).load(), "an empty draft removes the stored one")
        store.save(ComposeDraft(title: "again"))
        store.clear()
        XCTAssertNil(store.load())
    }

    func testWireDayIsTheReadersCalendarDay() {
        XCTAssertEqual(ComposeIssueView.wireDay(date("2026-09-30T23:30:00Z"), calendar: utc), "2026-09-30")
        XCTAssertEqual(ComposeIssueView.wireDay(date("2026-01-05T00:00:00Z"), calendar: utc), "2026-01-05")
    }
}
