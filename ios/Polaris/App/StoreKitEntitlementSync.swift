import StoreKit
import PolarisCore

/// Replays StoreKit 2 entitlements into the Polaris API.
///
/// A purchase on this device already posts the JWS from `product.purchase()`. Restore and
/// `Transaction.updates` cover the other two cases Review (and a second device) hit: an
/// existing subscriber tapping Restore Purchases, and a renewal that arrives while the app
/// is open. The server is idempotent on the original transaction id.
enum StoreKitEntitlementSync {
    @MainActor
    static func listen(model: AppModel) async {
        for await result in Transaction.updates {
            _ = await apply(result, to: model, reload: true)
        }
    }

    @MainActor
    static func restore(model: AppModel) async -> String? {
        do {
            try await AppStore.sync()
            var found = false
            for await result in Transaction.currentEntitlements {
                if await apply(result, to: model, reload: false) {
                    found = true
                }
            }
            if let problem = await model.reloadViewer() {
                return problem.displayMessage
            }
            if !found {
                return "No Cloud Pro purchase was found for this Apple ID."
            }
            return nil
        } catch {
            return "Purchases could not be restored."
        }
    }

    @MainActor
    @discardableResult
    private static func apply(
        _ result: VerificationResult<Transaction>,
        to model: AppModel,
        reload: Bool
    ) async -> Bool {
        guard case .verified(let transaction) = result else { return false }
        guard CloudProProducts.isCloudPro(transaction.productID) else { return false }
        do {
            try await model.api.applyAppStoreTransaction(signedTransaction: result.jwsRepresentation)
            await transaction.finish()
            if reload {
                _ = await model.reloadViewer()
            }
            return true
        } catch {
            // Leave the transaction unfinished so StoreKit asks again rather than
            // dropping a paid period the API refused.
            return false
        }
    }
}
