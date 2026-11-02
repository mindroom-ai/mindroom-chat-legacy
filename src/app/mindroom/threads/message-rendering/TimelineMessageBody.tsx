import React, { type ComponentProps } from 'react';
import { MsgType, type Room } from 'matrix-js-sdk';
import { Text, config } from 'folds';
import { getEventAttachmentOwner } from '../../messages/eventAttachments';
import {
  ImageContent,
  MSticker,
  MessageNotDecryptedContent,
  MessageUnsupportedContent,
  RedactedContent,
} from '../../../components/message';
import { Image } from '../../../components/media';
import { ImageViewer } from '../../../components/image-viewer';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { EncryptedContent } from '../../../features/room/message/EncryptedContent';
import { getEditedEvent, getLatestMessageContent, getMemberDisplayName } from '../../../utils/room';
import { getMxIdLocalPart } from '../../../utils/matrix';
import { MessageEvent, type GetContentCallback } from '../../../../types/matrix/room';
import { isFailedLocalEchoEvent, isPendingLocalEchoEvent } from '../../messages/pendingLocalEcho';
import { FailedSendActions } from '../../messages/FailedSendActions';
import { ApprovalHistory } from '../../messages/ThreadApprovalControls';
import { MindroomThreadSummaryMarker } from '../../messages/MindroomThreadSummaryMarker';
import { getMindroomThreadSummaryInfo } from '../../messages/threadSummary';
import { isMindroomAgentUserId } from '../../matrix/agentIdentity';
import { CollapsibleMessage } from '../CollapsibleMessage';
import {
  getCollapsibleMessageMeasurementKey,
  shouldForceCollapsibleMessageOverflow,
} from '../threadCollapsibleMessages';
import { getMindroomRoomTimelineApprovalContentIfSupported } from '../roomTimelineMessageExtensions';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';
import type { TimelineMessageData, TimelineMessageKind, TimelineMessageRow } from './types';
import type { useTimelineMessageExpansion } from './useTimelineMessageExpansion';

export type TimelineMessageBodyPolicy = Pick<
  ComponentProps<typeof RenderMessageContent>,
  'mediaAutoLoad' | 'urlPreview' | 'htmlReactParserOptions' | 'linkifyOpts' | 'outlineAttachment'
> & {
  room: Room;
  threadId?: string;
  getExpansion: ReturnType<typeof useTimelineMessageExpansion>['getExpansion'];
};

type TimelineMessageBodyProps = {
  row: TimelineMessageRow;
  kind: TimelineMessageKind;
  policy: TimelineMessageBodyPolicy;
  approvalTimeline: TimelineMessageData['approvalTimeline'];
  threadSummaryTimeline: TimelineMessageData['threadSummaryTimeline'];
  messageContent?: ReturnType<typeof resolveTimelineMessageContent>;
};

// Resolve edits on every timeline render; Matrix events are mutable.
export const resolveTimelineMessageContent = (
  row: TimelineMessageRow,
  kind: TimelineMessageKind
) => {
  const editedEvent = getEditedEvent(row.eventId, row.event, row.timelineSet);
  const resolvedContent =
    kind === 'approval'
      ? getMindroomRoomTimelineApprovalContentIfSupported(row.event, editedEvent) ??
        row.event.getContent()
      : getLatestMessageContent(row.event, editedEvent);
  return { editedEvent, resolvedContent };
};

export function TimelineMessageBody({
  row,
  kind,
  policy,
  approvalTimeline,
  threadSummaryTimeline,
  messageContent,
}: TimelineMessageBodyProps) {
  const { event, eventId } = row;
  const { room, threadId, getExpansion, ...contentPolicy } = policy;
  const renderSticker = () => (
    <MSticker
      content={event.getContent()}
      renderImageContent={(props) => (
        <ImageContent
          owner={getEventAttachmentOwner(event)}
          {...props}
          autoPlay={policy.mediaAutoLoad}
          renderImage={(p) => <Image {...p} loading="lazy" />}
          renderViewer={(p) => <ImageViewer {...p} />}
        />
      )}
    />
  );
  const renderContent = (encrypted: boolean) => {
    if (event.isRedacted())
      return (
        <RedactedContent
          reason={encrypted ? undefined : event.getUnsigned().redacted_because?.content.reason}
        />
      );
    if (kind === 'sticker' || (encrypted && event.getType() === MessageEvent.Sticker))
      return renderSticker();

    // Decryption can rerender this callback without rerendering the owning timeline.
    const { editedEvent, resolvedContent } = encrypted
      ? resolveTimelineMessageContent(row, kind)
      : messageContent ?? {};
    const approvalContent = getMindroomRoomTimelineApprovalContentIfSupported(event, editedEvent);
    const isApproval = kind === 'approval' || !!approvalContent;
    const content = (isApproval ? approvalContent ?? resolvedContent : resolvedContent) ?? {};
    const senderId = event.getSender() ?? '';
    const common = {
      ...contentPolicy,
      mEvent: event,
      displayName: getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId,
      eventType: event.getType(),
      ts: event.getTs(),
      edited: !!editedEvent,
      pendingSend: isPendingLocalEchoEvent(event) || isPendingLocalEchoEvent(editedEvent),
      failedSend: isFailedLocalEchoEvent(event) || isFailedLocalEchoEvent(editedEvent),
      getContent: (() => content) as GetContentCallback,
    };
    if (isApproval) {
      if (approvalTimeline.fallbackGroupsByEventId.has(eventId))
        return encrypted ? null : (
          <ApprovalHistory records={approvalTimeline.fallbackGroupsByEventId.get(eventId) ?? []} />
        );
      return (
        <RenderMessageContent
          {...common}
          roomId={room.roomId}
          eventId={eventId}
          threadId={event.threadRootId ?? threadId}
          msgType={typeof content.msgtype === 'string' ? content.msgtype : ''}
        />
      );
    }
    if (!encrypted || event.getType() === MessageEvent.RoomMessage) {
      const msgType = event.getContent().msgtype;
      // The open thread's banner shows its summary, so the summary event itself stays small.
      const summaryInfo = threadId ? getMindroomThreadSummaryInfo(content) : undefined;
      if (summaryInfo?.summaryText)
        return (
          <MindroomThreadSummaryMarker
            summaryInfo={summaryInfo}
            plan={threadSummaryTimeline.markersByEventId.get(eventId)}
          />
        );
      const expansion = getExpansion(eventId, content, isMindroomAgentUserId(senderId));
      const renderMessage = (loadFullContent = true) => (
        <LiveReplyMessageContent
          {...common}
          eventId={eventId}
          msgType={msgType ?? ''}
          showMessageExtras
          hydrateLongText={loadFullContent}
        />
      );
      if (msgType === MsgType.Image || msgType === MsgType.Video) return renderMessage();
      return (
        <CollapsibleMessage
          {...expansion}
          expansionKey={eventId}
          forceOverflowing={shouldForceCollapsibleMessageOverflow(content)}
          measurementKey={getCollapsibleMessageMeasurementKey(
            event,
            expansion.collapseMode,
            editedEvent
          )}
        >
          {({ loadFullContent }) => renderMessage(loadFullContent)}
        </CollapsibleMessage>
      );
    }
    return (
      <Text>
        {event.getType() === MessageEvent.RoomMessageEncrypted ? (
          <MessageNotDecryptedContent />
        ) : (
          <MessageUnsupportedContent />
        )}
      </Text>
    );
  };
  const failedEvent = [event, messageContent?.editedEvent].find(isFailedLocalEchoEvent);
  // The footer of a thread opened on its failed root offers these actions instead.
  const footerOwnsFailedEvent = failedEvent === event && eventId === threadId;
  return (
    <>
      {kind === 'encrypted' ? (
        <EncryptedContent mEvent={event}>{() => renderContent(true)}</EncryptedContent>
      ) : (
        renderContent(false)
      )}
      {failedEvent && !footerOwnsFailedEvent && (
        <FailedSendActions
          room={room}
          event={failedEvent}
          style={{ marginTop: config.space.S100 }}
        />
      )}
      {(kind === 'message' || kind === 'encrypted') && (
        <ApprovalHistory
          records={
            approvalTimeline.historyByResponseId.get(eventId) ??
            (kind === 'encrypted'
              ? approvalTimeline.fallbackGroupsByEventId.get(eventId)
              : undefined) ??
            []
          }
        />
      )}
    </>
  );
}
