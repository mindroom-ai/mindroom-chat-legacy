import React from 'react';
import { create } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';

const toolApprovalCardMock = vi.hoisted(() => vi.fn());
const renderMindroomMessageContentMock = vi.hoisted(() => vi.fn());

vi.mock('folds', () => ({
  Box: ({ children, as: asElement = 'div', ...props }: any) =>
    React.createElement(asElement, props, children),
  Icon: ({ src }: { src?: string }) => React.createElement('span', null, src ?? 'icon'),
  Icons: {
    Clock: 'Clock',
    Delete: 'Delete',
    Lock: 'Lock',
    Warning: 'Warning',
  },
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('span', props, children),
  as: (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
    React.forwardRef(render),
  color: {
    Critical: { Main: '#f00' },
    Warning: { Main: '#fc0' },
  },
  config: {
    opacity: {
      P300: '0.6',
    },
    space: {
      S200: '8px',
    },
  },
}));

vi.mock('../../../components/message', () => ({
  DownloadFile: () => null,
  FileDownloadButton: () => null,
  FileContent: () => null,
  ImageContent: () => null,
  MAudio: () => null,
  MBadEncrypted: () => React.createElement('div', { 'data-renderer': 'bad-encrypted' }),
  MEmote: () => React.createElement('div', { 'data-renderer': 'emote' }),
  MFile: () => null,
  MImage: ({ content, renderAsFile }: any) =>
    content.info?.mimetype === 'image/svg+xml' ? renderAsFile() : null,
  MLocation: () => React.createElement('div', { 'data-renderer': 'location' }),
  MNotice: () => React.createElement('div', { 'data-renderer': 'notice' }),
  MindroomThreadSummaryCard: ({ summaryInfo }: { summaryInfo: { summaryText?: string } }) =>
    React.createElement('div', { 'data-renderer': 'summary-card' }, summaryInfo.summaryText),
  MText: ({ content, renderStateSuffix }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'text' },
      typeof content.body === 'string' ? content.body : '',
      renderStateSuffix?.()
    ),
  MVideo: () => null,
  ReadPdfFile: () => null,
  ReadTextFile: () => null,
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
  ThumbnailContent: () => null,
  UnsupportedContent: () => React.createElement('div', { 'data-renderer': 'unsupported' }),
  VideoContent: () => null,
}));

vi.mock('../../../components/url-preview', () => ({
  UrlPreviewCard: () => null,
  UrlPreviewHolder: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../components/media', () => ({
  Image: () => null,
  Video: () => null,
}));

vi.mock('../../../components/image-viewer', () => ({
  ImageViewer: () => null,
}));

vi.mock('../../../components/Pdf-viewer', () => ({
  PdfViewer: () => null,
}));

vi.mock('../../../components/text-viewer', () => ({
  TextViewer: () => null,
}));

vi.mock('../../../plugins/matrix-to', () => ({
  testMatrixTo: () => false,
}));

vi.mock('../renderMindroomMessageContent', () => ({
  renderMindroomMessageContent: renderMindroomMessageContentMock,
}));

vi.mock('../PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

vi.mock('../longText', () => ({
  getMindroomLongTextSource: () => undefined,
}));

vi.mock('../MindroomLongTextText', () => ({
  MindroomLongTextKind: {
    Text: 'text',
    Emote: 'emote',
    Notice: 'notice',
  },
  MindroomLongTextText: () => null,
}));

vi.mock('../MindroomToolApprovalCard', () => ({
  MindroomToolApprovalCard: ({
    approval,
    eventId,
    roomId,
    threadId,
  }: {
    approval: { toolName: string };
    eventId?: string;
    roomId?: string;
    threadId?: string;
  }) => {
    toolApprovalCardMock({ approval, eventId, roomId, threadId });
    return React.createElement('div', { 'data-renderer': 'tool-approval' }, approval.toolName);
  },
}));

vi.mock('../../../plugins/react-custom-html-parser', () => ({}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@viewer:example.org' }),
}));

const AGENT = '@mindroom_research:example.org';
const HUMAN = '@alice:example.org';
const messageFrom = (sender: string) =>
  new MatrixEvent({ type: 'm.room.message', sender, content: { msgtype: 'm.text' } });

describe('RenderMessageContent', () => {
  it.each([
    ['streaming agent', AGENT, { 'io.mindroom.stream_status': 'streaming' }, false],
    ['completed agent', AGENT, { 'io.mindroom.stream_status': 'completed' }, false],
    ['agent run', AGENT, { 'io.mindroom.ai_run': { version: 1, status: 'completed' } }, false],
    ['agent tool trace', AGENT, { 'io.mindroom.tool_trace': { version: 2, events: [] } }, false],
    [
      'nested agent metadata',
      AGENT,
      { 'm.new_content': { 'io.mindroom.stream_status': 'completed' } },
      false,
    ],
    ['human', HUMAN, {}, true],
    [
      'human with unrelated metadata',
      HUMAN,
      { 'io.mindroom.paste_attachment': { version: 1 } },
      true,
    ],
    ['router transcript', AGENT, { 'com.mindroom.visible_router_voice_echo': true }, false],
    [
      'disabled router voice echo',
      AGENT,
      { 'com.mindroom.visible_router_voice_echo': false },
      true,
    ],
    [
      'invalid router voice echo',
      AGENT,
      { 'com.mindroom.visible_router_voice_echo': 'true' },
      true,
    ],
    ['human voice transcript', HUMAN, { 'com.mindroom.voice_transcript': true }, true],
    ['human quoting router status', HUMAN, { body: 'Router agent is transcribing…' }, true],
    ['human with agent metadata', HUMAN, { 'io.mindroom.stream_status': 'completed' }, true],
    [
      'human with a router transcript flag',
      HUMAN,
      { 'com.mindroom.visible_router_voice_echo': true },
      true,
    ],
    [
      'foreign-server agent',
      '@mindroom_research:other.example',
      { 'io.mindroom.stream_status': 'completed' },
      true,
    ],
  ])(
    'passes the edited-label policy for %s messages to the content renderer',
    async (_, sender, metadata, edited) => {
      const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
      renderMindroomMessageContentMock.mockReset();
      renderMindroomMessageContentMock.mockReturnValue(null);
      const content = { msgtype: 'm.text', body: 'Updated answer', ...metadata };

      const renderer = create(
        React.createElement(RenderMessageContent, {
          mEvent: messageFrom(sender),
          displayName: 'Sender',
          msgType: 'm.text',
          ts: 0,
          edited: true,
          getContent: (() => content) as <T>() => T,
          htmlReactParserOptions: {} as never,
          linkifyOpts: {} as never,
        })
      );

      expect(renderMindroomMessageContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ edited, content })
      );
      renderer.unmount();
    }
  );

  it.each([
    [false, undefined],
    [true, expect.any(Function)],
  ])(
    'passes a URL preview renderer on only with urlPreview on (urlPreview: %s)',
    async (urlPreview, preview) => {
      const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
      renderMindroomMessageContentMock.mockReset();
      renderMindroomMessageContentMock.mockReturnValue(null);
      const renderer = create(
        React.createElement(RenderMessageContent, {
          displayName: 'Sender',
          msgType: 'm.text',
          ts: 0,
          urlPreview,
          getContent: (() => ({ msgtype: 'm.text', body: 'https://example.org' })) as <T>() => T,
          htmlReactParserOptions: {} as never,
          linkifyOpts: {} as never,
        })
      );

      expect(renderMindroomMessageContentMock).toHaveBeenCalledWith(
        expect.objectContaining({ renderUrlsPreview: preview })
      );
      renderer.unmount();
    }
  );

  it('delegates MindRoom-specific message content to the MindRoom renderer seam', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'mindroom-message' }, 'delegated')
    );
    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        msgType: 'm.notice',
        ts: 0,
        showMessageExtras: true,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Summary body',
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('mindroom-message');
    expect(rendered).toContain('delegated');
    expect(renderMindroomMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'MindRoom',
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        msgType: 'm.notice',
        showMessageExtras: true,
        content: expect.objectContaining({
          body: 'Summary body',
        }),
      })
    );

    renderer.unmount();
  });

  it('renders the summary card when thread summary metadata is present on a legacy msgtype', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'summary-card' }, 'Rendered summary text')
    );

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.notice',
        ts: 0,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Summary body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Rendered summary text',
          },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Rendered summary text');
    expect(rendered).not.toContain('unsupported');

    renderer.unmount();
  });

  it('keeps rendering edited summaries as summary cards when m.new_content omits metadata', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'summary-card' }, 'Edited summary body')
    );

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'MindRoom',
        msgType: 'm.notice',
        ts: 0,
        edited: true,
        getContent: (() => ({
          msgtype: 'm.notice',
          body: 'Edited summary body',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Stale metadata summary',
          },
          'm.new_content': {
            msgtype: 'm.notice',
            body: 'Edited summary body',
          },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Edited summary body');
    expect(rendered).not.toContain('notice');

    renderer.unmount();
  });

  it('renders the tool approval card for io.mindroom.tool_approval events', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(
      React.createElement('div', { 'data-renderer': 'tool-approval' }, 'web_search')
    );
    toolApprovalCardMock.mockReset();

    const renderer = create(
      React.createElement(RenderMessageContent, {
        mEvent: messageFrom(AGENT),
        displayName: 'MindRoom',
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        msgType: '',
        ts: 0,
        getContent: (() => ({
          approval_id: 'approval-1',
          tool_name: 'web_search',
          arguments: { query: 'release date' },
          agent_name: 'research',
          status: 'pending',
          requested_at: '2026-04-10T12:00:00Z',
          expires_at: '2026-04-17T12:00:00Z',
          resolved_at: null,
          resolved_by: null,
          resolution_reason: null,
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('tool-approval');
    expect(rendered).toContain('web_search');
    expect(rendered).not.toContain('unsupported');
    expect(renderMindroomMessageContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromMindroomAgent: true,
        eventType: 'io.mindroom.tool_approval',
        roomId: '!room:example.org',
        eventId: '$approval',
        threadId: '$thread-root',
        content: expect.objectContaining({
          tool_name: 'web_search',
        }),
      })
    );

    renderer.unmount();
  });

  it.each([
    ['human', HUMAN, {}, true],
    ['agent', AGENT, { 'io.mindroom.stream_status': 'completed' }, false],
  ])(
    'keeps send status on %s image captions while applying the edited-label policy',
    async (_, sender, metadata, showEdited) => {
      const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
      renderMindroomMessageContentMock.mockReset();
      renderMindroomMessageContentMock.mockReturnValue(undefined);

      const renderer = create(
        React.createElement(RenderMessageContent, {
          mEvent: messageFrom(sender),
          displayName: 'MindRoom',
          msgType: 'm.image',
          ts: 0,
          edited: true,
          pendingSend: true,
          getContent: (() => ({
            msgtype: 'm.image',
            body: 'Caption text',
            filename: 'image.png',
            url: 'mxc://example/image',
            ...metadata,
          })) as <T>() => T,
          htmlReactParserOptions: {} as never,
          linkifyOpts: {} as never,
        })
      );

      const rendered = JSON.stringify(renderer.toJSON());

      expect(rendered).toContain('Caption text');
      expect(rendered).toContain('Message sending');
      expect(rendered.includes('(edited)')).toBe(showEdited);

      renderer.unmount();
    }
  );

  it('shows the caption of an SVG image rendered as a file once', async () => {
    const { RenderMessageContent } = await import('../../../components/RenderMessageContent');
    renderMindroomMessageContentMock.mockReset();
    renderMindroomMessageContentMock.mockReturnValue(undefined);

    const renderer = create(
      React.createElement(RenderMessageContent, {
        displayName: 'Sender',
        msgType: 'm.image',
        ts: 0,
        getContent: (() => ({
          msgtype: 'm.image',
          body: 'Architecture diagram',
          filename: 'diagram.svg',
          url: 'mxc://example/diagram',
          info: { mimetype: 'image/svg+xml' },
        })) as <T>() => T,
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
      })
    );

    expect(renderer.root.findAllByProps({ 'data-renderer': 'text' })).toHaveLength(1);

    renderer.unmount();
  });
});
