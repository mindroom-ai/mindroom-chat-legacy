// @vitest-environment node

import {
  EncryptionSettings,
  OlmMachine,
  RoomId,
  UserId,
  DeviceId,
  initAsync,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import { createClient, MatrixEvent, MemoryStore, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const ROOM_ID = '!room:example';
const AGENT_ID = '@agent:example';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Only what the Rust crypto backend asks for while it starts and checks the key backup.
const fetchFn = vi.fn<typeof fetch>(async (input) => {
  const { pathname } = new URL(String(input));
  if (pathname.endsWith('/keys/upload')) return json({ one_time_key_counts: {} });
  if (pathname.endsWith('/keys/query')) return json({ device_keys: {} });
  if (pathname.endsWith('/room_keys/version')) {
    return json({ errcode: 'M_NOT_FOUND', error: 'No backup' }, 404);
  }
  return json({});
});

type EventDecryptorInternals = {
  eventDecryptor: { getEventsPendingRoomKey(roomId: string, sessionId: string): MatrixEvent[] };
  perSessionBackupDownloader: { onDecryptionKeyMissingError(roomId: string, id: string): void };
};

describe('Rust crypto decryption of live reply frames', () => {
  const clients: MatrixClient[] = [];
  let encryptedContent: Record<string, unknown>;

  beforeAll(async () => {
    await initAsync();
    // The agent's own session, which the viewer never received a key for.
    const agent = await OlmMachine.initialize(new UserId(AGENT_ID), new DeviceId('AGENT'));
    await agent.shareRoomKey(new RoomId(ROOM_ID), [], new EncryptionSettings());
    encryptedContent = JSON.parse(
      await agent.encryptRoomEvent(
        new RoomId(ROOM_ID),
        'io.mindroom.live',
        JSON.stringify({ v: 1, reply: '$reply' })
      )
    );
  });

  afterEach(() => {
    clients.splice(0).forEach((client) => client.stopClient());
  });

  const decryptAs = async (eventId: string) => {
    const client = createClient({
      baseUrl: 'https://matrix.example',
      userId: '@alice:example',
      deviceId: 'VIEWER',
      accessToken: 'token',
      store: new MemoryStore(),
      fetchFn,
    });
    clients.push(client);
    await client.initRustCrypto({ useIndexedDB: false });
    const internals = client.getCrypto() as unknown as EventDecryptorInternals;
    const backupDownload = vi.spyOn(
      internals.perSessionBackupDownloader,
      'onDecryptionKeyMissingError'
    );
    const event = new MatrixEvent({
      type: 'm.room.encrypted',
      content: encryptedContent,
      sender: AGENT_ID,
      room_id: ROOM_ID,
      event_id: eventId,
      origin_server_ts: Date.now(),
    });

    await client.decryptEventIfNeeded(event);

    const pending = internals.eventDecryptor.getEventsPendingRoomKey(
      ROOM_ID,
      encryptedContent.session_id as string
    );
    return { event, pending, backupDownload };
  };

  it('keeps a timeline event without its key pending and asks the key backup for it', async () => {
    const { event, pending, backupDownload } = await decryptAs('$timeline');

    expect(event.isDecryptionFailure()).toBe(true);
    expect(pending).toEqual([event]);
    expect(backupDownload).toHaveBeenCalledWith(ROOM_ID, encryptedContent.session_id);
  });

  it('drops a live frame without its key instead of keeping it pending', async () => {
    const { event, pending, backupDownload } = await decryptAs('$io.mindroom.live.1');

    expect(event.isDecryptionFailure()).toBe(true);
    expect(pending).toEqual([]);
    expect(backupDownload).not.toHaveBeenCalled();
  });
});
