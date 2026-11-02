import { Element, Text as DOMText, htmlToDOM } from 'html-react-parser';
import type { DOMNode } from 'html-react-parser';
import {
  escapeMarkdownInlineSequences,
  parseBlockMD,
  parseInlineMD,
  unescapeMarkdownInlineSequences,
} from '../../plugins/markdown';
import { findDisplayLatexBlockMatch } from '../../plugins/math';
import { CodeBlockRule } from '../../plugins/markdown/block/rules';
import { sanitizeText } from '../../utils/sanitize';
import {
  formatMindroomPasteMarkerAsHtml,
  formatMindroomPasteMarkerTextAsHtml,
  parseMindroomPasteMarker,
} from './pasteAttachmentMarker';

export type MindroomToolRefParseResult = {
  toolName: string;
  index: number;
  pending: boolean;
};

export const MINDROOM_TOOL_REF_ICON = '🔧';

// Contract for matching formatted_body markers emitted by the server (v2).
export const MINDROOM_TOOL_REF_HTML_REG_G = /🔧 <code>([^<]+)<\/code> \[(\d+)\]( ⏳)?/g;

const MINDROOM_TOOL_REF_TEXT_REG = /^\s*🔧\s+`([^`]+)`\s+\[(\d+)\](?:\s+(⏳))?\s*$/u;

const parseToolRefMatch = (match: RegExpExecArray): MindroomToolRefParseResult | undefined => {
  const toolName = match[1]?.trim();
  const index = Number(match[2]);

  if (!toolName || !Number.isInteger(index) || index < 1) return undefined;

  return {
    toolName,
    index,
    pending: Boolean(match[3]),
  };
};

export const parseMindroomToolRefHtml = (html: string): MindroomToolRefParseResult | undefined => {
  const normalized = html.trim();
  MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;

  const match = MINDROOM_TOOL_REF_HTML_REG_G.exec(normalized);
  if (!match || match[0] !== normalized) return undefined;

  return parseToolRefMatch(match);
};

export const parseMindroomToolRefText = (text: string): MindroomToolRefParseResult | undefined => {
  const match = MINDROOM_TOOL_REF_TEXT_REG.exec(text);
  if (!match) return undefined;
  return parseToolRefMatch(match);
};

const escapeHtmlText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMindroomToolRefLineAsHtml = (line: string): string | undefined => {
  const toolRef = parseMindroomToolRefText(line);
  if (!toolRef) return undefined;

  return `<p>🔧 <code>${escapeHtmlText(toolRef.toolName)}</code> [${toolRef.index}]${
    toolRef.pending ? ' ⏳' : ''
  }</p>`;
};

// The in-repo parser recurses per block match, so remote preview bodies need a
// conservative boundary below the browser stack limit.
const MAX_MARKDOWN_PREVIEW_BLOCK_LINES = 512;
const MAX_MARKDOWN_PREVIEW_INLINE_MARKERS = 512;
const MARKDOWN_PREVIEW_BLOCK_LINE_REG =
  /^(?:#{1,6} |>|\$\$| {0,3}(?:`{3,}|~{3,})| *(?:[-*]|[\dA-Za-z]+\.) )/gm;
const MARKDOWN_LIST_ITEM_REG = /^( *)([-*]|[\dA-Za-z]\.)( +)(.+)$/;

const sanitizeMarkdownText = (text: string): string => sanitizeText(text).replace(/^&gt;/gm, '>');

const normalizeParsedMathEntities = (html: string): string =>
  html.replace(/<(span|div) data-mx-maths="[^"]*">[\s\S]*?<\/\1>/g, (mathHtml) =>
    mathHtml.replace(/&amp;(amp|lt|gt|quot|#39);/g, '&$1;')
  );

type MarkdownProtectedBlock = {
  start: number;
  end: number;
};

const findNextMarkdownProtectedBlock = (markdown: string): MarkdownProtectedBlock | undefined => {
  const codeMatch = CodeBlockRule.match(markdown);
  const codeBlock =
    codeMatch && codeMatch.index !== undefined
      ? { start: codeMatch.index, end: codeMatch.index + codeMatch[0].length }
      : undefined;
  const mathMatch = findDisplayLatexBlockMatch(markdown);
  const mathBlock = mathMatch ? { start: mathMatch.start, end: mathMatch.end } : undefined;

  if (!codeBlock) return mathBlock;
  if (!mathBlock) return codeBlock;
  return codeBlock.start <= mathBlock.start ? codeBlock : mathBlock;
};

const mapMarkdownOutsideParserBlocks = (
  markdown: string,
  mapUnprotected: (text: string) => string,
  mapProtected: (text: string) => string = (text) => text
): string => {
  let cursor = 0;
  let output = '';

  while (cursor < markdown.length) {
    const remaining = markdown.slice(cursor);
    const protectedBlock = findNextMarkdownProtectedBlock(remaining);
    if (!protectedBlock) {
      output += mapUnprotected(remaining);
      break;
    }

    output += mapUnprotected(remaining.slice(0, protectedBlock.start));
    output += mapProtected(remaining.slice(protectedBlock.start, protectedBlock.end));
    cursor += protectedBlock.end;
  }

  return output;
};

const normalizeMarkdownDashLists = (markdown: string): string =>
  mapMarkdownOutsideParserBlocks(markdown, (text) =>
    text
      .split('\n')
      .map((line) => {
        const listItem = line.match(MARKDOWN_LIST_ITEM_REG);
        if (!listItem || listItem[2] !== '-') return line;

        return `${listItem[1]}*${listItem[3]}${listItem[4]}`;
      })
      .join('\n')
  );

const isDomTextNode = (node: DOMNode): node is DOMText => node.type === 'text';

const isDomElementNode = (node: DOMNode): node is Element => node.type === 'tag';

const extractDomText = (nodes: DOMNode[]): string =>
  nodes
    .map((node) => {
      if (isDomTextNode(node)) return node.data;
      if (isDomElementNode(node)) return extractDomText(node.children as DOMNode[]);
      return '';
    })
    .join('');

const listItemCanFlattenToToolRefPrefix = (markdown: string): boolean => {
  if (!markdown.includes(MINDROOM_TOOL_REF_ICON)) return false;

  const parsedInline = parseInlineMD(sanitizeMarkdownText(markdown.trimStart()));
  let flattenedInline = '';
  for (const node of htmlToDOM(parsedInline)) {
    if (isDomTextNode(node)) {
      flattenedInline += node.data;
    } else if (isDomElementNode(node) && node.name === 'code') {
      flattenedInline += `<code>${extractDomText(node.children as DOMNode[])}</code>`;
    } else if (isDomElementNode(node) && node.name === 'span') {
      flattenedInline += extractDomText(node.children as DOMNode[]);
    } else {
      break;
    }
  }

  MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;
  const match = MINDROOM_TOOL_REF_HTML_REG_G.exec(flattenedInline.trim());
  if (match?.index !== 0) return false;
  return parseMindroomToolRefHtml(match[0]) !== undefined;
};

const preserveListContainedToolMarkers = (markdown: string): string =>
  mapMarkdownOutsideParserBlocks(markdown, (text) =>
    text
      .split('\n')
      .map((line) => {
        const listItem = line.match(MARKDOWN_LIST_ITEM_REG);
        if (!listItem || !listItemCanFlattenToToolRefPrefix(listItem[4])) return line;

        return `${listItem[1]}${listItem[2]}${listItem[3]}${escapeMarkdownInlineSequences(
          unescapeMarkdownInlineSequences(listItem[4])
        )}`;
      })
      .join('\n')
  );

const exceedsInlineMarkerBudget = (text: string): boolean => {
  let markerCount = 0;
  for (const character of text) {
    if (!'*_~`|$['.includes(character)) continue;
    markerCount += 1;
    if (markerCount > MAX_MARKDOWN_PREVIEW_INLINE_MARKERS) return true;
  }
  return false;
};

const hasAmbiguousMarkdownMarkerContext = (lines: string[]): boolean =>
  lines.some((line) => {
    if (line === line.trim() && parseMindroomToolRefText(line)) return false;

    const unescapedMarkerText = line.replace(/\\([`~])/g, '');
    return unescapedMarkerText.includes('``') || unescapedMarkerText.includes('~~~');
  });

const formatStandaloneMindroomMarkerAsHtml = (
  line: string,
  allowRichMarkers: boolean
): string | undefined => {
  if (!allowRichMarkers || line !== line.trim()) return undefined;

  const toolHtml = formatMindroomToolRefLineAsHtml(line);
  if (toolHtml) return toolHtml;

  const pasteMarker = parseMindroomPasteMarker(line);
  return pasteMarker ? `<p>${formatMindroomPasteMarkerAsHtml(pasteMarker)}</p>` : undefined;
};

export const formatMindroomMessageTextBodyAsHtml = (body: string): string | undefined => {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const htmlParts: string[] = [];
  let paragraphLines: string[] = [];
  let hasMindroomMarker = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    htmlParts.push(`<p>${paragraphLines.map(escapeHtmlText).join('<br/>')}</p>`);
    paragraphLines = [];
  };

  lines.forEach((line) => {
    const markerHtml =
      formatMindroomToolRefLineAsHtml(line) ?? formatMindroomPasteMarkerTextAsHtml(line);
    if (markerHtml) {
      flushParagraph();
      hasMindroomMarker = true;
      htmlParts.push(markerHtml);
      return;
    }

    if (line.trim() === '') {
      flushParagraph();
      return;
    }

    paragraphLines.push(line);
  });

  flushParagraph();

  return hasMindroomMarker ? htmlParts.join('') : undefined;
};

const formatMarkdownPreviewSegment = (body: string, allowRichMarkers: boolean): string => {
  const lines = body.split('\n');
  const htmlParts: string[] = [];
  let markdownLines: string[] = [];

  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    const markdown = markdownLines.join('\n');
    if (!markdown.trim()) {
      markdownLines = [];
      return;
    }

    const normalizedMarkdown = normalizeMarkdownDashLists(markdown);
    const literalMarkerMarkdown = preserveListContainedToolMarkers(normalizedMarkdown);
    const parsedHtml = parseBlockMD(sanitizeMarkdownText(literalMarkerMarkdown), parseInlineMD);
    htmlParts.push(normalizeParsedMathEntities(parsedHtml));
    markdownLines = [];
  };

  lines.forEach((line, index) => {
    // Promote root separators isolated by blank lines or recognized code/math
    // blocks (segment boundaries). Ambiguous fence content remains literal.
    const separator =
      allowRichMarkers &&
      /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line) &&
      (index === 0 || lines[index - 1].trim() === '') &&
      (index === lines.length - 1 || lines[index + 1].trim() === '');
    const markerHtml = separator
      ? '<hr/>'
      : formatStandaloneMindroomMarkerAsHtml(line, allowRichMarkers);
    if (markerHtml) {
      flushMarkdown();
      htmlParts.push(markerHtml);
      return;
    }

    markdownLines.push(line);
  });

  flushMarkdown();
  return htmlParts.join('');
};

export const formatMindroomMarkdownTextBodyAsHtml = (body: string): string => {
  const normalizedBody = body.replace(/\r\n?/g, '\n');
  // Standalone tool markers become HTML without the parser, so a reply with
  // many tool calls must not spend the parser's budget on them.
  const textWithoutToolMarkers = normalizedBody
    .split('\n')
    .filter((line) => line !== line.trim() || !parseMindroomToolRefText(line))
    .join('\n');
  const blockLineCount = body.match(MARKDOWN_PREVIEW_BLOCK_LINE_REG)?.length ?? 0;
  if (
    blockLineCount > MAX_MARKDOWN_PREVIEW_BLOCK_LINES ||
    exceedsInlineMarkerBudget(textWithoutToolMarkers)
  ) {
    return '';
  }

  try {
    const unprotected = mapMarkdownOutsideParserBlocks(
      normalizedBody,
      (text) => text,
      () => '\n'
    );
    const allowRichMarkers = !hasAmbiguousMarkdownMarkerContext(unprotected.split('\n'));
    // Without rich markers the tool marker lines reach the parser too.
    if (!allowRichMarkers && exceedsInlineMarkerBudget(normalizedBody)) {
      return '';
    }
    // Use the parser's own block boundaries so code/math examples stay literal,
    // without disabling real tool markers elsewhere in the preview.
    return mapMarkdownOutsideParserBlocks(
      normalizedBody,
      (text) => formatMarkdownPreviewSegment(text, allowRichMarkers),
      (block) =>
        normalizeParsedMathEntities(parseBlockMD(sanitizeMarkdownText(block), parseInlineMD))
    );
  } catch {
    return '';
  }
};
