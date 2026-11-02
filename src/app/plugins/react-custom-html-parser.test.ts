import React from 'react';
import parse, { Element, HTMLReactParserOptions, domToReact } from 'html-react-parser';
import { Text as DOMText } from 'domhandler';
import { MatrixClient } from 'matrix-js-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from 'react-error-boundary';
import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
  ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodeBlock,
  LINKIFY_OPTS,
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  renderTextWithLatex,
} from './react-custom-html-parser';
import { markerParserOptions } from '../test-utils/markerParserOptions';
import { ToolCallMessageContext } from '../mindroom/messages/toolCallStatus';
import backendToolMarkerBodies from '../mindroom/messages/__fixtures__/backendToolMarkerBodies.json';
import { getRenderedMindroomToolRefs } from '../mindroom/messages/toolRefDom';
import {
  getMessageCopyTexts,
  scanMindroomToolMarkerLines,
} from '../mindroom/messages/messageCopyText';
import { formatMindroomMessageTextBodyAsHtml } from '../mindroom/messages/blocks';
import { sanitizeCustomHtml } from '../utils/sanitize';

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

const approvals = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../mindroom/messages/ThreadApprovalProvider', () => ({
  useThreadApprovals: () => approvals.current,
}));

vi.mock('../utils/dom', async () => {
  const actual = await vi.importActual<typeof import('../utils/dom')>('../utils/dom');
  return {
    ...actual,
    copyToClipboard: clipboardMocks.copyToClipboard,
  };
});

vi.mock('folds', async () => {
  const ReactModule = await import('react');
  const ReactLib = ReactModule.default;
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      ReactLib.createElement(tag, props, children);

  return {
    Box: passthrough('div'),
    Chip: passthrough('span'),
    Spinner: passthrough('span'),
    Header: passthrough('div'),
    Icon: ({ children, ...props }: Record<string, unknown>) =>
      ReactLib.createElement('span', props, children),
    IconButton: passthrough('button'),
    Scroll: passthrough('div'),
    Text: ({ as = 'div', children, truncate, ...props }: Record<string, unknown>) =>
      ReactLib.createElement(
        typeof as === 'string' ? as : 'div',
        {
          ...props,
          'data-truncate': truncate ? 'true' : undefined,
        },
        children
      ),
    config: {
      space: {
        S400: '16px',
      },
    },
    Icons: new Proxy(
      {},
      {
        get: (_, prop) => String(prop),
      }
    ),
    toRem: (value: number) => `${value / 16}rem`,
    Tooltip: passthrough('span'),
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
  };
});

vi.mock('../styles/CustomHtml.css', () => ({
  BlockQuote: 'BlockQuote',
  Heading: 'Heading',
  List: 'List',
  Paragraph: 'Paragraph',
  MarginSpaced: 'MarginSpaced',
  CodeBlock: 'CodeBlock',
  MessageCodeBlock: 'MessageCodeBlock',
  CodeBlockHeader: 'CodeBlockHeader',
  CodeBlockLabel: 'CodeBlockLabel',
  CodeBlockLabelText: 'CodeBlockLabelText',
  CodeBlockLanguageIcon: 'CodeBlockLanguageIcon',
  CodeBlockActions: 'CodeBlockActions',
  CodeBlockAction: 'CodeBlockAction',
  CodeBlockActionIcon: 'CodeBlockActionIcon',
  CodeBlockScroll: 'CodeBlockScroll',
  CodeBlockInternal: 'CodeBlockInternal',
  CodeBlockBottomShadow: 'CodeBlockBottomShadow',
  Code: 'Code',
  Mention: () => 'Mention',
  Spoiler: () => 'Spoiler',
  EmoticonBase: 'EmoticonBase',
  Emoticon: () => 'Emoticon',
  highlightText: 'highlightText',
}));

vi.mock('../mindroom/html/MatrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));

vi.mock('../mindroom/html/ScrollableTable.css', () => ({
  Container: 'TableContainer',
  ScrollArea: 'TableScrollArea',
  Table: 'Table',
  Hint: 'TableHint',
}));

vi.mock('../mindroom/messages/MindroomHtmlBlocks.css', () => ({
  Block: 'MindroomBlock',
  BlockBody: 'MindroomBlockBody',
  BlockChevron: 'MindroomBlockChevron',
  BlockHeader: 'MindroomBlockHeader',
  BlockHeaderMeta: 'MindroomBlockHeaderMeta',
  BlockLabel: 'MindroomBlockLabel',
  BlockInlineResult: 'MindroomBlockInlineResult',
  BlockResult: 'MindroomBlockResult',
  ToolGroupItem: 'MindroomToolGroupItem',
  ToolGroupList: 'MindroomToolGroupList',
  ToolRowHeader: 'MindroomToolRowHeader',
  ToolRowIndex: 'MindroomToolRowIndex',
  ToolRowName: 'MindroomToolRowName',
}));

vi.mock('../mindroom/messages/ApprovalArgumentFields.css', () => ({
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

const createBaseOpts = (): HTMLReactParserOptions => {
  const opts: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (domNode instanceof Element && domNode.name === 'p') {
        return React.createElement('p', null, domToReact(domNode.children, opts));
      }

      return undefined;
    },
  };

  return opts;
};

const renderWithToolTrace = (html: string, content: Record<string, unknown>) => {
  const opts = markerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, parsed));
};

const renderTreeWithToolTrace = (
  html: string,
  content: Record<string, unknown>
): ReactTestRenderer => {
  const opts = markerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(React.Fragment, null, parsed));
  });

  if (!renderer) {
    throw new Error('Failed to create tool trace renderer');
  }

  return renderer;
};

const collectTextContent = (
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null
): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((child) => collectTextContent(child)).join('');

  const self = typeof node.children === 'object' ? collectTextContent(node.children) : '';
  return self;
};

// The group title names its state ("Ran 2 tool calls", "Running 1 tool call", or "Used 2 tools"
// while trace details load); grouping tests only care about the count.
const toolCountLabel = (count: number, flags = '') => {
  const s = count === 1 ? '' : 's';
  return new RegExp(
    `(?:Ran|Running|Denied) ${count} tool call${s}|Used ${count} tool${s}|\\b${count} tool call${s} (?:waiting|expired)`,
    flags
  );
};

describe('CodeBlock clipboard feedback', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    clipboardMocks.copyToClipboard.mockReset();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { setTimeout: globalThis.setTimeout.bind(globalThis) },
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  const renderCodeBlock = () =>
    create(
      React.createElement(CodeBlock, { opts: {} }, [
        new DOMText('copy me'),
      ] as unknown as React.ReactNode)
    );

  const getCopyControl = (renderer: ReactTestRenderer) =>
    renderer.root.find(
      (node) => node.type === 'button' && String(node.props['aria-label']).startsWith('Cop')
    );

  it('shows Copied only after confirmed clipboard success', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    const renderer = renderCodeBlock();

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith('copy me');
    expect(getCopyControl(renderer).props['aria-label']).toBe('Copied');
    renderer.unmount();
  });

  it('keeps Copy visible when every clipboard path fails', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(false);
    const renderer = renderCodeBlock();

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });

    expect(getCopyControl(renderer).props['aria-label']).toBe('Copy code');
    renderer.unmount();
  });
});

describe('CodeBlock header', () => {
  const renderFence = (html: string) => renderCustomHtmlMarkup(html);

  it('shows a known language as its icon, named for assistive technology', () => {
    const markup = renderFence('<pre><code class="language-sh">ls</code></pre>');

    expect(markup).toContain('role="img" aria-label="Language: sh"');
    expect(markup).toContain('data-code-icon="bash"');
  });

  it('labels filenames with the icon of their language', () => {
    const markup = renderFence(
      '<pre><code class="language-tsx" data-label="Greeting.tsx">x</code></pre>'
    );

    expect(markup).toContain('data-code-icon="react"');
    expect(markup).toContain('>Greeting.tsx</span>');
  });

  it('falls back to the language name, or text, without an icon', () => {
    expect(renderFence('<pre><code class="language-elixir">x</code></pre>')).toContain(
      '>elixir</span>'
    );
    expect(renderFence('<pre><code>x</code></pre>')).toContain('>text</span>');
  });

  it('collapses a long wrapped line like a long block', () => {
    const renderer = renderCustomHtmlTree(`<pre><code>${'x'.repeat(2000)}</code></pre>`);
    const expand = () =>
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Expand'
      );

    expect(expand()).toHaveLength(1);
    act(() => {
      renderer.root
        .find((node) => node.type === 'button' && node.props['aria-label'] === 'Wrap lines')
        .props.onClick();
    });
    expect(expand()).toHaveLength(0);
    renderer.unmount();
  });

  it('wraps lines by default and toggles wrapping from the toolbar', () => {
    const renderer = renderCustomHtmlTree('<pre><code>x</code></pre>');
    const pre = () => renderer.root.findByType('pre');
    const wrapButton = () =>
      renderer.root.find(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Wrap lines'
      );

    expect(pre().props['data-wrap']).toBe(true);
    expect(wrapButton().props['aria-pressed']).toBe(true);

    act(() => {
      wrapButton().props.onClick();
    });

    expect(pre().props['data-wrap']).toBe(false);
    expect(wrapButton().props['aria-pressed']).toBe(false);
    renderer.unmount();
  });
});

describe('fenced code syntax highlighting', () => {
  it('hands fenced code to the Prism highlighter', () => {
    const renderer = renderCustomHtmlTree(
      '<pre><code class="language-js">const a = 1;</code></pre>'
    );

    expect(renderer.root.findAllByType(ErrorBoundary)).toHaveLength(1);
    expect(collectTextContent(renderer.toJSON())).toContain('const a = 1;');
    renderer.unmount();
  });

  const renderSearch = (html: string) => {
    const opts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts: LINKIFY_OPTS,
      highlightRegex: /const/gi,
    });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(React.Fragment, null, parse(html, opts)));
    });
    return renderer!;
  };

  it('shows search matches instead of syntax colors in a matching block', () => {
    const renderer = renderSearch('<pre><code class="language-js">const a = 1;</code></pre>');

    expect(renderer.root.findAllByType(ErrorBoundary)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'highlightText' })).toHaveLength(1);
    renderer.unmount();
  });

  it('keeps syntax colors in blocks without a search match', () => {
    const renderer = renderSearch('<pre><code class="language-js">let a = 1;</code></pre>');

    expect(renderer.root.findAllByType(ErrorBoundary)).toHaveLength(1);
    renderer.unmount();
  });
});

const renderCustomHtmlTree = (html: string, mx = {} as MatrixClient): ReactTestRenderer => {
  const opts = getReactCustomHtmlParser(mx, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });
  const parsed = parse(html, opts);
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(React.Fragment, null, parsed));
  });

  if (!renderer) {
    throw new Error('Failed to create HTML renderer');
  }

  return renderer;
};

const renderCustomHtmlMarkup = (html: string, mx = {} as MatrixClient): string => {
  const opts = getReactCustomHtmlParser(mx, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });
  const parsed = parse(html, opts);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, parsed));
};

const renderLatexTextMarkup = (text: string): string =>
  renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderTextWithLatex(text, {
        linkify: true,
        linkifyOpts: LINKIFY_OPTS,
        keyPrefix: 'test',
      })
    )
  );

describe('inline website favicons', () => {
  const renderLinks = (html: string, enabled = true) => {
    const linkifyOpts = {
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention(() => undefined, enabled),
    };
    const opts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts,
      showLinkFavicons: enabled,
    });
    return renderToStaticMarkup(React.createElement(React.Fragment, null, parse(html, opts)));
  };

  it('uses the same cached site icon for plain and formatted links without exposing paths', () => {
    const markup = renderLinks(
      '<p>https://github.com/example/one?secret=value <a href="https://github.com/example/two#part" title="Read docs"><strong>Docs</strong></a></p>'
    );
    expect(markup.match(/src="https:\/\/icons.duckduckgo.com\/ip3\/github.com.ico"/g)).toHaveLength(
      2
    );
    expect(markup).toContain('title="Read docs"');
    expect(markup).toContain('<strong>Docs</strong>');
    expect(markup).toContain('href="https://github.com/example/two#part"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('alt=""');
  });

  it('does not load favicons when previews are disabled', () => {
    expect(
      renderLinks('<p>https://github.com <a href="https://example.com">Example</a></p>', false)
    ).not.toContain('<img');
  });

  it.each([
    '<span data-mx-spoiler><a href="https://secret.example.com">Secret site</a></span>',
    '<span data-mx-spoiler>https://secret.example.com</span>',
    '<span data-mx-spoiler><strong>https://secret.example.com</strong></span>',
    '<span data-mx-spoiler data-mx-maths="{">https://secret.example.com</span>',
    '<a href="https://secret.example.com"><span data-mx-spoiler>Secret site</span></a>',
    '<a href="https://secret.example.com"><strong><span data-mx-spoiler>Secret site</span></strong></a>',
  ])('does not mount an icon for a link involving spoiler text: %s', (html) => {
    const markup = renderLinks(html);
    expect(markup).toContain('https://secret.example.com');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('icons.duckduckgo.com');
  });

  it('preserves custom math rendering inside a spoiler', () => {
    const markup = renderLinks('<span data-mx-spoiler data-mx-maths="x^2">fallback</span>');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('class="MathInline"');
    expect(markup).toContain('katex');
  });

  it('keeps code and Matrix mentions free of website icons', () => {
    expect(
      renderLinks('<code>https://github.com</code><pre>https://example.com</pre>')
    ).not.toContain('<img');
    const mention = factoryRenderLinkifyWithMention(
      () => React.createElement('a', { 'data-mention-id': '@alice:example.com' }, 'Alice'),
      true
    ) as (ir: unknown) => React.ReactElement;
    const markup = renderToStaticMarkup(
      mention({
        tagName: 'a',
        attributes: { href: 'https://matrix.to/#/@alice:example.com' },
        content: 'Alice',
      })
    );
    expect(markup).toContain('data-mention-id');
    expect(markup).not.toContain('<img');
  });
});

const collectStructuralTableWhitespace = (
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
  tags = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'])
): string[] => {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectStructuralTableWhitespace(child, tags));
  }

  const current =
    tags.has(node.type) && node.children
      ? node.children.flatMap((child) =>
          typeof child === 'string' && child.trim().length === 0 ? [node.type] : []
        )
      : [];

  const nested = node.children ? collectStructuralTableWhitespace(node.children, tags) : [];
  return current.concat(nested);
};

// Text of the expanded tool row for the marker's index ([1], [2], ...).
type TextNode = { children: (TextNode | string)[] } | string;
const nodeText = (node: TextNode): string =>
  typeof node === 'string' ? node : node.children.map(nodeText).join('');
const toolRowText = (renderer: ReturnType<typeof renderTreeWithToolTrace>, index: number) =>
  nodeText(
    renderer.root.find(
      (node) => typeof node.type === 'string' && node.props['data-tool-index'] === index
    )
  );

describe('tool call status from approval cards', () => {
  afterEach(() => {
    approvals.current = undefined;
  });

  const renderInMessage = (eventId: string) => {
    const html =
      '<p>🔧 <code>send_email</code> [1]</p><p>🔧 <code>run_shell_command</code> [2]</p>';
    const opts = markerParserOptions(createBaseOpts(), {
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_started', tool_name: 'send_email' },
          { type: 'tool_call_completed', tool_name: 'run_shell_command' },
        ],
      },
    });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(ToolCallMessageContext.Provider, { value: eventId }, parse(html, opts))
      );
    });
    return renderer as ReactTestRenderer;
  };

  it('says the group waits for approval, from the cards MindRoom posted for this reply', () => {
    const card = (toolName: string, status: string) => ({
      eventId: `$${toolName}`,
      sender: '@mindroom_router:example.org',
      wireStatus: status,
      approval: {
        toolName,
        status,
        responseEventId: '$reply',
        expiresAt: '2999-01-01T00:00:00Z',
      },
    });
    approvals.current = {
      records: [card('send_email', 'pending'), card('run_shell_command', 'denied')],
      now: Date.now(),
    };
    expect(collectTextContent(renderInMessage('$reply').toJSON())).toContain(
      '1 tool call waiting for approval'
    );
  });

  it('reads the trace alone outside a thread with approvals', () => {
    expect(collectTextContent(renderInMessage('$reply').toJSON())).toContain(
      'Running 2 tool calls'
    );
  });
});

describe('useMindroomToolTraceMarkerParserOptions', () => {
  it.each(['', '\n  '])(
    'preserves custom rendering after tool groups separated by %j',
    (separator) => {
      const html = [
        '<p>🔧 <code>first_tool</code> [1]</p>',
        '<p>🔧 <code>second_tool</code> [2]</p>',
        '<table><thead><tr><th>Project</th><th>Status</th></tr></thead><tbody><tr><td>Sample</td><td>Ready</td></tr></tbody></table>',
      ].join(separator);
      const baseOpts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
        linkifyOpts: LINKIFY_OPTS,
      });
      const opts = markerParserOptions(baseOpts, { formatted_body: html });
      const markup = renderToStaticMarkup(
        React.createElement(React.Fragment, null, parse(html, opts))
      );

      expect(markup).toContain('class="TableContainer"');
      expect(markup).toContain('class="TableScrollArea"');
      expect(markup).toContain('<table class="Table">');
      expect(markup).toContain('<td>Sample</td>');
      expect(markup.match(toolCountLabel(2, 'g'))).toHaveLength(1);
      expect(markup).not.toContain('🔧');
    }
  );

  it('preserves shared paragraph styling immediately after a tool group', () => {
    const html = [
      '<p>🔧 <code>first_tool</code> [1]</p>',
      '<p>🔧 <code>second_tool</code> [2]</p>',
      '<p>Results are ready.</p>',
    ].join('');
    const baseOpts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts: LINKIFY_OPTS,
    });
    const opts = markerParserOptions(baseOpts, { formatted_body: html });
    const markup = renderToStaticMarkup(
      React.createElement(React.Fragment, null, parse(html, opts))
    );

    expect(markup).toContain('class="Paragraph MarginSpaced"');
    expect(markup).toContain('Results are ready.');
    expect(markup).not.toContain('🔧');
  });

  it('renders tool blocks for marker-only content and enriches them with trace metadata', () => {
    const html = '<p>🔧 <code>search_web</code> [1]</p>';

    const previewMarkup = renderWithToolTrace(html, {
      body: 'preview',
      formatted_body: html,
    });
    expect(previewMarkup).toMatch(toolCountLabel(1));
    expect(previewMarkup).not.toContain('🔧');

    const hydratedMarkup = renderWithToolTrace(html, {
      body: 'full response',
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    });
    expect(hydratedMarkup).toMatch(toolCountLabel(1));
  });

  it('summarizes tool calls and lists each with its arguments and result', () => {
    const html = '<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>read_file</code> [2]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'web_search',
            args_preview: 'query=MindRoom release notes, max_results=5',
            result_preview: '5 results',
          },
          {
            type: 'tool_call_started',
            tool_name: 'read_file',
            args_preview: 'reading the changelog',
          },
        ],
      },
    });

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toMatch(toolCountLabel(2));
    expect(collapsed).toContain('web_search, read_file');

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });

    const rows = renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props['data-tool-index'] !== undefined
    );
    expect(rows.map((row) => row.props['data-tool-index'])).toEqual([1, 2]);
    const textOf = (row: typeof rows[number]) =>
      row
        .findAll(() => true)
        .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
        .join(' ');
    expect(rows[0].findAllByType('dt').map((node) => node.children.join(''))).toEqual([
      'query',
      'max_results',
    ]);
    expect(textOf(rows[0])).toContain('MindRoom release notes');
    expect(textOf(rows[0])).toContain('5 results');
    expect(rows[1].findAll((node) => node.props.variant === 'Secondary')).not.toHaveLength(0);
    expect(rows[1].findByType('pre').children.join('')).toBe('reading the changelog');
  });

  it('shows the last lines of a running call output under the collapsed tool calls', () => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const output = Array.from({ length: 10 }, (_, i) => `step ${i + 1}`).join('\n');
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'run_shell_command', progress: output }],
      },
    });

    const text = collectTextContent(renderer.toJSON());
    expect(text).toMatch(toolCountLabel(1));
    expect(text).toContain('step 5');
    expect(text).toContain('step 10');
    expect(text).not.toContain('step 4');
  });

  it('keeps the indentation of a running call output first line', () => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_started',
            tool_name: 'run_shell_command',
            progress: '  root:\n    child: 1\n',
          },
        ],
      },
    });

    const [output] = renderer.root.findAll((node) => node.props.className === 'activity-output');
    expect(output.children.join('')).toBe('  root:\n    child: 1');
  });

  it('drops leading blank lines of a running call output', () => {
    const html = '<p>🔧 <code>run_subagent</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_started',
            tool_name: 'run_subagent',
            progress: '\r\n\nCalling write_report\n  writing',
          },
        ],
      },
    });

    const [output] = renderer.root.findAll((node) => node.props.className === 'activity-output');
    expect(output.children.join('')).toBe('Calling write_report\n  writing');
  });

  it('names the call whose output shows only while several calls run', () => {
    const html =
      '<p>🔧 <code>run_shell_command</code> [1]</p><p>🔧 <code>run_shell_command</code> [2]</p>';
    const started = (args: string, progress?: string) => ({
      type: 'tool_call_started',
      tool_name: 'run_shell_command',
      args_preview: args,
      progress,
    });
    const labels = (events: object[]) =>
      renderTreeWithToolTrace(html, { 'io.mindroom.tool_trace': { version: 2, events } })
        .root.findAll((node) => node.props.className === 'activity-output-label')
        .map((node) => node.children.join(''));

    expect(labels([started('pytest'), started('npm run build', 'compiling')])).toEqual([
      'run_shell_command(npm run build)',
    ]);
    expect(
      labels([
        { type: 'tool_call_completed', tool_name: 'run_shell_command', result_preview: 'ok' },
        started('npm run build', 'compiling'),
      ])
    ).toEqual([]);
  });

  it('drops a call output once the call completed', () => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'run_shell_command',
            result_preview: 'built',
            progress: 'step 1',
          },
        ],
      },
    });

    expect(collectTextContent(renderer.toJSON())).not.toContain('step 1');
  });

  it('expands marker-only tool refs with the marker tool name', () => {
    const markerHtml = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(markerHtml, { formatted_body: markerHtml });

    expect(collectTextContent(renderer.toJSON())).toMatch(toolCountLabel(1));

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(toolRowText(renderer, 1)).toContain('run_shell_command');
    expect(renderer.root.findAll((node) => node.props.src === 'Check')).not.toHaveLength(0);
    expect(expanded).not.toContain('🔧');
  });

  it('groups consecutive markers into one tool-calls block', () => {
    const renderer = renderTreeWithToolTrace(
      [
        '<p>🔧 <code>tool1</code> [1]</p>',
        '<p>🔧 <code>tool2</code> [2]</p>',
        '<p>🔧 <code>tool3</code> [3]<br/>Done</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            { type: 'tool_call_completed', tool_name: 'first_tool', result_preview: 'FIRST' },
            { type: 'tool_call_started', tool_name: 'second_tool' },
            { type: 'tool_call_completed', tool_name: 'third_tool', result_preview: 'THIRD' },
          ],
        },
      }
    );

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toMatch(toolCountLabel(3));
    expect(renderer.root.findAllByType('button')).toHaveLength(1);

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(toolRowText(renderer, 1)).toContain('first_tool');
    expect(expanded).toContain('FIRST');
    expect(toolRowText(renderer, 2)).toContain('second_tool');
    expect(toolRowText(renderer, 3)).toContain('third_tool');
    expect(
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.props['data-tool-index'] !== undefined
      )
    ).toHaveLength(3);
    expect(expanded).toContain('THIRD');
    expect(expanded).toContain('Done');
  });

  it('does not merge marker-prefix paragraphs when each has trailing text', () => {
    const markup = renderWithToolTrace(
      [
        '<p>🔧 <code>run_shell_command</code> [1]<br/>Now let me find one</p>',
        '<p>🔧 <code>run_shell_command</code> [2]<br/>Now let me find two</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            {
              type: 'tool_call_completed',
              tool_name: 'run_shell_command',
              result_preview: 'FIRST',
            },
            { type: 'tool_call_started', tool_name: 'run_shell_command' },
          ],
        },
      }
    );

    expect(markup).not.toMatch(toolCountLabel(2));
    expect(markup.match(toolCountLabel(1, 'g'))).toHaveLength(2);
    expect(markup).toContain('Now let me find one');
    expect(markup).toContain('Now let me find two');
    expect(markup).not.toContain('🔧');
  });

  it('preserves trailing content after a marker prefix, including br and text', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3]<br/>Done</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_completed', tool_name: 'tool3', result_preview: 'third result' },
        ],
      },
    });

    expect(markup).toContain('<p>Done</p>');
    expect(markup).toContain('Done');
  });

  it('renders and copies a paragraph of many markers without recursing per marker', () => {
    const count = 3_000;
    const markers = Array.from({ length: count }, (_, index) => `🔧 <code>t</code> [${index + 1}]`);
    const html = `<p>${markers.join('<br>')}<br>Done</p>`;
    const opts = markerParserOptions(createBaseOpts(), {
      formatted_body: html,
    });

    // Each marker used to parse the rest of its paragraph one level deeper,
    // which overflowed the stack for a long paragraph.
    const parsed = parse(html, opts) as React.ReactElement;
    const shown = React.Children.toArray(parsed.props.children);
    const toolBlocks = shown.filter(
      (node) =>
        React.isValidElement<{ parsedTools?: unknown }>(node) &&
        Array.isArray(node.props.parsedTools)
    );
    expect(toolBlocks).toHaveLength(count);
    expect(renderToStaticMarkup(shown[shown.length - 1] as React.ReactElement)).toBe('<p>Done</p>');
    expect(getRenderedMindroomToolRefs(html).toolBlocks).toHaveLength(count);
  });

  it('consumes pending hourglass as part of the marker and does not render it as trailing text', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3] ⏳<br/>Waiting</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_started', tool_name: 'tool3' },
        ],
      },
    });

    expect(markup).toMatch(toolCountLabel(1));
    expect(markup).toContain('<p>Waiting</p>');
    expect(markup).not.toContain('⏳');
  });

  it('drops boundary br on the immediate paragraph after grouped tool markers', () => {
    const markup = renderWithToolTrace(
      [
        '<p>🔧 <code>matrix_message</code> [1]</p>',
        '<p><br/>No magic - just dropping old turns when the window fills up.</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [{ type: 'tool_call_completed', tool_name: 'matrix_message' }],
        },
      }
    );

    expect(markup).toMatch(toolCountLabel(1));
    expect(markup).toContain('<p>No magic - just dropping old turns when the window fills up.</p>');
    expect(markup).not.toContain('<p><br/>No magic');
  });

  it('does not leak a raw hourglass for a standalone pending marker paragraph', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3] ⏳</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_started', tool_name: 'tool3' },
        ],
      },
    });

    expect(markup).toMatch(toolCountLabel(1));
    expect(markup).not.toContain('⏳');
  });

  it('renders single tool call using group path with Tool #1 label', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>search_web</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Found it' },
        ],
      },
    });

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toMatch(toolCountLabel(1));

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(toolRowText(renderer, 1)).toContain('search_web');
    expect(expanded).toContain('Found it');
  });

  it('shows pending badge in collapsed header for single pending tool', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>search_web</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'search_web' }],
      },
    });

    const header = renderer.root.findByType('button');
    const headerSpans = header.findAllByType('span');
    const spinnerSpan = headerSpans.find(
      (s) => s.props.size === '50' && s.props.variant === 'Secondary'
    );
    expect(spinnerSpan).toBeDefined();

    const completedRenderer = renderTreeWithToolTrace('<p>🔧 <code>search_web</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    });

    const completedHeader = completedRenderer.root.findByType('button');
    const completedSpans = completedHeader.findAllByType('span');
    const completedSpinnerSpan = completedSpans.find(
      (s) => s.props.size === '50' && s.props.variant === 'Secondary'
    );
    expect(completedSpinnerSpan).toBeUndefined();

    // A finished group shows a check, as each finished row does.
    const checkIcon = completedSpans.find((s) => s.props.src === 'Check');
    expect(checkIcon).toBeDefined();
  });

  it('shows single-line inline result inside expanded body for copyability', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>tool3</code> [3]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_completed', tool_name: 'tool3', result_preview: 'Single-line output' },
        ],
      },
    });

    expect(collectTextContent(renderer.toJSON())).not.toContain('Single-line output');

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    // The result shows on one line and opens to its full text when selected.
    const result = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-expanded'] === false
    );
    expect(result.children.join('')).toContain('Single-line output');
  });
});

describe('getReactCustomHtmlParser', () => {
  it('renders Matrix user links as mentions only outside inline and fenced code', () => {
    const userId = '@alice:example.org';
    const matrixTo = `https://matrix.to/#/${userId}`;
    const mx = {
      getRoom: vi.fn(() => undefined),
      getUserId: vi.fn(() => '@viewer:example.org'),
    } as unknown as MatrixClient;

    const plainMarkup = renderCustomHtmlMarkup(`<p><a href="${matrixTo}">${userId}</a></p>`, mx);
    expect(plainMarkup).toContain(`href="${matrixTo}"`);
    expect(plainMarkup).toContain(`data-mention-id="${userId}"`);

    for (const codeTree of [
      renderCustomHtmlTree(`<p><code><a href="${matrixTo}">${userId}</a></code></p>`, mx),
      renderCustomHtmlTree(`<pre><code><a href="${matrixTo}">${userId}</a></code></pre>`, mx),
    ]) {
      expect(collectTextContent(codeTree.toJSON())).toContain(userId);
      expect(codeTree.root.findAllByType('a')).toHaveLength(0);
      codeTree.unmount();
    }
  });

  it('copies the literal Matrix user ID from fenced code', async () => {
    const userId = '@alice:example.org';
    const matrixTo = `https://matrix.to/#/${userId}`;
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(false);

    const codeTree = renderCustomHtmlTree(
      `<pre><code><a href="${matrixTo}">${userId}</a></code></pre>`
    );
    const copyControl = codeTree.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Copy code'
    );

    await act(async () => {
      await copyControl.props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(userId);
    codeTree.unmount();
  });

  it('preserves intentional Matrix-link labels inside code and Copy', async () => {
    const matrixTo = 'https://matrix.to/#/@alice:example.org';
    const customLabel = 'lookup_user()';
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(false);

    const codeTree = renderCustomHtmlTree(
      `<pre><code><a href="${matrixTo}">${customLabel}</a></code></pre>`
    );
    const copyControl = codeTree.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Copy code'
    );

    expect(collectTextContent(codeTree.toJSON())).toContain(customLabel);
    expect(codeTree.root.findAllByType('a')).toHaveLength(0);

    await act(async () => {
      await copyControl.props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(customLabel);
    codeTree.unmount();
  });

  it('drops whitespace-only text nodes in table structure while preserving cell content', () => {
    const renderer = renderCustomHtmlTree(`
      <table>
        <thead>
          <tr>
            <th>Heading</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>https://example.com</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(collectStructuralTableWhitespace(renderer.toJSON())).toEqual([]);
    expect(
      renderer.root.findAllByType('a').some((node) => node.props.href === 'https://example.com')
    ).toBe(true);
  });

  it('renders incoming Matrix math html with KaTeX wrappers', () => {
    const markup = renderCustomHtmlMarkup(
      '<p><span data-mx-maths="x^2">x^2</span></p><div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div>'
    );

    expect(markup).toContain('MathInline');
    expect(markup).toContain('MathBlock');
    expect(markup).toContain('katex');
  });

  it('preserves escaped delimiters inside backtick spans in raw text', () => {
    const markup = renderLatexTextMarkup('`\\$x\\$`');

    expect(markup).toContain('`\\$x\\$`');
    expect(markup).not.toContain('MathInline');
  });

  it('does not render currency-like inline delimiters as math in raw text', () => {
    const markup = renderLatexTextMarkup('Inline $E = mc^2$ and $5+$10$ plus \\$escaped\\$');

    expect(markup).toContain('katex');
    expect(markup).toContain('$5+$10$');
    expect(markup).toContain('$escaped$');
    expect(markup.match(/MathInline/g)).toHaveLength(1);
  });

  it('does not render formatted currency amounts as math in raw text', () => {
    const markup = renderLatexTextMarkup(
      '$1234$ and $1,000.00$ and $1.000,00$ and $5 USD$ and $19.99/mo$'
    );

    expect(markup).toContain('$1234$');
    expect(markup).toContain('$1,000.00$');
    expect(markup).toContain('$1.000,00$');
    expect(markup).toContain('$5 USD$');
    expect(markup).toContain('$19.99/mo$');
    expect(markup).not.toContain('MathInline');
  });

  it('does not render currency ranges as math in raw text', () => {
    const markup = renderLatexTextMarkup('$5-10$ and $5–10$ and $5-$10$');

    expect(markup).toContain('$5-10$');
    expect(markup).toContain('$5–10$');
    expect(markup).toContain('$5-$10$');
    expect(markup).not.toContain('MathInline');
  });

  it('renders numeric-leading expressions as math in raw text', () => {
    const markup = renderLatexTextMarkup('$2sin(x)$');

    expect(markup).toContain('MathInline');
    expect(markup).toContain('katex');
  });

  it('scales emoji in text but not inside URLs', () => {
    const markup = renderLatexTextMarkup('✅ https://example.org/✅ ✅');

    expect(markup.match(/Emoticon"/g)).toHaveLength(2);
    expect(markup).toContain('https://example.org/✅');
  });

  it('does not split URLs that contain dollar delimiters', () => {
    const markup = renderLatexTextMarkup('https://example.com/$x$/y');

    expect(markup).toContain('href="https://example.com/$x$/y"');
    expect(markup).not.toContain('MathInline');
  });

  it('renders raw display latex blocks from text nodes', () => {
    const markup = renderLatexTextMarkup('$$\\frac{a}{b}$$');

    expect(markup).toContain('MathBlock');
    expect(markup).toContain('katex-display');
  });
});

// Copy may strip marker lines only when the app renders exactly those markers as
// tool blocks and shows nothing of them elsewhere; check against the real renderer.
describe('copy stripping matches the app renderer', () => {
  // The renderer shows these markers but detection conservatively skips them:
  // names holding another index, and (in sender HTML only, since the plain-body
  // fallback escapes HTML) markers nested in wrappers the base parser leaves alone.
  const knownDetectionGaps = new Set(['tool name containing another index']);
  const knownFormattedBodyGaps = new Set([
    'tool call inside a raw div',
    'tool call inside a details block',
  ]);

  // Everything the app shows as text outside tool blocks, including HTML it
  // injects directly, such as KaTeX output.
  const textOutsideToolBlocks = (node: ReactTestInstance | string): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node.props?.parsedTools)) return '';
    const injected = node.props?.dangerouslySetInnerHTML?.__html;
    return (
      (typeof injected === 'string' ? injected.replace(/<[^>]*>/g, '') : '') +
      node.children.map(textOutsideToolBlocks).join('')
    );
  };

  const expectCopyMatchesRender = async (
    name: string,
    body: string,
    formattedBody: string | undefined,
    renderedHtml: string
  ) => {
    const html = sanitizeCustomHtml(renderedHtml);
    const baseOpts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts: LINKIFY_OPTS,
    });
    const opts = markerParserOptions(baseOpts, {
      body,
      formatted_body: renderedHtml,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(React.Fragment, null, parse(html, opts)));
    });
    const renderedToolIndexes = renderer.root
      .findAll((node) => Array.isArray(node.props?.parsedTools))
      .flatMap((node) =>
        (node.props.parsedTools as Array<{ index: number }>).map((tool) => tool.index)
      );
    const shownText = textOutsideToolBlocks(renderer.root);
    renderer.unmount();

    // Repeated indexes render once as a block and again as text, so compare sets.
    const plainBodyFallback = formattedBody === undefined;
    const detected = new Set(
      getRenderedMindroomToolRefs(html).toolBlocks.map(({ index }) => index)
    );
    const rendered = new Set(renderedToolIndexes);
    detected.forEach((index) => expect(rendered.has(index)).toBe(true));
    if (knownDetectionGaps.has(name) || (!plainBodyFallback && knownFormattedBodyGaps.has(name))) {
      expect(detected.size).toBeLessThan(rendered.size);
    } else {
      expect(detected.size).toBe(rendered.size);
    }

    const scan = scanMindroomToolMarkerLines(body, formattedBody, plainBodyFallback);
    if (!scan) return;
    // Stripped lines are exactly the tool blocks, and nothing of them is shown
    // as text: no 🔧, and no ⏳ beyond what the copy keeps.
    const stripped = scan.toolRefs.filter(Boolean).map((toolRef) => toolRef?.index);
    expect(stripped.sort()).toEqual([...renderedToolIndexes].sort());
    expect(shownText).not.toContain('🔧');
    const { text } = getMessageCopyTexts({ body, formattedBody, plainBodyFallback }, scan);
    expect(shownText.split('⏳').length).toBe(text.split('⏳').length);
  };

  it.each(Object.entries(backendToolMarkerBodies))(
    'backend formatted_body: %s',
    async (name, { body, formatted_body: formattedBody }) => {
      await expectCopyMatchesRender(name, body, formattedBody, formattedBody);
    }
  );

  it.each(Object.entries(backendToolMarkerBodies))(
    'plain-body fallback: %s',
    async (name, { body }) => {
      const fallbackHtml = formatMindroomMessageTextBodyAsHtml(body);
      if (fallbackHtml) await expectCopyMatchesRender(name, body, undefined, fallbackHtml);
    }
  );

  // Hand-written events whose shown text comes from attributes; no MindRoom
  // sender produces them, but copy must still keep the attribute-shown line.
  it.each([
    [
      'KaTeX block rendered from an attribute',
      '$$\n🔧 `x` [1]\n$$\n\n&#x1F527; `x` [1]',
      '<div data-mx-maths="🔧 `x` [1]"></div><p>🔧 <code>x</code> [1]</p>',
    ],
    [
      'inline KaTeX rendered from an attribute',
      'Formula:\n🔧 `x` [1]\n\n&#x1F527; `x` [1]',
      '<p>Formula: <span data-mx-maths="🔧 `x` [1]"></span></p><p>🔧 <code>x</code> [1]</p>',
    ],
    [
      'code-block label rendered from an attribute',
      '🔧 `x` [1]\n\n&#x1F527; `x` [1]',
      '<pre><code data-label="🔧 `x` [1]">code</code></pre><p>🔧 <code>x</code> [1]</p>',
    ],
  ])('crafted formatted_body: %s', async (name, body, formattedBody) => {
    expect(scanMindroomToolMarkerLines(body, formattedBody, false)).toBeUndefined();
    await expectCopyMatchesRender(name, body, formattedBody, formattedBody);
  });
});
