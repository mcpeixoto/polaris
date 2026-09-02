import Foundation

/// The four states an async value can be in.
///
/// `.idle` is kept distinct from `.loading` deliberately: "nobody has asked yet" and "the
/// answer is on its way" look identical in a boolean and want different screens — the first
/// should show nothing, the second a spinner. Collapsing them is how a list flashes an empty
/// state before its first load.
public enum Loadable<Value: Sendable>: Sendable {
    case idle
    case loading
    case loaded(Value)
    case failed(PolarisError)

    public var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    public var error: PolarisError? {
        if case .failed(let error) = self { return error }
        return nil
    }

    public var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    /// True only when a load finished and produced nothing — so an empty state is never shown
    /// over data that simply hasn't arrived.
    public func isEmpty(when predicate: (Value) -> Bool) -> Bool {
        guard case .loaded(let value) = self else { return false }
        return predicate(value)
    }
}

extension Loadable: Equatable where Value: Equatable {}

/// `Result`, but for an `async throws` call.
///
/// `Result.init(catching:)` is synchronous only, and the alternative at the call site is
/// `try?` — which is exactly how a store ends up reporting "That's not here any more" for a
/// network drop. Keeping the error is the whole point.
func attempt<T: Sendable>(
    _ operation: @Sendable () async throws -> T
) async -> Result<T, any Error> {
    do {
        return .success(try await operation())
    } catch {
        return .failure(error)
    }
}
