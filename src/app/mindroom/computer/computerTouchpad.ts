import { hasCoarsePointer } from './computerFocus';
import { createTouchpadRecognizer, type TouchPoint, type TouchpadAction } from './touchpadGestures';

// While in control on a touch screen, the computer screen works like a laptop touchpad.
// noVNC's own touch handling is direct touch, so this layer takes touches in front of its
// canvas, keeps a pointer position, and hands noVNC the mouse and wheel events of a touchpad.
// noVNC then sends pointer messages and draws its touch-device cursor as it does for a mouse.

export type ComputerTouchpadOptions = {
  isControlling: () => boolean;
};

export type ComputerTouchpad = {
  detach: () => void;
  /** On a touch screen in control: call it when control starts and when the stream connects. */
  showPointer: () => void;
};

type Point = { x: number; y: number };

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// noVNC takes the mouse on every press. Without Element.setCapture (all but Firefox) it
// covers the page with an element, and lets go when a mouseup reaches the window, as a
// real mouse's does. Its canvas listener stops a mouseup there from bubbling.
const holdsNoVncCapture = (canvas: HTMLCanvasElement) =>
  (document as Document & { captureElement?: unknown }).captureElement === canvas &&
  !('setCapture' in canvas);

/**
 * Lets go of noVNC's capture of a canvas that closed while a touchpad drag held it: its
 * disconnect leaves the page-covering element up, which would take the next tap or click.
 * Call it after `disconnect()`, so noVNC sends nothing more.
 */
export function releaseNoVncCapture(canvas: HTMLCanvasElement | null): void {
  if (!canvas || !holdsNoVncCapture(canvas)) return;
  window.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 })
  );
}

export function attachComputerTouchpad(
  target: HTMLElement,
  options: ComputerTouchpadOptions
): ComputerTouchpad {
  const { isControlling } = options;
  const recognizer = createTouchpadRecognizer();
  // In client coordinates. It starts at the canvas centre.
  let pointer: Point | undefined;

  // The touches that started on the screen, the canvas or its letterbox. `targetTouches`
  // would leave out a finger on the letterbox while another is on the canvas.
  const screenTouches = (event: TouchEvent): TouchPoint[] =>
    Array.from(event.touches)
      .filter((touch) => touch.target instanceof Node && target.contains(touch.target))
      .map((touch) => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY }));

  // While noVNC holds the canvas, a release goes to the window, and noVNC hands it on to the
  // canvas. Otherwise its page-covering element would keep the next touch off the screen.
  const releaseTarget = (canvas: HTMLCanvasElement): EventTarget =>
    holdsNoVncCapture(canvas) ? window : canvas;

  const sendMouse = (
    canvas: HTMLCanvasElement,
    type: 'mousedown' | 'mousemove' | 'mouseup',
    at: Point,
    button: number,
    buttons: number
  ) => {
    const init = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y };
    const on = type === 'mouseup' ? releaseTarget(canvas) : canvas;
    on.dispatchEvent(new MouseEvent(type, { ...init, button, buttons }));
  };

  // Moves the pointer, kept inside the canvas as it is now, which may have been resized, up
  // to its last pixel at right - 1 and bottom - 1: on the edge, noVNC hides its cursor.
  const movePointer = (canvas: HTMLCanvasElement, dx: number, dy: number): Point => {
    const rect = canvas.getBoundingClientRect();
    const from = pointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    pointer = {
      x: clamp(from.x + dx, rect.left, rect.right - 1),
      y: clamp(from.y + dy, rect.top, rect.bottom - 1),
    };
    return pointer;
  };

  // A mouse is over the canvas before it presses or scrolls there. So noVNC's drawn cursor and
  // the computer's pointer go to the pointer first, whatever moved them since.
  const pointAt = (canvas: HTMLCanvasElement): Point => {
    const at = movePointer(canvas, 0, 0);
    sendMouse(canvas, 'mousemove', at, 0, 0);
    return at;
  };

  const perform = (canvas: HTMLCanvasElement, action: TouchpadAction) => {
    switch (action.type) {
      case 'move':
        // noVNC sends a move with the buttons of its last press or release.
        sendMouse(canvas, 'mousemove', movePointer(canvas, action.dx, action.dy), 0, 0);
        return;
      case 'click': {
        const [button, buttons] = action.button === 'left' ? [0, 1] : [2, 2];
        const at = pointAt(canvas);
        sendMouse(canvas, 'mousedown', at, button, buttons);
        sendMouse(canvas, 'mouseup', at, button, 0);
        return;
      }
      case 'dragStart':
        sendMouse(canvas, 'mousedown', pointAt(canvas), 0, 1);
        return;
      case 'dragEnd':
        sendMouse(canvas, 'mouseup', movePointer(canvas, 0, 0), 0, 0);
        return;
      case 'scroll': {
        const at = pointAt(canvas);
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            deltaX: action.dx,
            deltaY: action.dy,
            deltaMode: 0,
          })
        );
        return;
      }
      // no default
    }
  };

  const run = (canvas: HTMLCanvasElement, actions: TouchpadAction[]) => {
    actions.forEach((action) => perform(canvas, action));
  };

  const handleTouch = (event: TouchEvent) => {
    // noVNC builds its canvas in its constructor and takes it out when it disconnects; with
    // none, touches pass through.
    const canvas = target.querySelector('canvas');
    if (!canvas) return;
    if (!isControlling()) {
      // noVNC's gesture handler on the canvas never sees a touch, in either mode: a gesture it
      // starts while watching keeps its button and its long-press timer past the switch to
      // control, which then reach the computer. It stops and prevents every touch on the
      // canvas itself, view-only or not, so the page behaves as before; the letterbox around
      // the canvas is left alone.
      if (event.target === canvas) {
        event.preventDefault();
        event.stopPropagation();
      }
      // Control ended mid-gesture: end it here and let go of noVNC's capture. noVNC sends
      // nothing once view-only; the stream closing releases the computer's button. Fingers
      // still down stay ignored, should control start before they lift.
      run(canvas, recognizer.cancel(screenTouches(event)));
      return;
    }
    // No page scroll or zoom, and noVNC's own gesture handler on the canvas never sees it.
    event.preventDefault();
    event.stopPropagation();
    const time = event.timeStamp;
    switch (event.type) {
      case 'touchstart':
        run(canvas, recognizer.start(screenTouches(event), time));
        break;
      case 'touchmove':
        run(canvas, recognizer.move(screenTouches(event), time));
        break;
      case 'touchend':
        run(canvas, recognizer.end(screenTouches(event), time));
        break;
      case 'touchcancel':
        // The fingers still down are ignored until every finger lifts.
        run(canvas, recognizer.cancel(screenTouches(event)));
        break;
      default:
        break;
    }
  };

  const listenerOptions = { capture: true, passive: false };
  TOUCH_EVENTS.forEach((type) => target.addEventListener(type, handleTouch, listenerOptions));

  // On a touch screen noVNC draws its cursor only after a mouse event, so a first tap would
  // click where no pointer shows. This moves the pointer where it is, the canvas centre at
  // first, so noVNC draws it and the computer's pointer goes there too. A mouse or trackpad
  // shows its own, and a canvas with no size has had no frame yet.
  const showPointer = () => {
    if (!isControlling() || !hasCoarsePointer()) return;
    const canvas = target.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    if (canvas && rect && rect.width > 0 && rect.height > 0) pointAt(canvas);
  };

  // A held button is let go by the stream closing, and noVNC's capture by
  // `releaseNoVncCapture`.
  const detach = () => {
    TOUCH_EVENTS.forEach((type) => target.removeEventListener(type, handleTouch, true));
  };

  return { detach, showPointer };
}
