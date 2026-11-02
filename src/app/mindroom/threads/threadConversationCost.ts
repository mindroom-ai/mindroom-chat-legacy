import type { MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../../utils/room';
import { getMindroomAiRunInfo } from '../messages/aiRun';
import type { ThreadSummaryHistory } from './threadSummaryTimeline';

type ConversationCostTotal = {
  usd: number;
  /** Replies that carried a cost. */
  replyCount: number;
};

export type ThreadConversationCost = {
  /** Whether the thread's first event is loaded, so no older reply is missing from the sums. */
  complete: boolean;
  /** The conversation's cost through each priced reply. */
  byEventId: ReadonlyMap<string, ConversationCostTotal>;
  /** Each priced reply's own cost, in thread order. */
  replies: readonly { eventId: string; usd: number }[];
};

type SummarizeOptions = {
  history: ThreadSummaryHistory;
  /** Senders whose cost metadata counts; anyone else can write the same keys. */
  isTrustedSender: (userId: string) => boolean;
  /** The content an event's row shows, after its latest edit. */
  getContent?: (event: MatrixEvent) => Record<string, unknown>;
  ignoredUserIds?: ReadonlySet<string>;
};

// The backend rounds each cost to micro-dollars, so integer sums are exact.
const MICROS_PER_USD = 1_000_000;

export const summarizeThreadConversationCost = (
  events: readonly MatrixEvent[],
  {
    history,
    isTrustedSender,
    getContent = (event) => event.getContent(),
    ignoredUserIds,
  }: SummarizeOptions
): ThreadConversationCost | undefined => {
  const byEventId = new Map<string, ConversationCostTotal>();
  const replies: { eventId: string; usd: number }[] = [];
  let micros = 0;
  let replyCount = 0;
  events.forEach((event) => {
    const eventId = event.getId();
    const sender = event.getSender() ?? '';
    // Edits and reactions carry no cost of their own; a reply's latest edit is read through it.
    if (!eventId || reactionOrEditEvent(event) || event.isRedacted()) return;
    if (!isTrustedSender(sender) || ignoredUserIds?.has(sender)) return;
    const costUsd = getMindroomAiRunInfo(getContent(event))?.costUsd;
    if (costUsd === undefined) return;
    const replyMicros = Math.round(costUsd * MICROS_PER_USD);
    micros += replyMicros;
    replyCount += 1;
    replies.push({ eventId, usd: replyMicros / MICROS_PER_USD });
    byEventId.set(eventId, { usd: micros / MICROS_PER_USD, replyCount });
  });
  if (replyCount === 0) return undefined;
  return {
    complete: history.sdkLoaded && !history.canPaginateBack && !history.hasMoreCachedBack,
    byEventId,
    replies,
  };
};
