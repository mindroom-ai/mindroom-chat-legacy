import type { MatrixClient } from 'matrix-js-sdk';
import { applyLiveDelta, compareLiveOrder, type LiveDocs, type LiveFrame } from './liveFrame';

/** A live entry counts for this long after the last frame that changed it. */
export const LIVE_REPLY_FRESHNESS_MS = 12_000;
/** The longest live text document, in UTF-16 code units. */
export const LIVE_DOCUMENT_CAP = 1_000_000;

export type LiveReplyEntry = {
  sender: string;
  sid: string;
  seq: number;
  docs: LiveDocs;
  lastFrameAt: number;
  /** A frame did not apply; the documents stay at their last valid state until a snapshot. */
  stale: boolean;
};

const entryKey = (roomId: string, replyId: string): string => `${roomId}\0${replyId}`;

const fitsCap = ({ md, reasoning, activity }: LiveDocs): boolean =>
  md.length <= LIVE_DOCUMENT_CAP &&
  reasoning.length <= LIVE_DOCUMENT_CAP &&
  activity.length <= LIVE_DOCUMENT_CAP;

/**
 * The entry after a frame: a new entry when the frame applies, a stale copy of `entry` when it
 * does not, or undefined when the frame changes nothing.
 */
const nextEntry = (
  entry: LiveReplyEntry | undefined,
  sender: string,
  frame: LiveFrame,
  receivedAt: number
): LiveReplyEntry | undefined => {
  if (entry && (entry.sender !== sender || compareLiveOrder(frame, entry) <= 0)) return undefined;
  const fresh = (docs: LiveDocs): LiveReplyEntry => ({
    sender,
    sid: frame.sid,
    seq: frame.seq,
    docs,
    lastFrameAt: receivedAt,
    stale: false,
  });
  const markStale = () => (entry && !entry.stale ? { ...entry, stale: true } : undefined);
  if ('snapshot' in frame) return fitsCap(frame.snapshot) ? fresh(frame.snapshot) : markStale();
  if (!entry) return undefined;
  if (entry.stale || frame.sid !== entry.sid || frame.seq !== entry.seq + 1) return markStale();
  const docs = applyLiveDelta(entry.docs, frame.delta);
  return docs && fitsCap(docs) ? fresh(docs) : markStale();
};

/** Live state of the replies one Matrix client streams, keyed by room and reply event. */
export class LiveReplyStore {
  private readonly entries = new Map<string, LiveReplyEntry>();

  private readonly expiries = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly listeners = new Map<string, Set<() => void>>();

  private readonly roomFrames = new Map<string, number>();

  public ingest(roomId: string, sender: string, frame: LiveFrame, receivedAt: number): void {
    const key = entryKey(roomId, frame.reply);
    const entry = this.entries.get(key);
    const next = nextEntry(entry, sender, frame, receivedAt);
    if (!next) return;
    this.entries.set(key, next);
    if (!next.stale) this.roomFrames.set(roomId, this.frameCount(roomId) + 1);
    if (next.lastFrameAt !== entry?.lastFrameAt) {
      clearTimeout(this.expiries.get(key));
      this.expiries.set(
        key,
        setTimeout(() => this.drop(roomId, frame.reply), LIVE_REPLY_FRESHNESS_MS)
      );
    }
    this.notify(key);
  }

  /** How many frames have applied in the room, so a reader can tell whether one applied since. */
  public frameCount(roomId: string): number {
    return this.roomFrames.get(roomId) ?? 0;
  }

  public get(roomId: string, replyId: string): LiveReplyEntry | undefined {
    return this.entries.get(entryKey(roomId, replyId));
  }

  public drop(roomId: string, replyId: string): void {
    const key = entryKey(roomId, replyId);
    clearTimeout(this.expiries.get(key));
    this.expiries.delete(key);
    if (this.entries.delete(key)) this.notify(key);
  }

  public subscribe(roomId: string, replyId: string, listener: () => void): () => void {
    const key = entryKey(roomId, replyId);
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.listeners.get(key) === listeners) this.listeners.delete(key);
    };
  }

  public clear(): void {
    const keys = [...this.entries.keys()];
    this.expiries.forEach((expiry) => clearTimeout(expiry));
    this.expiries.clear();
    this.entries.clear();
    keys.forEach((key) => this.notify(key));
  }

  private notify(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
  }
}

const stores = new WeakMap<MatrixClient, LiveReplyStore>();

export const getLiveReplyStore = (mx: MatrixClient): LiveReplyStore => {
  let store = stores.get(mx);
  if (!store) {
    store = new LiveReplyStore();
    stores.set(mx, store);
  }
  return store;
};
