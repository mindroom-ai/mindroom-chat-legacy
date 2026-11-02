import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IThumbnailContent } from '../../../../types/matrix/common';
import { ThumbnailContent } from './ThumbnailContent';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const mocks = vi.hoisted(() => ({
  downloadEncryptedMedia: vi.fn(),
  matrixClient: {},
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.matrixClient,
}));

vi.mock('../../../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadEncryptedMedia,
}));

const encryptedThumbnail = {
  thumbnail_info: {
    mimetype: 'image/png',
  },
  thumbnail_file: {
    url: 'mxc://example/thumbnail',
    v: 'v2',
    key: {
      alg: 'A256CTR',
      ext: true,
      key_ops: ['encrypt', 'decrypt'],
      kty: 'oct',
      k: 'key',
    },
    iv: 'iv',
    hashes: {
      sha256: 'hash',
    },
  },
} as IThumbnailContent;

describe('ThumbnailContent blob URL ownership', () => {
  let renderer: ReactTestRenderer | undefined;
  let downloadedThumbnail: Deferred<Blob>;
  const outstandingUrls = new Set<string>();

  beforeEach(() => {
    downloadedThumbnail = createDeferred<Blob>();
    mocks.downloadEncryptedMedia.mockReset();
    mocks.downloadEncryptedMedia.mockReturnValue(downloadedThumbnail.promise);
    outstandingUrls.clear();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const objectUrl = 'blob:thumbnail';
      outstandingUrls.add(objectUrl);
      return objectUrl;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((objectUrl) => {
      outstandingUrls.delete(objectUrl);
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.restoreAllMocks();
  });

  it('revokes an encrypted thumbnail URL produced after unmount', async () => {
    await act(async () => {
      renderer = create(
        <ThumbnailContent info={encryptedThumbnail} renderImage={() => <span>thumbnail</span>} />
      );
      await Promise.resolve();
    });

    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;

    downloadedThumbnail.resolve(new Blob(['thumbnail'], { type: 'image/png' }));
    await act(async () => {
      await downloadedThumbnail.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(outstandingUrls).toHaveLength(0);
  });

  it('loads a thumbnail declared as SVG into an untyped blob', async () => {
    const svgThumbnail = { ...encryptedThumbnail, thumbnail_info: { mimetype: 'image/svg+xml' } };
    await act(async () => {
      renderer = create(
        <ThumbnailContent info={svgThumbnail} renderImage={() => <span>thumbnail</span>} />
      );
      await Promise.resolve();
    });

    expect(mocks.downloadEncryptedMedia).toHaveBeenCalledWith(
      mocks.matrixClient,
      expect.objectContaining({ mimeType: 'application/octet-stream' })
    );
  });
});
