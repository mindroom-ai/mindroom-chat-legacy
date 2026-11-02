import { describe, expect, it, vi } from 'vitest';
import type { HTMLReactParserOptions } from 'html-react-parser';

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

// eslint-disable-next-line import/first
import { renderMarkerParserOptions } from '../../test-utils/markerParserOptions';

const baseOpts: HTMLReactParserOptions = {};

describe('useMindroomToolTraceMarkerParserOptions identity', () => {
  it('returns the base options unchanged for content without mindroom markers', () => {
    expect(
      renderMarkerParserOptions(baseOpts, {
        msgtype: 'm.text',
        body: 'plain streamed text',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>plain <strong>streamed</strong> text</p>',
      })
    ).toBe(baseOpts);
  });

  it('wraps options when the formatted body contains a tool ref marker', () => {
    const opts = renderMarkerParserOptions(baseOpts, {
      msgtype: 'm.text',
      body: '🔧 `search` [1]',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>🔧 <code>search</code> [1]</p>',
    });
    expect(opts).not.toBe(baseOpts);
    // A function that makes fresh options, with their per-parse state, for each parse.
    expect(typeof opts).toBe('function');
    expect(typeof (opts as () => HTMLReactParserOptions)().replace).toBe('function');
  });

  it('wraps options when only the plain body contains a tool ref marker', () => {
    const opts = renderMarkerParserOptions(baseOpts, {
      msgtype: 'm.text',
      body: '🔧 `search` [1]',
    });
    expect(opts).not.toBe(baseOpts);
  });

  it('wraps options when the formatted body contains a paste marker span', () => {
    const opts = renderMarkerParserOptions(baseOpts, {
      msgtype: 'm.text',
      body: 'pasted',
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p><span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-1" data-mindroom-paste-chars="10" data-mindroom-paste-file="a.txt">[[mindroom-paste:{"v":1,"id":"paste-1","chars":10,"file":"a.txt"}]]</span></p>',
    });
    expect(opts).not.toBe(baseOpts);
  });

  it('wraps options for tool trace v2 content', () => {
    const opts = renderMarkerParserOptions(baseOpts, {
      msgtype: 'm.text',
      body: 'ran tools',
      'io.mindroom.tool_trace': { version: 2, events: [] },
    });
    expect(opts).not.toBe(baseOpts);
  });

  it('wraps options when a message extras section contains a marker', () => {
    const opts = renderMarkerParserOptions(baseOpts, {
      msgtype: 'm.text',
      body: 'with extras',
      'com.mindroom.message_extras': {
        version: 1,
        sections: [
          {
            title: 'Trace',
            contentType: 'text/markdown',
            content: '🔧 `lookup` [2]',
            collapsed: true,
          },
        ],
      },
    });
    expect(opts).not.toBe(baseOpts);
  });
});
