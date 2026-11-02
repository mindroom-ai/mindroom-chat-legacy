import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { selectAgentSelfState } from './agentRoomState';

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
const TYPE = 'io.mindroom.example';

const stateEvent = (sender: string, stateKey = sender) =>
  new MatrixEvent({
    type: TYPE,
    state_key: stateKey,
    sender,
    room_id: '!room:example.org',
    event_id: `$${sender}${stateKey}`,
    origin_server_ts: 1,
    content: {},
  });

describe('agent self-described room state', () => {
  it('keeps state an agent on the viewer homeserver published about itself while it is in the room', () => {
    const event = stateEvent(agent);
    expect(selectAgentSelfState([event], viewer, () => true)).toEqual([event]);
  });

  it.each([
    ['another user', stateEvent(agent, '@mindroom_other:example.org')],
    ['a user who is not an agent', stateEvent('@mallory:example.org')],
    ['an agent on another homeserver', stateEvent('@mindroom_code:evil.example')],
  ])('ignores state describing %s', (_case, event) => {
    expect(selectAgentSelfState([event], viewer, () => true)).toEqual([]);
  });

  it('ignores state from an agent that left the room', () => {
    expect(selectAgentSelfState([stateEvent(agent)], viewer, () => false)).toEqual([]);
  });
});
