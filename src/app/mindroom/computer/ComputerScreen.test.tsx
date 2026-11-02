// @vitest-environment jsdom

import React, { createRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ComputerScreenDefault, {
  ComputerScreen,
  type ComputerScreenHandle,
  type ComputerScreenProps,
  type RfbClient,
} from './ComputerScreen';
import { SOFT_KEYBOARD_BUFFER } from './computerSoftKeyboard';
// noVNC's mouse capture, which its canvas takes on every mousedown, and its keyboard. The
// package exports only RFB.
/* eslint-disable import/no-relative-packages */
import {
  releaseCapture,
  setCapture,
} from '../../../../node_modules/@novnc/novnc/core/util/events.js';
import NoVncKeyboard from '../../../../node_modules/@novnc/novnc/core/input/keyboard.js';
/* eslint-enable import/no-relative-packages */

vi.mock('./ComputerPanel.css.ts', () => ({
  KeyboardInput: 'KeyboardInput',
  Screen: 'Screen',
  ScreenInControl: 'ScreenInControl',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTROL_L_KEYSYM = 0xffe3;

const listeners = new Map<string, EventListener>();
const rfb: RfbClient = {
  addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
  removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  disconnect: vi.fn(),
  focus: vi.fn(),
  clipboardPasteFrom: vi.fn(),
  sendKey: vi.fn(),
  scaleViewport: false,
  viewOnly: true,
  focusOnClick: true,
};

// Like noVNC, which draws into a focusable canvas inside the target.
const createRfbWithCanvas = () =>
  vi.fn((target: HTMLElement) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    target.append(canvas);
    return rfb;
  });

const paste = (text: string, on: Element) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  on.dispatchEvent(event);
  return event;
};

const mouseDown = (on: Element) => {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  on.dispatchEvent(event);
  return event;
};

// One finger at (x, 100) on the canvas, as a browser builds a touch event.
const touch = (
  type: 'touchstart' | 'touchmove' | 'touchend',
  on: Element,
  x: number | undefined,
  time: number
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = x === undefined ? [] : [{ identifier: 1, clientX: x, clientY: 100, target: on }];
  Object.defineProperties(event, {
    touches: { value: touches },
    targetTouches: { value: touches },
    changedTouches: { value: [{ identifier: 1, clientX: x ?? 0, clientY: 100, target: on }] },
    timeStamp: { value: time },
  });
  on.dispatchEvent(event);
  return event;
};

const capturedElement = () =>
  (document as Document & { captureElement?: Element | null }).captureElement;
const captureOverlay = () => document.getElementById('noVNC_mouse_capture_elem');

// Like noVNC on its canvas: a press takes the mouse capture, no mouse event bubbles on, a
// PointerEvent is sent only while connected, and disconnect takes the canvas out.
const createNoVncLikeRfb = () => {
  const sent: string[] = [];
  const reached: string[] = [];
  let canvas: HTMLCanvasElement | undefined;
  let connected = true;
  const createRfb = vi.fn((target: HTMLElement): RfbClient => {
    const element = document.createElement('canvas');
    element.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 250, right: 400, bottom: 250 } as DOMRect);
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      element.addEventListener(type, (event) => {
        event.stopPropagation();
        const entry = `${event.type} ${(event as MouseEvent).buttons}`;
        reached.push(entry);
        if (event.type === 'mousedown') setCapture(element);
        if (connected) sent.push(entry);
      });
    }
    target.append(element);
    canvas = element;
    return {
      ...rfb,
      disconnect: () => {
        rfb.disconnect();
        connected = false;
        element.remove();
      },
    };
  });
  const getCanvas = () => {
    if (!canvas) throw new Error('No canvas yet.');
    return canvas;
  };
  // The socket closed or failed: noVNC's own `_disconnect` takes the canvas out.
  const dropStream = () => {
    connected = false;
    getCanvas().remove();
  };
  return { createRfb, getCanvas, dropStream, sent, reached };
};

// A tap, then a touch that moves: the touchpad holds the left button down.
const startTouchDrag = (canvas: Element, from: number) => {
  touch('touchstart', canvas, 100, from);
  touch('touchend', canvas, undefined, from + 50);
  touch('touchstart', canvas, 100, from + 150);
  return touch('touchmove', canvas, 140, from + 170);
};

describe('ComputerScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderScreen = (props: Partial<ComputerScreenProps>) =>
    act(() => {
      root.render(
        <ComputerScreen
          mode="view"
          onConnected={() => undefined}
          onDisconnected={() => undefined}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
          {...props}
        />
      );
    });

  const screenElements = () => {
    const surface = container.querySelector<HTMLElement>('[data-mindroom-computer-input]');
    const canvas = surface?.querySelector('canvas');
    if (!surface || !canvas) throw new Error('The computer screen did not render its canvas.');
    return { surface, canvas };
  };

  it('owns one scaled noVNC connection and disposes it with its callbacks', () => {
    const createRfb = vi.fn(() => rfb);
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={createRfb}
          mode="view"
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });

    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'wss://computer.example.org/api/computers/sessions/session-1/stream',
      { wsProtocols: ['binary', 'mindroom-ticket.ticket-1'] }
    );
    expect(rfb.scaleViewport).toBe(true);
    expect(rfb.viewOnly).toBe(true);

    act(() => listeners.get('connect')?.(new Event('connect')));
    expect(onConnected).toHaveBeenCalledOnce();

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={createRfb}
          mode="control"
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });
    expect(createRfb).toHaveBeenCalledOnce();
    expect(rfb.viewOnly).toBe(false);

    act(() => root.unmount());
    expect(rfb.disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('keeps keyboard and paste events inside the computer surface', () => {
    const windowKeyDown = vi.fn();
    const windowPaste = vi.fn();
    const rfbKeyDown = vi.fn();
    const rfbPaste = vi.fn();
    window.addEventListener('keydown', windowKeyDown);
    window.addEventListener('paste', windowPaste);

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={(target) => {
            const canvas = document.createElement('canvas');
            canvas.tabIndex = -1;
            canvas.addEventListener('keydown', rfbKeyDown);
            canvas.addEventListener('paste', rfbPaste);
            target.append(canvas);
            return rfb;
          }}
          // Watching, so the clipboard bridge leaves the paste to the surface's own stop.
          mode="view"
          onConnected={() => undefined}
          onDisconnected={() => undefined}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });

    const surface = container.querySelector<HTMLElement>('[data-mindroom-computer-input]');
    const canvas = surface?.querySelector('canvas');
    expect(surface).not.toBeNull();
    expect(canvas).not.toBeNull();
    canvas?.focus();
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
    canvas?.dispatchEvent(new Event('paste', { bubbles: true }));

    expect(rfbKeyDown).toHaveBeenCalledOnce();
    expect(rfbPaste).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(canvas);
    expect(windowKeyDown).not.toHaveBeenCalled();
    expect(windowPaste).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowKeyDown);
    window.removeEventListener('paste', windowPaste);
  });

  it('bridges paste only while in control, on the same connection', () => {
    const createRfb = createRfbWithCanvas();
    const onPaste = vi.fn();
    renderScreen({ createRfb, mode: 'view', onPaste });
    const { canvas } = screenElements();
    canvas.focus();

    expect(paste('hi', canvas).defaultPrevented).toBe(false);
    expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
    expect(rfb.sendKey).not.toHaveBeenCalled();

    const nextOnPaste = vi.fn();
    renderScreen({ createRfb, mode: 'control', onPaste: nextOnPaste });
    expect(paste('hi', canvas).defaultPrevented).toBe(true);

    expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith('hi');
    expect(nextOnPaste).toHaveBeenCalledWith('sent');
    expect(onPaste).not.toHaveBeenCalled();
    expect(createRfb).toHaveBeenCalledOnce();
  });

  it('detaches the bridge before disconnecting', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      renderScreen({ createRfb: createRfbWithCanvas(), mode: 'control' });
      const { surface, canvas } = screenElements();
      canvas.focus();
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'MetaLeft',
          key: 'Meta',
          metaKey: true,
        })
      );
      expect(rfb.sendKey).toHaveBeenCalledWith(CONTROL_L_KEYSYM, 'ControlLeft', true);

      act(() => root.unmount());

      // The mapped Ctrl is released while the socket is still open.
      expect(rfb.sendKey).toHaveBeenLastCalledWith(CONTROL_L_KEYSYM, 'ControlLeft', false);
      expect(rfb.disconnect).toHaveBeenCalledOnce();
      expect(vi.mocked(rfb.sendKey).mock.invocationCallOrder.at(-1)).toBeLessThan(
        vi.mocked(rfb.disconnect).mock.invocationCallOrder[0]
      );

      // Even with the old screen back in the page and focused, nothing is bridged.
      document.body.append(surface);
      canvas.focus();
      paste('hi', canvas);
      surface.remove();
      expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
      expect(listeners.size).toBe(0);
    } finally {
      platform.mockRestore();
    }
  });

  it('attaches the touchpad once per stream', () => {
    const mouse = vi.fn((event: MouseEvent) => ({ type: event.type, buttons: event.buttons }));
    const canvases: HTMLCanvasElement[] = [];
    // Like noVNC: a sized canvas inside the target, which disconnect takes out again.
    const createRfb = vi.fn((target: HTMLElement): RfbClient => {
      const canvas = document.createElement('canvas');
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 250, right: 400, bottom: 250 } as DOMRect);
      for (const type of ['mousedown', 'mousemove', 'mouseup']) {
        canvas.addEventListener(type, (event) => mouse(event as MouseEvent));
      }
      target.append(canvas);
      canvases.push(canvas);
      return {
        ...rfb,
        disconnect: () => {
          rfb.disconnect();
          canvas.remove();
        },
      };
    });
    const firstUrl = 'wss://computer.example.org/api/computers/sessions/session-1/stream';
    renderScreen({ createRfb, mode: 'view', url: firstUrl });
    const [canvas] = canvases;

    // Watching: the touch is kept from noVNC, as in control, and the touchpad sends nothing.
    expect(touch('touchstart', canvas, 100, 0).defaultPrevented).toBe(true);
    touch('touchend', canvas, undefined, 50);
    expect(mouse).not.toHaveBeenCalled();

    // In control on the same connection, after the mode went there and back.
    renderScreen({ createRfb, mode: 'control', url: firstUrl });
    renderScreen({ createRfb, mode: 'view', url: firstUrl });
    renderScreen({ createRfb, mode: 'control', url: firstUrl });
    expect(startTouchDrag(canvas, 1000).defaultPrevented).toBe(true);
    expect(createRfb).toHaveBeenCalledOnce();
    // One layer: a tap, then a press and a move, each press after a move to the pointer.
    const tapThenDrag = [
      { type: 'mousemove', buttons: 0 },
      { type: 'mousedown', buttons: 1 },
      { type: 'mouseup', buttons: 0 },
      { type: 'mousemove', buttons: 0 },
      { type: 'mousedown', buttons: 1 },
      { type: 'mousemove', buttons: 0 },
    ];
    expect(mouse.mock.results.map((result) => result.value)).toEqual(tapThenDrag);

    // A new stream on the same screen sends nothing on the way: its closing lets go.
    renderScreen({
      createRfb,
      mode: 'control',
      url: 'wss://computer.example.org/api/computers/sessions/session-2/stream',
    });
    expect(mouse).toHaveBeenCalledTimes(tapThenDrag.length);
    expect(rfb.disconnect).toHaveBeenCalledOnce();

    // The new stream has its own touchpad, and the old one is gone.
    expect(createRfb).toHaveBeenCalledTimes(2);
    expect(canvases[1].isConnected).toBe(true);
    startTouchDrag(canvases[1], 5000);
    expect(mouse).toHaveBeenCalledTimes(2 * tapThenDrag.length);

    act(() => root.unmount());
    expect(mouse).toHaveBeenCalledTimes(2 * tapThenDrag.length);
    expect(rfb.disconnect).toHaveBeenCalledTimes(2);
  });

  it("releases noVNC's pointer capture when the screen closes mid-drag", () => {
    const { createRfb, getCanvas, sent } = createNoVncLikeRfb();
    try {
      renderScreen({ createRfb, mode: 'control' });
      startTouchDrag(getCanvas(), 0);
      expect(capturedElement()).toBe(getCanvas());
      expect(captureOverlay()?.style.display).toBe('');
      const sentWhileOpen = [...sent];
      expect(sentWhileOpen.slice(-2)).toEqual(['mousedown 1', 'mousemove 0']);

      act(() => root.unmount());

      // The page-covering element is gone, so the next tap or click lands where it is aimed.
      expect(rfb.disconnect).toHaveBeenCalledOnce();
      expect(capturedElement()).toBeNull();
      expect(captureOverlay()?.style.display).toBe('none');
      // Nothing more reached the computer: the release came after the disconnect.
      expect(sent).toEqual(sentWhileOpen);
    } finally {
      releaseCapture();
      captureOverlay()?.remove();
    }
  });

  it("releases noVNC's pointer capture when the stream drops mid-drag", () => {
    const { createRfb, getCanvas, dropStream, sent } = createNoVncLikeRfb();
    try {
      renderScreen({ createRfb, mode: 'control' });
      startTouchDrag(getCanvas(), 0);
      expect(capturedElement()).toBe(getCanvas());
      const sentWhileOpen = [...sent];

      // noVNC disconnects itself first; the panel then drops the stream and the screen.
      dropStream();
      act(() => root.unmount());

      expect(capturedElement()).toBeNull();
      expect(captureOverlay()?.style.display).toBe('none');
      expect(sent).toEqual(sentWhileOpen);
    } finally {
      releaseCapture();
      captureOverlay()?.remove();
    }
  });

  it('dispatches nothing when the screen closes without a drag', () => {
    const windowMouseUp = vi.fn();
    window.addEventListener('mouseup', windowMouseUp);
    try {
      for (const tapFirst of [false, true]) {
        const { createRfb, getCanvas, reached } = createNoVncLikeRfb();
        container.remove();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        renderScreen({ createRfb, mode: 'control' });
        if (tapFirst) {
          // A tap's own release lets go of the capture.
          touch('touchstart', getCanvas(), 100, 0);
          touch('touchend', getCanvas(), undefined, 50);
          expect(capturedElement()).toBeNull();
        }
        const reachedBefore = reached.length;
        windowMouseUp.mockClear();

        act(() => root.unmount());

        expect(windowMouseUp).not.toHaveBeenCalled();
        expect(reached).toHaveLength(reachedBefore);
      }
    } finally {
      window.removeEventListener('mouseup', windowMouseUp);
      releaseCapture();
      captureOverlay()?.remove();
    }
  });

  describe('showing the touchpad pointer', () => {
    let coarse: boolean;
    let canvas: HTMLCanvasElement | undefined;
    let size: { width: number; height: number };
    const moves = vi.fn();
    // Like noVNC: a canvas with no size until the stream's first frame sets it.
    const createRfb = vi.fn((target: HTMLElement): RfbClient => {
      const element = document.createElement('canvas');
      element.getBoundingClientRect = () =>
        ({ left: 0, top: 0, ...size, right: size.width, bottom: size.height } as DOMRect);
      // With noVNC's view-only flag at that moment: a view-only noVNC sends nothing.
      element.addEventListener('mousemove', (event) =>
        moves({
          x: (event as MouseEvent).clientX,
          y: (event as MouseEvent).clientY,
          viewOnly: rfb.viewOnly,
        })
      );
      target.append(element);
      canvas = element;
      return rfb;
    });
    const connect = () => {
      size = { width: 400, height: 250 };
      act(() => listeners.get('connect')?.(new Event('connect')));
    };

    beforeEach(() => {
      coarse = true;
      canvas = undefined;
      size = { width: 0, height: 0 };
      moves.mockReset();
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' && coarse }))
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shows it at the canvas centre when control starts on a touch screen', () => {
      renderScreen({ createRfb, mode: 'view' });
      connect();
      expect(moves).not.toHaveBeenCalled();

      // After noVNC stopped being view-only, so it reaches the computer.
      renderScreen({ createRfb, mode: 'control' });
      expect(moves.mock.calls).toEqual([[{ x: 200, y: 125, viewOnly: false }]]);

      renderScreen({ createRfb, mode: 'view' });
      renderScreen({ createRfb, mode: 'control' });
      expect(moves).toHaveBeenCalledTimes(2);
      expect(createRfb).toHaveBeenCalledOnce();
      expect(canvas).toBeDefined();
    });

    it('shows it once the stream connects while already in control', () => {
      renderScreen({ createRfb, mode: 'control' });
      // No frame yet, so no size: nothing to show.
      expect(moves).not.toHaveBeenCalled();
      connect();
      expect(moves.mock.calls).toEqual([[{ x: 200, y: 125, viewOnly: false }]]);
    });

    it('shows nothing for a mouse or trackpad', () => {
      coarse = false;
      renderScreen({ createRfb, mode: 'control' });
      connect();
      renderScreen({ createRfb, mode: 'view' });
      renderScreen({ createRfb, mode: 'control' });
      expect(moves).not.toHaveBeenCalled();
    });
  });

  it('sets touch-action none on the screen only while in control', () => {
    const createRfb = createRfbWithCanvas();
    renderScreen({ createRfb, mode: 'view' });
    const { surface } = screenElements();
    // jsdom has no touch-action, so this checks the class that sets it.
    expect(surface.className).toBe('Screen');

    renderScreen({ createRfb, mode: 'control' });
    expect(surface.classList).toContain('Screen');
    expect(surface.classList).toContain('ScreenInControl');

    renderScreen({ createRfb, mode: 'view' });
    expect(surface.className).toBe('Screen');
    expect(createRfb).toHaveBeenCalledOnce();
  });

  it('leaves focus from the keyboard on the screen element while in control', () => {
    renderScreen({ createRfb: createRfbWithCanvas(), mode: 'control' });
    const { surface, canvas } = screenElements();
    vi.mocked(rfb.focus).mockClear();

    // Tab lands here, and must be free to move on: noVNC takes Tab on its canvas.
    surface.focus();
    expect(document.activeElement).toBe(surface);
    canvas.focus();
    expect(rfb.focus).not.toHaveBeenCalled();
  });

  it('keeps focus on the canvas through a press in the letterbox while in control', () => {
    renderScreen({ createRfb: createRfbWithCanvas(), mode: 'control' });
    const { surface } = screenElements();
    vi.mocked(rfb.focus).mockClear();

    surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(rfb.focus).toHaveBeenCalledOnce();
    expect(rfb.focus).toHaveBeenCalledWith({ preventScroll: true });
    // Its default would move focus from the canvas back to this element.
    expect(mouseDown(surface).defaultPrevented).toBe(true);
  });

  it('leaves focus on the screen element while watching', () => {
    renderScreen({ createRfb: createRfbWithCanvas(), mode: 'view' });
    const { surface } = screenElements();

    // Shift+Tab from the canvas lands here, and must be free to leave the screen.
    surface.focus();
    expect(document.activeElement).toBe(surface);
    expect(rfb.focus).not.toHaveBeenCalled();
    expect(mouseDown(surface).defaultPrevented).toBe(false);
  });
  describe('software keyboard', () => {
    const handle = createRef<ComputerScreenHandle>();
    const onKeyboardChange = vi.fn();
    let client: RfbClient;
    // Like noVNC: a press on its canvas focuses it unless focusOnClick is off.
    const createRfb = vi.fn((target: HTMLElement): RfbClient => {
      const canvas = document.createElement('canvas');
      canvas.tabIndex = -1;
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 250, right: 400, bottom: 250 } as DOMRect);
      canvas.addEventListener('mousedown', () => {
        if (client.focusOnClick) client.focus({ preventScroll: true });
      });
      target.append(canvas);
      client = {
        ...rfb,
        focusOnClick: true,
        focus: (options) => {
          rfb.focus(options);
          canvas.focus(options);
        },
      };
      return client;
    });

    beforeEach(() => {
      onKeyboardChange.mockReset();
      createRfb.mockClear();
    });

    const renderKeyboardScreen = (mode: 'view' | 'control') =>
      act(() => {
        root.render(
          <ComputerScreen
            ref={handle}
            createRfb={createRfb}
            mode={mode}
            onConnected={() => undefined}
            onDisconnected={() => undefined}
            onKeyboardChange={onKeyboardChange}
            protocols={['binary', 'mindroom-ticket.ticket-1']}
            url="wss://computer.example.org/api/computers/sessions/session-1/stream"
          />
        );
      });
    const keyboardInput = () => {
      const input = container.querySelector<HTMLTextAreaElement>('textarea');
      if (!input) throw new Error('The computer screen has no keyboard input.');
      return input;
    };
    const typeText = (text: string) => {
      const input = keyboardInput();
      input.value += text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    };

    it('keeps a hidden textarea inside the screen that no keyboard Tab lands on', () => {
      renderKeyboardScreen('view');
      const input = keyboardInput();
      const { surface } = screenElements();
      expect(surface.contains(input)).toBe(true);
      expect(input.className).toBe('KeyboardInput');
      expect(input.getAttribute('aria-label')).toBe('Type on the computer');
      expect(input.getAttribute('autocapitalize')).toBe('off');
      expect(input.getAttribute('autocorrect')).toBe('off');
      expect(input.getAttribute('autocomplete')).toBe('off');
      expect(input.getAttribute('spellcheck')).toBe('false');
      expect(input.tabIndex).toBe(-1);
      expect(input.value).toBe(SOFT_KEYBOARD_BUFFER);
      // Watching, a screen reader's focus brings up no keyboard.
      expect(input.readOnly).toBe(true);
      renderKeyboardScreen('control');
      expect(input.readOnly).toBe(false);
      // The panel loads the default export lazily and gives it a ref.
      expect(ComputerScreenDefault).toBe(ComputerScreen);
    });

    it('opens the keyboard at once in control, and not while watching', () => {
      renderKeyboardScreen('view');
      handle.current!.openKeyboard();
      expect(document.activeElement).not.toBe(keyboardInput());
      expect(onKeyboardChange).not.toHaveBeenCalled();

      renderKeyboardScreen('control');
      // Synchronously, inside the caller's tap: no render or effect in between.
      handle.current!.openKeyboard();
      expect(document.activeElement).toBe(keyboardInput());
      expect(onKeyboardChange.mock.calls).toEqual([[true]]);
      expect(client.focusOnClick).toBe(false);
      expect(createRfb).toHaveBeenCalledOnce();
    });

    it('follows focus, so a keyboard dismissed by its own control reads closed', () => {
      renderKeyboardScreen('control');
      act(() => handle.current!.openKeyboard());
      act(() => keyboardInput().blur());
      expect(onKeyboardChange.mock.calls).toEqual([[true], [false]]);
      expect(client.focusOnClick).toBe(true);

      // Focus moved elsewhere by any other means reads closed too.
      act(() => handle.current!.openKeyboard());
      act(() => screenElements().surface.focus());
      expect(onKeyboardChange.mock.calls).toEqual([[true], [false], [true], [false]]);
    });

    it('closes the keyboard back to the canvas', () => {
      renderKeyboardScreen('control');
      act(() => handle.current!.openKeyboard());
      vi.mocked(rfb.focus).mockClear();

      act(() => handle.current!.closeKeyboard());
      expect(document.activeElement).toBe(screenElements().canvas);
      expect(onKeyboardChange.mock.calls).toEqual([[true], [false]]);

      // Closed already: nothing moves.
      act(() => handle.current!.closeKeyboard());
      expect(rfb.focus).toHaveBeenCalledOnce();
    });

    it('closes the keyboard when control ends, on the same connection', () => {
      renderKeyboardScreen('control');
      act(() => handle.current!.openKeyboard());

      renderKeyboardScreen('view');
      expect(document.activeElement).not.toBe(keyboardInput());
      expect(onKeyboardChange.mock.calls).toEqual([[true], [false]]);
      expect(createRfb).toHaveBeenCalledOnce();
    });

    it('closes the keyboard for a new connection on the same screen', () => {
      renderKeyboardScreen('control');
      act(() => handle.current!.openKeyboard());
      const firstClient = client;

      act(() => {
        root.render(
          <ComputerScreen
            ref={handle}
            createRfb={(target) => createRfb(target)}
            mode="control"
            onConnected={() => undefined}
            onDisconnected={() => undefined}
            onKeyboardChange={onKeyboardChange}
            protocols={['binary', 'mindroom-ticket.ticket-1']}
            url="wss://computer.example.org/api/computers/sessions/session-1/stream"
          />
        );
      });
      expect(createRfb).toHaveBeenCalledTimes(2);
      expect(client).not.toBe(firstClient);
      expect(document.activeElement).not.toBe(keyboardInput());
      expect(onKeyboardChange.mock.calls).toEqual([[true], [false]]);
      expect(client.focusOnClick).toBe(true);
    });

    it('closes the keyboard when the screen goes', () => {
      renderKeyboardScreen('control');
      act(() => handle.current!.openKeyboard());
      const input = keyboardInput();

      act(() => root.unmount());
      expect(input.isConnected).toBe(false);
      expect(document.activeElement).not.toBe(input);
      expect(onKeyboardChange.mock.calls).toEqual([[true], [false]]);
      root = createRoot(container);
    });

    it('keeps the keyboard open through taps and presses on the screen', () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      try {
        renderKeyboardScreen('control');
        act(() => handle.current!.openKeyboard());
        const { surface, canvas } = screenElements();
        vi.mocked(rfb.focus).mockClear();

        // A touchpad tap: the pointerdown on the screen, then the touchpad's press on the canvas.
        surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        touch('touchstart', canvas, 100, 0);
        touch('touchend', canvas, undefined, 50);
        // A mouse press in the letterbox, whose default would move focus to the screen element.
        surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(mouseDown(surface).defaultPrevented).toBe(true);

        expect(rfb.focus).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(keyboardInput());
        expect(onKeyboardChange.mock.calls).toEqual([[true]]);

        // Closed, a press on the screen takes focus to the canvas again.
        act(() => keyboardInput().blur());
        surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(document.activeElement).toBe(canvas);
        touch('touchstart', canvas, 100, 1000);
        touch('touchend', canvas, undefined, 1050);
        expect(rfb.focus).toHaveBeenCalledTimes(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('types on the computer only in control, with no Ctrl mapped from keys in it', () => {
      const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('iPhone');
      const windowKeyDown = vi.fn();
      window.addEventListener('keydown', windowKeyDown);
      try {
        renderKeyboardScreen('control');
        act(() => handle.current!.openKeyboard());
        const input = keyboardInput();

        // A soft keyboard's key: its keydown stays inside, and the bridge maps nothing from it.
        input.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA' })
        );
        typeText('a');
        input.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
        );
        typeText('\n');
        // A keyboard attached to an iPad: noVNC never sees a letter typed here with Cmd, so
        // Cmd is not sent as Ctrl, and Cmd+Backspace takes one placeholder with no Ctrl held.
        const cmd = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Meta',
          code: 'MetaLeft',
          metaKey: true,
        });
        input.dispatchEvent(cmd);
        expect(cmd.defaultPrevented).toBe(false);
        input.value = input.value.slice(0, -1);
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
        );
        expect(windowKeyDown).not.toHaveBeenCalled();
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([
          [0x61, null],
          [0xff0d, null],
          [0xff08, null],
        ]);

        vi.mocked(rfb.sendKey).mockClear();
        renderKeyboardScreen('view');
        typeText('b');
        expect(rfb.sendKey).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', windowKeyDown);
        platform.mockRestore();
      }
    });

    describe('keys held on the canvas', () => {
      const SHIFT_L = 0xffe1;
      // noVNC's own keyboard on the canvas, which sends a release only for a key it holds.
      const createRfbWithNoVncKeyboard = vi.fn((target: HTMLElement): RfbClient => {
        const canvas = document.createElement('canvas');
        canvas.tabIndex = -1;
        target.append(canvas);
        const keyboard = new NoVncKeyboard(canvas);
        keyboard.onkeyevent = (keysym: number, code: string, down: boolean) =>
          rfb.sendKey(keysym, code, down);
        keyboard.grab();
        return {
          ...rfb,
          focusOnClick: true,
          focus: (options) => canvas.focus(options),
          disconnect: () => {
            keyboard.ungrab();
            rfb.disconnect();
          },
        };
      });
      const renderWithNoVncKeyboard = () =>
        act(() => {
          root.render(
            <ComputerScreen
              ref={handle}
              createRfb={createRfbWithNoVncKeyboard}
              mode="control"
              onConnected={() => undefined}
              onDisconnected={() => undefined}
              protocols={['binary', 'mindroom-ticket.ticket-1']}
              url="wss://computer.example.org/api/computers/sessions/session-1/stream"
            />
          );
        });
      const key = (type: 'keydown' | 'keyup', on: Element, init: KeyboardEventInit) => {
        const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
        on.dispatchEvent(event);
        return event;
      };

      it('releases one held when typing moves to the keyboard, and nothing else', () => {
        renderWithNoVncKeyboard();
        const { canvas } = screenElements();
        expect(document.activeElement).toBe(canvas);

        key('keydown', canvas, { code: 'ShiftLeft', key: 'Shift', shiftKey: true });
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([[SHIFT_L, 'ShiftLeft', true]]);
        act(() => handle.current!.openKeyboard());
        expect(document.activeElement).toBe(keyboardInput());

        // Its keyup lands in the textarea, out of noVNC's reach, and goes on to the canvas.
        key('keyup', keyboardInput(), { code: 'ShiftLeft', key: 'Shift' });
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([
          [SHIFT_L, 'ShiftLeft', true],
          [SHIFT_L, 'ShiftLeft', false],
        ]);

        // Typing then has no Shift. A keydown here never reaches noVNC, and a software
        // keyboard's keyup releases nothing.
        vi.mocked(rfb.sendKey).mockClear();
        key('keydown', keyboardInput(), { code: 'KeyA', key: 'a' });
        typeText('a');
        key('keyup', keyboardInput(), { code: 'KeyA', key: 'a' });
        key('keyup', keyboardInput(), { key: 'Unidentified' });
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([[0x61, null]]);
      });

      it("leaves the clipboard bridge's left Ctrl in step with noVNC's", () => {
        renderWithNoVncKeyboard();
        const { canvas } = screenElements();
        key('keydown', canvas, { code: 'ControlLeft', key: 'Control', ctrlKey: true });
        act(() => handle.current!.openKeyboard());
        key('keyup', keyboardInput(), { code: 'ControlLeft', key: 'Control' });
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([
          [CONTROL_L_KEYSYM, 'ControlLeft', true],
          [CONTROL_L_KEYSYM, 'ControlLeft', false],
        ]);

        // Both know Ctrl is up: a paste then presses and releases the whole chord.
        vi.mocked(rfb.sendKey).mockClear();
        paste('hi', keyboardInput());
        expect(vi.mocked(rfb.sendKey).mock.calls.map(([keysym, , down]) => [keysym, down])).toEqual(
          [
            [CONTROL_L_KEYSYM, true],
            [0x76, true],
            [0x76, false],
            [CONTROL_L_KEYSYM, false],
          ]
        );
      });

      it("keeps the clipboard bridge's Shift from the textarea's keyups", () => {
        renderWithNoVncKeyboard();
        act(() => handle.current!.openKeyboard());
        // Shift held while a letter comes up, then a paste from the Edit menu: no keydown since
        // to read Shift from, so the bridge goes by the last keyup, forwarded one included.
        key('keydown', keyboardInput(), { code: 'ShiftLeft', key: 'Shift', shiftKey: true });
        key('keyup', keyboardInput(), { code: 'KeyA', key: 'A', shiftKey: true });
        paste('hi', keyboardInput());
        expect(vi.mocked(rfb.sendKey).mock.calls.map(([keysym, , down]) => [keysym, down])).toEqual(
          [
            [CONTROL_L_KEYSYM, true],
            [0x56, true],
            [0x56, false],
            [CONTROL_L_KEYSYM, false],
          ]
        );
      });

      it('releases a Caps Lock held on the canvas off Apple, where noVNC holds it', () => {
        renderWithNoVncKeyboard();
        key('keydown', screenElements().canvas, { code: 'CapsLock', key: 'CapsLock' });
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([[0xffe5, 'CapsLock', true]]);
        act(() => handle.current!.openKeyboard());
        key('keyup', keyboardInput(), { code: 'CapsLock', key: 'CapsLock' });
        expect(vi.mocked(rfb.sendKey).mock.calls).toEqual([
          [0xffe5, 'CapsLock', true],
          [0xffe5, 'CapsLock', false],
        ]);
      });

      it('does not pass on Caps Lock, which noVNC toggles on its keyup on Apple', () => {
        const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('iPhone');
        try {
          renderWithNoVncKeyboard();
          act(() => handle.current!.openKeyboard());
          key('keyup', keyboardInput(), { code: 'CapsLock', key: 'CapsLock' });
          expect(rfb.sendKey).not.toHaveBeenCalled();
        } finally {
          platform.mockRestore();
        }
      });
    });

    it('pastes into the computer, not as typing, from the open keyboard', () => {
      renderKeyboardScreen('control');
      act(() => handle.current!.openKeyboard());

      const event = paste('hello', keyboardInput());
      expect(event.defaultPrevented).toBe(true);
      expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith('hello');
      // The chord only: Ctrl, v, v, Ctrl. No letter of the text is typed.
      expect(vi.mocked(rfb.sendKey).mock.calls.map(([keysym]) => keysym)).toEqual([
        CONTROL_L_KEYSYM,
        0x76,
        0x76,
        CONTROL_L_KEYSYM,
      ]);
      expect(keyboardInput().value).toBe(SOFT_KEYBOARD_BUFFER);
    });
  });
});
