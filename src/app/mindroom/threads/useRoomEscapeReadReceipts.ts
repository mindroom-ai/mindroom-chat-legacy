import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { markRoomAndThreadsAsRead, markThreadAsRead } from '../notifications/readReceipts';

type UseRoomEscapeReadReceiptsOptions = {
  /** A panel covers the conversation, so its messages are not in view. */
  conversationHidden?: boolean;
  hideActivity: boolean;
  roomId: string;
  threadId?: string;
};

export const useRoomEscapeReadReceipts = ({
  conversationHidden = false,
  hideActivity,
  roomId,
  threadId,
}: UseRoomEscapeReadReceiptsOptions): void => {
  const mx = useMatrixClient();

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (conversationHidden || !isKeyHotkey('escape', evt)) return;
        if (threadId) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markRoomAndThreadsAsRead(mx, roomId, hideActivity);
      },
      [conversationHidden, hideActivity, mx, roomId, threadId]
    )
  );
};
