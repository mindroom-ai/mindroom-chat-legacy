import type { HTMLReactParserOptions } from 'html-react-parser';

/**
 * Parser options, or a function that makes them, called once per parse, for options that keep
 * state while they parse.
 */
export type HtmlReactParserOptionsSource = HTMLReactParserOptions | (() => HTMLReactParserOptions);

export const resolveHtmlReactParserOptions = (
  source: HtmlReactParserOptionsSource
): HTMLReactParserOptions => (typeof source === 'function' ? source() : source);
