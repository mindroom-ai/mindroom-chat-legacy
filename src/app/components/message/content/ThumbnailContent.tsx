import { ReactNode, useCallback, useEffect } from 'react';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { IThumbnailContent } from '../../../../types/matrix/common';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { revokeBlobUrl, useBlobUrlCleanup } from '../../../hooks/useBlobUrlCleanup';
import { downloadCachedAttachment } from '../../../mindroom/messages/attachmentRepository';
import { getImageBlobSafeMimeType } from '../../../utils/mimeTypes';

export type ThumbnailContentProps = {
  owner?: EventAttachmentOwner;
  info: IThumbnailContent;
  renderImage: (src: string) => ReactNode;
};
export function ThumbnailContent({ owner, info, renderImage }: ThumbnailContentProps) {
  const mx = useMatrixClient();

  const [thumbSrcState, loadThumbSrc] = useAsyncCallback(
    useCallback(async () => {
      const thumbInfo = info.thumbnail_info;
      const thumbMxcUrl = info.thumbnail_file?.url ?? info.thumbnail_url;
      const encInfo = info.thumbnail_file;
      if (typeof thumbMxcUrl !== 'string' || typeof thumbInfo?.mimetype !== 'string') {
        throw new Error('Failed to load thumbnail');
      }

      const fileContent = await downloadCachedAttachment(mx, {
        owner,
        mxcUri: thumbMxcUrl,
        mimeType: getImageBlobSafeMimeType(thumbInfo.mimetype),
        encryptedFile: encInfo ? { ...encInfo, url: thumbMxcUrl } : undefined,
      });
      return URL.createObjectURL(fileContent);
    }, [owner, mx, info]),
    revokeBlobUrl
  );
  useBlobUrlCleanup(thumbSrcState);

  useEffect(() => {
    loadThumbSrc();
  }, [loadThumbSrc]);

  return thumbSrcState.status === AsyncStatus.Success ? renderImage(thumbSrcState.data) : null;
}
