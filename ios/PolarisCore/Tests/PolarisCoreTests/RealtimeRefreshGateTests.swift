import Foundation
import Testing

@testable import PolarisCore

/// When a screen holding its own store may refetch on a sync signal.
///
/// The modifier that drives this (`refreshOnRealtime`) was written, documented and adopted by
/// nothing, so every screen with a store of its own — issue detail, a team's list, a cycle, a
/// project, search — stayed on whatever it had loaded until somebody pulled to refresh. The
/// two rules that make adopting it safe are here: a screen that is off the top of the stack
/// or busy writing does not read, and it does not lose the signal it sat out either.
///
/// Every call is bound to a local first: `#expect` reflects the expression it is given into a
/// closure, and a mutating method cannot be called on the copy that closure captures.
@Suite("Realtime refresh gate")
struct RealtimeRefreshGateTests {
    @Test("a signal on a visible, idle screen refetches")
    func signalRefetches() {
        var gate = RealtimeRefreshGate()

        let refetches = gate.reached(version: 1, isSuspended: false)

        #expect(refetches)
        #expect(gate.lastHandled == 1)
    }

    @Test("the version a screen just loaded at is not a reason to load again")
    func seededVersionIsNotNews() {
        var gate = RealtimeRefreshGate()
        gate.seed(7)

        let refetches = gate.reached(version: 7, isSuspended: false)

        #expect(refetches == false)
    }

    @Test("the same version twice is one refetch")
    func repeatedVersionRefetchesOnce() {
        var gate = RealtimeRefreshGate()

        let first = gate.reached(version: 3, isSuspended: false)
        let second = gate.reached(version: 3, isSuspended: false)

        #expect(first)
        #expect(second == false)
    }

    /// The pushed-away screen, and the one under an open composer. Both must come back to it.
    @Test("a signal that arrives while suspended is replayed once the suspension lifts")
    func suspendedSignalIsReplayed() {
        var gate = RealtimeRefreshGate()
        gate.seed(4)

        let whileSuspended = gate.reached(version: 5, isSuspended: true)
        let handledAfterSuspension = gate.lastHandled
        let onResume = gate.reached(version: 5, isSuspended: false)

        #expect(whileSuspended == false)
        #expect(handledAfterSuspension == 4)
        #expect(onResume)
    }

    @Test("several signals during one suspension collapse into a single refetch")
    func burstDuringSuspensionCollapses() {
        var gate = RealtimeRefreshGate()

        let suspended = [1, 2, 3].map { gate.reached(version: $0, isSuspended: true) }
        let onResume = gate.reached(version: 3, isSuspended: false)
        let again = gate.reached(version: 3, isSuspended: false)

        #expect(suspended == [false, false, false])
        #expect(onResume)
        #expect(again == false)
    }

    /// Coming back to a screen nothing happened to must not cost a read: the modifier asks on
    /// every appearance and every change of the busy flag.
    @Test("resuming with nothing missed does not refetch")
    func resumeWithoutSignalIsQuiet() {
        var gate = RealtimeRefreshGate()
        gate.seed(2)

        let whileSuspended = gate.reached(version: 2, isSuspended: true)
        let onResume = gate.reached(version: 2, isSuspended: false)

        #expect(whileSuspended == false)
        #expect(onResume == false)
    }

    @Test("a signal after a replayed one still lands")
    func signalAfterReplay() {
        var gate = RealtimeRefreshGate()

        let whileSuspended = gate.reached(version: 1, isSuspended: true)
        let replay = gate.reached(version: 1, isSuspended: false)
        let next = gate.reached(version: 2, isSuspended: false)

        #expect(whileSuspended == false)
        #expect(replay)
        #expect(next)
    }
}
