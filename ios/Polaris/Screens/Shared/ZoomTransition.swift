import SwiftUI

/// The namespace a row and the issue it opens share.
///
/// iOS 18's `.navigationTransition(.zoom(sourceID:in:))` needs both ends to name one
/// `Namespace`, and the two ends live in different files — the list draws the row, the stack
/// draws the destination. Carrying it in the environment is the only way to hand a namespace
/// across a `navigationDestination` boundary without threading it through every screen that
/// happens to contain a list.
///
/// Nil is a legitimate value: on iOS 17 there is no zoom transition to wire up, and the
/// modifiers below become no-ops rather than the screens becoming conditional.
private struct IssueTransitionNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    var issueTransitionNamespace: Namespace.ID? {
        get { self[IssueTransitionNamespaceKey.self] }
        set { self[IssueTransitionNamespaceKey.self] = newValue }
    }
}

extension View {
    /// Marks a row as where the detail screen comes from.
    @ViewBuilder
    func issueTransitionSource(_ id: String, in namespace: Namespace.ID?) -> some View {
        if #available(iOS 18.0, *), let namespace {
            matchedTransitionSource(id: id, in: namespace)
        } else {
            // The deployment target is 17.0, where the stock push is the only transition
            // there is. Gated rather than raised: an animation is not worth a year of devices.
            self
        }
    }

    /// Marks a screen as the thing that grew out of that row.
    @ViewBuilder
    func issueTransitionDestination(_ id: String, in namespace: Namespace.ID?) -> some View {
        if #available(iOS 18.0, *), let namespace {
            navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            self
        }
    }
}
