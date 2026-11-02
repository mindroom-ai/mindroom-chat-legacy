import WebKit
import XCTest
@testable import RoutingHost

@MainActor
private func waitForNativeDocument(
    _ controller: MindRoomBridgeViewController, after previous: String? = nil,
    timeout: TimeInterval = 15
) async -> (webView: WKWebView, bootID: String)? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        // Cold startup can still replace or navigate the controller's initial view.
        if let webView = controller.webView, !webView.isLoading,
           let bootID = try? await webView.evaluateJavaScript("window.routingBootId") as? String,
           !bootID.isEmpty, bootID != previous, controller.webView === webView {
            return (webView, bootID)
        }
        try? await Task.sleep(nanoseconds: 100_000_000)
    }
    if let webView = controller.webView {
        let nativeState = "url=\(webView.url?.absoluteString ?? "nil"), loading=\(webView.isLoading), progress=\(webView.estimatedProgress)"
        let diagnostic = "Native fixture readiness timed out after \(timeout)s: \(nativeState)"
        print(diagnostic)
        XCTContext.runActivity(named: "Native fixture readiness timeout") { activity in
            activity.add(XCTAttachment(string: diagnostic))
        }
    }
    return nil
}

/// Observe startup before initiating a controlled navigation; never race the app's first load.
@MainActor
func loadNativeTestFixture() async throws -> (MindRoomBridgeViewController, WKWebView) {
    let controller = try XCTUnwrap(UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        .compactMap { $0.rootViewController as? MindRoomBridgeViewController }.first)
    // Fresh CI simulators can take over a minute to launch WebKit processes.
    // Only initial startup gets this budget; controlled navigation stays at 15s.
    let initialDocument = await waitForNativeDocument(controller, timeout: 90)
    let initial = try XCTUnwrap(initialDocument, "The bundled app must finish startup before fixture navigation")
    initial.webView.load(URLRequest(url: URL(string: "capacitor://localhost/")!))
    let freshDocument = await waitForNativeDocument(controller, after: initial.bootID)
    let fresh = try XCTUnwrap(freshDocument, "A new bundled fixture document must load before probing native behavior")
    return (controller, fresh.webView)
}
