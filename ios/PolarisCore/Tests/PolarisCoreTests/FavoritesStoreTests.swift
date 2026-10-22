import Foundation
import Testing

@testable import PolarisCore

/// Resolving favourites into rows somebody can tap.
///
/// The store that holds favourites has always known *that* something is starred; nothing
/// knew *what* it was, so the list rendered as a column of uuids and no screen drew it.
/// These are about the two things that can go wrong once it does: a favourite this build
/// cannot open, and one whose target is gone.
///
/// Each case builds its own `FixturePolarisClient` with its own favourites rather than
/// seeding the shared fixture, because `FixtureParityTests` pins that seed at exactly one.
@MainActor
struct FavoritesStoreTests {
    private func workspace(_ favorites: [Favorite], api: FixturePolarisClient) async
        -> WorkspaceDataStore
    {
        let store = WorkspaceDataStore(api: api)
        await store.load()
        return store
    }

    @Test("every kind this client has a screen for resolves into a row")
    func resolvesEveryRenderableKind() async {
        let favorites = [
            Favorite(id: "f1", kind: .team, targetId: "t1", name: nil),
            Favorite(id: "f2", kind: .label, targetId: "lab1", name: nil),
            Favorite(id: "f3", kind: .project, targetId: "p1", name: nil),
            Favorite(id: "f4", kind: .issue, targetId: "i3", name: nil),
            Favorite(id: "f5", kind: .cycle, targetId: "cy1", name: nil),
        ]
        let api = FixturePolarisClient(favorites: favorites)
        let store = FavoritesStore(api: api)

        await store.load(from: await workspace(favorites, api: api))

        #expect(store.rows.value?.count == 5)
        #expect(store.unavailable == 0)
        // The server's order is the reader's arrangement and is kept, not sorted.
        #expect(store.rows.value?.map(\.id) == ["f1", "f2", "f3", "f4", "f5"])
    }

    @Test("a favourite this build cannot open is counted, not silently dropped")
    func countsUnopenableKinds() async {
        // A saved view, a folder, and whatever the server adds next — INITIATIVE and
        // DOCUMENT both decode to `.other`.
        let favorites = [
            Favorite(id: "f1", kind: .issue, targetId: "i3", name: nil),
            Favorite(id: "f2", kind: .view, targetId: "v1", name: nil),
            Favorite(id: "f3", kind: .folder, targetId: "fold1", name: "Planning"),
            Favorite(id: "f4", kind: .other, targetId: "doc1", name: nil),
        ]
        let api = FixturePolarisClient(favorites: favorites)
        let store = FavoritesStore(api: api)

        await store.load(from: await workspace(favorites, api: api))

        #expect(store.rows.value?.map(\.id) == ["f1"])
        #expect(store.unavailable == 3, "three starred things exist and none of them is shown")
    }

    @Test("a target that cannot be loaded costs its own row and not the list")
    func oneMissingTargetKeepsTheRest() async {
        let favorites = [
            Favorite(id: "f1", kind: .issue, targetId: "i3", name: nil),
            Favorite(id: "f2", kind: .issue, targetId: "gone", name: nil),
            Favorite(id: "f3", kind: .team, targetId: "t1", name: nil),
        ]
        let api = FixturePolarisClient(favorites: favorites)
        let store = FavoritesStore(api: api)

        await store.load(from: await workspace(favorites, api: api))

        #expect(store.rows.value?.map(\.id) == ["f1", "f3"])
        #expect(store.unavailable == 1)
    }

    @Test("a starred issue follows a status changed somewhere else")
    func mergesAConfirmedWrite() async {
        let favorites = [Favorite(id: "f1", kind: .issue, targetId: "i3", name: nil)]
        let api = FixturePolarisClient(favorites: favorites)
        let store = FavoritesStore(api: api)
        await store.load(from: await workspace(favorites, api: api))

        guard case .issue(let before) = store.rows.value?.first?.target else {
            Issue.record("the starred issue did not resolve")
            return
        }
        let moved = try? await api.issue(id: "i3")
        guard var moved else {
            Issue.record("the fixture lost i3")
            return
        }
        moved.title = "Renamed somewhere else"
        store.merge(moved)

        guard case .issue(let after) = store.rows.value?.first?.target else {
            Issue.record("the row stopped being an issue")
            return
        }
        #expect(before.title != after.title)
        #expect(after.title == "Renamed somewhere else")
        // The favourite itself is untouched; only what it points at moved.
        #expect(store.rows.value?.first?.favorite.id == "f1")
    }

    @Test("an issue nothing here holds is ignored rather than appended")
    func ignoresAnUnrelatedWrite() async {
        let favorites = [Favorite(id: "f1", kind: .team, targetId: "t1", name: nil)]
        let api = FixturePolarisClient(favorites: favorites)
        let store = FavoritesStore(api: api)
        await store.load(from: await workspace(favorites, api: api))

        if let stray = try? await api.issue(id: "i3") { store.merge(stray) }

        #expect(store.rows.value?.count == 1)
        #expect(store.rows.value?.first?.id == "f1")
    }

    @Test("nothing loaded yet is not an empty favourites list")
    func doesNotClaimEmptyBeforeLoading() async {
        let store = FavoritesStore(api: FixturePolarisClient())
        let untouched = WorkspaceDataStore(api: FixturePolarisClient())

        await store.load(from: untouched)

        #expect(store.rows.value == nil, "an empty state here would be shown over data on its way")
    }
}
