import Foundation

/// Decides whether a screen that holds its own store should refetch right now.
///
/// `RealtimeCoordinator` refetches the stores it owns and bumps `changeVersion` for the rest;
/// a screen with a store of its own watches that number. Watching it naively is wrong twice
/// over: a screen that has been pushed away is not on screen and has no business issuing
/// reads, and a refetch landing under an open composer replaces text somebody is typing.
/// Both cases suspend, and both must still refetch once when the suspension lifts — a screen
/// that missed a signal and never asks again is exactly the staleness this is meant to end.
///
/// The whole state is the version last acted on, so several signals during one suspension
/// collapse into a single refetch when it ends, and a resume with nothing missed does nothing.
///
/// A value type in Core rather than state buried in the view modifier that drives it, because
/// the only test target that can see a view modifier is a simulator run.
public struct RealtimeRefreshGate: Sendable, Equatable {
    /// The `changeVersion` the screen's data is known to reflect.
    public private(set) var lastHandled: Int

    public init(lastHandled: Int = 0) {
        self.lastHandled = lastHandled
    }

    /// Adopts a version without refetching for it — the screen has just loaded at it.
    public mutating func seed(_ version: Int) {
        lastHandled = version
    }

    /// Whether to refetch now. Called on a signal, and again whenever the screen becomes
    /// visible or stops being busy.
    public mutating func reached(version: Int, isSuspended: Bool) -> Bool {
        guard version > lastHandled else { return false }
        guard !isSuspended else { return false }
        lastHandled = version
        return true
    }
}
