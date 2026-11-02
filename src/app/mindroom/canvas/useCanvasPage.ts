import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { downloadCachedAttachment } from '../messages/attachmentRepository';
import { MAX_CANVAS_DOCUMENT_BYTES, type ChatUiCanvas } from '../ui-actions/chatUiProtocol';

export type CanvasPage =
  | { status: 'ready'; html: string }
  | { status: 'loading' }
  | { status: 'failed' };

type Loaded = { key: string; page: CanvasPage };

/** Inline pages are ready at once; uploaded pages are fetched, decrypted, and cached. */
export function useCanvasPage(
  mx: MatrixClient,
  roomId: string,
  revisionEventId: string,
  canvas: ChatUiCanvas,
  attempt = 0
): CanvasPage {
  const document = 'document' in canvas ? canvas.document : undefined;
  const mxcUrl = document?.mxcUrl;
  // A retry is a new attempt at the same reference.
  const key = `${mxcUrl}\n${attempt}`;
  const [loaded, setLoaded] = useState<Loaded>();

  useEffect(() => {
    if (!document) return undefined;
    const controller = new AbortController();
    const finish = (page: CanvasPage) => {
      if (!controller.signal.aborted) setLoaded({ key, page });
    };
    downloadCachedAttachment(
      mx,
      {
        mxcUri: document.mxcUrl,
        encryptedFile: document.encryptedFile,
        mimeType: 'text/html',
      },
      {
        roomId,
        eventId: revisionEventId,
        maxBytes: MAX_CANVAS_DOCUMENT_BYTES,
        signal: controller.signal,
      }
    )
      .then((blob) => blob.text())
      .then((html) => finish(html.trim() ? { status: 'ready', html } : { status: 'failed' }))
      .catch(() => finish({ status: 'failed' }));
    return () => controller.abort();
    // The reference identifies the content; a new upload has a new MXC URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, roomId, key]);

  if ('html' in canvas) return { status: 'ready', html: canvas.html };
  return loaded && loaded.key === key ? loaded.page : { status: 'loading' };
}
