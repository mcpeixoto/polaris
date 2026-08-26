import Foundation
import Observation

/// The composition root.
///
/// Holds the one API client and the per-screen stores, and owns the session lifecycle. Every
/// screen reads from a store; nothing in the view layer touches the client directly.
@MainActor
@Observable
public final class AppModel {
    /// Where the app is in getting somebody to their issues.
    ///
    /// `needsWorkspace` is its own case rather than a flag on `ready`. An account that exists
    /// but belongs to no workspace is a real state the server can return — it is what every
    /// first sign-up lands in — and folding it into "signed out" would send somebody who just
    /// created an account back to a password field.
    public enum Phase: Sendable, Equatable {
        case launching
        case signedOut(PolarisError?)
        case needsWorkspace
        case ready(Viewer)
    }

    public private(set) var phase: Phase = .launching
    public let api: any PolarisAPI

    /// Remembered from registration so the workspace screen does not have to ask for a name
    /// the person typed two screens ago — and so it never sends the *workspace* name as the
    /// creator's name, which is what it would otherwise have to guess.
    public private(set) var accountDisplayName: String?

    public private(set) var issues: IssuesStore
    public private(set) var workspaceData: WorkspaceDataStore

    private let environment: PolarisEnvironment

    public init(environment: PolarisEnvironment, api: (any PolarisAPI)? = nil) {
        let client = api ?? LivePolarisClient(environment: environment)
        self.environment = environment
        self.api = client
        self.issues = IssuesStore(api: client)
        self.workspaceData = WorkspaceDataStore(api: client)
    }

    /// Boot order, copied from the web client: resume an existing session first, then fall
    /// back to the dev session where the environment allows one, and only then show a form.
    /// A sign-in screen on every launch is the most common self-inflicted wound in a mobile
    /// client that already holds a refresh cookie.
    public func start() async {
        phase = .launching
        if let session = try? await api.restoreSession() {
            await finishSignIn(session)
            return
        }
        // The fixture client answers this without a network, which is how the signed-in
        // screens become reachable on a machine with no backend.
        if let session = try? await api.signInWithDevSession() {
            await finishSignIn(session)
            return
        }
        phase = .signedOut(nil)
    }

    public func signIn(email: String, password: String) async -> PolarisError? {
        do {
            await finishSignIn(try await api.signIn(email: email, password: password))
            return nil
        } catch let error as PolarisError {
            phase = .signedOut(error)
            return error
        } catch {
            phase = .signedOut(.badResponse)
            return .badResponse
        }
    }

    /// Registers, and reports the failure to the caller instead of only parking it in `phase`.
    ///
    /// The sign-up screen needs the error next to its own fields — a refusal that only reaches
    /// a global phase leaves the form looking like nothing happened.
    public func register(
        email: String,
        password: String,
        inviteToken: String?,
        displayName: String?
    ) async -> PolarisError? {
        do {
            let session = try await api.register(
                email: email,
                password: password,
                inviteToken: inviteToken,
                displayName: displayName
            )
            accountDisplayName = displayName
            await finishSignIn(session)
            return nil
        } catch let error as PolarisError {
            return error
        } catch {
            return .badResponse
        }
    }

    public func createWorkspace(_ draft: WorkspaceDraft) async -> PolarisError? {
        do {
            let workspace = try await api.createWorkspace(draft)
            await api.useWorkspace(id: workspace.id)
            await loadViewer()
            return nil
        } catch let error as PolarisError {
            return error
        } catch {
            return .badResponse
        }
    }

    public func signOut() async {
        await api.signOut()
        issues = IssuesStore(api: api)
        workspaceData = WorkspaceDataStore(api: api)
        phase = .signedOut(nil)
    }

    private func finishSignIn(_ session: Session) async {
        guard let first = session.workspaces.first else {
            // Registered, but in no workspace yet. The create screen is the next step, not an
            // error.
            phase = .needsWorkspace
            return
        }
        await api.useWorkspace(id: first.id)
        await loadViewer()
    }

    private func loadViewer() async {
        do {
            let viewer = try await api.viewer()
            await api.useWorkspace(id: viewer.workspace.id)
            phase = .ready(viewer)
            await workspaceData.load()
            await issues.load()
        } catch let error as PolarisError {
            phase = .signedOut(error)
        } catch {
            phase = .signedOut(.badResponse)
        }
    }
}
