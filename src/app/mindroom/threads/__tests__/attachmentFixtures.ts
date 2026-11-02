import {
  createClient,
  Room,
  type ICreateClientOpts,
  type MatrixClient,
  type MatrixEvent,
  type IEvent,
} from 'matrix-js-sdk';
import { loadCachedEventAcrossRoomScopes } from '../cacheStore/cacheStoreEvents';

import { createSessionId } from '../../../state/sessions';
import { persistRoomChunkWithPreferLive } from '../eventRepository';
import { saveRoomEventsToCacheCommitted, type CacheStoreWriteLease } from '../cacheStore';
import type { EventAttachment } from '../../messages/eventAttachments';

/** A client of a homeserver without authenticated media, so each download is one request. */
export const createLegacyMediaClient = (opts: ICreateClientOpts): MatrixClient => {
  const mx = createClient(opts);
  mx.getVersions = async () => ({ versions: [], unstable_features: {} });
  return mx;
};

/** Seed the real canonical transaction without transport or renderer side effects. */
export const saveAttachmentOwner = async (
  sessionId: string,
  roomId: string,
  eventId: string,
  revisionTs: number,
  inputs: readonly Pick<EventAttachment, 'mxcUri' | 'essential' | 'maxBytes'>[],
  lease?: CacheStoreWriteLease,
  revision: { revisionId?: string; redacted?: boolean } = {}
): Promise<boolean> => {
  const previous = await loadCachedEventAcrossRoomScopes(sessionId, roomId, eventId);
  const raw: Partial<IEvent> = {
    event_id: eventId,
    room_id: roomId,
    origin_server_ts: revisionTs,
    type: 'm.room.message',
    content: previous?.content ?? { msgtype: 'm.text', body: 'fixture' },
    sender: previous?.sender ?? '@owner:test',
  };
  if (revision.revisionId)
    raw.unsigned = {
      'm.relations': {
        'm.replace': {
          ...raw,
          event_id: revision.revisionId,
          content: {
            'm.new_content': raw.content,
            'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
          },
        },
      },
    };
  if (revision.redacted)
    raw.unsigned = {
      redacted_because: {
        ...(raw as IEvent),
        event_id: '$delete-' + eventId,
        type: 'm.room.redaction',
        redacts: eventId,
        content: {},
      },
    };
  return saveRoomEventsToCacheCommitted(sessionId, roomId, [raw], undefined, 'partial', lease, [
    {
      roomId,
      eventId,
      revisionTs,
      revisionId: revision.revisionId,
      attachments: inputs.map((input) => ({ ...input, autoDownload: false })),
    },
  ]);
};

export const persistAttachmentEvents = async (
  mx: MatrixClient,
  events: readonly MatrixEvent[]
): Promise<void> => {
  for (const roomId of new Set(events.map((event) => event.getRoomId()!))) {
    const room = mx.getRoom(roomId) ?? new Room(roomId, mx, mx.getSafeUserId());
    const mappedEvents = events.filter((event) => event.getRoomId() === roomId);
    await persistRoomChunkWithPreferLive({
      mx,
      room,
      sessionId: createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()),
      chunk: mappedEvents.map((event) => event.event),
      mappedEvents,
    });
  }
};
