import StoreKit
import SwiftUI
import PolarisCore

/// Cloud Pro, bought in the app.
///
/// Guideline 3.1.2 requires the period, the price, auto-renew terms, Privacy Policy, Terms
/// of Use, and Restore Purchases to be on this screen *before* a purchase. The product ids
/// are the same strings the server accepts in services/internal/integrations/apple/jws.go.
struct CloudProView: View {
    @Environment(AppModel.self) private var model
    @State private var products: [Product] = []
    @State private var isLoading = true
    @State private var isPurchasing = false
    @State private var isRestoring = false
    @State private var failure: String?

    var body: some View {
        List {
            Section {
                Text(CloudProCopy.whatYouGet)
                    .font(PolarisText.body)
                    .foregroundStyle(Theme.textSecondary)
            }

            Section {
                if isLoading {
                    HStack {
                        Text("Loading prices")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textSecondary)
                        Spacer()
                        ProgressView().controlSize(.small)
                    }
                } else if products.isEmpty {
                    Text(failure ?? "Cloud Pro is not available for purchase right now.")
                        .font(PolarisText.body)
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    ForEach(products, id: \.id) { product in
                        Button {
                            Task { await buy(product) }
                        } label: {
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: Theme.Space.xxs) {
                                    Text(product.displayName)
                                        .font(PolarisText.body)
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(priceLine(for: product))
                                        .font(PolarisText.caption)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                if isPurchasing {
                                    ProgressView().controlSize(.small)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(isPurchasing || isRestoring)
                        .accessibilityIdentifier("cloudPro.\(product.id)")
                    }
                }
            } footer: {
                if let failure, !products.isEmpty {
                    Text(failure)
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.danger)
                }
            }

            Section {
                Button {
                    Task { await restore() }
                } label: {
                    HStack {
                        Text("Restore Purchases")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        if isRestoring {
                            ProgressView().controlSize(.small)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isPurchasing || isRestoring)
                .accessibilityIdentifier("cloudPro.restore")

                Link(destination: LegalLinks.manageSubscriptions) {
                    HStack {
                        Text("Manage subscription")
                            .font(PolarisText.body)
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("cloudPro.manage")
            } footer: {
                Text(CloudProCopy.autoRenew)
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textTertiary)
            }

            Section {
                LegalLinkRows()
            } header: {
                Text("Legal")
                    .font(PolarisText.sectionTitle)
                    .foregroundStyle(Theme.textTertiary)
                    .textCase(nil)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Cloud Pro"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func priceLine(for product: Product) -> String {
        guard let period = product.subscription?.subscriptionPeriod else {
            return product.displayPrice
        }
        return CloudProCopy.priceAndPeriod(
            displayPrice: product.displayPrice,
            value: period.value,
            unit: period.polarisUnit
        )
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await Product.products(for: CloudProProducts.all)
            products = loaded.sorted { $0.id < $1.id }
            if products.isEmpty {
                failure = "Cloud Pro is not available for purchase right now."
            }
        } catch {
            failure = "Prices could not be loaded."
        }
    }

    private func buy(_ product: Product) async {
        isPurchasing = true
        defer { isPurchasing = false }
        failure = nil
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                try await model.api.applyAppStoreTransaction(signedTransaction: verification.jwsRepresentation)
                await transaction.finish()
                if let problem = await model.reloadViewer() {
                    failure = problem.displayMessage
                }
            case .userCancelled:
                break
            case .pending:
                failure = "The purchase is pending approval."
            @unknown default:
                failure = "The purchase did not complete."
            }
        } catch let error as PolarisError {
            failure = error.displayMessage
        } catch {
            failure = "The purchase did not complete."
        }
    }

    private func restore() async {
        isRestoring = true
        defer { isRestoring = false }
        failure = nil
        failure = await StoreKitEntitlementSync.restore(model: model)
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw PolarisError.badResponse
        case .verified(let value):
            return value
        }
    }
}

private extension Product.SubscriptionPeriod {
    var polarisUnit: CloudProCopy.PeriodUnit {
        switch unit {
        case .day: .day
        case .week: .week
        case .month: .month
        case .year: .year
        @unknown default: .month
        }
    }
}
