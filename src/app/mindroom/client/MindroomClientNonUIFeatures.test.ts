import 'fake-indexeddb/auto';
import { EventEmitter } from 'events';
import React from 'react';
import { Provider, createStore } from 'jotai';
import type { Store } from 'jotai/vanilla';
import { IDBFactory } from 'fake-indexeddb';
import { ClientEvent, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InviteSound from '../../../../public/sound/invite.ogg';
import { ClientConfigProvider, type ClientConfig } from '../../hooks/useClientConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { createSessionId } from '../../state/sessions';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { Membership } from '../../../types/matrix/room';
import { isComputerShown, listCanvases } from '../canvas/canvasIndexStore';
import { playChime } from '../notifications/playChime';
import { CanvasIndexFeature, MindroomInviteNotifications } from './MindroomClientNonUIFeatures';

vi.mock('../notifications/playChime', () => ({ playChime: vi.fn(() => Promise.resolve()) }));

type MockRoom = {
  roomId: string;
  getMyMembership: () => Membership;
};

const createInviteRoom = (roomId: string): MockRoom => ({
  roomId,
  getMyMembership: () => Membership.Invite,
});

const createMatrixClient = (inviteRoomIds: string[]): MatrixClient =>
  ({
    getRooms: vi.fn(() => inviteRoomIds.map(createInviteRoom)),
    getSyncState: vi.fn(() => 'SYNCING'),
  } as unknown as MatrixClient);

const setInvites = (store: Store, roomIds: string[]) => {
  store.set(allInvitesAtom, { type: 'INITIALIZE', rooms: roomIds });
};

const addInvite = (store: Store, roomId: string) => {
  store.set(allInvitesAtom, { type: 'PUT', roomId });
};

const removeInvite = (store: Store, roomId: string) => {
  store.set(allInvitesAtom, { type: 'DELETE', roomId });
};

const renderInviteNotifications = (store: Store, mx: MatrixClient): ReactTestRenderer =>
  create(
    React.createElement(
      Provider,
      { store },
      React.createElement(
        MatrixClientProvider,
        { value: mx },
        React.createElement(
          MemoryRouter,
          {
            future: {
              v7_relativeSplatPath: true,
              v7_startTransition: true,
            },
          },
          React.createElement(MindroomInviteNotifications)
        )
      )
    )
  );

describe('MindroomInviteNotifications', () => {
  let renderer: ReactTestRenderer | undefined;
  const play = vi.mocked(playChime);
  let notificationMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notificationMock = vi.fn(() => ({ close: vi.fn() }));
    Object.defineProperty(notificationMock, 'permission', {
      configurable: true,
      value: 'granted',
    });
    vi.stubGlobal('window', {
      Notification: notificationMock,
      closed: false,
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not chime when stale atom invites are replaced by the current client hydration', async () => {
    const store = createStore();
    setInvites(store, ['!stale:old']);
    const mx = createMatrixClient(['!cached-a:new', '!cached-b:new']);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx);
    });
    expect(renderer?.toJSON()).toBeNull();

    await act(async () => {
      setInvites(store, ['!cached-a:new', '!cached-b:new']);
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('chimes when an empty cold-open receives a new live invite', async () => {
    const store = createStore();
    const mx = createMatrixClient([]);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx);
    });

    await act(async () => {
      addInvite(store, '!new-live:server');
    });

    expect(play).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledWith(InviteSound);
    expect(notificationMock).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledWith(
      'Invitation',
      expect.objectContaining({
        body: 'You have 1 new invitation request.',
        silent: true,
      })
    );
  });

  it('does not chime for startup hydration of a pre-existing invite', async () => {
    const roomId = '!cached-invite:server';
    const store = createStore();
    const mx = createMatrixClient([roomId]);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx);
    });

    await act(async () => {
      setInvites(store, [roomId]);
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('chimes when the same room re-invites after disappearing from current invites', async () => {
    const roomId = '!repeat-invite:server';
    const store = createStore();
    const mx = createMatrixClient([roomId]);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx);
    });
    await act(async () => {
      addInvite(store, roomId);
    });
    await act(async () => {
      removeInvite(store, roomId);
    });
    await act(async () => {
      addInvite(store, roomId);
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
  });

  it('baselines the new Matrix client on account switch before invite hydration arrives', async () => {
    const store = createStore();
    setInvites(store, ['!alice-stale:old']);
    const aliceMx = createMatrixClient(['!alice-stale:old']);
    const bobMx = createMatrixClient(['!bob-cached:new']);

    await act(async () => {
      renderer = renderInviteNotifications(store, aliceMx);
    });
    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: bobMx },
            React.createElement(
              MemoryRouter,
              {
                future: {
                  v7_relativeSplatPath: true,
                  v7_startTransition: true,
                },
              },
              React.createElement(MindroomInviteNotifications)
            )
          )
        )
      );
    });
    await act(async () => {
      setInvites(store, ['!bob-cached:new']);
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('does not let stale account-switch atom IDs poison the new client baseline', async () => {
    const sharedRoomId = '!shared:server';
    const store = createStore();
    setInvites(store, [sharedRoomId]);
    const aliceMx = createMatrixClient([sharedRoomId]);
    const bobMx = createMatrixClient([]);

    await act(async () => {
      renderer = renderInviteNotifications(store, aliceMx);
    });
    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: bobMx },
            React.createElement(
              MemoryRouter,
              {
                future: {
                  v7_relativeSplatPath: true,
                  v7_startTransition: true,
                },
              },
              React.createElement(MindroomInviteNotifications)
            )
          )
        )
      );
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();

    await act(async () => {
      addInvite(store, sharedRoomId);
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
  });

  it('does not count unrelated stale account-switch atom IDs with a different live invite', async () => {
    const store = createStore();
    setInvites(store, ['!stale-a:old', '!stale-b:old']);
    const aliceMx = createMatrixClient(['!stale-a:old', '!stale-b:old']);
    const bobMx = createMatrixClient([]);

    await act(async () => {
      renderer = renderInviteNotifications(store, aliceMx);
    });
    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: bobMx },
            React.createElement(
              MemoryRouter,
              {
                future: {
                  v7_relativeSplatPath: true,
                  v7_startTransition: true,
                },
              },
              React.createElement(MindroomInviteNotifications)
            )
          )
        )
      );
    });
    await act(async () => {
      addInvite(store, '!new-live:server');
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledWith(
      'Invitation',
      expect.objectContaining({
        body: 'You have 1 new invitation request.',
      })
    );
  });
});

describe('CanvasIndexFeature', () => {
  const ROOM_ID = '!room:example.org';
  const AGENT = '@mindroom_planner:example.org';
  const VIEWER = '@alice:example.org';
  const HOMESERVER = 'https://example.org';
  const SESSION = createSessionId(HOMESERVER, VIEWER);

  const showComputerNotice = () =>
    new MatrixEvent({
      event_id: '$computer',
      room_id: ROOM_ID,
      sender: AGENT,
      type: 'm.room.message',
      origin_server_ts: 1,
      content: {
        msgtype: 'm.notice',
        body: 'Opening the computer.',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
        'io.mindroom.ui_action': {
          version: 1,
          action: 'show_computer',
          requester_id: VIEWER,
          agent_user_id: AGENT,
          room_id: ROOM_ID,
          thread_id: '$thread',
        },
      },
    });

  // The planner agent publishes its MindRoom server, as a MindRoom that sets no Computers URL does.
  const serverState = new MatrixEvent({
    type: 'io.mindroom.server',
    state_key: AGENT,
    sender: AGENT,
    room_id: ROOM_ID,
    event_id: '$server',
    origin_server_ts: 1,
    content: { api_origin: 'http://localhost:8765', computer: true },
  });

  const createClient = () => {
    const room = {
      roomId: ROOM_ID,
      myUserId: VIEWER,
      getMyMembership: () => 'join',
      currentState: {
        getStateEvents: (type: string) => (type === 'io.mindroom.server' ? [serverState] : []),
      },
      getMember: (userId: string) => ({ userId, membership: 'join' }),
      getLiveTimeline: () => ({ getEvents: () => [] }),
      getThreads: () => [],
      findEventById: () => undefined,
    } as unknown as Room;
    return Object.assign(new EventEmitter(), {
      getSafeUserId: () => VIEWER,
      getUserId: () => VIEWER,
      getHomeserverUrl: () => HOMESERVER,
      getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
      getRooms: () => [room],
    }) as unknown as MatrixClient & EventEmitter;
  };

  const settle = async () => {
    // IndexedDB work finishes over several tasks.
    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };

  // Canvases are off in every case; only the computer service differs.
  const recordNoticeWith = async (mindroom: ClientConfig['mindroom'], bindsTokens = false) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              versions: ['v1.11'],
              unstable_features: { 'io.mindroom.openid_audience': bindsTokens },
            }),
            { status: 200 }
          )
      )
    );
    const mx = createClient();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(
            ClientConfigProvider,
            { value: { mindroom } },
            React.createElement(
              MatrixClientProvider,
              { value: mx },
              React.createElement(CanvasIndexFeature)
            )
          )
        )
      );
    });
    // The homeserver's binding answer arrives after the first render.
    await act(async () => {
      await settle();
    });
    mx.emit(ClientEvent.Event, showComputerNotice());
    await settle();
    await act(async () => {
      renderer?.unmount();
    });
    vi.unstubAllGlobals();
    return isComputerShown(SESSION, ROOM_ID, '$thread');
  };

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('records where an agent showed its computer when only a computer service is configured', async () => {
    expect(await recordNoticeWith({ computers: { apiUrl: 'https://computers.example.org' } })).toBe(
      true
    );
    expect(await listCanvases(SESSION)).toEqual([]);
  });

  it('records nothing with canvases and computers both off', async () => {
    expect(await recordNoticeWith({ canvas: { enabled: false } })).toBe(false);
  });

  it('records for a server the room agents publish while the homeserver binds tokens', async () => {
    expect(await recordNoticeWith({ canvas: { enabled: false } }, true)).toBe(true);
  });
});
