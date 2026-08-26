import Foundation
import Observation

/// The composition root.
///
/// Holds the one API client and the per-screen stores, and owns the session lifecycle. Every
/// screen reads from a store; nothing in the view layer touches the client directly.
@MainActor
@Observable
public final class AppModel {
    public enum Phase: Sendable, Equatable {
        case launching
        case signedOut(PolarisError?)
        case ready(Viewer)
    }

    public private(set) var phase: Phase = .launching
    public let api: any PolarisAPI

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

    /// Boot order copied from the web client: try to resume an existing session, and only
    /// fall back to the dev session where the environment allows one. A sign-in form is the
    /// last resort, not the first thing a developer sees on every launch.
    public func start() async {
        phase = .launching
        do {
            let session: Session
            if environment.allowsDevSession {
                session = try await api.signInWithDevSession()
            } else {
                phase = .signedOut(nil)
                return
            }
            await finishSignIn(session)
        } catch let error as PolarisError {
            phase = .signedOut(error)
        } catch {
            phase = .signedOut(.badResponse)
        }
    }

    public func signIn(email: String, password: String) async {
        do {
            let session = try await api.signIn(email: email, password: password)
            await finishSignIn(session)
        } catch let error as PolarisError {
            phase = .signedOut(error)
        } catch {
            phase = .signedOut(.badResponse)
        }
    }

    public func signOut() async {
        await api.signOut()
        issues = IssuesStore(api: api)
        workspaceData = WorkspaceDataStore(api: api)
        phase = .signedOut(nil)
    }

    private func finishSignIn(_ session: Session) async {
        if let first = session.workspaces.first {
            await api.useWorkspace(id: first.id)
        }
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
