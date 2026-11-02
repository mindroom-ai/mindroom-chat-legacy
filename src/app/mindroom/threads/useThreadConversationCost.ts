import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  summarizeThreadConversationCost,
  type ThreadConversationCost,
} from './threadConversationCost';
import type { ThreadSummaryHistory } from './threadSummaryTimeline';

const Context = createContext<ThreadConversationCost | undefined>(undefined);

export const ThreadConversationCostProvider = Context.Provider;

/** Reply costs of the open thread, for Reply details; undefined outside a thread or when nothing is priced. */
export const useThreadConversationCost = () => useContext(Context);

type SummaryOptions = {
  history: ThreadSummaryHistory;
  /** The content an event's row shows, after its latest edit; keep it stable. */
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  ignoredUserIds: ReadonlySet<string>;
  viewerId?: string;
};

export const useThreadConversationCostSummary = (
  events: readonly MatrixEvent[] | undefined,
  { history, getContent, ignoredUserIds, viewerId }: SummaryOptions
): ThreadConversationCost | undefined => {
  // An agent reply or its edit can decrypt after it arrives, so the sums are taken again then.
  const [decryptions, countDecryption] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const encrypted = (events ?? []).filter((event) => event.isEncrypted());
    const decrypted = (event: MatrixEvent) => {
      if (isMindroomAgentUserIdForViewer(event.getSender(), viewerId)) countDecryption();
    };
    encrypted.forEach((event) => event.on(MatrixEventEvent.Decrypted, decrypted));
    return () => {
      encrypted.forEach((event) => event.off(MatrixEventEvent.Decrypted, decrypted));
    };
  }, [events, viewerId]);

  const { sdkLoaded, canPaginateBack, hasMoreCachedBack } = history;
  return useMemo(() => {
    // Sums again once an agent reply is readable.
    void decryptions;
    if (!events) return undefined;
    return summarizeThreadConversationCost(events, {
      history: { sdkLoaded, canPaginateBack, hasMoreCachedBack },
      getContent,
      ignoredUserIds,
      isTrustedSender: (userId) => isMindroomAgentUserIdForViewer(userId, viewerId),
    });
  }, [
    events,
    sdkLoaded,
    canPaginateBack,
    hasMoreCachedBack,
    getContent,
    ignoredUserIds,
    viewerId,
    decryptions,
  ]);
};
