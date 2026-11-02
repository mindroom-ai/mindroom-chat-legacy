import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { renderNoticeText } from './noticeText';
import { MAX_NOTICE_TEXT_LENGTH } from './notices';

vi.mock('../../styles/CustomHtml.css', () => ({ Code: 'code' }));

const html = (text: string) => renderToStaticMarkup(<>{renderNoticeText(text)}</>);
// How React writes plain text into markup.
const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (href: string, label: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

describe('renderNoticeText', () => {
  it('renders plain text as text', () => {
    expect(html('Chat is moving tonight.')).toBe('Chat is moving tonight.');
  });

  it.each([
    ['**down** now', '<strong>down</strong> now'],
    ['*soon* and _later_', '<i>soon</i> and <i>later</i>'],
    ['~~01:00~~ 01:30', '<s>01:00</s> 01:30'],
    ['run `notice clear`', 'run <code class="code">notice clear</code>'],
    ['**`bold code`**', '<strong><code class="code">bold code</code></strong>'],
    ['`**not bold**`', '<code class="code">**not bold**</code>'],
    ['\\*literal\\*', '*literal*'],
  ])('renders %s', (text, expected) => {
    expect(html(text)).toBe(expected);
  });

  it('renders https links that open in a new tab', () => {
    expect(html('See [status](https://status.example.org/cutover).')).toBe(
      `See ${link('https://status.example.org/cutover', 'status')}.`
    );
  });

  it('renders several links and formatting inside a label', () => {
    expect(html('[one](https://a.example) and [**two**](https://b.example/x?y=1&z=2)')).toBe(
      `${link('https://a.example/', 'one')} and ${link(
        'https://b.example/x?y=1&amp;z=2',
        '<strong>two</strong>'
      )}`
    );
  });

  it.each([
    ['[x](http://example.org)'],
    ['[x](javascript:alert(1))'],
    ['[x](JavaScript:alert(1))'],
    ['[x](data:text/html;base64,PHNjcmlwdD4=)'],
    ['[x](//example.org)'],
    ['[x](/relative)'],
    ['[x](https&#58;//example.org)'],
    ['[x](https://javascript:alert(1)@evil.example)'],
    ['[x](https://exa mple.org)'],
    ['[x](https://)'],
    ['[x](https://exa<mple.org)'],
  ])('keeps %s as literal text', (text) => {
    const rendered = html(text);
    expect(rendered).not.toContain('<a');
    expect(rendered).toBe(escaped(text));
  });

  it('keeps brackets without a URL and malformed links literal', () => {
    expect(html('[maintenance] tonight')).toBe('[maintenance] tonight');
    expect(html('[label]()')).toBe('[label]()');
    expect(html('[label](https://example.org')).toBe('[label](https://example.org');
    expect(html('[label] (https://example.org)')).toBe('[label] (https://example.org)');
  });

  it('keeps nested brackets to one link', () => {
    expect(html('[a [b](https://example.org)](https://other.example)')).toBe(
      `[a ${link('https://example.org/', 'b')}](https://other.example)`
    );
  });

  it('does not let a non-https link swallow the next one', () => {
    expect(html('[a](http://example.org) [b](https://example.org/b)')).toBe(
      `[a](http://example.org) ${link('https://example.org/b', 'b')}`
    );
  });

  it('renders image syntax as a link, never an image', () => {
    const rendered = html('![logo](https://example.org/logo.png)');
    expect(rendered).not.toContain('<img');
    expect(rendered).toBe(`!${link('https://example.org/logo.png', 'logo')}`);
  });

  it('keeps a very long URL as one link', () => {
    const url = `https://example.org/${'a'.repeat(400)}`;
    expect(html(`[log](${url})`)).toBe(link(url, 'log'));
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<b onclick="alert(1)">bold</b>',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://example.org"></iframe>',
    '<style>body{display:none}</style>',
    '<svg onload=alert(1)>',
    '&lt;b&gt;encoded&lt;/b&gt;',
    '<<b>>nested</b>',
  ])('shows raw HTML %s as text', (text) => {
    const rendered = html(text);
    expect(rendered).not.toMatch(/<(?!\/?(strong|i|s|code|a)\b)[a-z]/i);
    expect(rendered).toBe(escaped(text));
  });

  it('leaves headings, lists, quotes and tables as text', () => {
    expect(html('# Title')).toBe('# Title');
    expect(html('- item')).toBe('- item');
    expect(html('> quote')).toBe('&gt; quote');
    expect(html('| a | b |')).toBe('| a | b |');
  });

  it('renders underscores as italics, as chat messages do', () => {
    expect(html('__init__ and snake_case_name')).toBe(
      '<i><i>init</i></i> and snake<i>case</i>name'
    );
    expect(html('\\_\\_init\\_\\_')).toBe('__init__');
  });

  it('leaves spoiler and math syntax as text', () => {
    expect(html('||secret|| costs $5 and $6')).toBe('||secret|| costs $5 and $6');
  });

  it.each([
    ['**x** '.repeat(166), '<strong>'],
    ['*a*'.repeat(333), '<i>'],
    ['_a_ '.repeat(250), '<i>'],
    ['~~a~~'.repeat(200), '<s>'],
    ['`a`'.repeat(333), '<code'],
    ['[a](https://b.example)'.repeat(45), '<a'],
    ['**'.repeat(500), '<strong>'],
  ])('parses worst-case text at the length cap quickly (%#)', (text, tag) => {
    expect(text.length).toBeLessThanOrEqual(MAX_NOTICE_TEXT_LENGTH);
    const started = performance.now();
    expect(html(text)).toContain(tag);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each([
    [`${'['.repeat(980)}](https://x)`, `${'['.repeat(980)}](https://x)`],
    ['[a](https://'.repeat(83), '[a](https://'.repeat(83)],
    ['\\*'.repeat(500), '*'.repeat(500)],
  ])('renders worst-case text without tags at the length cap quickly (%#)', (text, expected) => {
    expect(text.length).toBeLessThanOrEqual(MAX_NOTICE_TEXT_LENGTH);
    const started = performance.now();
    expect(html(text)).toBe(expected);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('never throws for text far over the cap: formatted, or plain if the parser gives up', () => {
    const text = '**x** '.repeat(5000);
    const rendered = html(text).replace(/<[^>]+>/g, '');
    expect([text, 'x '.repeat(5000)]).toContain(rendered);
  });
});
