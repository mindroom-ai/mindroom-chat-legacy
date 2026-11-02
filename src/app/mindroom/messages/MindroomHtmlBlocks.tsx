import { useTranslation } from 'react-i18next';
import React, { ReactNode, useContext, useMemo, useState } from 'react';
import { Element, HTMLReactParserOptions, Text as DOMText, domToReact } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import { Box, Icon, IconSrc, Icons, Text } from 'folds';
import {
  MINDROOM_TOOL_REF_ICON,
  MindroomToolRefParseResult,
  parseMindroomToolRefHtml,
} from './blocks';
import {
  extractTextFromChildren,
  getToolRefPrefixFromElement,
  isDomElementNode,
  isDomTextNode,
  parseToolRefIndexFromTextPrefix,
  takeLeadingToolRefs,
  trimLeadingToolRefBoundary,
} from './toolRefDom';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './messageExtrasData';
import { MindroomPasteMarker, parseMindroomPasteMarker } from './pasteAttachmentMarker';
import {
  MINDROOM_TOOL_TRACE_KEY,
  MindroomToolTraceEvent,
  MindroomToolMetadataStatus,
  getMindroomToolTraceV2Events,
  isMindroomToolTraceV2,
} from './toolTrace';
import * as css from './MindroomHtmlBlocks.css';
import * as activityCss from './ThreadActivity.css';
import { ActivityIcon, ActivityResult, ActivityTone, ThreadActivity } from './ThreadActivity';
import {
  resolveToolCallStates,
  summarizeToolCalls,
  ToolCallMessageContext,
  ToolCallState,
} from './toolCallStatus';
import { useThreadApprovals } from './ThreadApprovalProvider';
import { getEffectiveToolApprovalStatus, parseToolApprovalExpiryTimestamp } from './toolApproval';
import { ApprovalArgumentFields } from './ApprovalArgumentFields';
import { toToolArgumentFields } from './argumentFields';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';
import type { HtmlReactParserOptionsSource } from '../../utils/htmlReactParserOptions';

type MindroomTagName = 'think' | 'debug' | 'system' | 'plan' | 'analysis' | 'research';

const MINDROOM_BLOCK_META: Record<MindroomTagName, { icon: IconSrc }> = {
  think: {
    icon: Icons.Bulb,
  },
  debug: {
    icon: Icons.Code,
  },
  system: {
    icon: Icons.Server,
  },
  plan: {
    icon: Icons.OrderList,
  },
  analysis: {
    icon: Icons.Search,
  },
  research: {
    icon: Icons.Explore,
  },
};

function MindroomPasteMarkerBadge({ marker }: { marker: MindroomPasteMarker }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  return (
    <span
      className={css.PasteMarkerBadge}
      data-mindroom-paste-badge
      title={marker.raw}
      contentEditable={false}
    >
      <Icon size="50" src={Icons.File} />
      <Text as="span" size="L400" truncate>
        {t('mindroomUi.messages.mindroomHtmlBlocks.pastedText')}
      </Text>
      <span className={css.PasteMarkerBadgeMeta}>
        <Text as="span" size="T200" truncate>
          {marker.id}
        </Text>
        <Text as="span" size="T200" truncate>
          {t('mindroomUi.messages.mindroomHtmlBlocks.characterCount', {
            count: marker.chars,
            formattedCount: new Intl.NumberFormat(language).format(marker.chars),
          })}
        </Text>
        <Text as="span" size="T200" truncate>
          {marker.fileName}
        </Text>
      </span>
    </span>
  );
}

function MindroomCollapsibleBlock({
  icon,
  label,
  children,
}: {
  icon: IconSrc;
  label: string;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const glassRef = useGlassHighlight<HTMLDivElement>();

  return (
    <Text ref={glassRef} as="div" size="T300" className={css.Block}>
      <button
        type="button"
        className={css.BlockHeader}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <Box grow="Yes" className={css.BlockHeaderMeta}>
          <Icon size="50" src={icon} />
          <Text size="L400" truncate>
            {label}
          </Text>
        </Box>
        <Icon
          size="50"
          className={css.BlockChevron}
          src={expanded ? Icons.ChevronTop : Icons.ChevronBottom}
          aria-hidden
        />
      </button>
      {expanded && <Box className={css.BlockBody}>{children}</Box>}
    </Text>
  );
}

export const renderMindroomHtmlBlock = (
  name: string,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined => {
  if (!Object.prototype.hasOwnProperty.call(MINDROOM_BLOCK_META, name)) return undefined;

  const blockName = name as MindroomTagName;
  const { icon } = MINDROOM_BLOCK_META[blockName];

  return (
    <MindroomNamedBlock icon={icon} blockName={blockName}>
      {domToReact(children, opts)}
    </MindroomNamedBlock>
  );
};

function MindroomNamedBlock({
  icon,
  blockName,
  children,
}: {
  icon: IconSrc;
  blockName: MindroomTagName;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <MindroomCollapsibleBlock
      icon={icon}
      label={t(`mindroomUi.messages.mindroomHtmlBlocks.blocks.${blockName}`)}
    >
      {children}
    </MindroomCollapsibleBlock>
  );
}

type MindroomToolBlockStatus =
  | 'pending'
  | 'completed'
  | 'completed_with_result'
  | MindroomToolMetadataStatus;

type MindroomToolBlockRenderData = {
  index: number;
  status: MindroomToolBlockStatus;
  command: string;
  toolName: string;
  argsPreview?: string;
  result?: string;
  resultInline: boolean;
  progress?: string;
};

// How many of a running call's last output lines show under its tool calls.
const TOOL_OUTPUT_LINES = 6;

const asToolTraceText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined;

// Output drops leading blank lines but keeps its first line's indentation, as in YAML or a tree listing.
const asToolOutput = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value.replace(/^(?:[ \t\r]*\n)+/, '').trimEnd() || undefined
    : undefined;

const buildToolRefRenderData = (
  toolRef: MindroomToolRefParseResult,
  eventRaw?: MindroomToolTraceEvent,
  metadataStatus?: MindroomToolMetadataStatus
): MindroomToolBlockRenderData => {
  const traceType = asToolTraceText(eventRaw?.type);
  const traceToolName = asToolTraceText(eventRaw?.tool_name) ?? toolRef.toolName;
  const argsPreview = asToolTraceText(eventRaw?.args_preview);
  const resultPreview = asToolTraceText(eventRaw?.result_preview);
  const command = argsPreview ? `${traceToolName}(${argsPreview})` : traceToolName;

  if (!eventRaw && metadataStatus) {
    return {
      index: toolRef.index,
      status: metadataStatus,
      command,
      toolName: traceToolName,
      argsPreview,
      resultInline: false,
    };
  }

  if (
    traceType === 'tool_call_started' ||
    (traceType !== 'tool_call_completed' && toolRef.pending)
  ) {
    return {
      index: toolRef.index,
      status: 'pending',
      command,
      toolName: traceToolName,
      argsPreview,
      resultInline: false,
      progress: asToolOutput(eventRaw?.progress),
    };
  }

  if (resultPreview) {
    return {
      index: toolRef.index,
      status: 'completed_with_result',
      command,
      toolName: traceToolName,
      argsPreview,
      result: resultPreview,
      resultInline: !resultPreview.includes('\n'),
    };
  }

  return {
    index: toolRef.index,
    status: 'completed',
    command,
    toolName: traceToolName,
    argsPreview,
    resultInline: false,
  };
};

const TOOL_STATE_ICON: Record<ToolCallState, { src: IconSrc; tone: ActivityTone }> = {
  running: { src: Icons.Terminal, tone: 'neutral' },
  waiting: { src: Icons.Pause, tone: 'warning' },
  done: { src: Icons.Check, tone: 'success' },
  denied: { src: Icons.Cross, tone: 'critical' },
  expired: { src: Icons.Clock, tone: 'neutral' },
};

const TOOL_STATE_TITLE = {
  running: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsRunning',
  waiting: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsWaiting',
  done: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsRan',
  denied: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsDenied',
  expired: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsExpired',
} as const satisfies Record<ToolCallState, string>;

function MindroomToolRefGroupItem({
  parsedTool,
  state,
}: {
  parsedTool: MindroomToolBlockRenderData;
  state: ToolCallState;
}) {
  const { src, tone } = TOOL_STATE_ICON[state];
  return (
    <div className={activityCss.Row} data-tool-index={parsedTool.index}>
      <ActivityIcon src={src} tone={tone} pending={state === 'running'} />
      <div className={activityCss.RowBody}>
        <span className={activityCss.RowName}>{parsedTool.toolName}</span>
        {parsedTool.argsPreview && (
          <div className={activityCss.RowText}>
            <ApprovalArgumentFields value={parsedTool.argsPreview} parse={toToolArgumentFields} />
          </div>
        )}
        {parsedTool.result && <ActivityResult text={parsedTool.result} />}
      </div>
    </div>
  );
}

// Calls that needed approval take their state from the cards MindRoom posted for this reply.
const useToolCallApprovals = () => {
  const eventId = useContext(ToolCallMessageContext);
  const context = useThreadApprovals();
  if (!eventId || !context) return [];
  return context.records
    .filter(({ approval }) => approval.responseEventId === eventId)
    .map(({ approval }) => ({
      toolName: approval.toolName,
      status: getEffectiveToolApprovalStatus(
        approval.status,
        parseToolApprovalExpiryTimestamp(approval.expiresAt),
        context.now
      ),
    }));
};

function MindroomToolRefGroupBlock({
  parsedTools,
}: {
  parsedTools: MindroomToolBlockRenderData[];
}) {
  const { t } = useTranslation();
  const approvals = useToolCallApprovals();
  const loadedTools = parsedTools.filter(
    (tool) => tool.status !== 'loading' && tool.status !== 'unavailable'
  );
  const metadataStatus = parsedTools.find(
    (tool) => tool.status === 'loading' || tool.status === 'unavailable'
  )?.status;
  const states = resolveToolCallStates(
    loadedTools.map((tool) => ({ toolName: tool.toolName, pending: tool.status === 'pending' })),
    approvals
  );
  const summary = summarizeToolCalls(parsedTools, states);
  const running = loadedTools.filter((tool, index) => states[index] === 'running');
  const outputTool = running.filter((tool) => tool.progress).at(-1);
  // Without the trace details the calls' states are unknown, so only count them.
  const icon = metadataStatus
    ? { src: Icons.Terminal, tone: 'neutral' as const }
    : TOOL_STATE_ICON[summary.state];

  return (
    <ThreadActivity
      icon={
        <ActivityIcon
          src={icon.src}
          tone={icon.tone}
          pending={!metadataStatus && summary.state === 'running'}
        />
      }
      title={
        metadataStatus
          ? t('mindroomUi.messages.mindroomHtmlBlocks.usedToolCount', { count: parsedTools.length })
          : t(TOOL_STATE_TITLE[summary.state], { count: summary.count })
      }
      detail={summary.names}
      preview={
        outputTool?.progress && (
          <>
            {running.length > 1 && (
              <div className={activityCss.OutputLabel}>{outputTool.command}</div>
            )}
            <pre className={activityCss.Output}>
              {outputTool.progress.split('\n').slice(-TOOL_OUTPUT_LINES).join('\n')}
            </pre>
          </>
        )
      }
    >
      {loadedTools.map((parsedTool, index) => (
        <MindroomToolRefGroupItem
          key={`tool-group-item-${parsedTool.index}-${parsedTool.command}`}
          parsedTool={parsedTool}
          state={states[index]}
        />
      ))}
      {metadataStatus && (
        <div className={activityCss.Row}>
          <ActivityIcon src={Icons.Info} pending={metadataStatus === 'loading'} />
          <Text size="T200" role="status" className={activityCss.RowText}>
            {t(
              metadataStatus === 'loading'
                ? 'mindroomUi.messages.mindroomHtmlBlocks.loadingToolDetails'
                : 'mindroomUi.messages.mindroomHtmlBlocks.toolDetailsUnavailable'
            )}
          </Text>
        </div>
      )}
    </ThreadActivity>
  );
}

const cloneDomChildNode = (node: ChildNode): ChildNode => {
  if (isDomTextNode(node)) {
    return new DOMText(node.data);
  }

  if (isDomElementNode(node)) {
    const clonedChildren = node.children.map((child) => cloneDomChildNode(child as ChildNode));
    return new Element(node.name, { ...node.attribs }, clonedChildren);
  }

  return new DOMText('');
};

const normalizeLeadingToolRefBoundaryInPlace = (element: Element): boolean => {
  if (!['p', 'div', 'li'].includes(element.name)) return false;
  const children = element.children as ChildNode[];

  let index = 0;
  while (index < children.length) {
    const child = children[index];
    if (!isDomTextNode(child) || child.data.trim()) break;
    index += 1;
  }

  const leadingChild = children[index];
  const hasLeadingBreak =
    index < children.length && isDomElementNode(leadingChild) && leadingChild.name === 'br';
  if (!hasLeadingBreak) return false;

  const trimmedChildren = trimLeadingToolRefBoundary(children);
  element.children = trimmedChildren;
  return true;
};

const getPasteMarkerFromElement = (element: Element): MindroomPasteMarker | undefined => {
  if (element.name !== 'span' || element.attribs['data-mindroom-paste-marker'] !== 'true') {
    return undefined;
  }

  const marker = parseMindroomPasteMarker(extractTextFromChildren(element.children));
  if (!marker) return undefined;

  if (element.attribs['data-mindroom-paste-id'] !== marker.id) return undefined;
  if (element.attribs['data-mindroom-paste-chars'] !== String(marker.chars)) return undefined;
  if (element.attribs['data-mindroom-paste-file'] !== marker.fileName) return undefined;

  return marker;
};

const MINDROOM_PASTE_MARKER_ATTRIBUTE = 'data-mindroom-paste-marker';

// Literal substring detection assumes MindRoom-emitted markers: a literal 🔧
// and lowercase paste-marker attributes. Entity-encoded or case-variant
// spellings from non-MindRoom senders fall back to plain rendering.
const valueHasMindroomMarkerCandidate = (value: unknown): boolean =>
  typeof value === 'string' &&
  (value.includes(MINDROOM_TOOL_REF_ICON) || value.includes(MINDROOM_PASTE_MARKER_ATTRIBUTE));

const contentHasMindroomMarkerCandidate = (content: Record<string, unknown>): boolean => {
  if (isMindroomToolTraceV2(content)) return true;
  if (valueHasMindroomMarkerCandidate(content.formatted_body)) return true;
  if (valueHasMindroomMarkerCandidate(content.body)) return true;

  const extras = content[MINDROOM_MESSAGE_EXTRAS_KEY];
  if (extras && typeof extras === 'object') {
    const { sections } = extras as { sections?: unknown };
    if (Array.isArray(sections)) {
      return sections.some((section) =>
        valueHasMindroomMarkerCandidate((section as { content?: unknown } | null)?.content)
      );
    }
  }

  return false;
};

const createMindroomToolTraceMarkerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  traceEvents: MindroomToolTraceEvent[] | undefined,
  metadataStatus?: MindroomToolMetadataStatus
): HTMLReactParserOptions => {
  const baseReplace = baseOpts.replace;
  const baseTransform = baseOpts.transform;
  const consumedToolIndexes = new Set<number>();
  const groupRootIndexes = new Set<number>();
  const nextOpts: HTMLReactParserOptions = {
    ...baseOpts,
    replace: (domNode) => {
      const isContainer = isDomElementNode(domNode) && ['p', 'div', 'li'].includes(domNode.name);

      if (isContainer) {
        const maybeChildren = domNode.children;
        const maybeToolIndex = parseToolRefIndexFromTextPrefix(
          extractTextFromChildren(maybeChildren as ChildNode[])
        );
        if (maybeToolIndex !== undefined && consumedToolIndexes.has(maybeToolIndex)) {
          return null;
        }
      }

      if (isDomElementNode(domNode)) {
        const pasteMarker = getPasteMarkerFromElement(domNode);
        if (pasteMarker) {
          return <MindroomPasteMarkerBadge marker={pasteMarker} />;
        }

        type ToolRefItem = {
          data: MindroomToolBlockRenderData;
          trailingElement?: Element;
        };

        const buildItem = (element: Element): ToolRefItem | undefined => {
          const toolRefPrefix = getToolRefPrefixFromElement(element);
          if (!toolRefPrefix) return undefined;

          const toolRef = parseMindroomToolRefHtml(toolRefPrefix.html);
          if (!toolRef) return undefined;

          const data = buildToolRefRenderData(
            toolRef,
            traceEvents?.[toolRef.index - 1],
            metadataStatus
          );
          const trailingElement =
            toolRefPrefix.trailingChildren.length > 0
              ? new Element(element.name, { ...element.attribs }, toolRefPrefix.trailingChildren)
              : undefined;

          return { data, trailingElement };
        };

        const firstItem = buildItem(domNode);
        if (firstItem) {
          // Render only the first marker in a consecutive run; later markers are
          // consumed by the first marker's grouped render.
          let previousSibling: ChildNode | null = domNode.prev;
          while (isDomTextNode(previousSibling) && !previousSibling.data.trim()) {
            previousSibling = previousSibling.prev;
          }
          const previousItem = isDomElementNode(previousSibling)
            ? buildItem(previousSibling)
            : undefined;
          if (previousItem && !previousItem.trailingElement) {
            return null;
          }

          const items: ToolRefItem[] = [firstItem];
          const trailingElements: Element[] = [];
          if (firstItem.trailingElement) trailingElements.push(firstItem.trailingElement);
          let boundaryFollower: Element | undefined;

          // A marker paragraph with trailing content is a narrative boundary.
          // Do not merge across that boundary, otherwise tool ordering appears
          // ahead of the narrative text that introduced each call.
          if (!firstItem.trailingElement) {
            let sibling = domNode.next;
            while (sibling) {
              if (isDomTextNode(sibling) && !sibling.data.trim()) {
                sibling = sibling.next;
                continue;
              }

              if (!isDomElementNode(sibling)) break;

              const item = buildItem(sibling);
              if (!item) {
                boundaryFollower = sibling;
                break;
              }

              items.push(item);
              if (item.trailingElement) {
                trailingElements.push(item.trailingElement);
                break;
              }
              sibling = sibling.next;
            }
          }

          if (boundaryFollower) {
            normalizeLeadingToolRefBoundaryInPlace(boundaryFollower);
          }

          items.forEach((item) => consumedToolIndexes.add(item.data.index));
          groupRootIndexes.add(firstItem.data.index);
          const toolBlock = (
            <MindroomToolRefGroupBlock
              key={`tool-group-${firstItem.data.index}`}
              parsedTools={items.map((item) => item.data)}
            />
          );
          if (trailingElements.length === 0) return toolBlock;

          // Each marker that starts the trailing content gets its own block, as
          // rendering that content would give it. Take them in one pass, since
          // rendering it would recurse once per marker.
          const [trailingElement] = trailingElements;
          const chainedToolBlocks: ReactNode[] = [];
          const restChildren = takeLeadingToolRefs(trailingElement, (html) => {
            const toolRef = parseMindroomToolRefHtml(html);
            // Leave content that repeats a consumed index to the check above.
            // The marker starts that content, so its first bracketed number is
            // in the marker.
            const textIndex = parseToolRefIndexFromTextPrefix(html);
            if (!toolRef || (textIndex !== undefined && consumedToolIndexes.has(textIndex))) {
              return false;
            }

            consumedToolIndexes.add(toolRef.index);
            groupRootIndexes.add(toolRef.index);
            chainedToolBlocks.push(
              <MindroomToolRefGroupBlock
                key={`tool-group-${toolRef.index}`}
                parsedTools={[
                  buildToolRefRenderData(toolRef, traceEvents?.[toolRef.index - 1], metadataStatus),
                ]}
              />
            );
            return true;
          });
          const restElement =
            restChildren.length > 0
              ? new Element(
                  trailingElement.name,
                  { ...trailingElement.attribs },
                  restChildren.map((child) => cloneDomChildNode(child))
                )
              : undefined;

          return (
            <>
              {toolBlock}
              {chainedToolBlocks}
              {restElement && domToReact([restElement], nextOpts)}
            </>
          );
        }
      }

      return baseReplace ? baseReplace(domNode) : undefined;
    },
    transform: (reactNode, domNode, index) => {
      const isContainer = isDomElementNode(domNode) && ['p', 'div', 'li'].includes(domNode.name);

      if (isContainer) {
        const maybeChildren = domNode.children;
        const maybeToolIndex = parseToolRefIndexFromTextPrefix(
          extractTextFromChildren(maybeChildren as ChildNode[])
        );
        if (
          maybeToolIndex !== undefined &&
          consumedToolIndexes.has(maybeToolIndex) &&
          !groupRootIndexes.has(maybeToolIndex)
        ) {
          return null;
        }
      }

      return baseTransform ? baseTransform(reactNode, domNode, index) : reactNode;
    },
  };
  return nextOpts;
};

/**
 * The marker parser options for one message, as a function that makes fresh ones for each parse
 * (they keep state while they parse). The function stays the same while the base options, whether
 * the content has markers, its tool trace and the metadata status do, so a memoized parse of a
 * message that did not change is kept when the timeline renders again, as it does for every
 * streamed edit of another message.
 */
export const useMindroomToolTraceMarkerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  content: Record<string, unknown>,
  metadataStatus?: MindroomToolMetadataStatus
): HtmlReactParserOptionsSource => {
  const hasMarkers = contentHasMindroomMarkerCandidate(content);
  const toolTrace = content[MINDROOM_TOOL_TRACE_KEY];
  return useMemo(() => {
    // Most messages carry no markers, and the base options keep the same identity.
    if (!hasMarkers) return baseOpts;
    const traceEvents = getMindroomToolTraceV2Events(toolTrace);
    return () => createMindroomToolTraceMarkerParserOptions(baseOpts, traceEvents, metadataStatus);
  }, [baseOpts, hasMarkers, toolTrace, metadataStatus]);
};
