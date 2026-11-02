import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadMediaMock, downloadSidecarMock, saveFileMock } = vi.hoisted(() => ({
  downloadMediaMock: vi.fn(),
  downloadSidecarMock: vi.fn(),
  saveFileMock: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const container = (tag: string) =>
    reactModule.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }, ref) =>
        reactModule.createElement(tag, { ...props, ref }, children)
    );

  return {
    Box: container('div'),
    Badge: container('span'),
    Button: container('button'),
    Chip: container('button'),
    Header: container('header'),
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    IconButton: container('button'),
    Icons: {
      ArrowLeft: 'ArrowLeft',
      ChevronLeft: 'ChevronLeft',
      ChevronRight: 'ChevronRight',
      Download: 'Download',
      Minus: 'Minus',
      Plus: 'Plus',
      Warning: 'Warning',
    },
    Input: container('input'),
    Menu: container('div'),
    MenuItem: container('button'),
    PopOut: ({ children }: { children?: React.ReactNode }) => children,
    Scroll: container('div'),
    Spinner: () => reactModule.createElement('span', { 'data-spinner': true }),
    Text: container('span'),
    Tooltip: container('span'),
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<unknown>) => React.ReactNode;
    }) => children(null),
    as: (render: (props: object, ref: React.ForwardedRef<unknown>) => React.ReactNode) =>
      reactModule.forwardRef((props, ref) => render(props, ref)),
    config: { space: { S200: '8px' } },
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('./image-viewer/ImageViewer.css', () => ({
  ImageViewer: 'ImageViewer',
  ImageViewerContent: 'ImageViewerContent',
  ImageViewerHeader: 'ImageViewerHeader',
  ImageViewerImg: 'ImageViewerImg',
}));

vi.mock('./Pdf-viewer/PdfViewer.css', () => ({
  PdfViewer: 'PdfViewer',
  PdfViewerContent: 'PdfViewerContent',
  PdfViewerFooter: 'PdfViewerFooter',
  PdfViewerHeader: 'PdfViewerHeader',
}));

vi.mock('../styles/Modal.css', () => ({
  ModalWide: 'ModalWide',
}));

vi.mock('./page', async () => {
  const { createElement } = await import('react');
  return {
    PageScroll: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
      createElement('div', null, header, children),
  };
});

vi.mock('../mindroom/messages/MindroomMessageControls.css', () => ({
  MenuItemText: 'MenuItemText',
  ReplyDetailsScroll: 'ReplyDetailsScroll',
}));

vi.mock('../hooks/useZoom', () => ({
  useZoom: () => ({
    zoom: 1,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setZoom: vi.fn(),
    zoomTargetRef: { current: null },
    isZooming: false,
  }),
}));

vi.mock('../hooks/usePan', () => ({
  usePan: () => ({
    pan: { translateX: 0, translateY: 0 },
    cursor: 'default',
    isPanning: false,
  }),
}));

vi.mock('../plugins/pdfjs-dist', () => ({
  createPage: vi.fn(),
  usePdfDocumentLoader: () => [{ status: 'idle' }, vi.fn()],
  usePdfJSLoader: () => [{ status: 'idle' }, vi.fn()],
}));

vi.mock('../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: downloadMediaMock,
}));

vi.mock('../utils/matrix', () => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  downloadMedia: downloadMediaMock,
  mxcUrlToHttp: () => 'https://example.test/file',
}));

vi.mock('../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../mindroom/native/nativeFileSave', () => ({
  saveFile: saveFileMock,
}));

vi.mock('../mindroom/messages/longTextDownload', () => ({
  downloadMindroomLongTextSidecarBlob: downloadSidecarMock,
  getMindroomLongTextDownloadName: () => 'response.json',
}));

vi.mock('../mindroom/messages/MindroomLongTextText', () => ({
  useMindroomLongTextResolvedContent: () => undefined,
}));

const findButtonByText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root
    .findAllByType('button')
    .find((button) => button.findAllByType('span').some((span) => span.children.includes(text)));

const flushAsyncState = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('attachment viewer downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadMediaMock.mockResolvedValue(new Blob(['image']));
    downloadSidecarMock.mockResolvedValue(new Blob(['response']));
    saveFileMock.mockResolvedValue(true);
  });

  it('shows a retry action when saving from the image viewer fails', async () => {
    saveFileMock.mockRejectedValueOnce(new Error('save failed'));
    const { ImageViewer } = await import('./image-viewer/ImageViewer');
    const renderer = create(
      React.createElement(ImageViewer, {
        alt: 'photo.png',
        src: 'https://example.test/photo.png',
        requestClose: vi.fn(),
      })
    );

    await act(async () => {
      findButtonByText(renderer, 'Download')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Retry Download')).toBeDefined();
    expect(downloadMediaMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      findButtonByText(renderer, 'Retry Download')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Download')).toBeDefined();
    expect(downloadMediaMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(2);
  });

  it('shows a retry action when saving from the PDF viewer fails', async () => {
    saveFileMock.mockRejectedValueOnce(new Error('save failed'));
    const { PdfViewer } = await import('./Pdf-viewer/PdfViewer');
    const renderer = create(
      React.createElement(PdfViewer, {
        name: 'report.pdf',
        src: 'blob:report',
        requestClose: vi.fn(),
      })
    );

    await act(async () => {
      findButtonByText(renderer, 'Download')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Retry Download')).toBeDefined();
    expect(saveFileMock).toHaveBeenCalledWith('blob:report', 'report.pdf');

    await act(async () => {
      findButtonByText(renderer, 'Retry Download')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Download')).toBeDefined();
    expect(saveFileMock).toHaveBeenCalledTimes(2);
  });

  it('retries a failed repeat attachment save without downloading the file again', async () => {
    const { DownloadFile } = await import('./message/content/FileContent');
    const renderDownloadFile = (body: string, url: string) =>
      React.createElement(DownloadFile, {
        body,
        mimeType: 'text/plain',
        url,
        info: { size: 5 },
      });
    const renderer = create(renderDownloadFile('agent-output.txt', 'mxc://example.test/file'));

    await act(async () => {
      findButtonByText(renderer, 'Download (0.0 KB)')?.props.onClick();
      await flushAsyncState();
    });

    saveFileMock.mockRejectedValueOnce(new Error('save failed'));
    await act(async () => {
      findButtonByText(renderer, 'Download (0.0 KB)')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Retry Download (0.0 KB)')).toBeDefined();
    expect(downloadMediaMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      findButtonByText(renderer, 'Retry Download (0.0 KB)')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Download (0.0 KB)')).toBeDefined();
    expect(downloadMediaMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(3);

    const replacementBlob = new Blob(['replacement']);
    downloadMediaMock.mockResolvedValueOnce(replacementBlob);
    act(() => {
      renderer.update(renderDownloadFile('replacement.txt', 'mxc://example.test/replacement'));
    });

    await act(async () => {
      findButtonByText(renderer, 'Download (0.0 KB)')?.props.onClick();
      await flushAsyncState();
    });

    expect(downloadMediaMock).toHaveBeenCalledTimes(2);
    expect(saveFileMock).toHaveBeenLastCalledWith(replacementBlob, 'replacement.txt');
  });

  it('retries a failed file-header save without downloading the file again', async () => {
    saveFileMock.mockRejectedValueOnce(new Error('save failed'));
    const { FileDownloadButton } = await import('./message/FileHeader');
    const renderer = create(
      React.createElement(FileDownloadButton, {
        filename: 'recording.m4a',
        mimeType: 'audio/mp4',
        url: 'mxc://example.test/audio',
      })
    );

    const getDownloadButton = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.props['aria-label'] === 'Download recording.m4a');

    await act(async () => {
      getDownloadButton()?.props.onClick();
      await flushAsyncState();
    });

    expect(getDownloadButton()?.props.variant).toBe('Critical');

    await act(async () => {
      getDownloadButton()?.props.onClick();
      await flushAsyncState();
    });

    expect(downloadMediaMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(2);
  });

  it('retries a failed long-response save without downloading the sidecar again', async () => {
    saveFileMock.mockRejectedValueOnce(new Error('save failed'));
    const { MindroomDownloadOriginalMenuItem } = await import(
      '../mindroom/messages/MindroomMessageControls'
    );
    const onClose = vi.fn();
    const renderer = create(
      React.createElement(MindroomDownloadOriginalMenuItem, {
        source: {
          previewContent: {},
          mxcUri: 'mxc://example.test/response',
          isV2ContentJson: true,
        },
        onClose,
      })
    );

    await act(async () => {
      findButtonByText(renderer, 'Download Original')?.props.onClick();
      await flushAsyncState();
    });

    expect(findButtonByText(renderer, 'Retry Download Original')).toBeDefined();

    await act(async () => {
      findButtonByText(renderer, 'Retry Download Original')?.props.onClick();
      await flushAsyncState();
    });

    expect(downloadSidecarMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the long-response menu open when the native save picker is cancelled', async () => {
    saveFileMock.mockResolvedValueOnce(false);
    const { MindroomDownloadOriginalMenuItem } = await import(
      '../mindroom/messages/MindroomMessageControls'
    );
    const onClose = vi.fn();
    const renderer = create(
      React.createElement(MindroomDownloadOriginalMenuItem, {
        source: {
          previewContent: {},
          mxcUri: 'mxc://example.test/response',
          isV2ContentJson: true,
        },
        onClose,
      })
    );

    await act(async () => {
      findButtonByText(renderer, 'Download Original')?.props.onClick();
      await flushAsyncState();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(findButtonByText(renderer, 'Download Original')).toBeDefined();
  });

  it('ignores repeated long-response clicks while a save is active', async () => {
    let finishSave: ((saved: boolean) => void) | undefined;
    saveFileMock.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      })
    );
    const { MindroomDownloadOriginalMenuItem } = await import(
      '../mindroom/messages/MindroomMessageControls'
    );
    const renderer = create(
      React.createElement(MindroomDownloadOriginalMenuItem, {
        source: {
          previewContent: {},
          mxcUri: 'mxc://example.test/response',
          isV2ContentJson: true,
        },
      })
    );
    const downloadButton = findButtonByText(renderer, 'Download Original');

    await act(async () => {
      downloadButton?.props.onClick();
      downloadButton?.props.onClick();
      await flushAsyncState();
    });

    expect(downloadSidecarMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSave?.(true);
      await flushAsyncState();
    });
  });
});
