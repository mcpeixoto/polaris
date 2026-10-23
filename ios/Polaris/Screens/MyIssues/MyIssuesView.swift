import SwiftUI
import PolarisCore

/// Home: what is assigned to you, and the way in to every team's list.
///
/// Content only — the navigation stack, and the issue and team destinations, belong to
/// `PolarisNavigation` so this same view is a tab on a phone and a detail column on an iPad.
/// The bar is the system's, inline, with the two actions as plain toolbar glyphs.
struct MyIssuesView: View {
    @Environment(AppModel.self) private var model
    /// Owned by the shell, because the compose sheet is reachable from the iPad sidebar too.
    @Binding var isComposing: Bool
    /// View options, as Linear's display menu offers them. Session state rather than a
    /// stored preference: the row order below is what several UI tests pin, and a choice
    /// that survived a relaunch would make each test depend on the one before it.
    ///
    /// Ungrouped by default, against the schema's own `state` — Linear's own default for this
    /// view, and the one `LinearParityTests` asserts My Issues keeps.
    @State private var display = ListDisplay(groupBy: .none)
    /// Which issues the list holds. Answered on this device, over the complete list the store
    /// holds — `IssuesStore` fetches every issue in scope, not a page of them — so the count
    /// under the bar is a fact about all of them.
    @State private var filter = IssueFilterDraft()
    /// Selection mode and what is picked. Local to the screen: a selection is about the list
    /// in front of somebody right now, and one that survived a tab switch would be a batch
    /// waiting to be applied to rows they have stopped looking at.
    @State private var isSelecting = false
    @State private var selection: Set<String> = []
    /// The last batch's outcome, including what the server would not change. Cleared when a
    /// new selection starts, because an apology for a batch from ten minutes ago describes
    /// nothing on screen.
    @State private var bulkResult: BulkIssueResult?

    var body: some View {
        VStack(spacing: 0) {
            // Scope stays on its own line. Teams used to share it, and on a phone the tabs
            // plus the open count took the width, so the chips — the only way into a team,
            // and from there into projects and cycles — were squeezed to nothing.
            VStack(alignment: .leading, spacing: Theme.Space.xs) {
                HStack(spacing: Theme.Space.md) {
                    scopeTabs
                    statusLine
                }
                .padding(.horizontal, Theme.Space.lg)
                // Above the strip rather than below it: the strip is how somebody browses to
                // a team, and a favourite is something they already chose to keep at hand.
                FavoritesSection()
                workspaceStrip
            }
            .padding(.vertical, Theme.Space.sm)
            .readableColumn()
            // A refused status change used to be a row that quietly snapped back, which reads
            // as a tap that missed rather than as a server saying no.
            if let error = model.issues.writeError {
                InlineErrorLabel(
                    write: model.issues.pendingWrite,
                    text: error.displayMessage,
                    retry: { await model.issues.retryLastWrite() }
                )
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.bottom, Theme.Space.sm)
                    .readableColumn()
                    .accessibilityIdentifier("issues.writeError")
            }
            if let bulkResult {
                BulkResultLabel(result: bulkResult, identify: identifier(of:))
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.bottom, Theme.Space.sm)
                    .readableColumn()
            }
            HairlineDivider()
            content
            if isSelecting {
                BulkActionBar(
                    selection: selection,
                    issues: visible,
                    statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                    people: model.workspaceData.users.value ?? [],
                    apply: applyBulk
                )
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("My Issues"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                SelectModeButton(isSelecting: $isSelecting, selection: $selection, identifier: "issues.select")
                FilterButton(
                    draft: $filter,
                    options: IssueFilterOptions(from: loaded),
                    identifier: "issues.filter"
                )
                displayMenu
                Button { isComposing = true } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel(Text("New issue"))
                .accessibilityIdentifier("issues.compose")
            }
        }
    }

    /// Everything the store holds, and then the part of it the filter keeps.
    private var loaded: [Issue] { model.issues.issues.value ?? [] }
    private var visible: [Issue] { filter.apply(to: loaded) }

    /// `ENG-12` for an id, so the skipped list names rows a reader recognises.
    private func identifier(of id: String) -> String {
        model.issues.issues.value?.first { $0.id == id }?.identifier ?? id
    }

    private func applyBulk(_ edit: BulkIssueEdit) {
        Task {
            let result = await model.issues.bulkApply(edit)
            // Selection mode ends with the write. Leaving it on would leave a bar with
            // nothing selected under a list that has just moved out from under the reader.
            isSelecting = false
            selection = []
            bulkResult = result
        }
    }

    /// How much is open, and whether the list is current.
    private var statusLine: some View {
        HStack(spacing: Theme.Space.sm) {
            Spacer(minLength: 0)
            Text(openCountLabel)
                .font(PolarisText.caption.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .accessibilityAddTraits(.isHeader)
            if model.issues.issues.value != nil, let stale = model.issues.lastRefreshError {
                // The poll failed while a list was on screen. The list stays — blanking what
                // somebody is reading is worse — but it is no longer current, and saying
                // nothing is how a dead session becomes an app that quietly stops updating.
                Text(verbatim: "·").foregroundStyle(Theme.textTertiary)
                Text(stale.isRetryable
                     ? String(localized: "Not up to date")
                     : String(localized: "Refresh failed"))
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.warn)
            }
            if model.issues.isShowingCachedIssues {
                // Said, not hidden. This list came off disk because the first request has
                // not answered yet; claiming it is live would be a lie the reader acts on.
                Text(verbatim: "·").foregroundStyle(Theme.textTertiary)
                Text("Saved copy")
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.warn)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// The line says how much work is open, or what went wrong.
    ///
    /// It used to print "Offline" for every failure — a 403, a decoding failure and a rate
    /// limit all read as a lost connection, while the body below correctly printed a different
    /// sentence. Two statements about the same failure, on the same screen, disagreeing.
    private var openCountLabel: String {
        if case .failed(let error) = model.issues.issues {
            return error.isRetryable
                ? String(localized: "Can't reach Polaris")
                : String(localized: "Error")
        }
        guard let issues = model.issues.issues.value else { return String(localized: "Loading") }
        let open = issues.filter { $0.state.category.isOpen }.count
        return String(localized: "\(open) open")
    }

    /// Assigned, Created, Subscribed — Linear's three views of "my issues", as compact
    /// underlined tabs at the head of the line under the bar. The store does the switching;
    /// the tabs only say which one is showing.
    ///
    /// Tap targets, not `Button`s, and one accessibility element rather than three. The QA
    /// suite addresses rows by their index among *every* button on screen, and three more
    /// buttons ahead of the list moved every one of those indices — a long-press meant for
    /// a row landed on whatever now sat at its old index. To VoiceOver this is one
    /// adjustable control, the way a segmented control reads.
    private var scopeTabs: some View {
        HStack(spacing: Theme.Space.md) {
            ForEach(MyIssuesScope.allCases, id: \.self) { scope in
                let isCurrent = model.issues.scope == scope
                VStack(spacing: 2) {
                    Text(scope.label)
                        .font(.system(.footnote).weight(.medium))
                        .foregroundStyle(isCurrent ? Theme.textPrimary : Theme.textSecondary)
                        .lineLimit(1)
                    Rectangle()
                        .fill(isCurrent ? Theme.accent : Color.clear)
                        .frame(height: 2)
                }
                .frame(minHeight: 28)
                .contentShape(Rectangle())
                .onTapGesture {
                    guard !isCurrent else { return }
                    Task { await model.issues.setScope(scope) }
                }
            }
        }
        .fixedSize()
        .animation(Theme.easing(0.25), value: model.issues.scope)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Scope"))
        .accessibilityValue(Text(model.issues.scope.label))
        .accessibilityAdjustableAction { direction in
            let all = MyIssuesScope.allCases
            guard let index = all.firstIndex(of: model.issues.scope) else { return }
            let next: Int
            switch direction {
            case .increment: next = min(index + 1, all.count - 1)
            case .decrement: next = max(index - 1, 0)
            @unknown default: return
            }
            Task { await model.issues.setScope(all[next]) }
        }
        .accessibilityIdentifier("issues.scope")
    }

    /// The display menu, plus the two items that are this screen's own.
    ///
    /// It was called "Filter" and wore the funnel, from before the list could be grouped and
    /// long before anything could actually filter it. Now that something can, the funnel and
    /// the name belong to `FilterButton` beside it, and this is the sliders menu it has been
    /// everywhere else in the app all along.
    ///
    /// "Show completed" is not a display option: it changes which issues are *fetched*, so it
    /// goes through the store rather than through the local sectioning.
    ///
    /// "Group by status" is a display option, and the menu below offers all nine groupings — but
    /// this toggle stays, in front of them, because it is the gesture this menu has had since the
    /// list could be grouped at all: one tap, headings on. The picker is how the other eight are
    /// reached, not a replacement for the one everybody already knows.
    private var displayMenu: some View {
        DisplayOptionsMenu(display: $display, identifier: "issues.display") {
            Toggle(
                isOn: Binding(
                    get: { model.issues.includeCompleted },
                    set: { newValue in
                        Task { await model.issues.setIncludeCompleted(newValue) }
                    }
                )
            ) {
                Text("Show completed")
            }
            Toggle(
                isOn: Binding(
                    get: { display.groupBy == .state },
                    set: { display.groupBy = $0 ? .state : .none }
                )
            ) {
                Text("Group by status")
            }
        }
    }

    /// Projects, then each team, on a line of their own.
    ///
    /// Projects are workspace-wide, so they are not a property of one team chip. A team chip
    /// still opens that team's hub, which is where its cycles, triage and team-scoped
    /// projects live.
    private var workspaceStrip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Theme.Space.sm) {
                NavigationLink(value: WorkspaceBrowse.projects) {
                    stripChip(title: String(localized: "Projects"), symbol: "hexagon")
                }
                .buttonStyle(PressableStyle())
                .accessibilityIdentifier("workspace.projects")

                if let failure = model.workspaceData.failure(of: .teams) {
                    // Without this the teams are simply not drawn, and one refused `teams()`
                    // at sign-in takes every team screen in the app with it — silently, until
                    // somebody kills the process.
                    Button {
                        Task { await model.workspaceData.reload(.teams) }
                    } label: {
                        stripChip(title: String(localized: "Teams"), symbol: "arrow.clockwise", tint: Theme.accentBright)
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(!failure.isRetryable)
                    .accessibilityLabel(Text("Couldn't load your teams. \(failure.displayMessage) Try again"))
                    .accessibilityIdentifier("teams.retry")
                } else if let teams = model.workspaceData.teams.value {
                    ForEach(teams) { team in
                        NavigationLink(value: team) {
                            stripChip(title: team.key, dot: Theme.hex(team.color))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel(Text("\(team.name) issues"))
                        .accessibilityIdentifier("team.chip.\(team.key)")
                    }
                }
            }
            .padding(.horizontal, Theme.Space.lg)
        }
        .scrollIndicators(.hidden)
    }

    private func stripChip(title: String, symbol: String? = nil, dot: Color? = nil, tint: Color = Theme.textPrimary) -> some View {
        HStack(spacing: Theme.Space.xs + 2) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
            }
            if let dot {
                Circle()
                    .fill(dot)
                    .frame(width: 7, height: 7)
            }
            Text(title)
                .font(.system(.footnote).weight(.medium))
                .foregroundStyle(tint)
        }
        .padding(.horizontal, Theme.Space.sm + 2)
        .frame(minHeight: 28)
        .background(Theme.raised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }

    @ViewBuilder
    private var content: some View {
        switch model.issues.issues {
        case .idle, .loading:
            // Skeleton rows rather than a centred spinner: the layout the reader is about to
            // get is already on screen, so nothing jumps when the answer arrives.
            SkeletonIssueList()
                .readableColumn()
            Spacer(minLength: 0)

        case .failed(let error):
            ErrorStateView(error: error) {
                Task { await model.issues.load() }
            }
            .readableColumn()

        case .loaded(let issues) where issues.isEmpty:
            ScrollView {
                // Two different empties. With completed work hidden the list may not be empty
                // at all, so claiming "nothing assigned" would be false; with the filter
                // already on, pointing at the filter would be useless.
                EmptyStateView(
                    symbol: model.issues.includeCompleted ? "tray" : "checkmark.circle",
                    title: emptyTitle,
                    message: emptyMessage,
                    actionTitle: String(localized: "New issue"),
                    action: { isComposing = true }
                )
                .padding(.top, Theme.Space.xxxl)
                .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.issues.load() }

        case .loaded(let issues) where filter.apply(to: issues).isEmpty:
            ScrollView {
                NoFilterMatchesView(total: issues.count) { filter = IssueFilterDraft() }
                    .padding(.top, Theme.Space.xxxl)
                    .readableColumn()
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.issues.load() }

        case .loaded(let issues):
            if !filter.isEmpty {
                FilterCountCaption(
                    matched: filter.apply(to: issues).count,
                    total: issues.count,
                    identifier: "issues.filter.count"
                )
                .readableColumn()
            }
            // Flat, in priority order — Linear's own default for My Issues. Status groups
            // are for a team's list, where the question is "where is everything", not "what
            // do I do next" — offered here from the filter menu, off until asked for.
            IssueListView(
                issues: filter.apply(to: issues),
                pendingIDs: model.issues.pendingIssueIDs,
                display: display,
                statesFor: { model.workspaceData.states(forTeam: $0.team.id) },
                ensureStates: { await model.workspaceData.ensureStates(forTeam: $0.team.id) },
                setState: { issue, state in
                    Task { await model.issues.setState(issueID: issue.id, to: state) }
                },
                selection: $selection,
                isSelecting: isSelecting
            )
            .readableColumn()
            .refreshable { await model.issues.load() }
        }
    }

    /// Two different empties, times three scopes. With completed work hidden the list may
    /// not be empty at all, so claiming "nothing assigned" would be false; with the filter
    /// already on, pointing at the filter would be useless.
    private var emptyTitle: String {
        guard model.issues.includeCompleted else { return String(localized: "Nothing open") }
        switch model.issues.scope {
        case .assigned: return String(localized: "Nothing assigned to you")
        case .created: return String(localized: "Nothing created by you")
        case .subscribed: return String(localized: "Nothing you're subscribed to")
        }
    }

    private var emptyMessage: String {
        switch (model.issues.scope, model.issues.includeCompleted) {
        case (.assigned, true):
            return String(localized: "No issues are assigned to you in this workspace yet.")
        case (.assigned, false):
            return String(localized: "Nothing open is assigned to you. Anything you have finished is hidden — show completed from the filter above.")
        case (.created, true):
            return String(localized: "Issues you file show up here.")
        case (.created, false):
            return String(localized: "Nothing you created is open. Anything finished is hidden — show completed from the filter above.")
        case (.subscribed, true):
            return String(localized: "Issues you follow show up here.")
        case (.subscribed, false):
            return String(localized: "Nothing you follow is open. Anything finished is hidden — show completed from the filter above.")
        }
    }
}
