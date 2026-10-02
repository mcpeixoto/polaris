import StoreKit
import SwiftUI
import PolarisCore

/// Cloud Pro, bought in the app.
///
/// The product ids are the same strings the server accepts in
/// services/internal/integrations/apple/jws.go. A purchase the server does not know
/// about would take the money and leave the workspace on Free.
struct CloudProView: View {
    @Environment(AppModel.self) private var model
    @State private var products: [Product] = []
    @State private var isLoading = true
    @State private var isPurchasing = false
    @State private var failure: String?

    private static let productIDs = [
        "com.peixotolabs.polaris.pro.monthly",
        "com.peixotolabs.polaris.pro.yearly",
    ]

    var body: some View {
        List {
            Section {
                Text("Cloud Pro removes the free limits on people, teams and history for this workspace.")
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
                            HStack {
                                Text(product.displayName)
                                    .font(PolarisText.body)
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if isPurchasing {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Text(product.displayPrice)
                                        .font(PolarisText.body)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(isPurchasing)
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
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Cloud Pro"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await Product.products(for: Self.productIDs)
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

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw PolarisError.badResponse
        case .verified(let value):
            return value
        }
    }
}
