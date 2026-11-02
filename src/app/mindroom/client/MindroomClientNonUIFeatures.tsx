import { useAtomValue } from 'jotai';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { MatrixClient } from 'matrix-js-sdk';
import InviteSound from '../../../../public/sound/invite.ogg';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { getInboxInvitesPath } from '../../pages/pathUtils';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { notificationPermission, setFavicon } from '../../utils/dom';
import { Membership } from '../../../types/matrix/room';
import { MINDROOM_FAVICON_SRC } from '../branding/branding';
import { playChime } from '../notifications/playChime';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  registerIOSPush,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
  upsertIOSPushPusher,
} from '../native/iosPush';
import { useIOSPushEnabled } from '../native/useIOSPushEnabled';
import {
  cloudflareAccessAllowsPush,
  useCloudflareAccessSignInRequired,
} from '../native/cloudflareAccess';
import { useCrossRoomThreadIndex } from '../cross-room-threads/useCrossRoomThreadIndex';
import { useCanvasIndexRecorder } from '../canvas/canvasIndex';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { AgentConnectLinkFeature } from '../connections/AgentConnectLinks';
import { useModelControllerLifetime } from '../models/useModelPicker';
import { BugReportAutoJoinFeature } from '../bug-reports/BugReportAutoJoinFeature';
import { ServerEmojiJoinFeature } from '../server-emoji/ServerEmojiJoinFeature';
import { useBindLiveReplyFrames } from '../live/bindLiveReplyFrames';

const LogoUnreadSVG = MINDROOM_FAVICON_SRC;
const LogoHighlightSVG = MINDROOM_FAVICON_SRC;

function MindroomFaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    let notification = false;
    let highlight = false;
    roomToUnread.forEach((unread) => {
      if (unread.total > 0) {
        notification = true;
      }
      if (unread.highlight > 0) {
        highlight = true;
      }
    });

    if (notification) {
      setFavicon(highlight ? LogoHighlightSVG : LogoUnreadSVG);
    } else {
      setFavicon(MINDROOM_FAVICON_SRC);
    }
  }, [roomToUnread]);

  return null;
}

function CrossRoomThreadIndexFeature() {
  useCrossRoomThreadIndex();
  return null;
}

// Canvases and computers are separate opt-ins, and the recorder serves both: it lists canvases and
// notes where an agent showed its computer, which the header's Computer button needs.
export function CanvasIndexFeature() {
  const canvasesEnabled = useClientConfig().mindroom?.canvas?.enabled === true;
  const computersAvailable = useComputerApiUrls().urls.length > 0;
  useCanvasIndexRecorder(useMatrixClient(), canvasesEnabled || computersAvailable);
  return null;
}

const createKnownInviteRoomIdSet = (mx: MatrixClient): Set<string> => {
  const roomIds = new Set<string>();
  mx.getRooms().forEach((room) => {
    if (room.getMyMembership() === Membership.Invite) {
      roomIds.add(room.roomId);
    }
  });
  return roomIds;
};

type InviteObservationState = {
  mx: MatrixClient;
  knownRoomIds: Set<string>;
  currentRoomIds: Set<string>;
  suppressedRoomIds: Set<string>;
  lastInvites: string[];
};

export function MindroomInviteNotifications() {
  const invites = useAtomValue(allInvitesAtom);
  const mx = useMatrixClient();
  const inviteObservationStateRef = useRef<InviteObservationState>();
  if (!inviteObservationStateRef.current || inviteObservationStateRef.current.mx !== mx) {
    const knownRoomIds = createKnownInviteRoomIdSet(mx);
    inviteObservationStateRef.current = {
      mx,
      knownRoomIds,
      currentRoomIds: new Set(invites),
      suppressedRoomIds: new Set(invites.filter((roomId) => !knownRoomIds.has(roomId))),
      lastInvites: invites,
    };
  }

  const navigate = useNavigate();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const notify = useCallback(
    (count: number) => {
      const noti = new window.Notification('Invitation', {
        icon: MINDROOM_FAVICON_SRC,
        badge: MINDROOM_FAVICON_SRC,
        body: `You have ${count} new invitation request.`,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) navigate(getInboxInvitesPath());
        noti.close();
      };
    },
    [navigate]
  );

  useEffect(() => {
    const observationState = inviteObservationStateRef.current;
    if (!observationState) return;

    const currentRoomIds = new Set(invites);
    const inviteAtomEmitted = observationState.lastInvites !== invites;
    const enteredInviteRoomIds = invites.filter(
      (roomId) =>
        !observationState.knownRoomIds.has(roomId) && !observationState.currentRoomIds.has(roomId)
    );
    const reemittedSuppressedRoomId =
      enteredInviteRoomIds.length === 0 && inviteAtomEmitted
        ? [...invites]
            .reverse()
            .find(
              (roomId) =>
                !observationState.knownRoomIds.has(roomId) &&
                observationState.currentRoomIds.has(roomId) &&
                observationState.suppressedRoomIds.has(roomId)
            )
        : undefined;
    const newInviteRoomIds = reemittedSuppressedRoomId
      ? [reemittedSuppressedRoomId]
      : enteredInviteRoomIds;

    observationState.currentRoomIds.forEach((roomId) => {
      if (!currentRoomIds.has(roomId)) {
        observationState.knownRoomIds.delete(roomId);
        observationState.suppressedRoomIds.delete(roomId);
      }
    });
    newInviteRoomIds.forEach((roomId) => {
      observationState.knownRoomIds.add(roomId);
      observationState.suppressedRoomIds.delete(roomId);
    });
    observationState.currentRoomIds = currentRoomIds;
    observationState.lastInvites = invites;

    if (newInviteRoomIds.length > 0 && mx.getSyncState() === 'SYNCING') {
      if (showNotifications && notificationPermission('granted')) {
        notify(newInviteRoomIds.length);
      }

      if (notificationSound) {
        playChime(InviteSound).catch(() => undefined);
      }
    }
  }, [mx, invites, showNotifications, notificationSound, notify]);

  return null;
}

export function MindroomNativeIOSPushFeature() {
  const mx = useMatrixClient();
  const language = useAppLanguageCode();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const sessionId = activeSession?.sessionId;
  const nativePushNotifications = useIOSPushEnabled(sessionId);
  const accessSignInRequired = useCloudflareAccessSignInRequired(mx.getHomeserverUrl());
  const pushAllowed = cloudflareAccessAllowsPush(mx.getHomeserverUrl());

  useEffect(() => {
    const pushConfig = resolveIOSPushConfig(clientConfig, sessionId, language);
    // Pusher requests to a server behind Cloudflare Access fail until its sign-in is
    // renewed, and a failure would turn push off; this runs again after the sign-in.
    if (
      !isNativeIOSPlatform() ||
      !pushConfig ||
      (accessSignInRequired && nativePushNotifications)
    ) {
      return undefined;
    }

    let disposed = false;
    let registrationHandle: PluginListenerHandle | undefined;
    let registrationErrorHandle: PluginListenerHandle | undefined;

    const setupNativePush = async () => {
      if (!pushAllowed) {
        // Only this account's pusher goes: APNs stays on for the device's other accounts,
        // and no registration listener can set a pusher again. A failed removal is
        // retried on the next run and leaves the user's own setting alone.
        await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
        return;
      }

      const registrationListener = await PushNotifications.addListener('registration', (token) => {
        // A token can arrive after logout has stopped the client.
        if (disposed || !mx.clientRunning) return;
        upsertIOSPushPusher(mx, pushConfig, token.value, sessionId).catch(async () => {
          // Expired Access also ends this effect; its next run registers again.
          if (disposed) return;
          setIOSPushEnabled(false, sessionId);
          await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
          await unregisterIOSPush().catch(() => undefined);
        });
      });
      if (disposed) {
        registrationListener.remove().catch(() => undefined);
        return;
      }
      registrationHandle = registrationListener;

      const registrationErrorListener = await PushNotifications.addListener(
        'registrationError',
        () => {
          setIOSPushEnabled(false, sessionId);
          disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
          unregisterIOSPush().catch(() => undefined);
        }
      );
      if (disposed) {
        registrationErrorListener.remove().catch(() => undefined);
        return;
      }
      registrationErrorHandle = registrationErrorListener;

      if (!nativePushNotifications) {
        await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush().catch(() => undefined);
        return;
      }

      const permission = await checkIOSPushPermission();
      if (permission !== 'granted') {
        setIOSPushEnabled(false, sessionId);
        await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush().catch(() => undefined);
        return;
      }

      await registerIOSPush();
    };

    setupNativePush().catch(async () => {
      if (disposed) return;
      setIOSPushEnabled(false, sessionId);
      await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
      await unregisterIOSPush().catch(() => undefined);
    });

    return () => {
      disposed = true;
      registrationHandle?.remove().catch(() => undefined);
      registrationErrorHandle?.remove().catch(() => undefined);
    };
  }, [
    accessSignInRequired,
    clientConfig,
    language,
    mx,
    nativePushNotifications,
    pushAllowed,
    sessionId,
  ]);

  return null;
}

type IOSPushOpenTarget = { roomId: string; eventId?: string };

// Sygnal puts the notified event's room_id and event_id at the top of the APNs payload.
const getIOSPushOpenTarget = (data: unknown): IOSPushOpenTarget | undefined => {
  if (typeof data !== 'object' || data === null) return undefined;
  const { room_id: roomId, event_id: eventId } = data as Record<string, unknown>;
  if (typeof roomId !== 'string' || roomId.length === 0) return undefined;
  return { roomId, eventId: typeof eventId === 'string' && eventId ? eventId : undefined };
};

// A tapped push opens its event; the room route moves an event in a thread into that thread.
export function MindroomNativeIOSPushOpenFeature() {
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const [target, setTarget] = useState<IOSPushOpenTarget>();

  useEffect(() => {
    if (!isNativeIOSPlatform()) return undefined;

    let disposed = false;
    let actionHandle: PluginListenerHandle | undefined;
    // The plugin keeps a tap that launched the app until this listener is added.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const nextTarget = getIOSPushOpenTarget(action.notification.data);
      if (nextTarget) setTarget(nextTarget);
    })
      .then((listener) => {
        if (disposed) {
          listener.remove().catch(() => undefined);
          return;
        }
        actionHandle = listener;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      actionHandle?.remove().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    // Rooms are all known only after the first sync. A room this account has not joined
    // belongs to another account's push, or was left, so the app stays where it is.
    if (!target || !hasCompletedInitialSync) return;
    setTarget(undefined);
    if (mx.getRoom(target.roomId)?.getMyMembership() === Membership.Join) {
      navigateRoom(target.roomId, target.eventId);
    }
  }, [hasCompletedInitialSync, mx, navigateRoom, target]);

  return null;
}

export function MindroomClientNonUIFeatures() {
  useModelControllerLifetime();
  useBindLiveReplyFrames(useMatrixClient());
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <CanvasIndexFeature />
      <MindroomFaviconUpdater />
      <MindroomInviteNotifications />
      <MindroomNativeIOSPushFeature />
      <MindroomNativeIOSPushOpenFeature />
      <BugReportAutoJoinFeature />
      <ServerEmojiJoinFeature />
      <AgentConnectLinkFeature />
    </>
  );
}
