// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachComputerTouchpad } from './computerTouchpad';
import { SCROLL_GAIN, pointerGain } from './touchpadGestures';
// noVNC's mouse capture, which its canvas takes on every mousedown. The package exports only RFB.
/* eslint-disable import/no-relative-packages */
import {
  releaseCapture,
  setCapture,
} from '../../../../node_modules/@novnc/novnc/core/util/events.js';
/* eslint-enable import/no-relative-packages */

type Finger = { id: number; x: number; y: number; on?: EventTarget };

type Recorded = {
  type: string;
  x: number;
  y: number;
  button: number;
  buttons: number;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  event: Event;
};

const asTouches = (fingers: Finger[], fallback: EventTarget) =>
  fingers.map(({ id, x, y, on }) => ({
    identifier: id,
    clientX: x,
    clientY: y,
    target: on ?? fallback,
  }));

/**
 * Dispatches a touch event as a browser does: on the element the changed finger started on,
 * with `touches` listing every finger still down afterwards.
 */
const touch = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  on: Element,
  down: Finger[],
  time: number,
  changed: Finger[] = down
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = asTouches(down, on);
  Object.defineProperties(event, {
    touches: { value: touches },
    targetTouches: { value: touches.filter((item) => item.target === on) },
    changedTouches: { value: asTouches(changed, on) },
    timeStamp: { value: time },
  });
  on.dispatchEvent(event);
  return event;
};

const finger = (x: number, y: number, id = 1): Finger => ({ id, x, y });

describe('attachComputerTouchpad', () => {
  let wrapper: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let rect: { left: number; top: number; width: number; height: number };
  let recorded: Recorded[];
  let controlling: boolean;
  let touchpad: ReturnType<typeof attachComputerTouchpad> | undefined;

  const record = (event: Event) => {
    const mouse = event as MouseEvent;
    const entry: Recorded = {
      type: event.type,
      x: mouse.clientX,
      y: mouse.clientY,
      button: mouse.button,
      buttons: mouse.buttons,
      event,
    };
    if (event instanceof WheelEvent) {
      entry.deltaX = event.deltaX;
      entry.deltaY = event.deltaY;
      entry.deltaMode = event.deltaMode;
    }
    recorded.push(entry);
  };

  const attach = () => {
    touchpad = attachComputerTouchpad(wrapper, { isControlling: () => controlling });
    return touchpad;
  };

  // A tap, so the next touch within the double-tap window starts a drag.
  const tap = (at: Finger, from: number, to: number) => {
    touch('touchstart', canvas, [at], from);
    touch('touchend', canvas, [], to, [at]);
  };

  // A tap, then a touch that moves: the left button is held.
  const holdDrag = (from: number) => {
    tap(finger(100, 100), from, from + 50);
    touch('touchstart', canvas, [finger(100, 100)], from + 150);
    touch('touchmove', canvas, [finger(130, 100)], from + 170);
    expect(recorded.at(-2)).toMatchObject({ type: 'mousedown', buttons: 1 });
  };

  const types = (entries = recorded) => entries.map((entry) => entry.type);

  beforeEach(() => {
    recorded = [];
    controlling = true;
    wrapper = document.createElement('div');
    canvas = document.createElement('canvas');
    wrapper.append(canvas);
    document.body.append(wrapper);
    rect = { left: 10, top: 20, width: 400, height: 250 };
    canvas.getBoundingClientRect = () =>
      ({
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => undefined,
      } as DOMRect);
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'wheel']) {
      canvas.addEventListener(type, record);
    }
  });

  afterEach(() => {
    touchpad?.detach();
    touchpad = undefined;
    releaseCapture();
    document.getElementById('noVNC_mouse_capture_elem')?.remove();
    wrapper.remove();
  });

  it('moves a pointer from the canvas centre', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100)], 0);
    touch('touchmove', canvas, [finger(105, 100)], 10);
    expect(recorded).toEqual([]);

    // 15 px in 10 ms past the slop.
    touch('touchmove', canvas, [finger(120, 100)], 20);
    const first = 210 + 15 * pointerGain(1.5);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ type: 'mousemove', x: first, y: 145, buttons: 0 });
    expect(recorded[0].event).toBeInstanceOf(MouseEvent);
    expect(recorded[0].event.bubbles).toBe(true);
    expect(recorded[0].event.cancelable).toBe(true);

    // 1 px down in 20 ms: slow, so the base gain.
    touch('touchmove', canvas, [finger(120, 101)], 40);
    expect(recorded[1]).toMatchObject({
      type: 'mousemove',
      x: first,
      y: 145 + pointerGain(0.05),
      buttons: 0,
    });

    touch('touchend', canvas, [], 60, [finger(120, 101)]);
    expect(types()).toEqual(['mousemove', 'mousemove']);
  });

  it('clamps the pointer to the canvas', () => {
    attach();
    // A fast drag left and down, far past the canvas edges. The pointer stops on the canvas's
    // last pixel: right - 1 and bottom - 1 (the canvas spans 10 to 410 and 20 to 270).
    touch('touchstart', canvas, [finger(300, 100)], 0);
    touch('touchmove', canvas, [finger(200, 300)], 10);
    expect(recorded.at(-1)).toMatchObject({ type: 'mousemove', x: 10, y: 269 });
    touch('touchmove', canvas, [finger(100, 400)], 20);
    expect(recorded.at(-1)).toMatchObject({ type: 'mousemove', x: 10, y: 269 });
    touch('touchend', canvas, [], 30, [finger(100, 400)]);

    // Up and right, then the canvas shrinks (an orientation change or Expand).
    touch('touchstart', canvas, [finger(0, 100)], 1000);
    touch('touchmove', canvas, [finger(200, 0)], 1010);
    expect(recorded.at(-1)).toMatchObject({ type: 'mousemove', x: 409, y: 20 });
    rect = { ...rect, width: 200 };
    touch('touchmove', canvas, [finger(199, 0)], 1030);
    expect(recorded.at(-1)).toMatchObject({ type: 'mousemove', x: 209, y: 20 });
  });

  describe('showing the pointer', () => {
    let coarse: boolean;
    beforeEach(() => {
      coarse = true;
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' && coarse }))
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it('moves the pointer to the canvas centre on a touch screen, then to where it is', () => {
      // noVNC draws its cursor on a touch screen only after a mouse event.
      const { showPointer } = attach();
      showPointer();
      expect(recorded).toEqual([
        expect.objectContaining({ type: 'mousemove', x: 210, y: 145, buttons: 0 }),
      ]);

      // The first tap then clicks where the pointer shows.
      recorded.length = 0;
      tap(finger(50, 50), 0, 50);
      expect(recorded).toEqual([
        expect.objectContaining({ type: 'mousemove', x: 210, y: 145, buttons: 0 }),
        expect.objectContaining({ type: 'mousedown', x: 210, y: 145, buttons: 1 }),
        expect.objectContaining({ type: 'mouseup', x: 210, y: 145, buttons: 0 }),
      ]);

      // Later it shows where the pointer is, kept inside the canvas.
      touch('touchstart', canvas, [finger(100, 100)], 1000);
      touch('touchmove', canvas, [finger(130, 100)], 1020);
      touch('touchend', canvas, [], 1040, [finger(130, 100)]);
      const at = recorded.at(-1)!;
      recorded.length = 0;
      showPointer();
      expect(recorded).toEqual([
        expect.objectContaining({ type: 'mousemove', x: at.x, y: at.y, buttons: 0 }),
      ]);
      // And inside the canvas after it shrank under the pointer.
      rect = { ...rect, width: 50 };
      recorded.length = 0;
      showPointer();
      expect(recorded).toEqual([
        expect.objectContaining({ type: 'mousemove', x: 59, y: at.y, buttons: 0 }),
      ]);
    });

    it('shows nothing for a mouse or trackpad, while watching, or on a canvas with no size', () => {
      const { showPointer } = attach();
      coarse = false;
      showPointer();
      coarse = true;
      controlling = false;
      showPointer();
      controlling = true;
      rect = { ...rect, width: 0 };
      showPointer();
      rect = { ...rect, width: 400, height: 0 };
      showPointer();
      expect(recorded).toEqual([]);
    });
  });

  it('clicks at the pointer', () => {
    attach();
    // Move the pointer off the centre first.
    touch('touchstart', canvas, [finger(100, 100)], 0);
    touch('touchmove', canvas, [finger(130, 100)], 20);
    touch('touchend', canvas, [], 40, [finger(130, 100)]);
    const at = recorded.at(-1)!;
    recorded.length = 0;

    tap(finger(50, 50), 1000, 1050);
    expect(recorded).toEqual([
      expect.objectContaining({ type: 'mousemove', x: at.x, y: at.y, buttons: 0 }),
      expect.objectContaining({ type: 'mousedown', x: at.x, y: at.y, button: 0, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x: at.x, y: at.y, button: 0, buttons: 0 }),
    ]);
  });

  it('moves the pointer before every press', () => {
    attach();
    // As a mouse is over the canvas before it presses: noVNC's drawn cursor and the computer's
    // pointer are at the touchpad's pointer before the button, whatever moved them before.
    const click = (x: number, y: number) => [
      expect.objectContaining({ type: 'mousemove', x, y, buttons: 0 }),
      expect.objectContaining({ type: 'mousedown', x, y, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x, y, buttons: 0 }),
    ];
    tap(finger(50, 50), 0, 50);
    tap(finger(50, 50), 100, 150);
    expect(recorded).toEqual([...click(210, 145), ...click(210, 145)]);

    // The canvas shrinks under the pointer: the next press moves it inside first.
    rect = { ...rect, width: 100, height: 100 };
    recorded.length = 0;
    tap(finger(50, 50), 1000, 1050);
    expect(recorded).toEqual(click(109, 119));
  });

  it('hands each release to noVNC while it holds the mouse capture', () => {
    attach();
    // As noVNC's canvas listener does: a press takes the capture, and no event bubbles on.
    const noVnc = (event: Event) => {
      event.stopPropagation();
      if (event.type === 'mousedown') setCapture(canvas);
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      canvas.addEventListener(type, noVnc);
    }
    const captured = () =>
      (document as Document & { captureElement?: Element | null }).captureElement;
    const overlay = () => document.getElementById('noVNC_mouse_capture_elem');

    tap(finger(100, 100), 0, 50);
    // The page-covering element is gone, so the next touch lands on the screen again.
    expect(captured()).toBeNull();
    expect(overlay()?.style.display).toBe('none');
    expect(recorded).toEqual([
      expect.objectContaining({ type: 'mousemove', x: 210, y: 145, buttons: 0 }),
      expect.objectContaining({ type: 'mousedown', x: 210, y: 145, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x: 210, y: 145, button: 0, buttons: 0 }),
    ]);

    // A drag keeps the capture until the finger lifts.
    recorded.length = 0;
    touch('touchstart', canvas, [finger(100, 100)], 150);
    touch('touchmove', canvas, [finger(130, 100)], 170);
    expect(captured()).toBe(canvas);
    touch('touchend', canvas, [], 190, [finger(130, 100)]);
    expect(captured()).toBeNull();
    expect(types()).toEqual(['mousemove', 'mousedown', 'mousemove', 'mouseup']);
    expect(recorded[3]).toMatchObject({ x: recorded[2].x, buttons: 0 });

    // A two-finger tap's right click too.
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 2000);
    touch('touchend', canvas, [], 2050, [finger(100, 100, 1), finger(160, 100, 2)]);
    expect(captured()).toBeNull();
    expect(recorded.at(-1)).toMatchObject({ type: 'mouseup', button: 2, buttons: 0 });
  });

  it('leaves releases on the canvas where the browser captures the mouse itself', () => {
    attach();
    // Firefox's Element.setCapture, which noVNC uses instead of covering the page.
    const nativeCapture = vi.fn();
    Object.defineProperty(canvas, 'setCapture', { value: nativeCapture });
    canvas.addEventListener('mousedown', () => setCapture(canvas));
    try {
      tap(finger(100, 100), 0, 50);
      expect(nativeCapture).toHaveBeenCalledOnce();
      expect(types()).toEqual(['mousemove', 'mousedown', 'mouseup']);
    } finally {
      (document as Document & { captureElement?: Element | null }).captureElement = null;
    }
  });

  it('right-clicks with two fingers', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100, 1)], 0);
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 30, [
      finger(160, 100, 2),
    ]);
    touch('touchend', canvas, [finger(160, 100, 2)], 120, [finger(100, 100, 1)]);
    touch('touchend', canvas, [], 130, [finger(160, 100, 2)]);

    const presses = recorded.filter((entry) => entry.type !== 'mousemove');
    expect(presses).toEqual([
      expect.objectContaining({ type: 'mousedown', x: 210, y: 145, button: 2, buttons: 2 }),
      expect.objectContaining({ type: 'mouseup', x: 210, y: 145, button: 2, buttons: 0 }),
    ]);
  });

  it('drags with the left button held', () => {
    attach();
    tap(finger(100, 100), 0, 50);
    recorded.length = 0;

    touch('touchstart', canvas, [finger(100, 100)], 150);
    touch('touchmove', canvas, [finger(130, 100)], 170);
    touch('touchmove', canvas, [finger(150, 100)], 190);
    touch('touchend', canvas, [], 210, [finger(150, 100)]);

    expect(types()).toEqual(['mousemove', 'mousedown', 'mousemove', 'mousemove', 'mouseup']);
    expect(recorded[0]).toMatchObject({ x: 210, y: 145, buttons: 0 });
    expect(recorded[1]).toMatchObject({ x: 210, y: 145, button: 0, buttons: 1 });
    expect(recorded[2].x).toBeGreaterThan(210);
    expect(recorded[3].x).toBeGreaterThan(recorded[2].x);
    expect(recorded[4]).toMatchObject({ x: recorded[3].x, button: 0, buttons: 0 });

    // The next touch only moves the pointer.
    recorded.length = 0;
    touch('touchstart', canvas, [finger(100, 100)], 2000);
    touch('touchmove', canvas, [finger(130, 100)], 2020);
    expect(types()).toEqual(['mousemove']);
  });

  it('scrolls at the pointer', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 0);
    // Both fingers up by 30 px: the content scrolls down.
    touch('touchmove', canvas, [finger(100, 70, 1), finger(160, 70, 2)], 20);

    // The pointer moves where it is first, as before a press.
    expect(types()).toEqual(['mousemove', 'wheel']);
    expect(recorded[0]).toMatchObject({ x: 210, y: 145, buttons: 0 });
    const wheels = recorded.filter((entry) => entry.type === 'wheel');
    expect(wheels).toHaveLength(1);
    expect(wheels[0].event).toBeInstanceOf(WheelEvent);
    expect(wheels[0]).toMatchObject({
      x: 210,
      y: 145,
      deltaX: 0,
      deltaY: 30 * SCROLL_GAIN,
      deltaMode: 0,
    });
    expect(wheels[0].event.bubbles).toBe(true);
    expect(wheels[0].event.cancelable).toBe(true);
  });

  it('keeps touches on the canvas from noVNC while watching', () => {
    // noVNC's gesture handler would stop and prevent them itself, view-only or not, and start
    // gestures whose timers and buttons outlast the switch to control.
    controlling = false;
    attach();
    const noVncTouch = vi.fn();
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      canvas.addEventListener(type, noVncTouch);
    }

    const events = [
      touch('touchstart', canvas, [finger(100, 100)], 0),
      touch('touchmove', canvas, [finger(140, 100)], 20),
      touch('touchend', canvas, [], 40, [finger(140, 100)]),
      touch('touchstart', canvas, [finger(100, 100)], 1000),
      touch('touchcancel', canvas, [], 1010, [finger(100, 100)]),
    ];

    expect(noVncTouch).not.toHaveBeenCalled();
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
    expect(recorded).toEqual([]);
  });

  it('leaves the letterbox alone while watching', () => {
    controlling = false;
    attach();
    const pageTouch = vi.fn();
    document.body.addEventListener('touchstart', pageTouch);
    try {
      const start = touch('touchstart', wrapper, [finger(5, 5)], 0);
      const move = touch('touchmove', wrapper, [finger(5, 60)], 20);
      touch('touchend', wrapper, [], 40, [finger(5, 60)]);

      expect(start.defaultPrevented).toBe(false);
      expect(move.defaultPrevented).toBe(false);
      expect(pageTouch).toHaveBeenCalledOnce();
      expect(recorded).toEqual([]);
    } finally {
      document.body.removeEventListener('touchstart', pageTouch);
    }
  });

  it('leaves touches alone before noVNC made its canvas', () => {
    canvas.remove();
    attach();
    const start = touch('touchstart', wrapper, [finger(100, 100)], 0);
    expect(start.defaultPrevented).toBe(false);
  });

  it('stops noVNC from seeing touches while in control', () => {
    attach();
    const noVncTouch = vi.fn();
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      canvas.addEventListener(type, noVncTouch);
      wrapper.addEventListener(type, noVncTouch);
    }

    const events = [
      touch('touchstart', canvas, [finger(100, 100)], 0),
      touch('touchmove', canvas, [finger(140, 100)], 20),
      touch('touchend', canvas, [], 40, [finger(140, 100)]),
      touch('touchstart', canvas, [finger(100, 100)], 1000),
      touch('touchcancel', canvas, [], 1010, [finger(100, 100)]),
    ];

    expect(noVncTouch).not.toHaveBeenCalled();
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
    expect(types()).toEqual(['mousemove']);
  });

  it('counts only the touches that began on the screen', () => {
    attach();
    const outside = document.createElement('button');
    document.body.append(outside);
    const stray = { ...finger(5, 5, 9), on: outside };

    // A finger resting outside the screen does not make this a two-finger gesture.
    touch('touchstart', canvas, [stray, finger(100, 100)], 0, [finger(100, 100)]);
    touch('touchmove', canvas, [stray, finger(130, 100)], 20, [finger(130, 100)]);
    expect(types()).toEqual(['mousemove']);
    touch('touchend', canvas, [stray], 40, [finger(130, 100)]);

    // A finger on the letterbox around the canvas is on the screen: this scrolls.
    // Each finger keeps the element it started on, so the margin finger is not among the
    // canvas finger's targetTouches.
    recorded.length = 0;
    const onCanvas = { ...finger(100, 100), on: canvas };
    const margin = { ...finger(300, 300, 2), on: wrapper };
    touch('touchstart', canvas, [stray, onCanvas], 1000, [onCanvas]);
    touch('touchstart', wrapper, [stray, onCanvas, margin], 1020, [margin]);
    touch('touchmove', canvas, [stray, { ...onCanvas, y: 60 }, { ...margin, y: 260 }], 1040, [
      { ...onCanvas, y: 60 },
    ]);
    expect(types()).toEqual(['mousemove', 'wheel']);
    outside.remove();
  });

  it('releases a held drag on touchcancel', () => {
    attach();
    holdDrag(0);
    recorded.length = 0;
    touch('touchcancel', canvas, [], 200, [finger(130, 100)]);
    expect(recorded).toEqual([expect.objectContaining({ type: 'mouseup', button: 0, buttons: 0 })]);
  });

  it('ignores a finger left down after touchcancel until every finger lifts', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 0);
    // The browser cancels one finger; the other stays down, and a new one lands beside it.
    touch('touchcancel', canvas, [finger(160, 100, 2)], 20, [finger(100, 100, 1)]);
    recorded.length = 0;
    touch('touchstart', canvas, [finger(160, 100, 2), finger(220, 100, 3)], 40, [
      finger(220, 100, 3),
    ]);
    touch('touchend', canvas, [finger(220, 100, 3)], 100, [finger(160, 100, 2)]);
    touch('touchend', canvas, [], 120, [finger(220, 100, 3)]);
    // No right click from the left-over finger and the new one.
    expect(recorded).toEqual([]);

    // Once all have lifted, a tap clicks (moving noVNC's cursor to the pointer first).
    tap(finger(100, 100), 500, 550);
    expect(types()).toEqual(['mousemove', 'mousedown', 'mouseup']);
  });

  it('ignores a finger that was down when control started until every finger lifts', () => {
    controlling = false;
    attach();
    touch('touchstart', canvas, [finger(100, 100, 1)], 0);
    controlling = true;
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 40, [
      finger(160, 100, 2),
    ]);
    touch('touchend', canvas, [finger(160, 100, 2)], 100, [finger(100, 100, 1)]);
    touch('touchend', canvas, [], 120, [finger(160, 100, 2)]);
    expect(recorded).toEqual([]);
  });

  it('sends nothing on detach and lets touches pass', () => {
    // The stream closing lets go of a held button, and releaseNoVncCapture of noVNC's capture.
    const { detach } = attach();
    holdDrag(0);
    recorded.length = 0;
    detach();
    touchpad = undefined;
    expect(recorded).toEqual([]);
    const after = touch('touchstart', canvas, [finger(100, 100)], 1000);
    expect(after.defaultPrevented).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('lets go of a held drag once control ends', () => {
    // noVNC sends nothing once view-only, so the computer's button is released when the
    // stream closes. This ends the gesture and lets go of noVNC's capture here.
    attach();
    tap(finger(100, 100), 0, 50);
    touch('touchstart', canvas, [finger(100, 100)], 150);
    touch('touchmove', canvas, [finger(130, 100)], 170);
    recorded.length = 0;

    controlling = false;
    // Still kept from noVNC, as every touch on the canvas is.
    const move = touch('touchmove', canvas, [finger(160, 100)], 190);
    expect(move.defaultPrevented).toBe(true);
    expect(recorded).toEqual([expect.objectContaining({ type: 'mouseup', buttons: 0 })]);

    touch('touchend', canvas, [], 210, [finger(160, 100)]);
    touchpad?.detach();
    touchpad = undefined;
    expect(recorded).toHaveLength(1);
  });
});
