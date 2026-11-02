import Capacitor
import WebKit

@objc(MindRoomBridgeViewController)
class MindRoomBridgeViewController: CAPBridgeViewController {
#if DEBUG
    private var didStartFileSaveAcceptanceFixture = false
#endif

    override func router() -> Router {
        MindRoomRouter()
    }

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        var plugins = descriptor.pluginConfigurations as? [String: Any] ?? [:]
        var statusBar = plugins["StatusBar"] as? [String: Any] ?? [:]
        // iOS uses the web safe area for both the app and its modal backdrops.
        // Keep this in native config so viewDidAppear cannot restore a separate strip.
        statusBar["overlaysWebView"] = true
        plugins["StatusBar"] = statusBar
        descriptor.pluginConfigurations = plugins
        return descriptor
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // The Mac build gets a Mac user agent and desktop layout instead of the
        // mobile content mode from capacitor.config.ts. A compile-time check, because
        // isMacCatalystApp is also true for the App Store iPad app on Apple silicon Macs.
#if targetEnvironment(macCatalyst)
        configuration.defaultWebpagePreferences.preferredContentMode = .desktop
#endif
        return configuration
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MindRoomAuthPlugin())
        bridge?.registerPluginInstance(MindRoomFileSavePlugin())
        bridge?.registerPluginInstance(MindRoomDiagnosticsPlugin())
    }

    override func viewDidAppear(_ animated: Bool) {
        let activeStatusBarStyle = statusBarStyle
        super.viewDidAppear(animated)
        // The plugin queues its configured startup style on every appearance.
        // Restore the web theme's current style after that queued update.
        if activeStatusBarStyle != .default {
            bridge?.statusBarStyle = activeStatusBarStyle
        }

#if DEBUG
        guard ProcessInfo.processInfo.environment["MINDROOM_FILE_SAVE_ACCEPTANCE"] == "1",
              !didStartFileSaveAcceptanceFixture else {
            return
        }
        didStartFileSaveAcceptanceFixture = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            let script = """
            void (async () => {
              const pageId = `ios-export-acceptance-${Date.now()}`;
              const session = await window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'beginSave',
                { pageId, fileName: 'mindroom-export-acceptance.txt' }
              );
              await window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'appendSave',
                { id: session.id, data: 'bWluZHJvb20taW9zLWV4cG9ydC1hY2NlcHRhbmNlLXYxCg==' }
              );
              return window.Capacitor.nativePromise(
                'MindRoomFileSave',
                'presentSave',
                { id: session.id }
              );
            })();
            null;
            """
            self?.webView?.evaluateJavaScript(script) { _, error in
                if let error {
                    NSLog("MindRoom file-save acceptance fixture failed: %@", error.localizedDescription)
                }
            }
        }
#endif
    }
}

private struct MindRoomRouter: Router {
    private var bundleRouter = CapacitorRouter()

    var basePath: String {
        get { bundleRouter.basePath }
        set { bundleRouter.basePath = newValue }
    }

    func route(for path: String) -> String {
        let firstComponent = path.split(separator: "/").first ?? ""
        // BrowserRouter parameters include Matrix IDs/aliases and server names.
        // Their dots are part of a route, even when WebKit reloads after a crash.
        // Native CI checks these against routes generated from pages/paths.ts.
        let routeRoots: Set<Substring> = ["home", "direct", "explore", "login", "register", "reset-password"]
        if routeRoots.contains(firstComponent) || firstComponent.hasPrefix("!") || firstComponent.hasPrefix("#") {
            return bundleRouter.route(for: "/")
        }
        return bundleRouter.route(for: path)
    }
}
