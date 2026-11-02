import { EventEmitter } from 'events';
import { ClientEvent, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindLiveReplyFrames } from './bindLiveReplyFrames';
import { LiveReplyStore } from './liveReplyStore';

const ROOM = '!room:example';
const AGENT = '@mindroom_agent:example';
const VIEWER = '@alice:example';
const SID = '1761858000123-0a1b2c3d';

const snapshotFrame = {
  v: 1,
  reply: '$reply',
  sid: SID,
  seq: 0,
  snapshot: { md: 'Hello', reasoning: '', tools: [], status: 'streaming', activity: '' },
};
const deltaFrame = {
  v: 1,
  reply: '$reply',
  sid: SID,
  seq: 1,
  delta: { md: { at: 5, del: 0, ins: '!', len: 6 } },
};
const megolm = (id: string) => ({ algorithm: 'm.megolm.v1.aes-sha2', ciphertext: id });

type Decryption = { type: string; content: unknown } | 'fail';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createClient = ({ encrypted }: { encrypted: boolean }) => {
  const emitter = new EventEmitter();
  const decryptions = new Map<string, Promise<Decryption>>();
  const decrypted: MatrixEvent[] = [];
  // Real MatrixEvent decryption state, with a crypto backend that answers per ciphertext.
  const backend = {
    decryptEvent: async (event: MatrixEvent) => {
      const result = await decryptions.get(event.getWireContent().ciphertext as string);
      if (!result || result === 'fail') {
        throw new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no');
      }
      return { clearEvent: { ...result, room_id: ROOM } };
    },
  };
  const mx = Object.assign(emitter, {
    getUserId: () => VIEWER,
    getRoom: vi.fn((roomId: string) =>
      roomId === ROOM ? { hasEncryptionStateEvent: () => encrypted } : null
    ),
    decryptEventIfNeeded: vi.fn(async (event: MatrixEvent) => {
      decrypted.push(event);
      await event.attemptDecryption(backend as never);
    }),
  }) as unknown as MatrixClient;
  const store = new LiveReplyStore();
  const ingest = vi.spyOn(store, 'ingest');
  const unbind = bindLiveReplyFrames(mx, store);
  const receive = (content: unknown, { sender = AGENT, ts = 1234, roomId = ROOM } = {}) => {
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        type: 'io.mindroom.live',
        content: content as Record<string, unknown>,
        sender,
        room_id: roomId,
        origin_server_ts: ts,
      })
    );
  };
  return { mx, store, ingest, unbind, receive, decryptions, decrypted };
};

// Lets the frame queue run its promise turns.
const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) {
    // eslint-disable-next-line no-await-in-loop -- each turn lets one queued step run.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
};

describe('bindLiveReplyFrames', () => {
  const unbinds: (() => void)[] = [];

  afterEach(() => {
    unbinds.splice(0).forEach((unbind) => unbind());
  });

  const bind = (options: { encrypted: boolean }) => {
    const client = createClient(options);
    unbinds.push(client.unbind);
    return client;
  };

  it('stores plaintext frames of an unencrypted room under the sync room and sender', async () => {
    const { store, receive } = bind({ encrypted: false });

    receive(snapshotFrame);
    receive(deltaFrame);
    receive({ v: 1, reply: '$broken' });
    await settle();

    expect(store.get(ROOM, '$reply')).toMatchObject({ sender: AGENT, seq: 1 });
    expect(store.get(ROOM, '$reply')?.docs.md).toBe('Hello!');
  });

  it('ignores frames of other event types and of rooms the client does not know', async () => {
    const { mx, ingest, receive } = bind({ encrypted: false });

    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({ type: 'm.typing', content: snapshotFrame, sender: AGENT, room_id: ROOM })
    );
    receive(snapshotFrame, { roomId: '!unknown:example' });
    await settle();

    expect(ingest).not.toHaveBeenCalled();
  });

  it('ignores frames from senders that are not MindRoom agents of the viewer', async () => {
    const { ingest, receive } = bind({ encrypted: false });

    receive(snapshotFrame, { sender: '@mallory:example' });
    receive(snapshotFrame, { sender: '@mindroom_agent:elsewhere.example' });
    await settle();

    expect(ingest).not.toHaveBeenCalled();
  });

  it('ignores plaintext frames in an encrypted room', async () => {
    const { ingest, receive, decrypted } = bind({ encrypted: true });

    receive(snapshotFrame);
    await settle();

    expect(decrypted).toEqual([]);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('decrypts a frame as a synthetic room event with the sync room and sender', async () => {
    const { store, receive, decryptions, decrypted } = bind({ encrypted: true });
    decryptions.set('a', Promise.resolve({ type: 'io.mindroom.live', content: snapshotFrame }));

    receive({ v: 1, encrypted: megolm('a') }, { ts: 4321 });
    await settle();

    expect(decrypted).toHaveLength(1);
    const [event] = decrypted;
    expect(event.getWireType()).toBe('m.room.encrypted');
    expect(event.getWireContent()).toEqual(megolm('a'));
    expect(event.getRoomId()).toBe(ROOM);
    expect(event.getSender()).toBe(AGENT);
    expect(event.getTs()).toBe(4321);
    expect(event.getId()).toMatch(/^\$io\.mindroom\.live\.\d+$/);
    expect(store.get(ROOM, '$reply')).toMatchObject({ sender: AGENT, seq: 0 });
  });

  it('gives every synthetic event its own id', async () => {
    const { receive, decryptions, decrypted } = bind({ encrypted: true });
    decryptions.set('a', Promise.resolve({ type: 'io.mindroom.live', content: snapshotFrame }));

    receive({ v: 1, encrypted: megolm('a') });
    receive({ v: 1, encrypted: megolm('a') });
    await settle();

    expect(new Set(decrypted.map((event) => event.getId())).size).toBe(2);
  });

  it('drops frames that fail to decrypt or decrypt to another type', async () => {
    const { ingest, receive, decryptions } = bind({ encrypted: true });
    decryptions.set('fails', Promise.resolve('fail'));
    decryptions.set('other', Promise.resolve({ type: 'm.room.message', content: snapshotFrame }));

    receive({ v: 1, encrypted: megolm('fails') });
    receive({ v: 1, encrypted: megolm('other') });
    receive({ v: 1, encrypted: 'not an object' });
    await settle();

    expect(ingest).not.toHaveBeenCalled();
  });

  it('applies frames in arrival order when their decryptions finish out of order', async () => {
    const { store, receive, decryptions } = bind({ encrypted: true });
    const first = deferred<Decryption>();
    decryptions.set('first', first.promise);
    decryptions.set('second', Promise.resolve({ type: 'io.mindroom.live', content: deltaFrame }));

    receive({ v: 1, encrypted: megolm('first') });
    receive({ v: 1, encrypted: megolm('second') });
    await settle();
    first.resolve({ type: 'io.mindroom.live', content: snapshotFrame });
    await settle();

    expect(store.get(ROOM, '$reply')).toMatchObject({ seq: 1, stale: false });
    expect(store.get(ROOM, '$reply')?.docs.md).toBe('Hello!');
  });

  it('stops listening and clears its store when unbound', async () => {
    const { store, receive, unbind, decryptions } = bind({ encrypted: true });
    const pending = deferred<Decryption>();
    decryptions.set('a', Promise.resolve({ type: 'io.mindroom.live', content: snapshotFrame }));
    decryptions.set('late', pending.promise);
    receive({ v: 1, encrypted: megolm('a') });
    await settle();
    receive({ v: 1, encrypted: megolm('late') });

    unbind();
    pending.resolve({ type: 'io.mindroom.live', content: { ...snapshotFrame, seq: 5 } });
    receive({ v: 1, encrypted: megolm('a') });
    await settle();

    expect(store.get(ROOM, '$reply')).toBeUndefined();
  });
});
