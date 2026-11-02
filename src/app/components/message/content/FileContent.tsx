import { useTranslation } from 'react-i18next';
import React, { ComponentProps, ReactNode, useCallback, useRef, useState } from 'react';
import {
  Box,
  Button,
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
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import FocusTrap from 'focus-trap-react';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { Modal } from '../../glass/GlassPrimitives';
import { IFileInfo } from '../../../../types/matrix/common';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { bytesToSize } from '../../../utils/common';
import {
  READABLE_EXT_TO_MIME_TYPE,
  READABLE_TEXT_MIME_TYPES,
  getFileNameExt,
  mimeTypeToExt,
} from '../../../utils/mimeTypes';
import { stopPropagation } from '../../../utils/keyboard';
import { downloadCachedAttachment } from '../../../mindroom/messages/attachmentRepository';
import { saveFile } from '../../../mindroom/native/nativeFileSave';
import { ModalWide } from '../../../styles/Modal.css';
import { FileIconButton } from '../FileHeader';

const renderErrorButton = (retry: () => void, text: string, errorLabel: string) => (
  <TooltipProvider
    tooltip={
      <Tooltip variant="Critical">
        <Text>{errorLabel}</Text>
      </Tooltip>
    }
    position="Top"
    align="Center"
  >
    {(triggerRef) => (
      <Button
        ref={triggerRef}
        size="400"
        variant="Critical"
        fill="Soft"
        outlined
        radii="300"
        onClick={retry}
        before={<Icon size="100" src={Icons.Warning} filled />}
      >
        <Text size="B400" truncate>
          {text}
        </Text>
      </Button>
    )}
  </TooltipProvider>
);

type RenderTextViewerProps = {
  name: string;
  text: string;
  langName: string;
  requestClose: () => void;
};
type FileActionButtonSize = ComponentProps<typeof Button>['size'];
type ReadTextFileProps = {
  owner?: EventAttachmentOwner;
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
  renderViewer: (props: RenderTextViewerProps) => ReactNode;
  buttonText?: string;
  errorButtonText?: string;
  buttonSize?: FileActionButtonSize;
  iconOnly?: boolean;
};
export function ReadTextFile({
  owner,
  body,
  mimeType,
  url,
  encInfo,
  renderViewer,
  buttonText,
  errorButtonText,
  buttonSize = '400',
  iconOnly = false,
}: ReadTextFileProps) {
  const { t } = useTranslation();
  const resolvedButtonText = buttonText ?? t('sharedUi.fileContent.openFile');
  const mx = useMatrixClient();
  const [textViewer, setTextViewer] = useState(false);

  const [textState, loadText] = useAsyncCallback(
    useCallback(async () => {
      const fileContent = await downloadCachedAttachment(mx, {
        owner,
        mxcUri: url,
        mimeType,
        encryptedFile: encInfo ? { ...encInfo, url } : undefined,
      });

      const text = fileContent.text();
      setTextViewer(true);
      return text;
    }, [owner, mx, mimeType, encInfo, url])
  );

  return (
    <>
      {textState.status === AsyncStatus.Success && (
        <Overlay open={textViewer} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setTextViewer(false),
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
                  name: body,
                  text: textState.data,
                  langName: READABLE_TEXT_MIME_TYPES.includes(mimeType)
                    ? mimeTypeToExt(mimeType)
                    : mimeTypeToExt(READABLE_EXT_TO_MIME_TYPE[getFileNameExt(body)] ?? mimeType),
                  requestClose: () => setTextViewer(false),
                })}
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
      {iconOnly ? (
        <FileIconButton
          label={t('sharedUi.fileContent.openValue1', { value1: body })}
          icon={Icons.External}
          onClick={() =>
            textState.status === AsyncStatus.Success ? setTextViewer(true) : loadText()
          }
          loading={textState.status === AsyncStatus.Loading}
          failedLabel={
            textState.status === AsyncStatus.Error
              ? t('sharedUi.fileContent.loadFailed')
              : undefined
          }
        />
      ) : textState.status === AsyncStatus.Error ? (
        renderErrorButton(
          loadText,
          errorButtonText ?? resolvedButtonText,
          t('sharedUi.fileContent.loadFailed')
        )
      ) : (
        <Button
          variant="Secondary"
          fill="Soft"
          radii="300"
          size={buttonSize}
          onClick={() =>
            textState.status === AsyncStatus.Success ? setTextViewer(true) : loadText()
          }
          disabled={textState.status === AsyncStatus.Loading}
          before={
            textState.status === AsyncStatus.Loading ? (
              <Spinner fill="Soft" size="100" variant="Secondary" />
            ) : (
              <Icon data-directional size="100" src={Icons.ArrowRight} filled />
            )
          }
          outlined
        >
          <Text size="B400" truncate>
            {resolvedButtonText}
          </Text>
        </Button>
      )}
    </>
  );
}

type RenderPdfViewerProps = {
  name: string;
  src: string;
  requestClose: () => void;
};
export type ReadPdfFileProps = {
  owner?: EventAttachmentOwner;
  body: string;
  mimeType: string;
  url: string;
  encInfo?: EncryptedAttachmentInfo;
  renderViewer: (props: RenderPdfViewerProps) => ReactNode;
  iconOnly?: boolean;
};
export function ReadPdfFile({
  owner,
  body,
  mimeType,
  url,
  encInfo,
  renderViewer,
  iconOnly = false,
}: ReadPdfFileProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [pdfViewer, setPdfViewer] = useState(false);

  const [pdfState, loadPdf] = useAsyncCallback(
    useCallback(async () => {
      const fileContent = await downloadCachedAttachment(mx, {
        owner,
        mxcUri: url,
        mimeType,
        encryptedFile: encInfo ? { ...encInfo, url } : undefined,
      });
      setPdfViewer(true);
      return URL.createObjectURL(fileContent);
    }, [owner, mx, url, mimeType, encInfo]),
    revokeBlobUrl
  );
  useBlobUrlCleanup(pdfState);

  return (
    <>
      {pdfState.status === AsyncStatus.Success && (
        <Overlay open={pdfViewer} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: () => setPdfViewer(false),
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
                  name: body,
                  src: pdfState.data,
                  requestClose: () => setPdfViewer(false),
                })}
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
      {iconOnly ? (
        <FileIconButton
          label={t('sharedUi.fileContent.openValue1', { value1: body })}
          icon={Icons.External}
          onClick={() => (pdfState.status === AsyncStatus.Success ? setPdfViewer(true) : loadPdf())}
          loading={pdfState.status === AsyncStatus.Loading}
          failedLabel={
            pdfState.status === AsyncStatus.Error ? t('sharedUi.fileContent.loadFailed') : undefined
          }
        />
      ) : pdfState.status === AsyncStatus.Error ? (
        renderErrorButton(
          loadPdf,
          t('sharedUi.fileContent.openPdf'),
          t('sharedUi.fileContent.loadFailed')
        )
      ) : (
        <Button
          variant="Secondary"
          fill="Soft"
          radii="300"
          size="400"
          onClick={() => (pdfState.status === AsyncStatus.Success ? setPdfViewer(true) : loadPdf())}
          disabled={pdfState.status === AsyncStatus.Loading}
          before={
            pdfState.status === AsyncStatus.Loading ? (
              <Spinner fill="Soft" size="100" variant="Secondary" />
            ) : (
              <Icon data-directional size="100" src={Icons.ArrowRight} filled />
            )
          }
          outlined
        >
          <Text size="B400" truncate>
            {t('sharedUi.fileContent.openPdf')}
          </Text>
        </Button>
      )}
    </>
  );
}

export type DownloadFileProps = {
  owner?: EventAttachmentOwner;
  body: string;
  mimeType: string;
  url: string;
  info: IFileInfo;
  encInfo?: EncryptedAttachmentInfo;
  buttonText?: string;
  errorButtonText?: string;
  buttonSize?: FileActionButtonSize;
};
export function DownloadFile({
  owner,
  body,
  mimeType,
  url,
  info,
  encInfo,
  buttonText,
  errorButtonText,
  buttonSize = '400',
}: DownloadFileProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const downloadedFileRef = useRef<{
    url: string;
    mimeType: string;
    encInfo?: EncryptedAttachmentInfo;
    ownerKey: string;
    blob: Blob;
  }>();

  const [downloadState, download] = useAsyncCallback(
    useCallback(async () => {
      const cachedFile = downloadedFileRef.current;
      let fileContent =
        cachedFile?.url === url &&
        cachedFile.mimeType === mimeType &&
        cachedFile.encInfo === encInfo &&
        cachedFile.ownerKey === JSON.stringify(owner)
          ? cachedFile.blob
          : undefined;
      if (!fileContent) {
        fileContent = await downloadCachedAttachment(mx, {
          owner,
          mxcUri: url,
          mimeType,
          encryptedFile: encInfo ? { ...encInfo, url } : undefined,
        });
        downloadedFileRef.current = {
          url,
          mimeType,
          encInfo,
          ownerKey: JSON.stringify(owner),
          blob: fileContent,
        };
      }

      await saveFile(fileContent, body);
      return fileContent;
    }, [owner, mx, url, mimeType, encInfo, body])
  );
  const handleDownload = () => {
    void download().catch(() => undefined);
  };
  return downloadState.status === AsyncStatus.Error ? (
    renderErrorButton(
      handleDownload,
      errorButtonText ??
        t('sharedUi.fileContent.retryDownload', { size: bytesToSize(info.size ?? 0) }),
      t('sharedUi.fileContent.loadFailed')
    )
  ) : (
    <Button
      variant="Secondary"
      fill="Soft"
      radii="300"
      size={buttonSize}
      onClick={handleDownload}
      disabled={downloadState.status === AsyncStatus.Loading}
      before={
        downloadState.status === AsyncStatus.Loading ? (
          <Spinner fill="Soft" size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={Icons.Download} filled />
        )
      }
      outlined
    >
      <Text size="B400" truncate>
        {buttonText ??
          t('sharedUi.fileContent.downloadSize', { size: bytesToSize(info.size ?? 0) })}
      </Text>
    </Button>
  );
}

type FileContentProps = {
  body: string;
  mimeType: string;
  renderAsTextFile: () => ReactNode;
  renderAsPdfFile: () => ReactNode;
};
export const FileContent = as<'div', FileContentProps>(
  ({ body, mimeType, renderAsTextFile, renderAsPdfFile, children, ...props }, ref) => (
    <Box alignItems="Center" gap="100" shrink="No" {...props} ref={ref}>
      {(READABLE_TEXT_MIME_TYPES.includes(mimeType) ||
        READABLE_EXT_TO_MIME_TYPE[getFileNameExt(body)]) &&
        renderAsTextFile()}
      {mimeType === 'application/pdf' && renderAsPdfFile()}
      {children}
    </Box>
  )
);
