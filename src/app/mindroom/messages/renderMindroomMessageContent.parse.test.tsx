import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './messageExtrasData';
import { renderMindroomMessageContent } from './renderMindroomMessageContent';
import type { MindroomToolMetadataStatus } from './toolTrace';

const sanitizeCustomHtmlSpy = vi.hoisted(() => vi.fn((html: string) => html));
// The tool metadata status the long-text renderer reports, as while a sidecar loads.
const longText = vi.hoisted(() => ({ status: 'loading' as MindroomToolMetadataStatus }));

vi.mock('../../utils/sanitize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/sanitize')>()),
  sanitizeCustomHtml: sanitizeCustomHtmlSpy,
}));

// The real RenderBody and its memo, under an MText that passes the formatted body and renders
// the extras after it, as MText does.
vi.mock('../../components/message', async () => {
  const { RenderBody } = await import('../../components/message/RenderBody');
  return {
    BrokenContent: () => null,
    MEmote: () => null,
    MNotice: () => null,
    MText: ({ content, renderBody, renderAfterBody }: any) =>
      React.createElement(
        'div',
        null,
        renderBody({ body: content.body, customBody: content.formatted_body }),
        renderAfterBody
      ),
    RenderBody,
  };
});

vi.mock('../../components/message/content', () => ({ MessageEmptyContent: () => null }));

vi.mock('../../plugins/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => text,
}));

vi.mock('./StreamingIndicator', () => ({ renderMindroomStreamingIndicator: () => null }));
vi.mock('./MindroomThreadSummaryCard', () => ({ MindroomThreadSummaryCard: () => null }));
vi.mock('./MindroomToolApprovalCard', () => ({ MindroomToolApprovalCard: () => null }));
vi.mock('./MindroomPasteAttachmentContent', () => ({ MindroomPasteAttachmentContent: () => null }));
vi.mock('./MindroomThinkingPlaceholder', () => ({ MindroomThinkingPlaceholder: () => null }));
vi.mock('./MindroomLongTextText', () => ({
  MindroomLongTextKind: { Text: 'text', Emote: 'emote', Notice: 'notice' },
  MindroomLongTextText: ({ content, renderBody }: any) =>
    renderBody(
      content,
      { body: content.body, customBody: content.formatted_body },
      longText.status
    ),
}));

vi.mock('./ApprovalArgumentFields.css', () => ({
  Arguments: 'Arguments',
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
}));

vi.mock('./MindroomReasoning.css', () => ({}));
vi.mock('./MindroomHtmlBlocks.css', () => ({
  Block: 'Block',
  BlockBody: 'BlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'BlockHeader',
  BlockHeaderMeta: 'BlockHeaderMeta',
  BlockLabel: 'BlockLabel',
  BlockInlineResult: 'BlockInlineResult',
  BlockResult: 'BlockResult',
  PasteMarkerBadge: 'PasteMarkerBadge',
  PasteMarkerBadgeMeta: 'PasteMarkerBadgeMeta',
  ToolGroupItem: 'ToolGroupItem',
  ToolGroupList: 'ToolGroupList',
  ToolRowHeader: 'ToolRowHeader',
  ToolRowIndex: 'ToolRowIndex',
  ToolRowName: 'ToolRowName',
}));

vi.mock('./PendingSendIndicator.css', () => ({ Container: 'PendingSendIndicator' }));

vi.mock('./MindroomTranscribingPlaceholder.css', () => ({
  Placeholder: 'TranscribingPlaceholder',
  Text: 'TranscribingText',
  Wave: 'TranscribingWave',
  WaveBar: 'TranscribingWaveBar',
}));

vi.mock('./MindroomMessageExtras.css.ts', () => ({
  Extras: 'Extras',
  Section: 'Section',
  Summary: 'Summary',
  Content: 'Content',
  PlainText: 'PlainText',
  Markdown: 'Markdown',
  Html: 'Html',
}));

const htmlReactParserOptions: HTMLReactParserOptions = {};
const linkifyOpts = {};

const toolTrace = (...toolNames: string[]) => ({
  version: 2,
  events: toolNames.map((name) => ({ type: 'tool_call_completed', tool_name: name })),
});

const agentReply = (text: string, trace: ReturnType<typeof toolTrace>) => ({
  msgtype: 'm.text',
  body: `${text}\n\n🔧 \`${trace.events[0].tool_name}\` [1]`,
  format: 'org.matrix.custom.html',
  formatted_body: `<p>${text}</p><p>🔧 <code>${trace.events[0].tool_name}</code> [1]</p>`,
  'io.mindroom.tool_trace': trace,
});

type Reply = Record<string, unknown> & { formatted_body: string };

function Timeline({ replies, highlightRegex }: { replies: Reply[]; highlightRegex?: RegExp }) {
  return (
    <ClientConfigProvider value={{}}>
      {replies.map((content, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <React.Fragment key={index}>
          {renderMindroomMessageContent({
            displayName: 'Agent',
            msgType: 'm.text',
            content,
            highlightRegex,
            htmlReactParserOptions,
            linkifyOpts,
            showMessageExtras: true,
          })}
        </React.Fragment>
      ))}
    </ClientConfigProvider>
  );
}

const parsesOf = (content: Reply) =>
  sanitizeCustomHtmlSpy.mock.calls.filter(([html]) => html === content.formatted_body).length;
const extrasParses = (toolName: string) =>
  sanitizeCustomHtmlSpy.mock.calls.filter(([html]) => html.includes(`>${toolName}</code>`)).length;

let renderer: ReactTestRenderer | undefined;
const render = (replies: Reply[], highlightRegex?: RegExp) =>
  act(() => {
    const timeline = <Timeline replies={replies} highlightRegex={highlightRegex} />;
    if (renderer) renderer.update(timeline);
    else renderer = create(timeline);
  });
const text = () => JSON.stringify(renderer?.toJSON());
// The tool names of the rendered tool call rows; a marker that did not render stays text.
const toolCalls = () =>
  renderer?.root
    .findAll((node) => node.props.className === 'activity-detail')
    .map((node) => node.children.join(''));

describe('renderMindroomMessageContent parsing', () => {
  beforeEach(() => {
    sanitizeCustomHtmlSpy.mockClear();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('parses only the reply that changed when another reply with tool calls streams', () => {
    const done = agentReply('Finished the search.', toolTrace('web_search'));
    let streaming = agentReply('Working on it.', toolTrace('browser_control'));
    render([done, streaming]);
    expect(parsesOf(done)).toBe(1);

    for (let edit = 1; edit <= 3; edit += 1) {
      streaming = agentReply(`Working on it, step ${edit}.`, toolTrace('browser_control'));
      // Edits are resolved again on every timeline render, so unchanged replies arrive as new
      // objects with the same values.
      render([{ ...done }, streaming]);
      expect(parsesOf(streaming)).toBe(1);
    }

    expect(parsesOf(done)).toBe(1);
    expect(text()).toContain('Working on it, step 3.');
    expect(text()).not.toContain('step 2');
    expect(toolCalls()).toEqual(['web_search', 'browser_control']);
  });

  it('parses a reply again when only its tool trace changes', () => {
    const before = agentReply('Searching.', toolTrace('web_search'));
    render([before]);
    const after = { ...before, 'io.mindroom.tool_trace': toolTrace('web_search') };
    render([after]);

    expect(parsesOf(before)).toBe(2);
  });

  it('renders the tool calls of a reply parsed again for another reason', () => {
    const reply = agentReply('Searching.', toolTrace('web_search'));
    render([reply]);
    // A search highlight parses the same reply again with the same parser options.
    render([reply], /Searching/);

    expect(parsesOf(reply)).toBe(2);
    expect(toolCalls()).toEqual(['web_search']);
  });

  it('parses the extras of a reply that did not change only once while another reply streams', () => {
    const done = {
      ...agentReply('Finished.', toolTrace('web_search')),
      [MINDROOM_MESSAGE_EXTRAS_KEY]: {
        version: 1,
        sections: [{ title: 'Trace', content_type: 'text/markdown', content: '🔧 `lookup` [1]' }],
      },
    };
    let streaming = agentReply('Working on it.', toolTrace('browser_control'));
    render([done, streaming]);
    expect(extrasParses('lookup')).toBe(1);

    for (let edit = 1; edit <= 3; edit += 1) {
      streaming = agentReply(`Working on it, step ${edit}.`, toolTrace('browser_control'));
      render([{ ...done }, streaming]);
    }

    expect(extrasParses('lookup')).toBe(1);
    expect(text()).toContain('lookup');
    expect(text()).toContain('Working on it, step 3.');
  });

  it('parses a long reply again when its tool metadata status changes', () => {
    const reply = {
      ...agentReply('Long answer.', toolTrace('web_search')),
      url: 'mxc://example.org/long-text',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    };
    longText.status = 'loading';
    render([reply]);
    render([{ ...reply }]);
    expect(parsesOf(reply)).toBe(1);

    // The sidecar settled without the tool metadata.
    longText.status = 'unavailable';
    render([{ ...reply }]);

    expect(parsesOf(reply)).toBe(2);
    expect(toolCalls()).toEqual(['web_search']);
  });
});
