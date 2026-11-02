// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { create, ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  MindroomMessageExtras as MindroomMessageExtrasData,
  MindroomMessageExtrasSection,
} from './messageExtrasData';
import { MindroomMessageExtras } from './MindroomMessageExtras';

vi.mock('./MindroomHtmlBlocks.css', () => ({}));
vi.mock('./ApprovalArgumentFields.css', () => ({}));

vi.mock('./MindroomMessageExtras.css.ts', () => ({
  Extras: 'Extras',
  Section: 'Section',
  Summary: 'Summary',
  Content: 'Content',
  PlainText: 'PlainText',
  Markdown: 'Markdown',
  Html: 'Html',
}));

const sanitizeCustomHtmlSpy = vi.hoisted(() => vi.fn());
const sanitizeExtraHtmlSpy = vi.hoisted(() => vi.fn());

vi.mock('../../utils/sanitize', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../utils/sanitize')>();
  sanitizeCustomHtmlSpy.mockImplementation(original.sanitizeCustomHtml);
  return {
    ...original,
    sanitizeCustomHtml: sanitizeCustomHtmlSpy,
  };
});

vi.mock('./messageExtrasHtml', async (importOriginal) => {
  const original = await importOriginal<typeof import('./messageExtrasHtml')>();
  sanitizeExtraHtmlSpy.mockImplementation(original.sanitizeMindroomMessageExtraHtml);
  return {
    ...original,
    sanitizeMindroomMessageExtraHtml: sanitizeExtraHtmlSpy,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createExtras = (
  sections: MindroomMessageExtrasSection[],
  version: MindroomMessageExtrasData['version'] = 1
): MindroomMessageExtrasData => ({
  version,
  sections,
});

const section = (
  overrides: Partial<MindroomMessageExtrasSection> = {}
): MindroomMessageExtrasSection => ({
  title: 'Details',
  contentType: 'text/plain',
  content: 'payload',
  collapsed: true,
  ...overrides,
});

const getNodeText = (value: ReactTestInstance | string | number): string => {
  if (typeof value === 'string' || typeof value === 'number') return `${value}`;
  return value.children.map((child) => getNodeText(child as ReactTestInstance | string)).join('');
};

describe('MindroomMessageExtras', () => {
  it('renders one details element per section', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({ title: 'First' }),
          section({ title: 'Second', content: 'two' }),
        ]),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('details')).toHaveLength(2);
    expect(getNodeText(renderer.root)).toContain('First');
    expect(getNodeText(renderer.root)).toContain('Second');

    renderer.unmount();
  });

  it('opens only sections that start uncollapsed', () => {
    const container = document.createElement('div');
    let root: Root | undefined;

    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(MindroomMessageExtras, {
          extras: createExtras([
            section({ collapsed: true }),
            section({ title: 'Open', collapsed: false }),
          ]),
          htmlReactParserOptions: {},
          markerContent: {},
        })
      );
    });

    const details = container.querySelectorAll('details');

    expect(details[0].open).toBe(false);
    expect(details[1].open).toBe(true);

    act(() => {
      root?.unmount();
    });
  });

  it('does not reset details state on rerender', () => {
    const container = document.createElement('div');
    const extras = createExtras([section({ collapsed: false })]);
    let root: Root | undefined;

    const render = () =>
      React.createElement(MindroomMessageExtras, {
        extras,
        htmlReactParserOptions: {},
        markerContent: {},
      });

    act(() => {
      root = createRoot(container);
      root.render(render());
    });

    const details = container.querySelector('details');
    expect(details?.open).toBe(true);

    act(() => {
      root?.render(render());
    });

    expect(details?.open).toBe(true);

    if (details) details.open = false;

    act(() => {
      root?.render(render());
    });

    expect(details?.open).toBe(false);

    act(() => {
      root?.unmount();
    });
  });

  it('keeps user-toggled details state when streaming edits change section content', () => {
    const container = document.createElement('div');
    let root: Root | undefined;

    const render = (extras: MindroomMessageExtrasData) =>
      React.createElement(MindroomMessageExtras, {
        extras,
        htmlReactParserOptions: {},
        markerContent: {},
      });

    act(() => {
      root = createRoot(container);
      root.render(render(createExtras([section({ content: 'initial', collapsed: false })])));
    });

    const details = container.querySelector('details');
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain('initial');

    if (details) details.open = false;

    act(() => {
      root?.render(
        render(
          createExtras([
            section({
              content: 'streamed update',
              collapsed: false,
            }),
          ])
        )
      );
    });

    expect(container.querySelector('details')).toBe(details);
    expect(details?.open).toBe(false);
    expect(container.textContent).toContain('streamed update');

    if (details) details.open = true;

    act(() => {
      root?.render(
        render(
          createExtras([
            section({
              content: 'final update',
              collapsed: true,
            }),
          ])
        )
      );
    });

    expect(container.querySelector('details')).toBe(details);
    expect(details?.open).toBe(true);
    expect(container.textContent).toContain('final update');

    act(() => {
      root?.unmount();
    });
  });

  it('renders text/plain literally without markdown or HTML parsing', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            content: '<strong>literal</strong>\n**not bold**',
          }),
        ]),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    expect(renderer.root.findAllByType('strong')).toHaveLength(0);
    expect(getNodeText(renderer.root)).toContain('<strong>literal</strong>');
    expect(getNodeText(renderer.root)).toContain('**not bold**');

    renderer.unmount();
  });

  it('renders text/markdown through sanitized markdown output', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            contentType: 'text/markdown',
            content: '**bold**\n```ts\nconst value = 1;\n```',
          }),
        ]),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('strong')).toHaveLength(1);
    expect(renderer.root.findAllByType('pre')).toHaveLength(1);
    expect(renderer.root.findAllByType('code')).toHaveLength(1);
    expect(getNodeText(renderer.root)).toContain('bold');
    expect(getNodeText(renderer.root)).toContain('const value = 1;');

    renderer.unmount();
  });

  it('escapes raw dangerous markdown input before HTML parsing', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            contentType: 'text/markdown',
            content:
              '<details open><summary>raw</summary>expanded</details><script>alert(1)</script>',
          }),
        ]),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('details')).toHaveLength(1);
    expect(renderer.root.findAllByType('script')).toHaveLength(0);
    expect(getNodeText(renderer.root)).toContain('<details open>');
    expect(getNodeText(renderer.root)).toContain('<script>alert(1)</script>');

    renderer.unmount();
  });

  it('renders titles as escaped React text', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([
          section({
            title: '<img src=x onerror=alert(1)>',
          }),
        ]),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(getNodeText(renderer.root)).toContain('<img src=x onerror=alert(1)>');

    renderer.unmount();
  });

  it('renders sanitized text/html as elements inside one Cinny-owned details wrapper', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              contentType: 'text/html',
              content:
                '<h2>Evidence</h2><p><strong>safe</strong></p><ul><li>item</li></ul><table><tr><td>cell</td></tr></table><a href="https://example.test">link</a>',
            }),
          ],
          2
        ),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('details')).toHaveLength(1);
    expect(renderer.root.findAllByType('summary')).toHaveLength(1);
    expect(renderer.root.findAllByType('h2')).toHaveLength(1);
    expect(renderer.root.findAllByType('strong')).toHaveLength(1);
    expect(renderer.root.findAllByType('ul')).toHaveLength(1);
    expect(renderer.root.findAllByType('table')).toHaveLength(1);

    const link = renderer.root.findByType('a');
    expect(link.props.href).toBe('https://example.test');
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toBe('noreferrer noopener');

    renderer.unmount();
  });

  it('renders sanitized text/html SVG sections as React SVG elements', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              contentType: 'text/html',
              content:
                '<svg viewBox="0 0 200 40"><polyline fill="none" stroke="#7d5fff" points="0,30 50,10 100,20 150,5 200,15"/></svg>',
            }),
          ],
          2
        ),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    const svg = renderer.root.findByType('svg');
    const polyline = renderer.root.findByType('polyline');

    expect(svg.props.viewBox).toBe('0 0 200 40');
    expect(polyline.props.fill).toBe('none');
    expect(polyline.props.stroke).toBe('#7d5fff');
    expect(polyline.props.points).toBe('0,30 50,10 100,20 150,5 200,15');

    renderer.unmount();
  });

  it('removes sender-owned disclosure controls from text/html sections', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              contentType: 'text/html',
              content:
                '<details open><summary>sender summary</summary><p>sender body</p></details><p>safe</p>',
            }),
          ],
          2
        ),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('details')).toHaveLength(1);
    expect(renderer.root.findAllByType('summary')).toHaveLength(1);
    expect(getNodeText(renderer.root)).toContain('safe');
    expect(getNodeText(renderer.root)).not.toContain('sender summary');
    expect(getNodeText(renderer.root)).not.toContain('sender body');

    renderer.unmount();
  });

  it('keeps user-toggled details state when streaming edits change html content', () => {
    const container = document.createElement('div');
    let root: Root | undefined;

    const render = (html: string) =>
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              title: 'HTML',
              contentType: 'text/html',
              content: html,
              collapsed: false,
            }),
          ],
          2
        ),
        htmlReactParserOptions: {},
        markerContent: {},
      });

    act(() => {
      root = createRoot(container);
      root.render(render('<p>initial</p>'));
    });

    const details = container.querySelector('details');
    expect(details?.open).toBe(true);
    expect(container.querySelector('p')?.textContent).toBe('initial');

    if (details) details.open = false;

    act(() => {
      root?.render(render('<p>streamed update</p>'));
    });

    expect(container.querySelector('details')).toBe(details);
    expect(details?.open).toBe(false);
    expect(container.querySelector('p')?.textContent).toBe('streamed update');

    act(() => {
      root?.unmount();
    });
  });

  it('sanitizes malicious html sections while preserving sibling sections', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              title: 'HTML',
              contentType: 'text/html',
              content:
                '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="https://example.test/x.png"><a href="javascript:alert(1)">bad link</a>',
            }),
            section({ title: 'Plain', content: '<strong>literal</strong>' }),
          ],
          2
        ),
        htmlReactParserOptions: {},
        markerContent: {},
      })
    );

    expect(renderer.root.findAllByType('script')).toHaveLength(0);
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findAllByType('p')[0].props.onclick).toBeUndefined();
    expect(renderer.root.findByType('a').props.href).toBeUndefined();
    expect(getNodeText(renderer.root)).toContain('safe');
    expect(getNodeText(renderer.root)).toContain('<strong>literal</strong>');

    renderer.unmount();
  });

  it('does not linkify disallowed plain-text URL schemes inside text/html sections', () => {
    const renderer = create(
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              title: 'HTML',
              contentType: 'text/html',
              content:
                '<p>magnet:?xt=urn:btih:abc ftp://example.test/file https://example.test</p><a href="mailto:user@example.test">mail</a>',
            }),
          ],
          2
        ),
        htmlReactParserOptions: {
          replace: (domNode) => {
            if ('type' in domNode && domNode.type === 'text') {
              const data = 'data' in domNode ? domNode.data : '';
              if (typeof data === 'string' && data.includes('magnet:')) {
                return React.createElement('a', { href: 'magnet:?xt=urn:btih:abc' }, data);
              }
            }
            return undefined;
          },
        },
        markerContent: {},
      })
    );

    const links = renderer.root.findAllByType('a');
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe('mailto:user@example.test');
    expect(getNodeText(renderer.root)).toContain('magnet:?xt=urn:btih:abc');
    expect(getNodeText(renderer.root)).toContain('ftp://example.test/file');
    expect(getNodeText(renderer.root)).toContain('https://example.test');

    renderer.unmount();
  });

  it('does not re-parse unchanged sections when re-rendered with equal extras', () => {
    const container = document.createElement('div');
    let root: Root | undefined;
    const htmlReactParserOptions = {};

    const render = () =>
      React.createElement(MindroomMessageExtras, {
        extras: createExtras(
          [
            section({
              title: 'Markdown',
              contentType: 'text/markdown',
              content: '**bold** body',
            }),
            section({
              title: 'HTML',
              contentType: 'text/html',
              content: '<p>safe</p>',
            }),
          ],
          2
        ),
        htmlReactParserOptions,
        markerContent: {},
      });

    sanitizeCustomHtmlSpy.mockClear();
    sanitizeExtraHtmlSpy.mockClear();

    act(() => {
      root = createRoot(container);
      root.render(render());
    });

    const markdownCallsAfterMount = sanitizeCustomHtmlSpy.mock.calls.length;
    const htmlCallsAfterMount = sanitizeExtraHtmlSpy.mock.calls.length;
    expect(markdownCallsAfterMount).toBeGreaterThan(0);
    expect(htmlCallsAfterMount).toBeGreaterThan(0);

    act(() => {
      root?.render(render());
    });
    act(() => {
      root?.render(render());
    });

    expect(sanitizeCustomHtmlSpy.mock.calls.length).toBe(markdownCallsAfterMount);
    expect(sanitizeExtraHtmlSpy.mock.calls.length).toBe(htmlCallsAfterMount);

    act(() => {
      root?.unmount();
    });
  });

  it('re-parses a section when its content changes', () => {
    const container = document.createElement('div');
    let root: Root | undefined;
    const htmlReactParserOptions = {};

    const render = (content: string) =>
      React.createElement(MindroomMessageExtras, {
        extras: createExtras([section({ title: 'HTML', contentType: 'text/html', content })], 2),
        htmlReactParserOptions,
        markerContent: {},
      });

    act(() => {
      root = createRoot(container);
      root.render(render('<p>first</p>'));
    });

    sanitizeExtraHtmlSpy.mockClear();

    act(() => {
      root?.render(render('<p>second</p>'));
    });

    expect(sanitizeExtraHtmlSpy.mock.calls.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('second');

    act(() => {
      root?.unmount();
    });
  });
});
