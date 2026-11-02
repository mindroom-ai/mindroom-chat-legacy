// @vitest-environment jsdom

import React, { useLayoutEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncCallback } from '../../../hooks/useAsyncCallback';
import { useAudioContentSource } from './useAudioContentSource';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  downloadMedia: vi.fn(async () => new Blob(['audio'], { type: 'audio/ogg' })),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadMedia,
}));

type Controller = {
  load: AsyncCallback<[], string>;
  hide: () => void;
};

function AudioSourceProbe({ controller }: { controller: Controller }) {
  const [, load] = useAudioContentSource({
    mimeType: 'audio/ogg',
    url: 'mxc://example/audio',
  });

  useLayoutEffect(() => {
    controller.load = load;
  }, [controller, load]);

  return null;
}

function Harness({ controller }: { controller: Controller }) {
  const [visible, setVisible] = useState(true);

  controller.hide = () => setVisible(false);

  return visible ? <AudioSourceProbe controller={controller} /> : null;
}

describe('useAudioContentSource commit ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: Controller;
  const outstandingUrls = new Set<string>();
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();
  let nextObjectUrl = 0;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    controller = {
      load: async () => {
        throw new Error('Probe has not committed');
      },
      hide: () => undefined,
    };
    outstandingUrls.clear();
    nextObjectUrl = 0;
    mocks.downloadMedia.mockClear();
    createObjectURL.mockReset();
    createObjectURL.mockImplementation(() => {
      const objectUrl = `blob:audio-commit-${nextObjectUrl}`;
      nextObjectUrl += 1;
      outstandingUrls.add(objectUrl);
      return objectUrl;
    });
    revokeObjectURL.mockReset();
    revokeObjectURL.mockImplementation((objectUrl) => {
      outstandingUrls.delete(objectUrl);
    });
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });

    act(() => {
      root.render(<Harness controller={controller} />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('disposes an audio URL when a parent unmount batches away the success state', async () => {
    let request!: Promise<string>;

    act(() => {
      request = controller.load();
      queueMicrotask(() => {
        queueMicrotask(controller.hide);
      });
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await expect(request).resolves.toBe('blob:audio-commit-0');

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(outstandingUrls).toHaveLength(0);
  });

  it('disposes the pending URL when a replacement batches away the success state', async () => {
    let firstRequest!: Promise<string>;
    let replacementRequest!: Promise<string>;

    act(() => {
      firstRequest = controller.load();
      queueMicrotask(() => {
        queueMicrotask(() => {
          replacementRequest = controller.load();
        });
      });
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    await expect(firstRequest).resolves.toBe('blob:audio-commit-0');
    await expect(replacementRequest).resolves.toBe('blob:audio-commit-1');

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(outstandingUrls).toEqual(new Set(['blob:audio-commit-1']));
  });

  it('transfers a committed URL to the existing state cleanup owner', async () => {
    let request!: Promise<string>;

    await act(async () => {
      request = controller.load();
      await request;
    });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(outstandingUrls).toEqual(new Set(['blob:audio-commit-0']));

    act(() => {
      controller.hide();
    });

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(outstandingUrls).toHaveLength(0);
  });
});
