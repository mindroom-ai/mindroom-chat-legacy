import { useTranslation } from 'react-i18next';
import React, { useCallback, useMemo, useRef } from 'react';
import parse, { type HTMLReactParserOptions } from 'html-react-parser';
import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { sanitizeCustomHtml, sanitizeText } from '../../utils/sanitize';
import {
  type HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../../utils/htmlReactParserOptions';
import {
  MINDROOM_MESSAGE_EXTRAS_TEXT_HTML,
  MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN,
  MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN,
  MindroomMessageExtras as MindroomMessageExtrasData,
  MindroomMessageExtrasSection,
} from './messageExtrasData';
import { sanitizeMindroomMessageExtraHtml } from './messageExtrasHtml';
import { useMindroomToolTraceMarkerParserOptions } from './MindroomHtmlBlocks';
import * as css from './MindroomMessageExtras.css';

type MindroomMessageExtraDetailsProps = React.DetailedHTMLProps<
  React.DetailsHTMLAttributes<HTMLDetailsElement>,
  HTMLDetailsElement
> & {
  defaultOpen: boolean;
};

type MindroomMessageExtrasProps = {
  extras: MindroomMessageExtrasData;
  htmlReactParserOptions: HTMLReactParserOptions;
  /** The content whose tool and paste markers the sections render. */
  markerContent: Record<string, unknown>;
};

const renderMarkdown = (content: string, htmlReactParserOptions: HtmlReactParserOptionsSource) => {
  const markdownHtml = parseBlockMD(sanitizeText(content), parseInlineMD);
  return parse(
    sanitizeCustomHtml(markdownHtml),
    resolveHtmlReactParserOptions(htmlReactParserOptions)
  );
};

const renderSectionContent = (
  content: string,
  contentType: MindroomMessageExtrasSection['contentType'],
  htmlReactParserOptions: HtmlReactParserOptionsSource
) => {
  try {
    if (contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_PLAIN) {
      return <pre className={css.PlainText}>{content}</pre>;
    }

    if (contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_MARKDOWN) {
      return <div className={css.Markdown}>{renderMarkdown(content, htmlReactParserOptions)}</div>;
    }

    if (contentType === MINDROOM_MESSAGE_EXTRAS_TEXT_HTML) {
      const sanitizedHtml = sanitizeMindroomMessageExtraHtml(content);
      return <div className={css.Html}>{parse(sanitizedHtml)}</div>;
    }
  } catch {
    return null;
  }

  return null;
};

type MindroomMessageExtraSectionContentProps = {
  content: string;
  contentType: MindroomMessageExtrasSection['contentType'];
  htmlReactParserOptions: HtmlReactParserOptionsSource;
};

// Sanitizing + parsing section markdown/HTML is expensive; timeline re-renders
// (e.g. streaming m.replace bursts) must not re-parse unchanged sections.
function MindroomMessageExtraSectionContent({
  content,
  contentType,
  htmlReactParserOptions,
}: MindroomMessageExtraSectionContentProps) {
  return useMemo(
    () => renderSectionContent(content, contentType, htmlReactParserOptions),
    [content, contentType, htmlReactParserOptions]
  );
}

const getSectionKey = (section: MindroomMessageExtrasSection, index: number): string =>
  `${index}:${section.title}:${section.contentType}`;

function MindroomMessageExtraDetails({ defaultOpen, ...props }: MindroomMessageExtraDetailsProps) {
  const initializedRef = useRef(false);
  const handleRef = useCallback(
    (node: HTMLDetailsElement | null) => {
      if (!node || initializedRef.current) return;

      node.open = defaultOpen;
      initializedRef.current = true;
    },
    [defaultOpen]
  );

  return <details {...props} ref={handleRef} />;
}

export function MindroomMessageExtras({
  extras,
  htmlReactParserOptions,
  markerContent,
}: MindroomMessageExtrasProps) {
  const { t } = useTranslation();
  const parserOptions = useMindroomToolTraceMarkerParserOptions(
    htmlReactParserOptions,
    markerContent
  );
  return (
    <div
      className={css.Extras}
      aria-label={t('mindroomUi.messages.mindroomMessageExtras.messageExtras')}
    >
      {extras.sections.map((section, index) => {
        const detailsProps: MindroomMessageExtraDetailsProps = {
          className: css.Section,
          defaultOpen: !section.collapsed,
        };

        return (
          <MindroomMessageExtraDetails key={getSectionKey(section, index)} {...detailsProps}>
            <summary className={css.Summary}>{section.title}</summary>
            <div className={css.Content}>
              <MindroomMessageExtraSectionContent
                content={section.content}
                contentType={section.contentType}
                htmlReactParserOptions={parserOptions}
              />
            </div>
          </MindroomMessageExtraDetails>
        );
      })}
    </div>
  );
}
