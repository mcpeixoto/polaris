import XCTest

/// The shipping bundle's half of the anonymous usage count: where it is sent, and that the
/// privacy manifest declares it the way App Store Connect's label says it.
final class MetricsBundleTests: XCTestCase {
    func testMetricsURLIsInTheInfoPlist() throws {
        let raw = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "MetricsURL") as? String)
        let url = try XCTUnwrap(URL(string: raw))
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.path, "/v1/ping")
    }

    func testManifestDeclaresAnonymousUsageDataForAnalytics() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let plist = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: Any]
        )
        let collected = try XCTUnwrap(plist["NSPrivacyCollectedDataTypes"] as? [[String: Any]])
        let usage = try XCTUnwrap(
            collected.first { $0["NSPrivacyCollectedDataType"] as? String == "NSPrivacyCollectedDataTypeOtherUsageData" },
            "the daily usage count is not declared"
        )
        XCTAssertEqual(usage["NSPrivacyCollectedDataTypeLinked"] as? Bool, false)
        XCTAssertEqual(usage["NSPrivacyCollectedDataTypeTracking"] as? Bool, false)
        XCTAssertEqual(
            usage["NSPrivacyCollectedDataTypePurposes"] as? [String],
            ["NSPrivacyCollectedDataTypePurposeAnalytics"]
        )
    }
}
