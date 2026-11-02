import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { imageViewerOpenAtom } from '../../../state/imageViewer';
import { ImageContent } from './ImageContent';

const IMAGE_VIEWER_HISTORY_MARKER = '__cinnyImageViewer';

const mocks = vi.hoisted(() => ({
  downloadCachedAttachment: vi.fn(),
  loadSrcCallback: undefined as (() => Promise<string>) | undefined,
  loadSrc: vi.fn(),
  srcState: {
    status: 'success',
    data: 'blob:image',
  } as { status: string; data?: string },
}));

type Listener = (event: Event) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;

    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;

    const current = this.listeners.get(type);
    if (!current) return;

    for (const candidate of current) {
      if (candidate === listener) {
        current.delete(candidate);
      }
    }
  }

  dispatch(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

type MockWindow = MockEventTarget & {
  history: History & {
    back: ReturnType<typeof vi.fn>;
    pushState: ReturnType<typeof vi.fn>;
    replaceState: ReturnType<typeof vi.fn>;
  };
  historyIndex: number;
  historyStack: unknown[];
  emitPageHide: () => void;
  emitPopState: () => void;
};

const createMockWindow = (): MockWindow => {
  const eventTarget = new MockEventTarget();
  const stack: unknown[] = [{ route: 'room' }];
  let index = 0;

  const history = {
    pushState: vi.fn((state: unknown) => {
      stack.splice(index + 1);
      stack.push(state);
      index = stack.length - 1;
    }),
    replaceState: vi.fn((state: unknown) => {
      stack[index] = state;
    }),
    back: vi.fn(() => {
      if (index === 0) return;
      index -= 1;
    }),
  } as MockWindow['history'];

  Object.defineProperty(history, 'state', {
    configurable: true,
    get: () => stack[index] ?? null,
  });

  const mockWindow = Object.assign(eventTarget, {
    history,
    emitPageHide: () => {
      eventTarget.dispatch('pagehide', { type: 'pagehide' } as Event);
    },
    emitPopState: () => {
      if (index > 0) {
        index -= 1;
      }
      eventTarget.dispatch('popstate', { type: 'popstate' } as Event);
    },
  });

  Object.defineProperty(mockWindow, 'historyIndex', {
    configurable: true,
    get: () => index,
  });
  Object.defineProperty(mockWindow, 'historyStack', {
    configurable: true,
    get: () => [...stack],
  });

  return mockWindow as MockWindow;
};

function AutoOpenImage({
  onClick,
  ...props
}: {
  onClick: () => void;
  tabIndex: number;
  title: string;
  alt: string;
  src: string;
  onLoad: () => void;
  onError: () => void;
}) {
  const openedRef = React.useRef(false);

  React.useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    onClick();
  }, [onClick]);

  return React.createElement('button', {
    ...props,
    'data-role': 'image',
    onClick,
  });
}

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);
  const Button = React.forwardRef<
    HTMLButtonElement,
    {
      children?: React.ReactNode;
      onClick?: () => void;
    }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  );
  const Overlay = ({
    backdrop,
    children,
    open,
  }: {
    backdrop?: React.ReactNode;
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? React.createElement('div', null, backdrop, children) : null);
  const TooltipProvider = ({
    children,
  }: {
    children?: React.ReactNode | ((triggerRef: undefined) => React.ReactNode);
  }) =>
    typeof children === 'function'
      ? React.createElement(React.Fragment, null, children(undefined))
      : React.createElement(React.Fragment, null, children);
  const as = (component: Parameters<typeof React.forwardRef>[0]) => React.forwardRef(component);

  return {
    ...actual,
    Badge: Wrapper,
    Box: Wrapper,
    Button,
    Chip: Button,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Modal: Wrapper,
    Overlay,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Spinner: Wrapper,
    Text: Wrapper,
    Tooltip: Wrapper,
    TooltipProvider,
    as,
  };
});

vi.mock('react-blurhash', () => ({
  BlurhashCanvas: (props: Record<string, unknown>) => React.createElement('canvas', props),
}));

vi.mock('./style.css', () => ({
  AbsoluteContainer: 'AbsoluteContainer',
  AbsoluteFooter: 'AbsoluteFooter',
  Blur: 'Blur',
  RelativeBase: 'RelativeBase',
}));

vi.mock('../../../styles/Modal.css', () => ({
  ModalWide: 'ModalWide',
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useAsyncCallback')>(
    '../../../hooks/useAsyncCallback'
  );

  return {
    ...actual,
    useAsyncCallback: (callback: () => Promise<string>) => {
      mocks.loadSrcCallback = callback;
      return [mocks.srcState, mocks.loadSrc];
    },
  };
});

vi.mock('../../../hooks/useBlobUrlCleanup', () => ({
  revokeBlobUrl: vi.fn(),
  useBlobUrlCleanup: () => undefined,
}));

vi.mock('../../../mindroom/messages/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

vi.mock('../../../utils/matrix', () => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  mxcUrlToHttp: () => 'https://example.test/image',
}));

describe('ImageContent', () => {
  const originalWindow = globalThis.window;
  let mockWindow: MockWindow;
  let renderer: ReactTestRenderer | undefined;

  const renderImageContent = ({
    autoOpen = false,
    mimeType,
    store = createStore(),
    strict = false,
  }: {
    autoOpen?: boolean;
    mimeType?: string;
    store?: ReturnType<typeof createStore>;
    strict?: boolean;
  }) => {
    const element = React.createElement(
      Provider,
      { store },
      React.createElement(ImageContent, {
        body: 'Test image',
        mimeType,
        url: 'mxc://mindroom/image',
        renderImage: ({ onClick, ...props }) =>
          autoOpen
            ? React.createElement(AutoOpenImage, { ...props, onClick })
            : React.createElement('button', {
                ...props,
                'data-role': 'image',
                onClick,
              }),
        renderViewer: ({ requestClose }) =>
          React.createElement(
            'button',
            {
              'data-role': 'close',
              onClick: requestClose,
            },
            'Close'
          ),
      })
    );

    act(() => {
      renderer = create(strict ? React.createElement(React.StrictMode, null, element) : element);
    });

    return { renderer: renderer!, store };
  };

  beforeEach(() => {
    mockWindow = createMockWindow();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: mockWindow,
    });

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:image',
    };
    mocks.loadSrc.mockReset();
    mocks.downloadCachedAttachment.mockReset();
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });

    vi.restoreAllMocks();
  });

  it.each([
    ['image/svg+xml', 'application/octet-stream'],
    ['image/png', 'image/png'],
  ])('loads an image declared as %s with blob type %s', async (declaredType, blobType) => {
    mocks.downloadCachedAttachment.mockResolvedValue(new Blob(['image']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
    renderImageContent({ mimeType: declaredType });

    await mocks.loadSrcCallback?.();

    expect(mocks.downloadCachedAttachment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mimeType: blobType })
    );
  });

  it('pushes one marked history entry when opening the viewer', () => {
    const store = createStore();
    const { renderer: tree } = renderImageContent({ store });

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });

    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(mockWindow.history.pushState).toHaveBeenCalledOnce();
    expect(mockWindow.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
    expect(mockWindow.historyIndex).toBe(1);
  });

  it('consumes the synthetic history entry when requestClose runs', () => {
    const store = createStore();
    const { renderer: tree } = renderImageContent({ store });

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });
    mockWindow.history.back.mockClear();

    act(() => {
      tree.root.findByProps({ 'data-role': 'close' }).props.onClick();
    });

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.back).toHaveBeenCalledOnce();
    expect(mockWindow.historyIndex).toBe(0);
    expect(tree.root.findAllByProps({ 'data-role': 'close' })).toHaveLength(0);
  });

  it('closes on popstate without issuing a second history.back call', () => {
    const store = createStore();
    const { renderer: tree } = renderImageContent({ store });

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });
    mockWindow.history.back.mockClear();

    act(() => {
      mockWindow.emitPopState();
    });

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.back).not.toHaveBeenCalled();
    expect(mockWindow.historyIndex).toBe(0);
    expect(tree.root.findAllByProps({ 'data-role': 'close' })).toHaveLength(0);
  });

  it('pushes a fresh synthetic entry when reopened after close', () => {
    const store = createStore();
    const { renderer: tree } = renderImageContent({ store });

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });
    act(() => {
      tree.root.findByProps({ 'data-role': 'close' }).props.onClick();
    });

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });

    expect(store.get(imageViewerOpenAtom)).toBe(true);
    expect(mockWindow.history.pushState).toHaveBeenCalledTimes(2);
    expect(mockWindow.history.back).toHaveBeenCalledOnce();
    expect(mockWindow.history.state).toEqual({
      route: 'room',
      [IMAGE_VIEWER_HISTORY_MARKER]: true,
    });
    expect(mockWindow.historyIndex).toBe(1);
  });

  it('strips the marker on pagehide so refresh does not leave stale viewer state behind', () => {
    const store = createStore();
    const { renderer: tree } = renderImageContent({ store });

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });
    mockWindow.history.back.mockClear();

    act(() => {
      mockWindow.emitPageHide();
      tree.unmount();
    });
    renderer = undefined;

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.replaceState).toHaveBeenCalledOnce();
    expect(mockWindow.history.back).not.toHaveBeenCalled();
    expect(mockWindow.history.state).toEqual({ route: 'room' });
  });

  it('keeps strict-mode viewer cleanup history-balanced and clean', () => {
    const store = createStore();
    renderImageContent({ autoOpen: true, store, strict: true });

    expect(store.get(imageViewerOpenAtom)).toBe(true);
    const pushCount = mockWindow.history.pushState.mock.calls.length;

    expect(pushCount).toBeGreaterThanOrEqual(1);
    expect(mockWindow.historyIndex).toBe(1);

    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;

    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(mockWindow.history.back).toHaveBeenCalledTimes(pushCount);
    expect(mockWindow.historyIndex).toBe(0);
  });
});
