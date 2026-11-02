import React, { type ComponentProps, type ReactNode } from 'react';
import { MsgType, type MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, Icons } from 'folds';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { getEventAttachmentOwner } from './eventAttachments';
import { BrokenContent, MEmote, MNotice, MText, RenderBody } from '../../components/message';
import { trimReplyFromBody } from '../../utils/room';
import { MindroomMessageExtras } from './MindroomMessageExtras';
import { MINDROOM_MESSAGE_EXTRAS_KEY, parseMindroomMessageExtras } from './messageExtrasData';
import { useMindroomToolTraceMarkerParserOptions } from './MindroomHtmlBlocks';
import type { MindroomToolMetadataStatus } from './toolTrace';
import { isMindroomAiRunStreaming } from './aiRun';
import {
  formatMindroomMarkdownTextBodyAsHtml,
  formatMindroomMessageTextBodyAsHtml,
} from './blocks';
import { getMindroomLongTextSource } from './longText';
import { MindroomLongTextKind, MindroomLongTextText } from './MindroomLongTextText';
import { MindroomPasteAttachmentContent } from './MindroomPasteAttachmentContent';
import { MindroomThinkingPlaceholder } from './MindroomThinkingPlaceholder';
import { withMindroomReasoning } from './MindroomReasoning';
import { LIVE_REASONING_KEY } from '../live/useLiveReplyContent';
import { MindroomTranscribingPlaceholder } from './MindroomTranscribingPlaceholder';
import { MindroomThreadSummaryCard } from './MindroomThreadSummaryCard';
import { MindroomToolApprovalCard } from './MindroomToolApprovalCard';
import { renderMindroomStreamingIndicator } from './StreamingIndicator';
import { isMindroomThinkingPlaceholderBody } from './thinkingPlaceholder';
import { isMindroomTranscribingPlaceholder } from './transcribingPlaceholder';
import { getMindroomPasteAttachmentFile } from './pasteAttachmentMarker';
import { MINDROOM_TOOL_APPROVAL_EVENT, parseToolApprovalContent } from './toolApproval';
import { getMindroomThreadSummaryInfo } from './threadSummary';
import { getMindroomMessageStateSuffixRenderer } from './messageStateSuffix';
import { ChatUiActionButton } from '../ui-actions/ChatUiActionButton';
import { CHAT_UI_ACTION_KEY, readCanvasNoticeTitle } from '../ui-actions/chatUiProtocol';
import { CANVAS_RESPONSE_KEY, readCanvasResponse } from '../canvas/canvasMessages';
import { CanvasResponseReceipt } from '../canvas/CanvasResponseReceipt';
import { CanvasResponseSidecarReceipt } from '../canvas/CanvasResponseSidecarReceipt';

export type RenderMindroomMessageContentOptions = {
  mEvent?: MatrixEvent;
  /** Whether the sender is a MindRoom account on the viewer's homeserver. */
  fromMindroomAgent?: boolean;
  displayName: string;
  eventType?: string;
  roomId?: string;
  eventId?: string;
  threadId?: string;
  msgType: string;
  edited?: boolean;
  content: Record<string, unknown>;
  pendingSend?: boolean;
  failedSend?: boolean;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
  showMessageExtras?: boolean;
  hydrateLongText?: boolean;
};

type MindroomMessageExtrasRenderNoticeProps = {
  children: React.ReactNode;
  onRendered?: () => void;
};

function MindroomMessageExtrasRenderNotice({
  children,
  onRendered,
}: MindroomMessageExtrasRenderNoticeProps) {
  React.useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  return <>{children}</>;
}

type MindroomRenderBodyProps = Omit<ComponentProps<typeof RenderBody>, 'htmlReactParserOptions'> & {
  htmlReactParserOptions: HTMLReactParserOptions;
  /** The content whose tool and paste markers the body renders. */
  markerContent: Record<string, unknown>;
  metadataStatus?: MindroomToolMetadataStatus;
};

/** A body with MindRoom's markers, parsed again only when that message changes. */
function MindroomRenderBody({
  htmlReactParserOptions,
  markerContent,
  metadataStatus,
  ...props
}: MindroomRenderBodyProps) {
  return (
    <RenderBody
      {...props}
      htmlReactParserOptions={useMindroomToolTraceMarkerParserOptions(
        htmlReactParserOptions,
        markerContent,
        metadataStatus
      )}
    />
  );
}

export const renderMindroomMessageContent = ({
  mEvent,
  fromMindroomAgent = false,
  displayName,
  eventType,
  roomId,
  eventId,
  threadId,
  msgType,
  edited,
  content,
  pendingSend,
  failedSend,
  renderUrlsPreview,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  showMessageExtras = false,
  hydrateLongText = true,
}: RenderMindroomMessageContentOptions): ReactNode | undefined => {
  const withToolRefFormattedBodyFallback = (bodyContent: Record<string, unknown>) => {
    if (typeof bodyContent.formatted_body === 'string') return bodyContent;
    if (typeof bodyContent.body !== 'string') return bodyContent;

    const formattedBody = formatMindroomMessageTextBodyAsHtml(bodyContent.body);
    if (!formattedBody) return bodyContent;

    return {
      ...bodyContent,
      format: 'org.matrix.custom.html',
      formatted_body: formattedBody,
    };
  };

  const getRenderableLongTextSource = (bodyContent: Record<string, unknown>) => {
    const source = getMindroomLongTextSource(bodyContent);
    if (!source) return undefined;

    const { previewContent } = source;
    if (
      (typeof previewContent.formatted_body === 'string' &&
        previewContent.formatted_body.length > 0) ||
      typeof previewContent.body !== 'string'
    ) {
      return source;
    }

    const trimmedBody = trimReplyFromBody(previewContent.body);
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(trimmedBody);
    if (!formattedBody) return source;

    return {
      ...source,
      previewContent: {
        ...previewContent,
        format: 'org.matrix.custom.html',
        formatted_body: formattedBody,
      },
    };
  };

  const withReasoning = (bodyContent: Record<string, unknown>, body: ReactNode) =>
    withMindroomReasoning(bodyContent, body, htmlReactParserOptions, linkifyOpts);

  const renderBody =
    (bodyContent: Record<string, unknown>) => (props: { body: string; customBody?: string }) => {
      const { body, customBody: providedCustomBody } = props;
      const renderableContent =
        providedCustomBody === undefined
          ? withToolRefFormattedBodyFallback({ ...bodyContent, body })
          : bodyContent;
      const customBody =
        providedCustomBody ??
        (typeof renderableContent.formatted_body === 'string'
          ? renderableContent.formatted_body
          : undefined);

      return withReasoning(
        renderableContent,
        <MindroomRenderBody
          {...props}
          customBody={customBody}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={htmlReactParserOptions}
          markerContent={renderableContent}
          linkifyOpts={linkifyOpts}
        />
      );
    };

  const renderLongTextBody: ComponentProps<typeof MindroomLongTextText>['renderBody'] = (
    resolvedContent,
    props,
    metadataStatus
  ) =>
    withReasoning(
      // The live reasoning rides on the outer content, not on the preview or the sidecar.
      content[LIVE_REASONING_KEY] === undefined
        ? resolvedContent
        : { ...resolvedContent, [LIVE_REASONING_KEY]: content[LIVE_REASONING_KEY] },
      <MindroomRenderBody
        {...props}
        highlightRegex={highlightRegex}
        htmlReactParserOptions={htmlReactParserOptions}
        markerContent={resolvedContent}
        metadataStatus={metadataStatus}
        linkifyOpts={linkifyOpts}
      />
    );

  const renderMessageExtras = (
    extrasContent: Record<string, unknown>,
    fallbackContents: Record<string, unknown>[] = [],
    onFallbackExtrasRendered?: (fallbackIndex: number) => void
  ) => {
    if (!showMessageExtras) return undefined;

    const getExtrasRenderSource = () => {
      if (MINDROOM_MESSAGE_EXTRAS_KEY in extrasContent) {
        return {
          content: extrasContent,
          extras: parseMindroomMessageExtras(extrasContent),
          fallbackIndex: undefined,
        };
      }

      const fallbackIndex = fallbackContents.findIndex(
        (candidate) => MINDROOM_MESSAGE_EXTRAS_KEY in candidate
      );
      if (fallbackIndex >= 0) {
        const fallbackContent = fallbackContents[fallbackIndex];
        return {
          content: fallbackContent,
          extras: parseMindroomMessageExtras(fallbackContent),
          fallbackIndex,
        };
      }

      return { content: extrasContent, extras: null, fallbackIndex: undefined };
    };

    const { content: parserOptionsContent, extras, fallbackIndex } = getExtrasRenderSource();
    if (!extras) return undefined;

    return (
      <MindroomMessageExtrasRenderNotice
        onRendered={
          fallbackIndex === undefined ? undefined : () => onFallbackExtrasRendered?.(fallbackIndex)
        }
      >
        <MindroomMessageExtras
          extras={extras}
          htmlReactParserOptions={htmlReactParserOptions}
          markerContent={parserOptionsContent}
        />
      </MindroomMessageExtrasRenderNotice>
    );
  };

  const getMessageStateSuffix = (renderStateSuffix?: () => ReactNode) =>
    getMindroomMessageStateSuffixRenderer({
      edited,
      pendingSend,
      failedSend,
      renderStateSuffix,
    });

  const canvasReceipt = msgType === MsgType.Text ? readCanvasResponse(content) : undefined;
  if (canvasReceipt) {
    return (
      <CanvasResponseReceipt
        receipt={canvasReceipt}
        delivered={!pendingSend && !failedSend}
        renderStateSuffix={getMessageStateSuffix()}
      />
    );
  }

  const threadSummaryInfo = getMindroomThreadSummaryInfo(content);
  if (threadSummaryInfo) {
    return (
      <MindroomThreadSummaryCard
        edited={edited}
        summaryInfo={threadSummaryInfo}
        renderBody={renderBody(content)}
      />
    );
  }

  if (eventType === MINDROOM_TOOL_APPROVAL_EVENT) {
    // Only MindRoom sends approval cards; any member can post this event type.
    const approval = fromMindroomAgent ? parseToolApprovalContent(eventType, content) : null;
    return approval ? (
      <MindroomToolApprovalCard
        approval={approval}
        roomId={roomId}
        eventId={eventId}
        threadId={threadId}
      />
    ) : (
      <BrokenContent />
    );
  }

  if (msgType === MsgType.Text || msgType === MsgType.File) {
    if (msgType === MsgType.Text && isMindroomTranscribingPlaceholder(content)) {
      return (
        <MText
          content={content}
          renderStateSuffix={getMessageStateSuffix()}
          renderBody={() => <MindroomTranscribingPlaceholder />}
          renderAfterBody={renderMessageExtras(content)}
        />
      );
    }

    const isStreaming = isMindroomAiRunStreaming(content);
    if (msgType === MsgType.Text && isStreaming && isMindroomThinkingPlaceholderBody(content)) {
      return (
        <MText
          content={content}
          renderStateSuffix={getMessageStateSuffix()}
          renderBody={() =>
            withReasoning(content, <MindroomThinkingPlaceholder startedAt={mEvent?.getTs()} />)
          }
          renderAfterBody={renderMessageExtras(content)}
        />
      );
    }

    const longTextSource = getRenderableLongTextSource(content);
    if (longTextSource) {
      const longText = (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Text}
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderMindroomStreamingIndicator : undefined
          )}
          content={longTextSource.previewContent}
          longTextSource={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
          hydrate={hydrateLongText}
          renderBody={renderLongTextBody}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(extrasContent, [content, fallbackContent])
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
      // A canvas answer too large for one event arrives as a sidecar; its receipt waits for the file.
      if (msgType === MsgType.File && content[CANVAS_RESPONSE_KEY]) {
        return (
          <CanvasResponseSidecarReceipt
            source={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
            relation={content['m.relates_to']}
            hydrate={hydrateLongText}
            delivered={!pendingSend && !failedSend}
            renderStateSuffix={getMessageStateSuffix()}
            fallback={longText}
          />
        );
      }
      return longText;
    }

    if (msgType === MsgType.File) {
      const pasteAttachment = getMindroomPasteAttachmentFile(content);
      if (pasteAttachment) {
        return (
          <MindroomPasteAttachmentContent
            owner={getEventAttachmentOwner(mEvent)}
            attachment={pasteAttachment}
          />
        );
      }
    }

    if (msgType === MsgType.Text) {
      const renderableContent = withToolRefFormattedBodyFallback(content);
      return (
        <MText
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderMindroomStreamingIndicator : undefined
          )}
          content={renderableContent}
          renderBody={renderBody(renderableContent)}
          renderAfterBody={renderMessageExtras(renderableContent, [content])}
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }
  }

  if (msgType === MsgType.Emote) {
    const isStreaming = isMindroomAiRunStreaming(content);
    const longTextSource = getRenderableLongTextSource(content);
    if (longTextSource) {
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Emote}
          displayName={displayName}
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderMindroomStreamingIndicator : undefined
          )}
          content={longTextSource.previewContent}
          longTextSource={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
          hydrate={hydrateLongText}
          renderBody={renderLongTextBody}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(extrasContent, [content, fallbackContent])
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    const renderableContent = withToolRefFormattedBodyFallback(content);
    return (
      <MEmote
        displayName={displayName}
        edited={edited}
        renderStateSuffix={getMessageStateSuffix(
          isStreaming ? renderMindroomStreamingIndicator : undefined
        )}
        content={renderableContent}
        renderBody={renderBody(renderableContent)}
        renderAfterBody={renderMessageExtras(renderableContent, [content])}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  if (msgType === MsgType.Notice) {
    const uiAction = content[CHAT_UI_ACTION_KEY];
    // Canvas updates are edits of the request, so an edited canvas keeps its button.
    const editableUiAction =
      !!uiAction &&
      typeof uiAction === 'object' &&
      (uiAction as Record<string, unknown>).action === 'show_canvas';
    if (mEvent && uiAction && (!edited || editableUiAction)) {
      // The body of a canvas request tells other Matrix clients to open MindRoom Chat; Chat names the canvas.
      const canvasTitle = fromMindroomAgent ? readCanvasNoticeTitle(content) : undefined;
      return (
        <MNotice
          content={content}
          renderBody={
            canvasTitle
              ? () => (
                  <Box as="span" alignItems="Center" gap="200" data-canvas-notice-title>
                    <Icon size="100" src={Icons.Category} />
                    <span>{canvasTitle}</span>
                  </Box>
                )
              : renderBody(content)
          }
          renderAfterBody={<ChatUiActionButton event={mEvent} />}
        />
      );
    }
    const isStreaming = isMindroomAiRunStreaming(content);
    const longTextSource = getRenderableLongTextSource(content);
    if (longTextSource) {
      return (
        <MindroomLongTextText
          kind={MindroomLongTextKind.Notice}
          edited={edited}
          renderStateSuffix={getMessageStateSuffix(
            isStreaming ? renderMindroomStreamingIndicator : undefined
          )}
          content={longTextSource.previewContent}
          longTextSource={{ ...longTextSource, owner: getEventAttachmentOwner(mEvent) }}
          hydrate={hydrateLongText}
          renderBody={renderLongTextBody}
          renderAfterBody={(extrasContent, fallbackContent) =>
            renderMessageExtras(extrasContent, [content, fallbackContent])
          }
          renderUrlsPreview={renderUrlsPreview}
        />
      );
    }

    const renderableContent = withToolRefFormattedBodyFallback(content);
    return (
      <MNotice
        edited={edited}
        renderStateSuffix={getMessageStateSuffix(
          isStreaming ? renderMindroomStreamingIndicator : undefined
        )}
        content={renderableContent}
        renderBody={renderBody(renderableContent)}
        renderAfterBody={renderMessageExtras(renderableContent, [content])}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return undefined;
};
