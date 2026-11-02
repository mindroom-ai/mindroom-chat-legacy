import { useTranslation } from 'react-i18next';
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Spinner, Text as FText, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';

import { MEmote, MNotice, MText } from '../../components/message/MsgTypeRenderers';
import {
  MindroomLongTextSource,
  getCachedMindroomLongTextContent,
  getMindroomLongTextSourceIdentity,
  withMindroomToolTraceFallback,
} from './longText';
import { MindroomToolMetadataStatus } from './toolTrace';
import { hydrateCachedMindroomLongText } from './attachmentRepository';

export enum MindroomLongTextKind {
  Text = 'text',
  Emote = 'emote',
  Notice = 'notice',
}

const LOADING_INDICATOR_DELAY_MS = 350;

type RenderBodyProps = {
  body: string;
  customBody?: string;
};

type MindroomLongTextTextProps = {
  kind: MindroomLongTextKind;
  displayName?: string;
  edited?: boolean;
  renderStateSuffix?: () => ReactNode;
  content: Record<string, unknown>;
  longTextSource: MindroomLongTextSource;
  renderBody: (
    content: Record<string, unknown>,
    props: RenderBodyProps,
    toolMetadataStatus: MindroomToolMetadataStatus
  ) => ReactNode;
  renderAfterBody?: (
    content: Record<string, unknown>,
    fallbackContent: Record<string, unknown>
  ) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  hydrate?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getStringValue = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const hasRenderableFormattedBody = (value: Record<string, unknown>): boolean =>
  typeof value.formatted_body === 'string' && value.formatted_body.length > 0;

export const shouldResetResolvedContentToPreview = (
  nextPreviewContent: Record<string, unknown>,
  currentResolvedContent: Record<string, unknown>
): boolean => {
  if (hasRenderableFormattedBody(nextPreviewContent)) {
    return true;
  }
  return !hasRenderableFormattedBody(currentResolvedContent);
};

export const getMindroomLongTextHydrationIdentity = (
  content: Record<string, unknown>,
  source: Pick<MindroomLongTextSource, 'encryptedFile' | 'isV2ContentJson' | 'mxcUri' | 'owner'>
): string => {
  const info = isRecord(content.info) ? content.info : undefined;
  const meta = isRecord(content['io.mindroom.long_text'])
    ? content['io.mindroom.long_text']
    : undefined;

  return JSON.stringify({
    owner: source.owner,
    body: getStringValue(content, 'body'),
    encryptedFileHashes: isRecord(source.encryptedFile?.hashes)
      ? JSON.stringify(source.encryptedFile.hashes)
      : undefined,
    encryptedFileIv: source.encryptedFile?.iv,
    encryptedFileKey: isRecord(source.encryptedFile?.key)
      ? JSON.stringify(source.encryptedFile.key)
      : undefined,
    encryptedFileUrl: source.encryptedFile?.url,
    encryptedFileVersion: source.encryptedFile?.v,
    filename: getStringValue(content, 'filename'),
    format: getStringValue(content, 'format'),
    formattedBody: getStringValue(content, 'formatted_body'),
    infoMimetype: typeof info?.mimetype === 'string' ? info.mimetype : undefined,
    isV2ContentJson: source.isV2ContentJson,
    longTextEncoding: typeof meta?.encoding === 'string' ? meta.encoding : undefined,
    longTextVersion: typeof meta?.version === 'number' ? meta.version : undefined,
    msgtype: getStringValue(content, 'msgtype'),
    mxcUri: source.mxcUri,
    url: getStringValue(content, 'url'),
  });
};

export const useMindroomLongTextResolvedContent = (
  source: MindroomLongTextSource | undefined,
  enabled: boolean
): Record<string, unknown> | undefined => {
  const mx = useMatrixClient();
  const sourceIdentity = source ? getMindroomLongTextSourceIdentity(source) : undefined;
  const [resolvedEntry, setResolvedEntry] = useState<
    { sourceIdentity: string; content: Record<string, unknown> } | undefined
  >(() => {
    if (!source) return undefined;
    const cachedContent = getCachedMindroomLongTextContent(source, mx);
    return cachedContent && sourceIdentity ? { sourceIdentity, content: cachedContent } : undefined;
  });

  useEffect(() => {
    if (!source) {
      setResolvedEntry(undefined);
      return undefined;
    }

    const cachedContent = getCachedMindroomLongTextContent(source, mx);
    if (cachedContent) {
      setResolvedEntry({
        sourceIdentity: getMindroomLongTextSourceIdentity(source),
        content: cachedContent,
      });
      if (!source.owner) return undefined;
    }

    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const nextContent = await hydrateCachedMindroomLongText(mx, source);

      if (!cancelled) {
        setResolvedEntry({
          sourceIdentity: getMindroomLongTextSourceIdentity(source),
          content: nextContent,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, mx, source, sourceIdentity]);

  if (sourceIdentity && resolvedEntry?.sourceIdentity === sourceIdentity) {
    return resolvedEntry.content;
  }

  return source ? getCachedMindroomLongTextContent(source, mx) : undefined;
};

export function MindroomLongTextText({
  kind,
  displayName,
  edited,
  renderStateSuffix,
  content,
  longTextSource,
  renderBody,
  renderAfterBody,
  renderUrlsPreview,
  hydrate = true,
}: MindroomLongTextTextProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { encryptedFile, isV2ContentJson, mxcUri, owner } = longTextSource;
  const hydrationIdentity = getMindroomLongTextHydrationIdentity(content, longTextSource);
  const hydrationInputRef = useRef({
    content,
    encryptedFile,
    isV2ContentJson,
    mxcUri,
    owner,
  });
  const [loading, setLoading] = useState(
    () => hydrate && !getCachedMindroomLongTextContent(longTextSource, mx)
  );
  const [settledHydrationIdentity, setSettledHydrationIdentity] = useState<string>();
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  // Prewarmed rows must render hydrated on their FIRST paint: initialize
  // from the cache synchronously instead of flashing the preview until the
  // post-paint hydration effect runs. Gated on `hydrate` so overscan rows
  // keep the cheap preview (PR #110's guard) even when their sidecar is
  // already warm.
  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown>>(
    () => (hydrate ? getCachedMindroomLongTextContent(longTextSource, mx) : undefined) ?? content
  );

  hydrationInputRef.current = {
    content,
    encryptedFile,
    isV2ContentJson,
    mxcUri,
    owner,
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateContent = async () => {
      const {
        content: currentContent,
        encryptedFile: currentEncryptedFile,
        isV2ContentJson: currentIsV2ContentJson,
        mxcUri: currentMxcUri,
        owner: currentOwner,
      } = hydrationInputRef.current;

      if (hydrate) {
        // Warm cache: resolve synchronously — no preview reset, no async
        // round-trip, no loading state.
        const cachedContent = getCachedMindroomLongTextContent(
          {
            previewContent: currentContent,
            encryptedFile: currentEncryptedFile,
            isV2ContentJson: currentIsV2ContentJson,
            mxcUri: currentMxcUri,
          },
          mx
        );
        if (cachedContent) {
          setResolvedContent(cachedContent);
          setLoading(false);
          if (currentOwner)
            await hydrateCachedMindroomLongText(mx, {
              previewContent: currentContent,
              encryptedFile: currentEncryptedFile,
              isV2ContentJson: currentIsV2ContentJson,
              mxcUri: currentMxcUri,
              owner: currentOwner,
            });
          return;
        }
      }

      setResolvedContent((currentResolvedContent) =>
        !hydrate || shouldResetResolvedContentToPreview(currentContent, currentResolvedContent)
          ? withMindroomToolTraceFallback(currentContent, currentResolvedContent)
          : currentResolvedContent
      );

      if (!hydrate) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const nextContent = await hydrateCachedMindroomLongText(mx, {
        previewContent: currentContent,
        encryptedFile: currentEncryptedFile,
        isV2ContentJson: currentIsV2ContentJson,
        mxcUri: currentMxcUri,
        owner: currentOwner,
      });

      if (!cancelled) {
        setResolvedContent(nextContent);
        setSettledHydrationIdentity(hydrationIdentity);
        setLoading(false);
      }
    };

    hydrateContent();

    return () => {
      cancelled = true;
    };
  }, [hydrate, hydrationIdentity, mx]);

  useEffect(() => {
    if (!loading) {
      setShowLoadingIndicator(false);
      return undefined;
    }

    const timerId = setTimeout(() => {
      setShowLoadingIndicator(true);
    }, LOADING_INDICATOR_DELAY_MS);

    return () => {
      clearTimeout(timerId);
    };
  }, [loading]);

  // Render-time warm-cache read: a row that mounted cold (hydrate=false)
  // and later flips to hydrate=true must show cached content on the flip's
  // OWN render, not one effect-pass later (the mount initializer and the
  // hydration effect only cover mount and post-paint). Pure read of the
  // module cache for the current source; the effect converges state to the
  // same value.
  const warmResolvedContent = hydrate
    ? getCachedMindroomLongTextContent(longTextSource, mx)
    : undefined;
  const displayContent = warmResolvedContent ?? resolvedContent;
  const toolMetadataStatus: MindroomToolMetadataStatus =
    !warmResolvedContent && (loading || !hydrate || settledHydrationIdentity !== hydrationIdentity)
      ? 'loading'
      : 'unavailable';

  const afterBody = renderAfterBody?.(content, displayContent);

  let textContent: ReactNode;
  if (kind === MindroomLongTextKind.Emote) {
    textContent = (
      <MEmote
        displayName={displayName ?? ''}
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={displayContent}
        renderBody={(props) => renderBody(displayContent, props, toolMetadataStatus)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else if (kind === MindroomLongTextKind.Notice) {
    textContent = (
      <MNotice
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={displayContent}
        renderBody={(props) => renderBody(displayContent, props, toolMetadataStatus)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  } else {
    textContent = (
      <MText
        edited={edited}
        renderStateSuffix={renderStateSuffix}
        content={displayContent}
        renderBody={(props) => renderBody(displayContent, props, toolMetadataStatus)}
        renderAfterBody={afterBody}
        renderUrlsPreview={renderUrlsPreview}
      />
    );
  }

  return (
    <>
      {textContent}
      {showLoadingIndicator && (
        <Box alignItems="Center" gap="100" style={{ marginTop: config.space.S100 }}>
          <Spinner size="100" variant="Secondary" />
          <FText size="T200">
            {t('mindroomUi.messages.mindroomLongTextText.loadingFullResponse')}
          </FText>
        </Box>
      )}
    </>
  );
}
