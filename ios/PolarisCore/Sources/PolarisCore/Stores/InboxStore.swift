import Foundation
import Observation

/// The inbox: what happened, and what the reader can do about it.
///
/// Pull-only. The server has no push infrastructure — no device-token schema, no APNs sender —
/// so there is nothing to register for and nothing to receive. The badge and this list are
/// refreshed alongside the issue list's freshness poll, and "push notifications" stays a
/// backend project rather than an iOS omission. See ios/README.md.
@MainActor
@Observable
public final class InboxStore {
    public private(set) var notifications: Loadable<[PolarisNotification]> = .idle
    /// The tab badge. Held separately from the list because it is polled far more often than
    /// the list is opened, and a badge that only updates when you look at the inbox is not a
    /// badge.
    public private(set) var unreadCount = 0
    public private(set) var actionError: PolarisError?

    public var onUnauthorized: (@MainActor (PolarisError) -> Void)?

    private let api: any PolarisAPI

    public init(api: any PolarisAPI) {
        self.api = api
    }

    public func load() async {
        if notifications.value == nil { notifications = .loading }
        do {
            let fetched = try await api.notifications()
            notifications = .loaded(fetched.sorted { $0.createdAt > $1.createdAt })
            unreadCount = fetched.filter { !$0.isRead }.count
        } catch {
            let mapped = PolarisError.mapped(error)
            // Same rule as the issue list: a failed refresh must not blank an inbox somebody
            // is reading.
            if notifications.value == nil { notifications = .failed(mapped) }
            if case .unauthorized = mapped { onUnauthorized?(mapped) }
        }
    }

    /// The badge, without fetching the list.
    ///
    /// One scalar query, and the only thing polled on a timer. Failure is silent on purpose: a
    /// badge that cannot be refreshed should keep its last value, not announce itself.
    public func refreshBadge() async {
        guard let count = try? await api.unreadNotificationCount() else { return }
        unreadCount = count
    }

    public func markRead(_ notification: PolarisNotification, read: Bool = true) async {
        await mutate(notification) { try await self.api.markNotificationRead(id: $0, read: read) }
            optimistically: { $0.readAt = read ? Date() : nil }
    }

    /// Snoozes until a moment in the future. `until` nil un-snoozes.
    public func snooze(_ notification: PolarisNotification, until: Date?) async {
        await mutate(notification) { try await self.api.snoozeNotification(id: $0, until: until) }
            optimistically: { $0.snoozedUntil = until }
    }

    /// Removes a row. Optimistic like the rest, and restored in place — not appended — if the
    /// server refuses, because a row that reappears at the top of an inbox reads as a new
    /// notification.
    public func delete(_ notification: PolarisNotification) async {
        guard var list = notifications.value,
              let index = list.firstIndex(where: { $0.id == notification.id })
        else { return }
        actionError = nil
        let removed = list.remove(at: index)
        notifications = .loaded(list)
        recount()
        do {
            try await api.deleteNotification(id: notification.id)
        } catch {
            var restored = notifications.value ?? []
            restored.insert(removed, at: min(index, restored.count))
            notifications = .loaded(restored)
            recount()
            report(PolarisError.mapped(error))
        }
    }

    /// Marks everything read, one row at a time is *not* what this does: the schema has a
    /// dedicated mutation precisely so an inbox of two hundred does not mint two hundred sync
    /// versions. This client does not select the returned list — it reloads instead, which is
    /// one extra query and no divergence.
    public func markAllRead() async {
        guard let list = notifications.value else { return }
        actionError = nil
        let unread = list.filter { !$0.isRead }
        guard !unread.isEmpty else { return }
        notifications = .loaded(list.map { row in
            var copy = row
            if copy.readAt == nil { copy.readAt = Date() }
            return copy
        })
        recount()
        for row in unread {
            do {
                _ = try await api.markNotificationRead(id: row.id, read: true)
            } catch {
                report(PolarisError.mapped(error))
                await load()
                return
            }
        }
    }

    private func mutate(
        _ notification: PolarisNotification,
        _ operation: @escaping (String) async throws -> PolarisNotification,
        optimistically apply: (inout PolarisNotification) -> Void
    ) async {
        guard var list = notifications.value,
              let index = list.firstIndex(where: { $0.id == notification.id })
        else { return }
        actionError = nil
        let original = list[index]
        var optimistic = original
        apply(&optimistic)
        list[index] = optimistic
        notifications = .loaded(list)
        recount()

        do {
            let updated = try await operation(notification.id)
            if var current = notifications.value,
               let position = current.firstIndex(where: { $0.id == updated.id }) {
                current[position] = updated
                notifications = .loaded(current)
                recount()
            }
        } catch {
            if var current = notifications.value,
               let position = current.firstIndex(where: { $0.id == original.id }) {
                current[position] = original
                notifications = .loaded(current)
                recount()
            }
            report(PolarisError.mapped(error))
        }
    }

    private func recount() {
        unreadCount = (notifications.value ?? []).filter { !$0.isRead }.count
    }

    private func report(_ error: PolarisError) {
        actionError = error
        if case .unauthorized = error { onUnauthorized?(error) }
    }
}
