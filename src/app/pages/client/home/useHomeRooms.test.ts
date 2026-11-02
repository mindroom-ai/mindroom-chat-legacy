import { describe, expect, it } from 'vitest';
import { getHomeSearchRooms, mergeHomeSearchRoomSources } from './useHomeRooms';

/** A room whose m.room.create event has the given `type`. */
const roomOfType = (type: string) =>
  ({
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => ({ getContent: () => ({ type }) }) }),
    }),
  } as never);

describe('getHomeSearchRooms', () => {
  it('filters directs, child rooms, and known spaces from the search scope', () => {
    const mx = {
      getRoom: (roomId: string) => (roomId === '!space:example.org' ? roomOfType('m.space') : null),
    } as never;

    expect(
      getHomeSearchRooms(
        mx,
        ['!root:example.org', '!space:example.org', '!child:example.org', '!dm:example.org'],
        new Set(['!dm:example.org']),
        new Map([['!child:example.org', new Set(['!space:example.org'])]])
      )
    ).toEqual(['!root:example.org']);
  });

  it('keeps the server emoji room out of the search scope', () => {
    const mx = {
      getRoom: (roomId: string) =>
        roomId === '!emoji:example.org' ? roomOfType('io.mindroom.emoji') : null,
    } as never;
    const rooms = ['!root:example.org', '!emoji:example.org'];

    expect(getHomeSearchRooms(mx, rooms, new Set(), new Map())).toEqual(['!root:example.org']);
    // Simple mode searches child rooms too, and still has no use for the emoji room.
    expect(getHomeSearchRooms(mx, rooms, new Set(), new Map(), true)).toEqual([
      '!root:example.org',
    ]);
  });

  it('deduplicates room ids when multiple room sources are merged upstream', () => {
    expect(
      mergeHomeSearchRoomSources(
        ['!root:example.org', '!sdk-only:example.org'],
        ['!root:example.org', '!other:example.org']
      )
    ).toEqual(['!root:example.org', '!sdk-only:example.org', '!other:example.org']);
  });
});
