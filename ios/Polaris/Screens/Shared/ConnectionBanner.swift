import SwiftUI
import PolarisCore

/// The "Offline" pill.
///
/// Shown at the top of the shell while the last read failed with something a retry could
/// fix — no network, a timeout, a rate limit, a 5xx — and hidden the moment one succeeds. A
/// refused read (401, 403, 404) is deliberately not a pill: it is a sentence for the screen
/// it happened on, and the session-expiry path already ends at the sign-in screen.
///
/// One pill for the whole app rather than a line per screen. `MyIssuesView` keeps its own
/// "Not up to date" caption because that one is about *that list*; this is about the
/// connection, and it should not multiply by the number of tabs.
struct ConnectionBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.realtime.isDegraded {
            HStack(spacing: Theme.Space.xs) {
                Image(systemName: "wifi.slash")
                    .font(PolarisText.captionSmall.weight(.semibold))
                Text(label)
                    .font(PolarisText.captionSmall.weight(.medium))
            }
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, Theme.Space.md)
            .padding(.vertical, Theme.Space.xs + Theme.Space.xxs)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().stroke(Theme.hairline, lineWidth: 1))
            .padding(.top, Theme.Space.sm)
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("connection.banner")
        }
    }

    /// "Offline" when the device says so; "Reconnecting" for everything else retryable, which
    /// is the honest word for a server that answered 503 or a request that timed out — the
    /// device is online, Polaris is what is not answering.
    private var label: String {
        if case .offline = model.realtime.lastFailure {
            return String(localized: "Offline")
        }
        return String(localized: "Reconnecting")
    }
}

/// Reloads a screen's own store when a sync signal arrives.
///
/// The coordinator refetches the stores it owns — the issue list and the inbox — but a
/// detail screen or a team's list holds a store of its own that the coordinator has never
/// heard of. Those adopt this: `.refreshOnRealtime { await store.load() }`. The trigger is
/// `changeVersion`, which bumps once per coalesced signal, so a burst of deltas is one reload.
///
/// Two things suspend the reload, and `RealtimeRefreshGate` replays whichever signal was
/// missed once they lift:
///
/// - **Off screen.** A pushed-away screen keeps its `onChange` — the four screens under a
///   team hub even share one store — so without this a signal costs one read per screen in
///   the stack, none of them visible. The replay on return is the useful half: coming back to
///   a hub that went stale while you were three screens deep reloads it.
/// - **Busy**, which the screen defines: an open composer, a picker sheet, a write in flight.
///   Reloading under a cursor replaces text somebody is typing, and reloading over an
///   optimistic row rolls it back to a state the server has not been told about yet.
struct RefreshOnRealtime: ViewModifier {
    @Environment(AppModel.self) private var model
    let isSuspended: Bool
    let action: @MainActor () async -> Void
    @State private var gate = RealtimeRefreshGate()
    @State private var isVisible = false
    @State private var hasAppeared = false

    func body(content: Content) -> some View {
        content
            .onAppear {
                isVisible = true
                // The first appearance rides in with the screen's own `.task`, which loads at
                // whatever version stands now; refetching for it would be that same read twice.
                guard hasAppeared else {
                    hasAppeared = true
                    gate.seed(model.realtime.changeVersion)
                    return
                }
                refreshIfDue()
            }
            .onDisappear { isVisible = false }
            .onChange(of: model.realtime.changeVersion) { _, _ in refreshIfDue() }
            .onChange(of: isSuspended) { _, _ in refreshIfDue() }
    }

    private func refreshIfDue() {
        let suspended = !isVisible || isSuspended
        guard gate.reached(version: model.realtime.changeVersion, isSuspended: suspended) else { return }
        Task { await action() }
    }
}

extension View {
    /// - Parameter isSuspended: True while a reload would be hostile — a composer with text in
    ///   it, a sheet editing a value, a write the server has not answered yet. The signal is
    ///   not dropped; it is replayed when this goes false.
    func refreshOnRealtime(
        isSuspended: Bool = false,
        _ action: @escaping @MainActor () async -> Void
    ) -> some View {
        modifier(RefreshOnRealtime(isSuspended: isSuspended, action: action))
    }
}
