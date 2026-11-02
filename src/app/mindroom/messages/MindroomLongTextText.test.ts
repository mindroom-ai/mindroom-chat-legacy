import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../../types/matrix/common';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { trimReplyFromBody } from '../../utils/room';
import { MINDROOM_MESSAGE_EXTRAS_KEY, parseMindroomMessageExtras } from './messageExtrasData';
import { clearMindroomLongTextHydrationCache, MindroomLongTextSource } from './longText';

const matrixMocks = vi.hoisted(() => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  networkBody: vi.fn(),
  mxcUrlToHttp: vi.fn(),
}));
const longTextMocks = vi.hoisted(() => ({
  hydrateMindroomLongTextSource: vi.fn(),
}));
const hookMocks = vi.hoisted(() => ({
  mx: {
    getAccessToken: vi.fn(() => undefined),
    getHomeserverUrl: vi.fn(() => 'https://example.org'),
    getSafeUserId: vi.fn(() => '@alice:example.org'),
    getVersions: async () => ({ versions: ['v1.11'], unstable_features: {} }),
  },
}));

vi.mock('../../utils/matrix', () => ({
  decryptFile: matrixMocks.decryptFile,
  downloadEncryptedMedia: matrixMocks.downloadEncryptedMedia,
  mxcUrlToHttp: matrixMocks.mxcUrlToHttp,
}));
vi.mock('./longText', async () => {
  const actual = await vi.importActual<typeof import('./longText')>('./longText');
  return {
    ...actual,
    hydrateMindroomLongTextSource: longTextMocks.hydrateMindroomLongTextSource,
  };
});
vi.mock('../../components/message/content', () => ({
  MessageEmptyContent: () => React.createElement('span', { 'data-testid': 'empty-content' }),
}));
vi.mock('../../components/message', async () => {
  const { RenderBody } = await vi.importActual<
    typeof import('../../components/message/RenderBody')
  >('../../components/message/RenderBody');

  return {
    BrokenContent: () => React.createElement('span', { 'data-testid': 'broken-content' }),
    MEmote: () => null,
    MNotice: () => null,
    MText: () => null,
    RenderBody,
  };
});
vi.mock('../../components/message/MsgTypeRenderers', () => ({
  MEmote: () => null,
  MNotice: () => null,
  MText: ({
    content,
    renderAfterBody,
    renderBody,
  }: {
    content: Record<string, unknown>;
    renderAfterBody?: React.ReactNode;
    renderBody: (props: { body: string; customBody?: string }) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'long-text-body' },
      renderBody({
        body: trimReplyFromBody(typeof content.body === 'string' ? content.body : ''),
        customBody: typeof content.formatted_body === 'string' ? content.formatted_body : undefined,
      }),
      renderAfterBody
    ),
}));
vi.mock('folds', () => ({
  Box: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('div', props, children as React.ReactNode),
  Icon: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('span', props, children as React.ReactNode),
  Icons: new Proxy(
    {},
    {
      get: (_, prop) => String(prop),
    }
  ),
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({ as = 'div', children, ...props }: Record<string, unknown>) =>
    React.createElement(typeof as === 'string' ? as : 'div', props, children as React.ReactNode),
  config: {
    space: {
      S100: '4px',
    },
  },
}));
vi.mock('../../styles/CustomHtml.css', () => ({
  Paragraph: 'Paragraph',
  MarginSpaced: 'MarginSpaced',
}));
vi.mock('../html/MatrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));

vi.mock('../html/ScrollableTable.css', () => ({
  Container: 'TableContainer',
  ScrollArea: 'TableScrollArea',
  Table: 'Table',
  Hint: 'TableHint',
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
  Block: 'MindroomBlock',
  BlockBody: 'MindroomBlockBody',
  BlockChevron: 'BlockChevron',
  BlockHeader: 'MindroomBlockHeader',
  BlockHeaderMeta: 'MindroomBlockHeaderMeta',
  BlockLabel: 'MindroomBlockLabel',
  BlockInlineResult: 'MindroomBlockInlineResult',
  BlockResult: 'MindroomBlockResult',
  ToolGroupItem: 'MindroomToolGroupItem',
  ToolGroupList: 'MindroomToolGroupList',
  ToolRowHeader: 'ToolRowHeader',
  ToolRowIndex: 'ToolRowIndex',
  ToolRowName: 'ToolRowName',
}));
vi.mock('../threads/CollapsibleMessage.css', () => ({
  CollapsibleContent: () => 'collapsible-content',
  CollapsibleContainer: 'collapsible-container',
  CollapsibleFooter: 'collapsible-footer',
  CollapsibleStickyFooter: 'collapsible-sticky-footer',
  CollapsiblePill: 'collapsible-pill',
}));
vi.mock('./MindroomMessageExtras', () => ({
  MindroomMessageExtras: () => null,
}));
vi.mock('./MindroomPasteAttachmentContent', () => ({
  MindroomPasteAttachmentContent: () => null,
}));
vi.mock('./MindroomThinkingPlaceholder', () => ({
  MindroomThinkingPlaceholder: () => null,
}));
vi.mock('./MindroomTranscribingPlaceholder', () => ({
  MindroomTranscribingPlaceholder: () => null,
}));
vi.mock('./MindroomThreadSummaryCard', () => ({
  MindroomThreadSummaryCard: () => null,
}));
vi.mock('./MindroomToolApprovalCard', () => ({
  MindroomToolApprovalCard: () => null,
}));
vi.mock('./StreamingIndicator', () => ({
  renderMindroomStreamingIndicator: () => null,
}));
vi.mock('./messageStateSuffix', () => ({
  getMindroomMessageStateSuffixRenderer: () => undefined,
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => hookMocks.mx,
}));

const getDownloadMindroomLongTextSidecarText = async () =>
  (await import('./longTextDownload')).downloadMindroomLongTextSidecarText;
const getDownloadMindroomLongTextSidecarBlob = async () =>
  (await import('./longTextDownload')).downloadMindroomLongTextSidecarBlob;
const getMindroomLongTextTextModule = async () => import('./MindroomLongTextText');
const getShouldResetResolvedContentToPreview = async () =>
  (await import('./MindroomLongTextText')).shouldResetResolvedContentToPreview;
const mockMx = hookMocks.mx as MatrixClient;

const createLongTextSource = (
  overrides: Partial<MindroomLongTextSource> = {}
): MindroomLongTextSource => ({
  previewContent: {
    msgtype: 'm.file',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  },
  mxcUri: 'mxc://server/content',
  isV2ContentJson: true,
  ...overrides,
});

const createPreviewContent = () => ({
  body: 'Preview response',
  info: { mimetype: 'application/json' },
  msgtype: 'm.text',
  url: 'mxc://server/content',
  'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
});

const createMessageExtras = (content: string) => ({
  version: 1,
  sections: [{ title: 'Evidence', content_type: 'text/plain', content }],
});

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

const renderMindroomLongTextText = async (
  content: Record<string, unknown>
): Promise<{
  renderer: ReactTestRenderer;
  update: (nextContent: Record<string, unknown>) => Promise<void>;
}> => {
  const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
  let renderer!: ReactTestRenderer;

  const render = (nextContent: Record<string, unknown>) =>
    React.createElement(MindroomLongTextText, {
      kind: MindroomLongTextKind.Text,
      content: nextContent,
      longTextSource: createLongTextSource({ previewContent: nextContent }),
      renderBody: () => null,
    });

  await act(async () => {
    renderer = create(render(content));
  });

  return {
    renderer,
    update: async (nextContent) => {
      await act(async () => {
        renderer.update(render(nextContent));
      });
    },
  };
};

const renderResolvedContentProbe = async (
  source: MindroomLongTextSource | undefined,
  enabled: boolean
): Promise<{
  onResolvedContent: ReturnType<typeof vi.fn>;
  renderer: ReactTestRenderer;
  update: (nextSource: MindroomLongTextSource | undefined, nextEnabled: boolean) => Promise<void>;
}> => {
  const { useMindroomLongTextResolvedContent } = await getMindroomLongTextTextModule();
  const onResolvedContent = vi.fn();
  let renderer!: ReactTestRenderer;

  const Probe = ({
    nextSource,
    nextEnabled,
  }: {
    nextSource: MindroomLongTextSource | undefined;
    nextEnabled: boolean;
  }) => {
    const resolvedContent = useMindroomLongTextResolvedContent(nextSource, nextEnabled);

    React.useEffect(() => {
      onResolvedContent(resolvedContent);
    }, [resolvedContent]);

    return null;
  };

  const render = (nextSource: MindroomLongTextSource | undefined, nextEnabled: boolean) =>
    React.createElement(Probe, { nextSource, nextEnabled });

  await act(async () => {
    renderer = create(render(source, enabled));
  });

  return {
    onResolvedContent,
    renderer,
    update: async (nextSource, nextEnabled) => {
      await act(async () => {
        renderer.update(render(nextSource, nextEnabled));
      });
    },
  };
};

const renderResolvedContentDomProbe = async (
  source: MindroomLongTextSource | undefined,
  enabled: boolean
): Promise<{
  getProbeText: () => string;
  renderer: ReactTestRenderer;
  update: (
    nextSource: MindroomLongTextSource | undefined,
    nextEnabled: boolean
  ) => Promise<{ renderPhaseValues: (Record<string, unknown> | undefined)[] }>;
}> => {
  const { useMindroomLongTextResolvedContent } = await getMindroomLongTextTextModule();
  let renderer!: ReactTestRenderer;
  const renderPhaseValues: (Record<string, unknown> | undefined)[] = [];

  const Probe = ({
    nextSource,
    nextEnabled,
  }: {
    nextSource: MindroomLongTextSource | undefined;
    nextEnabled: boolean;
  }) => {
    const resolvedContent = useMindroomLongTextResolvedContent(nextSource, nextEnabled);
    renderPhaseValues.push(resolvedContent);

    return React.createElement(
      'div',
      { 'data-testid': 'probe' },
      resolvedContent ? JSON.stringify(resolvedContent) : 'EMPTY'
    );
  };

  const render = (nextSource: MindroomLongTextSource | undefined, nextEnabled: boolean) =>
    React.createElement(Probe, { nextSource, nextEnabled });

  const getProbeText = () => {
    const probe = renderer.root.findByProps({ 'data-testid': 'probe' });
    return probe.children.join('');
  };

  await act(async () => {
    renderer = create(render(source, enabled));
  });

  return {
    getProbeText,
    renderer,
    update: async (nextSource, nextEnabled) => {
      renderPhaseValues.length = 0;

      await act(async () => {
        renderer.update(render(nextSource, nextEnabled));
      });

      return { renderPhaseValues: [...renderPhaseValues] };
    },
  };
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const blob = init?.headers
        ? await matrixMocks.networkBody(url, { headers: init.headers })
        : await matrixMocks.networkBody(url);
      return new Response(blob);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

// The group title names its state ("Ran 2 tool calls", "Running 1 tool call", or "Used 2 tools"
// while trace details load); grouping tests only care about the count.
const toolCountLabel = (count: number, flags = '') => {
  const s = count === 1 ? '' : 's';
  return new RegExp(
    `(?:Ran|Running|Denied) ${count} tool call${s}|Used ${count} tool${s}|\\b${count} tool call${s} (?:waiting|expired)`,
    flags
  );
};

const reportVersions = (versions: string[]) =>
  Object.assign(hookMocks.mx, { getVersions: async () => ({ versions, unstable_features: {} }) });

describe('downloadMindroomLongTextSidecarText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportVersions(['v1.11']);
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Resolved response',
      msgtype: 'm.text',
    });
  });

  it('downloads unencrypted sidecar content through shared transport', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    // A homeserver without authenticated media gets the legacy URL.
    reportVersions([]);
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    const text = await downloadMindroomLongTextSidecarText(mockMx, createLongTextSource());

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', false);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"full response"');
  });

  it('authenticates unencrypted sidecar downloads without relying on the service worker', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    const mediaUrl = 'https://example.org/_matrix/client/v1/media/download/server/content';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'full response' })], {
        type: 'application/json',
      })
    );

    await downloadMindroomLongTextSidecarText(mockMx, createLongTextSource());

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', true);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl, {
      headers: { Authorization: 'Bearer access-token' },
    });
  });

  it('does not send the access token to a media URL outside the homeserver', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    const mediaUrl = 'https://media.example.net/_matrix/client/v1/media/download/server/content';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.networkBody.mockResolvedValue(
      new Blob(['{"msgtype":"m.text","body":"body"}'], { type: 'application/json' })
    );

    await downloadMindroomLongTextSidecarText(mockMx, createLongTextSource());

    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl);
  });

  it('downloads sidecar blob for unencrypted content', async () => {
    const downloadMindroomLongTextSidecarBlob = await getDownloadMindroomLongTextSidecarBlob();
    reportVersions([]);
    const blob = new Blob(['raw-content'], { type: 'application/json' });
    matrixMocks.networkBody.mockResolvedValue(blob);

    const downloadedBlob = await downloadMindroomLongTextSidecarBlob(
      mockMx,
      createLongTextSource(),
      true
    );

    expect(matrixMocks.mxcUrlToHttp).toHaveBeenCalledWith(mockMx, 'mxc://server/content', false);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(downloadedBlob.type).toBe(blob.type);
    expect(await downloadedBlob.text()).toBe('raw-content');
  });

  it('downloads encrypted sidecar cipher bytes and decrypts only the consumer blob', async () => {
    const downloadMindroomLongTextSidecarText = await getDownloadMindroomLongTextSidecarText();
    const encryptedFile: IEncryptedFile = {
      url: 'mxc://server/encrypted',
      key: { kty: 'oct', k: 'abc', alg: 'A256CTR', key_ops: ['encrypt', 'decrypt'] },
      iv: 'iv',
      hashes: { sha256: 'hash' },
      v: 'v2',
    };

    const mediaUrl = 'https://example.org/_matrix/client/v1/media/download/server/encrypted';
    matrixMocks.mxcUrlToHttp.mockReturnValue(mediaUrl);
    Object.assign(hookMocks.mx, {
      getAccessToken: vi.fn(() => 'access-token'),
      getHomeserverUrl: vi.fn(() => 'https://example.org'),
    });
    matrixMocks.decryptFile.mockResolvedValue(
      new Blob([JSON.stringify({ msgtype: 'm.text', body: 'decrypted response' })], {
        type: 'application/json',
      })
    );
    matrixMocks.networkBody.mockResolvedValue(
      new Blob([new Uint8Array(32)], { type: 'application/octet-stream' })
    );

    const text = await downloadMindroomLongTextSidecarText(
      mockMx,
      createLongTextSource({
        previewContent: {
          msgtype: 'm.file',
          info: { mimetype: 'application/json' },
          'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        },
        mxcUri: 'mxc://server/encrypted',
        encryptedFile,
      })
    );

    expect(matrixMocks.networkBody).toHaveBeenCalledWith(mediaUrl, {
      headers: { Authorization: 'Bearer access-token' },
    });
    expect(matrixMocks.decryptFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'application/json',
      encryptedFile
    );
    expect(matrixMocks.downloadEncryptedMedia).not.toHaveBeenCalled();
    expect(text).toContain('"body":"decrypted response"');
  });
});

describe('shouldResetResolvedContentToPreview', () => {
  it('keeps previously hydrated rich content when preview has no formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.file',
        body: 'preview only',
      },
      {
        msgtype: 'm.text',
        body: 'resolved body',
        formatted_body: '<p><strong>resolved body</strong></p>',
      }
    );

    expect(shouldReset).toBe(false);
  });

  it('resets when incoming preview includes formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.text',
        body: 'preview',
        formatted_body: '<p>preview</p>',
      },
      {
        msgtype: 'm.text',
        body: 'older body',
        formatted_body: '<p>older</p>',
      }
    );

    expect(shouldReset).toBe(true);
  });

  it('resets when there is no previously hydrated formatted body', async () => {
    const shouldResetResolvedContentToPreview = await getShouldResetResolvedContentToPreview();

    const shouldReset = shouldResetResolvedContentToPreview(
      {
        msgtype: 'm.file',
        body: 'preview only',
      },
      {
        msgtype: 'm.file',
        body: 'still preview',
      }
    );

    expect(shouldReset).toBe(true);
  });
});

describe('MindroomLongTextText hydration identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A warm real cache now short-circuits the mocked hydrate entirely, so
    // every test starts cold unless it warms the cache itself.
    clearMindroomLongTextHydrationCache();
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Resolved response',
      msgtype: 'm.text',
    });
  });

  it('defers sidecar hydration until hydration is enabled', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const content = createPreviewContent();
    let renderer!: ReactTestRenderer;

    const render = (hydrate: boolean) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        hydrate,
        content,
        longTextSource: createLongTextSource({ previewContent: content }),
        renderBody: (_content, props) => props.body,
      });

    longTextMocks.hydrateMindroomLongTextSource.mockClear();
    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Hydrated response',
      msgtype: 'm.text',
    });

    await act(async () => {
      renderer = create(render(false));
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Preview response'
    );

    await act(async () => {
      renderer.update(render(true));
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders prewarmed sidecar content on the first paint without a preview flash', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const content = createPreviewContent();
    const source = createLongTextSource({ previewContent: content });
    // Warm the REAL cache the way the prewarm pool does.
    const actualLongText = await vi.importActual<typeof import('./longText')>('./longText');
    await actualLongText.hydrateMindroomLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'Full prewarmed response' }),
      mockMx
    );
    longTextMocks.hydrateMindroomLongTextSource.mockClear();

    // No act(): this inspects the FIRST render, before any effect runs.
    const renderer = create(
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        content,
        longTextSource: source,
        renderBody: (_content, props) => props.body,
      })
    );
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Full prewarmed response'
    );

    // Effects settle without a re-download: the warm cache short-circuits.
    await act(async () => {});
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Full prewarmed response'
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it('shows warm content on the render that enables hydration, before effects run', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const content = createPreviewContent();
    const source = createLongTextSource({ previewContent: content });
    const actualLongText = await vi.importActual<typeof import('./longText')>('./longText');
    await actualLongText.hydrateMindroomLongTextSource(
      source,
      async () => JSON.stringify({ msgtype: 'm.text', body: 'Full prewarmed response' }),
      mockMx
    );
    longTextMocks.hydrateMindroomLongTextSource.mockClear();

    const render = (hydrate: boolean) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        hydrate,
        content,
        longTextSource: source,
        renderBody: (_content, props) => props.body,
      });

    // Overscan mount: cold render keeps the cheap preview despite the warm
    // cache (PR #110's guard).
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(render(false));
    });
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Preview response'
    );

    // Viewport entry flips hydrate: the flip's OWN render (no act, effects
    // not yet flushed) must already show the cached full content.
    renderer.update(render(true));
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Full prewarmed response'
    );

    // Effects settle without a re-download.
    await act(async () => {});
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders hydrated Markdown and a tool card while the real message stays collapsed', async () => {
    const { CollapsibleMessage } = await import('../threads/CollapsibleMessage');
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = createPreviewContent();
    const toolTrace = {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'search_web',
          result_preview: 'Found result',
        },
      ],
    };
    let intersectionCallback: IntersectionObserverCallback | undefined;
    let renderer!: ReactTestRenderer;

    longTextMocks.hydrateMindroomLongTextSource.mockResolvedValue({
      body: 'Hydrated **response**\n\n🔧 `search_web` [1]',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Hydrated <strong>response</strong></p><p>🔧 <code>search_web</code> [1]</p>',
      msgtype: 'm.text',
      'io.mindroom.tool_trace': toolTrace,
    });

    class MockIntersectionObserver {
      public observe = vi.fn();

      public disconnect = vi.fn();

      public constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px' }));

    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigProvider,
            { value: {} },
            React.createElement(
              CollapsibleMessage,
              { collapseMode: 'default', forceOverflowing: true },
              ({ loadFullContent }) =>
                renderMindroomMessageContent({
                  displayName: 'MindRoom',
                  msgType: 'm.text',
                  content,
                  hydrateLongText: loadFullContent,
                  htmlReactParserOptions: {},
                  linkifyOpts: {},
                })
            )
          ),
          {
            createNodeMock: (element) => {
              if (element.props.className === 'collapsible-content') {
                return { clientHeight: 72, scrollHeight: 160 };
              }
              return null;
            },
          }
        );
      });

      const getCollapsibleContent = () =>
        renderer.root.find(
          (node) =>
            node.type === 'div' &&
            node.props.className === 'collapsible-content' &&
            node.props['aria-expanded'] === false
        );

      expect(getCollapsibleContent()).toBeDefined();
      expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();

      await act(async () => {
        intersectionCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
        await Promise.resolve();
      });

      expect(getCollapsibleContent()).toBeDefined();
      expect(renderer.root.findByType('strong').children).toContain('response');
      const rendered = JSON.stringify(renderer.toJSON());
      expect(rendered).toMatch(toolCountLabel(1));
      expect(rendered).not.toContain('🔧');
      expect(rendered).not.toContain('**response**');
    } finally {
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
      }
      vi.unstubAllGlobals();
    }
  });

  it('renders preview Markdown and groups consecutive tool cards before long-text hydration', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: [
        'Preview **now**',
        '',
        '🔧 `run_shell_command` [1]',
        '',
        '',
        '🔧 `run_shell_command` [2]',
        '',
        '',
        '🔧 `run_shell_command` [3]',
      ].join('\n'),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByType('strong').children).toContain('now');
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toMatch(toolCountLabel(3));
    expect(rendered).not.toMatch(toolCountLabel(1));
    expect(rendered).not.toContain('🔧');
    expect(rendered).not.toContain('**now**');

    await act(async () => {
      renderer.unmount();
    });
  });

  it.each(['resolved', 'unavailable'])(
    'keeps preview tool calls grouped while details become %s',
    async (outcome) => {
      const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
      const deferred = createDeferred<Record<string, unknown>>();
      longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);
      const content = {
        ...createPreviewContent(),
        body: ['Update `notes.md`.', '', '🔧 `read_file` [1]', '', '🔧 `edit_file` [2]'].join('\n'),
      };
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigProvider,
            { value: {} },
            renderMindroomMessageContent({
              displayName: 'MindRoom',
              msgType: 'm.text',
              content,
              htmlReactParserOptions: {},
              linkifyOpts: {},
            })
          )
        );
      });
      try {
        expect(renderer.root.findAllByType('button')).toHaveLength(1);
        expect(JSON.stringify(renderer.toJSON())).toMatch(toolCountLabel(2));
        // Collapsed groups name their tools but render no rows until opened.
        expect(
          renderer.root.findAll(
            (node) => typeof node.type === 'string' && node.props['data-tool-index'] !== undefined
          )
        ).toHaveLength(0);
        await act(async () => {
          renderer.root.findByType('button').props.onClick();
        });
        expect(JSON.stringify(renderer.toJSON())).toContain('Still loading');
        expect(JSON.stringify(renderer.toJSON())).not.toContain('✓');

        const preview =
          longTextMocks.hydrateMindroomLongTextSource.mock.calls.at(-1)?.[0].previewContent;
        await act(async () => {
          deferred.resolve(
            outcome === 'unavailable'
              ? preview
              : {
                  ...preview,
                  formatted_body:
                    '<p>Update <code>notes.md</code>.</p><p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>edit_file</code> [2]</p>',
                  'io.mindroom.tool_trace': {
                    version: 2,
                    events: [
                      {
                        type: 'tool_call_completed',
                        tool_name: 'read_file',
                        result_preview: 'Read notes',
                      },
                      {
                        type: 'tool_call_completed',
                        tool_name: 'edit_file',
                        result_preview: 'Saved notes',
                      },
                    ],
                  },
                }
          );
        });
        const rendered = JSON.stringify(renderer.toJSON());
        expect(rendered).toMatch(toolCountLabel(2));
        expect(rendered).not.toContain('Still loading');
        expect(rendered).toContain(
          outcome === 'resolved' ? 'Saved notes' : 'Tool details unavailable'
        );
      } finally {
        await act(async () => {
          renderer.unmount();
        });
      }
    }
  );

  it('keeps narrative boundaries and code examples outside preview tool groups', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: [
        'Use `notes.md`.',
        '',
        '🔧 `read_file` [1]',
        '',
        'Now update the file.',
        '',
        '🔧 `edit_file` [2]',
        '',
        '🔧 `read_file` [3]',
        '',
        '```',
        '🔧 `example_tool` [4]',
        '```',
      ].join('\n'),
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });
    try {
      expect(renderer.root.findAllByType('button')).toHaveLength(2);
      const rendered = JSON.stringify(renderer.toJSON());
      expect(rendered).toMatch(toolCountLabel(1));
      expect(rendered).toMatch(toolCountLabel(2));
      expect(rendered).toContain('Now update the file.');
      expect(renderer.root.findByType('pre').findByType('code').children.join('')).toContain(
        '🔧 `example_tool` [4]'
      );
      expect(rendered).toContain('edit_file, read_file');
      expect(rendered).not.toContain('🔧 `edit_file`');
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('keeps tool details loading on the first render when a cold row becomes visible', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(createDeferred().promise);
    const content = createPreviewContent();
    const statuses: string[] = [];
    const render = (hydrate: boolean) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        content,
        hydrate,
        longTextSource: createLongTextSource({ previewContent: content }),
        renderBody: (_content, _props, status) => {
          statuses.push(status);
          return React.createElement('span', null, status);
        },
      });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(render(false));
    });
    statuses.length = 0;
    try {
      await act(async () => {
        renderer.update(render(true));
      });
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses).not.toContain('unavailable');
      expect(renderer.root.findByType('span').children).toEqual(['loading']);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders a root tool card after escaped multi-character inline syntax', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: ['Use \\~~literal~~.', '', '🔧 `run_shell_command` [1]'].join('\n'),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toMatch(toolCountLabel(1));
    expect(rendered).not.toContain('🔧');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps a list-contained tool marker prefix literal before long-text hydration', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: '- 🔧 `foo\\`bar` [1] trailing text',
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('🔧');
    expect(rendered).toContain('foo');
    expect(rendered).toContain('bar');
    expect(rendered).toContain('trailing text');
    expect(rendered).not.toMatch(toolCountLabel(1));

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps span-wrapped list-contained tool markers literal before hydration', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: [
        '- ||🔧|| `tool` [1]',
        '1. $🔧$ `tool` [2]',
        '- ||$🔧$|| `tool` [3]',
        '1. || 🔧 || `tool` [4]',
        '- || $🔧$|| `tool` [5] **tail**',
        '1. || ||🔧 `tool` [6]',
      ].join('\n'),
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('🔧');
    expect(rendered).toContain('tool');
    expect(rendered).not.toContain('tool call');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not expose added escapes in a list-contained tool marker', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: '- 🔧 \\`tool\\` [1]',
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('🔧');
    expect(rendered).toContain('`tool` [1]');
    expect(rendered).not.toContain('\\\\');
    expect(rendered).not.toContain('tool call');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps a reply-only long-text preview empty before hydration', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const content = {
      ...createPreviewContent(),
      body: '> <@alice:example.org> Previous reply\n\n',
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-testid': 'empty-content' })).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Previous reply');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('trims a reply fallback only once when preview formatting falls back', async () => {
    const { renderMindroomMessageContent } = await import('./renderMindroomMessageContent');
    const documentBody = [
      'Intro paragraph',
      '',
      '> <@alice:example.org> Quoted detail',
      '',
      String.raw`\*`.repeat(513),
    ].join('\n');
    const content = {
      ...createPreviewContent(),
      body: `> <@bob:example.org> Original question\n\n${documentBody}`,
    };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigProvider,
          { value: {} },
          renderMindroomMessageContent({
            displayName: 'MindRoom',
            msgType: 'm.text',
            content,
            hydrateLongText: false,
            htmlReactParserOptions: {},
            linkifyOpts: {},
          })
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('Intro paragraph');
    expect(rendered).toContain('Quoted detail');
    expect(rendered).not.toContain('Original question');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not restart hydration for equivalent preview content with a new object reference', async () => {
    const content = createPreviewContent();
    const { renderer, update } = await renderMindroomLongTextText(content);

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await update({
      ...content,
      info: { ...(content.info as Record<string, unknown>) },
      'io.mindroom.long_text': {
        ...((content['io.mindroom.long_text'] as Record<string, unknown>) ?? {}),
      },
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps preview extras available when hydrated content omits them', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const previewContent = {
      ...createPreviewContent(),
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('preview extra'),
    };
    const deferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);

    await act(async () => {
      renderer = create(
        React.createElement(MindroomLongTextText, {
          kind: MindroomLongTextKind.Text,
          content: previewContent,
          longTextSource: createLongTextSource({ previewContent }),
          renderBody: (_content, props) => props.body,
          renderAfterBody: (extrasContent, fallbackContent) =>
            React.createElement(
              'span',
              { 'data-testid': 'extras-probe' },
              extrasContent[MINDROOM_MESSAGE_EXTRAS_KEY] ||
                fallbackContent[MINDROOM_MESSAGE_EXTRAS_KEY]
                ? 'extras-present'
                : 'extras-missing'
            ),
        })
      );
    });

    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'extras-present',
    ]);

    await act(async () => {
      deferred.resolve({ body: 'Hydrated response', msgtype: 'm.text' });
      await deferred.promise;
    });

    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );
    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'extras-present',
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('prefers live extras over stale hydrated extras when only extras change', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const previewContent = {
      ...createPreviewContent(),
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('hydrated extra E1'),
    };
    const liveEditedContent = {
      ...previewContent,
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('live extra E2'),
    };
    const hydratedContent = {
      body: 'Hydrated response',
      msgtype: 'm.text',
      [MINDROOM_MESSAGE_EXTRAS_KEY]: createMessageExtras('hydrated extra E1'),
    };
    const deferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    const render = (nextContent: Record<string, unknown>) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        content: nextContent,
        longTextSource: createLongTextSource({ previewContent: nextContent }),
        renderBody: (_content, props) => props.body,
        renderAfterBody: (extrasContent, fallbackContent) =>
          React.createElement(
            'span',
            { 'data-testid': 'extras-probe' },
            parseMindroomMessageExtras(extrasContent)?.sections[0]?.content ??
              (!(MINDROOM_MESSAGE_EXTRAS_KEY in extrasContent)
                ? parseMindroomMessageExtras(fallbackContent)?.sections[0]?.content
                : undefined) ??
              'extras-missing'
          ),
      });

    longTextMocks.hydrateMindroomLongTextSource.mockClear();
    longTextMocks.hydrateMindroomLongTextSource.mockReturnValue(deferred.promise);

    await act(async () => {
      renderer = create(render(previewContent));
    });

    await act(async () => {
      deferred.resolve(hydratedContent);
      await deferred.promise;
    });

    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );
    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'hydrated extra E1',
    ]);

    await act(async () => {
      renderer.update(render(liveEditedContent));
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ 'data-testid': 'long-text-body' }).children).toContain(
      'Hydrated response'
    );
    expect(renderer.root.findByProps({ 'data-testid': 'extras-probe' }).children).toEqual([
      'live extra E2',
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the previous hydrated tool trace while the next rich preview hydrates', async () => {
    const { MindroomLongTextKind, MindroomLongTextText } = await getMindroomLongTextTextModule();
    const toolTrace = {
      version: 2,
      events: [{ type: 'tool_call_completed', tool_name: 'run_shell_command' }],
    };
    const firstPreviewContent = {
      ...createPreviewContent(),
      body: 'Preview A\n\n🔧 `run_shell_command` [1]',
      formatted_body: '<p>Preview A</p><p>🔧 <code>run_shell_command</code> [1]</p>',
      url: 'mxc://server/stream-a',
    };
    const secondPreviewContent = {
      ...createPreviewContent(),
      body: 'Preview B\n\n🔧 `run_shell_command` [1]',
      formatted_body: '<p>Preview B</p><p>🔧 <code>run_shell_command</code> [1]</p>',
      url: 'mxc://server/stream-b',
    };
    const secondDeferred = createDeferred<Record<string, unknown>>();
    let renderer!: ReactTestRenderer;

    const render = (nextContent: Record<string, unknown>) =>
      React.createElement(MindroomLongTextText, {
        kind: MindroomLongTextKind.Text,
        content: nextContent,
        longTextSource: createLongTextSource({
          previewContent: nextContent,
          mxcUri: nextContent.url as string,
        }),
        renderBody: (resolvedContent, props) =>
          React.createElement(
            'span',
            { 'data-testid': 'tool-trace-probe' },
            `${props.body}|${
              resolvedContent['io.mindroom.tool_trace'] ? 'trace-present' : 'trace-missing'
            }`
          ),
      });

    longTextMocks.hydrateMindroomLongTextSource.mockReset();
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      (source: MindroomLongTextSource) => {
        if (source.mxcUri === 'mxc://server/stream-a') {
          return Promise.resolve({
            body: 'Hydrated A',
            formatted_body: '<p>Hydrated A</p>',
            msgtype: 'm.text',
            'io.mindroom.tool_trace': toolTrace,
          });
        }
        return secondDeferred.promise;
      }
    );

    await act(async () => {
      renderer = create(render(firstPreviewContent));
      await Promise.resolve();
    });

    expect(renderer.root.findByProps({ 'data-testid': 'tool-trace-probe' }).children).toEqual([
      'Hydrated A|trace-present',
    ]);

    await act(async () => {
      renderer.update(render(secondPreviewContent));
    });

    expect(renderer.root.findByProps({ 'data-testid': 'tool-trace-probe' }).children).toEqual([
      'Preview B\n\n🔧 `run_shell_command` [1]|trace-present',
    ]);

    await act(async () => {
      secondDeferred.resolve({
        body: 'Hydrated B',
        formatted_body: '<p>Hydrated B</p>',
        msgtype: 'm.text',
        'io.mindroom.tool_trace': toolTrace,
      });
      await secondDeferred.promise;
    });

    expect(renderer.root.findByProps({ 'data-testid': 'tool-trace-probe' }).children).toEqual([
      'Hydrated B|trace-present',
    ]);

    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('useMindroomLongTextResolvedContent', () => {
  beforeEach(async () => {
    clearMindroomLongTextHydrationCache();
    vi.clearAllMocks();
    matrixMocks.mxcUrlToHttp.mockReturnValue(
      'https://example.org/_matrix/media/v3/download/server/content'
    );

    const actualMindroomLongText = await vi.importActual<typeof import('./longText')>('./longText');
    longTextMocks.hydrateMindroomLongTextSource.mockImplementation(
      actualMindroomLongText.hydrateMindroomLongTextSource
    );
  });

  it('returns cached content synchronously without fetching again', async () => {
    const actualMindroomLongText = await vi.importActual<typeof import('./longText')>('./longText');
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });
    const resolvedContent = {
      msgtype: 'm.text',
      body: 'Warm cache response',
    };

    await actualMindroomLongText.hydrateMindroomLongTextSource(
      source,
      async () => JSON.stringify(resolvedContent),
      mockMx
    );

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

    expect(onResolvedContent).toHaveBeenCalledWith(resolvedContent);
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(matrixMocks.networkBody).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('stays unresolved while disabled when the cache is cold', async () => {
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, false);

    expect(onResolvedContent).toHaveBeenCalledWith(undefined);
    expect(longTextMocks.hydrateMindroomLongTextSource).not.toHaveBeenCalled();
    expect(matrixMocks.networkBody).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('hydrates the sidecar when enabled and the cache is cold', async () => {
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });
    const resolvedContent = {
      msgtype: 'm.text',
      body: 'Hydrated response',
    };

    matrixMocks.networkBody.mockResolvedValue(
      new Blob([JSON.stringify(resolvedContent)], {
        type: 'application/json',
      })
    );

    const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(matrixMocks.networkBody).toHaveBeenCalledWith(
      'https://example.org/_matrix/media/v3/download/server/content'
    );
    expect(onResolvedContent).toHaveBeenLastCalledWith(resolvedContent);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not update state after unmount when in-flight hydration resolves later', async () => {
    const source = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        msgtype: 'm.file',
      },
    });
    const deferred = createDeferred<Blob>();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    matrixMocks.networkBody.mockImplementation(() => deferred.promise);

    try {
      const { onResolvedContent, renderer } = await renderResolvedContentProbe(source, true);

      expect(onResolvedContent).toHaveBeenCalledTimes(1);
      expect(onResolvedContent).toHaveBeenLastCalledWith(undefined);
      expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderer.unmount();
      });

      await act(async () => {
        deferred.resolve(
          new Blob([JSON.stringify({ msgtype: 'm.text', body: 'Resolved after unmount' })], {
            type: 'application/json',
          })
        );
        await deferred.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onResolvedContent).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not return stale resolved content when the source mxcUri changes', async () => {
    const actualMindroomLongText = await vi.importActual<typeof import('./longText')>('./longText');
    const sourceA = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        body: 'Preview A',
        msgtype: 'm.file',
        url: 'mxc://server/content-a',
      },
      mxcUri: 'mxc://server/content-a',
    });
    const sourceB = createLongTextSource({
      previewContent: {
        ...createPreviewContent(),
        body: 'Preview B',
        msgtype: 'm.file',
        url: 'mxc://server/content-b',
      },
      mxcUri: 'mxc://server/content-b',
    });
    const deferred = createDeferred<Blob>();
    const resolvedContentA = {
      msgtype: 'm.text',
      body: 'A body',
    };
    const resolvedContentB = {
      msgtype: 'm.text',
      body: 'B body',
    };

    await actualMindroomLongText.hydrateMindroomLongTextSource(
      sourceA,
      async () => JSON.stringify(resolvedContentA),
      mockMx
    );
    matrixMocks.networkBody.mockImplementation(() => deferred.promise);

    const { getProbeText, renderer, update } = await renderResolvedContentDomProbe(sourceA, true);

    expect(getProbeText()).toBe(JSON.stringify(resolvedContentA));
    expect(matrixMocks.networkBody).not.toHaveBeenCalled();

    const { renderPhaseValues } = await update(sourceB, true);

    expect(renderPhaseValues[0]).toBeUndefined();
    expect(getProbeText()).toBe('EMPTY');
    expect(longTextMocks.hydrateMindroomLongTextSource).toHaveBeenCalledTimes(1);
    expect(matrixMocks.networkBody).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(new Blob([JSON.stringify(resolvedContentB)], { type: 'application/json' }));
      await deferred.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getProbeText()).toBe(JSON.stringify(resolvedContentB));

    await act(async () => {
      renderer.unmount();
    });
  });
});
