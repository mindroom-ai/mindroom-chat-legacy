import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts } from 'linkifyjs';
import { ClientConfigProvider, type ClientConfig } from '../../hooks/useClientConfig';

const sanitizeCustomHtmlSpy = vi.hoisted(() => vi.fn((html: string) => html));

vi.mock('../../utils/sanitize', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../utils/sanitize')>();
  return {
    ...original,
    sanitizeCustomHtml: sanitizeCustomHtmlSpy,
  };
});

vi.mock('./content', () => ({
  MessageEmptyContent: () => React.createElement('span', { 'data-testid': 'empty-content' }),
}));

vi.mock('../../plugins/react-custom-html-parser', () => ({
  renderTextWithLatex: (text: string) => React.createElement('span', null, text),
}));

vi.mock('../../mindroom/messages/ApprovalArgumentFields.css', () => ({
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

vi.mock('../../mindroom/messages/MindroomHtmlBlocks.css', () => ({
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

// eslint-disable-next-line import/first
import { useMindroomToolTraceMarkerParserOptions } from '../../mindroom/messages/MindroomHtmlBlocks';

// eslint-disable-next-line import/first
import { RenderBody } from './RenderBody';

const htmlReactParserOptions: HTMLReactParserOptions = {};
const linkifyOpts: Opts = {};

const renderBody = (body: string, customBody?: string, clientConfig: ClientConfig = {}) => (
  <ClientConfigProvider value={clientConfig}>
    <RenderBody
      body={body}
      customBody={customBody}
      htmlReactParserOptions={htmlReactParserOptions}
      linkifyOpts={linkifyOpts}
    />
  </ClientConfigProvider>
);

describe('RenderBody', () => {
  beforeEach(() => {
    sanitizeCustomHtmlSpy.mockClear();
  });

  it('renders custom HTML content', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody('hello', '<p>hello <strong>world</strong></p>'));
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('world');
    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledTimes(1);
  });

  it('passes configured custom URI schemes to the message sanitizer', () => {
    const customBody = '<a href="obsidian://open?vault=notes&file=daily">Daily note</a>';
    act(() => {
      create(
        renderBody('Daily note', customBody, {
          messageRendering: {
            additionalAllowedUriSchemes: ['obsidian'],
          },
        })
      );
    });

    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledWith(customBody, {
      additionalAllowedUriSchemes: ['obsidian'],
    });
  });

  it('does not re-sanitize or re-parse unchanged custom HTML on re-render', () => {
    const customBody = '<p>streamed <em>content</em></p>';
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody('streamed content', customBody));
    });
    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledTimes(1);

    act(() => {
      renderer?.update(renderBody('streamed content', customBody));
    });
    act(() => {
      renderer?.update(renderBody('streamed content', customBody));
    });

    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledTimes(1);
  });

  it('re-parses when the custom HTML changes', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody('chunk 1', '<p>chunk 1</p>'));
    });
    act(() => {
      renderer?.update(renderBody('chunk 2', '<p>chunk 2</p>'));
    });

    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer?.toJSON())).toContain('chunk 2');
  });

  it('renders plain text bodies without sanitize', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody('plain text body'));
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('plain text body');
    expect(sanitizeCustomHtmlSpy).not.toHaveBeenCalled();
  });

  it('renders the empty placeholder for an empty plain body with no formatted body', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody(''));
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('empty-content');
    expect(sanitizeCustomHtmlSpy).not.toHaveBeenCalled();
  });

  it('renders the plain-text body when customBody is an explicit empty string', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody('plain fallback', ''));
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('plain fallback');
    expect(sanitizeCustomHtmlSpy).not.toHaveBeenCalled();
  });

  it('renders the formatted body even when the plain-text fallback is empty', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderBody('', '<p>formatted only</p>'));
    });

    const json = JSON.stringify(renderer?.toJSON());
    expect(json).toContain('formatted only');
    expect(json).not.toContain('empty-content');
    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['plain content', '<p>streamed <strong>text</strong></p>'],
    ['content with a tool marker', '<p>streamed</p><p>🔧 <code>search</code> [1]</p>'],
  ])('stays memoized through the mindroom marker parser options for %s', (_case, html) => {
    // Mirrors the production composition in renderMindroomMessageContent: content
    // resolved again on every render must keep the parser options, otherwise the
    // RenderBody memo is silently defeated on every render.
    function Body({ content }: { content: Record<string, unknown> }) {
      return (
        <RenderBody
          body={content.body as string}
          customBody={content.formatted_body as string}
          htmlReactParserOptions={useMindroomToolTraceMarkerParserOptions(
            htmlReactParserOptions,
            content
          )}
          linkifyOpts={linkifyOpts}
        />
      );
    }
    const content = () => ({
      msgtype: 'm.text',
      body: 'streamed text',
      format: 'org.matrix.custom.html',
      formatted_body: html,
    });
    const renderThroughWrapper = () => (
      <ClientConfigProvider value={{}}>
        <Body content={content()} />
      </ClientConfigProvider>
    );

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(renderThroughWrapper());
    });
    act(() => {
      renderer?.update(renderThroughWrapper());
    });
    act(() => {
      renderer?.update(renderThroughWrapper());
    });

    expect(sanitizeCustomHtmlSpy).toHaveBeenCalledTimes(1);
  });
});
