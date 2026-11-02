import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  SCROLL_GAIN,
  TAP_MS,
  TAP_SLOP,
  TWO_FINGER_MS,
  createTouchpadRecognizer,
  pointerGain,
  type TouchPoint,
  type TouchpadAction,
} from './touchpadGestures';

const pt = (id: number, x: number, y: number): TouchPoint => ({ id, x, y });

// Plays a tap of one finger and returns what it emitted.
const tap = (
  recognizer: ReturnType<typeof createTouchpadRecognizer>,
  at: { x: number; y: number },
  from: number,
  to: number,
  id = 1
): TouchpadAction[] => [...recognizer.start([pt(id, at.x, at.y)], from), ...recognizer.end([], to)];

const moves = (actions: TouchpadAction[]) =>
  actions.filter(
    (action): action is Extract<TouchpadAction, { type: 'move' }> => action.type === 'move'
  );

describe('pointerGain', () => {
  it('keeps slow drags at the base gain and speeds up fast ones', () => {
    expect(pointerGain(0)).toBe(1.5);
    expect(pointerGain(0.1)).toBe(1.5);
    expect(pointerGain(0.3)).toBe(1.5);
    expect(pointerGain(0.9)).toBe(2.25);
    expect(pointerGain(1.5)).toBe(3);
    expect(pointerGain(5)).toBe(3);
  });
});

describe('one finger', () => {
  it('moves the pointer once a drag passes the slop', () => {
    const recognizer = createTouchpadRecognizer();
    expect(recognizer.start([pt(1, 0, 0)], 0)).toEqual([]);
    expect(recognizer.move([pt(1, 5, 0)], 10)).toEqual([]);

    // The frame that crosses the slop moves by its own delta (15 px in 10 ms).
    const crossing = recognizer.move([pt(1, 20, 0)], 20);
    expect(crossing).toHaveLength(1);
    expect(crossing[0]).toMatchObject({ type: 'move', dy: 0 });
    expect((crossing[0] as { dx: number }).dx).toBeCloseTo(15 * pointerGain(1.5));

    // Later frames: delta times the gain of the last frame's speed (10 px in 10 ms = 1 px/ms).
    const fast = recognizer.move([pt(1, 30, 4)], 30);
    expect(fast).toHaveLength(1);
    expect((fast[0] as { dx: number }).dx).toBeCloseTo(10 * pointerGain(Math.hypot(10, 4) / 10));
    expect((fast[0] as { dy: number }).dy).toBeCloseTo(4 * pointerGain(Math.hypot(10, 4) / 10));

    // 1 px in 10 ms is slow, so it stays at the base gain.
    expect(recognizer.move([pt(1, 31, 4)], 40)).toEqual([{ type: 'move', dx: 1.5, dy: 0 }]);

    // A frame with no elapsed time counts as 1 ms: 1 px in 1 ms, not an infinite speed.
    const instant = recognizer.move([pt(1, 32, 4)], 40);
    expect((instant[0] as { dx: number }).dx).toBeCloseTo(pointerGain(1));

    expect(recognizer.end([], 50)).toEqual([]);
  });

  it('emits nothing for a frame that did not move the finger', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([pt(1, 0, 0)], 0);
    recognizer.move([pt(1, 30, 0)], 10);
    expect(recognizer.move([pt(1, 30, 0)], 20)).toEqual([]);
  });

  it('clicks on a tap', () => {
    const recognizer = createTouchpadRecognizer();
    expect(recognizer.start([pt(1, 50, 50)], 0)).toEqual([]);
    expect(recognizer.move([pt(1, 55, 52)], 40)).toEqual([]);
    expect(recognizer.end([], 120)).toEqual([{ type: 'click', button: 'left' }]);
  });

  it('clicks only for a lift within TAP_MS', () => {
    const quick = createTouchpadRecognizer();
    expect(tap(quick, { x: 0, y: 0 }, 0, TAP_MS)).toEqual([{ type: 'click', button: 'left' }]);

    const slow = createTouchpadRecognizer();
    expect(tap(slow, { x: 0, y: 0 }, 0, TAP_MS + 1)).toEqual([]);
  });

  it('emits nothing for a long press', () => {
    const recognizer = createTouchpadRecognizer();
    expect(recognizer.start([pt(1, 0, 0)], 0)).toEqual([]);
    expect(recognizer.end([], 600)).toEqual([]);
  });

  it('does not click when the finger passed the slop and came back', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([pt(1, 0, 0)], 0);
    expect(moves(recognizer.move([pt(1, TAP_SLOP + 1, 0)], 20))).toHaveLength(1);
    recognizer.move([pt(1, 0, 0)], 40);
    expect(recognizer.end([], 60)).toEqual([]);
  });

  it('clicks twice for a double tap', () => {
    const recognizer = createTouchpadRecognizer();
    expect(tap(recognizer, { x: 100, y: 100 }, 0, 50)).toEqual([{ type: 'click', button: 'left' }]);
    expect(tap(recognizer, { x: 105, y: 100 }, 250, 300)).toEqual([
      { type: 'click', button: 'left' },
    ]);
  });

  it('drags after a tap then a moving touch', () => {
    const recognizer = createTouchpadRecognizer();
    const actions: TouchpadAction[] = [];
    actions.push(...tap(recognizer, { x: 100, y: 100 }, 0, 50));
    actions.push(...recognizer.start([pt(1, 102, 100)], 200));
    actions.push(...recognizer.move([pt(1, 122, 100)], 220));
    actions.push(...recognizer.move([pt(1, 142, 100)], 240));
    actions.push(...recognizer.end([], 260));

    expect(actions.map((action) => action.type)).toEqual([
      'click',
      'dragStart',
      'move',
      'move',
      'dragEnd',
    ]);
    expect(actions[0]).toEqual({ type: 'click', button: 'left' });
    expect(moves(actions).every((move) => move.dx > 0 && move.dy === 0)).toBe(true);
  });

  it('does not drag when the second touch starts too late', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    const actions = [
      ...recognizer.start([pt(1, 100, 100)], 50 + DOUBLE_TAP_MS + 100),
      ...recognizer.move([pt(1, 140, 100)], 50 + DOUBLE_TAP_MS + 120),
      ...recognizer.end([], 50 + DOUBLE_TAP_MS + 140),
    ];
    expect(actions.map((action) => action.type)).toEqual(['move']);
  });

  it('does not drag when the second touch starts too far from the tap', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    const actions = [
      ...recognizer.start([pt(1, 100 + DOUBLE_TAP_SLOP + 5, 100)], 150),
      ...recognizer.move([pt(1, 200, 100)], 170),
      ...recognizer.end([], 190),
    ];
    expect(actions.map((action) => action.type)).toEqual(['move']);
  });

  it('still arms a drag at the edge of the double tap window and slop', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    const actions = [
      ...recognizer.start([pt(1, 100 + DOUBLE_TAP_SLOP, 100)], 50 + DOUBLE_TAP_MS),
      ...recognizer.move([pt(1, 200, 100)], 50 + DOUBLE_TAP_MS + 20),
      ...recognizer.end([], 50 + DOUBLE_TAP_MS + 40),
    ];
    expect(actions.map((action) => action.type)).toEqual(['dragStart', 'move', 'dragEnd']);
  });

  it('does not click again when the second touch is a long press', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.start([pt(1, 100, 100)], 100);
    expect(recognizer.end([], 100 + TAP_MS + 100)).toEqual([]);
  });

  it('arms no second drag after a tap-drag ends', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.start([pt(1, 100, 100)], 100);
    recognizer.move([pt(1, 140, 100)], 120);
    expect(recognizer.end([], 140)).toEqual([{ type: 'dragEnd' }]);

    const actions = [
      // Within the window and the slop of the first tap, but a tap-drag used it up.
      ...recognizer.start([pt(1, 100, 100)], 200),
      ...recognizer.move([pt(1, 140, 100)], 220),
      ...recognizer.end([], 240),
    ];
    expect(actions.map((action) => action.type)).toEqual(['move']);
  });

  it('arms no drag after the second tap of a double tap', () => {
    const recognizer = createTouchpadRecognizer();
    const actions = [
      ...tap(recognizer, { x: 100, y: 100 }, 0, 50),
      ...tap(recognizer, { x: 100, y: 100 }, 100, 150),
      // Within the window and the slop of the second tap, but that tap was itself armed.
      ...recognizer.start([pt(1, 100, 100)], 200),
      ...recognizer.move([pt(1, 140, 100)], 220),
      ...recognizer.end([], 240),
    ];
    expect(actions.map((action) => action.type)).toEqual(['click', 'click', 'move']);
  });

  it('arms no drag after three fingers landed from idle', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    expect(recognizer.start([pt(1, 100, 100), pt(2, 140, 100), pt(3, 180, 100)], 100)).toEqual([]);
    expect(recognizer.end([], 150)).toEqual([]);

    const actions = [
      ...recognizer.start([pt(1, 100, 100)], 200),
      ...recognizer.move([pt(1, 140, 100)], 220),
      ...recognizer.end([], 240),
    ];
    expect(actions.map((action) => action.type)).toEqual(['move']);
  });

  it('arms no drag when another gesture came between the tap and the touch', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.start([pt(1, 100, 100), pt(2, 140, 100)], 100);
    recognizer.end([], 150);

    const actions = [
      ...recognizer.start([pt(1, 100, 100)], 200),
      ...recognizer.move([pt(1, 140, 100)], 220),
      ...recognizer.end([], 240),
    ];
    expect(actions.map((action) => action.type)).toEqual(['move']);
  });

  it('cancels on a third finger and releases a drag', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.start([pt(1, 100, 100)], 100);
    expect(recognizer.move([pt(1, 140, 100)], 120).map((action) => action.type)).toEqual([
      'dragStart',
      'move',
    ]);

    // Two more fingers land: the held drag is released exactly once.
    expect(recognizer.start([pt(1, 140, 100), pt(2, 10, 10)], 130)).toEqual([{ type: 'dragEnd' }]);
    expect(recognizer.start([pt(1, 140, 100), pt(2, 10, 10), pt(3, 20, 20)], 135)).toEqual([]);

    // Nothing more until every finger lifts.
    expect(recognizer.move([pt(1, 200, 100), pt(2, 10, 10), pt(3, 20, 20)], 140)).toEqual([]);
    expect(recognizer.end([pt(2, 10, 10), pt(3, 20, 20)], 150)).toEqual([]);
    expect(recognizer.end([pt(3, 20, 20)], 160)).toEqual([]);
    expect(recognizer.end([], 170)).toEqual([]);

    // Then the next touch is recognized again.
    expect(tap(recognizer, { x: 0, y: 0 }, 400, 450)).toEqual([{ type: 'click', button: 'left' }]);
  });

  it('releases a drag when three fingers land at once', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.start([pt(1, 100, 100)], 100);
    recognizer.move([pt(1, 140, 100)], 120);
    expect(recognizer.start([pt(1, 140, 100), pt(2, 10, 10), pt(3, 20, 20)], 130)).toEqual([
      { type: 'dragEnd' },
    ]);
    expect(recognizer.end([], 140)).toEqual([]);
  });

  it('ignores a second finger that lands during a one-finger move', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([pt(1, 0, 0)], 0);
    recognizer.move([pt(1, 40, 0)], 20);
    expect(recognizer.start([pt(1, 40, 0), pt(2, 90, 0)], 30)).toEqual([]);
    expect(recognizer.move([pt(1, 80, 0), pt(2, 130, 0)], 40)).toEqual([]);
    expect(recognizer.end([pt(2, 130, 0)], 50)).toEqual([]);
    expect(recognizer.end([], 60)).toEqual([]);
  });
});

describe('two fingers', () => {
  const left = (y: number, x = 100) => pt(1, x, y);
  const right = (y: number, x = 200) => pt(2, x, y);

  it('right-clicks on a two-finger tap', () => {
    const recognizer = createTouchpadRecognizer();
    expect(recognizer.start([left(100)], 0)).toEqual([]);
    expect(recognizer.start([left(100), right(100)], 30)).toEqual([]);
    expect(recognizer.move([left(104), right(103)], 60)).toEqual([]);
    expect(recognizer.end([right(103)], 120)).toEqual([{ type: 'click', button: 'right' }]);
    // The second finger lifting adds nothing.
    expect(recognizer.end([], 130)).toEqual([]);
  });

  it('right-clicks when both fingers lift at the same time', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.end([], 100)).toEqual([{ type: 'click', button: 'right' }]);
  });

  it('does not right-click on a long two-finger hold', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100)], 0);
    recognizer.start([left(100), right(100)], 30);
    expect(recognizer.end([right(100)], TAP_MS + 100)).toEqual([]);
    expect(recognizer.end([], TAP_MS + 120)).toEqual([]);
  });

  it('does not right-click when a finger passed the slop', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    // The second finger drifts alone: the midpoint stays under the slop, but it is no tap.
    recognizer.move([left(100), right(100 + TAP_SLOP + 4, 200)], 40);
    expect(recognizer.end([], 80)).toEqual([]);
  });

  it('ignores fingers that land too far apart in time', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100)], 0);
    expect(recognizer.start([left(100), right(100)], TWO_FINGER_MS + 1)).toEqual([]);
    expect(recognizer.move([left(40), right(40)], 150)).toEqual([]);
    expect(recognizer.end([right(40)], 160)).toEqual([]);
    expect(recognizer.end([], 170)).toEqual([]);

    // Lifting both fingers then is no right-click either.
    const late = createTouchpadRecognizer();
    late.start([left(100)], 0);
    late.start([left(100), right(100)], TWO_FINGER_MS + 1);
    expect(late.end([], 150)).toEqual([]);
  });

  it('stays ignored while any finger of an ignored gesture is down', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100)], 0);
    recognizer.start([left(100), right(100)], TWO_FINGER_MS + 1);
    recognizer.end([right(100)], 150);
    // A new finger lands next to the one still down: that is still the ignored gesture.
    expect(recognizer.start([right(100), pt(3, 150, 100)], 160)).toEqual([]);
    expect(recognizer.end([], 200)).toEqual([]);
  });

  it('accepts fingers that land exactly TWO_FINGER_MS apart', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100)], 0);
    recognizer.start([left(100), right(100)], TWO_FINGER_MS);
    expect(recognizer.end([], 150)).toEqual([{ type: 'click', button: 'right' }]);
  });

  it('scrolls with two fingers, naturally', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);

    // Fingers up by 30 px (midpoint dy = -30) scroll the content down: dy > 0.
    expect(recognizer.move([left(70), right(70)], 20)).toEqual([
      { type: 'scroll', dx: 0, dy: 30 * SCROLL_GAIN },
    ]);
    // Fingers right by 30 px scroll the content left: dx < 0.
    const sideways = recognizer.move([left(70, 130), right(70, 230)], 40);
    expect(sideways).toEqual([{ type: 'scroll', dx: -30 * SCROLL_GAIN, dy: 0 }]);
    // Fingers down scroll up.
    expect(recognizer.move([left(80, 130), right(80, 230)], 60)).toEqual([
      { type: 'scroll', dx: 0, dy: -10 * SCROLL_GAIN },
    ]);

    // No click and no move when they lift.
    expect(recognizer.end([right(80, 230)], 80)).toEqual([]);
    expect(recognizer.end([], 90)).toEqual([]);
  });

  it('matches fingers by id, not by position in the list', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.move([right(70), left(70)], 20)).toEqual([
      { type: 'scroll', dx: 0, dy: 30 * SCROLL_GAIN },
    ]);
  });

  it('holds off scrolling until the midpoint passes the slop', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.move([left(94), right(94)], 20)).toEqual([]);
    // The frame that passes the slop scrolls by its own delta (6 px).
    expect(recognizer.move([left(88), right(88)], 40)).toEqual([
      { type: 'scroll', dx: 0, dy: 6 * SCROLL_GAIN },
    ]);
  });

  it('ignores a pinch', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.move([left(100, 70), right(100, 230)], 20)).toEqual([]);
    expect(recognizer.move([left(100, 40), right(100, 260)], 40)).toEqual([]);
    // A pinch is no tap either.
    expect(recognizer.end([right(100, 260)], 80)).toEqual([]);
    expect(recognizer.end([], 90)).toEqual([]);
  });

  it('stops scrolling when one of two fingers lifts', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.move([left(60), right(60)], 20)).toHaveLength(1);

    expect(recognizer.end([right(60)], 30)).toEqual([]);
    // The finger that stays down keeps moving: no move, no scroll, no click.
    expect(recognizer.move([right(20)], 40)).toEqual([]);
    expect(recognizer.move([right(0)], 50)).toEqual([]);
    expect(recognizer.end([], 60)).toEqual([]);

    // Then the next touch is recognized again.
    expect(tap(recognizer, { x: 0, y: 0 }, 400, 450)).toEqual([{ type: 'click', button: 'left' }]);
  });

  it('stops scrolling when a third finger lands', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.move([left(60), right(60)], 20)).toHaveLength(1);

    expect(recognizer.start([left(60), right(60), pt(3, 150, 60)], 30)).toEqual([]);
    expect(recognizer.move([left(0), right(0), pt(3, 150, 0)], 40)).toEqual([]);
    expect(recognizer.end([], 50)).toEqual([]);
  });

  it('does not right-click when a third finger lands on a two-finger tap', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([left(100), right(100)], 0);
    expect(recognizer.start([left(100), right(100), pt(3, 150, 100)], 20)).toEqual([]);
    expect(recognizer.end([right(100), pt(3, 150, 100)], 60)).toEqual([]);
    expect(recognizer.end([], 80)).toEqual([]);
  });
});

describe('cancel', () => {
  it('releases a held drag', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.start([pt(1, 100, 100)], 100);
    recognizer.move([pt(1, 140, 100)], 120);
    expect(recognizer.cancel()).toEqual([{ type: 'dragEnd' }]);
    expect(recognizer.cancel()).toEqual([]);
    // The cancelled touch ends quietly.
    expect(recognizer.end([], 140)).toEqual([]);
  });

  it('emits nothing when no drag is held', () => {
    const recognizer = createTouchpadRecognizer();
    expect(recognizer.cancel()).toEqual([]);
    recognizer.start([pt(1, 0, 0)], 0);
    recognizer.move([pt(1, 40, 0)], 20);
    expect(recognizer.cancel()).toEqual([]);
  });

  it('ignores the fingers left down until every one lifts', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([pt(1, 100, 100), pt(2, 140, 100)], 0);
    // One finger is cancelled; the other stays down, and a new one lands next to it.
    expect(recognizer.cancel([pt(2, 140, 100)])).toEqual([]);
    expect(recognizer.start([pt(2, 140, 100), pt(3, 180, 100)], 40)).toEqual([]);
    expect(recognizer.move([pt(2, 140, 60), pt(3, 180, 60)], 60)).toEqual([]);
    // No right click when they lift.
    expect(recognizer.end([pt(3, 180, 60)], 100)).toEqual([]);
    expect(recognizer.end([], 120)).toEqual([]);
    // Then the next tap clicks again.
    expect(tap(recognizer, { x: 0, y: 0 }, 400, 450)).toEqual([{ type: 'click', button: 'left' }]);
  });

  it('is ready for the next touch when no finger is left', () => {
    const recognizer = createTouchpadRecognizer();
    recognizer.start([pt(1, 100, 100)], 0);
    expect(recognizer.cancel([])).toEqual([]);
    expect(tap(recognizer, { x: 0, y: 0 }, 100, 150)).toEqual([{ type: 'click', button: 'left' }]);
  });

  it('forgets the last tap', () => {
    const recognizer = createTouchpadRecognizer();
    tap(recognizer, { x: 100, y: 100 }, 0, 50);
    recognizer.cancel();
    const actions = [
      ...recognizer.start([pt(1, 100, 100)], 100),
      ...recognizer.move([pt(1, 140, 100)], 120),
      ...recognizer.end([], 140),
    ];
    expect(actions.map((action) => action.type)).toEqual(['move']);
  });
});
