<div align="center">

<a href="https://chat.mindroom.chat">
  <picture>
    <source media="(prefers-reduced-motion: no-preference)" srcset="https://raw.githubusercontent.com/mindroom-ai/mindroom/main/assets/logo/logo-mark-animated.svg" />
    <img src="https://raw.githubusercontent.com/mindroom-ai/mindroom/main/assets/logo/logo-mark.svg" alt="MindRoom Chat" width="128" />
  </picture>
</a>

# MindRoom Chat

**The chat app built for AI agents.**

Open source under AGPL-3.0 · Web, Mac, iPhone, iPad, and Android (beta) · Works with any Matrix homeserver

[Open MindRoom Chat](https://chat.mindroom.chat) · [App Store](https://apps.apple.com/us/app/mindroom-ai/id6760272172) · [MindRoom](https://github.com/mindroom-ai/mindroom) · [Docs](https://docs.mindroom.chat) · [Showcase](https://docs.mindroom.chat/showcase/)

</div>

https://github.com/user-attachments/assets/f8325b3c-7ed0-4cd7-bc77-0c4cd74f226e

MindRoom Chat is the client for [MindRoom](https://github.com/mindroom-ai/mindroom), the open-source platform for AI agents that know you and your work.
MindRoom agents are real Matrix users, so MindRoom Chat is a full Matrix client, built on [Cinny](https://cinny.in).
It shows what chat apps made only for people cannot: replies that stream with every tool call visible, approval cards, interactive canvases, and the agent's own browser.

## Get the app

| Where | How |
| --- | --- |
| Web | [chat.mindroom.chat](https://chat.mindroom.chat) |
| iPhone and iPad | [Mindroom AI on the App Store](https://apps.apple.com/us/app/mindroom-ai/id6760272172) |
| Mac | `brew install --cask mindroom-ai/tap/mindroom-chat` (macOS 13.3 or later), the App Store app on Apple silicon Macs, or the [MindRoom macOS app](https://docs.mindroom.chat/installation/macos-app/), which also runs your agents |
| Android | In beta: internal testing on Google Play, not yet public |
| Your own server | The `ghcr.io/mindroom-ai/mindroom-chat` image or a static build; see [Self-hosting](#self-hosting) |

Sign in with any Matrix account, or create a hosted `mindroom.chat` account the first time you sign in at chat.mindroom.chat.
To run your own agents, see the [MindRoom quick start](https://github.com/mindroom-ai/mindroom#quick-start).

## Built for agents

<table>
<tr>
<td width="50%" valign="top">
<a href="https://docs.mindroom.chat/showcase/#ask-approve-done"><picture><source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/5e389c59-c81a-4f70-9c5d-de7406ff95f4" /><img src="https://github.com/user-attachments/assets/bc6194b1-9398-47f5-b649-2ea17dbb6b9f" alt="A review dialog where the user approves an agent's calendar booking" /></picture></a>
<p><b>Approve before it acts</b><br />Actions you choose wait for your OK, with the exact arguments in view.</p>
</td>
<td width="50%" valign="top">
<a href="https://docs.mindroom.chat/showcase/#one-thread-the-whole-team"><picture><source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/635ce3ef-217d-494a-a8e5-01e3dd78454d" /><img src="https://github.com/user-attachments/assets/fbd1295d-025d-41d1-9ee8-0cc674706b98" alt="Three colleagues see the same agent thread side by side" /></picture></a>
<p><b>The whole team, one thread</b><br />Colleagues share an agent in a thread and see every answer stream in live.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://docs.mindroom.chat/showcase/#canvases"><picture><source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/7fc2bc01-1ec5-40d1-971f-5e6f33ba0f18" /><img src="https://github.com/user-attachments/assets/8eb3e6d8-8e9f-4ebb-a51b-bbb5913536e3" alt="Two agent canvases: a week grid of free meeting slots and a weekend trip planner with a budget" /></picture></a>
<p><b>Canvases you can click</b><br />An agent lays out free slots or a trip budget beside the chat and acts on what you pick.</p>
</td>
<td width="50%" valign="top">
<a href="https://docs.mindroom.chat/showcase/#it-drives-you-take-the-wheel"><picture><source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/ddf9402f-a451-4f50-b070-1b50aab739c8" /><img src="https://github.com/user-attachments/assets/6b7a2673-d9b9-446a-b9a7-4e4240241489" alt="The agent hands over the passkey step next to its browser on the order page" /></picture></a>
<p><b>It drives, you take the wheel</b><br />Watch an agent work in its own browser and take over when it needs your passkey.</p>
</td>
</tr>
</table>

These are stills from the [showcase](https://docs.mindroom.chat/showcase/) recordings: MindRoom Chat and a real MindRoom backend, with a fictional company and scripted model responses.

- **Live replies**: agent replies stream in place, with collapsible tool traces, the model and run details, and a button to stop them.
- **Approvals and questions**: approval cards and multiple-choice questions sit in the conversation, one tap away.
- **Canvases**: an agent can open a page it wrote, such as a dashboard, a slide deck, or a form, beside the conversation ([Interactive Canvases](https://docs.mindroom.chat/canvases/)).
  Canvases are on at chat.mindroom.chat and in iOS builds, and self-hosted deployments turn them on in [Configuration](#configuration).
- **Computer**: watch an agent's browser live, take control for a login or passkey, and hand it back; on a homeserver that binds OpenID tokens, such as mindroom.chat, Chat opens the server the agents publish, and otherwise choose the computer service under Settings → General → Computers, or set a default with `mindroom.computers.apiUrl`.
- **Threads first**: a thread-aware composer, deep links, search, unread state, and timeline recovery keep long agent conversations easy to follow, and very long replies arrive whole.
- **Voice**: record voice messages, and call an agent through MatrixRTC with embedded Element Call.
- **Commands**: `!` commands autocomplete as you type.
- **17 languages**, including Arabic and both Chinese scripts; choose yours under Settings → General → Language, and see the [localization guide](./docs/localization.md) to help translate.

## Built on Cinny

MindRoom Chat began as a Cinny fork, but it is now developed as an independent product for Matrix-based AI-agent workflows.
It keeps Cinny's Matrix foundation while owning its product direction, release cadence, native apps, deployment model, and MindRoom integrations.

<details>
<summary><b>What MindRoom Chat changes</b></summary>

| Area | MindRoom Chat direction |
| --- | --- |
| Product | Independent MindRoom branding, roadmap, defaults, onboarding, CI, and releases |
| Agent workflows | Streaming edit resolution, response cancellation, model/run metadata, collapsible tool traces, long-text sidecars, and `!` command autocomplete |
| Threads and navigation | Thread-aware composition, deep links, search, unread state, and timeline recovery tuned for long-running agent conversations |
| Calls and voice | Agent-call flows built on MatrixRTC and embedded Element Call, including encrypted call-key handling and native microphone preflight |
| Native iOS | Capacitor packaging, Apple-oriented authentication, APNs/Sygnal push support, voice recording behavior, and App Store release tooling |
| Deployment | Runtime configuration and base-path support for root or subpath hosting, plus fork-owned Docker and release workflows |
| Engineering | A large regression suite and a maintained compatibility ledger for product, Matrix SDK, deployment, and native-app changes |

</details>

Cinny remains the upstream foundation and is credited in [Upstream attribution](#upstream-attribution).
Compatible upstream improvements continue to be evaluated for incorporation, while MindRoom Chat's product behavior and release decisions are owned here.
For the implementation history and rationale behind individual changes, see [`FORK_CHANGES.md`](./FORK_CHANGES.md).

## Self-hosting

Run the published image:

```bash
docker run -p 8080:80 ghcr.io/mindroom-ai/mindroom-chat:latest
```

Or build the image yourself:

```bash
docker build -t mindroom-chat:latest .
docker run -p 8080:80 mindroom-chat:latest
```

To run MindRoom, a Matrix homeserver, and MindRoom Chat together, use [mindroom-stack](https://github.com/mindroom-ai/mindroom-stack).

### Static hosting

Build and serve `dist/` with your preferred web server.

### Runtime base path (single build artifact)

- Build once with relative assets: `npm run build`
- At runtime set `APP_BASE_PATH` to `/` or `/mindroom`
- Example: `APP_BASE_PATH=/mindroom ./your-server`

Containerized runtime also supports:

- `APP_ENABLE_SERVICE_WORKER` (enabled by default in container runtime config)

When the client shares an origin with sibling applications, add their root-relative path prefixes to the runtime config so the PWA app-shell fallback leaves those navigations to the network:

```js
window.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ = ['/other-app'];
```

Only root-relative paths without a query or fragment are accepted.
Each prefix excludes its exact path and descendants without excluding similarly named client routes.
The MindRoom runtime's own browser pages, `/connections`, `/mcp` and `/reports`, are always excluded and need no entry.

### Build-time base path

- `APP_BUILD_BASE_PATH=/mindroom npm run build`

### Reverse-proxy examples

- Netlify: [`netlify.toml`](./netlify.toml)
- Nginx: [`contrib/nginx/mindroom-chat.domain.tld.conf`](./contrib/nginx/mindroom-chat.domain.tld.conf)
- Caddy: [`contrib/caddy/caddyfile`](./contrib/caddy/caddyfile)

## Configuration

MindRoom Chat reads `config.json` from the root it is served from.
Builds and the development server generate it from [`config.mindroom.json`](./config.mindroom.json), and iOS builds also apply [`config.mindroom.ios.json`](./config.mindroom.ios.json); the repository's `config.json` is Cinny's upstream sample, used only as a fallback by the end-to-end tests.
With the Docker image, mount your own file at `/app/config.json`.
A mounted file replaces the bundled configuration entirely, so start from a copy of the image's own file (in a checkout, `config.mindroom.json` is the same starting point):

```bash
docker run --rm --entrypoint cat ghcr.io/mindroom-ai/mindroom-chat:latest /app/config.json > my-config.json
docker run -p 8080:80 -v "$PWD/my-config.json:/app/config.json:ro" ghcr.io/mindroom-ai/mindroom-chat:latest
```

Notable options:

- homeserver defaults and allowed-server policy,
- auth behavior (including `allowRegistration`, support/privacy/terms links, and the `poweredBy` credits),
- splash loading copy via `splash.loadingMessages`,
- MindRoom placeholder copy via `mindroom.thinkingPlaceholderMessages`,
- canvases and their npm library loading via `mindroom.canvas.enabled` and `mindroom.canvas.libraries`,
- the default computer service via `mindroom.computers.apiUrl`, which otherwise comes from the agents on a homeserver that binds OpenID tokens,
- agent UI automatic-opening policy via `mindroom.uiActions.autoOpenFromHomeservers`,
- additional application-link schemes via `messageRendering.additionalAllowedUriSchemes`,
- sidebar entry points including `sidebar.showThreads` and `sidebar.showExploreCommunityInSimpleMode`,
- welcome-page behavior.

<details>
<summary><b>Opening agent panels automatically</b></summary>

Agent requests can open a canvas, Computer, Settings, or Members automatically only when the agent's Matrix server name is explicitly trusted by the deployment:

```json
{
  "mindroom": {
    "uiActions": {
      "autoOpenFromHomeservers": ["mindroom.chat"]
    }
  }
}
```

MindRoom's shipped configuration lists `mindroom.chat`.
An absent or empty list disables automatic opening; valid requests still have a button the addressed user can click.
Entries match the exact server name in the Matrix user ID, including any port; URLs, wildcards, and implicit subdomains are unsupported.
The existing checks for joined `mindroom_` agents on the viewer's own homeserver still apply.
Only list homeservers whose operators control the agent username namespace; this setting trusts that operator policy, not every account on the server.
Live delivery, focus, conversation, and computer authorization checks continue to apply.

</details>

<details>
<summary><b>Explorer in Simple Mode</b></summary>

Explorer is hidden from the sidebar by default in Simple Mode.
To show it in Simple Mode, set `sidebar.showExploreCommunityInSimpleMode` to `true` in the served `config.json`:

```json
{
  "sidebar": {
    "showExploreCommunityInSimpleMode": true
  }
}
```

Setting it to `false` or omitting it keeps Explorer hidden in Simple Mode.
This option does not affect the full interface, which `sidebar.showExploreCommunity` controls; its code default is `true`, but MindRoom's shipped configuration sets it to `false`, so set it to `true` as well to show Explorer there.

</details>

<details>
<summary><b>Additional link schemes</b></summary>

Formatted message links can allow additional desktop application URI schemes:

```json
{
  "messageRendering": {
    "additionalAllowedUriSchemes": ["obsidian"]
  }
}
```

Use scheme names without `://`.
Trailing `:` or `://` delimiters are normalized if supplied.
The configured list is additive to the built-in safe schemes.
Browser-sensitive schemes including `javascript`, `data`, `file`, `blob`, `vbscript`, `about`, `chrome`, `chrome-extension`, `filesystem`, `resource`, and `view-source` are always ignored.

</details>

### Notices

Operators can show short banners above every screen, including sign-in and loading, without a rebuild.
The web app reads `notices.json` from the root it is served from, on load, every 60 seconds and when the window regains focus, so a change reaches open tabs within about a minute.
It needs neither Matrix nor MindRoom, so a notice stays up while both are down.
The native apps don't fetch the file, so they show no notices.

```json
[
  {
    "id": "cutover-2026-10-24",
    "level": "warning",
    "icon": "clock",
    "text": "**MindRoom is moving tonight**, 00:50 to 02:00 PDT. Chat and agents may be unavailable; see [the plan](https://example.org/plan).",
    "startsAt": "2026-10-23T22:00:00-07:00",
    "endsAt": "2026-10-24T02:30:00-07:00",
    "linkUrl": "https://status.example.org",
    "linkText": "Status"
  }
]
```

- `id` (required, at most 200 characters): a dismissal hides the notice on that device by `id`, so give a changed notice a new `id` to show it again.
- `text` (required, at most 1000 characters): plain text with inline Markdown only: `**bold**`, `*italic*` or `_italic_`, `~~strikethrough~~`, `` `code` `` and `[label](https://…)` links.
  Anything else, HTML included, shows as typed.
  As in chat messages, `_` pairs make italics (`snake_case_name` too), so write `\_` or use `` `code` ``.
  Write `)` in a link URL as `%29`.
  Long text folds to three lines behind "Show more".
- `level` (required): `info`, `warning`, `success` or `critical`.
- `icon`: one emoji, or `info`, `warning`, `check`, `clock`, `bell`, `server` or `settings`.
  Defaults to the level's icon.
- `startsAt`, `endsAt`: ISO 8601 times with `Z` or an offset; the notice shows from `startsAt` until `endsAt`.
- `dismissible`: `false` hides the dismiss button.
  Defaults to `true`.
- `linkUrl`, `linkText` (at most 200 characters): a link after the text; `linkText` defaults to the host.

Links must use `https:`; other links show as text, and an entry with another `linkUrl` is skipped.
An invalid entry is skipped; an invalid file, or a 404, shows no notices.
If the file cannot be reached (a network or server error, a redirect such as an expired Cloudflare Access session, or no answer within 10 seconds), open tabs keep the notices they have until the next successful load.
At most three notices show at once, in file order.
To remove a notice for everyone, delete its entry or set `endsAt` in the past; to clear all, serve `[]`.

The Docker image serves `/opt/mindroom/notices/notices.json`, which is `[]`, with `Cache-Control: no-store`, also under a runtime base path.
Mount a directory over `/opt/mindroom/notices` to replace it:

```bash
docker run -p 8080:80 -v "$PWD/notices:/opt/mindroom/notices:ro" ghcr.io/mindroom-ai/mindroom-chat:latest
```

In Kubernetes, mount a ConfigMap with a `notices.json` key at `/opt/mindroom/notices` without `subPath`, so edits reach the pod without a restart (the kubelet syncs ConfigMap volumes within one to two minutes).

## Development

```bash
npm ci
npm run test
npm run build
```

Start a local development server with `npm start`.

<details>
<summary><b>Dockerized Matrix end-to-end tests</b></summary>

The Docker boundary for local e2e is the Matrix stack, not the MindRoom Chat app itself.
MindRoom Chat and Playwright stay on the host.
Docker only runs a disposable Tuwunel homeserver.

Start or stop the local Matrix stack:

```bash
npm run e2e:matrix:up
npm run e2e:matrix:down
```

Run the e2e suite against that Docker-backed homeserver:

```bash
npm run test:e2e:docker-matrix
```

Pass extra Playwright arguments after `--`:

```bash
npm run test:e2e:docker-matrix -- e2e/live/smoke.spec.ts
npm run test:e2e:docker-matrix -- --grep "three stored accounts"
```

Notes:

- The stack is defined in [`e2e/docker-compose.matrix.yaml`](./e2e/docker-compose.matrix.yaml).
- The wrapper provisions three local e2e accounts, seeds the shared fixture room, and starts a static built preview on `http://127.0.0.1:28090` for the deployed clear-cache spec.
- The main app under test still runs from the host via Playwright's normal `webServer` (`npm run start -- --host 127.0.0.1 --port 4173 --strictPort`) unless `E2E_NO_WEB_SERVER=1`.
- Useful overrides:
  `E2E_MATRIX_PORT`,
  `E2E_MATRIX_SERVER_NAME`,
  `E2E_MATRIX_AUTO_DOWN=1`,
  `E2E_ENABLE_DEPLOYED_FIXTURE=0`,
  `E2E_SERVER_COMMAND`,
  `MINDROOM_TUWUNEL_IMAGE`.

</details>

## Native apps

### iOS build and archive

```bash
npm run build:ios
npm run ios:icons
npm run appstore:preflight
npx cap sync ios
npx cap open ios
```

Then archive from Xcode (`App` scheme, `Any iOS Device (arm64)`).

iOS docs:

- Checklist: [`APP_STORE_COMPLIANCE.md`](./.docs/APP_STORE_COMPLIANCE.md)
- Submission metadata/review notes packet: [`APP_STORE_SUBMISSION_PACKET.md`](./.docs/APP_STORE_SUBMISSION_PACKET.md)
- Build guide: [`ios-build.md`](./.docs/ios-build.md)
- Canvases and computers in iOS builds: [`ios-panels.md`](./docs/ios-panels.md)

### iOS pairing links

The iOS app opens hosted `/connect?code=…` links on its approval page using the accounts already signed in to the app.
See [iOS pairing links](docs/ios-pairing-links.md) for association-file hosting, Apple Developer capability/profile setup, self-hosted forks, and device verification.

<details>
<summary><b>TestFlight via Xcode Cloud</b></summary>

The Xcode Cloud workflow should archive the iOS app with the `Archive - iOS` action.
Set that action's `Distribution Preparation` to `TestFlight (Internal Testing Only)` so successful archives are prepared for TestFlight.
If that setting changes after a successful archive, rerun the workflow because existing archives are not prepared for TestFlight retroactively.
[`scripts/ios-ci-version.mjs`](./scripts/ios-ci-version.mjs) chooses the App Store version and build number.
The build number is `IOS_BUILD_NUMBER` when set, otherwise Xcode Cloud's `CI_BUILD_NUMBER`, otherwise the `<n>` of a `v<version>-mindroom.<n>` release tag, otherwise the checked-in Xcode build number.
With `CI_BUILD_NUMBER`, the marketing version adds that counter to the patch of the newer of the `package.json` version and the checked-in `MARKETING_VERSION`, so version `4.12.6` with build `64` uploads as `4.12.70 (64)`.
Set `IOS_MARKETING_VERSION` or `IOS_BUILD_NUMBER` in Xcode Cloud only when overriding those defaults is intentional.

</details>

<details>
<summary><b>iOS push notifications (APNs + Matrix)</b></summary>

Native iOS push plumbing is included in this fork (`@capacitor/push-notifications` + Matrix pusher registration).
The bundled `config.mindroom.json` already turns `push.ios` on for MindRoom's own app (`chat.mindroom.app`) and push gateway.
For your own app build:

1. Set `appId` and `gatewayUrl` in `push.ios` in `config.mindroom.json`, which iOS builds bundle; `appId` must be your app's bundle ID, the same value as `appId` in `capacitor.config.ts` and Xcode's `PRODUCT_BUNDLE_IDENTIFIER`, which `npm run appstore:preflight` checks:

```json
{
  "push": {
    "ios": {
      "enabled": true,
      "appId": "YOUR.BUNDLE.ID",
      "gatewayUrl": "https://YOUR-PUSH-GATEWAY/_matrix/push/v1/notify",
      "appDisplayName": "MindRoom Chat iOS",
      "deviceDisplayName": "MindRoom Chat iOS",
      "append": true,
      "format": "full"
    }
  }
}
```

2. Rebuild and sync the iOS project after config or dependency changes: `npm run build:ios && npx cap sync ios`.
3. In Xcode, confirm `Signing & Capabilities` includes `Push Notifications`.
4. Run the app on a physical iPhone and enable `Settings → Notifications → iOS Push Notifications` inside MindRoom Chat.
5. Ensure your Matrix push gateway has an app entry for that `appId` that accepts APNs tokens from the matching APNs environment: Xcode's Debug configuration registers sandbox tokens, while Release, TestFlight, and App Store builds register production tokens (Sygnal's `platform` defaults to `production`).
   The app registers its APNs token in hex, so a Sygnal app entry also needs `convert_device_token_to_hex: false`.

`format: "full"` is an explicit opt-in that lets a Sygnal-compatible gateway receive the sender and message preview for unencrypted rooms.
Omitting it uses the privacy-preserving `event_id_only` fallback.
Encrypted rooms use a generic notification because the homeserver cannot read their message content.

</details>

<details>
<summary><b>Android Play internal releases</b></summary>

- The `dev` push release workflow (see [Releases](#releases)) also builds a signed Android App Bundle and publishes it to the Google Play `internal` track when it creates a new MindRoom GitHub release.
- Required GitHub secrets:
  `ANDROID_UPLOAD_KEYSTORE_BASE64`,
  `ANDROID_UPLOAD_KEYSTORE_PASSWORD`,
  `ANDROID_UPLOAD_KEY_ALIAS`,
  `ANDROID_UPLOAD_KEY_PASSWORD`,
  and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- The keystore secret should be the base64-encoded upload keystore file.
  The Play service account must have permission to release `com.mindroom_ai.app`.

</details>

## Releases

- Every push to `dev` creates an automated GitHub release tag in the format `v<base_version>-mindroom.<n>`.
- `base_version` is read from [`package.json`](./package.json) by default (or `BASE_VERSION` if set), with upstream-style semver tags as fallback; `<n>` increments from existing fork tags for that base version.
- The Python helper is reusable across forks via env vars: `RELEASE_TAG_PREFIX`, `RELEASE_TAG_SUFFIX`, `BASE_TAG_PREFIX`, `BASE_VERSION`.
- Local preview of the next tag:

```bash
npm run release:next-tag
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the [code of conduct](./CODE_OF_CONDUCT.md).
Changes that apply generally to Cinny are often best contributed upstream; changes for MindRoom agent workflows belong here.

## Upstream attribution

This project is built on top of Cinny and Matrix ecosystem libraries.

- MindRoom Chat: <https://github.com/mindroom-ai/mindroom-chat>
- Original Cinny project: <https://cinny.in>
- Matrix: <https://matrix.org>

## License

Licensed under AGPL-3.0-only (same as upstream project).
See [`LICENSE`](./LICENSE).
