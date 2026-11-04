import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { IContent, MatrixClient } from 'matrix-js-sdk';
import type { Descendant } from 'slate';
import { Icon, Icons } from 'folds';
import { ComposerIconButton } from '../../components/editor/ComposerIconButton';
import { IconTooltip } from '../tooltip/IconTooltip';
import { useMediaConfig } from '../../hooks/useMediaConfig';
import {
  TUploadItem,
  pendingVoiceSendDraftAtom,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import { pauseAllMediaElements } from '../../utils/dom';
import {
  MatrixUploadErrorStage,
  getMatrixUploadOriginalName,
  toMatrixUploadError,
} from '../../utils/matrix';
import { Membership } from '../../../types/matrix/room';
import {
  MindroomVoiceRecorderComposer,
  getMindroomRoomInputVoiceSendContext,
  refreshMindroomRoomInputVoiceSendContext,
  type MindroomVoiceRecorderComposerHandle,
  type MindroomVoiceSendContext,
} from './RoomInputMindroomExtensions';
import { hasFailedPasteMarkerInText } from '../threads/useRoomInputSendSessionController';
import type { useRoomInputSendSessionController } from '../threads/useRoomInputSendSessionController';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import type { useRoomInputUploadTransport } from './useRoomInputUploadTransport';

type VoiceComposerAdapter = {
  getContext: () => Pick<
    MindroomVoiceSendContext,
    'roomId' | 'room' | 'threadId' | 'replyDraft' | 'threadingEnabled'
  >;
  snapshotText: () => Descendant[];
  resetText: () => void;
  restoreText: (roomId: string, fragment: Descendant[], threadId?: string) => void;
  clearConsumedReply: (context: Pick<MindroomVoiceSendContext, 'roomId' | 'replyDraft'>) => void;
};

type UseRoomInputVoiceOptions = {
  mx: MatrixClient;
  roomId: string;
  composer: VoiceComposerAdapter;
  attachments: RoomInputAttachmentAccess;
  transport: Pick<
    ReturnType<typeof useRoomInputUploadTransport>,
    'createVoiceUploadItems' | 'uploadItem' | 'uploadItemWhileStaged' | 'sendVoiceItem'
  >;
  sessions: Pick<
    ReturnType<typeof useRoomInputSendSessionController>,
    'hasActiveSendSession' | 'startSendSession'
  >;
  onRoomMessageSent?: (eventId: string) => boolean | void;
};

type VoiceFeature = {
  blocksSubmit: () => boolean;
  submitIfActive: (textContent?: IContent) => Promise<boolean>;
  microphone: React.ReactNode;
  renderRecorder: (onRetryRequest: () => void) => React.ReactNode;
};

type PendingVoiceComposerBundle = {
  roomId: string;
  composerThreadId?: string;
  relationContext?: Pick<MindroomVoiceSendContext, 'threadId' | 'replyDraft' | 'threadingEnabled'>;
  textContent?: IContent;
  composerFallback?: Descendant[];
  companionItems: TUploadItem[];
  composerReset: boolean;
  handedOff: boolean;
  releasePasteProtection: () => void;
};

export const useRoomInputVoice = ({
  mx,
  roomId,
  composer: { getContext, snapshotText, resetText, restoreText, clearConsumedReply },
  attachments: attachmentAccess,
  transport: { createVoiceUploadItems, uploadItem, uploadItemWhileStaged, sendVoiceItem },
  sessions: { hasActiveSendSession, startSendSession },
  onRoomMessageSent,
}: UseRoomInputVoiceOptions): VoiceFeature => {
  const { t } = useTranslation();
  const store = useStore();
  const mediaConfig = useMediaConfig();
  const allowUploadSize = mediaConfig['m.upload.size'] ?? Infinity;
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);
  const pendingVoiceSendDraft = useAtomValue(pendingVoiceSendDraftAtom);
  const setPendingVoiceSendDraft = useSetAtom(pendingVoiceSendDraftAtom);
  // Drafts are stamped with the matrix userId of the session that captured
  // them. The global atom is one slot for the whole router, so an account
  // switch in the sidebar leaves yesterday's draft visible to a new
  // account; ignore (and clean up) any draft that does not belong to us.
  const currentSessionId = mx.getUserId() ?? undefined;
  const draftBelongsToCurrentSession =
    !!pendingVoiceSendDraft && pendingVoiceSendDraft.context.ownerSessionId === currentSessionId;
  const ownsPendingVoiceDraft =
    draftBelongsToCurrentSession && pendingVoiceSendDraft?.context.roomId === roomId;
  const otherRoomOwnsPendingVoiceDraft = draftBelongsToCurrentSession && !ownsPendingVoiceDraft;
  const otherPendingVoiceRoomName =
    otherRoomOwnsPendingVoiceDraft && pendingVoiceSendDraft
      ? pendingVoiceSendDraft.context.room.name ?? pendingVoiceSendDraft.context.roomId
      : undefined;
  const voiceAutoSendClaimedRef = useRef(false);
  const voiceAutoSendInFlightRef = useRef(false);
  const voiceRecorderRef = useRef<MindroomVoiceRecorderComposerHandle>(null);
  const pendingVoiceComposerBundleRef = useRef<PendingVoiceComposerBundle>();

  // When this room owns a pending failed-send draft (e.g. survived a
  // RoomProvider key remount on real navigation), surface the recorder so
  // the user can see the retry/discard controls.
  useEffect(() => {
    if (ownsPendingVoiceDraft) {
      setVoiceRecorderOpen(true);
    }
  }, [ownsPendingVoiceDraft]);

  // Close the auto-opened recorder when the parked draft transitions
  // away. This covers two cases the hook can't observe locally:
  //   1. A previous mount started a retry, the user navigated away, the
  //      retry settled remotely, and we're now back in the source room
  //      with phase synced to 'sending' from the atom.
  //   2. Some other surface discarded the draft (e.g. a future global
  //      discard action).
  // Without this effect, voiceRecorderOpen stays true and the capsule
  // would render with stale local state.
  const previousPendingDraftRef = useRef(pendingVoiceSendDraft);
  useEffect(() => {
    const previous = previousPendingDraftRef.current;
    previousPendingDraftRef.current = pendingVoiceSendDraft;
    if (
      previous &&
      previous.context.roomId === roomId &&
      !pendingVoiceSendDraft &&
      voiceRecorderOpen
    ) {
      setVoiceRecorderOpen(false);
    }
  }, [pendingVoiceSendDraft, roomId, voiceRecorderOpen]);

  // Discard any orphaned draft. Three cases:
  //   1. Account-switch leak: the atom is module-level and survives
  //      logout/login since the router store is shared across sessions.
  //      A draft from account A must not block voice recording in B.
  //   2. Same-session room loss (rev-A R4 Issue 2): if the user was
  //      kicked from / left / forgot the parked-draft room, the
  //      otherRoomOwnsPendingVoiceDraft gate would lock the mic in
  //      every other room with no in-app surface to discard.
  //   3. Same-session non-joinable room (rev-B / rev-G R5): a Room
  //      object can survive in mx.getRoom() after the user is no longer
  //      Joined (Leave/Ban/etc), in which case the source room composer
  //      cannot render and the user has no way to retry/discard. Treat
  //      "not joined" the same as "not present".
  useEffect(() => {
    if (!pendingVoiceSendDraft) return;
    if (!draftBelongsToCurrentSession) {
      setPendingVoiceSendDraft(undefined);
      return;
    }
    const sourceRoom = mx.getRoom(pendingVoiceSendDraft.context.roomId);
    if (!sourceRoom || sourceRoom.getMyMembership() !== Membership.Join) {
      setPendingVoiceSendDraft(undefined);
    }
  }, [draftBelongsToCurrentSession, mx, pendingVoiceSendDraft, setPendingVoiceSendDraft]);

  // Provide the recording room at start and the latest relation again when Send is claimed.
  // The hook preserves the recording room, refreshes only a same-room thread/reply relation,
  // and persists that effective send context so failure retries keep the attempted destination.
  // The session id prevents a parked draft from leaking audio across account switches.
  const getVoiceSendContext = useCallback(
    (): MindroomVoiceSendContext =>
      getMindroomRoomInputVoiceSendContext({
        ownerSessionId: mx.getUserId() ?? '',
        ...getContext(),
      }),
    [mx, getContext]
  );

  // The draft controller behind the hook owns pendingVoiceSendDraftAtom.
  // It writes the draft on failure and clears it on successful send or explicit
  // discard. onClose must NOT clear the draft, or any future caller (a
  // backdrop/Escape dismissal, a click-outside, etc.) would silently lose
  // the parked recording the rest of this PR exists to preserve.
  const handleCloseVoiceRecorder = useCallback(() => {
    setVoiceRecorderOpen(false);
  }, []);

  const claimVoiceAutoSend = useCallback(() => {
    if (store.get(voiceAutoSendPendingAtom)) return false;

    voiceAutoSendClaimedRef.current = true;
    store.set(voiceAutoSendPendingAtom, true);
    const bundle = pendingVoiceComposerBundleRef.current;
    if (bundle?.textContent && !bundle.composerReset) {
      bundle.composerReset = true;
      resetText();
    }
    return true;
  }, [resetText, store]);

  const releaseVoiceAutoSend = useCallback(() => {
    if (!voiceAutoSendClaimedRef.current) return;

    const bundle = pendingVoiceComposerBundleRef.current;
    if (bundle?.composerReset && !bundle.handedOff && bundle.composerFallback) {
      restoreText(bundle.roomId, bundle.composerFallback, bundle.composerThreadId);
    }
    bundle?.releasePasteProtection();
    pendingVoiceComposerBundleRef.current = undefined;
    voiceAutoSendInFlightRef.current = false;
    voiceAutoSendClaimedRef.current = false;
    store.set(voiceAutoSendPendingAtom, false);
  }, [restoreText, store]);

  const handleVoiceSend = useCallback(
    async (
      file: File,
      duration: number,
      waveform: number[] | undefined,
      context: MindroomVoiceSendContext
    ) => {
      // Wrap the ENTIRE body in try/finally. The voice auto-send slot is
      // claimed by claimVoiceAutoSend() in onSendStopRequest BEFORE this
      // function is invoked, so any early throw here (live-room refresh
      // failure, "another send pending" guard) MUST still release the
      // slot — otherwise voiceAutoSendPendingAtom stays true forever and
      // text submit + voice recording are globally locked until reload.
      // releaseVoiceAutoSend() short-circuits when no claim is held, so
      // calling it unconditionally is safe even on the un-claimed path.
      let fileItems: TUploadItem[] = [];
      let liveContext: MindroomVoiceSendContext | null = null;
      let sentEventIdToNotify: string | undefined;
      let voiceSent = false;
      const logAndThrowUploadError = (err: unknown, stage: MatrixUploadErrorStage): never => {
        const originalName =
          getMatrixUploadOriginalName(err) ?? (err instanceof Error ? err.name : typeof err);
        const error = toMatrixUploadError(err, stage);
        // eslint-disable-next-line no-console
        console.error('[mr-upload]', {
          stage,
          originalName,
          name: error.name,
          errcode: error.errcode,
          httpStatus: error.httpStatus,
          message: error.message,
        });
        throw error;
      };

      try {
        // Re-resolve the live Room from the matrix client at send/retry
        // time. context.room is a snapshot from start(); it may be stale
        // by retry time (encryption upgrade, membership change,
        // signal-bridge member added/removed). Using the live room also
        // closes a plaintext-leak window: a room that gained encryption
        // between original failure and retry would otherwise be sent
        // unencrypted because context.room.hasEncryptionStateEvent()
        // returns the cached value.
        const pendingComposerBundle = pendingVoiceComposerBundleRef.current;
        const composerBundle =
          pendingComposerBundle?.roomId === context.roomId ? pendingComposerBundle : undefined;
        const sendContext = composerBundle?.relationContext
          ? { ...context, ...composerBundle.relationContext }
          : context;
        liveContext = refreshMindroomRoomInputVoiceSendContext(mx, sendContext);
        if (!liveContext) {
          throw new Error(t('composer.voiceRoomUnavailable'));
        }

        if (
          store.get(voiceAutoSendPendingAtom) &&
          (!voiceAutoSendClaimedRef.current || voiceAutoSendInFlightRef.current)
        ) {
          throw new Error(t('composer.voiceStillSending'));
        }
        if (!voiceAutoSendClaimedRef.current) {
          voiceAutoSendClaimedRef.current = true;
          store.set(voiceAutoSendPendingAtom, true);
        }
        voiceAutoSendInFlightRef.current = true;

        try {
          fileItems = await createVoiceUploadItems(file, duration, waveform, liveContext.room);
        } catch (err) {
          return logAndThrowUploadError(err, 'create');
        }
        const [fileItem] = fileItems;
        if (fileItems.length !== 1 || !fileItem) {
          return logAndThrowUploadError(
            new Error(`Voice message preparation returned ${fileItems.length} upload items.`),
            'create'
          );
        }
        const ownerRoomId = liveContext.roomId;
        const liveRoomEncrypted = liveContext.room.hasEncryptionStateEvent();
        const getEligibleCompanionItems = (): TUploadItem[] => {
          const liveFiles = new Set(
            attachmentAccess.snapshot(ownerRoomId).staged.map((item) => item.file)
          );
          return (composerBundle?.companionItems ?? []).filter(
            (item) =>
              liveFiles.has(item.file) &&
              !item.prepError &&
              Boolean(item.encInfo) === liveRoomEncrypted &&
              store.get(roomUploadAtomFamily(item.file)).status !== UploadStatus.Error &&
              item.file.size < allowUploadSize
          );
        };
        let eligibleCompanionItems = getEligibleCompanionItems();
        if (
          composerBundle &&
          (composerBundle.textContent || eligibleCompanionItems.length > 0) &&
          hasActiveSendSession()
        ) {
          // Give a previously failed attachment session one chance to finish after its
          // upload cards were retried or removed before parking this new voice bundle.
          await startSendSession();
          eligibleCompanionItems = getEligibleCompanionItems();
        }
        const activeSendSession = hasActiveSendSession();
        if (
          composerBundle &&
          (composerBundle.textContent || eligibleCompanionItems.length > 0) &&
          activeSendSession
        ) {
          throw new Error(t('composer.voiceBundleBlocked'));
        }
        const shouldCombineWithCompanions =
          composerBundle !== undefined &&
          !activeSendSession &&
          fileItem.file.size < allowUploadSize &&
          (eligibleCompanionItems.length > 0 || Boolean(composerBundle.textContent));

        if (shouldCombineWithCompanions) {
          const companionUploadResultsPromise = Promise.allSettled(
            eligibleCompanionItems.map((item) => uploadItemWhileStaged(ownerRoomId, item))
          );
          try {
            await uploadItem(fileItem);
          } catch (err) {
            return logAndThrowUploadError(err, 'upload');
          }
          const companionUploadResults = await companionUploadResultsPromise;

          const liveItems = attachmentAccess.snapshot(ownerRoomId).staged;
          const liveFiles = new Set(liveItems.map((item) => item.file));
          const readyItems = [
            ...companionUploadResults
              .map((result) => (result.status === 'fulfilled' ? result.value : undefined))
              .filter(
                (item): item is TUploadItem => item !== undefined && liveFiles.has(item.file)
              ),
            fileItem,
          ];
          try {
            if (composerBundle) {
              composerBundle.handedOff = true;
            }
            await startSendSession({
              textContent: composerBundle?.textContent,
              batch: {
                fileItems: readyItems,
                uploads: readyItems.map((item) => store.get(roomUploadAtomFamily(item.file))),
              },
              context: liveContext,
              completeWithinCall: true,
              composerFallback: composerBundle?.composerFallback,
              composerContext: composerBundle
                ? { roomId: composerBundle.roomId, threadId: composerBundle.composerThreadId }
                : undefined,
              composerAlreadyReset: composerBundle?.composerReset,
              onUploadSent: (sentFile) => {
                if (sentFile === fileItem.file) {
                  voiceSent = true;
                }
              },
            });
            return;
          } catch (err) {
            if (voiceSent) {
              // Uploads and voice already reached Matrix; lifecycle-complete sending restores
              // the failed trailing text. Treat voice as consumed so recorder retry cannot
              // duplicate an event that the homeserver accepted.
              return;
            }
            return logAndThrowUploadError(err, 'send');
          }
        }

        attachmentAccess.append(liveContext.roomId, fileItems);
        let mxc: string;
        try {
          mxc = await uploadItem(fileItem);
        } catch (err) {
          return logAndThrowUploadError(err, 'upload');
        }
        try {
          sentEventIdToNotify = await sendVoiceItem(liveContext, fileItem, mxc);
        } catch (err) {
          return logAndThrowUploadError(err, 'send');
        }
        clearConsumedReply(liveContext);
      } finally {
        if (liveContext && fileItems.length > 0) {
          attachmentAccess.remove(
            liveContext.roomId,
            fileItems.map((fileItem) => fileItem.file)
          );
        }
        releaseVoiceAutoSend();
      }
      if (sentEventIdToNotify) {
        onRoomMessageSent?.(sentEventIdToNotify);
      }
    },
    [
      attachmentAccess,
      allowUploadSize,
      clearConsumedReply,
      createVoiceUploadItems,
      hasActiveSendSession,
      mx,
      releaseVoiceAutoSend,
      sendVoiceItem,
      store,
      startSendSession,
      t,
      uploadItem,
      uploadItemWhileStaged,
      onRoomMessageSent,
    ]
  );

  const blocksSubmit = useCallback(() => store.get(voiceAutoSendPendingAtom), [store]);
  const submitIfActive = useCallback(
    async (content?: IContent): Promise<boolean> => {
      if (!voiceRecorderOpen && !ownsPendingVoiceDraft) return false;
      if (hasFailedPasteMarkerInText(content, attachmentAccess.snapshot().staged)) return true;

      const recorder = voiceRecorderRef.current;
      if (!recorder) return true;

      const context = getContext();
      const companionItems = attachmentAccess.snapshot().staged;
      pendingVoiceComposerBundleRef.current = {
        roomId,
        composerThreadId: context.threadId,
        // A live recording follows the reply/thread visible when primary Send is pressed.
        // A parked retry keeps the durable context captured with the failed recording.
        relationContext: ownsPendingVoiceDraft
          ? undefined
          : {
              threadId: context.threadId,
              replyDraft: context.replyDraft,
              threadingEnabled: context.threadingEnabled,
            },
        textContent: content,
        composerFallback: content ? snapshotText() : undefined,
        companionItems,
        releasePasteProtection: attachmentAccess.protectPasteItems(companionItems),
        composerReset: false,
        handedOff: false,
      };
      try {
        await recorder.send();
      } finally {
        // A request rejected before onSendStopRequest never owns editor state.
        // Drop only that untouched snapshot; claimed requests clear through
        // releaseVoiceAutoSend after send, failure, or retry settlement.
        if (!voiceAutoSendClaimedRef.current) {
          pendingVoiceComposerBundleRef.current?.releasePasteProtection();
          pendingVoiceComposerBundleRef.current = undefined;
        }
      }

      return true;
    },
    [attachmentAccess, getContext, ownsPendingVoiceDraft, roomId, snapshotText, voiceRecorderOpen]
  );

  const renderRecorder = (onRetryRequest: () => void): React.ReactNode =>
    voiceRecorderOpen || ownsPendingVoiceDraft ? (
      <MindroomVoiceRecorderComposer
        ref={voiceRecorderRef}
        active={voiceRecorderOpen}
        sendDisabled={voiceAutoSendPending}
        onClose={handleCloseVoiceRecorder}
        onSendStopRequest={claimVoiceAutoSend}
        onSendStopFailure={releaseVoiceAutoSend}
        onRetryRequest={onRetryRequest}
        onSendRecording={handleVoiceSend}
        getSendContext={getVoiceSendContext}
      />
    ) : null;

  const microphoneLabel = otherPendingVoiceRoomName
    ? t('composer.voicePausedInOtherRoom', { roomName: otherPendingVoiceRoomName })
    : t('composer.recordVoice');
  const microphone = (
    // The label says why the button is disabled while another room holds a draft;
    // the tooltip shows it too where the browser reports hovering a disabled button.
    <IconTooltip label={microphoneLabel} position="Top">
      {(triggerRef) => (
        <ComposerIconButton
          ref={triggerRef}
          onClick={() => {
            if (voiceRecorderOpen || voiceAutoSendPending || otherRoomOwnsPendingVoiceDraft) return;
            pauseAllMediaElements();
            setVoiceRecorderOpen(true);
          }}
          size="300"
          radii="300"
          disabled={voiceRecorderOpen || voiceAutoSendPending || otherRoomOwnsPendingVoiceDraft}
          aria-label={microphoneLabel}
        >
          <Icon src={Icons.Mic} />
        </ComposerIconButton>
      )}
    </IconTooltip>
  );

  return { blocksSubmit, submitIfActive, microphone, renderRecorder };
};
