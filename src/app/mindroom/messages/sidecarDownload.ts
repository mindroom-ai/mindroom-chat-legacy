import { MatrixClient } from 'matrix-js-sdk';
import { IEncryptedFile } from '../../../types/matrix/common';
import {
  downloadCachedAttachment,
  type CachedAttachmentDownloadOptions,
} from './attachmentRepository';

export const downloadMindroomSidecarBlob = async (
  mx: MatrixClient,
  source: { mxcUri: string; encryptedFile?: IEncryptedFile },
  mimeType = 'application/json',
  options: CachedAttachmentDownloadOptions = {}
): Promise<Blob> => {
  return downloadCachedAttachment(mx, { ...source, mimeType }, options);
};
