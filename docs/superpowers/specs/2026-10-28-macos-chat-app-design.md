# MindRoom Chat for Mac, installable with Homebrew

## Understanding

Said:

- MindRoom Chat should be a Mac app that installs with Homebrew, beside the App Store app.
- It stays a separate app from MindRoom.app, the macOS app that runs agents.
- MindRoom.app should integrate with it.

Assumed:

- Success is `brew install --cask mindroom-ai/tap/mindroom-chat` on any Mac with macOS 13.3 or later, Intel or Apple silicon, giving the same features as the iPhone app: sign-in (password, SSO, Sign in with Apple, Cloudflare Access), push notifications, file saving and `/connect` pairing links.
- Homebrew is the update channel. No in-app updater in the first version.
- The App Store listing stays as it is ("Designed for iPad" on Apple silicon Macs).

## Current state

- The App Store build runs on Apple silicon Macs only and cannot be installed by a cask or by `mas` (mas-cli/mas#321).
- `ios/App` is a Capacitor 8 project with about 1,200 lines of Swift: `MindRoomAuthPlugin` (`ASWebAuthenticationSession`, Sign in with Apple), `MindRoomFileSavePlugin`, diagnostics and `MindRoomBridgeViewController`.
  The Podfile holds only first-party Capacitor pods.
- MindRoom.app (`mindroom/macos/` on mindroom `origin/main`) is a window with a menu bar companion, for macOS 14 or later on Apple silicon.
  Its **Chat** section (mindroom #2371) loads `https://chat.mindroom.chat`, or a configured HTTPS chat website, in a WKWebView with its own persistent session.
  Sign-in providers that need a browser use **Open in Browser**.
  The section bridges no web notifications.
  The app ships a Developer ID signed, notarized DMG from `release.yml` on `macos-latest`, updates through Sparkle, and has a cask in `mindroom-ai/homebrew-tap`, bumped by `update-mindroom-cask.yml` on a `repository_dispatch`.
- Chat releases come from `auto-mindroom-release.yml` on every push to `dev` (tags such as `v4.12.6-mindroom.268`).
- Pairing local agents starts on the machine (chat #335, mindroom #2373 and #2412).
  MindRoom.app's **Connect Account** runs `mindroom connect`, reads the printed `https://chat.mindroom.chat/connect?code=ABCD-EFGH` line, and opens it in its Chat section, where the user approves it ([iOS pairing links](../../ios-pairing-links.md)).

## Decisions

1. **Shell: a Mac Catalyst build of the existing `ios/App` target.**
   It reuses the Swift plugins, the `capacitor://localhost` storage origin, APNs push and the Xcode project.
   Catalyst builds cover arm64 and x86_64.
   Rejected: a WKWebView shell (Tauri or AppKit) would need new bridges for `window.Notification`, SSO and Cloudflare Access.
   Electron would add a 150–200 MB download and leave Chromium patching to us.
2. **Bundle ID: `chat.mindroom.app`, the same as iOS** (`DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO`).
   The push gateway `appId`, the apple-app-site-association `appIDs`, Sign in with Apple and the APNs topic all stay unchanged.
   A later Mac App Store Catalyst build would become a universal purchase.
   Cost: a Mac that also has the App Store iPad app has two apps with one bundle ID, and universal links may open either one.
   The docs say to use one or the other.
3. **Distribution: Developer ID signed and notarized DMG on each chat GitHub release, plus a `mindroom-chat` cask in `mindroom-ai/homebrew-tap`.**
   The repository is public, so macOS runners cost nothing.
4. **Updates: `brew upgrade` only.**
   Sparkle is AppKit and does not link into a Catalyst app.
5. **MindRoom.app keeps its Chat section for now.**
   The separate app adds what that section lacks: push notifications, native SSO and Cloudflare Access, file saving, Intel Macs and macOS 13.
   Whether MindRoom.app later hands chat to the installed app is an open owner decision (see Integration).

## Sub-projects

| #   | Repo                        | Content                                                                  | Order                                         |
| --- | --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| 1   | mindroom-chat, homebrew-tap | Catalyst build, Mac-specific behavior, release job, `mindroom-chat` cask | First; gated by the spike                     |
| 2   | mindroom                    | Optional hand-off from MindRoom.app to the chat app (see Integration)    | After 1 ships, once the owner picks an option |

This spec details sub-project 1.
Sub-project 2 needs an owner decision first, then gets its own plan in the mindroom repository.

## Sub-project 1: the chat app

### Phase 0: spike gates

- **G1, compile:** an unsigned Catalyst archive (`-destination 'generic/platform=macOS,variant=Mac Catalyst'`, `CODE_SIGNING_ALLOWED=NO`) builds on a `macos-15` runner with Xcode 26.2, as `ios-routing.yml` uses, with every pod.
  If a pod fails, patch it with `patch-package` (already used for npm patches).
  If that also fails, stop and write a WKWebView-shell spec instead.
- **G2, Apple account:** an Account Holder or Admin confirms that a Developer ID provisioning profile for `chat.mindroom.app` with Mac Catalyst can carry Push Notifications, Associated Domains and Sign in with Apple.
  Any capability that cannot ship is removed from the Mac entitlements, and its feature falls back to the web path.
- **G3, run:** on a real Mac, the build launches, signs in with a password and SSO, syncs, opens a thread, sends a message, and saves a file.

### Mac-specific behavior

- On Catalyst, `Capacitor.getPlatform()` returns `ios`, so every `isNativeIOS()` path also runs on Mac.
  The audit kept all of them:

  - native sign-in (`SSOLogin.tsx`, `authUi.ts`, `cloudflareAccess.ts`), push (`iosPush.ts`), file save (`nativeFileSave.ts`) and diagnostics (`index.tsx`, `About.tsx`) all use APIs that Catalyst provides;
  - thread exits without history back (`threadNavigation.ts`) suit a window with no Back button;
  - status bar, keyboard resize and haptics do nothing on Mac;
  - edge swipes need touch events, which a trackpad does not send.

  So the web code gets no Mac branch and no `isNativeMac()`.

- `MindRoomBridgeViewController.webViewConfiguration(for:)` sets `preferredContentMode` to `.desktop` under `#if targetEnvironment(macCatalyst)`.
  It is a compile-time check because `ProcessInfo.processInfo.isMacCatalystApp` is also true for the App Store iPad app on Apple silicon Macs, which keeps the mobile content mode.
  The page then sees a Mac user agent:

  - `mobileOrTablet()` is false, so the composer and emoji picker focus as on desktop;
  - the `isMacOS()` paths run (search, General settings, the toolbar);
  - `isIOSWebKitDevice()` should be false, but it also returns true for `MacIntel` with `navigator.maxTouchPoints > 0`, which nobody has measured on Catalyst (Task 5 checks).

  The microphone error still says "in iPhone settings", because `microphoneAccess.ts` checks `Capacitor.getPlatform()`; this is a known Mac gap for Task 5.

- `SceneDelegate` sets a minimum window size of 400×500 under `#if targetEnvironment(macCatalyst)`.
  Default Catalyst menus and title bar are kept.
- The Mac build signs with its own `App-macOS.entitlements` (`CODE_SIGN_ENTITLEMENTS[sdk=macosx*]`):

  - `com.apple.developer.aps-environment` = `$(APS_ENVIRONMENT)`, which is `development` for Debug and `production` for Release, as in `App.entitlements`;
  - `com.apple.developer.associated-domains` = `applinks:chat.mindroom.chat`;
  - `com.apple.developer.applesignin` = `Default`;
  - `com.apple.security.device.audio-input` and `com.apple.security.device.camera`, which the hardened runtime that notarization requires needs for voice and calls.

  `ENABLE_HARDENED_RUNTIME[sdk=macosx*] = YES`.
  The app is not sandboxed.

### Release job

One script, `scripts/build-macos-app.sh`, builds the app for both the pull-request compile check and the release.
It runs `npm run build:ios` and `npx cap sync ios` (which runs `pod install`), then archives for Mac Catalyst.
Without `--sign` it archives unsigned.
With `--sign` it exports with `method: developer-id`, notarizes with `notarytool`, staples, and builds `build/macos/MindRoom-Chat.dmg` with `hdiutil`.

A `macos_app` job is added to `auto-mindroom-release.yml`, with `needs: release`, `if: needs.release.outputs.release_created == 'true'` (as the Android job does), and `runs-on: macos-15` with Xcode 26.2. It:

1. runs `npm ci`;
2. runs `scripts/build-macos-app.sh --sign`;
3. uploads the DMG to the release with `gh release upload`;
4. sends `repository_dispatch` type `mindroom-chat-release` to `mindroom-ai/homebrew-tap`, authenticated with the release bot's app token.

A `workflow_dispatch` with a `release_tag` input reruns the job for an existing release, since a push never reruns it once the tag exists.

New repository secrets:

- the MindRoom.app signing set: `MACOS_CODESIGN_CERTIFICATE_BASE64`, `MACOS_CODESIGN_CERTIFICATE_PASSWORD`, `MACOS_KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`;
- `MACOS_PROVISIONING_PROFILE_BASE64`;
- the release bot GitHub App that mindroom uses to dispatch to the tap: `RELEASE_BOT_PRIVATE_KEY` and the `RELEASE_BOT_APP_ID` variable, with the app installed on `homebrew-tap`.

Today this repository has none of them.

Versions come from the release job's outputs: `MARKETING_VERSION` = `base_version` (`4.12.6`) and `CURRENT_PROJECT_VERSION` = `release_iteration` (`268`).
The cask version is the tag without its `v` (`4.12.6-mindroom.268`).

### Cask

The target's `PRODUCT_NAME` is `MindRoom.chat`, so Xcode builds `MindRoom.chat.app`.
The script renames it to `MindRoom Chat.app` in the DMG; renaming the folder does not break the signature, and iOS is untouched.

`Casks/mindroom-chat.rb`: `url` points at `.../mindroom-chat/releases/download/v#{version}/MindRoom-Chat.dmg`, with `app "MindRoom Chat.app"`, `depends_on macos: :ventura` (casks cannot name 13.3, the minimum that the iOS 16.4 deployment target implies for Catalyst), a `github_latest` livecheck, and `zap` entries for `~/Library/WebKit/chat.mindroom.app`, `~/Library/Caches/chat.mindroom.app` and `~/Library/Preferences/chat.mindroom.app.plist` (paths confirmed in G3).
`update_mindroom_cask.py` takes `--cask mindroom|mindroom-chat`, each mapped to its repository, asset and cask file; `mindroom` stays the default.
A second workflow, `update-mindroom-chat-cask.yml`, runs it for `mindroom-chat` on a daily schedule and on `mindroom-chat-release`.
Both workflows share the concurrency group `update-casks`, so their pushes to the tap never race.

### Docs

- README's Mac row lists `brew install --cask mindroom-ai/tap/mindroom-chat`.
- `ios-pairing-links.md` notes that the Mac app shares the association.
- The Runbook records each phase.

## Integration with MindRoom.app

The two apps overlap today: MindRoom.app's Chat section and MindRoom Chat both show chat, each with its own sign-in.
Sub-project 1 does not change MindRoom.app.

Options for sub-project 2, decided after sub-project 1 ships:

| Option                           | MindRoom.app change                                                                                                                                                                                                                          | Trade-off                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Keep both (recommended first) | None                                                                                                                                                                                                                                         | A Mac with both apps signs in twice; the Chat section still has no notifications                                                                                                     |
| B. Hand off when installed       | When `NSWorkspace.shared.urlForApplication(withBundleIdentifier: "chat.mindroom.app")` finds the app, the Chat section offers **Open in MindRoom Chat** beside **Open in Browser**, and **Connect Account** can open the approval link there | Needs proof that a Catalyst app receives an `https` URL opened with `NSWorkspace.open(_:withApplicationAt:configuration:)`; the shared bundle ID also matches the App Store iPad app |
| C. Replace the Chat section      | Remove the embedded chat and always open the app or the browser; the `mindroom` cask gains `depends_on cask: "mindroom-ai/tap/mindroom-chat"`                                                                                                | Pairing approval leaves MindRoom.app, so B's hand-off must work first                                                                                                                |

Every option keeps these rules:

- 🔒 MindRoom.app registers no URL scheme, and never `mindroom://`, which is chat's SSO callback scheme.
- Pairing keeps starting on the machine and being approved in signed-in chat.

## Testing

- Contract (Vitest): Catalyst build settings, read with `scripts/ios-xcode-project.mjs` as `appstore:preflight` does; the Mac entitlements file, read with Capacitor's `plist`; and the Swift Mac hooks.
- Tap: Python `unittest` for `--cask` mapping.
- CI: an unsigned Catalyst compile job on pull requests that touch `ios/`, `capacitor.config.ts`, Capacitor patches, `package.json`, `package-lock.json` or `.node-version`.
- Tap CI: the existing `brew style`, `brew audit --online` and `brew install --dry-run` steps, run for `mindroom-chat`.
- Manual Mac checklist (G3 plus): push arrives with the app closed, a `/connect` link opens the app, Cmd+C/V in the composer, window resizing, and `brew uninstall --zap`.

## Out of scope

- Sparkle or any in-app updater.
- A Mac App Store Catalyst submission.
- Changes to MindRoom.app (sub-project 2).
- Windows and Linux builds.
- A chat menu bar item.
