// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatUiCanvas } from '../ui-actions/chatUiProtocol';
import { type CanvasPage, useCanvasPage } from './useCanvasPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const download = vi.hoisted(() => vi.fn());
vi.mock('../messages/attachmentRepository', () => ({ downloadCachedAttachment: download }));

let container: HTMLDivElement;
let root: Root;
let page: CanvasPage | undefined;
const mx = {} as MatrixClient;

function Probe({ canvas, attempt }: { canvas: ChatUiCanvas; attempt: number }) {
  page = useCanvasPage(mx, '!room:example.org', '$canvas', canvas, attempt);
  return null;
}

const render = async (canvas: ChatUiCanvas, attempt = 0) => {
  await act(async () => {
    root.render(<Probe canvas={canvas} attempt={attempt} />);
  });
  // Let the download promise chain settle.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  download.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useCanvasPage', () => {
  it('uses inline HTML as is', async () => {
    await render({ title: 'T', html: '<p>hi</p>' });
    expect(page).toEqual({ status: 'ready', html: '<p>hi</p>' });
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads and decrypts an uploaded page within the page limit', async () => {
    download.mockResolvedValue({ text: async () => '<h1>Report</h1>' });
    const encryptedFile = { url: 'mxc://example.org/enc' } as never;
    await render({
      title: 'T',
      document: { mxcUrl: 'mxc://example.org/enc', encryptedFile, size: 15 },
    });
    expect(page).toEqual({ status: 'ready', html: '<h1>Report</h1>' });
    expect(download).toHaveBeenCalledWith(
      mx,
      { mxcUri: 'mxc://example.org/enc', encryptedFile, mimeType: 'text/html' },
      expect.objectContaining({
        roomId: '!room:example.org',
        eventId: '$canvas',
        maxBytes: 4 * 1024 * 1024,
      })
    );
  });

  it('reports a page that cannot be loaded', async () => {
    download.mockRejectedValue(new Error('404'));
    await render({ title: 'T', document: { mxcUrl: 'mxc://example.org/gone', size: 10 } });
    expect(page).toEqual({ status: 'failed' });
  });

  it('treats an empty page as a failure and retries on request', async () => {
    const document = { mxcUrl: 'mxc://example.org/page', size: 10 };
    download.mockResolvedValueOnce({ text: async () => '   ' });
    await render({ title: 'T', document });
    expect(page).toEqual({ status: 'failed' });
    download.mockResolvedValueOnce({ text: async () => '<p>ok</p>' });
    await render({ title: 'T', document }, 1);
    expect(page).toEqual({ status: 'ready', html: '<p>ok</p>' });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('abandons a download when the page reference changes', async () => {
    let finishFirst: (value: { text: () => Promise<string> }) => void = () => undefined;
    download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        })
    );
    download.mockResolvedValueOnce({ text: async () => '<p>second</p>' });
    await render({ title: 'T', document: { mxcUrl: 'mxc://example.org/one', size: 10 } });
    await render({ title: 'T', document: { mxcUrl: 'mxc://example.org/two', size: 10 } });
    await act(async () => finishFirst({ text: async () => '<p>first</p>' }));
    expect(page).toEqual({ status: 'ready', html: '<p>second</p>' });
    expect(download.mock.calls[0][2].signal.aborted).toBe(true);
  });
});
