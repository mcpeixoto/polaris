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
struct RefreshOnRealtime: ViewModifier {
    @Environment(AppModel.self) private var model
    let action: @MainActor () async -> Void

    func body(content: Content) -> some View {
        content.onChange(of: model.realtime.changeVersion) { _, _ in
            Task { await action() }
        }
    }
}

extension View {
    func refreshOnRealtime(_ action: @escaping @MainActor () async -> Void) -> some View {
        modifier(RefreshOnRealtime(action: action))
    }
}
