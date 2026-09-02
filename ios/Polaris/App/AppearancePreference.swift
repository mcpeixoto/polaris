import SwiftUI

/// Light, dark, or whatever the phone is set to.
///
/// A preference rather than a constant, because the web client has shipped one since day one
/// (`web/src/styles/tokens.css` defines both palettes and `theme.ts` resolves the choice) and
/// two clients that disagree about what Polaris looks like is a product bug, not a platform
/// difference. `system` is the default here for the same reason it is there.
///
/// Stored in `UserDefaults` under a namespaced key. `@AppStorage` rather than a store, because
/// this is a device setting: it does not belong to the workspace, it must survive sign-out,
/// and it must be readable before there is a session to read it from.
enum AppearancePreference: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    static let storageKey = "polaris.appearance"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: String(localized: "System")
        case .light: String(localized: "Light")
        case .dark: String(localized: "Dark")
        }
    }

    var symbolName: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    /// Nil means "do not override", which is what makes `system` actually follow the system
    /// rather than guessing at it once on launch.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
