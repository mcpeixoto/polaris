import XCTest

/// Favourites, on the screen rather than in the store.
///
/// The section is the one part of this feature no unit test can reach: its rows carry their
/// navigation link *behind* them, so that the status mark on a starred issue stays a working
/// menu, and whether a tap on such a row opens anything is a question only a running app
/// answers. It did not, once — the section's `.task` was attached to a `Group` that resolved
/// to an `EmptyView`, which silently drops its modifiers, so the list loaded nothing and the
/// section never appeared at all.
///
/// One launch, because a launch costs a minute: the section exists, its row opens the issue,
/// and the issue's own menu offers the star.
@MainActor
final class FavoritesSectionTests: XCTestCase {
    func testFavoritesSectionShowsAStarredIssueAndOpensIt() {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures"]
        app.launch()
        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: 120),
            "fixtures should sign in and land on the issue list"
        )

        let section = app.staticTexts["favorites.section"]
        XCTAssertTrue(
            section.waitForExistence(timeout: 30),
            "the one seeded favourite should draw the section on Home"
        )

        // The fixture's single favourite is ENG-3; the row's label is `IssueRow`'s own.
        let row = app.descendants(matching: .any)["favorites.row.fav1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the starred issue should have a row")
        row.tap()

        XCTAssertTrue(
            app.buttons["issue.menu"].waitForExistence(timeout: 30),
            "tapping a favourite should open the issue behind it"
        )
        app.buttons["issue.menu"].tap()
        XCTAssertTrue(
            app.buttons["Remove from favorites"].waitForExistence(timeout: 10),
            "the issue is starred, so its menu offers to unstar it"
        )
    }
}
