import React from 'react';
import parse from 'html-react-parser';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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

describe('Mindroom paste marker HTML blocks', () => {
  it('renders paste marker spans as badges', async () => {
    const { markerParserOptions } = await import('../../test-utils/markerParserOptions');
    const formattedBody = [
      '<p>Before ',
      '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="18421" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
      '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":18421,"file":"mindroom-paste-a3f19c.txt"}]]',
      '</span>',
      ' after</p>',
    ].join('');
    // Production passes the message content whose formatted_body is parsed;
    // marker-aware parsing activates from that content.
    const parserOptions = markerParserOptions({}, { formatted_body: formattedBody });
    const renderer = create(
      React.createElement(React.Fragment, null, parse(formattedBody, parserOptions))
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('data-mindroom-paste-badge');
    expect(rendered).toContain('Pasted text');
    expect(rendered).toContain('paste-a3f19c');
    expect(rendered).toContain('18,421 characters');
    expect(rendered).toContain('mindroom-paste-a3f19c.txt');
    expect(rendered).toContain('Before');
    expect(rendered).toContain('after');

    renderer.unmount();
  });
});
