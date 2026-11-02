// A laptop-touchpad model for touch screens. This is a pure state machine: it holds no DOM
// state and never reads the clock, so the caller passes the time of every frame.
// It turns touch frames into pointer actions; the DOM layer turns those into mouse events.

export type TouchPoint = { id: number; x: number; y: number };

export type TouchpadAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'click'; button: 'left' | 'right' }
  | { type: 'dragStart' }
  | { type: 'dragEnd' }
  | { type: 'scroll'; dx: number; dy: number };

export type TouchpadRecognizer = {
  /** All touches that are down after the new one landed. */
  start(points: TouchPoint[], time: number): TouchpadAction[];
  /** All touches that are down. */
  move(points: TouchPoint[], time: number): TouchpadAction[];
  /** The touches that are still down after one lifted. */
  end(remaining: TouchPoint[], time: number): TouchpadAction[];
  /**
   * Releases a held drag and forgets the gesture. Fingers still down are ignored until every
   * finger has lifted, so they cannot start a gesture of their own.
   */
  cancel(remaining?: TouchPoint[]): TouchpadAction[];
};

// Movement up to this many px still counts as a tap.
export const TAP_SLOP = 10;
// A touch that lifts within this many ms is a tap, otherwise a press.
export const TAP_MS = 250;
// A touch that starts within this many ms of a tap's end, and within DOUBLE_TAP_SLOP px
// of it, is a second tap, or the start of a tap-then-drag.
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 30;
// Two fingers belong to one gesture when they land within this many ms of each other.
export const TWO_FINGER_MS = 100;
// Scroll px per px of midpoint movement.
export const SCROLL_GAIN = 2;
// Pointer gain: BASE_GAIN up to GAIN_SLOW_SPEED px/ms, then rising linearly to MAX_GAIN at
// GAIN_FAST_SPEED px/ms. Slow drags stay precise, and one fast swipe crosses the screen.
export const BASE_GAIN = 1.5;
export const MAX_GAIN = 3;
export const GAIN_SLOW_SPEED = 0.3;
export const GAIN_FAST_SPEED = 1.5;

export function pointerGain(speedPxPerMs: number): number {
  const t = (speedPxPerMs - GAIN_SLOW_SPEED) / (GAIN_FAST_SPEED - GAIN_SLOW_SPEED);
  return BASE_GAIN + (MAX_GAIN - BASE_GAIN) * Math.min(1, Math.max(0, t));
}

type Point = { x: number; y: number };

type Tap = Point & { time: number };

type OneFinger = Point & {
  id: number;
  time: number; // time of the last frame; x and y are its position
};

type State =
  | { kind: 'idle' }
  // One finger that has not passed the slop. `armed` when it started right after a tap.
  | (OneFinger & { kind: 'pending1'; origin: Point; startTime: number; armed: boolean })
  | (OneFinger & { kind: 'moving' })
  | (OneFinger & { kind: 'dragging' })
  // Two fingers that landed together and have not scrolled yet.
  | {
      kind: 'pending2';
      ids: [number, number];
      origins: [Point, Point];
      startTime: number;
      tap: boolean; // false once either finger passed the slop
      startMid: Point;
      lastMid: Point;
    }
  | { kind: 'scrolling'; ids: [number, number]; lastMid: Point }
  // A gesture the recognizer gave up on: nothing is emitted until every finger lifts.
  | { kind: 'ignored' };

const IDLE: State = { kind: 'idle' };
const IGNORED: State = { kind: 'ignored' };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const findPoint = (points: TouchPoint[], id: number) => points.find((point) => point.id === id);

export function createTouchpadRecognizer(): TouchpadRecognizer {
  let state: State = IDLE;
  let lastTap: Tap | null = null;

  // Where to go when a finger lifted: idle if none are left, else wait for them to lift.
  const settle = (remaining: TouchPoint[]) => {
    state = remaining.length === 0 ? IDLE : IGNORED;
  };

  const beginOneFinger = (point: TouchPoint, time: number) => {
    const armed =
      lastTap !== null &&
      time - lastTap.time <= DOUBLE_TAP_MS &&
      distance(point, lastTap) <= DOUBLE_TAP_SLOP;
    lastTap = null;
    state = {
      kind: 'pending1',
      id: point.id,
      x: point.x,
      y: point.y,
      time,
      origin: { x: point.x, y: point.y },
      startTime: time,
      armed,
    };
  };

  const beginTwoFingers = (
    first: TouchPoint,
    firstOrigin: Point,
    second: TouchPoint,
    startTime: number
  ) => {
    lastTap = null;
    const mid = midpoint(first, second);
    state = {
      kind: 'pending2',
      ids: [first.id, second.id],
      origins: [firstOrigin, { x: second.x, y: second.y }],
      startTime,
      tap: true,
      startMid: mid,
      lastMid: mid,
    };
  };

  // The pointer delta of one frame of a finger, scaled by the gain of that frame's speed.
  const frameMove = (finger: OneFinger, point: TouchPoint, time: number): TouchpadAction[] => {
    const dx = point.x - finger.x;
    const dy = point.y - finger.y;
    finger.x = point.x;
    finger.y = point.y;
    const elapsed = Math.max(time - finger.time, 1);
    finger.time = time;
    if (dx === 0 && dy === 0) return [];
    const gain = pointerGain(Math.hypot(dx, dy) / elapsed);
    return [{ type: 'move', dx: dx * gain, dy: dy * gain }];
  };

  // Natural scrolling: content follows the fingers, so fingers moving up scroll down.
  // `0 -` rather than a unary minus keeps a zero delta at +0 instead of -0.
  const scrollBy = (from: Point, to: Point): TouchpadAction[] => {
    const dx = 0 - (to.x - from.x) * SCROLL_GAIN;
    const dy = 0 - (to.y - from.y) * SCROLL_GAIN;
    return dx === 0 && dy === 0 ? [] : [{ type: 'scroll', dx, dy }];
  };

  const start: TouchpadRecognizer['start'] = (points, time) => {
    const current = state;
    switch (current.kind) {
      case 'idle': {
        if (points.length === 1) {
          beginOneFinger(points[0], time);
        } else if (points.length === 2) {
          beginTwoFingers(points[0], points[0], points[1], time);
        } else {
          lastTap = null;
          state = IGNORED;
        }
        return [];
      }
      case 'pending1': {
        const second = points.find((point) => point.id !== current.id);
        if (points.length === 2 && second && time - current.startTime <= TWO_FINGER_MS) {
          const first = findPoint(points, current.id);
          if (first) {
            beginTwoFingers(first, current.origin, second, current.startTime);
            return [];
          }
        }
        state = IGNORED;
        return [];
      }
      case 'dragging':
        // Another finger lands during a drag: let go of the button.
        state = IGNORED;
        return [{ type: 'dragEnd' }];
      case 'moving':
      case 'pending2':
      case 'scrolling':
        state = IGNORED;
        return [];
      case 'ignored':
        // Wait for every finger to lift.
        return [];
      // no default
    }
  };

  const move: TouchpadRecognizer['move'] = (points, time) => {
    const current = state;
    switch (current.kind) {
      case 'pending1': {
        const point = findPoint(points, current.id);
        if (!point) return [];
        const passed = distance(point, current.origin) > TAP_SLOP;
        const actions = frameMove(current, point, time);
        if (!passed) return [];
        const armed = current.armed;
        state = {
          kind: armed ? 'dragging' : 'moving',
          id: current.id,
          x: current.x,
          y: current.y,
          time,
        };
        return armed ? [{ type: 'dragStart' }, ...actions] : actions;
      }
      case 'moving':
      case 'dragging': {
        const point = findPoint(points, current.id);
        return point ? frameMove(current, point, time) : [];
      }
      case 'pending2': {
        const [firstId, secondId] = current.ids;
        const first = findPoint(points, firstId);
        const second = findPoint(points, secondId);
        if (!first || !second) return [];
        if (
          distance(first, current.origins[0]) > TAP_SLOP ||
          distance(second, current.origins[1]) > TAP_SLOP
        ) {
          current.tap = false;
        }
        const mid = midpoint(first, second);
        const previous = current.lastMid;
        current.lastMid = mid;
        // A pinch moves the fingers but not their midpoint: not scrolling yet.
        if (distance(mid, current.startMid) <= TAP_SLOP) return [];
        state = { kind: 'scrolling', ids: current.ids, lastMid: mid };
        return scrollBy(previous, mid);
      }
      case 'scrolling': {
        const [firstId, secondId] = current.ids;
        const first = findPoint(points, firstId);
        const second = findPoint(points, secondId);
        if (!first || !second) return [];
        const mid = midpoint(first, second);
        const previous = current.lastMid;
        current.lastMid = mid;
        return scrollBy(previous, mid);
      }
      case 'idle':
      case 'ignored':
        return [];
      // no default
    }
  };

  const end: TouchpadRecognizer['end'] = (remaining, time) => {
    const current = state;
    switch (current.kind) {
      case 'pending1': {
        if (findPoint(remaining, current.id)) return [];
        const tapped = time - current.startTime <= TAP_MS;
        const at = { x: current.x, y: current.y, time };
        settle(remaining);
        if (!tapped) return [];
        // The second tap of a double tap arms nothing, so a third touch is no tap-then-drag.
        if (!current.armed) lastTap = at;
        return [{ type: 'click', button: 'left' }];
      }
      case 'moving': {
        if (findPoint(remaining, current.id)) return [];
        settle(remaining);
        return [];
      }
      case 'dragging': {
        if (findPoint(remaining, current.id)) return [];
        settle(remaining);
        return [{ type: 'dragEnd' }];
      }
      case 'pending2': {
        if (current.ids.every((id) => findPoint(remaining, id))) return [];
        const tapped = current.tap && time - current.startTime <= TAP_MS;
        settle(remaining);
        return tapped ? [{ type: 'click', button: 'right' }] : [];
      }
      case 'scrolling': {
        if (current.ids.every((id) => findPoint(remaining, id))) return [];
        // One of two fingers lifted: the scroll is over, whatever the other finger does next.
        settle(remaining);
        return [];
      }
      case 'ignored':
        settle(remaining);
        return [];
      case 'idle':
        return [];
      // no default
    }
  };

  const cancel: TouchpadRecognizer['cancel'] = (remaining = []) => {
    const held = state.kind === 'dragging';
    settle(remaining);
    lastTap = null;
    return held ? [{ type: 'dragEnd' }] : [];
  };

  return { start, move, end, cancel };
}
