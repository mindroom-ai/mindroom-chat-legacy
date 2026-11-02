import 'fake-indexeddb/auto';
import React from 'react';
import { create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistAttachmentEvents } from '../threads/__tests__/attachmentFixtures';
import { MINDROOM_MESSAGE_EXTRAS_KEY } from './messageExtrasData';

const toolApprovalCardMock = vi.hoisted(() => vi.fn());
const longTextTextMock = vi.hoisted(() => vi.fn());
const resolvedLongText = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const pasteAttachmentContentMock = vi.hoisted(() => vi.fn());
const toolTraceParserOptionsMock = vi.hoisted(() => vi.fn((options: unknown) => options));

vi.mock('../../components/message', () => ({
  BrokenContent: () => React.createElement('div', { 'data-renderer': 'broken' }),
  MEmote: ({ content, displayName, renderAfterBody, renderBody }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'emote' },
      displayName,
      ' ',
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody
    ),
  MNotice: ({ content, renderAfterBody, renderBody }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'notice' },
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody
    ),
  MText: ({ content, renderAfterBody, renderBody, renderStateSuffix }: any) =>
    React.createElement(
      'div',
      { 'data-renderer': 'text' },
      renderBody({ body: typeof content.body === 'string' ? content.body : '' }),
      renderStateSuffix?.(),
      renderAfterBody
    ),
  RenderBody: ({ body }: { body: string }) => React.createElement('span', null, body),
}));

vi.mock('./MindroomReasoning.css', () => ({}));
vi.mock('./MindroomHtmlBlocks', () => ({
  useMindroomToolTraceMarkerParserOptions: toolTraceParserOptionsMock,
}));

vi.mock('./MindroomThreadSummaryCard', () => ({
  MindroomThreadSummaryCard: ({ summaryInfo }: { summaryInfo: { summaryText?: string } }) =>
    React.createElement('div', { 'data-renderer': 'summary-card' }, summaryInfo.summaryText),
}));

vi.mock('./MindroomToolApprovalCard', () => ({
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

vi.mock('./MindroomLongTextText', () => ({
  // Sidecar contents the tests have "downloaded", by MXC URI.
  useMindroomLongTextResolvedContent: (source: { mxcUri: string } | undefined) =>
    source ? resolvedLongText.get(source.mxcUri) : undefined,
  MindroomLongTextKind: {
    Text: 'text',
    Emote: 'emote',
    Notice: 'notice',
  },
  MindroomLongTextText: ({ content, hydrate, kind, renderAfterBody, renderBody }: any) => {
    longTextTextMock({ hydrate, kind });
    return React.createElement(
      'div',
      { 'data-renderer': 'long-text' },
      kind,
      renderBody(content, { body: typeof content.body === 'string' ? content.body : '' }),
      renderAfterBody?.(content, content)
    );
  },
}));

vi.mock('./MindroomPasteAttachmentContent', () => ({
  MindroomPasteAttachmentContent: ({ attachment }: any) => {
    pasteAttachmentContentMock(attachment);
    return React.createElement('div', { 'data-renderer': 'paste-attachment' }, attachment.fileName);
  },
}));

vi.mock('./StreamingIndicator', () => ({
  renderMindroomStreamingIndicator: () =>
    React.createElement('span', { 'data-renderer': 'streaming' }),
}));

vi.mock('./PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

vi.mock('./MindroomThinkingPlaceholder', () => ({
  MindroomThinkingPlaceholder: ({ startedAt }: { startedAt?: number }) =>
    React.createElement(
      'span',
      { 'data-renderer': 'thinking-placeholder', 'data-started-at': startedAt },
      'Making progress'
    ),
}));

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

const messageExtras = {
  version: 1,
  sections: [
    {
      title: 'Evidence',
      content_type: 'text/plain',
      content: 'extra payload',
    },
  ],
};

const renderNode = async (
  options: Partial<
    Parameters<typeof import('./renderMindroomMessageContent').renderMindroomMessageContent>[0]
  >
) => {
  const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
  return create(
    React.createElement(
      React.Fragment,
      null,
      renderMindroomMessageContent({
        displayName: 'MindRoom',
        msgType: 'm.text',
        content: {
          msgtype: 'm.text',
          body: 'Hello',
        },
        htmlReactParserOptions: {} as never,
        linkifyOpts: {} as never,
        ...options,
      })
    )
  );
};

describe('renderMindroomMessageContent', () => {
  it('renders only the marked router transcription placeholder as an animated status', async () => {
    const placeholder = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Router agent is transcribing…',
        'com.mindroom.visible_router_voice_echo': true,
      },
    });
    const ordinaryMessage = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Router agent is transcribing…',
      },
    });
    const settledTranscript = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Voice transcript is ready',
        'com.mindroom.visible_router_voice_echo': true,
      },
    });

    const status = placeholder.root.findByProps({ role: 'status' });

    expect(status.props['aria-label']).toBe('Router agent is transcribing');
    expect(JSON.stringify(placeholder.toJSON())).toContain('Router agent is transcribing');
    expect(ordinaryMessage.root.findAllByProps({ role: 'status' })).toHaveLength(0);
    expect(settledTranscript.root.findAllByProps({ role: 'status' })).toHaveLength(0);

    placeholder.unmount();
    ordinaryMessage.unmount();
    settledTranscript.unmount();
  });

  it('renders the animated MindRoom thinking placeholder for exact active Thinking... messages', async () => {
    const { MatrixEvent } = await import('matrix-js-sdk');
    const content = {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
    };
    const renderer = await renderNode({
      // With an age, `localTimestamp` differs from `origin_server_ts`.
      mEvent: new MatrixEvent({
        type: 'm.room.message',
        origin_server_ts: 1_234,
        unsigned: { age: 500 },
        content,
      }),
      msgType: 'm.text',
      content,
    });

    const rendered = JSON.stringify(renderer.toJSON());
    // The counter starts when the reply arrived.
    expect(
      renderer.root.findByProps({ 'data-renderer': 'thinking-placeholder' }).props[
        'data-started-at'
      ]
    ).toBe(1_234);

    expect(rendered).toContain('thinking-placeholder');
    expect(rendered).toContain('Making progress');
    expect(rendered).not.toContain('Thinking...');
    expect(rendered).not.toContain('streaming');

    renderer.unmount();
  });

  it('keeps terminal Thinking... messages on the normal text renderer', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'completed',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('data-renderer');
    expect(rendered).toContain('text');
    expect(rendered).toContain('Thinking...');
    expect(rendered).not.toContain('thinking-placeholder');
    expect(rendered).not.toContain('streaming');

    renderer.unmount();
  });

  it('keeps non-placeholder streaming text on the normal text renderer with the streaming suffix', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'The actual answer has started',
        'io.mindroom.stream_status': 'streaming',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('text');
    expect(rendered).toContain('The actual answer has started');
    expect(rendered).toContain('streaming');
    expect(rendered).not.toContain('thinking-placeholder');

    renderer.unmount();
  });

  it('renders a pending send suffix for pending local echo text', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      pendingSend: true,
      content: {
        msgtype: 'm.text',
        body: 'Uploading message',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Uploading message');
    expect(rendered).toContain('Message sending');

    renderer.unmount();
  });

  it('composes streaming and pending send suffixes', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      pendingSend: true,
      content: {
        msgtype: 'm.text',
        body: 'The actual answer has started',
        'io.mindroom.stream_status': 'streaming',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('streaming');
    expect(rendered).toContain('Message sending');

    renderer.unmount();
  });

  it('composes edited and pending send suffixes', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      edited: true,
      pendingSend: true,
      content: {
        msgtype: 'm.text',
        body: 'Edited local echo',
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Edited local echo');
    expect(rendered).toContain('(edited)');
    expect(rendered).toContain('Message sending');

    renderer.unmount();
  });

  it('renders normal text body unchanged when extras are disabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).not.toContain('Evidence');
    expect(rendered).not.toContain('extra payload');

    renderer.unmount();
  });

  it('renders text body and extras when extras are enabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).toContain('Evidence');
    expect(rendered).toContain('extra payload');

    renderer.unmount();
  });

  it('synthesizes safe formatted body for plain text tool markers', async () => {
    toolTraceParserOptionsMock.mockClear();

    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: ['Before <unsafe>', '', '🔧 `run_shell_command` [1]', '', 'After'].join('\n'),
      },
    });

    expect(toolTraceParserOptionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        formatted_body: [
          '<p>Before &lt;unsafe&gt;</p>',
          '<p>🔧 <code>run_shell_command</code> [1]</p>',
          '<p>After</p>',
        ].join(''),
      }),
      undefined
    );

    renderer.unmount();
  });

  it('synthesizes safe formatted body for plain text paste markers', async () => {
    toolTraceParserOptionsMock.mockClear();

    const marker =
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';
    const renderer = await renderNode({
      msgType: 'm.text',
      content: {
        msgtype: 'm.text',
        body: `Before <unsafe> ${marker} after`,
      },
    });

    expect(toolTraceParserOptionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        formatted_body: [
          '<p>Before &lt;unsafe&gt; ',
          '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
          '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
          '</span>',
          ' after</p>',
        ].join(''),
      }),
      undefined
    );

    renderer.unmount();
  });

  it('ignores malformed extras without affecting body rendering', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Body survives',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 3,
          sections: [messageExtras.sections[0]],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Body survives');
    expect(rendered).not.toContain('Evidence');

    renderer.unmount();
  });

  it('renders v2 html extras when extras are enabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 2,
          sections: [
            {
              title: 'HTML',
              content_type: 'text/html',
              content:
                '<p><strong>safe html</strong></p><a href="https://example.test">safe link</a>',
            },
          ],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).toContain('HTML');
    expect(rendered).toContain('safe html');
    expect(rendered).toContain('https://example.test');
    expect(rendered).toContain('noreferrer noopener');

    renderer.unmount();
  });

  it('keeps v2 html extras hidden when extras are disabled', async () => {
    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: false,
      content: {
        msgtype: 'm.text',
        body: 'Normal body',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 2,
          sections: [
            {
              title: 'HTML',
              content_type: 'text/html',
              content: '<p>hidden html</p>',
            },
          ],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Normal body');
    expect(rendered).not.toContain('hidden html');

    renderer.unmount();
  });

  it('sanitizes malicious v2 html extras without breaking the normal body', async () => {
    const scriptHref = `${'java'}script:alert(1)`;
    const renderer = await renderNode({
      msgType: 'm.notice',
      showMessageExtras: true,
      content: {
        msgtype: 'm.notice',
        body: 'Notice body survives',
        [MINDROOM_MESSAGE_EXTRAS_KEY]: {
          version: 2,
          sections: [
            {
              title: 'Malicious',
              content_type: 'text/html',
              content: `<p onclick="alert(1)">safe text</p><script>alert(1)</script><iframe src="https://example.test"></iframe><img src="https://example.test/x.png"><a href="${scriptHref}">bad link</a>`,
            },
          ],
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Notice body survives');
    expect(rendered).toContain('safe text');
    expect(rendered).toContain('bad link');
    expect(rendered).not.toContain('onclick');
    expect(rendered).not.toContain('script');
    expect(rendered).not.toContain('iframe');
    expect(rendered).not.toContain('img');
    expect(rendered).not.toContain(scriptHref);

    renderer.unmount();
  });

  it('names a canvas by its title instead of the fallback for other clients', async () => {
    const { MatrixEvent } = await import('matrix-js-sdk');
    const content = {
      msgtype: 'm.notice',
      body: 'Interactive panel: Pick a time. Open it in MindRoom Chat to respond.',
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        canvas: { title: 'Pick a time', html: '<p>Tuesday</p>' },
      },
    };
    const render = (fromMindroomAgent: boolean) =>
      renderNode({
        mEvent: new MatrixEvent({ type: 'm.room.message', content }),
        fromMindroomAgent,
        msgType: 'm.notice',
        content,
      });

    const agentNotice = JSON.stringify((await render(true)).toJSON());
    expect(agentNotice).toContain('Pick a time');
    expect(agentNotice).not.toContain('Open it in MindRoom Chat');
    // Any sender can write the UI-action key; only MindRoom's accounts show a canvas.
    expect(JSON.stringify((await render(false)).toJSON())).toContain(
      'Open it in MindRoom Chat to respond.'
    );
  });

  it('renders extras for MindRoom long-text text paths', async () => {
    longTextTextMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.text',
      showMessageExtras: true,
      content: {
        msgtype: 'm.text',
        body: 'Long text preview',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('long-text');
    expect(rendered).toContain('Long text preview');
    expect(rendered).toContain('Evidence');
    expect(rendered).toContain('extra payload');
    expect(longTextTextMock).toHaveBeenCalledWith({
      hydrate: true,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('passes long-text hydration preference to deferred long-text renderers', async () => {
    longTextTextMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.text',
      hydrateLongText: false,
      content: {
        msgtype: 'm.text',
        body: 'Long text preview',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    expect(longTextTextMock).toHaveBeenCalledWith({
      hydrate: false,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('renders sanitized Markdown from a long-text preview before hydration', async () => {
    toolTraceParserOptionsMock.mockClear();

    const renderer = await renderNode({
      msgType: 'm.file',
      hydrateLongText: false,
      content: {
        msgtype: 'm.file',
        body: ['# Preview <unsafe>', '', 'Ready **now**.', '', '🔧 `run_shell_command` [1]'].join(
          '\n'
        ),
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    const previewContent = toolTraceParserOptionsMock.mock.calls.at(-1)?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(previewContent).toEqual(
      expect.objectContaining({
        format: 'org.matrix.custom.html',
        formatted_body: expect.stringContaining('<strong data-md="**">now</strong>'),
      })
    );
    expect(previewContent?.formatted_body).toContain('&lt;unsafe&gt;');
    expect(previewContent?.formatted_body).toContain(
      '<p>🔧 <code>run_shell_command</code> [1]</p>'
    );
    expect(previewContent?.formatted_body).not.toContain('<unsafe>');
    expect(longTextTextMock).toHaveBeenCalledWith({
      hydrate: false,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('replaces an empty formatted body with the long-text Markdown preview', async () => {
    toolTraceParserOptionsMock.mockClear();

    const renderer = await renderNode({
      msgType: 'm.file',
      hydrateLongText: false,
      content: {
        msgtype: 'm.file',
        body: 'Preview **now**',
        format: 'org.matrix.custom.html',
        formatted_body: '',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    const previewContent = toolTraceParserOptionsMock.mock.calls.at(-1)?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(previewContent?.formatted_body).toContain('<strong data-md="**">now</strong>');

    renderer.unmount();
  });

  it('formats a reply-stripped copy while preserving the original body for downstream trimming', async () => {
    toolTraceParserOptionsMock.mockClear();
    const body = [
      '> <@bob:example.org> Original question',
      '',
      'Intro paragraph',
      '',
      '> <@alice:example.org> Quoted detail https://example.org',
      '',
      'Tail',
    ].join('\n');

    const renderer = await renderNode({
      msgType: 'm.text',
      hydrateLongText: false,
      content: {
        msgtype: 'm.text',
        body,
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    const previewContent = toolTraceParserOptionsMock.mock.calls.at(-1)?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(previewContent?.formatted_body).toContain('Intro paragraph');
    expect(previewContent?.formatted_body).toContain('Quoted detail https://example.org');
    expect(previewContent?.formatted_body).toContain('Tail');
    expect(previewContent?.formatted_body).not.toContain('Original question');
    expect(previewContent?.body).toBe(body);

    renderer.unmount();
  });

  it('renders a canvas commit as a compact receipt instead of its JSON body', async () => {
    const { buildCanvasResponseContent } = await import('../canvas/canvasMessages');
    const content = buildCanvasResponseContent(
      {
        eventId: '$canvas',
        revisionEventId: '$canvas',
        agentUserId: '@mindroom_a:example.org',
        agentName: 'A',
      },
      { data: { plan: 'pro' }, label: 'Pro plan' }
    );
    const renderer = await renderNode({ msgType: 'm.text', content });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Pro plan');
    expect(rendered).toContain('data-canvas-receipt');
    expect(rendered).not.toContain('"data-renderer":"text"');

    renderer.unmount();
  });

  describe('a canvas answer sent as a long-text sidecar', () => {
    const sidecarAnswer = async () => {
      const { buildCanvasResponseContent, buildCanvasResponsePreview } = await import(
        '../canvas/canvasMessages'
      );
      const content = buildCanvasResponseContent(
        {
          eventId: '$canvas',
          revisionEventId: '$canvas',
          agentUserId: '@mindroom_a:example.org',
          agentName: 'A',
          threadId: '$thread',
        },
        { data: { text: 'Long draft '.repeat(5000) }, label: 'Edited draft' }
      );
      const preview = {
        ...buildCanvasResponsePreview(content),
        msgtype: 'm.file',
        url: 'mxc://example.org/answer',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      };
      return { content, preview };
    };

    afterEach(() => resolvedLongText.clear());

    // What Chat's real hydration returns after downloading a file with these bytes.
    const downloaded = async (file: unknown, raw = JSON.stringify(file)) => {
      const { hydrateMindroomLongTextSource } = await vi.importActual<typeof import('./longText')>(
        './longText'
      );
      return hydrateMindroomLongTextSource(
        { previewContent: { body: '' }, mxcUri: `mxc://test/${raw.length}`, isV2ContentJson: true },
        async () => raw,
        {}
      );
    };

    it('shows the receipt once the downloaded answer proves it', async () => {
      const { content, preview } = await sidecarAnswer();
      resolvedLongText.set('mxc://example.org/answer', await downloaded(content));

      const renderer = await renderNode({ msgType: 'm.file', content: preview });
      const rendered = JSON.stringify(renderer.toJSON());

      expect(rendered).toContain('data-canvas-receipt');
      expect(rendered).toContain('Edited draft');
      expect(rendered).not.toContain('"data-renderer":"long-text"');
      renderer.unmount();
    });

    it('shows no receipt for a file MindRoom would not read the same way', async () => {
      const { content, preview } = await sidecarAnswer();
      // Chat also reads a nested content object; MindRoom reads only the top level.
      resolvedLongText.set('mxc://example.org/answer', await downloaded({ content }));
      const nested = await renderNode({ msgType: 'm.file', content: preview });
      expect(JSON.stringify(nested.toJSON())).not.toContain('data-canvas-receipt');
      nested.unmount();

      // MindRoom does not download a file over 2 MiB, so the agent would read only the preview.
      resolvedLongText.set(
        'mxc://example.org/answer',
        await downloaded({ ...content, padding: 'x'.repeat(2 * 1024 * 1024) })
      );
      const oversized = await renderNode({ msgType: 'm.file', content: preview });
      expect(JSON.stringify(oversized.toJSON())).not.toContain('data-canvas-receipt');
      oversized.unmount();

      // MindRoom reads a replacement inside the file; Chat would copy the answer's body into it.
      resolvedLongText.set(
        'mxc://example.org/answer',
        await downloaded({ ...content, 'm.new_content': { msgtype: 'm.text' } })
      );
      const replaced = await renderNode({ msgType: 'm.file', content: preview });
      expect(JSON.stringify(replaced.toJSON())).not.toContain('data-canvas-receipt');
      replaced.unmount();

      // MindRoom reads even a replacement Chat would ignore, and finds no answer in it.
      resolvedLongText.set(
        'mxc://example.org/answer',
        await downloaded({ ...content, 'm.new_content': {} })
      );
      const emptyReplacement = await renderNode({ msgType: 'm.file', content: preview });
      expect(JSON.stringify(emptyReplacement.toJSON())).not.toContain('data-canvas-receipt');
      emptyReplacement.unmount();

      // A file nested deeper than MindRoom reads shows as ordinary long text, without a crash.
      const depth = 100_000;
      resolvedLongText.set(
        'mxc://example.org/answer',
        await downloaded(
          undefined,
          JSON.stringify(content).replace(/}$/, `,"deep":${'['.repeat(depth)}${']'.repeat(depth)}}`)
        )
      );
      const deep = await renderNode({ msgType: 'm.file', content: preview });
      const deepRendered = JSON.stringify(deep.toJSON());
      expect(deepRendered).not.toContain('data-canvas-receipt');
      expect(deepRendered).toContain('"data-renderer":"long-text"');
      deep.unmount();

      // MindRoom refuses a file with a lone surrogate anywhere in it.
      resolvedLongText.set(
        'mxc://example.org/answer',
        await downloaded({ ...content, note: 'x\ud800' })
      );
      const malformed = await renderNode({ msgType: 'm.file', content: preview });
      expect(JSON.stringify(malformed.toJSON())).not.toContain('data-canvas-receipt');
      malformed.unmount();
    });

    it('shows the ordinary long text until the answer is downloaded', async () => {
      const { preview } = await sidecarAnswer();

      const renderer = await renderNode({ msgType: 'm.file', content: preview });
      const rendered = JSON.stringify(renderer.toJSON());

      expect(rendered).not.toContain('data-canvas-receipt');
      expect(rendered).toContain('long-text');
      renderer.unmount();
    });

    it('judges the reply by the event, not by the downloaded file', async () => {
      const { content, preview } = await sidecarAnswer();
      // The file claims the canvas, but the event itself replies elsewhere.
      resolvedLongText.set('mxc://example.org/answer', await downloaded(content));
      const elsewhere = {
        ...preview,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$thread',
          'm.in_reply_to': { event_id: '$other' },
        },
      };

      const renderer = await renderNode({ msgType: 'm.file', content: elsewhere });
      const rendered = JSON.stringify(renderer.toJSON());

      expect(rendered).not.toContain('data-canvas-receipt');
      renderer.unmount();
    });
  });

  it('shows a canvas answer that is still sending with its send state, not as delivered', async () => {
    const { buildCanvasResponseContent } = await import('../canvas/canvasMessages');
    const content = buildCanvasResponseContent(
      {
        eventId: '$canvas',
        revisionEventId: '$canvas',
        agentUserId: '@mindroom_a:example.org',
        agentName: 'A',
      },
      { data: { plan: 'pro' }, label: 'Pro plan' }
    );
    const sending = JSON.stringify(
      (await renderNode({ msgType: 'm.text', content, pendingSend: true })).toJSON()
    );
    const delivered = JSON.stringify((await renderNode({ msgType: 'm.text', content })).toJSON());

    expect(sending).toContain('Message sending');
    expect(sending).toContain('data-canvas-receipt');
    expect(delivered).not.toContain('Message sending');
  });

  it('renders a canvas commit whose body disagrees with its metadata as ordinary text', async () => {
    const { buildCanvasResponseContent } = await import('../canvas/canvasMessages');
    const content = buildCanvasResponseContent(
      {
        eventId: '$canvas',
        revisionEventId: '$canvas',
        agentUserId: '@mindroom_a:example.org',
        agentName: 'A',
      },
      { data: { plan: 'pro' }, label: 'Pro plan' }
    );
    const renderer = await renderNode({
      msgType: 'm.text',
      content: { ...content, body: 'Something else entirely' },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Something else entirely');
    expect(rendered).not.toContain('data-canvas-receipt');

    renderer.unmount();
  });

  it('renders thread summary metadata through the MindRoom summary card', async () => {
    const renderer = await renderNode({
      msgType: 'm.notice',
      showMessageExtras: true,
      content: {
        msgtype: 'm.notice',
        body: 'Summary body',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Rendered summary text',
        },
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('summary-card');
    expect(rendered).toContain('Rendered summary text');
    expect(rendered).not.toContain('Evidence');
    expect(rendered).not.toContain('notice');

    renderer.unmount();
  });

  it('renders tool approval events through the MindRoom approval card', async () => {
    toolApprovalCardMock.mockReset();

    const renderer = await renderNode({
      fromMindroomAgent: true,
      eventType: 'io.mindroom.tool_approval',
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread-root',
      msgType: '',
      showMessageExtras: true,
      content: {
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
        [MINDROOM_MESSAGE_EXTRAS_KEY]: messageExtras,
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('tool-approval');
    expect(rendered).toContain('web_search');
    expect(rendered).not.toContain('Evidence');
    expect(toolApprovalCardMock).toHaveBeenCalledWith({
      approval: expect.objectContaining({
        toolName: 'web_search',
      }),
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread-root',
    });

    renderer.unmount();
  });

  it('does not render an approval card from a sender that is not a MindRoom account', async () => {
    toolApprovalCardMock.mockReset();

    const renderer = await renderNode({
      fromMindroomAgent: false,
      eventType: 'io.mindroom.tool_approval',
      roomId: '!room:example.org',
      eventId: '$forged',
      msgType: '',
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        status: 'pending',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2999-04-17T12:00:00Z',
      },
    });

    expect(toolApprovalCardMock).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('broken');

    renderer.unmount();
  });

  it('keeps renderer thread scope available when a grant edit omits thread_id', async () => {
    toolApprovalCardMock.mockReset();

    const renderer = await renderNode({
      fromMindroomAgent: true,
      eventType: 'io.mindroom.tool_approval',
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread-root',
      msgType: 'io.mindroom.tool_approval',
      content: {
        approval_id: 'approval-1',
        tool_name: 'web_search',
        arguments: { query: 'release date' },
        agent_name: 'research',
        requester_id: '@alice:example.org',
        approver_user_id: '@alice:example.org',
        status: 'approved',
        requested_at: '2026-04-10T12:00:00Z',
        expires_at: '2026-04-17T12:00:00Z',
        resolved_at: '2026-04-10T12:01:00Z',
        resolved_by: '@alice:example.org',
        auto_approval: {
          grant_id: 'grant-1',
          expires_at: '2026-04-10T12:11:00Z',
          revoked_at: null,
        },
      },
    });

    expect(toolApprovalCardMock).toHaveBeenCalledWith({
      approval: expect.objectContaining({
        threadId: null,
        autoApproval: expect.objectContaining({ grantId: 'grant-1' }),
      }),
      roomId: '!room:example.org',
      eventId: '$approval',
      threadId: '$thread-root',
    });

    renderer.unmount();
  });

  it('renders long-text metadata before falling back to normal file rendering', async () => {
    longTextTextMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.file',
      content: {
        msgtype: 'm.file',
        body: 'Long output.txt',
        url: 'mxc://example.org/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('long-text');
    expect(longTextTextMock).toHaveBeenCalledWith({
      hydrate: true,
      kind: 'text',
    });

    renderer.unmount();
  });

  it('renders paste text attachments through an inspectable MindRoom file card', async () => {
    pasteAttachmentContentMock.mockReset();

    const renderer = await renderNode({
      msgType: 'm.file',
      content: {
        msgtype: 'm.file',
        body: 'mindroom-paste-a3f19c.txt',
        filename: 'mindroom-paste-a3f19c.txt',
        url: 'mxc://example.org/pasted-text',
        info: {
          mimetype: 'text/plain',
          size: 11,
        },
        'io.mindroom.paste_attachment': {
          version: 1,
          id: 'paste-a3f19c',
          chars: 11,
          file: 'mindroom-paste-a3f19c.txt',
        },
      },
    });

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('paste-attachment');
    expect(rendered).toContain('mindroom-paste-a3f19c.txt');
    expect(pasteAttachmentContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'paste-a3f19c',
        chars: 11,
        fileName: 'mindroom-paste-a3f19c.txt',
        mxcUri: 'mxc://example.org/pasted-text',
      })
    );

    renderer.unmount();
  });

  it('returns undefined for non-MindRoom media messages so generic rendering can handle them', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');

    const rendered = renderMindroomMessageContent({
      displayName: 'MindRoom',
      msgType: 'm.image',
      content: {
        msgtype: 'm.image',
        body: 'image.png',
      },
      htmlReactParserOptions: {} as never,
      linkifyOpts: {} as never,
    });

    expect(rendered).toBeUndefined();
  });
});

it.each(['m.notice', 'm.emote'])(
  'retires and clears rendered long text for %s',
  async (msgType) => {
    const { IDBFactory } = await import('fake-indexeddb');
    const { createClient, MatrixEvent } = await import('matrix-js-sdk');
    const cache = await import('../threads/cacheStore');
    const { hydrateCachedMindroomLongText } = await import('./attachmentRepository');
    const { createSessionId } = await import('../../state/sessions');
    globalThis.indexedDB = new IDBFactory();
    cache.resetCacheStoreForTesting();
    const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:test' });
    const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ msgtype: msgType, body: 'complete body' })))
    );
    try {
      for (const revision of [1, 2]) {
        const content = {
          msgtype: msgType,
          body: 'preview',
          url: 'mxc://matrix.example.org/render-' + revision,
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        };
        const mEvent = new MatrixEvent({
          event_id: '$render',
          room_id: '!render:test',
          type: 'm.room.message',
          sender: '@alice:test',
          origin_server_ts: revision,
          content,
        });
        await persistAttachmentEvents(mx, [mEvent]);
        const tree = await renderNode({ msgType, content, mEvent });
        const node = tree.root.find((item) => !!item.props.longTextSource);
        const hydrated = await hydrateCachedMindroomLongText(mx, node.props.longTextSource);
        expect(hydrated.body).toBe('complete body');
        tree.unmount();
      }
      expect(
        await cache.loadCachedAttachment(sessionId, 'mxc://matrix.example.org/render-1')
      ).toBeUndefined();
      expect(
        await cache.loadCachedAttachment(sessionId, 'mxc://matrix.example.org/render-2')
      ).toBeDefined();
      await cache.clearRoomCachedContent(sessionId, '!render:test');
      expect(
        await cache.loadCachedAttachment(sessionId, 'mxc://matrix.example.org/render-2')
      ).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      cache.resetCacheStoreForTesting();
    }
  }
);
