import type { MatrixEvent, MatrixClient } from 'matrix-js-sdk';
import type { IEncryptedFile } from '../../../types/matrix/common';
import { readClientCachedSpecVersions } from '../../state/cachedSpecVersions';
import { createSessionId } from '../../state/sessions';
import { decryptFile, mxcUrlToHttp } from '../../utils/matrix';
import { authenticatedMediaRequestInit, supportsAuthenticatedMedia } from '../../utils/mediaUrl';
import {
  captureCacheStoreWriteLease,
  getCachedAttachmentMetadata,
  loadCachedAttachment,
  putCachedAttachment,
  type CachedAttachmentMetadata,
  type CacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  maybeScheduleEvictionCheck,
} from '../threads/cacheStore';

import {
  parseMindroomLongTextJsonSidecar,
  getCachedMindroomLongTextContent,
  hydrateMindroomLongTextSource,
  type MindroomLongTextSource,
} from './longText';
import {
  collectEventAttachments,
  AUTO_MEDIA_MAX_BYTES,
  ESSENTIAL_BODY_MAX_BYTES,
  type EventAttachmentOwner,
} from './eventAttachments';

export type CachedAttachmentSource = {
  owner?: EventAttachmentOwner;
  mxcUri: string;
  encryptedFile?: IEncryptedFile;
  mimeType?: string;
  isV2ContentJson?: boolean;
};

export type CachedAttachmentDownloadOptions = {
  roomId?: string;
  essential?: boolean;
  signal?: AbortSignal;
  maxBytes?: number;
  eventId?: string;
  revisionTs?: number;
  revisionId?: string;
  writeLease?: CacheStoreWriteLease;
};

type RawAttachment = {
  bytes: ArrayBuffer;
  mimeType: string;
  cached?: boolean;
};

type SharedAttachmentOperation = {
  promise: Promise<RawAttachment>;
  consumers: number;
  limits: Map<object, number>;
  controller: AbortController;
  settled: boolean;
};

const inflightDownloads = new Map<string, SharedAttachmentOperation>();

const getSessionId = (mx: MatrixClient): string =>
  createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());

const getInflightKey = (sessionId: string, mxcUri: string): string =>
  JSON.stringify([sessionId, mxcUri]);

const abortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const awaitWithSignal = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

const enforceMaxBytes = (byteLength: number, maxBytes?: number): void => {
  if (maxBytes !== undefined && byteLength > maxBytes) {
    throw new Error(`Attachment exceeds the ${maxBytes} byte limit`);
  }
};

const hasCachedReference = (
  metadata: CachedAttachmentMetadata | undefined,
  owner: Partial<EventAttachmentOwner>
): boolean =>
  metadata?.references.some(
    (row) =>
      row.roomId === owner.roomId &&
      row.eventId === owner.eventId &&
      row.revisionTs === owner.revisionTs &&
      (row.revisionId ?? '') === (owner.revisionId ?? '') &&
      row.status === 'cached'
  ) ?? false;

const fetchRawAttachment = async (
  mx: MatrixClient,
  source: CachedAttachmentSource,
  getLimit: () => number,
  signal: AbortSignal
): Promise<RawAttachment> => {
  // This request sends the access token itself, so unlike media URLs the browser loads, it does
  // not need the service worker to use the authenticated endpoints. Before startup seeds the SDK with
  // the cached /versions, or after the SDK's own request failed, getVersions asks the homeserver
  // again; if that fails, the versions the client last cached decide.
  const authenticated = await mx
    .getVersions()
    .then(supportsAuthenticatedMedia)
    .catch(() => {
      const cached = readClientCachedSpecVersions(mx);
      return cached ? supportsAuthenticatedMedia(cached) : false;
    });
  const url = mxcUrlToHttp(mx, source.mxcUri, authenticated);
  if (!url) throw new Error('Unable to resolve sidecar URL');
  const requestInit = authenticated ? authenticatedMediaRequestInit(mx, url) : undefined;
  const response = await fetch(url, { ...requestInit, method: 'GET', signal });
  if (!response.ok) throw new Error(`Unable to download media (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) {
    // Native fetch implementations without streams cannot enforce an automatic byte bound.
    if (Number.isFinite(getLimit())) throw new Error('Bounded media response requires a stream');
    return {
      bytes: await response.arrayBuffer(),
      mimeType:
        source.mimeType || response.headers.get('Content-Type') || 'application/octet-stream',
    };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const length = Number(response.headers.get('Content-Length'));
    enforceMaxBytes(length, getLimit());
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      enforceMaxBytes(size, getLimit());
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return {
    bytes: await new Blob(chunks).arrayBuffer(),
    mimeType: source.mimeType || response.headers.get('Content-Type') || 'application/octet-stream',
  };
};

const acquireAttachment = (
  mx: MatrixClient,
  sessionId: string,
  source: CachedAttachmentSource,
  maxBytes?: number
): { promise: Promise<RawAttachment>; release: () => void } => {
  const key = getInflightKey(sessionId, source.mxcUri);
  let operation = inflightDownloads.get(key);
  if (!operation) {
    let created: SharedAttachmentOperation | undefined;
    const promise = loadCachedAttachment(sessionId, source.mxcUri).then((cached) => {
      if (cached) return { bytes: cached.bytes, mimeType: cached.mimeType, cached: true };
      if (!created || created.consumers === 0) throw abortError();
      return fetchRawAttachment(
        mx,
        source,
        () => Math.max(0, ...(created?.limits.values() ?? [])),
        created.controller.signal
      );
    });
    created = {
      promise,
      consumers: 0,
      limits: new Map(),
      controller: new AbortController(),
      settled: false,
    };
    operation = created;
    inflightDownloads.set(key, created);
    const markSettled = () => {
      created.settled = true;
      if (created.consumers === 0 && inflightDownloads.get(key) === created) {
        inflightDownloads.delete(key);
      }
    };
    promise.then(markSettled, markSettled);
  }

  const acquired = operation;
  acquired.consumers += 1;
  const consumer = {};
  acquired.limits.set(consumer, maxBytes ?? Infinity);
  let released = false;
  return {
    promise: acquired.promise,
    release: () => {
      if (released) return;
      released = true;
      acquired.consumers -= 1;
      acquired.limits.delete(consumer);
      if (acquired.consumers === 0 && !acquired.settled) {
        acquired.controller.abort();
        if (inflightDownloads.get(key) === acquired) inflightDownloads.delete(key);
      }
      if (acquired.settled && acquired.consumers === 0 && inflightDownloads.get(key) === acquired) {
        inflightDownloads.delete(key);
      }
    },
  };
};

const toConsumerBlob = async (
  raw: RawAttachment,
  source: CachedAttachmentSource
): Promise<Blob> => {
  const mimeType = source.mimeType || raw.mimeType;
  if (!source.encryptedFile) return new Blob([raw.bytes], { type: mimeType });
  return decryptFile(raw.bytes.slice(0), mimeType, source.encryptedFile);
};

export const downloadCachedAttachment = async (
  mx: MatrixClient,
  source: CachedAttachmentSource,
  options: CachedAttachmentDownloadOptions = {}
): Promise<Blob> => {
  if (options.signal?.aborted) throw abortError();
  options = { ...source.owner, ...options };
  const sessionId = getSessionId(mx);
  const writeLease = options.writeLease ?? captureCacheStoreWriteLease(sessionId, options.roomId);
  const attachment = acquireAttachment(mx, sessionId, source, options.maxBytes);
  try {
    const raw = await awaitWithSignal(attachment.promise, options.signal);
    enforceMaxBytes(raw.bytes.byteLength, options.maxBytes);
    const consumerBlob = await awaitWithSignal(toConsumerBlob(raw, source), options.signal);
    if (
      options.essential &&
      source.isV2ContentJson &&
      !parseMindroomLongTextJsonSidecar(await consumerBlob.text())
    ) {
      throw new Error('Invalid long-text body JSON');
    }
    const metadata = raw.cached
      ? await getCachedAttachmentMetadata(sessionId, source.mxcUri)
      : undefined;
    const satisfied =
      metadata &&
      (!options.essential || metadata.essential) &&
      (!options.roomId || hasCachedReference(metadata, options));
    if (options.roomId && options.eventId && !satisfied) {
      await awaitWithSignal(
        putCachedAttachment(
          sessionId,
          { bytes: raw.bytes, mimeType: raw.mimeType, mxcUri: source.mxcUri },
          { ...options, writeLease }
        ),
        options.signal
      );
      if (options.signal?.aborted) throw abortError();
      maybeScheduleEvictionCheck(sessionId);
    }
    return consumerBlob;
  } finally {
    attachment.release();
  }
};

export const getCachedAttachmentCacheMetadata = (
  mx: MatrixClient,
  mxcUri: string
): Promise<CachedAttachmentMetadata | undefined> =>
  getCachedAttachmentMetadata(getSessionId(mx), mxcUri);

export const clearAttachmentRepositoryMemory = (): void => {
  inflightDownloads.forEach(({ controller, settled }) => {
    if (!settled) controller.abort();
  });
  inflightDownloads.clear();
};

export type PrefetchEventAttachmentsOptions = {
  includeAllMedia?: boolean;
  canDownload?: () => Promise<boolean>;
  signal?: AbortSignal;
  writeLease?: CacheStoreWriteLease;
};

/** One bounded batch consuming ownership already admitted by canonical event persistence. */
export const prefetchEventAttachments = async (
  mx: MatrixClient,
  events: readonly MatrixEvent[],
  options: PrefetchEventAttachmentsOptions = {}
): Promise<void> => {
  const sessionId = getSessionId(mx);
  const messages = collectEventAttachments(events).filter((message) => message.attachments.length);
  const leases = new Map(
    messages.map((message) => [
      message.roomId,
      options.writeLease ?? captureCacheStoreWriteLease(sessionId, message.roomId),
    ])
  );
  for (const message of messages) {
    for (const attachment of message.attachments) {
      if (options.signal?.aborted) throw abortError();
      const writeLease = leases.get(message.roomId)!;
      if (!isCacheStoreWriteLeaseCurrent(writeLease)) continue;
      const cached = await getCachedAttachmentMetadata(sessionId, attachment.mxcUri);
      const satisfied = hasCachedReference(cached, message);
      if (
        !satisfied &&
        (attachment.autoDownload || options.includeAllMedia) &&
        (!options.canDownload || (await options.canDownload()))
      ) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await downloadCachedAttachment(mx, attachment, {
            roomId: message.roomId,
            eventId: message.eventId,
            revisionTs: message.revisionTs,
            revisionId: message.revisionId,
            essential: attachment.essential,
            signal: options.signal,
            writeLease,
            maxBytes: attachment.essential
              ? ESSENTIAL_BODY_MAX_BYTES
              : options.includeAllMedia
              ? undefined
              : AUTO_MEDIA_MAX_BYTES,
          });
        } catch (error) {
          if (options.signal?.aborted) throw error;
          // Missing/failed bytes remain registered for retry and storage reporting.
        }
      }
    }
  }
};

/** Each owner validates the shared raw payload before claiming readable coverage. */
export const hydrateCachedMindroomLongText = async (
  mx: MatrixClient,
  source: MindroomLongTextSource
): Promise<Record<string, unknown>> => {
  const owner = source.owner;
  const sessionId = getSessionId(mx);
  const writeLease = captureCacheStoreWriteLease(sessionId, owner?.roomId);
  const isCurrent = () => isCacheStoreWriteLeaseCurrent(writeLease);
  const load = async (nextSource: MindroomLongTextSource) => {
    const blob = await downloadCachedAttachment(
      mx,
      { ...nextSource, mimeType: 'application/json' },
      { ...owner, essential: true, maxBytes: ESSENTIAL_BODY_MAX_BYTES, writeLease }
    );
    return blob.text();
  };
  if (!owner) return hydrateMindroomLongTextSource(source, load, mx, isCurrent);
  const cached = getCachedMindroomLongTextContent(source, mx);
  if (
    cached &&
    hasCachedReference(await getCachedAttachmentMetadata(sessionId, source.mxcUri), owner)
  )
    return isCurrent() ? cached : source.previewContent;
  try {
    // Every owner participates in raw transport/persistence before parsed hydration can coalesce.
    const text = await load(source);
    return await hydrateMindroomLongTextSource(source, async () => text, mx, isCurrent);
  } catch {
    return isCurrent() ? cached ?? source.previewContent : source.previewContent;
  }
};
