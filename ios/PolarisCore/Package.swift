// swift-tools-version: 6.0
import PackageDescription

// PolarisCore is the whole testable surface of the iOS client: the wire types, the
// PolarisAPI protocol and its two implementations (live HTTP, bundled fixtures), and the
// stores that decide what a screen is allowed to say. Views in Polaris/ are deliberately
// dumb — they render what Core resolves.
//
// The package stays platform-portable so `swift test` runs host-side with no simulator in
// the loop; anything that needs UIKit lives in the app target instead.
let package = Package(
    name: "PolarisCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "PolarisCore", targets: ["PolarisCore"])
    ],
    targets: [
        .target(
            name: "PolarisCore",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "PolarisCoreTests",
            dependencies: ["PolarisCore"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
