# MindRoom Chat for Mac Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans. There are five small, mostly configuration tasks that build on each other and must wait for external gates, so per-task subagents would add cost without adding coverage.

**Goal:** `brew install --cask mindroom-ai/tap/mindroom-chat` installs a notarized Mac Catalyst build of MindRoom Chat.

**Architecture:** The existing `ios/App` target also builds for Mac Catalyst under bundle ID `chat.mindroom.app`, with Mac-only entitlements and two small Swift hooks.
`scripts/build-macos-app.sh` archives it, unsigned for pull requests and signed, notarized and packed into a DMG for releases.
`auto-mindroom-release.yml` uploads the DMG, and `mindroom-ai/homebrew-tap` bumps a `mindroom-chat` cask.

**Tech Stack:** Capacitor 8 (iOS), Xcode with Mac Catalyst, CocoaPods, GitHub Actions `macos-15` with Xcode 26.2, `notarytool`, `hdiutil`, Homebrew casks, Vitest, Python `unittest`.

**Spec:** [docs/superpowers/specs/2026-10-28-macos-chat-app-design.md](../specs/2026-10-28-macos-chat-app-design.md)

## Global Constraints

- Bundle ID `chat.mindroom.app`, team `DNA6966LGZ`; `DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO`.
- iOS behavior and the iOS archive stay unchanged: Mac settings use `[sdk=macosx*]` conditionals or `#if targetEnvironment(macCatalyst)`.
- The deployment target stays `IPHONEOS_DEPLOYMENT_TARGET = 16.4` (Catalyst 16.4, macOS 13.3).
- Build output goes to `build/macos/`; the release asset is named `MindRoom-Chat.dmg`; the app is `MindRoom Chat.app` inside the DMG.
- Versions: `MARKETING_VERSION` = release `base_version`; `CURRENT_PROJECT_VERSION` = release `release_iteration`.
- No in-app updater, no Mac App Store upload, no web-code Mac branch.
- Each task adds or updates a `FORK_CHANGES.md` Runbook entry, and runs `npm run typecheck`, `npm run build`, `npm run lint` and `npm test` (as AGENTS.md requires) before committing.

## Review Focus

1. **Xcode Cloud iOS archive after enabling Catalyst:** the App Store build must still archive for iOS only, and App Store Connect must still offer it on Apple silicon Macs. Owned by Task 1, through the contract test that iOS settings are unchanged, plus a check of the next Xcode Cloud build.
2. **Mac with the App Store iPad app also installed:** two apps share one bundle ID. Universal links and `NSWorkspace` lookups may pick either, and neither app's data may be touched. Task 5 checks this by hand and documents it.
3. **Push with the app quit:** APNs delivers to a Developer ID build only if the profile carries `com.apple.developer.aps-environment` = `production`, which Release gets from `$(APS_ENVIRONMENT)`. Task 3 verifies with `codesign -d --entitlements`; Task 5 sends a real push.
4. **Release job failure after the GitHub release exists:** the tap's daily cron then finds a release without `MindRoom-Chat.dmg` and must fail loudly, not write a bad cask. The Task 4 test pins it.
5. **Microphone and camera under the hardened runtime:** without `com.apple.security.device.audio-input` and `com.apple.security.device.camera`, voice and calls fail silently. Task 1's test pins the entitlements; Task 5 makes a call.

---

### Task 1: Catalyst build settings and the unsigned compile check (gate G1)

**Files:**

- Modify: `ios/App/App.xcodeproj/project.pbxproj` (App target's Debug and Release `XCBuildConfiguration`, near line 494)
- Create: `ios/App/App/App-macOS.entitlements`
- Create: `scripts/build-macos-app.sh`
- Create: `.github/workflows/build-macos-pr.yml`
- Test: `src/app/mindroom/native/macCatalystBuildConfig.test.ts`

**Interfaces:**

- Produces: `scripts/build-macos-app.sh [--sign]`. Without flags: `npm run build:ios`, `npx cap sync ios`, then `xcodebuild archive -workspace ios/App/App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=macOS,variant=Mac Catalyst' -archivePath build/macos/MindRoomChat.xcarchive CODE_SIGNING_ALLOWED=NO`. It exits non-zero on any failure (`set -euo pipefail`).

- [ ] **Step 1: Write the failing test** `macCatalystBuildConfig.test.ts`, reading build settings with `scripts/ios-xcode-project.mjs` (as `appstore:preflight` does) and the entitlements with Capacitor's `plist`. For every build configuration of the `App` native target:

  - `SUPPORTS_MACCATALYST` is `YES`;
  - `DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER` is `NO`;
  - `"CODE_SIGN_ENTITLEMENTS[sdk=macosx*]"` (the parser keeps the quotes) is `App/App-macOS.entitlements`;
  - `"ENABLE_HARDENED_RUNTIME[sdk=macosx*]"` is `YES`;
  - `CODE_SIGN_ENTITLEMENTS` is still `App/App.entitlements`;
  - `PRODUCT_BUNDLE_IDENTIFIER` is still `chat.mindroom.app`.

  Then `App-macOS.entitlements` deep-equals:

  ```ts
  {
    'com.apple.developer.aps-environment': '$(APS_ENVIRONMENT)',
    'com.apple.developer.associated-domains': ['applinks:chat.mindroom.chat'],
    'com.apple.developer.applesignin': ['Default'],
    'com.apple.security.device.audio-input': true,
    'com.apple.security.device.camera': true,
  }
  ```

- [ ] **Step 2: Run it.** `npx vitest run src/app/mindroom/native/macCatalystBuildConfig.test.ts`. Expected: FAIL on `SUPPORTS_MACCATALYST`.
- [ ] **Step 3: Add the four build settings** to both App configurations, and create the entitlements file with exactly those keys.
- [ ] **Step 4: Write the build script and `build-macos-pr.yml`.** The workflow runs on `pull_request` for paths `ios/**`, `capacitor.config.ts`, `patches/@capacitor+*.patch`, `package.json`, `package-lock.json`, `.node-version`, `scripts/build-macos-app.sh` and the workflow itself. It uses `runs-on: macos-15`, `sudo xcode-select -s /Applications/Xcode_26.2.app`, `actions/setup-node` with `node-version-file: '.node-version'`, `npm ci`, then `scripts/build-macos-app.sh`. Pin actions by the SHAs `ios-routing.yml` uses.
- [ ] **Step 5: Run the test again, then the validations.** The test passes; `npm run typecheck`, `npm run build` and `npm run lint` pass.
- [ ] **Step 6: Commit.** Message: `build(macos): build the iOS app for Mac Catalyst`.
- [ ] **Step 7: Gate G1.** ⚠️ Needs the owner's go-ahead to push a PR, opened ready for review as AGENTS.md requires. Expected: `build-macos-pr` is green and the log shows `** ARCHIVE SUCCEEDED **`.
      If a pod fails to compile, patch it with `patch-package` and repeat.
      If it still fails, stop the plan and report: the spec's fallback is a WKWebView shell.

### Task 2: Mac window and content mode

**Files:**

- Modify: `ios/App/App/MindRoomBridgeViewController.swift`
- Modify: `ios/App/App/SceneDelegate.swift:7-13`
- Test: `src/app/mindroom/native/macCatalystShell.test.ts`

**Interfaces:**

- Produces: `override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration` on `MindRoomBridgeViewController`. It calls `super`, and under `#if targetEnvironment(macCatalyst)` sets `defaultWebpagePreferences.preferredContentMode = .desktop`. `isMacCatalystApp` would also match the App Store iPad app on Apple silicon Macs.

- [ ] **Step 1: Write the failing source-contract test** (the pattern used by `nativeFileSaveIOSContract.test.ts`):
  - the bridge controller overrides `webViewConfiguration(for` and sets `preferredContentMode = .desktop` inside `#if targetEnvironment(macCatalyst)`, with no `ProcessInfo.processInfo.isMacCatalystApp`;
  - `SceneDelegate.swift` contains `#if targetEnvironment(macCatalyst)` and `sizeRestrictions?.minimumSize = CGSize(width: 400, height: 500)`;
  - `capacitor.config.ts` still sets `preferredContentMode: 'mobile'` for iOS.
- [ ] **Step 2: Run it.** `npx vitest run src/app/mindroom/native/macCatalystShell.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both hooks.** Set the minimum size on `windowScene` after the window is created.
- [ ] **Step 4: Run the test (PASS) and the validations, then push.** `build-macos-pr` is green.
- [ ] **Step 5: Commit.** Message: `feat(macos): open MindRoom Chat as a desktop page in a resizable window`.

### Task 3: Signed, notarized DMG on each release (needs gate G2)

**Files:**

- Create: `ios/App/macos-export-options.plist`
- Modify: `scripts/build-macos-app.sh` (the `--sign` path)
- Modify: `.github/workflows/auto-mindroom-release.yml` (new `macos_app` job)
- Test: `src/app/mindroom/native/macCatalystBuildConfig.test.ts` (export options case)
- Docs: `docs/ios-pairing-links.md` (an owner section for the Mac profile)

**Interfaces:**

- Consumes: `scripts/build-macos-app.sh` from Task 1.
- Produces: the script forwards `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` to `xcodebuild` when set. `--sign` reads these environment variables:

  - `CODESIGN_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, named as in mindroom's `release.yml`;
  - `MACOS_PROVISIONING_PROFILE_PATH`.

  It writes `build/macos/MindRoom-Chat.dmg`, containing `MindRoom Chat.app` renamed from the exported `MindRoom.chat.app`, plus an `/Applications` symlink.

- [ ] **Step 1: Owner prerequisites (G2).** ⚠️ Account Holder or Admin only; automation must not change capabilities. Record the outcome in `ios-pairing-links.md`.

  1. Enable Mac Catalyst for the App ID `chat.mindroom.app`.
  2. Create a **Developer ID** provisioning profile named `MindRoom Chat Developer ID` for that App ID with Push Notifications, Associated Domains and Sign in with Apple.
  3. Add the repository secrets listed in the spec. `MACOS_PROVISIONING_PROFILE_BASE64` is the base64 of that profile.

  If a capability is refused, drop its key from `App-macOS.entitlements` and its line from the Task 1 test, and note the lost feature in the Runbook.

- [ ] **Step 2: Write the failing test case.** `macos-export-options.plist` deep-equals:

  ```ts
  {
    method: 'developer-id',
    teamID: 'DNA6966LGZ',
    signingStyle: 'manual',
    signingCertificate: 'Developer ID Application',
    provisioningProfiles: { 'chat.mindroom.app': 'MindRoom Chat Developer ID' },
  }
  ```

  Run it. Expected: FAIL (file missing).

- [ ] **Step 3: Implement `--sign`** in this order:

  1. install the profile into `~/Library/MobileDevice/Provisioning Profiles/`;
  2. archive with `CODE_SIGN_STYLE=Manual`, `CODE_SIGN_IDENTITY="$CODESIGN_IDENTITY"` and `PROVISIONING_PROFILE_SPECIFIER="MindRoom Chat Developer ID"`;
  3. `xcodebuild -exportArchive -exportOptionsPlist ios/App/macos-export-options.plist -exportPath build/macos/export`;
  4. `ditto -c -k --keepParent` the app, then `xcrun notarytool submit --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait`;
  5. `xcrun stapler staple` the app;
  6. stage it as `MindRoom Chat.app` with the `/Applications` symlink, then `hdiutil create -volname "MindRoom Chat" -format UDZO`;
  7. notarize and staple the DMG too.

  The `Capacitor` and `CapacitorCordova` pods have resource-bundle targets that need signing settings in a signed Catalyst build.

  Run the test. Expected: PASS.

- [ ] **Step 4: Add the `macos_app` job:**
  - `needs: release`, `if: ${{ needs.release.outputs.release_created == 'true' }}`, `runs-on: macos-15`, `permissions: contents: write`, with Xcode 26.2 selected;
  - recovery: `release_created` is `false` once the tag exists, so a release whose Mac job failed never gets another run from a push. Add a `workflow_dispatch` input `release_tag` that runs the same job for an existing release, and use `--clobber` so a rerun replaces a partial upload;
  - steps: checkout, setup-node, `npm ci`, `apple-actions/import-codesign-certs` with the `MACOS_CODESIGN_*` secrets, write the profile from `MACOS_PROVISIONING_PROFILE_BASE64`;
  - run the script with an explicit `env`: `CODESIGN_IDENTITY` from the certificate import step's output (as mindroom's `release.yml` finds it), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` from secrets, `MACOS_PROVISIONING_PROFILE_PATH` set to the file the previous step wrote, `MARKETING_VERSION=${{ needs.release.outputs.base_version }}` and `CURRENT_PROJECT_VERSION=${{ needs.release.outputs.release_iteration }}`;
  - `gh release upload "$RELEASE_TAG" build/macos/MindRoom-Chat.dmg --clobber`;
  - mint a token with `actions/create-github-app-token` (`app-id: ${{ vars.RELEASE_BOT_APP_ID }}`, `private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}`, `owner: mindroom-ai`, `repositories: homebrew-tap`);
  - with `GH_TOKEN` set to that step's `token` output (the repository token cannot dispatch to the tap), `gh api repos/mindroom-ai/homebrew-tap/dispatches -f event_type=mindroom-chat-release -f "client_payload[tag_name]=$RELEASE_TAG" -f "client_payload[asset_url]=https://github.com/mindroom-ai/mindroom-chat/releases/download/$RELEASE_TAG/MindRoom-Chat.dmg"`. Copy mindroom's `update_homebrew_tap` job shape.
- [ ] **Step 5: Validate, commit, then verify on a release.** Message: `ci(macos): publish a notarized Mac DMG with each release`.
      After merging and the next release:
  - `codesign -dv --verbose=4` shows `Authority=Developer ID Application` and `flags=0x10000(runtime)`;
  - `codesign -d --entitlements :-` lists the five keys;
  - `spctl -a -vv -t install MindRoom-Chat.dmg` prints `accepted` and `source=Notarized Developer ID`.

### Task 4: The `mindroom-chat` cask (repo `mindroom-ai/homebrew-tap`)

**Files:**

- Create: `Casks/mindroom-chat.rb`
- Modify: `.github/scripts/update_mindroom_cask.py` (`REPO`, `ASSET_NAME` and `CASK_PATH` become a table selected by `--cask`)
- Modify: `.github/workflows/update-mindroom-cask.yml` (`concurrency.group: update-casks`)
- Create: `.github/workflows/update-mindroom-chat-cask.yml`
- Modify: `README.md`
- Test: `tests/test_update_mindroom_cask.py`

**Interfaces:**

- Produces: `CASKS: dict[str, tuple[str, str, Path]]` with:

  - `"mindroom": ("mindroom-ai/mindroom", "MindRoom.dmg", ROOT / "Casks" / "mindroom.rb")`;
  - `"mindroom-chat": ("mindroom-ai/mindroom-chat", "MindRoom-Chat.dmg", ROOT / "Casks" / "mindroom-chat.rb")`.

  `latest_release(repo: str, asset_name: str) -> tuple[str, str]`; `main()` takes `--cask` (choices from `CASKS`, default `mindroom`).

- [ ] **Step 1: Write the failing tests:**

  - `test_chat_cask_uses_chat_repo_and_asset`: `--cask mindroom-chat` with a mocked `api_json` returning tag `v4.12.6-mindroom.268` and asset `MindRoom-Chat.dmg` updates `mindroom-chat.rb` to `version "4.12.6-mindroom.268"`;
  - `test_chat_release_without_dmg_raises`: a latest release without `MindRoom-Chat.dmg` raises `RuntimeError` matching `has no MindRoom-Chat.dmg asset`, and leaves the cask file byte-identical;
  - `test_default_cask_is_mindroom`.

  Run `python3 -m unittest discover tests`. Expected: FAIL.

- [ ] **Step 2: Implement the table and the `--cask` flag;** existing tests keep passing. Create the cask from the spec's Cask section, with `version "0"` and `sha256 "0000000000000000000000000000000000000000000000000000000000000000"`. `update_cask_text` needs exactly one quoted `version` line and one quoted `sha256` line to rewrite, and the first dispatch replaces both. Merge only after Task 3 has published a DMG, so the first update succeeds.
- [ ] **Step 3: Add `update-mindroom-chat-cask.yml`.** Copy `update-mindroom-cask.yml`, but with:
  - `repository_dispatch.types: [mindroom-chat-release]` and a different cron minute;
  - `python3 .github/scripts/update_mindroom_cask.py --cask mindroom-chat`;
  - `brew style`, `audit` and `install --dry-run` run on `mindroom-ai/tap/mindroom-chat`;
  - the commit is `Update MindRoom Chat cask to v${version}`;
  - `concurrency.group: update-casks`.
- [ ] **Step 4: Run the tests (PASS); add an Install line to the README;** commit with `Add MindRoom Chat cask`.

### Task 5: Verify on a real Mac and document (gate G3)

**Files:**

- Modify: `README.md` (Mac row)
- Modify: `docs/ios-pairing-links.md` (the Mac app shares `DNA6966LGZ.chat.mindroom.app`)
- Modify: homebrew-tap `Casks/mindroom-chat.rb` (`zap` paths as observed)
- Modify: `FORK_CHANGES.md`

- [ ] **Step 1: Install and check by hand.** On a Mac, `brew install --cask mindroom-ai/tap/mindroom-chat`, then check each item and record the result in the Runbook:
  1. it launches without a Gatekeeper prompt;
  2. password sign-in, SSO and Sign in with Apple;
  3. sync, open a thread, send, and watch a streaming reply;
  4. save a file;
  5. a voice call (microphone and camera prompts);
  6. a push arrives while the app is quit;
  7. a `https://chat.mindroom.chat/connect?code=…` link clicked in Notes opens the app;
  8. Cmd+C/V in the composer;
  9. a window resized to its minimum;
  10. the app menu's name and the Dock icon (the `AppIcon` set has no Mac sizes);
  11. text size: Catalyst runs in "Scale Interface to Match iPad" (77%); decide whether to switch to "Optimize for Mac";
  12. the microphone-blocked error, which still says "in iPhone settings";
  13. a push while the app is in front (the push plugin's `.alert` option is deprecated on Catalyst);
  14. `navigator.maxTouchPoints` in the app's Web Inspector: `isIOSWebKitDevice()` treats `MacIntel` with touch points as iOS;
  15. the same install on an Intel Mac.
- [ ] **Step 2: Check alongside the App Store app.** With the iPad app also installed, record which app the `/connect` link opens. Confirm that `brew uninstall --zap` leaves the iPad app's container alone.
- [ ] **Step 3: Set the cask's `zap trash:`** to the paths actually created under `~/Library` (WebKit, Caches, HTTPStorages, Preferences, Saved Application State for `chat.mindroom.app`).
- [ ] **Step 4: Update the README.** Mac row: "`brew install --cask mindroom-ai/tap/mindroom-chat` (any Mac with macOS 13.3+), the App Store app on Apple silicon Macs, or the MindRoom macOS app, which also runs your agents". Add the Mac note to `ios-pairing-links.md`. Close the Runbook entry with the Next step: the owner's choice among the spec's MindRoom.app integration options.
- [ ] **Step 5: Validate and commit.** Message: `docs: install MindRoom Chat on Mac with Homebrew`.
