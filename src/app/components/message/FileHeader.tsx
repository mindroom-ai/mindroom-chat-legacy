import { useTranslation } from 'react-i18next';
import {
  Badge,
  Box,
  Icon,
  IconButton,
  IconSrc,
  Icons,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  as,
  toRem,
} from 'folds';
import React, { ReactNode, useCallback, useRef } from 'react';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import type { EventAttachmentOwner } from '../../mindroom/messages/eventAttachments';
import { mimeTypeToExt } from '../../utils/mimeTypes';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { saveFile } from '../../mindroom/native/nativeFileSave';
import { downloadCachedAttachment } from '../../mindroom/messages/attachmentRepository';

const badgeStyles = { maxWidth: toRem(100) };

type FileIconButtonProps = {
  label: string;
  icon: IconSrc;
  onClick: () => void;
  loading?: boolean;
  failedLabel?: string;
};
/** Icon-only file action; the tooltip and accessible name carry the label. */
export function FileIconButton({
  label,
  icon,
  onClick,
  loading,
  failedLabel,
}: FileIconButtonProps) {
  return (
    <TooltipProvider
      tooltip={
        <Tooltip variant={failedLabel ? 'Critical' : undefined}>
          <Text>{failedLabel ?? label}</Text>
        </Tooltip>
      }
      position="Top"
      align="Center"
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          disabled={loading}
          onClick={onClick}
          variant={failedLabel ? 'Critical' : 'SurfaceVariant'}
          size="300"
          radii="300"
          aria-label={label}
        >
          {loading ? (
            <Spinner size="100" variant={failedLabel ? 'Critical' : 'Secondary'} />
          ) : (
            <Icon size="100" src={icon} />
          )}
        </IconButton>
      )}
    </TooltipProvider>
  );
}

type FileDownloadButtonProps = {
  owner?: EventAttachmentOwner;
  filename: string;
  url: string;
  mimeType: string;
  encInfo?: EncryptedAttachmentInfo;
};
export function FileDownloadButton({
  owner,
  filename,
  url,
  mimeType,
  encInfo,
}: FileDownloadButtonProps) {
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

      await saveFile(fileContent, filename);
    }, [owner, mx, url, mimeType, encInfo, filename])
  );
  const handleDownload = () => {
    void download().catch(() => undefined);
  };
  return (
    <FileIconButton
      label={t('sharedUi.fileHeader.downloadValue1', { value1: filename })}
      icon={Icons.Download}
      onClick={handleDownload}
      loading={downloadState.status === AsyncStatus.Loading}
      failedLabel={
        downloadState.status === AsyncStatus.Error
          ? t('sharedUi.fileContent.loadFailed')
          : undefined
      }
    />
  );
}

export type FileHeaderProps = {
  body: string;
  mimeType: string;
  after?: ReactNode;
};
export const FileHeader = as<'div', FileHeaderProps>(({ body, mimeType, after, ...props }, ref) => (
  <Box alignItems="Center" gap="200" grow="Yes" {...props} ref={ref}>
    <Box shrink="No">
      <Badge style={badgeStyles} variant="Secondary" radii="Pill">
        <Text size="O400" truncate>
          {mimeTypeToExt(mimeType)}
        </Text>
      </Badge>
    </Box>
    <Box grow="Yes">
      <Text size="T300" truncate>
        {body}
      </Text>
    </Box>
    {after}
  </Box>
));
