import Foundation

/// Cloud Pro as sold on the App Store. Product ids must stay identical to
/// `services/internal/integrations/apple/jws.go`; a mismatch takes the money and
/// leaves the workspace on Free.
public enum CloudProProducts: Sendable {
    public static let monthly = "com.peixotolabs.polaris.pro.monthly"
    public static let yearly = "com.peixotolabs.polaris.pro.yearly"
    public static let all: [String] = [monthly, yearly]

    public static func isCloudPro(_ productID: String) -> Bool {
        all.contains(productID)
    }
}

/// URLs Review asks for on a subscription paywall and in Settings (guidelines 3.1.2
/// and 5.1.1). Privacy is the hosted document; Terms of Use is Apple's Standard EULA
/// until a first-party terms page exists.
public enum LegalLinks: Sendable {
    public static let privacyPolicy = ServerPreference.hostedCloudOrigin
        .appendingPathComponent("privacy.html")

    public static let termsOfUse = URL(
        string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
    )!

    public static let manageSubscriptions = URL(
        string: "https://apps.apple.com/account/subscriptions"
    )!
}

/// Pre-purchase copy that does not depend on StoreKit, so the wording can be tested
/// on the host. The live screen fills in StoreKit's localised price.
public enum CloudProCopy: Sendable {
    public enum PeriodUnit: Sendable, Equatable {
        case day, week, month, year
    }

    public static let whatYouGet =
        "Cloud Pro removes the hosted Free limits: more than five people, more than two teams, and activity history beyond 90 days."

    public static let autoRenew =
        "Payment is charged to your Apple ID at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in Settings → Apple ID → Subscriptions."

    /// "month", "year", "3 months".
    public static func periodNoun(value: Int, unit: PeriodUnit) -> String {
        let name: String
        switch unit {
        case .day: name = value == 1 ? "day" : "days"
        case .week: name = value == 1 ? "week" : "weeks"
        case .month: name = value == 1 ? "month" : "months"
        case .year: name = value == 1 ? "year" : "years"
        }
        if value == 1 { return name }
        return "\(value) \(name)"
    }

    public static func priceAndPeriod(displayPrice: String, value: Int, unit: PeriodUnit) -> String {
        "\(displayPrice) per \(periodNoun(value: value, unit: unit))"
    }
}
