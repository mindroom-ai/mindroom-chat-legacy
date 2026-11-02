import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, expect, it } from 'vitest';
import { useRoomState, type StateTypeToState } from './useRoomState';

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
let serial = 0;
let renderer: ReactTestRenderer | undefined;

const stateEvent = (type: string, stateKey: string, content: Record<string, unknown>) => {
  serial += 1;
  return new MatrixEvent({
    type,
    state_key: stateKey,
    sender: stateKey || viewer,
    room_id: '!room:example.org',
    event_id: `$state${serial}`,
    origin_server_ts: serial,
    content,
  });
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('renders again for room state but not for a member event, which it leaves out', async () => {
  const room = new Room(
    '!room:example.org',
    createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true }),
    viewer,
    { timelineSupport: true }
  );
  const joined = stateEvent('m.room.member', agent, { membership: 'join' });
  await room.addLiveEvents([joined], { addToState: true });
  const seen: StateTypeToState[] = [];
  function Probe() {
    seen.push(useRoomState(room));
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  const renders = seen.length;

  // Sync hands the sender's member event over again with each batch it sends in.
  act(() => {
    room.currentState.setStateEvents([new MatrixEvent(joined.event)]);
    room.currentState.setStateEvents([stateEvent('m.room.member', agent, { membership: 'leave' })]);
  });
  expect(seen).toHaveLength(renders);

  await act(async () => {
    await room.addLiveEvents([stateEvent('m.room.topic', '', { topic: 'Release prep' })], {
      addToState: true,
    });
  });
  expect(seen.at(-1)?.get('m.room.topic')?.get('')?.getContent()).toEqual({
    topic: 'Release prep',
  });
});
