# iOS pairing links

Opening `https://chat.mindroom.chat/connect?code=ABCD-EFGH` from Notes, Messages, or a scanned QR code opens the installed MindRoom Chat iOS app's approval page.
The page uses the accounts already signed in to the app.
Approval still requires inspecting the machine and comparing the displayed code with the code printed by your own terminal.
Without the app installed, the same link opens the web approval page.
Only `/connect` and `/connect/` are associated with the app; other chat links remain web links.
Safari can keep same-domain links in Safari, and iOS remembers a user's choice to open a universal link in the browser.

## Hosting

Vite copies `public/.well-known/apple-app-site-association` to `dist/.well-known/apple-app-site-association`.
Deploy the entire build, including the hidden `.well-known` directory.
The extensionless file must return HTTP 200 with `Content-Type: application/json` over HTTPS, without redirects or an authentication challenge.
The bundled nginx and Netlify configurations provide an exact route ahead of the SPA fallback.
The hosted Caddy configuration lives in `basnijholt/dotfiles`, at `configs/nixos/hosts/hetzner-matrix/caddy.nix`, and needs the equivalent exact file-serving route.
If the file is missing, Caddy and nginx must return 404 rather than the app shell.

Check the deployed origin and Apple's cached copy:

```bash
curl -I https://chat.mindroom.chat/.well-known/apple-app-site-association
curl -fsS https://chat.mindroom.chat/.well-known/apple-app-site-association | jq .
curl -i https://app-site-association.cdn-apple.com/a/v1/chat.mindroom.chat
```

Apple caches associations, including failures; a successful origin response does not prove the CDN or a device has refreshed.
See [Apple's universal-link debugging guide](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links).

## Signing and owner setup

The checked-in app uses Team ID `DNA6966LGZ`, bundle ID `chat.mindroom.app`, and the entitlement `applinks:chat.mindroom.chat`.
The website associates `DNA6966LGZ.chat.mindroom.app` with the two pairing paths.
Install the required iOS platform and a simulator runtime through **Xcode → Settings → Components** if Xcode reports an unavailable build destination.
An Account Holder or Admin must check the Apple Developer account before a device build can be considered verified:

1. Open **Certificates, Identifiers & Profiles → Identifiers** and select `chat.mindroom.app` under team `DNA6966LGZ`.
2. Check **Associated Domains**; enable it and save if it is absent.
3. Regenerate and download affected development and distribution provisioning profiles, or let Xcode automatic signing refresh them after the capability is enabled.
4. In Xcode's **App → Signing & Capabilities**, confirm the Associated Domains entitlement contains `applinks:chat.mindroom.chat`, then build/archive with the refreshed profile.
5. Inspect the signed app with `codesign -d --entitlements :- <App.app>` and confirm the associated domain survived signing.

[Apple documents that modifying an App ID's capabilities invalidates its provisioning profiles](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/).
Do not enable provisioning updates from automation without the account owner's authorization.

## Device verification

After deploying the association file and installing a signed build:

1. Sign in to MindRoom Chat, then fully terminate it.
2. Start a fresh pairing in your terminal and put its link in Notes or Messages.
3. Tap the link: confirm a cold start opens `/connect`, fills the code, and shows the existing signed-in account.
4. Confirm the displayed code matches your terminal, approve, and verify the terminal completes pairing.
5. Start another pairing and repeat with the app already running for the warm-start case.
6. On a disposable device or simulator, delete the app and tap a fresh link: Safari must show the web approval page.
   Deleting the app removes its local session and encryption state; do not use a primary installation without a recovery plan.
7. Check an unrelated link such as `https://chat.mindroom.chat/`: it must remain in the browser.

If the device opens Safari despite a correct association, use a long press on the link to inspect the available app action and consult Apple's debugging guide.
Record the build commit, signing identity/profile, OS/device, origin/CDN results, and each observed outcome.
Unit tests and unsigned simulator builds do not establish universal-link association or successful device approval.

## Self-hosting

The shipped association is for the official MindRoom Chat app and hosted domain.
Serving these static bytes on another domain does not associate that domain with the official app: its entitlement and URL handler accept only `chat.mindroom.chat`.
Ordinary web pairing remains available on other deployments.
For a separately signed iOS fork, change the app/team identifiers and associated-domain entitlement, the expected origin in `src/app/mindroom/native/nativeSso.ts`, and the association file's `appIDs` together.
Keep `hashRouter.enabled: false`, as in the shipped `config.mindroom.json`; native callbacks use browser-router paths, and custom hash-router native builds are outside this integration.
Serve the file at the domain root even when the web client uses a base path, and keep the accepted pairing path aligned across the native handler and association file.
The native handler deliberately forwards only `code`, using the existing `getConnectPath` route builder; `ConnectPage` owns code validation and approval.
Do not change `capacitor://localhost`: the app's sessions and crypto storage are keyed to that origin.

## Mac Catalyst Developer ID distribution

The Mac app uses the same team, bundle ID and `DNA6966LGZ.chat.mindroom.app` website association as iOS.
No additional website association is needed.
When the App Store iPad app is also installed, verify which installation a Notes `/connect` link opens; never delete either installation's data to test routing.

An Account Holder or Admin owns these portal steps:

1. Check Push Notifications, Associated Domains and Sign in with Apple on `chat.mindroom.app` under team `DNA6966LGZ`.
   For the shared bundle ID, leave the legacy **Mac Catalyst (Existing Apps Only)** option alone; [Apple documents this distinction](https://developer.apple.com/help/account/capabilities/create-a-mac-version-of-an-ipad-app).
2. Create a **Developer ID** profile, select **Mac Catalyst**, this App ID and the Developer ID Application certificate whose private key is on the signing Mac.
3. Name it exactly **MindRoom Chat Developer ID** and download it.
4. Decode with `security cms -D -i <download>` into a temporary directory and inspect the team, platform, App ID, expiry, certificate and allowed entitlements without publishing the profile.
5. Run `scripts/build-macos-app.sh --sign` with `CODESIGN_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and `MACOS_PROVISIONING_PROFILE_PATH` in the environment.
   Read secret values with hidden `read -s` input in the same shell that uses them; never put them in shell history or commit them.
   Optional `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` override the archive's versions.
6. Verify Developer ID, the hardened runtime and expected entitlements with `codesign`, then verify the notarized DMG with `spctl -a -vv -t open --context context:primary-signature build/macos/MindRoom-Chat.dmg`.

Account check on 2026-10-28: the regenerated Mac Catalyst profile allows production push and Associated Domains but omits `com.apple.developer.applesignin`, although the portal lists that capability.
The Developer ID build therefore omits that entitlement and opens the Apple provider through its browser authentication session.
The resulting `mindroom://auth` callback returns to the app's login route.
iOS retains its native Apple authorization sheet, including the App Store iPad build on Apple silicon Macs.
The hardened-runtime microphone and camera permissions remain and need no provisioning-profile grant.
See the Runbook for profile metadata, local signing results and the real-Mac checklist.

After an automatic release, **Actions → Create MindRoom Release → Run workflow → release_tag** can retry only the Mac publication for an existing release whose source includes the signing script.
It verifies that the tag still points to the release's original commit, checks out that commit, and uploads `MindRoom-Chat.dmg`.
A published DMG is never replaced, so its bytes and the cask checksum stay fixed; ship changes in a new release.
Only the latest release dispatches the tap update; an older-release recovery must not downgrade the cask.
If only the tap dispatch failed, the tap's daily schedule or its manual **Update MindRoom Chat cask** run picks up the latest release.
No manual tag or release creation is needed.

The signing certificate created for this setup expires on February 1, 2027, earlier than the profile's 2044 expiry.
Before then, renew the Developer ID identity, regenerate the profile with that certificate, and replace the certificate/password and profile repository secrets through the same hidden-input setup.
