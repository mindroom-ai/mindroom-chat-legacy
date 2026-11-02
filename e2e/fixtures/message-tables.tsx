import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import parse from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import { BreakWord } from '../../src/app/styles/Text.css';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../src/app/plugins/react-custom-html-parser';
import { sanitizeCustomHtml } from '../../src/app/utils/sanitize';
import { useMindroomToolTraceMarkerParserOptions } from '../../src/app/mindroom/messages/MindroomHtmlBlocks';
import { resolveHtmlReactParserOptions } from '../../src/app/utils/htmlReactParserOptions';

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${
  dark ? darkTheme : lightTheme
} ${dark ? 'dark-theme' : 'light-theme'}`;
const parser = getReactCustomHtmlParser({} as MatrixClient, undefined, {
  linkifyOpts: LINKIFY_OPTS,
});
const headers = ['Project name', 'Current status', 'Assigned team', 'Next milestone', 'Notes'];
const values = [
  'Community workspace',
  'Ready for review',
  'Client experience team',
  'September release candidate',
  'Keyboard and touch support',
];

function Fixture() {
  const [wide, setWide] = useState(true);
  const columns = wide ? headers : ['Item', 'Count'];
  const cells = wide ? values : ['Tea', '2'];
  // Markdown-capable senders supply tables as formatted_body HTML.
  const caption = params.get('format') === 'html' ? '<caption>Project overview</caption>' : '';
  const html = `<table>${caption}<thead><tr>${columns
    .map((header) => `<th>${header}</th>`)
    .join('')}</tr></thead><tbody>${[0, 1]
    .map(() => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
  const toolPrefix = params.has('tools')
    ? ['<p>🔧 <code>first_tool</code> [1]</p>', '<p>🔧 <code>second_tool</code> [2]</p>', ''].join(
        params.has('whitespace') ? '\n  ' : ''
      )
    : '';
  const formattedBody = toolPrefix + html;
  const options = resolveHtmlReactParserOptions(
    useMindroomToolTraceMarkerParserOptions(parser, { formatted_body: formattedBody })
  );

  return (
    <main style={{ padding: 16, color: color.Surface.OnContainer, fontSize: 16, lineHeight: 1.5 }}>
      <button type="button" onClick={() => setWide(!wide)}>
        Toggle table width
      </button>
      <div style={{ display: 'flex', marginTop: 16 }}>
        <div className={BreakWord} style={{ minWidth: 0, flex: 1, whiteSpace: 'pre-wrap' }}>
          {parse(sanitizeCustomHtml(formattedBody), options)}
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
