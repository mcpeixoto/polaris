import BackgroundTasks
import UserNotifications
import PolarisCore
import os

/// The app icon's badge, and the background task that keeps it honest between launches.
///
/// There is no push infrastructure server-side — no device-token schema, no APNs sender — so
/// the only way the badge can move while the app is not in front is for iOS to wake it. That
/// is what `BGAppRefreshTask` is: a wake-up the system grants a few times a day, on its own
/// schedule, for a few seconds of network. It is not push and is not described as such
/// anywhere the reader can see; see ios/README.md.
///
/// Everything here is skipped under `-polaris-fixtures`. The permission prompt would sit over
/// the UI tests as a springboard alert, and a background task registered against a fixture
/// model has nothing to fetch.
enum BackgroundRefresh {
    /// Must match `BGTaskSchedulerPermittedIdentifiers` in project.yml. A registration for an
    /// identifier the plist does not permit is refused with a log line and nothing else.
    static let identifier = "com.peixotolabs.polaris.refresh"

    private static let log = Logger(subsystem: "com.peixotolabs.polaris", category: "background")

    /// The model the registered handler reads. Updated when the user connects or changes
    /// server — `BGTaskScheduler.register` may only succeed once per identifier per process.
    @MainActor
    private static var currentModel: AppModel?

    private static var didRegister = false

    /// Registers the handler once. Has to happen before the app finishes launching, which is
    /// why `PolarisApp.init` calls it rather than a view's `.task`.
    static func register() {
        guard !didRegister else { return }
        didRegister = true
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard task is BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            // Ask again first. A task that reschedules itself only on success stops running
            // after the first failure, which is the opposite of what a refresh is for.
            schedule()
            let handle = TaskHandle(task)
            let work = Task { @MainActor in
                let count = await currentModel?.unreadCountForBadge()
                if let count { await AppBadge.set(count) }
                handle.complete(success: count != nil)
                log.info("background refresh finished: unread=\(count.map(String.init) ?? "unknown", privacy: .public)")
            }
            task.expirationHandler = {
                work.cancel()
                handle.complete(success: false)
            }
        }
        if !registered {
            log.error("background refresh registration refused for \(identifier, privacy: .public)")
        }
    }

    /// Point the registered handler at a new model after connect / change-server.
    @MainActor
    static func attach(model: AppModel) {
        currentModel = model
        register()
    }

    @MainActor
    static func detach() {
        currentModel = nil
    }

    /// Asks for the next wake-up. Called on every move to the background; a request that is
    /// already pending is replaced, not duplicated.
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        // A floor, not a promise: the system picks the actual moment. Fifteen minutes is
        // the shortest interval it honours in practice.
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // The simulator refuses every submit (BGTaskScheduler is device-only), and a
            // device refuses when Background App Refresh is off in Settings. Neither is
            // something the app can do anything about.
            log.notice("background refresh not scheduled: \(String(describing: error), privacy: .public)")
        }
    }
}

/// `BGTask` is not `Sendable`, and the work has to cross from the scheduler's queue to the
/// main actor and back. `setTaskCompleted` is documented as callable from any thread, and
/// this wrapper exposes nothing else, so the claim is sound.
private final class TaskHandle: @unchecked Sendable {
    private let task: BGTask
    init(_ task: BGTask) { self.task = task }
    func complete(success: Bool) { task.setTaskCompleted(success: success) }
}

/// The number on the icon.
enum AppBadge {
    private static let log = Logger(subsystem: "com.peixotolabs.polaris", category: "background")

    /// Asks for badge permission, once, and only for the badge. No alert, no sound: this app
    /// has nothing to alert about, because nothing on the server can send it anything.
    /// `.notDetermined` is the only state worth asking in — asking again after a refusal is
    /// a no-op the system does not even show.
    static func requestPermissionIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        do {
            _ = try await center.requestAuthorization(options: [.badge])
        } catch {
            log.notice("badge permission not granted: \(String(describing: error), privacy: .public)")
        }
    }

    /// Sets the badge. Fails quietly when permission was refused — the badge is a nicety, and
    /// a refusal is an answer, not an error.
    static func set(_ count: Int) async {
        do {
            try await UNUserNotificationCenter.current().setBadgeCount(max(0, count))
        } catch {
            log.debug("badge not set: \(String(describing: error), privacy: .public)")
        }
    }
}
