import { useEffect, useSyncExternalStore } from 'react';
import type MarkdownIt from 'markdown-it';
import type { StateBlock, StateInline } from 'markdown-it';

// Renders live reply Markdown the way the MindRoom runtime renders the durable edit
// (`markdown_to_html` in `src/mindroom/matrix/message_builder.py`), so the overlay and the
// next checkpoint look alike. The app's own sanitizer still runs on the output, which stands in
// for the runtime's HTML sanitizer. Known differences: no syntax highlighting of fenced code with a
// language, table cells keep their `text-align` style, and only ASCII digits count next to `$`.

// The runtime's Matrix-safe tags; a disallowed tag opening a line is escaped before parsing.
const ALLOWED_TAGS = new Set(
  'a b blockquote br caption code del details div em font h1 h2 h3 h4 h5 h6 hr i img li ol p pre s span strike strong sub summary sup table tbody td th thead tr u ul'.split(
    ' '
  )
);
const BLOCK_TAGS =
  'blockquote caption details div h1 h2 h3 h4 h5 h6 hr li ol p pre table tbody td th thead tr ul';
const BLOCK_TAG_ALTERNATION = BLOCK_TAGS.split(' ').join('|');

const RAW_HTML_TAG_LINE_START = /^( {0,3})(<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>)/;
const SUPPORTED_BLOCK_LINE_START = new RegExp(`^ {0,3}</?(?:${BLOCK_TAG_ALTERNATION})\\b`, 'i');
const SUPPORTED_BLOCK_END_TAG = new RegExp(`</(?:${BLOCK_TAG_ALTERNATION})>\\s*$`, 'i');
const HR_BLOCK_TAG = /^ {0,3}<hr\b[^<>]*\/?>\s*$/i;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Python's `html.escape`, which the runtime uses for escaped openers and preserved math. */
const escapeLikePython = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

// `trimEnd` removes the same characters as `/\s+$/` in linear time; the regex backtracks quadratically.
const stripTrailingWhitespace = (text: string): string => text.trimEnd();
const stripLeadingSpaces = (text: string): string => text.replace(/^ +/, '');
const splitLinesKeepingEnds = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const countRepeated = (text: string, start: number, character: string): number => {
  let end = start;
  while (end < text.length && text[end] === character) end += 1;
  return end - start;
};

const isFenceClosingLine = (line: string, character: string, openingLength: number): boolean => {
  const stripped = stripLeadingSpaces(line);
  if (line.length - stripped.length > 3 || !stripped.startsWith(character)) return false;
  const closingLength = countRepeated(stripped, 0, character);
  return closingLength >= openingLength && stripped.slice(closingLength).trim() === '';
};

const needsBlockHtmlBoundaryAfterLine = (line: string): boolean => {
  const stripped = stripTrailingWhitespace(line);
  if (!stripped) return false;
  if (HR_BLOCK_TAG.test(stripped)) return true;
  return SUPPORTED_BLOCK_LINE_START.test(stripped) && SUPPORTED_BLOCK_END_TAG.test(stripped);
};

const fencedCodeRanges = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  let fenceStart: number | undefined;
  let fenceCharacter: string | undefined;
  let openingLength = 0;
  let offset = 0;
  splitLinesKeepingEnds(text).forEach((line) => {
    if (fenceCharacter === undefined) {
      const fence = FENCE_OPEN.exec(line);
      if (fence && (fence[1][0] === '~' || !line.slice(fence[0].length).includes('`'))) {
        fenceStart = offset;
        [fenceCharacter] = fence[1];
        openingLength = fence[1].length;
      }
    } else if (
      fenceStart !== undefined &&
      isFenceClosingLine(line, fenceCharacter, openingLength)
    ) {
      ranges.push([fenceStart, offset + line.length]);
      fenceStart = undefined;
      fenceCharacter = undefined;
    }
    offset += line.length;
  });
  if (fenceStart !== undefined) ranges.push([fenceStart, text.length]);
  return ranges;
};

const transformOutsideFencedCode = (text: string, transform: (prose: string) => string): string => {
  const parts: string[] = [];
  let cursor = 0;
  fencedCodeRanges(text).forEach(([start, end]) => {
    let prose = text.slice(cursor, start);
    const lines = splitLinesKeepingEnds(prose);
    if (prose && needsBlockHtmlBoundaryAfterLine(lines[lines.length - 1])) {
      prose = prose.endsWith('\n') ? `${prose}\n` : `${prose}\n\n`;
    }
    parts.push(transform(prose), text.slice(start, end));
    cursor = end;
  });
  parts.push(transform(text.slice(cursor)));
  return parts.join('');
};

// Comments, declarations, processing instructions and disallowed tags would open raw HTML blocks.
const escapeHtmlBlockOpeners = (text: string): string =>
  splitLinesKeepingEnds(text)
    .map((line) => {
      const stripped = stripLeadingSpaces(line);
      if (line.length - stripped.length > 3) return line;
      if (stripped.startsWith('<!') || stripped.startsWith('<?')) {
        return line.slice(0, line.length - stripped.length) + escapeLikePython(stripped);
      }
      const rawTag = RAW_HTML_TAG_LINE_START.exec(line);
      if (rawTag && !ALLOWED_TAGS.has(rawTag[3].toLowerCase())) {
        return rawTag[1] + escapeLikePython(line.slice(rawTag[1].length));
      }
      return line;
    })
    .join('');

// CommonMark ends block HTML only at a blank line, so Markdown after a complete block tag line needs one.
const separateSupportedBlockHtml = (text: string): string => {
  const lines = splitLinesKeepingEnds(text);
  return lines
    .map((line, index) => {
      const next = lines[index + 1];
      return next !== undefined && next.trim() && needsBlockHtmlBoundaryAfterLine(line)
        ? `${line}\n`
        : line;
    })
    .join('');
};

// Python indexes from the end for -1; the runtime's math rules read that character at the start.
const charAt = (text: string, index: number): string | undefined =>
  index < 0 ? text[text.length + index] : text[index];

const isDigit = (character: string | undefined): boolean => !!character && /[0-9]/.test(character);

const isEscapedDollar = (src: string, position: number): boolean => {
  let backslashes = 0;
  let back = position;
  while (back >= 0) {
    back -= 1;
    if (charAt(src, back) !== '\\') break;
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

/** `$...$` with no space inside the dollars and no digit outside them, as the runtime parses it. */
const mathInline =
  (md: MarkdownIt) =>
  (state: StateInline, silent: boolean): boolean => {
    const { src, pos } = state;
    if (src[pos] !== '$') return false;
    const after = src[pos + 1];
    if (after === undefined || md.utils.isWhiteSpace(after.charCodeAt(0))) return false;
    if (isDigit(charAt(src, pos - 1)) || isEscapedDollar(src, pos)) return false;
    let end = src.indexOf('$', pos + 1);
    while (end !== -1 && isEscapedDollar(src, end)) end = src.indexOf('$', end + 1);
    if (end === -1) return false;
    if (md.utils.isWhiteSpace(src.charCodeAt(end - 1)) || isDigit(src[end + 1])) return false;
    const content = src.slice(pos + 1, end);
    if (!content) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = content;
      token.markup = '$';
    }
    state.pos = end + 1;
    return true;
  };

/** `$$` blocks, which may span blank lines, as the runtime parses them. */
const mathBlock = (state: StateBlock, startLine: number, endLine: number): boolean => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const { src } = state;
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  let end = state.eMarks[startLine];
  if (startPos + 2 > end || src[startPos] !== '$' || src[startPos + 1] !== '$') return false;
  const closes = (lineText: string) => lineText.trim().endsWith('$$');
  const closingEnd = (lineEnd: number, lineText: string) =>
    lineEnd - 2 - (lineText.length - lineText.trim().length);
  let nextLine = startLine;
  let lineText = src.slice(startPos, end);
  let closed = lineText.trim().length > 3 && closes(lineText);
  if (closed) end = closingEnd(end, lineText);
  // An opener with no closing line before `endLine` means no later opener has one either, so each render
  // scans to `endLine` once instead of once per unclosed opener.
  state.env.mathUnclosedFrom ??= new Map<number, number>();
  const unclosedFrom: Map<number, number> = state.env.mathUnclosedFrom;
  if (!closed && startLine >= (unclosedFrom.get(endLine) ?? Infinity)) return false;
  while (!closed) {
    nextLine += 1;
    if (nextLine >= endLine) {
      unclosedFrom.set(endLine, startLine);
      return false;
    }
    end = state.eMarks[nextLine];
    lineText = src.slice(state.bMarks[nextLine] + state.tShift[nextLine], end);
    closed = closes(lineText);
    if (closed) end = closingEnd(end, lineText);
  }
  state.line = nextLine + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = src.slice(startPos + 2, end);
  token.markup = '$$';
  token.map = [startLine, state.line];
  return true;
};

const buildRenderer = (MarkdownItConstructor: typeof MarkdownIt): MarkdownIt => {
  // The runtime's sanitizer writes void tags without a closing slash.
  const md = new MarkdownItConstructor('commonmark', { breaks: true, xhtmlOut: false });
  md.enable(['table', 'strikethrough']);
  md.inline.ruler.before('escape', 'math_inline', mathInline(md));
  md.block.ruler.before('fence', 'math_block', mathBlock);
  md.renderer.rules.math_inline = (tokens, index) => escapeLikePython(`$${tokens[index].content}$`);
  md.renderer.rules.math_block = (tokens, index) =>
    `<div>${escapeLikePython(`$$\n${tokens[index].content.trim()}\n$$`)}</div>\n`;
  return md;
};

let renderer: MarkdownIt | undefined;
let loading: Promise<void> | undefined;
const readyListeners = new Set<() => void>();

/** Loads the renderer on first use, so the main bundle does not carry it. */
export const loadLiveMarkdown = (): Promise<void> => {
  loading ??= import('markdown-it').then(
    ({ default: MarkdownItConstructor }) => {
      renderer = buildRenderer(MarkdownItConstructor);
      readyListeners.forEach((listener) => listener());
    },
    (error: unknown) => {
      // A failed chunk load may succeed on a later attempt.
      loading = undefined;
      throw error;
    }
  );
  return loading;
};

/** The HTML for live Markdown, or undefined until the renderer has loaded. */
export const renderLiveMarkdown = (md: string): string | undefined =>
  renderer?.render(
    transformOutsideFencedCode(
      transformOutsideFencedCode(md.replace(/\r\n?/g, '\n'), escapeHtmlBlockOpeners),
      separateSupportedBlockHtml
    )
  );

const subscribeReady = (listener: () => void) => {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
};

const isReady = () => renderer !== undefined;

/** Whether `renderLiveMarkdown` renders yet; starts loading it when `wanted`. */
export const useLiveMarkdownReady = (wanted = true): boolean => {
  const ready = useSyncExternalStore(subscribeReady, isReady);
  useEffect(() => {
    if (wanted && !ready) loadLiveMarkdown().catch(() => undefined);
  }, [ready, wanted]);
  return ready;
};
