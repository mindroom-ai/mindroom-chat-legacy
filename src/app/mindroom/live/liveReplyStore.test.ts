import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveDocs, LiveFrame } from './liveFrame';
import { LIVE_DOCUMENT_CAP, LIVE_REPLY_FRESHNESS_MS, LiveReplyStore } from './liveReplyStore';

const ROOM = '!room:example';
const REPLY = '$reply';
const AGENT = '@agent:example';
const SID = '1761858000123-0a1b2c3d';
const NEWER_SID = '1761858000999-0a1b2c3d';

const docs = (md: string): LiveDocs => ({
  md,
  reasoning: '',
  tools: [],
  status: 'streaming',
  activity: '',
});
const snapshot = (seq: number, md: string, sid = SID): LiveFrame => ({
  reply: REPLY,
  sid,
  seq,
  snapshot: docs(md),
});
const append = (seq: number, before: string, ins: string, sid = SID): LiveFrame => ({
  reply: REPLY,
  sid,
  seq,
  delta: { md: { at: before.length, del: 0, ins, len: before.length + ins.length } },
});

describe('LiveReplyStore', () => {
  let store: LiveReplyStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new LiveReplyStore();
  });

  afterEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  const md = () => store.get(ROOM, REPLY)?.docs.md;

  it('creates an entry from a snapshot', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);

    expect(store.get(ROOM, REPLY)).toEqual({
      sender: AGENT,
      sid: SID,
      seq: 0,
      docs: docs('Hello'),
      lastFrameAt: 1000,
      stale: false,
    });
  });

  it('ignores a delta for a reply it has no snapshot of', () => {
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), 1000);

    expect(store.get(ROOM, REPLY)).toBeUndefined();
  });

  it('applies deltas in order', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(1, 'Hello', ','), 1100);
    store.ingest(ROOM, AGENT, append(2, 'Hello,', ' world'), 1200);

    expect(store.get(ROOM, REPLY)).toMatchObject({
      seq: 2,
      docs: docs('Hello, world'),
      lastFrameAt: 1200,
      stale: false,
    });
  });

  it('marks the entry stale after a gap and keeps its last documents', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(2, 'Hello,', ' world'), 1100);

    expect(store.get(ROOM, REPLY)).toMatchObject({ seq: 0, docs: docs('Hello'), stale: true });
  });

  it('marks the entry stale when a splice does not fit its document', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(1, 'Hello there', '!'), 1100);

    expect(store.get(ROOM, REPLY)).toMatchObject({ docs: docs('Hello'), stale: true });
  });

  it('ignores deltas while stale until a newer snapshot', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(2, 'Hello,', ' world'), 1100);
    store.ingest(ROOM, AGENT, append(1, 'Hello', ','), 1200);
    expect(store.get(ROOM, REPLY)).toMatchObject({ docs: docs('Hello'), stale: true });

    store.ingest(ROOM, AGENT, snapshot(3, 'Hello, world!'), 1300);
    store.ingest(ROOM, AGENT, append(4, 'Hello, world!', '?'), 1400);

    expect(store.get(ROOM, REPLY)).toMatchObject({
      seq: 4,
      docs: docs('Hello, world!?'),
      stale: false,
    });
  });

  it('ignores older and duplicate frames', () => {
    store.ingest(ROOM, AGENT, snapshot(3, 'Newest'), 1000);
    store.ingest(ROOM, AGENT, snapshot(3, 'Duplicate'), 1100);
    store.ingest(ROOM, AGENT, snapshot(2, 'Older'), 1200);
    store.ingest(ROOM, AGENT, append(3, 'Newest', '!'), 1300);

    expect(store.get(ROOM, REPLY)).toMatchObject({
      seq: 3,
      docs: docs('Newest'),
      lastFrameAt: 1000,
    });
  });

  it('lets a newer publisher generation replace the entry with its first snapshot', () => {
    store.ingest(ROOM, AGENT, snapshot(9, 'First run'), 1000);
    store.ingest(ROOM, AGENT, snapshot(0, 'Restarted', NEWER_SID), 1100);
    store.ingest(ROOM, AGENT, snapshot(10, 'Old publisher'), 1200);

    expect(store.get(ROOM, REPLY)).toMatchObject({ sid: NEWER_SID, seq: 0 });
    expect(md()).toBe('Restarted');
  });

  it('ignores frames from a sender other than the entry sender', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, '@mallory:example', snapshot(5, 'Forged'), 1100);

    expect(store.get(ROOM, REPLY)).toMatchObject({ sender: AGENT, docs: docs('Hello') });
  });

  it('marks the entry stale when a document grows past the cap', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(1, 'Hello', 'x'.repeat(LIVE_DOCUMENT_CAP)), 1100);

    expect(store.get(ROOM, REPLY)).toMatchObject({ docs: docs('Hello'), stale: true });
  });

  it('ignores a first snapshot past the cap', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'x'.repeat(LIVE_DOCUMENT_CAP + 1)), 1000);

    expect(store.get(ROOM, REPLY)).toBeUndefined();
  });

  it('counts the frames that apply in each room', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), 1100);
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), 1200);
    store.ingest(ROOM, AGENT, append(3, 'Hello!', '?'), 1300);
    store.ingest('!other:example', AGENT, snapshot(0, 'Other'), 1000);

    expect(store.frameCount(ROOM)).toBe(2);
    expect(store.frameCount('!other:example')).toBe(1);
    expect(store.frameCount('!quiet:example')).toBe(0);
  });

  it('expires an entry after its last frame and tells subscribers', () => {
    const listener = vi.fn();
    store.subscribe(ROOM, REPLY, listener);
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), Date.now());
    vi.advanceTimersByTime(LIVE_REPLY_FRESHNESS_MS - 1000);
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), Date.now());
    listener.mockClear();

    vi.advanceTimersByTime(LIVE_REPLY_FRESHNESS_MS - 1);
    expect(store.get(ROOM, REPLY)).toBeDefined();
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(store.get(ROOM, REPLY)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells only the subscribers of the changed reply', () => {
    const listener = vi.fn();
    const other = vi.fn();
    const unsubscribe = store.subscribe(ROOM, REPLY, listener);
    store.subscribe(ROOM, '$other', other);

    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    unsubscribe();
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), 1100);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('drops one entry', () => {
    const listener = vi.fn();
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.subscribe(ROOM, REPLY, listener);

    store.drop(ROOM, REPLY);

    expect(store.get(ROOM, REPLY)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LIVE_REPLY_FRESHNESS_MS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears every entry', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest('!other:example', AGENT, snapshot(0, 'Other'), 1000);

    store.clear();

    expect(store.get(ROOM, REPLY)).toBeUndefined();
    expect(store.get('!other:example', REPLY)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
