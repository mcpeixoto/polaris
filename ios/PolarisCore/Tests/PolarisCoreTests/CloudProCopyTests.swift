import Foundation
import Testing
@testable import PolarisCore

@Suite("Cloud Pro store copy")
struct CloudProCopyTests {
    @Test("the product ids match the strings the server will honour")
    func productIds() {
        #expect(CloudProProducts.monthly == "com.peixotolabs.polaris.pro.monthly")
        #expect(CloudProProducts.yearly == "com.peixotolabs.polaris.pro.yearly")
        #expect(CloudProProducts.isCloudPro(CloudProProducts.monthly))
        #expect(!CloudProProducts.isCloudPro("com.example.other"))
    }

    @Test("privacy policy is the hosted html document, not the SPA")
    func privacyURL() {
        #expect(LegalLinks.privacyPolicy.absoluteString == "https://polaris.peixotolabs.com/privacy.html")
        #expect(LegalLinks.privacyPolicy.path.hasSuffix("privacy.html"))
    }

    @Test("terms of use is Apple's Standard EULA")
    func termsURL() {
        #expect(LegalLinks.termsOfUse.host == "www.apple.com")
        #expect(LegalLinks.termsOfUse.path.contains("stdeula"))
    }

    @Test("price lines name the period before a purchase")
    func priceLines() {
        #expect(CloudProCopy.priceAndPeriod(displayPrice: "€4.00", value: 1, unit: .month) == "€4.00 per month")
        #expect(CloudProCopy.priceAndPeriod(displayPrice: "€38.40", value: 1, unit: .year) == "€38.40 per year")
        #expect(CloudProCopy.periodNoun(value: 3, unit: .month) == "3 months")
        #expect(CloudProCopy.periodNoun(value: 1, unit: .week) == "week")
    }

    @Test("auto-renew copy names charge, renewal and where to cancel")
    func autoRenewNamesTheMechanics() {
        let text = CloudProCopy.autoRenew.lowercased()
        #expect(text.contains("apple id"))
        #expect(text.contains("renew"))
        #expect(text.contains("cancel"))
        #expect(CloudProCopy.whatYouGet.lowercased().contains("five people"))
    }
}
