import Foundation
import UIKit
import UserNotifications
import PolarisCore
import os

/// Registers for APNs and hands the token to the API.
///
/// Skipped under `-polaris-fixtures`: the permission prompt would sit over UI tests, and
/// there is no server to register with. The token is remembered so a reconnect after
/// sign-in (or a workspace switch) can re-register without waiting for another APNs
/// callback.
enum PushRegistration {
    private static let log = Logger(subsystem: "com.peixotolabs.polaris", category: "push")
    private static let tokenKey = "polaris.pushDeviceToken"

    @MainActor
    private static var currentModel: AppModel?

    /// Hex form of the last token APNs handed us, or nil.
    static var storedToken: String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    @MainActor
    static func attach(model: AppModel) {
        currentModel = model
        guard !LaunchOptions.usesFixtures else { return }
        Task { await requestAndRegister() }
    }

    @MainActor
    static func detach() {
        currentModel = nil
    }

    /// Asks for notification permission, then for the device token. Permission itself is
    /// owned by `AppBadge.requestPermissionIfNeeded` so the two paths cannot disagree about
    /// what was requested.
    @MainActor
    static func requestAndRegister() async {
        guard !LaunchOptions.usesFixtures else { return }
        await AppBadge.requestPermissionIfNeeded()
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        guard status == .authorized || status == .provisional else { return }
        UIApplication.shared.registerForRemoteNotifications()
        // A token we already hold — re-register after sign-in without waiting for APNs.
        if let token = storedToken {
            await send(token: token)
        }
    }

    static func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: tokenKey)
        Task { @MainActor in await send(token: token) }
    }

    static func didFail(error: Error) {
        log.notice("APNs registration failed: \(String(describing: error), privacy: .public)")
    }

    /// Drops the token on the server (best effort) and locally. Called on sign-out so the
    /// next account on this phone does not inherit the previous person's pushes.
    @MainActor
    static func unregister() async {
        guard let token = storedToken, let model = currentModel else {
            UserDefaults.standard.removeObject(forKey: tokenKey)
            return
        }
        _ = try? await model.api.unregisterPushDevice(token: token)
        UserDefaults.standard.removeObject(forKey: tokenKey)
    }

    @MainActor
    private static func send(token: String) async {
        guard let model = currentModel else { return }
        guard case .ready = model.phase else { return }
        do {
            try await model.api.registerPushDevice(
                token: token,
                platform: "ios",
                appBundle: Bundle.main.bundleIdentifier ?? "com.peixotolabs.polaris",
                environment: apnsEnvironment
            )
            log.info("push device registered")
        } catch {
            log.notice("push register failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Debug / simulator builds talk to the sandbox gateway; Release (TestFlight, App Store)
    /// talks to production. Sending the wrong host a token fails permanently.
    private static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}

/// Bridges UIKit's APNs callbacks into `PushRegistration`.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistration.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistration.didFail(error: error)
    }

    /// A tap on a banner opens the issue or the inbox through the same deep-link router
    /// a polaris:// link uses.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let data = response.notification.request.content.userInfo["polaris"] as? [String: Any]
        if let identifier = data?["issueIdentifier"] as? String, !identifier.isEmpty {
            NotificationCenter.default.post(
                name: .polarisOpenURL,
                object: nil,
                userInfo: ["url": URL(string: "polaris://issue/\(identifier)") as Any]
            )
        } else {
            NotificationCenter.default.post(
                name: .polarisOpenURL,
                object: nil,
                userInfo: ["url": URL(string: "polaris://inbox") as Any]
            )
        }
        completionHandler()
    }
}

extension Notification.Name {
    static let polarisOpenURL = Notification.Name("polaris.openURL")
}
