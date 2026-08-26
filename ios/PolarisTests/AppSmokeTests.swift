import XCTest
@testable import PolarisCore

/// The app target's own tests. The substance lives in PolarisCore's Swift Testing suite, which
/// runs host-side with no simulator; this target exists for the things that need the app
/// bundle — starting with the one that has bitten every project here: an Info.plist whose
/// version keys did not interpolate, which App Store Connect rejects after upload rather than
/// at build time.
final class BundleConfigurationTests: XCTestCase {
    func testVersionKeysInterpolated() throws {
        let bundle = Bundle(for: type(of: self))
        let short = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String

        // A literal "$(MARKETING_VERSION)" here means the build setting never resolved.
        XCTAssertFalse(short?.contains("$") ?? true, "CFBundleShortVersionString did not interpolate")
        XCTAssertFalse(build?.contains("$") ?? true, "CFBundleVersion did not interpolate")
    }
}
