import XCTest

/// The privacy manifest has to ship inside the app bundle, not merely exist in the repo.
///
/// App Store Connect checks for it after upload, which is the most expensive possible moment
/// to learn that XcodeGen stopped copying a resource. Asserting on `Bundle.main` means the
/// check runs against the built product, the same way the version-key test does.
final class PrivacyManifestTests: XCTestCase {
    func testManifestIsBundledAndDeclaresUserDefaults() throws {
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
            "PrivacyInfo.xcprivacy is not in the app bundle"
        )
        let data = try Data(contentsOf: url)
        let plist = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
        let apis = try XCTUnwrap(plist["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
        let categories = apis.compactMap { $0["NSPrivacyAccessedAPIType"] as? String }
        // @AppStorage is UserDefaults, and UserDefaults is a required-reason API.
        XCTAssertTrue(categories.contains("NSPrivacyAccessedAPICategoryUserDefaults"))
        XCTAssertEqual(plist["NSPrivacyTracking"] as? Bool, false)
    }

    func testURLSchemeIsRegistered() throws {
        let types = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])
        let schemes = types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        XCTAssertTrue(schemes.contains("polaris"), "polaris:// links cannot open the app")
    }
}
