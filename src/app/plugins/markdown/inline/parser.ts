import {
  BoldRule,
  CodeRule,
  EscapeRule,
  InlineMathRule,
  ItalicRule1,
  ItalicRule2,
  LinkRule,
  SpoilerRule,
  StrikeRule,
  UnderlineRule,
} from './rules';
import { runInlineRules } from './runner';
import { InlineMDParser, InlineMDRule } from './type';

const LeveledRules = [
  InlineMathRule,
  BoldRule,
  ItalicRule1,
  UnderlineRule,
  ItalicRule2,
  StrikeRule,
  SpoilerRule,
  LinkRule,
  EscapeRule,
];

/**
 * Parses inline markdown text into HTML using only the given rules, in priority order.
 * Code spans are always parsed first, as in `parseInlineMD`.
 */
export const parseInlineMDWithRules = (text: string, rules: InlineMDRule[]): string => {
  if (text === '') return text;
  // Protect code contents without splitting the emphasis that surrounds them.
  // Choose a delimiter absent from the input so literal text cannot forge tokens.
  const usedPrefixes = new Set(
    text
      .split('\u0000')
      .slice(1)
      .map((part) => part.split(':', 1)[0])
  );
  let prefix = 0;
  while (usedPrefixes.has(String(prefix))) prefix += 1;
  const delimiter = `\u0000${prefix}:`;
  const codeSpans: { raw: string; html: string }[] = [];
  let remaining = text;
  let protectedText = '';
  let match = CodeRule.match(remaining);
  while (match && match.index !== undefined) {
    protectedText += `${remaining.slice(0, match.index)}${delimiter}${
      codeSpans.length
    }${delimiter}`;
    codeSpans.push({ raw: match[0], html: CodeRule.html((value) => value, match) });
    remaining = remaining.slice(match.index + match[0].length);
    match = CodeRule.match(remaining);
  }
  protectedText += remaining;

  const token = new RegExp(`${delimiter}(\\d+)${delimiter}`, 'g');
  const restore = (value: string, kind: 'raw' | 'html') =>
    value.replace(token, (original, index: string) => codeSpans[Number(index)]?.[kind] ?? original);
  const parse: InlineMDParser = (value) =>
    runInlineRules(value, rules, parse) ?? restore(value, 'html');

  // Rules such as links and math bypass parse for attributes and literal text.
  // Restore raw backticks there, never code HTML inside an attribute.
  return restore(parse(protectedText), 'raw');
};

/**
 * Parses inline markdown text into HTML using defined rules.
 *
 * @param text - The markdown text to be parsed.
 * @returns The parsed HTML or the original text if no markdown was found.
 */
export const parseInlineMD: InlineMDParser = (text) => parseInlineMDWithRules(text, LeveledRules);
