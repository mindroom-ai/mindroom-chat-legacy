import XCTest

@MainActor
final class NativeDiagnosticsTests: XCTestCase {
    private struct State: Decodable {
        let loading: Bool?
        let attached: Bool?
        let hidden: Bool?
        let opaque: Bool?
        let transparent: Bool?
        let emptyBounds: Bool?
    }
    private struct Event: Decodable {
        let name: String
        let sessionId: String
        let sequence: Int
        let data: State?
    }
    private struct Snapshot: Decodable {
        let readCount: Int
        let status: String
        let currentSessionId: String?
        let events: [Event]
    }

    private func resultButton(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Native diagnostics ")).firstMatch
    }

    private func snapshot(
        _ app: XCUIApplication, after previous: String? = nil, timeout: TimeInterval = 20
    ) async throws -> Snapshot {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let button = resultButton(app)
            if button.exists, button.label != previous {
                return try JSONDecoder().decode(Snapshot.self, from: Data(button.label.dropFirst("Native diagnostics ".count).utf8))
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTContext.runActivity(named: "Native diagnostics readiness timeout") { activity in
            activity.add(XCTAttachment(string: app.debugDescription))
        }
        XCTFail("The native export must answer with a fresh snapshot within \(timeout)s (app state: \(app.state.rawValue))")
        throw NSError(domain: "NativeDiagnosticsTests", code: 1)
    }

    func testEvidenceSurvivesBackgroundAndNativeRelaunch() async throws {
        executionTimeAllowance = 240
        let app = XCUIApplication(bundleIdentifier: "chat.mindroom.RoutingHost")
        app.launch()
        defer { app.terminate() }
        // Initial launches need a cold WebKit budget; plugin refresh stays at 20s.
        let initial = try await snapshot(app, timeout: 90)
        XCTAssertEqual(initial.readCount, 1)
        XCTAssertEqual(initial.status, "available", "Native evidence must be exportable before testing retention")
        guard initial.status == "available" else { return }
        let firstSession = try XCTUnwrap(initial.currentSessionId)
        XCTAssertTrue(initial.events.contains { $0.name == "app.launch" && $0.sessionId == firstSession })
        let sequenceBefore = initial.events.filter { $0.sessionId == firstSession }.map(\.sequence).max() ?? 0
        let previousLabel = resultButton(app).label

        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10) || app.state == .runningBackgroundSuspended)
        app.activate()
        let readButton = app.buttons["Read native diagnostics"]
        XCTAssertTrue(readButton.waitForExistence(timeout: 5))
        XCTAssertTrue(readButton.isHittable)
        readButton.tap()
        let resumed = try await snapshot(app, after: previousLabel)
        XCTAssertEqual(resumed.readCount, initial.readCount + 1)
        XCTAssertEqual(resumed.currentSessionId, firstSession)
        let background = try XCTUnwrap(resumed.events.first {
            $0.name == "scene.background" && $0.sessionId == firstSession && $0.sequence > sequenceBefore
        })
        XCTAssertNotNil(background.data?.attached)
        XCTAssertNotNil(background.data?.hidden)
        XCTAssertNotNil(background.data?.emptyBounds)
        XCTAssertNotNil(background.data?.loading)
        XCTAssertNotNil(background.data?.opaque)
        XCTAssertNotNil(background.data?.transparent)
        let active = try XCTUnwrap(resumed.events.first {
            $0.name == "scene.active" && $0.sessionId == firstSession && $0.sequence > background.sequence
        })
        XCTAssertEqual(active.data?.attached, true)
        XCTAssertEqual(active.data?.hidden, false)
        XCTAssertEqual(active.data?.emptyBounds, false)
        XCTAssertNotNil(active.data?.loading)
        XCTAssertNotNil(active.data?.opaque)
        XCTAssertNotNil(active.data?.transparent)

        // The completed plugin read is a persistence barrier for these events.
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))
        app.launch()
        let reopened = try await snapshot(app, timeout: 90)
        XCTAssertEqual(reopened.status, "available")
        XCTAssertNotEqual(reopened.currentSessionId, firstSession)
        XCTAssertTrue(reopened.events.contains { $0.name == "scene.background" && $0.sessionId == firstSession },
                      "Force-close must not erase the previous session's native evidence")
        XCTAssertTrue(reopened.events.contains { $0.name == "app.launch" && $0.sessionId == reopened.currentSessionId })
    }
}
