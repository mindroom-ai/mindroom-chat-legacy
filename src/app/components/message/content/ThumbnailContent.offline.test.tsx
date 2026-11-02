import 'fake-indexeddb/auto';
import React from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, MatrixEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { clearAttachmentRepositoryMemory } from '../../../mindroom/messages/attachmentRepository';
import { resetCacheStoreForTesting } from '../../../mindroom/threads/cacheStore';
import { persistAttachmentEvents } from '../../../mindroom/threads/__tests__/attachmentFixtures';
import { ThumbnailContent } from './ThumbnailContent';

const client = createClient({
  baseUrl: 'https://matrix.example.org',
  userId: '@alice:example.org',
  accessToken: 'test-token',
});
client.getVersions = async () => ({ versions: ['v1.11'], unstable_features: {} });
const persistThumbnail = (url: string) =>
  persistAttachmentEvents(client, [
    new MatrixEvent({
      event_id: '$image',
      room_id: '!room',
      sender: '@alice:example.org',
      origin_server_ts: 1,
      type: 'm.room.message',
      content: {
        msgtype: 'm.image',
        body: 'image',
        info: { thumbnail_url: url, thumbnail_info: { mimetype: 'image/png' } },
      },
    }),
  ]);
vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearAttachmentRepositoryMemory();
  resetCacheStoreForTesting();
});

it('renders persisted thumbnail bytes after remount with transport offline', async () => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  const fetchMock = vi.fn(
    async () => new Response('thumbnail bytes', { headers: { 'Content-Type': 'image/png' } })
  );
  vi.stubGlobal('fetch', fetchMock);
  await persistThumbnail('mxc://matrix.example.org/thumb');
  const displayed: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    displayed.push(blob as Blob);
    return `blob:thumbnail-${displayed.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const element = (
    <ThumbnailContent
      owner={{ roomId: '!room', eventId: '$image', revisionTs: 1 }}
      info={{
        thumbnail_url: 'mxc://matrix.example.org/thumb',
        thumbnail_info: { mimetype: 'image/png' },
      }}
      renderImage={(src) => <img src={src} alt="cached thumbnail" />}
    />
  );
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(element);
  });
  await vi.waitFor(() => expect(renderer!.root.findAllByType('img')).toHaveLength(1));
  await act(async () => {
    renderer!.unmount();
  });
  clearAttachmentRepositoryMemory();
  fetchMock.mockRejectedValue(new TypeError('offline'));
  await act(async () => {
    renderer = create(element);
  });
  await vi.waitFor(() =>
    expect(renderer!.root.findByType('img').props.src).toBe('blob:thumbnail-2')
  );
  expect(await displayed[1].text()).toBe('thumbnail bytes');
  const { readRoomAttachmentStorage } = await import('../../../mindroom/threads/cacheStore');
  const { createSessionId } = await import('../../../state/sessions');
  expect(
    await readRoomAttachmentStorage(
      createSessionId(client.getHomeserverUrl(), client.getSafeUserId()),
      '!room'
    )
  ).toMatchObject({ saved: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]).toEqual([
    expect.any(String),
    expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
  ]);
  await act(async () => {
    renderer!.unmount();
  });
});

it('cannot persist a room-owned thumbnail when room clear wins its pending fetch', async () => {
  const { clearRoomCachedContent, getCachedAttachmentMetadata } = await import(
    '../../../mindroom/threads/cacheStore'
  );
  const { createSessionId } = await import('../../../state/sessions');
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  await persistThumbnail('mxc://matrix.example.org/late');
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late-thumbnail');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <ThumbnailContent
        owner={{ roomId: '!room', eventId: '$image', revisionTs: 1 }}
        info={{
          thumbnail_url: 'mxc://matrix.example.org/late',
          thumbnail_info: { mimetype: 'image/png' },
        }}
        renderImage={(src) => <img src={src} alt="late" />}
      />
    );
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  const session = createSessionId(client.getHomeserverUrl(), client.getSafeUserId());
  await clearRoomCachedContent(session, '!room');
  await act(async () => {
    finish(new Response('late bytes'));
  });
  await vi.waitFor(() => expect(renderer!.root.findAllByType('img')).toHaveLength(1));
  expect(
    await getCachedAttachmentMetadata(session, 'mxc://matrix.example.org/late')
  ).toBeUndefined();
  await act(async () => renderer!.unmount());
});
