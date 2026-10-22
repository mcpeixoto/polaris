import SwiftUI
import PolarisCore

/// What the favourites section shows, as arithmetic rather than as a view.
///
/// Three decisions that are easy to get wrong and impossible to assert on a `View`: whether
/// the section appears at all, how much of a long list it shows, and how it admits to the
/// favourites it cannot draw.
enum FavoritesPresentation {
    /// How many rows the section shows before it offers the rest on their own screen.
    ///
    /// The section sits above My Issues' own content, in the part of the screen that does not
    /// scroll, so it cannot grow with the list — twelve favourites would push the thing
    /// somebody opened the tab for off the bottom. Five is the most that fits without doing
    /// that; `WorkspaceBrowse.favorites` has the rest.
    static let limit = 5

    /// Nothing starred means no section, not an empty one: this sits above a busy screen, and
    /// an empty state in front of content is noise.
    ///
    /// A list of rows that is empty while `unavailable` is not is a different thing entirely —
    /// several things *are* starred and none of them can be drawn here. That still shows,
    /// because the sentence is the only evidence the reader has that their favourites exist.
    static func isShown(rows: [FavoriteRow], unavailable: Int) -> Bool {
        !rows.isEmpty || unavailable > 0
    }

    static func visible(_ rows: [FavoriteRow]) -> [FavoriteRow] {
        Array(rows.prefix(limit))
    }

    static func overflow(_ rows: [FavoriteRow]) -> Int {
        max(0, rows.count - limit)
    }

    /// How the section says a favourite exists that it is not showing — a saved view, a
    /// folder, an initiative, a document, or a target the server would not hand over.
    ///
    /// Said rather than swallowed. A starred document that is simply absent from the list
    /// reads as data loss, and a reader who has lost data does not go looking for a feature
    /// gap. Nil at zero, because there is nothing to confess.
    static func unavailableLine(_ count: Int) -> String? {
        switch count {
        case ..<1: nil
        case 1: String(localized: "1 favorite can't be opened on iPhone yet")
        default: String(localized: "\(count) favorites can't be opened on iPhone yet")
        }
    }
}

/// Favourites, at the top of Home.
///
/// The product summary has put them here since the first release and nothing drew them: the
/// API, the store and the star on the team hub all shipped, so people could star a project and
/// then find it nowhere. This is that list — teams, issues, projects, cycles and labels, each
/// in the row the rest of the app already uses for it.
///
/// It owns its `FavoritesStore` rather than taking one from `AppModel`, for the reason the
/// cycle and project screens own theirs: the resolve costs a request per starred issue and
/// cycle, and a store on the model would pay that at sign-in for a section that may never be
/// looked at.
struct FavoritesSection: View {
    @Environment(AppModel.self) private var model
    @State private var store: FavoritesStore?

    var body: some View {
        // A `VStack` and not a `Group`: a Group that resolves to nothing is an `EmptyView`,
        // and modifiers on an EmptyView — the `.task` below among them — are dropped. The
        // section loads nothing and so never stops being empty.
        VStack(alignment: .leading, spacing: 0) {
            if let store, let rows = store.rows.value,
               FavoritesPresentation.isShown(rows: rows, unavailable: store.unavailable) {
                section(rows: rows, unavailable: store.unavailable)
            }
        }
        // Keyed on the favourites themselves, so starring something anywhere in the app
        // re-resolves this list. `observeIssueWrites` covers a *status* changing under a row
        // it already holds; it says nothing about a row arriving or leaving.
        .task(id: model.workspaceData.favorites.value?.map(\.id) ?? []) {
            if store == nil {
                let created = FavoritesStore(api: model.api)
                // Documented idempotent precisely so a view's task may do this.
                model.observeIssueWrites(created)
                store = created
            }
            await store?.load(from: model.workspaceData)
        }
    }

    private func section(rows: [FavoriteRow], unavailable: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(text: String(localized: "Favorites"))
                // On the heading, not on the `VStack`: an identifier set on a container is
                // inherited by everything inside it, and the rows' own identifiers — which
                // is how anything finds one — are overwritten by it.
                .accessibilityIdentifier("favorites.section")
                .padding(.horizontal, Theme.Space.lg)
                .padding(.bottom, Theme.Space.xs)
            ForEach(FavoritesPresentation.visible(rows)) { row in
                HairlineDivider()
                FavoriteTargetRow(row: row)
                    .padding(.horizontal, Theme.Space.lg)
            }
            if FavoritesPresentation.overflow(rows) > 0 {
                HairlineDivider()
                seeAll(more: FavoritesPresentation.overflow(rows))
            }
            if let line = FavoritesPresentation.unavailableLine(unavailable) {
                Text(line)
                    .font(PolarisText.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.top, Theme.Space.xs + 2)
                    .accessibilityIdentifier("favorites.unavailable")
            }
        }
        .padding(.bottom, Theme.Space.sm)
    }

    private func seeAll(more: Int) -> some View {
        NavigationLink(value: WorkspaceBrowse.favorites) {
            HStack(spacing: Theme.Space.sm) {
                Text("\(more) more")
                    .font(PolarisText.body.monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: Theme.Space.sm)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Theme.Space.lg)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(Text("See all favorites"))
        .accessibilityIdentifier("favorites.seeAll")
    }
}

/// Every favourite, on its own screen.
///
/// Reached from the section when there are more than it can show. A plain `List` of the same
/// rows — the kinds are mixed, so it is not an `IssueListView`, and the section's cap is the
/// only difference between the two.
struct FavoritesView: View {
    @Environment(AppModel.self) private var model
    @State private var store: FavoritesStore?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            content
        }
        .navigationTitle(Text("Favorites"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.workspaceData.favorites.value?.map(\.id) ?? []) {
            if store == nil {
                let created = FavoritesStore(api: model.api)
                model.observeIssueWrites(created)
                store = created
            }
            await store?.load(from: model.workspaceData)
            await ensureStates()
        }
    }

    /// The statuses behind the mark on a starred issue's row. `states(forTeam:)` can only
    /// report what is already held, so without this a starred issue from a team whose list
    /// was never opened draws a mark that opens an empty menu.
    private func ensureStates() async {
        for row in store?.rows.value ?? [] {
            if case .issue(let issue) = row.target {
                await model.workspaceData.ensureStates(forTeam: issue.team.id)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let store, let rows = store.rows.value {
            VStack(spacing: 0) {
                List {
                    ForEach(rows) { row in
                        FavoriteTargetRow(row: row, style: .list)
                            .listRowBackground(Color.clear)
                            .listRowSeparatorTint(Theme.hairline)
                            .listRowInsets(EdgeInsets(
                                top: 0, leading: Theme.Space.lg,
                                bottom: 0, trailing: Theme.Space.lg
                            ))
                            .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollIndicators(.hidden)
                .environment(\.defaultMinListRowHeight, Theme.rowHeight)
                if let line = FavoritesPresentation.unavailableLine(store.unavailable) {
                    Text(line)
                        .font(PolarisText.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, Theme.Space.lg)
                        .padding(.bottom, Theme.Space.sm)
                        .accessibilityIdentifier("favorites.unavailable")
                }
            }
            .readableColumn()
        } else {
            LoadingView(label: String(localized: "Loading favorites"))
        }
    }
}

/// One favourite, drawn as whatever it points at.
///
/// Each case is the row that kind already has elsewhere, not a new one: the project rows are
/// `ProjectRow`, the issues are `IssueRow`, and the teams are the hub's own icon and key. A
/// favourites list that invented its own row for five types would be five rows that drift
/// from the screens they stand for.
struct FavoriteTargetRow: View {
    /// Where the row is standing, which decides how it opens what it names.
    ///
    /// Inside a `List` the link sits *behind* the row, because that is what leaves the status
    /// mark a working menu and the row a swipe target — the cell is what activates the link.
    /// The section on Home is not a list, and there a link behind the row is never reached:
    /// `IssueRow` sets a `contentShape`, which makes the row itself the thing the tap lands
    /// on. So outside a list the link wraps the row, and the status mark goes with it — a
    /// menu inside a button's label is a menu that cannot be opened.
    enum Style {
        case preview
        case list
    }

    let row: FavoriteRow
    var style: Style = .preview

    @Environment(AppModel.self) private var model

    /// On the row itself, never on anything above it: an identifier set on a container is
    /// inherited by every row inside it, and one set over the hidden link finds two elements.
    private var identifier: String { "favorites.row.\(row.id)" }

    @ViewBuilder
    var body: some View {
        switch row.target {
        case .issue(let issue):
            linked(issue) {
                IssueRow(
                    issue: issue,
                    states: style == .list ? model.workspaceData.states(forTeam: issue.team.id) : [],
                    onSetState: style == .list
                        ? { state in
                            Task { await model.issues.setState(issueID: issue.id, to: state) }
                        }
                        : nil
                )
            }

        case .project(let project):
            linked(project) { ProjectRow(project: project) }

        case .team(let team):
            linked(team) {
                plain(
                    icon: { TeamIconView(team: team, size: 20) },
                    title: team.name,
                    detail: team.key,
                    spoken: String(localized: "\(team.name) team")
                )
            }

        case .cycle(let cycle):
            // Not `CycleRow`, which is built around a progress bar: the bar needs the cycle's
            // issues, and a row that has not fetched them would draw a confident 0%.
            linked(cycle) {
                plain(
                    icon: {
                        Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 20)
                    },
                    title: cycle.displayName,
                    detail: CycleBuckets.timing(cycle),
                    spoken: "\(cycle.displayName), \(CycleBuckets.timing(cycle))"
                )
            }

        case .label(let label):
            // The one kind with no screen behind it: nothing in this build lists issues by
            // label, so the row reports the favourite and opens nothing rather than pushing
            // somewhere unrelated. It is drawn, not counted as unavailable — it is a real
            // favourite and the reader starred it on purpose.
            plain(
                icon: {
                    Circle()
                        .fill(Theme.hex(label.color))
                        .frame(width: 10, height: 10)
                        .frame(width: 20)
                },
                title: label.name,
                detail: nil,
                spoken: String(localized: "Label: \(label.name)"),
                opens: false
            )
            .accessibilityIdentifier(identifier)
        }
    }

    @ViewBuilder
    private func linked<Value: Hashable, Content: View>(
        _ value: Value,
        @ViewBuilder content: () -> Content
    ) -> some View {
        switch style {
        case .preview:
            NavigationLink(value: value) {
                content().accessibilityIdentifier(identifier)
            }
            .buttonStyle(PressableStyle())
        case .list:
            content()
                .accessibilityIdentifier(identifier)
                .background(NavigationLink(value: value) { EmptyView() }.opacity(0))
        }
    }

    /// The hub's row geometry — glyph, name, and on the right what the reader will find —
    /// for the three kinds with no row of their own.
    private func plain<Icon: View>(
        @ViewBuilder icon: () -> Icon,
        title: String,
        detail: String?,
        spoken: String,
        opens: Bool = true
    ) -> some View {
        HStack(spacing: Theme.Space.sm + 2) {
            icon()
            Text(title)
                .font(PolarisText.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: Theme.Space.sm)
            if let detail {
                Text(detail)
                    .font(PolarisText.rowMeta)
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, Theme.Space.sm + 2)
        .frame(minHeight: Theme.rowHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityAddTraits(opens ? [.isButton] : [])
    }
}
