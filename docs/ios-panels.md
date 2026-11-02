# iOS canvases and computers

Build the bundled iOS web assets with `npm run build:ios`, then run `npx cap sync ios`.
Xcode Cloud and `npm run ios:phone` use this build automatically.
The app reads `capacitor://localhost/config.json` from its bundle on each launch, before mounting the router.
It does not fetch the web deployment's configuration.

`config.mindroom.ios.json` overlays the ordinary `config.mindroom.json` for this hosted iOS build.
It enables canvases and jsDelivr npm libraries, and ships no computer service.
On a homeserver that binds OpenID tokens, such as mindroom.chat, each agent publishes its MindRoom server in its rooms, and with no saved service the app opens computers there and shows the server as the URL field's placeholder.
Only agents that publish a worker computer can then open computers; with a saved service, the agents it manages can.
A published `localhost` server would be the phone itself, so the app ignores it.
In **Settings → General → Computers**, enter the origin of your trusted compatible backend to choose it yourself, then choose **Save computer service**.
On a fresh installation of the shipped app, the URL field starts empty, with no built-in deployment preset.
URLs users have explicitly saved remain active after an upgrade.
HTTP is also accepted for localhost, literal private IPv4 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and IPv6 unique-local addresses (`fc00::/7`).
The form shows an unencrypted-traffic notice before saving an HTTP service; use it only on a trusted local network.
Public addresses and DNS names, including `.local` names, still require HTTPS.
On a physical iPhone, localhost refers to the phone; use your server’s LAN IP and port, such as `http://192.168.1.50:8765`, to reach another machine.
HTTPS-hosted web clients may still block HTTP services through their browser’s mixed-content policy.
The setting is stored only on this device and persists across launches; it does not sync through Matrix account data.
The chosen backend receives a short-lived Matrix OpenID sign-in token, never the Matrix access token.
Save a blank URL to disable computers, or choose **Use app default** to restore deployment configuration.
Changing the service closes the existing computer session and clears its control state.
Native usage requires a backend version that includes [the native-origin support](https://github.com/mindroom-ai/mindroom/pull/2680) and an updated allowlist.
Operators of a custom app build can optionally set `MINDROOM_IOS_COMPUTER_API_URL=https://computer.example.org` in the build environment to select their own service as its default.
The hosted Matrix/provisioning origin has no computers endpoint; the shipped iOS configuration leaves the computer service empty.
For Xcode Cloud, set the variable in the workflow environment before building.
Operators can select another compatible service with this variable, or disable computers by setting it to an empty string.
Change the overlay's canvas switches to disable canvases or library loading.
Ordinary web builds retain their existing defaults and runtime deployment switches.

The computer runtime must support the bundled native origin and explicitly include `"capacitor://localhost"` in `MINDROOM_COMPUTER_ALLOWED_ORIGINS`, alongside its trusted web origins.
Matrix OpenID authenticates the viewer; bearer credentials authorize REST calls and single-use stream tickets authorize noVNC over WSS (WS for a local HTTP service).
Cookies, embedded remote pages, WebRTC, and additional App Transport Security exceptions are unnecessary.
See [the computer deployment guide](https://docs.mindroom.chat/tools/worker-computer/) for worker prerequisites.

Canvases retain their opaque sandbox, restrictive CSP, and two-frame navigation containment.
Library loading permits only `https://cdn.jsdelivr.net/npm/` scripts, styles, and fonts.
Phones use the existing full-screen panel, including safe-area padding and a close button; the conversation under a canvas or computer is unmounted.
Long canvas titles shrink while the version controls and close button keep their full width, verified at a 320px viewport.
The native bridge checks WebKit's frame metadata before plugin/Cordova messages or synchronous cookie/HTTP prompts, and Capacitor injects bridge scripts only into the main frame.
Android also requires its frame-aware bridge; legacy bridge fallbacks and synchronous interfaces are disabled, with SystemBars viewport handling invoked from a native page-commit callback.

Run `bash scripts/test-ios-routing.sh` for simulator bridge security and native routing tests.
The native suite renders the production canvas documents under the app frame policy and retains a screenshot after Chart.js paints from the allowed npm source.
The security tests check actual plugin side effects and cookie mutation from both ordinary and opaque sandboxed subframes, with working main-frame controls.
The native origin test records a real WebKit OPTIONS preflight and bearer-header GET against a disposable loopback API using the shipping transport settings.
No acceptance code, test plugins, or test fixtures enter the shipping app.

The [simulator CI run](https://github.com/mindroom-ai/mindroom-chat/actions/runs/37250210887) built the shipping app and passed all 26 routing/security/origin tests.
It uploads an unsigned arm64 simulator app as `ios-simulator-app`, plus the native XCTest result and logs as `ios-routing-results`.

Full application acceptance used that app on a disposable iPhone 17 Pro simulator running iOS 26.2.
Only the downloaded test artifact's Matrix/UI-action configuration was changed to select disposable fixtures; the bundled computer default stayed empty.
The compatible loopback computer service, running the backend PR with an explicit native-origin allowlist, was selected through the app's Settings.
The saved service persisted through installation and relaunch of the final CI app.
Credentials were seeded into simulator app data, never the bundle or repository.
Chart.js loaded from the real allowed jsDelivr npm URL, rendered, and responded to a tap.
A Matrix edit offered **Load update**, loaded version two, and the version control returned to the original Chart.js page.
**Tell Writer** sent the canvas error, with its agent mention and originating thread verified on Matrix.
The computer displayed the real worker browser, accepted **Take control**, received `native-ios-control` through the simulator keyboard, and returned to Watch mode with **Resume agent**.
The agent's browser snapshot and input readback both contained that value.

![Chart.js in the full iOS app](screenshots/ios-app-canvas-chart-js.png)
![Returning to canvas version one](screenshots/ios-app-canvas-version-one.png)
![Canvas errors sent to the agent](screenshots/ios-app-canvas-error-sent.png)
![Controlling and typing into the worker browser](screenshots/ios-app-computer-control.png)
![Worker returned to Watch mode after resuming the agent](screenshots/ios-app-computer-resumed.png)
