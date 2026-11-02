import React, { useMemo } from 'react';
import parse from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { MessageEmptyContent } from './content';
import { sanitizeCustomHtml } from '../../utils/sanitize';
import { renderTextWithLatex } from '../../plugins/react-custom-html-parser';
import { useClientConfig } from '../../hooks/useClientConfig';
import {
  type HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../../utils/htmlReactParserOptions';

type RenderBodyProps = {
  body: string;
  customBody?: string;

  highlightRegex?: RegExp;
  htmlReactParserOptions: HtmlReactParserOptionsSource;
  linkifyOpts: Opts;
};
export function RenderBody({
  body,
  customBody,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
}: RenderBodyProps) {
  const { messageRendering } = useClientConfig();
  const additionalAllowedUriSchemes = messageRendering?.additionalAllowedUriSchemes;

  // Sanitizing + parsing message HTML is expensive; timeline re-renders (e.g.
  // streaming m.replace bursts) must not re-parse unchanged bodies.
  return useMemo(() => {
    // A formatted body wins even when the plain-text fallback is empty.
    if (customBody) {
      return parse(
        sanitizeCustomHtml(customBody, { additionalAllowedUriSchemes }),
        resolveHtmlReactParserOptions(htmlReactParserOptions)
      );
    }
    if (body === '') return <MessageEmptyContent />;
    return renderTextWithLatex(body, {
      linkify: true,
      linkifyOpts,
      highlightRegex,
      keyPrefix: 'body',
    });
  }, [
    additionalAllowedUriSchemes,
    body,
    customBody,
    highlightRegex,
    htmlReactParserOptions,
    linkifyOpts,
  ]);
}
