import { useTranslation } from 'react-i18next';
import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import {
  Badge,
  Box,
  Button,
  Chip,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  as,
} from 'folds';
import classNames from 'classnames';
import { BlurhashCanvas } from 'react-blurhash';
import FocusTrap from 'focus-trap-react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { Modal } from '../../glass/GlassPrimitives';
import { IImageInfo, MATRIX_BLUR_HASH_PROPERTY_NAME } from '../../../../types/matrix/common';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import * as css from './style.css';
import { bytesToSize } from '../../../utils/common';
import { getImageBlobSafeMimeType } from '../../../utils/mimeTypes';
import { stopPropagation } from '../../../utils/keyboard';
import { downloadCachedAttachment } from '../../../mindroom/messages/attachmentRepository';
import { imageViewerOpenAtom } from '../../../state/imageViewer';
import { ModalWide } from '../../../styles/Modal.css';
import { validBlurHash } from '../../../utils/blurHash';

const IMAGE_VIEWER_HISTORY_MARKER = '__cinnyImageViewer';

type RenderViewerProps = {
  src: string;
  alt: string;
  requestClose: () => void;
};
type RenderImageProps = {
  alt: string;
  title: string;
  src: string;
  onLoad: () => void;
  onError: () => void;
  onClick: () => void;
  tabIndex: number;
};
export type ImageContentProps = {
  owner?: EventAttachmentOwner;
  body: string;
  mimeType?: string;
  url: string;
  info?: IImageInfo;
  encInfo?: EncryptedAttachmentInfo;
  autoPlay?: boolean;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
  renderViewer: (props: RenderViewerProps) => ReactNode;
  renderImage: (props: RenderImageProps) => ReactNode;
};
export const ImageContent = as<'div', ImageContentProps>(
  (
    {
      owner,
      className,
      body,
      mimeType,
      url,
      info,
      encInfo,
      autoPlay,
      markedAsSpoiler,
      spoilerReason,
      renderViewer,
      renderImage,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const blurHash = validBlurHash(info?.[MATRIX_BLUR_HASH_PROPERTY_NAME]);

    const [load, setLoad] = useState(false);
    const [error, setError] = useState(false);
    const [viewer, setViewer] = useState(false);
    const [blurred, setBlurred] = useState(markedAsSpoiler ?? false);
    const setImageViewerOpen = useSetAtom(imageViewerOpenAtom);

    const [srcState, loadSrc] = useAsyncCallback(
      useCallback(async () => {
        const fileContent = await downloadCachedAttachment(mx, {
          owner,
          mxcUri: url,
          mimeType: getImageBlobSafeMimeType(mimeType),
          encryptedFile: encInfo ? { ...encInfo, url } : undefined,
        });
        return URL.createObjectURL(fileContent);
      }, [owner, mx, url, mimeType, encInfo]),
      revokeBlobUrl
    );
    useBlobUrlCleanup(srcState);

    const handleLoad = () => {
      setLoad(true);
    };
    const handleError = () => {
      setLoad(false);
      setError(true);
    };

    const handleRetry = () => {
      setError(false);
      loadSrc();
    };

    useEffect(() => {
      if (autoPlay) loadSrc();
    }, [autoPlay, loadSrc]);

    useEffect(() => {
      if (!viewer) return undefined;

      setImageViewerOpen(true);
      window.history.pushState(
        {
          ...(window.history.state ?? {}),
          [IMAGE_VIEWER_HISTORY_MARKER]: true,
        },
        ''
      );

      let poppedByBrowser = false;

      const handlePopState = () => {
        poppedByBrowser = true;
        setViewer(false);
      };

      const handlePageHide = () => {
        if (!window.history.state?.[IMAGE_VIEWER_HISTORY_MARKER]) return;

        const nextState = { ...(window.history.state ?? {}) };
        delete nextState[IMAGE_VIEWER_HISTORY_MARKER];
        window.history.replaceState(nextState, '');
      };

      window.addEventListener('popstate', handlePopState);
      window.addEventListener('pagehide', handlePageHide);

      return () => {
        window.removeEventListener('popstate', handlePopState);
        window.removeEventListener('pagehide', handlePageHide);
        setImageViewerOpen(false);

        if (!poppedByBrowser && window.history.state?.[IMAGE_VIEWER_HISTORY_MARKER]) {
          window.history.back();
        }
      };
    }, [viewer, setImageViewerOpen]);

    return (
      <Box className={classNames(css.RelativeBase, className)} {...props} ref={ref}>
        {srcState.status === AsyncStatus.Success && (
          <Overlay open={viewer} backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setViewer(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Modal
                  className={ModalWide}
                  size="500"
                  onContextMenu={(evt: any) => evt.stopPropagation()}
                >
                  {renderViewer({
                    src: srcState.data,
                    alt: body,
                    requestClose: () => setViewer(false),
                  })}
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
        {typeof blurHash === 'string' && !load && (
          <BlurhashCanvas
            style={{ width: '100%', height: '100%' }}
            width={32}
            height={32}
            hash={blurHash}
            punch={1}
          />
        )}
        {!autoPlay && !markedAsSpoiler && srcState.status === AsyncStatus.Idle && (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <Button
              variant="Secondary"
              fill="Soft"
              radii="300"
              size="300"
              onClick={loadSrc}
              before={<Icon size="Inherit" src={Icons.Photo} filled />}
              outlined
            >
              <Text size="B300">{t('sharedUi.imageContent.view')}</Text>
            </Button>
          </Box>
        )}
        {srcState.status === AsyncStatus.Success && (
          <Box className={classNames(css.AbsoluteContainer, blurred && css.Blur)}>
            {renderImage({
              alt: body,
              title: body,
              src: srcState.data,
              onLoad: handleLoad,
              onError: handleError,
              onClick: () => setViewer(true),
              tabIndex: 0,
            })}
          </Box>
        )}
        {blurred && !error && srcState.status !== AsyncStatus.Error && (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <TooltipProvider
              tooltip={
                typeof spoilerReason === 'string' && (
                  <Tooltip variant="Secondary">
                    <Text>{spoilerReason}</Text>
                  </Tooltip>
                )
              }
              position="Top"
              align="Center"
            >
              {(triggerRef) => (
                <Chip
                  ref={triggerRef}
                  variant="Secondary"
                  radii="Pill"
                  size="500"
                  outlined
                  onClick={() => {
                    setBlurred(false);
                    if (srcState.status === AsyncStatus.Idle) {
                      loadSrc();
                    }
                  }}
                >
                  <Text size="B300">{t('sharedUi.imageContent.spoiler')}</Text>
                </Chip>
              )}
            </TooltipProvider>
          </Box>
        )}
        {(srcState.status === AsyncStatus.Loading || srcState.status === AsyncStatus.Success) &&
          !load &&
          !blurred && (
            <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
              <Spinner variant="Secondary" />
            </Box>
          )}
        {(error || srcState.status === AsyncStatus.Error) && (
          <Box className={css.AbsoluteContainer} alignItems="Center" justifyContent="Center">
            <TooltipProvider
              tooltip={
                <Tooltip variant="Critical">
                  <Text>{t('sharedUi.imageContent.failedToLoadImage')}</Text>
                </Tooltip>
              }
              position="Top"
              align="Center"
            >
              {(triggerRef) => (
                <Button
                  ref={triggerRef}
                  size="300"
                  variant="Critical"
                  fill="Soft"
                  outlined
                  radii="300"
                  onClick={handleRetry}
                  before={<Icon size="Inherit" src={Icons.Warning} filled />}
                >
                  <Text size="B300">{t('sharedUi.imageContent.retry')}</Text>
                </Button>
              )}
            </TooltipProvider>
          </Box>
        )}
        {!load && typeof info?.size === 'number' && (
          <Box className={css.AbsoluteFooter} justifyContent="End" alignContent="Center" gap="200">
            <Badge variant="Secondary" fill="Soft">
              <Text size="L400">{bytesToSize(info.size)}</Text>
            </Badge>
          </Box>
        )}
      </Box>
    );
  }
);
