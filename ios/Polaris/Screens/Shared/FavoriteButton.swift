import SwiftUI
import PolarisCore

/// The star that puts something in the favourites list, and takes it out again.
///
/// It lived on the team hub and nowhere else, so a project, a cycle and an issue could all be
/// starred by the API and by no gesture in the app. One control for all of them: the glyph,
/// the two colours and the two accessibility labels are the hub's, unchanged, because the
/// star people already know is the one that should appear on the other four screens.
///
/// `identifier` is a parameter rather than derived from the kind: the hub's star is pinned by
/// `team.favorite` in the UI tests, and a control that renames itself when it moves house is
/// a control that quietly breaks them.
struct FavoriteButton: View {
    let kind: FavoriteKind
    let targetId: String
    /// Said in the accessibility label — "Add Engineering to favorites". The visible row or
    /// title already names the thing, so this is the only place the name is spoken.
    let name: String
    var identifier: String

    @Environment(AppModel.self) private var model
    @State private var toggles = 0

    private var isFavorite: Bool {
        model.workspaceData.isFavorite(kind: kind, targetId: targetId)
    }

    var body: some View {
        Button {
            toggles += 1
            Task { await model.workspaceData.toggleFavorite(kind: kind, targetId: targetId) }
        } label: {
            Image(systemName: isFavorite ? "star.fill" : "star")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(isFavorite ? Theme.gold : Theme.textTertiary)
                .hitTarget()
        }
        .buttonStyle(PressableStyle())
        .sensoryFeedback(.impact(weight: .light), trigger: toggles)
        .accessibilityLabel(isFavorite
            ? Text("Remove \(name) from favorites")
            : Text("Add \(name) to favorites"))
        .accessibilityIdentifier(identifier)
    }
}

/// The same toggle as a row in a menu, for the screen whose actions all live in one.
///
/// A star in the issue detail's bar would be a second glyph next to the overflow it belongs
/// in; subscribing — the action closest to this one — is already a row in that menu, and this
/// follows it, glyph and wording included.
struct FavoriteMenuButton: View {
    let kind: FavoriteKind
    let targetId: String

    @Environment(AppModel.self) private var model

    private var isFavorite: Bool {
        model.workspaceData.isFavorite(kind: kind, targetId: targetId)
    }

    var body: some View {
        Button {
            Task { await model.workspaceData.toggleFavorite(kind: kind, targetId: targetId) }
        } label: {
            if isFavorite {
                SwiftUI.Label("Remove from favorites", systemImage: "star.slash")
            } else {
                SwiftUI.Label("Add to favorites", systemImage: "star")
            }
        }
        .accessibilityIdentifier("issue.favorite")
    }
}
