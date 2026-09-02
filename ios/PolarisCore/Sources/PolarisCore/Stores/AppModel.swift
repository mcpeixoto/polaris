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
    public private(set) var inbox: InboxStore
    /// A workspace switch is a whole-app reload, and it can fail. Held here because the only
    /// screen that can start one — Settings — is not the only screen it affects.
    public private(set) var isSwitchingWorkspace = false
    /// A sign-out the server did not confirm. The account is signed out on this device either
    /// way; this is the fact that the refresh token is still live somewhere, which somebody
    /// handing a phone back deserves to be told.
    public private(set) var signOutWarning: PolarisError?

    private let environment: PolarisEnvironment

    /// The host this build talks to, for screens that show an address to the reader.
    public var displayHost: String { environment.displayHost }

    /// The signed-in user, when there is one.
    public var currentUser: User? {
        if case .ready(let viewer) = phase { return viewer.user }
        return nil
    }

    /// Where the issue list's cold-start copy is kept. Injected so a test can hand in an
    /// in-memory one, and so the fixture app does not write to the host's disk.
    private let cache: (any IssueCache)?

    public init(
        environment: PolarisEnvironment,
        api: (any PolarisAPI)? = nil,
        cache: (any IssueCache)? = nil
    ) {
        let client = api ?? LivePolarisClient(environment: environment)
        self.environment = environment
        self.api = client
        self.cache = cache
        self.issues = IssuesStore(api: client, cache: cache)
        self.workspaceData = WorkspaceDataStore(api: client)
        self.inbox = InboxStore(api: client)
        wireStores()
    }

    /// Points every store's refused-read callback at one place.
    ///
    /// Before this, a session that expired *while the app was open* was a dead end: every
    /// subsequent call threw `.unauthorized`, the list rendered "Your session expired. Sign in
    /// again." over a screen with no sign-in affordance, and `.unauthorized.isRetryable` is
    /// false so there was not even a Try again button. The only exit was Settings → Sign out.
    /// Linear signs you out and returns you to the auth screen; so does this.
    private func wireStores() {
        // `weak self`, or the model holds a store which holds a closure which holds the model.
        issues.onUnauthorized = { [weak self] error in self?.sessionExpired(error) }
        workspaceData.onUnauthorized = { [weak self] error in self?.sessionExpired(error) }
        inbox.onUnauthorized = { [weak self] error in self?.sessionExpired(error) }
    }

    /// Attaches the same handler to a store a screen owns — the detail screen's, the search
    /// screen's — so a session that dies three screens deep ends in the same place.
    public func adopt(_ handler: inout (@MainActor (PolarisError) -> Void)?) {
        handler = { [weak self] error in self?.sessionExpired(error) }
    }

    /// One refused read is enough. Signing out is idempotent, but re-entering `.signedOut`
    /// from four concurrent failures would replace the reason four times and re-run the
    /// shell's transition animation with it.
    private func sessionExpired(_ error: PolarisError) {
        if case .signedOut = phase { return }
        Task { await signOut(reason: error) }
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
            // Returned, not parked in `phase`. Writing the failure into `.signedOut(error)`
            // made the welcome screen redisplay "incorrect email or password" after the
            // reader had gone back from the form and dealt with it — an error re-announcing
            // itself somewhere it cannot be acted on. `register` already worked this way.
            return error
        } catch {
            return .badResponse
        }
    }

    /// Signs in with an Apple assertion, reporting the failure the same way `signIn` does.
    ///
    /// The screen owns the ASAuthorization dance because it needs a presentation anchor; this
    /// owns what happens afterwards, so the two ways into the app end in exactly the same
    /// state. Anything else and "signed in with Apple" would be a subtly different session
    /// from "signed in with a password".
    public func signInWithApple(
        idToken: String,
        nonce: String,
        displayName: String?
    ) async -> PolarisError? {
        do {
            await finishSignIn(
                try await api.signInWithApple(idToken: idToken, nonce: nonce, displayName: displayName)
            )
            return nil
        } catch let error as PolarisError {
            return error
        } catch {
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

    public func signOut(reason: PolarisError? = nil) async {
        let failure = await api.signOut()
        // A logout the server refused is worth saying — the refresh token outlives the local
        // session. It is not worth *replacing* the reason the user is being signed out with,
        // so an expiry keeps its own sentence.
        signOutWarning = reason == nil ? failure : nil
        cache?.clear()
        issues = IssuesStore(api: api, cache: cache)
        workspaceData = WorkspaceDataStore(api: api)
        inbox = InboxStore(api: api)
        wireStores()
        phase = .signedOut(reason)
    }

    public func clearSignOutWarning() {
        signOutWarning = nil
    }

    /// Switches workspace and reloads everything scoped to one.
    ///
    /// Settings knew there was more than one workspace and offered no way to reach it — it
    /// rendered the *count*. Every store is rebuilt rather than refreshed: they hold issues,
    /// teams, states and people belonging to the workspace being left.
    public func switchWorkspace(to workspace: Workspace) async -> PolarisError? {
        guard !isSwitchingWorkspace else { return nil }
        isSwitchingWorkspace = true
        defer { isSwitchingWorkspace = false }

        await api.useWorkspace(id: workspace.id)
        // The cached list belongs to the workspace being left. Keeping it would hydrate the
        // next cold start with another workspace's issues.
        cache?.clear()
        issues = IssuesStore(api: api, cache: cache)
        workspaceData = WorkspaceDataStore(api: api)
        inbox = InboxStore(api: api)
        wireStores()

        do {
            let viewer = try await api.viewer()
            phase = .ready(viewer)
            await workspaceData.load()
            await issues.load()
            await inbox.load()
            return nil
        } catch {
            return PolarisError.mapped(error)
        }
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
            // Last week's list, on screen before the first request goes out. A cold launch
            // with no network was an error screen; now it is what the reader saw last, and
            // the request that follows replaces it.
            issues.hydrateFromCache()
            await workspaceData.load()
            await issues.load()
            await inbox.load()
        } catch let error as PolarisError {
            phase = .signedOut(error)
        } catch {
            phase = .signedOut(.badResponse)
        }
    }
}
