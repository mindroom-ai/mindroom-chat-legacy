# Rebasing MindRoom Chat onto Cinny releases

The upstream base is Cinny **v4.12.6**.
Keep the fork as a linear sequence of feature changes above that release.
A feature commit includes its implementation, application wiring, and relevant tests, even when those files live in different directories.
Shared files can change in several feature commits.
There is no target commit count and no rule that each file may appear only once.

## Feature boundaries

Prefer commits that explain one capability or one necessary correction.
For example, a tool-approval workflow spans permission parsing, eligibility checks, action controls, timeline history, the composer, cache engine state, and tests.
Keep changes with real dependencies in order.
Fold related follow-up fixes when their dependencies permit it, and remove exact reverted experiments after checking the resulting tree.
A directory name alone does not define a feature.
Do not collect all application wiring into a final integration commit.

Use existing feature patches as evidence when reconstructing older history.
Preserve their integration hunks rather than substituting the final version of a shared file into an earlier commit.
Mechanical file moves can form one focused refactor with the imports and tests needed to complete the move.
Keep operational documentation current without replaying every historical status update.

The complete stack is the release gate.
Historical feature boundaries do not establish that every intermediate commit builds against the current upstream dependency graph.
Do not claim a commit is independently buildable or bisectable without checking it.
For new work, aim for a complete, testable change at each commit boundary.
Recovered history still records older implementations before their later refactors.
A module extraction at the tip reduces future development overlap, but replay can still encounter the earlier edits to upstream files.
The feature history is therefore not a minimal patch series containing only final implementations.

## File boundaries

Keep fork behavior in focused modules under `src/app/mindroom/` and keep upstream integration points small.
Split by responsibility and stable inputs, not by line count alone.
A feature may need several files; a shared helper may serve several features.
Avoid helpers that accept large bags of component state merely to shorten a file.

Matrix lifecycle responsibilities now have explicit owners:

| Responsibility                                        | Module                                             |
| ----------------------------------------------------- | -------------------------------------------------- |
| Client construction and initialization order          | `src/client/initMatrix.ts`                         |
| Crypto database continuity and server device identity | `src/app/mindroom/matrix/cryptoStoreContinuity.ts` |
| Saved sync archive sizing and startup sync policy     | `src/app/mindroom/matrix/clientSyncPolicy.ts`      |
| Browser database inventory and app-scoped cleanup     | `src/app/mindroom/matrix/browserStorageCleanup.ts` |
| Session removal, logout, and cleanup sequencing       | `src/app/mindroom/matrix/sessionLifecycle.ts`      |

The existing `initMatrix.ts` exports remain compatible for callers.
The fork lifecycle modules must not import that startup orchestrator.
Keep behavioral coverage for initialization and cleanup order, credential removal, shared-account isolation, and browser storage scope.
Inspect upstream lifecycle changes and port relevant behavior to the owning module; a small integration file does not make upstream changes irrelevant.

Message, composer, and timeline responsibilities also have focused owners:

| Responsibility                                                           | Module under `src/app/mindroom/`              |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| Message reactions                                                        | `messages/MessageReactionActions.tsx`         |
| Read receipts and source inspection                                      | `messages/MessageInspectionActions.tsx`       |
| Message text and permalink copying                                       | `messages/MessageCopyActions.tsx`             |
| Pinning, deletion and reporting                                          | `messages/MessageModerationActions.tsx`       |
| Timeline event row layout and menu                                       | `messages/MindroomTimelineEvent.tsx`          |
| Attachment preparation and encryption                                    | `room-input/roomInputUploadPreparation.ts`    |
| Upload transport and voice upload content                                | `room-input/useRoomInputUploadTransport.ts`   |
| Synchronous paste fallback and large pasted-text attachments             | `room-input/useRoomInputPaste.ts`             |
| Editor keyboard, autocomplete, toolbar, emoji and sticker controls       | `room-input/RoomInputEditor.tsx`              |
| Reply identity, colors and pending-send context                          | `room-input/RoomInputReplyPreview.tsx`        |
| Attachment staging, enrollment, reservations and upload-board UI         | `room-input/useRoomInputAttachments.tsx`      |
| Recorder controls, failed voice drafts and voice bundle sending          | `room-input/useRoomInputVoice.tsx`            |
| Membership, room changes, call membership and generic event presentation | `threads/roomTimelineStateEventRenderers.tsx` |
| Profile, mention, reply, reaction and edit interactions                  | `threads/useRoomTimelineMessageActions.ts`    |
| Pointer eligibility, item derivation and minimap selection               | `threads/useRoomTimelineMinimap.ts`           |
| Measured classic-room opening and automatic history fill                 | `threads/roomAutomaticFill.ts`                |

Keep the public exports of `MindroomMessage.tsx`, `MindroomRoomInput.tsx`, and `MindroomRoomTimeline.tsx` compatible.
Their extracted modules must import their dependencies directly, without importing the parent facade.
The composer parent owns draft persistence, serialization, commands and submission routing.
Editor controls, attachment staging and voice sending each own their state, lifecycle and UI.
Attachment consumers use synchronous snapshots and explicit append, removal, enrollment and reservation operations; they do not share the owner's mutable refs.
Paste reservations prevent automatic orphan cleanup while a voice bundle claims its companions, but explicit removal remains authoritative.
Keep claimed sends usable after unmount and preserve the originating room when reading or clearing drafts and uploads.
Timeline message rendering has its own owners under `threads/message-rendering/`:

| Responsibility                                                      | Module                            |
| ------------------------------------------------------------------- | --------------------------------- |
| Presentation settings, permissions, editing and event dispatch      | `useTimelineMessageFeature.tsx`   |
| Shared row layout, reactions, reply previews and thread badges      | `TimelineMessageFrame.tsx`        |
| Text, approvals, stickers and encrypted message content             | `TimelineMessageBody.tsx`         |
| Manual and live expansion state, bulk controls and scroll anchoring | `useTimelineMessageExpansion.tsx` |

Message state initializes before viewport controllers consume editing and expansion commands.
Concrete thread data and navigation bind later when rendering rows; viewport effects do not need to move to satisfy that dependency.
Capture each row's previous event ID before advancing the grouping cursor.
Keep dispatch synchronous because hidden-row results determine grouping and divider behavior.
Share the message frame while preserving each event kind's editing, reply and thread-badge policy.
Keep cache, pagination, and scroll coordination in the timeline.
Classic-room automatic fill waits for committed, measured geometry before retrying visible pagination sentinels.
Its initial measured reveal happens once; user navigation releases that opening policy.
Check ownership when an intersection callback runs so inactive or completed opening preserves ordinary forward/backward pagination dispatch.
The scroll ledger must commit its margin before measurement callbacks read a changed content height, and capture the settlement target before removing that margin can clamp the browser offset.
Keep real virtualizer regressions and compositor-level live checks when changing these boundaries; animation-frame samples alone missed a painted scroll jump.
Future extractions should establish a useful interface before moving another block of code.
Keep the paste handler synchronous: an unhandled paste must return `undefined` so Slate can run its default behavior.
Inspect corresponding upstream renderer and composer changes even when the compatibility wrappers merge cleanly.

## SDK, thread, and voice owners

Matrix SDK compatibility operations have narrow owners under `src/app/mindroom/threads/sdk/`.

| Responsibility                                                                             | Module                  |
| ------------------------------------------------------------------------------------------ | ----------------------- |
| Cached room timeline insertion and prepend                                                 | `roomTimelineSdk.ts`    |
| Initialized thread creation, one bounded bootstrap fetch, and synchronous relation prepend | `threadBootstrapSdk.ts` |

Thread orchestration state and viewport composition have separate owners.

| Responsibility                                                 | Module                                      |
| -------------------------------------------------------------- | ------------------------------------------- |
| Opening, cache, latest, target, revision, and data-lease state | `threads/session/useThreadSession.ts`       |
| Backward and forward request state plus late runtime binding   | `threads/session/useThreadPagination.ts`    |
| Late opening-effect installation                               | `threads/threadOpenLifecycleController.ts`  |
| Seed prewarm scheduling from window-derived inputs             | `threads/threadSeedPrewarmController.ts`    |
| Request-scoped DOM and ledger viewport binding                 | `threads/useThreadPrependViewport.ts`       |
| Prepend anchor and open-pin suppression commands               | `threads/threadBackPaginationController.ts` |
| Timeline state, virtualizer, DOM, and ledger composition       | `threads/MindroomRoomTimeline.tsx`          |

The timeline parent may install the opening lifecycle and seed prewarm seams, but migrated opening and pagination algorithms stay behind their session owners.
Architecture tests analyze runtime dependencies for that parent boundary so its explicit type contracts remain legal.

Voice capture and durable delivery also have separate owners.

| Responsibility                                                                      | Module                              |
| ----------------------------------------------------------------------------------- | ----------------------------------- |
| Browser recorder resources, timers, samples, generation events, and capture results | `voice/voiceCaptureSession.ts`      |
| Durable initial-send settlement, retry claims, token settlement, and draft writes   | `voice/voiceSendDraftController.ts` |
| React composition and public recorder compatibility API                             | `voice/useVoiceRecorder.ts`         |

The delivery controller may import the capture result type as an explicit type-only dependency.
It must not acquire microphone resources or own browser cleanup, and capture must not import durable draft or Matrix delivery state.

## Upstream source footprint report

`.github/upstream-source-base.json` tracks the default release tag used by the report.
Normal report commands read only local Git state and fail clearly when the configured tag is missing.

```bash
node scripts/report-non-mindroom-source-diff.mjs
node scripts/report-non-mindroom-source-diff.mjs refs/tags/v4.12.6 HEAD
node scripts/report-non-mindroom-source-diff.mjs --pr-base BASE --head HEAD --format markdown
node scripts/report-non-mindroom-source-diff.mjs --pr-base BASE --head HEAD --format json
```

The explicit fetch command writes the configured public release tag into the local repository.
It validates a `refs/tags/` ref and refuses to force-update an inconsistent existing tag.

```bash
node scripts/report-non-mindroom-source-diff.mjs --fetch-configured-upstream https://github.com/cinnyapp/cinny.git
```

Pull request CI fetches that configured tag before reporting because fork remotes do not necessarily publish upstream release tags.
The job appends Markdown to its step summary and uploads lossless JSON while treating footprint size as information rather than a failure budget.
Both before and after footprints use the current configured release tag, while PR increment paths use the merge base of the actual PR base and head commits.

## Next release

1. Resolve Cinny's latest stable GitHub release and fetch that exact tag.
   Fetch the current fork branch separately and pin its SHA before starting.
2. Preserve existing branch tips with local backup refs and create a persistent worktree.
   Confirm the source checkout is clean and account for newer remote commits.
3. Inspect the released upstream delta, especially files replaced by MindRoom wrappers.
   Use the ownership reports with an explicit base: `node scripts/report-non-mindroom-source-diff.mjs refs/tags/v4.12.6 HEAD` and `node scripts/report-package-dependency-diff.mjs v4.12.6 HEAD`.
4. Replay the current stack with `git -c rebase.updateRefs=false -c rebase.autoStash=false rebase --onto <new-release-tag> v4.12.6`.
   Disable automatic ref updates so unrelated feature branches and worktrees stay untouched.
   Resolve mixed upstream/fork files deliberately.
5. Reconcile dependency and version changes, run the complete checks below, and compare the result against the pinned source.
6. If accumulated follow-ups obscure features, regroup the verified history around behavior and its dependencies.
   Require exact Git tree equality between the integrated result and the regrouped stack before making additional code changes.
   Preserve file modes, symlinks, binary files, and deletions.
   Review any subsequent refactor separately so history reconstruction cannot conceal a behavior change.
7. Update this base tag and the current Runbook entry in `FORK_CHANGES.md`.
   Publishing rewritten shared history is a separate operation requiring explicit authorization.

## Conflict rules

- Preserve upstream ownership of `config.json` and place MindRoom runtime defaults in `config.mindroom.json`.
  The current fork also intentionally sets `messageRendering.additionalAllowedUriSchemes` to `["obsidian", "readdlespark"]` in the shared `config.json`; retain this existing compatibility setting when merging upstream changes.
- The seven `mindroom-wrapper` entries in `.gitattributes` protect pure re-export wrappers.
  `bash scripts/setup-git-merge-drivers.sh` installs the optional local driver.
  The driver preserves wrappers but cannot port upstream behavior into `src/app/mindroom/`.
  Inspect the corresponding upstream implementation whenever it changes.
- Preserve branded auth/welcome surfaces when upstream only updates a removed version label.
  Update the remaining About version and ensure both iOS marketing-version floors are at least the package version.
- Preserve fork-specific CI validation, release artifact names, and container version wiring while accepting upstream action updates.
- Merge lockfiles semantically and validate the installed dependency graph.
  A successful `npm ci` alone does not prove nested dependency versions satisfy their parents.
  Remove stale nested records after upstream downgrades or consolidates a dependency family.
- Preserve exact patched versions or deliberately regenerate and validate the corresponding patches.
  Current patches target `matrix-js-sdk@41.7.0`, `@tanstack/virtual-core@3.17.3`, and `folds@2.7.1`.
  The Matrix SDK patch covers thread reset protection and relation insertion when the parent belongs to another timeline in the same set.
  It also gives ephemeral events the room of their sync section and keeps failed decryptions of live reply frames (`$io.mindroom.live.` event IDs) out of the pending-key list and key-backup downloads.
  Run the four actual-SDK regression suites after upgrading (`src/app/mindroom/threads/matrixSdkThreadReset.test.ts`, `src/app/mindroom/threads/matrixSdkTimelineInsertion.test.ts`, `src/client/syncEphemeralRoom.test.ts`, and `src/client/rustCryptoLiveFrames.test.ts`), and keep patched runtime JavaScript, TypeScript, and source maps aligned.
  The folds patch adds six scrollbar color fallbacks and must retain upstream's Firefox feature query.

## Verification

Use the Node version in `.node-version` (currently 24.13.1) and a standard Linux or supported native environment.
Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
Run `node --test scripts/appstore-fixture.test.mjs` when native screenshot tooling is carried forward.
Inspect `npm ls --all`; distinguish inherited peer-range conflicts from new invalid required dependencies.
For this base, `npm ls workbox-build workbox-precaching workbox-routing --all` must pass.
Confirm all three patches apply, formatting is clean on integration edits, and the production/PWA build verifies the Element Call background.
Run targeted Playwright coverage against local Matrix for auth, thread view switching, summaries, sending, and read receipts.
For comprehensive live verification, exercise every discovered case under `e2e/live` with its required account modes and room, agent, portal, and minimap fixtures.
Use fresh accounts per spec to isolate persisted settings, retain failures for diagnosis, and treat skipped or missing cases as unverified coverage.
Update stale setup and selectors only against evidenced product behavior; preserve performance budgets and prove pagination tests actually introduce new history during measurement.
Derive boundary rides from committed starting geometry, and prove native gesture travel and post-release momentum through visible anchors rather than ledger-sensitive scroll offsets.
Check the scrollbar patch in a browser when updating folds.
Preserve source refs and record the exact checked tree before rewriting history.
