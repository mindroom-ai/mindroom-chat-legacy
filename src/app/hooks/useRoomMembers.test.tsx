import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClient, MatrixEvent, Room, RoomMember, RoomMemberEvent } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { useRoomMembers } from './useRoomMembers';

vi.mock('matrix-js-sdk/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const createMember = (userId: string): RoomMember =>
  ({
    userId,
    membership: 'join',
  } as RoomMember);

const createMembershipEvent = (roomId: string): MatrixEvent =>
  ({
    getRoomId: () => roomId,
  } as MatrixEvent);

type UseRoomMembersProbeProps = {
  mx: MatrixClient;
  roomId: string;
};
function UseRoomMembersProbe({ mx, roomId }: UseRoomMembersProbeProps) {
  const members = useRoomMembers(mx, roomId);
  return <output>{members.map((member) => member.userId).join(',')}</output>;
}

const mountedRenderers = new Set<ReactTestRenderer>();

const createRoomMembersRenderer = (mx: MatrixClient, roomId: string): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<UseRoomMembersProbe mx={mx} roomId={roomId} />);
  });
  expect(renderer).toBeDefined();
  mountedRenderers.add(renderer as ReactTestRenderer);
  return renderer as ReactTestRenderer;
};

const readOutputText = (renderer: ReactTestRenderer): string =>
  renderer.root.findByType('output').children.join('');

const unmountRenderer = (renderer: ReactTestRenderer): void => {
  act(() => {
    renderer.unmount();
  });
  mountedRenderers.delete(renderer);
};

afterEach(() => {
  for (const renderer of Array.from(mountedRenderers)) {
    unmountRenderer(renderer);
  }
  vi.clearAllMocks();
});

function UseRoomMemberNamesProbe({ mx, roomId }: UseRoomMembersProbeProps) {
  const members = useRoomMembers(mx, roomId);
  return <output>{members.map((member) => member.name).join(',')}</output>;
}

describe('useRoomMembers', () => {
  it("shows a member's new display name when it changes", () => {
    const roomId = '!room:example.org';
    const agent = { ...createMember('@agent:example.org'), name: 'Helper' } as RoomMember;
    const room = {
      roomId,
      // Like the SDK, a new array on every call.
      getMembers: vi.fn(() => [agent]),
      loadMembersIfNeeded: vi.fn(() => deferred<void>().promise),
    } as unknown as Room;
    const mx = Object.assign(new EventEmitter(), {
      getRoom: vi.fn(() => room),
    }) as unknown as MatrixClient;
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<UseRoomMemberNamesProbe mx={mx} roomId={roomId} />);
    });
    mountedRenderers.add(renderer as ReactTestRenderer);
    expect(readOutputText(renderer as ReactTestRenderer)).toBe('Helper');

    // The SDK updates the member in place, then emits Name (and not Membership).
    agent.name = 'Research Helper';
    act(() => {
      (mx as unknown as EventEmitter).emit(
        RoomMemberEvent.Name,
        createMembershipEvent(roomId),
        agent,
        'Helper'
      );
    });

    expect(readOutputText(renderer as ReactTestRenderer)).toBe('Research Helper');
  });

  it('publishes live membership updates while full member load is still pending', async () => {
    const roomId = '!room:example.org';
    const alice = createMember('@alice:example.org');
    const bob = createMember('@bob:example.org');
    const carol = createMember('@carol:example.org');
    let members = [alice];
    const memberLoad = deferred<void>();
    const room = {
      roomId,
      getMembers: vi.fn(() => members),
      loadMembersIfNeeded: vi.fn(() => memberLoad.promise),
    } as unknown as Room;
    const mx = Object.assign(new EventEmitter(), {
      getRoom: vi.fn(() => room),
    }) as unknown as MatrixClient;

    const renderer = createRoomMembersRenderer(mx, roomId);

    expect(readOutputText(renderer)).toBe('@alice:example.org');

    members = [alice, bob];
    act(() => {
      (mx as unknown as EventEmitter).emit(
        RoomMemberEvent.Membership,
        createMembershipEvent(roomId),
        bob,
        'invite'
      );
    });

    expect(readOutputText(renderer)).toBe('@alice:example.org,@bob:example.org');

    members = [alice, bob, carol];
    await act(async () => {
      memberLoad.resolve();
      await memberLoad.promise;
    });

    expect(readOutputText(renderer)).toBe('@alice:example.org,@bob:example.org,@carol:example.org');

    unmountRenderer(renderer);
  });

  it('handles member load rejection without an unhandled promise', async () => {
    const roomId = '!room:example.org';
    const alice = createMember('@alice:example.org');
    const loadError = new Error('member load failed');
    const room = {
      roomId,
      getMembers: vi.fn(() => [alice]),
      loadMembersIfNeeded: vi.fn(() => Promise.reject(loadError)),
    } as unknown as Room;
    const mx = Object.assign(new EventEmitter(), {
      getRoom: vi.fn(() => room),
    }) as unknown as MatrixClient;

    const renderer = createRoomMembersRenderer(mx, roomId);

    expect(readOutputText(renderer)).toBe('@alice:example.org');

    await act(async () => {
      await Promise.resolve();
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[useRoomMembers] Failed to load room members',
      loadError
    );

    unmountRenderer(renderer);
  });
});
