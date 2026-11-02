import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { useMindroomToolTraceMarkerParserOptions } from '../mindroom/messages/MindroomHtmlBlocks';
import type { MindroomToolMetadataStatus } from '../mindroom/messages/toolTrace';
import {
  type HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../utils/htmlReactParserOptions';

/** What `useMindroomToolTraceMarkerParserOptions` gives a message with this content. */
export const renderMarkerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  content: Record<string, unknown>,
  metadataStatus?: MindroomToolMetadataStatus
): HtmlReactParserOptionsSource => {
  let source: HtmlReactParserOptionsSource = baseOpts;
  function Probe() {
    source = useMindroomToolTraceMarkerParserOptions(baseOpts, content, metadataStatus);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return source;
};

/** The parser options for one parse of a message with this content, as RenderBody gets them. */
export const markerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  content: Record<string, unknown>,
  metadataStatus?: MindroomToolMetadataStatus
): HTMLReactParserOptions =>
  resolveHtmlReactParserOptions(renderMarkerParserOptions(baseOpts, content, metadataStatus));
