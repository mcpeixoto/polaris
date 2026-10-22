import XCTest
import PolarisCore
@testable import Polaris

/// What the favourites section on Home decides to show.
///
/// The store's own resolving is covered in PolarisCore. These are the three decisions the
/// section makes on top of it, each of which is a way to lie to the reader: appearing empty
/// over content they were looking at, swallowing a favourite it cannot draw, or growing until
/// it pushes My Issues off the bottom of the screen.
///
/// Rows come from a `FixturePolarisClient` built with its own favourites rather than from the
/// shared fixture seed, because the parity suites pin that seed at exactly one favourite.
@MainActor
final class FavoritesPresentationTests: XCTestCase {
    private func rows(_ favorites: [Favorite]) async -> (rows: [FavoriteRow], unavailable: Int) {
        let api = FixturePolarisClient(favorites: favorites)
        let workspace = WorkspaceDataStore(api: api)
        await workspace.load()
        let store = FavoritesStore(api: api)
        await store.load(from: workspace)
        return (store.rows.value ?? [], store.unavailable)
    }

    func testOneRowPerResolvedFavorite() async {
        let resolved = await rows([
            Favorite(id: "f1", kind: .team, targetId: "t1", name: nil),
            Favorite(id: "f2", kind: .project, targetId: "p1", name: nil),
            Favorite(id: "f3", kind: .issue, targetId: "i3", name: nil),
        ])

        XCTAssertTrue(FavoritesPresentation.isShown(rows: resolved.rows, unavailable: resolved.unavailable))
        XCTAssertEqual(FavoritesPresentation.visible(resolved.rows).map(\.id), ["f1", "f2", "f3"])
        XCTAssertEqual(FavoritesPresentation.overflow(resolved.rows), 0)
        XCTAssertNil(
            FavoritesPresentation.unavailableLine(resolved.unavailable),
            "nothing is missing, so there is nothing to confess"
        )
    }

    func testNothingStarredShowsNoSection() async {
        let resolved = await rows([])

        XCTAssertTrue(resolved.rows.isEmpty)
        XCTAssertFalse(
            FavoritesPresentation.isShown(rows: resolved.rows, unavailable: resolved.unavailable),
            "an empty state above a busy screen is noise"
        )
    }

    func testFavoritesThisBuildCannotOpenAreStatedAndCounted() async {
        let resolved = await rows([
            Favorite(id: "f1", kind: .issue, targetId: "i3", name: nil),
            Favorite(id: "f2", kind: .view, targetId: "v1", name: nil),
            Favorite(id: "f3", kind: .other, targetId: "doc1", name: nil),
        ])

        XCTAssertEqual(FavoritesPresentation.visible(resolved.rows).map(\.id), ["f1"])
        XCTAssertEqual(
            FavoritesPresentation.unavailableLine(resolved.unavailable),
            "2 favorites can't be opened on iPhone yet"
        )
    }

    /// The section still appears when every favourite is one it cannot draw. The sentence is
    /// then the only evidence the reader has that what they starred still exists.
    func testASectionOfNothingButUnopenableFavoritesStillAppears() async {
        let resolved = await rows([
            Favorite(id: "f1", kind: .folder, targetId: "fold1", name: "Planning"),
        ])

        XCTAssertTrue(resolved.rows.isEmpty)
        XCTAssertTrue(FavoritesPresentation.isShown(rows: resolved.rows, unavailable: resolved.unavailable))
        XCTAssertEqual(
            FavoritesPresentation.unavailableLine(resolved.unavailable),
            "1 favorite can't be opened on iPhone yet"
        )
    }

    func testALongListIsCappedAndOffersTheRest() async {
        let favorites = (1...FavoritesPresentation.limit + 2).map {
            Favorite(id: "f\($0)", kind: .label, targetId: "lab\(($0 % 5) + 1)", name: nil)
        }
        let resolved = await rows(favorites)

        XCTAssertEqual(resolved.rows.count, FavoritesPresentation.limit + 2)
        XCTAssertEqual(FavoritesPresentation.visible(resolved.rows).count, FavoritesPresentation.limit)
        XCTAssertEqual(FavoritesPresentation.overflow(resolved.rows), 2)
        XCTAssertEqual(
            FavoritesPresentation.visible(resolved.rows).map(\.id),
            Array(resolved.rows.prefix(FavoritesPresentation.limit)).map(\.id),
            "the cap takes the first rows, in the order the server sent them"
        )
    }
}
