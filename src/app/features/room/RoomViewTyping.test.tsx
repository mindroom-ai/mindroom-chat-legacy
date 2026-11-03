import React from 'react';
import { EventEmitter } from 'events';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roomIdToTypingMembersAtom } from '../../state/typingMembers';
import { RoomViewTyping } from './RoomViewTyping';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const Container = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);

  return {
    as: (render: React.ForwardRefRenderFunction<unknown, Record<string, unknown>>) =>
      reactModule.forwardRef(render),
    Box: Container,
    Icon: () => null,
    Icons: { Cross: 'Cross' },
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('./RoomViewTyping.css', () => ({ RoomViewTyping: 'typing', TypingText: 'typing-text' }));

vi.mock('../../components/typing-indicator', () => ({ TypingIndicator: () => null }));

vi.mock('../../components/glass/GlassPrimitives', async () => {
  const reactModule = await import('react');
  return {
    IconButton: reactModule.forwardRef<HTMLButtonElement, { onClick: () => void }>(
      ({ onClick }, ref) => reactModule.createElement('button', { onClick, ref })
    ),
  };
});

vi.mock('../../mindroom/tooltip/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => ME }),
}));

enableMapSet();

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';
const HUMAN = '@alice:example.org';
const AGENT_HERE = '@mindroom_helper:example.org';
const AGENT_ELSEWHERE = '@mindroom_writer:example.org';
const THREAD_HERE = '$thread-here';
const THREAD_ELSEWHERE = '$thread-elsewhere';

const DISPLAY_NAMES: Record<string, string> = {
  [HUMAN]: 'Alice',
  [AGENT_HERE]: 'Helper',
  [AGENT_ELSEWHERE]: 'Writer',
};

const makeStreamingReply = (threadId: string, sender: string) =>
  new MatrixEvent({
    content: {
      body: 'Thinking...',
      msgtype: 'm.text',
      'io.mindroom.stream_status': 'streaming',
      'm.relates_to': { event_id: threadId, rel_type: 'm.thread' },
    },
    event_id: `${threadId}-reply`,
    origin_server_ts: 200,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
  });

const makeThread = (events: MatrixEvent[]) =>
  Object.assign(new EventEmitter(), {
    lastReply: () => events[events.length - 1] ?? null,
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => ({ getEvents: () => events, getNeighbouringTimeline: () => null }),
      relations: { getChildEventsForEvent: () => undefined },
    }),
  });

const makeRoom = (): Room => {
  const threads = new Map([
    [THREAD_HERE, makeThread([makeStreamingReply(THREAD_HERE, AGENT_HERE)])],
    [THREAD_ELSEWHERE, makeThread([makeStreamingReply(THREAD_ELSEWHERE, AGENT_ELSEWHERE)])],
  ]);
  return {
    roomId: ROOM_ID,
    getMember: (userId: string) => ({ rawDisplayName: DISPLAY_NAMES[userId] ?? userId }),
    getThread: (threadId: string) => threads.get(threadId) ?? null,
  } as unknown as Room;
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

let renderer: ReactTestRenderer | undefined;

const renderTyping = (typingUserIds: string[], threadId?: string) => {
  const store = createStore();
  typingUserIds.forEach((userId, index) =>
    store.set(roomIdToTypingMembersAtom, {
      type: 'PUT',
      roomId: ROOM_ID,
      userId,
      ts: index + 1,
      isTyping: () => true,
    })
  );
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RoomViewTyping room={makeRoom()} threadId={threadId} />
      </Provider>
    );
  });
  const root = renderer as ReactTestRenderer;
  return {
    text: () => (root.toJSON() ? textOf(root.root) : ''),
    typingUserIds: () =>
      (store.get(roomIdToTypingMembersAtom).get(ROOM_ID) ?? []).map(({ userId }) => userId),
    dropTyping: () => act(() => root.root.findByType('button').props.onClick()),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
  vi.useRealTimers();
});

describe('RoomViewTyping', () => {
  it('lists everyone typing in the room on the main timeline', () => {
    const view = renderTyping([HUMAN, AGENT_ELSEWHERE, ME]);

    expect(view.text()).toBe('Writer and Alice are typing...');
  });

  it('hides people typing in a thread view, where typing names no thread', () => {
    const view = renderTyping([HUMAN], THREAD_HERE);

    expect(view.text()).toBe('');
  });

  it('shows an agent streaming in the open thread, and drops only what it shows', () => {
    const view = renderTyping([HUMAN, AGENT_HERE, AGENT_ELSEWHERE], THREAD_HERE);

    expect(view.text()).toBe('Helper is typing...');

    view.dropTyping();

    expect(view.typingUserIds()).toEqual([HUMAN, AGENT_ELSEWHERE]);
    expect(view.text()).toBe('');
  });

  it('hides an agent streaming in another thread', () => {
    const view = renderTyping([AGENT_ELSEWHERE], THREAD_HERE);

    expect(view.text()).toBe('');
  });
});
