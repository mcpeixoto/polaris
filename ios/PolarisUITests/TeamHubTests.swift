import XCTest

/// The team hub and the four screens under it — issues, triage, cycles, projects — driven
/// against the fixture client, where ENG has triage and cycles switched on, two projects,
/// one running cycle and one queued.
///
/// Several checks share a launch on purpose: a launch costs 30–90s on a loaded machine.
final class TeamHubTests: XCTestCase {
    /// This machine runs many simulators at once, so every wait is generous on purpose.
    private let long: TimeInterval = 60

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-polaris-fixtures"]
        app.launch()
        XCTAssertTrue(
            app.staticTexts["My Issues"].waitForExistence(timeout: long),
            "fixtures should sign in and land on the issue list"
        )
        return app
    }

    /// Into the ENG hub from the pill on My Issues.
    private func openHub(_ app: XCUIApplication) {
        let chip = app.buttons["team.chip.ENG"]
        XCTAssertTrue(chip.waitForExistence(timeout: long), "the team pill should be on My Issues")
        chip.tap()
        XCTAssertTrue(
            app.buttons["team.hub.issues"].waitForExistence(timeout: long),
            "the team pill should open the hub, not the bare list"
        )
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// A row of the issue list, found by the identifier its combined label starts with.
    private func issueRow(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", identifier)).firstMatch
    }

    // MARK: - Hub, then Issues

    func testHubOffersTheWaysInAndAllShowsFinishedWork() {
        let app = launch()
        openHub(app)
        snap(app, "team-hub")

        // The four rows, with what each says on its right.
        let issues = app.buttons["team.hub.issues"]
        let triage = app.buttons["team.hub.triage"]
        let cycles = app.buttons["team.hub.cycles"]
        let projects = app.buttons["team.hub.projects"]
        XCTAssertTrue(triage.waitForExistence(timeout: long), "ENG has triage on, so the row is offered")
        XCTAssertTrue(cycles.exists, "ENG runs cycles, so the row is offered")
        XCTAssertTrue(projects.exists)
        XCTAssertTrue(issues.label.contains("Issues"), issues.label)
        XCTAssertTrue(triage.label.contains("Triage"), triage.label)
        XCTAssertTrue(cycles.label.contains("Cycles"), cycles.label)
        XCTAssertTrue(cycles.label.contains("Cycle 7"), "the running cycle is the row's subtitle: \(cycles.label)")
        XCTAssertTrue(cycles.label.contains("left"), "and how long it has: \(cycles.label)")
        XCTAssertTrue(projects.label.contains("Projects"), projects.label)
        XCTAssertTrue(projects.label.contains("2"), "ENG is on both fixture projects: \(projects.label)")

        // The header counts what is open, and the running cycle has its own card.
        XCTAssertTrue(app.staticTexts["ENG · 3 open"].waitForExistence(timeout: long))
        XCTAssertTrue(app.buttons["team.hub.activeCycle"].exists, "the active cycle card should be on the hub")
        XCTAssertTrue(app.buttons["team.favorite"].exists)

        // The hub's own list is the whole team, grouped by status — which is also what the
        // pre-existing parity test reads off this screen.
        XCTAssertTrue(
            app.descendants(matching: .any)["issues.group.In Progress"].waitForExistence(timeout: long)
        )

        // Issues opens on Active: started and unstarted, no backlog, nothing finished.
        issues.tap()
        let picker = app.segmentedControls["team.issues.kind"]
        XCTAssertTrue(picker.waitForExistence(timeout: long), "the issues screen carries the Active/Backlog/All control")
        XCTAssertTrue(issueRow(app, "ENG-1").waitForExistence(timeout: long))
        XCTAssertTrue(issueRow(app, "ENG-2").exists)
        XCTAssertFalse(issueRow(app, "ENG-3").exists, "ENG-3 is backlog, which Active leaves out")
        XCTAssertFalse(issueRow(app, "ENG-4").exists, "ENG-4 is done, which Active leaves out")
        snap(app, "team-issues-active")

        picker.buttons["Backlog"].tap()
        XCTAssertTrue(issueRow(app, "ENG-3").waitForExistence(timeout: long), "Backlog shows the parked issue")
        XCTAssertFalse(issueRow(app, "ENG-1").exists)

        picker.buttons["All"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["issues.group.Done"].waitForExistence(timeout: long),
            "All includes finished work under its own heading"
        )
        XCTAssertTrue(issueRow(app, "ENG-4").waitForExistence(timeout: long), "ENG-4 sits under Done")
        XCTAssertTrue(app.buttons["team.compose"].exists, "the list can start a new issue")
        snap(app, "team-issues-all")
    }

    // MARK: - Triage and cycles

    func testTriageIsClearAndCyclesListTheRunningOne() {
        let app = launch()
        openHub(app)

        app.buttons["team.hub.triage"].tap()
        XCTAssertTrue(
            app.staticTexts["Triage is clear"].waitForExistence(timeout: long),
            "no fixture issue is in the Triage state, so the queue says so"
        )
        snap(app, "team-triage")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let cycles = app.buttons["team.hub.cycles"]
        XCTAssertTrue(cycles.waitForExistence(timeout: long))
        cycles.tap()

        XCTAssertTrue(
            app.descendants(matching: .any)["cycles.section.Active"].waitForExistence(timeout: long),
            "the running cycle has its own section"
        )
        let active = app.buttons["cycle.row.cy1"].firstMatch
        XCTAssertTrue(active.waitForExistence(timeout: long), "cy1 is the running cycle")
        XCTAssertTrue(active.label.contains("Cycle 7"), active.label)
        XCTAssertTrue(active.label.contains("left"), "a running cycle says how long it has: \(active.label)")
        XCTAssertTrue(app.descendants(matching: .any)["cycles.section.Upcoming"].exists)
        let upcoming = app.buttons["cycle.row.cy2"].firstMatch
        XCTAssertTrue(upcoming.exists, "cy2 is queued")
        XCTAssertTrue(upcoming.label.contains("Hardening"), "a named cycle goes by its name: \(upcoming.label)")
        XCTAssertFalse(app.descendants(matching: .any)["cycles.section.Past"].exists, "nothing has ended yet")
        snap(app, "team-cycles")

        active.tap()
        XCTAssertTrue(app.staticTexts["cycle.timing"].waitForExistence(timeout: long), "the cycle detail opens with its timing")
        XCTAssertTrue(issueRow(app, "ENG-1").waitForExistence(timeout: long), "ENG-1 is in the running cycle")
        XCTAssertFalse(issueRow(app, "ENG-2").exists, "ENG-2 is not")
        snap(app, "cycle-detail")
    }

    // MARK: - Projects

    func testProjectsListBothFixturesAndTheDetailShowsItsIssues() {
        let app = launch()
        openHub(app)

        app.buttons["team.hub.projects"].tap()
        let parity = app.buttons["project.row.p1"].firstMatch
        XCTAssertTrue(parity.waitForExistence(timeout: long), "Mobile parity is on ENG")
        XCTAssertTrue(parity.label.contains("Mobile parity"), parity.label)
        XCTAssertTrue(parity.label.contains("In Progress"), "the row carries the status: \(parity.label)")
        let sync = app.buttons["project.row.p2"].firstMatch
        XCTAssertTrue(sync.exists, "Sync v2 is on ENG too")
        XCTAssertTrue(sync.label.contains("Sync v2"), sync.label)
        snap(app, "team-projects")

        parity.tap()
        let status = app.descendants(matching: .any)["project.status"]
        XCTAssertTrue(status.waitForExistence(timeout: long), "the detail opens on the project's properties")
        XCTAssertEqual(status.label, "Status, In Progress")
        XCTAssertEqual(app.descendants(matching: .any)["project.lead"].label, "Lead, Miguel Peixoto")
        XCTAssertTrue(app.descendants(matching: .any)["project.milestone.m1"].exists, "milestones are listed")
        XCTAssertTrue(issueRow(app, "ENG-1").waitForExistence(timeout: long), "ENG-1 is in Mobile parity")
        XCTAssertTrue(issueRow(app, "ENG-3").exists, "so is ENG-3")
        XCTAssertFalse(issueRow(app, "ENG-2").exists, "ENG-2 is on no project")
        XCTAssertTrue(app.staticTexts["project.percent"].exists, "progress is computed on the detail")
        snap(app, "project-detail")
    }
}
