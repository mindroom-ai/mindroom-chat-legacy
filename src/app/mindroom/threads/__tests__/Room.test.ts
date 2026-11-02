import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { isKeyHotkey } from 'is-hotkey';
import type { ClientConfig } from '../../../hooks/useClientConfig';
import type { CanvasListEntry } from '../../canvas/canvasIndexStore';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { markRoomAndThreadsAsRead, markThreadAsRead } from '../../notifications/readReceipts';

type MockRoomViewProps = {
  computerAvailable?: boolean;
  computerOpen?: boolean;
  computerShown?: boolean;
  canvasOpen?: boolean;
  canvases?: CanvasListEntry[];
  openCanvasId?: string;
  onCanvasOpen?: (canvasId: string) => void;
  onCanvasClose?: () => void;
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
  onComputerToggle?: () => void;
};

type MockComputerPanelProps = {
  requestedAgent?: { userId: string };
  onInteractionChange?: (interaction: { agentUserId?: string; locked: boolean }) => void;
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  agents: Array<{ userId: string; name: string; serverUrl?: string }>;
  continuationReady?: boolean;
  apiUrl: string;
  roomId: string;
  threadId?: string;
};

type MockCallChatViewProps = MockRoomViewProps & {
  room: { roomId: string; isCallRoom: () => boolean };
};

const { mx, navigateRoomMock, navigateRoomThreadMock, removeRecentThreadMock, room, roomState } =
  vi.hoisted(() => ({
    navigateRoomMock: vi.fn(),
    navigateRoomThreadMock: vi.fn(),
    removeRecentThreadMock: vi.fn(),
    mx: {
      getSafeUserId: () => '@alice:example.org',
      getHomeserverUrl: () => 'https://example.org',
      relations: vi.fn(),
      isInitialSyncComplete: () => true,
      getSyncState: () => 'SYNCING',
      on: (name: string, handler: (...args: unknown[]) => void) =>
        roomState.mxListeners.set(name, handler),
      removeListener: (name: string) => roomState.mxListeners.delete(name),
    },
    room: {
      roomId: '!room:example.org',
      isCallRoom: () => roomState.callRoom,
      getMembers: () => roomState.members,
      getMember: (userId: string) => roomState.members.find((member) => member.userId === userId),
      getThread: () => undefined,
      findEventById: (eventId: string) =>
        roomState.loadedEvents.get(eventId) ??
        (eventId === roomState.routedEvent?.getId() ? roomState.routedEvent : undefined),
      on: (name: string, handler: (...args: unknown[]) => void) =>
        roomState.listeners.set(name, handler),
      removeListener: (name: string) => roomState.listeners.delete(name),
    },
    roomState: {
      viewMode: 'threaded',
      simpleMode: false,
      setViewMode: vi.fn((mode: string) => {
        roomState.viewMode = mode;
      }),
      activateUiAction: undefined as undefined | ((event: MatrixEvent) => void),
      uiProbe: undefined as React.ComponentType | undefined,
      mxListeners: new Map<string, (...args: unknown[]) => void>(),
      listeners: new Map<string, (...args: unknown[]) => void>(),
      drawer: false,
      screenSize: 'Desktop',
      panelDisposals: 0,
      computerPanelThreads: [] as Array<string | undefined>,
      routedEvent: undefined as
        | undefined
        | { getId: () => string; threadRootId?: string; isSending: () => boolean },
      callChat: false,
      callChatViewProps: undefined as MockCallChatViewProps | undefined,
      callRoom: false,
      clientConfig: { mindroom: {} } as ClientConfig,
      computerPanelProps: undefined as MockComputerPanelProps | undefined,
      canvasPanelProps: undefined as
        | undefined
        | {
            event: MatrixEvent;
            onClose: () => void;
            expanded: boolean;
            onToggleExpanded: () => void;
          },
      callEmbed: undefined as unknown,
      eventId: undefined as string | undefined,
      members: [] as Array<{ membership: string; userId: string }>,
      search: '',
      loadedEvents: new Map<string, MatrixEvent>(),
      conversationCanvases: [] as CanvasListEntry[],
      conversationCanvasesFor: [] as unknown[][],
      computerShown: false,
      computerShownFor: [] as unknown[][],
      mindroomServers: [] as Array<{
        agentUserId: string;
        apiUrl: string;
        computer: boolean;
        ts: number;
      }>,
      bindsOpenIdTokens: false,
      roomViewProps: undefined as MockRoomViewProps | undefined,
      setPeopleDrawer: vi.fn(),
    },
  }));

vi.mock('folds', () => ({
  Box: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
    React.createElement('div', { style }, children),
  Line: () => React.createElement('div'),
  Overlay: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  OverlayBackdrop: () => React.createElement('div'),
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('../../sidebar/ResizablePanel.css', () => ({ Panel: 'panel', Handle: 'handle' }));
vi.mock('../../sidebar/ResizableMembersPanel.css', () => ({ MobileOverlay: 'mobile-overlay' }));

vi.mock('is-hotkey', () => ({
  isKeyHotkey: vi.fn(() => false),
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');

  return {
    ...actual,
    useAtomValue: (atom: { mock?: string }) => {
      if (atom?.mock === 'callEmbed') return roomState.callEmbed;
      if (atom?.mock === 'callChat') return roomState.callChat;
      return actual.useAtomValue(atom as Parameters<typeof actual.useAtomValue>[0]);
    },
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({ eventId: roomState.eventId }),
  useSearchParams: () => [new URLSearchParams(roomState.search)],
}));

vi.mock('../../../features/room/RoomView', () => ({
  RoomView: (props: MockRoomViewProps) => {
    roomState.roomViewProps = props;
    return React.createElement('mock-room-view');
  },
}));

vi.mock('../MindroomRoomView', () => ({
  RoomView: (props: MockRoomViewProps) => {
    roomState.roomViewProps = props;
    return React.createElement(
      'mock-room-view',
      null,
      roomState.uiProbe && React.createElement(roomState.uiProbe)
    );
  },
}));

vi.mock('../../../features/room/MembersDrawer', () => ({
  MembersDrawer: () => React.createElement('aside', { 'aria-label': 'Members' }),
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => roomState.screenSize,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'hideActivity':
        return [false];
      default:
        return [false];
    }
  },
}));

vi.mock('../../sidebar/useMembersDrawer', () => ({
  useMembersDrawer: () => [roomState.drawer, roomState.setPeopleDrawer],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  usePowerLevels: () => ({}),
}));

vi.mock('../../../hooks/useRoom', () => ({
  useRoom: () => room,
}));

vi.mock('../../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('../../notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));

vi.mock('../../canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../canvas/canvasIndex')>()),
  useConversationCanvases: (...conversation: unknown[]) => {
    roomState.conversationCanvasesFor.push(conversation);
    return roomState.conversationCanvases;
  },
  useComputerShown: (...conversation: unknown[]) => {
    roomState.computerShownFor.push(conversation);
    return roomState.computerShown;
  },
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: () => roomState.clientConfig,
}));

vi.mock('../../server/useMindroomServers', () => ({
  useRoomMindroomServers: () => roomState.mindroomServers,
  useBindsOpenIdTokens: () => roomState.bindsOpenIdTokens,
  useMindroomServerUrls: () => [],
}));

vi.mock('../../computer/ComputerPanel', () => ({
  ComputerPanel: (props: MockComputerPanelProps) => {
    const { threadId } = props;
    React.useEffect(() => {
      roomState.computerPanelThreads.push(threadId);
    }, [threadId]);
    React.useEffect(
      () => () => {
        roomState.panelDisposals += 1;
      },
      []
    );
    roomState.computerPanelProps = props;
    return React.createElement('mock-computer-panel');
  },
}));

vi.mock('../../canvas/RoomCanvasPanel', () => ({
  RoomCanvasPanel: (props: {
    event: MatrixEvent;
    onClose: () => void;
    expanded: boolean;
    onToggleExpanded: () => void;
  }) => {
    roomState.canvasPanelProps = props;
    return React.createElement('mock-canvas-panel');
  },
}));

vi.mock('../useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: roomState.viewMode, setViewMode: roomState.setViewMode }),
}));

vi.mock('../../settings/useMindroomAccountSettings', () => ({
  useSimpleMode: () => roomState.simpleMode,
}));

vi.mock('../../../hooks/useRoomMembers', () => ({
  useRoomMembers: () => roomState.members,
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
    navigateRoomThread: navigateRoomThreadMock,
  }),
}));

vi.mock('../../recent-threads/recentThreads', () => ({
  removeRecentThread: removeRecentThreadMock,
}));

vi.mock('../../../features/call/CallView', () => ({
  CallView: () => React.createElement('div'),
}));

vi.mock('../../../features/room/RoomViewHeader', () => ({
  RoomViewHeader: () => React.createElement('mock-room-view-header'),
}));

vi.mock('../MindroomRoomViewHeader', () => ({
  RoomViewHeader: () => React.createElement('mock-room-view-header'),
}));

vi.mock('../MindroomCallChatView', () => ({
  MindroomCallChatView: (props: MockCallChatViewProps) => {
    roomState.callChatViewProps = props;
    return React.createElement('mock-call-chat-view');
  },
}));

vi.mock('../../../state/callEmbed', () => ({
  callChatAtom: { mock: 'callChat' },
  callEmbedAtom: { mock: 'callEmbed' },
}));

vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });

const computerWrapper = (renderer: ReturnType<typeof create>) =>
  renderer.root.findByProps({ 'data-testid': 'resizable-computer-panel' });

describe('Room', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    roomState.viewMode = 'threaded';
    roomState.simpleMode = false;
    roomState.setViewMode.mockClear();
    roomState.activateUiAction = undefined;
    roomState.uiProbe = undefined;
    roomState.mxListeners.clear();
    roomState.listeners.clear();
    roomState.drawer = false;
    roomState.screenSize = 'Desktop';
    roomState.panelDisposals = 0;
    roomState.computerPanelThreads = [];
    roomState.routedEvent = undefined;
    roomState.callChat = false;
    roomState.callChatViewProps = undefined;
    roomState.callRoom = false;
    roomState.clientConfig = { mindroom: {} };
    roomState.computerPanelProps = undefined;
    roomState.canvasPanelProps = undefined;
    roomState.callEmbed = undefined;
    roomState.eventId = undefined;
    roomState.members = [];
    roomState.search = '';
    roomState.loadedEvents.clear();
    roomState.conversationCanvases = [];
    roomState.conversationCanvasesFor = [];
    roomState.computerShown = false;
    roomState.computerShownFor = [];
    roomState.mindroomServers = [];
    roomState.bindsOpenIdTokens = false;
    mx.relations.mockReset();
    roomState.roomViewProps = undefined;
    roomState.setPeopleDrawer.mockReset();
    navigateRoomMock.mockReset();
    navigateRoomThreadMock.mockReset();
    removeRecentThreadMock.mockReset();
  });

  it('stays on the room timeline on bare room entry', async () => {
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it.each(['Desktop', 'Tablet', 'Mobile'])(
    'shows the requested member sidebar on %s',
    async (size) => {
      roomState.screenSize = size;
      roomState.drawer = true;
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      expect(renderer!.root.findAllByType('aside')).toHaveLength(1);
      await act(async () => renderer!.unmount());
    }
  );

  it('passes live agent membership to the room toolbar surface', async () => {
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    expect(roomState.roomViewProps?.hasMindroomAgents).toBe(false);

    roomState.members = [
      { membership: 'invite', userId: '@mindroom_helper:example.org' },
      { membership: 'join', userId: '@alice:example.org' },
    ];
    await act(async () => {
      renderer!.update(React.createElement(Room));
    });
    expect(roomState.roomViewProps?.hasMindroomAgents).toBe(true);
  });

  describe('the Computer action', () => {
    const helper = '@mindroom_helper:example.org';
    const server = (computer: boolean) => ({
      agentUserId: helper,
      apiUrl: 'http://localhost:8765',
      computer,
      ts: 1,
    });
    const computerAvailable = async () => {
      roomState.members = [
        { membership: 'join', userId: helper },
        { membership: 'join', userId: '@alice:example.org' },
      ];
      const { Room } = await import('../../../features/room/Room');
      await act(async () => {
        create(React.createElement(Room));
      });
      return roomState.roomViewProps?.computerAvailable;
    };
    const configured = { mindroom: { computers: { apiUrl: 'https://computer.example.org' } } };

    it('uses the server the room agent published while the homeserver binds tokens', async () => {
      roomState.mindroomServers = [server(true)];
      roomState.bindsOpenIdTokens = true;
      expect(await computerAvailable()).toBe(true);
    });

    it('uses the published server when the deployment URL is unusable', async () => {
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'http://public.example.org/path' } },
      };
      roomState.mindroomServers = [server(true)];
      roomState.bindsOpenIdTokens = true;
      expect(await computerAvailable()).toBe(true);
    });

    it('ignores a published server on a homeserver that does not bind tokens', async () => {
      roomState.mindroomServers = [server(true)];
      expect(await computerAvailable()).toBe(false);
    });

    it('hides the action for an agent whose MindRoom says it has no computer', async () => {
      roomState.clientConfig = configured;
      roomState.mindroomServers = [server(false)];
      expect(await computerAvailable()).toBe(false);
    });

    it('gives each found agent its own server, and configured servers to none', async () => {
      const other = '@mindroom_other:example.org';
      roomState.bindsOpenIdTokens = true;
      roomState.mindroomServers = [
        server(true),
        { agentUserId: other, apiUrl: 'https://other.example.org', computer: true, ts: 2 },
      ];
      roomState.members = [
        { membership: 'join', userId: helper },
        { membership: 'join', userId: other },
        { membership: 'join', userId: '@alice:example.org' },
      ];
      const { Room } = await import('../../../features/room/Room');
      await act(async () => {
        create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(roomState.computerPanelProps?.agents.map((agent) => agent.serverUrl)).toEqual([
        'http://localhost:8765',
        'https://other.example.org',
      ]);
    });

    it('lets a configured server win over every published one', async () => {
      roomState.clientConfig = configured;
      roomState.bindsOpenIdTokens = true;
      roomState.mindroomServers = [server(true)];
      roomState.members = [
        { membership: 'join', userId: helper },
        { membership: 'join', userId: '@alice:example.org' },
      ];
      const { Room } = await import('../../../features/room/Room');
      await act(async () => {
        create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(roomState.computerPanelProps?.apiUrl).toBe('https://computer.example.org');
      expect(roomState.computerPanelProps?.agents.map((agent) => agent.serverUrl)).toEqual([
        undefined,
      ]);
    });

    it('offers no computer for an agent that publishes no server while Chat discovers servers', async () => {
      const silent = '@mindroom_silent:example.org';
      roomState.bindsOpenIdTokens = true;
      roomState.mindroomServers = [server(true)];
      roomState.members = [
        { membership: 'join', userId: helper },
        { membership: 'join', userId: silent },
        { membership: 'join', userId: '@alice:example.org' },
      ];
      const { Room } = await import('../../../features/room/Room');
      await act(async () => {
        create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      // The silent agent would otherwise open on the helper's server, with no binding check for it.
      expect(roomState.computerPanelProps?.agents.map((agent) => agent.userId)).toEqual([helper]);
    });

    it('keeps the action for an agent whose MindRoom does not publish its server yet', async () => {
      roomState.clientConfig = configured;
      expect(await computerAvailable()).toBe(true);
    });
  });

  it('passes the live pending join request count to the room header surface', async () => {
    roomState.members = [
      { membership: 'knock', userId: '@alice:example.org' },
      { membership: 'join', userId: '@bob:example.org' },
      { membership: 'knock', userId: '@carol:example.org' },
    ];
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(roomState.roomViewProps?.joinRequestCount).toBe(2);
  });

  it('applies live UI requests through the existing room controls and preserves human control', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
    roomState.clientConfig = {
      mindroom: {
        computers: { apiUrl: 'https://computer.example.org' },
        uiActions: { autoOpenFromHomeservers: ['example.org'] },
      },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org' },
      { membership: 'join', userId: '@alice:example.org' },
    ];
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    const { Room } = await import('../../../features/room/Room');
    const { getDefaultStore } = await import('jotai');
    const { settingsModalAtom } = await import('../../../state/settingsModal');
    const { SettingsPages } = await import('../../../features/settings/settingsPages');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    let serial = 0;
    const emitAction = (action: string, extra: Record<string, unknown> = {}) => {
      const event = new MatrixEvent({
        event_id: `$ui-${serial++}`,
        room_id: room.roomId,
        sender: '@mindroom_helper:example.org',
        type: 'm.room.message',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.notice',
          body: 'Open this view.',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
          'io.mindroom.ui_action': {
            version: 1,
            action,
            requester_id: '@alice:example.org',
            agent_user_id: '@mindroom_helper:example.org',
            room_id: room.roomId,
            thread_id: '$thread',
            ...extra,
          },
        },
      });
      roomState.mxListeners.get('Room.timeline')?.(event, room, false, false, { liveEvent: true });
      return event;
    };
    await act(async () => {
      emitAction('show_computer');
    });
    expect(roomState.roomViewProps?.computerOpen).toBe(true);
    expect(roomState.computerPanelProps?.requestedAgent?.userId).toBe(
      '@mindroom_helper:example.org'
    );
    await act(async () =>
      roomState.computerPanelProps?.onInteractionChange?.({
        agentUserId: '@mindroom_helper:example.org',
        locked: true,
      })
    );
    await act(async () => {
      emitAction('open_panel', { panel: 'members' });
    });
    expect(roomState.roomViewProps?.computerOpen).toBe(true);
    await act(async () => roomState.computerPanelProps?.onInteractionChange?.({ locked: false }));
    await act(async () => {
      emitAction('open_panel', { panel: 'members' });
    });
    expect(roomState.roomViewProps?.computerOpen).toBe(false);
    expect(roomState.setPeopleDrawer).toHaveBeenCalledWith(true);
    await act(async () => {
      emitAction('open_settings', { section: 'account' });
    });
    expect(getDefaultStore().get(settingsModalAtom)).toEqual({
      initialPage: SettingsPages.AccountPage,
      requestId: '$ui-3',
    });
    await act(async () => renderer!.unmount());
    vi.stubGlobal('document', undefined);
  });

  it('opens a live canvas request beside the conversation and yields to Members and Computer', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
    roomState.clientConfig = {
      mindroom: {
        computers: { apiUrl: 'https://computer.example.org' },
        uiActions: { autoOpenFromHomeservers: ['example.org'] },
        canvas: { enabled: true },
      },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org' },
      { membership: 'join', userId: '@alice:example.org' },
    ];
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    let serial = 0;
    const emitAction = (action: string, extra: Record<string, unknown> = {}) => {
      const event = new MatrixEvent({
        event_id: `$canvas-${serial++}`,
        room_id: room.roomId,
        sender: '@mindroom_helper:example.org',
        type: 'm.room.message',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.notice',
          body: 'Open this view.',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
          'io.mindroom.ui_action': {
            version: 1,
            action,
            requester_id: '@alice:example.org',
            agent_user_id: '@mindroom_helper:example.org',
            room_id: room.roomId,
            thread_id: '$thread',
            ...extra,
          },
        },
      });
      roomState.mxListeners.get('Room.timeline')?.(event, room, false, false, { liveEvent: true });
      return event;
    };
    const canvasOpen = () => JSON.stringify(renderer!.toJSON()).includes('mock-canvas-panel');
    const canvas = { title: 'Choose', html: '<button>A</button>' };

    let request: MatrixEvent | undefined;
    await act(async () => {
      request = emitAction('show_canvas', { canvas });
    });
    expect(canvasOpen()).toBe(true);
    expect(roomState.canvasPanelProps?.event).toBe(request);
    expect(roomState.setPeopleDrawer).toHaveBeenCalledWith(false);
    // Expanding gives the canvas the conversation's column; the conversation unmounts so it
    // cannot mark messages read while out of view.
    const conversationShown = () => JSON.stringify(renderer!.toJSON()).includes('mock-room-view');
    expect(roomState.canvasPanelProps?.expanded).toBe(false);
    expect(conversationShown()).toBe(true);
    await act(async () => roomState.canvasPanelProps?.onToggleExpanded());
    expect(roomState.canvasPanelProps?.expanded).toBe(true);
    expect(conversationShown()).toBe(false);
    await act(async () => roomState.canvasPanelProps?.onToggleExpanded());
    expect(conversationShown()).toBe(true);
    // Closing an expanded canvas brings the conversation back and resets Expand.
    await act(async () => roomState.canvasPanelProps?.onToggleExpanded());
    await act(async () => roomState.canvasPanelProps?.onClose());
    expect(conversationShown()).toBe(true);
    await act(async () => {
      emitAction('show_canvas', { canvas });
    });
    expect(roomState.canvasPanelProps?.expanded).toBe(false);
    // Tablets follow the same rule as desktops.
    roomState.screenSize = 'Tablet';
    await act(async () => renderer!.update(React.createElement(Room)));
    await act(async () => roomState.canvasPanelProps?.onToggleExpanded());
    expect(conversationShown()).toBe(false);
    await act(async () => roomState.canvasPanelProps?.onToggleExpanded());
    roomState.screenSize = 'Desktop';
    await act(async () => renderer!.update(React.createElement(Room)));

    await act(async () => {
      emitAction('open_panel', { panel: 'members' });
    });
    expect(canvasOpen()).toBe(false);

    await act(async () => {
      emitAction('show_canvas', { canvas });
    });
    expect(canvasOpen()).toBe(true);
    await act(async () => {
      emitAction('show_computer');
    });
    expect(canvasOpen()).toBe(false);
    expect(roomState.roomViewProps?.computerOpen).toBe(true);

    await act(async () => {
      emitAction('show_canvas', { canvas });
    });
    expect(canvasOpen()).toBe(true);
    expect(roomState.roomViewProps?.computerOpen).toBe(false);
    await act(async () => roomState.canvasPanelProps?.onClose());
    expect(canvasOpen()).toBe(false);

    // A call's frames listen to window messages, so a call closes canvases and blocks new ones.
    await act(async () => {
      emitAction('show_canvas', { canvas });
    });
    expect(canvasOpen()).toBe(true);
    roomState.callEmbed = { mock: 'active call' };
    await act(async () => renderer!.update(React.createElement(Room)));
    expect(canvasOpen()).toBe(false);
    await act(async () => {
      emitAction('show_canvas', { canvas });
    });
    expect(canvasOpen()).toBe(false);
    roomState.callEmbed = undefined;
    await act(async () => renderer!.update(React.createElement(Room)));
    expect(canvasOpen()).toBe(false);
    await act(async () => renderer!.unmount());
    vi.stubGlobal('document', undefined);
  });

  const renderCanvasRoom = async (mindroom: ClientConfig['mindroom'] = {}) => {
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
    roomState.clientConfig = {
      mindroom: {
        uiActions: { autoOpenFromHomeservers: ['example.org'] },
        canvas: { enabled: true },
        ...mindroom,
      },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org' },
      { membership: 'join', userId: '@alice:example.org' },
    ];
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    const view = () => JSON.stringify(renderer!.toJSON());
    return {
      canvasOpen: () => view().includes('mock-canvas-panel'),
      conversationShown: () => view().includes('mock-room-view'),
      rerender: () => act(async () => renderer!.update(React.createElement(Room))),
      showCanvas: () =>
        act(async () => {
          roomState.mxListeners.get('Room.timeline')?.(
            new MatrixEvent({
              event_id: '$canvas-room',
              room_id: room.roomId,
              sender: '@mindroom_helper:example.org',
              type: 'm.room.message',
              origin_server_ts: Date.now(),
              content: {
                msgtype: 'm.notice',
                body: 'Open this view.',
                'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
                'io.mindroom.ui_action': {
                  version: 1,
                  action: 'show_canvas',
                  requester_id: '@alice:example.org',
                  agent_user_id: '@mindroom_helper:example.org',
                  room_id: room.roomId,
                  thread_id: '$thread',
                  canvas: { title: 'Choose', html: '<p></p>' },
                },
              },
            }),
            room,
            false,
            false,
            { liveEvent: true }
          );
        }),
      unmount: async () => {
        await act(async () => renderer!.unmount());
        vi.stubGlobal('document', undefined);
      },
    };
  };

  const listedCanvas = () =>
    new MatrixEvent({
      event_id: '$listed',
      room_id: '!room:example.org',
      sender: '@mindroom_helper:example.org',
      type: 'm.room.message',
      origin_server_ts: Date.now(),
      content: {
        msgtype: 'm.notice',
        body: 'Open this view.',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
        'io.mindroom.ui_action': {
          version: 1,
          action: 'show_canvas',
          requester_id: '@alice:example.org',
          agent_user_id: '@mindroom_helper:example.org',
          room_id: '!room:example.org',
          thread_id: '$thread',
          canvas: { title: 'Home', html: '<p></p>' },
        },
      },
    });

  it('opens the canvas the Canvases page asked for, filling the room', async () => {
    const canvas = listedCanvas();
    roomState.loadedEvents.set('$listed', canvas);
    const { requestCanvasOpen } = await import('../../canvas/useCanvasOpenRequest');
    requestCanvasOpen('!room:example.org', '$listed');
    const room = await renderCanvasRoom();
    await act(async () => undefined);
    expect(room.canvasOpen()).toBe(true);
    expect(roomState.canvasPanelProps?.event).toBe(canvas);
    expect(roomState.canvasPanelProps?.expanded).toBe(true);
    expect(room.conversationShown()).toBe(false);
    await room.unmount();
  });

  it('does not expand a requested canvas that could not open during a call, when it opens later', async () => {
    const canvas = listedCanvas();
    roomState.loadedEvents.set('$listed', canvas);
    roomState.callEmbed = { mock: 'active call' };
    const { requestCanvasOpen } = await import('../../canvas/useCanvasOpenRequest');
    requestCanvasOpen('!room:example.org', '$listed');
    const view = await renderCanvasRoom();
    await act(async () => undefined);
    expect(view.canvasOpen()).toBe(false);
    roomState.callEmbed = undefined;
    await view.rerender();
    expect(view.canvasOpen()).toBe(false);
    // The agent shows it again after the call: it opens beside the conversation, as usual.
    await act(async () => {
      roomState.mxListeners.get('Room.timeline')?.(listedCanvas(), room, false, false, {
        liveEvent: true,
      });
    });
    expect(view.canvasOpen()).toBe(true);
    expect(roomState.canvasPanelProps?.expanded).toBe(false);
    await view.unmount();
  });

  describe('the header canvas button', () => {
    const entry = (canvasId: string): CanvasListEntry => ({
      canvasId,
      roomId: '!room:example.org',
      threadId: '$thread',
      agentUserId: '@mindroom_helper:example.org',
      title: 'Home',
      createdTs: 1,
      revisionId: canvasId,
      updatedTs: 1,
      shared: false,
    });

    it('lists the conversation’s canvases and opens, marks and closes the chosen one', async () => {
      const canvas = listedCanvas();
      roomState.loadedEvents.set('$listed', canvas);
      roomState.conversationCanvases = [entry('$listed')];
      const view = await renderCanvasRoom();

      expect(roomState.conversationCanvasesFor.at(-1)).toEqual([mx, room.roomId, '$thread']);
      expect(roomState.roomViewProps?.canvases).toBe(roomState.conversationCanvases);
      expect(roomState.roomViewProps?.openCanvasId).toBeUndefined();

      await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$listed'));
      expect(view.canvasOpen()).toBe(true);
      expect(roomState.canvasPanelProps?.event).toBe(canvas);
      expect(roomState.roomViewProps?.openCanvasId).toBe('$listed');

      await act(async () => roomState.roomViewProps?.onCanvasClose?.());
      expect(view.canvasOpen()).toBe(false);
      expect(roomState.roomViewProps?.openCanvasId).toBeUndefined();
      await view.unmount();
    });

    it('opens nothing, and fails nowhere, when the chosen canvas was deleted', async () => {
      mx.relations.mockResolvedValue({ originalEvent: null, events: [] });
      roomState.conversationCanvases = [entry('$deleted')];
      const view = await renderCanvasRoom();

      await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$deleted'));

      expect(mx.relations).toHaveBeenCalled();
      expect(view.canvasOpen()).toBe(false);
      expect(roomState.roomViewProps?.openCanvasId).toBeUndefined();
      await view.unmount();
    });

    describe('when the canvas must be fetched', () => {
      const deferredRelations = () => {
        const pending: Array<(found: { originalEvent: MatrixEvent; events: [] }) => void> = [];
        mx.relations.mockImplementation(
          () =>
            new Promise((resolve) => {
              pending.push(resolve);
            })
        );
        return pending;
      };

      it('drops a canvas that arrives after the user switched to another conversation', async () => {
        const pending = deferredRelations();
        roomState.conversationCanvases = [entry('$listed')];
        const view = await renderCanvasRoom();

        await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$listed'));
        expect(pending).toHaveLength(1);
        // Another thread of the same room, before the fetch answers.
        roomState.search = '?threadId=%24other';
        roomState.routedEvent = { getId: () => '$other', isSending: () => false };
        await view.rerender();
        await act(async () => pending[0]({ originalEvent: listedCanvas(), events: [] }));

        expect(view.canvasOpen()).toBe(false);
        expect(roomState.roomViewProps?.openCanvasId).toBeUndefined();
        // Without the guard the late canvas would send the user back to its own thread instead.
        expect(navigateRoomThreadMock).not.toHaveBeenCalled();
        await view.unmount();
      });

      const olderCanvas = () => new MatrixEvent({ ...listedCanvas().event, event_id: '$older' });

      it.each([
        ['the panel’s Close button', () => roomState.canvasPanelProps?.onClose()],
        ['the header’s canvas button', () => roomState.roomViewProps?.onCanvasClose?.()],
      ])(
        'keeps the panel closed when %s closed it while the canvas loaded',
        async (_name, close) => {
          const pending = deferredRelations();
          roomState.loadedEvents.set('$listed', listedCanvas());
          roomState.conversationCanvases = [entry('$listed'), entry('$older')];
          const view = await renderCanvasRoom();
          await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$listed'));
          expect(view.canvasOpen()).toBe(true);

          await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$older'));
          expect(pending).toHaveLength(1);
          await act(async () => close());
          expect(view.canvasOpen()).toBe(false);
          await act(async () => pending[0]({ originalEvent: olderCanvas(), events: [] }));

          expect(view.canvasOpen()).toBe(false);
          expect(roomState.roomViewProps?.openCanvasId).toBeUndefined();
          await view.unmount();
        }
      );

      it('leaves Members open when it was opened while the canvas loaded', async () => {
        const pending = deferredRelations();
        roomState.conversationCanvases = [entry('$older')];
        const view = await renderCanvasRoom();
        await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$older'));
        roomState.drawer = true;
        await view.rerender();
        await act(async () => pending[0]({ originalEvent: olderCanvas(), events: [] }));

        expect(view.canvasOpen()).toBe(false);
        expect(roomState.setPeopleDrawer).not.toHaveBeenCalled();
        await view.unmount();
      });

      it('leaves the computer open when it was opened while the canvas loaded', async () => {
        const pending = deferredRelations();
        roomState.conversationCanvases = [entry('$older')];
        const view = await renderCanvasRoom({
          computers: { apiUrl: 'https://computer.example.org' },
        });
        await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$older'));
        await act(async () => roomState.roomViewProps?.onComputerToggle?.());
        expect(roomState.roomViewProps?.computerOpen).toBe(true);
        await act(async () => pending[0]({ originalEvent: olderCanvas(), events: [] }));

        expect(view.canvasOpen()).toBe(false);
        expect(roomState.roomViewProps?.computerOpen).toBe(true);
        await view.unmount();
      });

      it('lets a later choice win over an earlier, slower fetch', async () => {
        const pending = deferredRelations();
        const slow = listedCanvas();
        const fast = new MatrixEvent({ ...listedCanvas().event, event_id: '$fast' });
        roomState.conversationCanvases = [entry('$slow'), entry('$fast')];
        const view = await renderCanvasRoom();

        await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$slow'));
        await act(async () => roomState.roomViewProps?.onCanvasOpen?.('$fast'));
        expect(pending).toHaveLength(2);
        await act(async () => pending[1]({ originalEvent: fast, events: [] }));
        expect(roomState.canvasPanelProps?.event).toBe(fast);
        await act(async () => pending[0]({ originalEvent: slow, events: [] }));

        expect(roomState.canvasPanelProps?.event).toBe(fast);
        expect(roomState.roomViewProps?.openCanvasId).toBe('$fast');
        await view.unmount();
      });
    });

    it('lists no canvases during a call', async () => {
      roomState.conversationCanvases = [entry('$listed')];
      roomState.callEmbed = { mock: 'active call' };
      const view = await renderCanvasRoom();

      expect(roomState.roomViewProps).toBeDefined();
      expect(roomState.roomViewProps?.canvases).toBeUndefined();
      await view.unmount();
    });

    it('lists no canvases when the deployment has not enabled them', async () => {
      roomState.conversationCanvases = [entry('$listed')];
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });

      expect(roomState.roomViewProps).toBeDefined();
      expect(roomState.roomViewProps?.canvases).toBeUndefined();
      await act(async () => renderer!.unmount());
    });
  });

  it('tells the header whether this conversation showed its computer', async () => {
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
    ] as never;
    roomState.search = '?threadId=%24thread';
    roomState.computerShown = true;
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    expect(roomState.computerShownFor.at(-1)).toEqual([mx, room.roomId, '$thread']);
    expect(roomState.roomViewProps?.computerShown).toBe(true);
    roomState.computerShown = false;
    await act(async () => renderer.update(React.createElement(Room)));
    expect(roomState.roomViewProps?.computerShown).toBe(false);
    await act(async () => renderer!.unmount());
  });

  it('keeps a canvas open across breakpoints and closes it when Members opens', async () => {
    roomState.screenSize = 'Mobile';
    const room = await renderCanvasRoom();
    await room.showCanvas();
    expect(room.canvasOpen()).toBe(true);
    // Rotating a phone to the tablet layout switches to the saved Members setting, which may be on.
    roomState.screenSize = 'Tablet';
    roomState.drawer = true;
    await room.rerender();
    expect(room.canvasOpen()).toBe(true);
    // The header knows the canvas holds the side panel, and its Members button replaces it.
    expect(roomState.roomViewProps?.canvasOpen).toBe(true);
    await act(async () => roomState.roomViewProps?.onCanvasClose?.());
    expect(room.canvasOpen()).toBe(false);
    expect(roomState.roomViewProps?.canvasOpen).toBe(false);
    await room.unmount();
  });

  it('unmounts the conversation under a canvas on phones', async () => {
    roomState.screenSize = 'Mobile';
    const room = await renderCanvasRoom();
    expect(room.conversationShown()).toBe(true);
    await room.showCanvas();
    expect(room.canvasOpen()).toBe(true);
    expect(room.conversationShown()).toBe(false);
    await act(async () => roomState.canvasPanelProps?.onClose());
    expect(room.conversationShown()).toBe(true);
    await room.unmount();
  });

  it('opens enabled canvases in the native apps', async () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const room = await renderCanvasRoom();
    await room.showCanvas();
    expect(room.canvasOpen()).toBe(true);
    expect(roomState.canvasPanelProps).toBeDefined();
    native.mockRestore();
    await room.unmount();
  });

  it('keeps canvas requests passive when the deployment has not enabled canvases', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true });
    roomState.clientConfig = {
      mindroom: { uiActions: { autoOpenFromHomeservers: ['example.org'] } },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org' },
      { membership: 'join', userId: '@alice:example.org' },
    ];
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => {
      roomState.mxListeners.get('Room.timeline')?.(
        new MatrixEvent({
          event_id: '$canvas-off',
          room_id: room.roomId,
          sender: '@mindroom_helper:example.org',
          type: 'm.room.message',
          origin_server_ts: Date.now(),
          content: {
            msgtype: 'm.notice',
            body: 'Open this view.',
            'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
            'io.mindroom.ui_action': {
              version: 1,
              action: 'show_canvas',
              requester_id: '@alice:example.org',
              agent_user_id: '@mindroom_helper:example.org',
              room_id: room.roomId,
              thread_id: '$thread',
              canvas: { title: 'Choose', html: '<p></p>' },
            },
          },
        }),
        room,
        false,
        false,
        { liveEvent: true }
      );
    });
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('mock-canvas-panel');
    expect(roomState.canvasPanelProps).toBeUndefined();
    await act(async () => renderer!.unmount());
    vi.stubGlobal('document', undefined);
  });

  it('opens the configured computer panel only for exact joined agent identities', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
      { membership: 'invite', userId: '@mindroom_invited:example.org', name: 'Invited' },
      { membership: 'join', userId: '@alice:example.org', name: 'Alice' },
    ] as never;
    roomState.search = '?threadId=%24thread';
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    expect(roomState.roomViewProps?.computerAvailable).toBe(true);

    await act(async () => roomState.roomViewProps?.onComputerToggle?.());

    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);
    expect(roomState.setPeopleDrawer).toHaveBeenCalledWith(false);
    expect(roomState.computerPanelProps).toMatchObject({
      agents: [{ userId: '@mindroom_helper:example.org', name: 'Helper' }],
      apiUrl: 'https://computer.example.org',
      roomId: '!room:example.org',
      threadId: '$thread',
    });
  });

  it('shows the computer as a resizable column, 672 px wide by default', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
    roomState.search = '?threadId=%24thread';
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);

    const json = JSON.stringify(renderer!.toJSON());
    expect(json).toContain('"data-testid":"resizable-computer-panel"');
    expect(json).toContain('"role":"separator"');
    expect(json).toContain('"aria-label":"Resize computer panel"');
    expect(computerWrapper(renderer!).props.style).toEqual({ width: 672 });
    // The conversation and the panel are the only columns: no divider Line sits between them.
    expect((renderer!.toJSON() as { children: unknown[] }).children).toHaveLength(2);

    // Phones show the panel full screen: no box and no resize handle of its own, and the
    // screen stays connected (the panel is not remounted) as the viewport changes.
    roomState.screenSize = 'Mobile';
    await act(async () => renderer.update(React.createElement(Room)));
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('"role":"separator"');
    expect(roomState.panelDisposals).toBe(0);

    roomState.screenSize = 'Desktop';
    await act(async () => renderer.update(React.createElement(Room)));
    expect(renderer!.root.findAllByProps({ role: 'separator' })).toHaveLength(1);
    expect(computerWrapper(renderer!).props.style).toEqual({ width: 672 });
    expect(roomState.panelDisposals).toBe(0);
    await act(async () => renderer!.unmount());
  });

  it("reads the computer's width from its own per-account storage key", async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
    roomState.search = '?threadId=%24thread';
    // This file runs in Node, which has no localStorage: give the panel a small in-memory one.
    const stored = new Map<string, string>([
      ['mindroom.computer.width:@alice:example.org', '800'],
      // Other panels' widths and other accounts' computer widths must not leak in.
      ['mindroom.computer.width:@bob:example.org', '500'],
      ['mindroom.canvas.width:@alice:example.org', '450'],
    ]);
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    try {
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(computerWrapper(renderer!).props.style).toEqual({ width: 800 });
      await act(async () => renderer!.unmount());
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it("an expanded computer takes the conversation's column without reconnecting", async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
    roomState.search = '?threadId=%24thread';
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    const roomViewShown = () => renderer!.root.findAllByType('mock-room-view').length === 1;
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(roomState.computerPanelProps?.expanded).toBe(false);
    expect(roomViewShown()).toBe(true);

    expect(computerWrapper(renderer!).props.style).toEqual({ width: 672 });
    expect(renderer!.root.findAllByProps({ role: 'separator' })).toHaveLength(1);

    await act(async () => roomState.computerPanelProps?.onToggleExpanded?.());
    expect(roomState.computerPanelProps?.expanded).toBe(true);
    expect(roomViewShown()).toBe(false);
    expect(roomState.panelDisposals).toBe(0);
    // The panel fills the room: full width and no resize handle.
    expect(computerWrapper(renderer!).props.style).toEqual({ width: '100%' });
    expect(renderer!.root.findAllByProps({ role: 'separator' })).toHaveLength(0);

    await act(async () => roomState.computerPanelProps?.onToggleExpanded?.());
    expect(roomState.computerPanelProps?.expanded).toBe(false);
    expect(roomViewShown()).toBe(true);
    expect(roomState.panelDisposals).toBe(0);
    expect(computerWrapper(renderer!).props.style).toEqual({ width: 672 });
    expect(renderer!.root.findAllByProps({ role: 'separator' })).toHaveLength(1);

    // Closing the computer forgets the expansion.
    await act(async () => roomState.computerPanelProps?.onToggleExpanded?.());
    await act(async () => roomState.computerPanelProps?.onClose?.());
    expect(roomViewShown()).toBe(true);
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(roomState.computerPanelProps?.expanded).toBe(false);
    expect(roomViewShown()).toBe(true);

    // Phones already show the computer full screen: no Expand toggle.
    roomState.screenSize = 'Mobile';
    await act(async () => renderer.update(React.createElement(Room)));
    expect(roomState.computerPanelProps?.onToggleExpanded).toBeUndefined();

    await act(async () => renderer!.unmount());
  });

  it("unmounts the conversation under the phone's full-screen computer without reconnecting", async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
    roomState.search = '?threadId=%24thread';
    roomState.screenSize = 'Mobile';
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    const roomViewShown = () => renderer!.root.findAllByType('mock-room-view').length === 1;
    const pressEscape = () => {
      vi.mocked(isKeyHotkey).mockReturnValue(true);
      try {
        vi.mocked(useKeyDown).mock.lastCall?.[1]({ key: 'Escape' } as KeyboardEvent);
      } finally {
        vi.mocked(isKeyHotkey).mockReturnValue(false);
      }
    };
    expect(roomViewShown()).toBe(true);

    // The phone's computer covers the conversation, which must not mark messages read unseen,
    // on Escape either.
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);
    expect(roomViewShown()).toBe(false);
    expect(roomState.panelDisposals).toBe(0);
    const marked = () =>
      vi.mocked(markThreadAsRead).mock.calls.length +
      vi.mocked(markRoomAndThreadsAsRead).mock.calls.length;
    vi.mocked(markThreadAsRead).mockClear();
    vi.mocked(markRoomAndThreadsAsRead).mockClear();
    pressEscape();
    expect(marked()).toBe(0);

    // Crossing the breakpoint keeps the same panel (and its stream) either way.
    roomState.screenSize = 'Desktop';
    await act(async () => renderer.update(React.createElement(Room)));
    expect(roomViewShown()).toBe(true);
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);
    expect(roomState.panelDisposals).toBe(0);

    roomState.screenSize = 'Mobile';
    await act(async () => renderer.update(React.createElement(Room)));
    expect(roomViewShown()).toBe(false);
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);
    expect(roomState.panelDisposals).toBe(0);

    // Closing the computer brings the conversation back, and Escape marks it read again.
    await act(async () => roomState.computerPanelProps?.onClose?.());
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(0);
    expect(roomViewShown()).toBe(true);
    pressEscape();
    expect(marked()).toBe(1);
    await act(async () => renderer!.unmount());
  });

  it.each(['$root', '$reply'])(
    'routes continuation after canonical root %s resolves',
    async (resolvedRoot) => {
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
      };
      roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
      roomState.search = '?threadId=%24reply';
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(roomState.computerPanelProps?.continuationReady).toBe(false);
      roomState.routedEvent = {
        getId: () => '$reply',
        threadRootId: resolvedRoot,
        isSending: () => false,
      };
      const { RoomEvent } = await import('matrix-js-sdk');
      await act(async () =>
        roomState.listeners.get(RoomEvent.Timeline)?.(roomState.routedEvent, room, false, false)
      );
      expect(roomState.computerPanelProps?.threadId).toBe(resolvedRoot);
      expect(roomState.computerPanelProps?.continuationReady).toBe(true);
      await act(async () => renderer!.unmount());
    }
  );

  it.each(['agent', 'api'])(
    'restores Members and disposes Computer when %s availability vanishes',
    async (cause) => {
      roomState.drawer = true;
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
      };
      const members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
      roomState.members = members;
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Members' })).toHaveLength(0);
      if (cause === 'agent') roomState.members = [];
      else
        roomState.clientConfig = {
          mindroom: { computers: { apiUrl: 'http://remote.example.org' } },
        };
      await act(async () => renderer!.update(React.createElement(Room)));
      expect(roomState.roomViewProps?.computerOpen).toBe(false);
      expect(roomState.panelDisposals).toBe(1);
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Members' })).toHaveLength(1);
      roomState.members = members;
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
      };
      await act(async () => renderer!.update(React.createElement(Room)));
      expect(roomState.roomViewProps?.computerOpen).toBe(false);
      await act(async () => renderer!.unmount());
    }
  );

  it('closes the computer and ignores old control callbacks when the service changes', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    const previousInteractionChange = roomState.computerPanelProps?.onInteractionChange;
    await act(async () =>
      previousInteractionChange?.({ locked: true, agentUserId: '@mindroom_helper:example.org' })
    );
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://other-computer.example.org' } },
    };
    await act(async () => renderer!.update(React.createElement(Room)));
    expect(roomState.roomViewProps?.computerOpen).toBe(false);
    expect(roomState.panelDisposals).toBe(1);
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(roomState.computerPanelProps?.apiUrl).toBe('https://other-computer.example.org');
    await act(async () =>
      previousInteractionChange?.({ locked: true, agentUserId: '@mindroom_helper:example.org' })
    );
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(roomState.roomViewProps?.computerOpen).toBe(false);
    await act(async () => renderer!.unmount());
  });

  it('closes an open computer panel when the routed thread changes', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
    ] as never;
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);

    roomState.search = '?threadId=%24new-thread';
    await act(async () => renderer!.update(React.createElement(Room)));

    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(0);
    expect(roomState.computerPanelThreads).toEqual([undefined]);
    await act(async () => renderer!.unmount());
  });

  it('ignores computer callbacks from a previous visit to the same conversation', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    roomState.members = [
      { membership: 'join', userId: '@alice:example.org' },
      { membership: 'join', userId: '@mindroom_helper:example.org' },
    ];
    const { Room } = await import('../../../features/room/Room');
    const { makeUiEvent } = await import('../../ui-actions/testUtils');
    const { ChatUiActionContext } = await import('../../ui-actions/ChatUiActionProvider');
    roomState.uiProbe = function UiProbe() {
      roomState.activateUiAction = React.useContext(ChatUiActionContext)?.activate;
      return null;
    };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    const previousInteractionChange = roomState.computerPanelProps?.onInteractionChange;
    roomState.search = '?threadId=%24other';
    await act(async () => renderer!.update(React.createElement(Room)));
    roomState.search = '?threadId=%24thread';
    await act(async () => renderer!.update(React.createElement(Room)));
    expect(roomState.roomViewProps?.computerOpen).toBe(false);
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    await act(async () =>
      previousInteractionChange?.({ agentUserId: '@mindroom_helper:example.org', locked: true })
    );
    await act(async () =>
      roomState.activateUiAction?.(makeUiEvent({ action: 'open_panel', panel: 'members' }))
    );
    expect(roomState.roomViewProps?.computerOpen).toBe(false);
    expect(roomState.setPeopleDrawer).toHaveBeenCalledWith(true);
    await act(async () => renderer!.unmount());
  });

  it('opens a historical UI action from classic view in its originating thread', async () => {
    roomState.viewMode = 'classic';
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [
      { membership: 'join', userId: '@alice:example.org' },
      { membership: 'join', userId: '@mindroom_helper:example.org' },
    ];
    const { Room } = await import('../../../features/room/Room');
    const { makeUiEvent } = await import('../../ui-actions/testUtils');
    const { ChatUiActionContext } = await import('../../ui-actions/ChatUiActionProvider');
    roomState.uiProbe = function UiProbe() {
      roomState.activateUiAction = React.useContext(ChatUiActionContext)?.activate;
      return null;
    };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => roomState.activateUiAction?.(makeUiEvent()));
    expect(roomState.setViewMode).toHaveBeenCalledWith('threaded');
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$thread');
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    await act(async () => renderer!.update(React.createElement(Room)));
    expect(navigateRoomMock).not.toHaveBeenCalled();
    expect(roomState.computerPanelProps).toMatchObject({
      requestedAgent: { userId: '@mindroom_helper:example.org' },
      threadId: '$thread',
    });
    await act(async () => renderer!.unmount());
  });

  it('keeps hidden Settings sections unavailable in Simple Mode', async () => {
    roomState.simpleMode = true;
    roomState.search = '?threadId=%24thread';
    roomState.routedEvent = { getId: () => '$thread', isSending: () => false };
    roomState.members = [
      { membership: 'join', userId: '@alice:example.org' },
      { membership: 'join', userId: '@mindroom_helper:example.org' },
    ];
    const { Room } = await import('../../../features/room/Room');
    const { makeUiEvent } = await import('../../ui-actions/testUtils');
    const { ChatUiActionContext } = await import('../../ui-actions/ChatUiActionProvider');
    const { settingsModalAtom } = await import('../../../state/settingsModal');
    const { getDefaultStore } = await import('jotai');
    getDefaultStore().set(settingsModalAtom, undefined);
    roomState.uiProbe = function UiProbe() {
      roomState.activateUiAction = React.useContext(ChatUiActionContext)?.activate;
      return null;
    };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () =>
      roomState.activateUiAction?.(makeUiEvent({ action: 'open_settings', section: 'developer' }))
    );
    expect(getDefaultStore().get(settingsModalAtom)).toBeUndefined();
    await act(async () =>
      roomState.activateUiAction?.(
        makeUiEvent({ action: 'open_settings', section: 'emojis-stickers' })
      )
    );
    expect(getDefaultStore().get(settingsModalAtom)).toBeUndefined();
    roomState.simpleMode = false;
    await act(async () => renderer!.update(React.createElement(Room)));
    await act(async () =>
      roomState.activateUiAction?.(makeUiEvent({ action: 'open_settings', section: 'developer' }))
    );
    expect(getDefaultStore().get(settingsModalAtom)).toBeDefined();
    getDefaultStore().set(settingsModalAtom, undefined);
    await act(async () => renderer!.unmount());
  });

  it('leaves an explicit thread in the URL untouched', async () => {
    roomState.search = '?threadId=%24explicit';
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it('does not navigate when returning to a room after leaving a thread', async () => {
    roomState.search = '?threadId=%24opened';
    const { Room } = await import('../../../features/room/Room');

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    roomState.search = '';

    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it('drops a thread from recent threads when it fails to load', async () => {
    roomState.search = '?threadId=%24saved';
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    await act(async () => {
      roomState.roomViewProps?.onThreadLoadError?.('$saved');
    });

    expect(removeRecentThreadMock).toHaveBeenCalledWith('!room:example.org', '$saved');
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it('does not render a duplicate room header around RoomView in non-call rooms', async () => {
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    expect(renderer!.root.findAllByType('mock-room-view')).toHaveLength(1);
    expect(renderer!.root.findAllByType('mock-room-view-header')).toHaveLength(0);
  });

  it('updates call-room chat from the overview to the selected thread route', async () => {
    roomState.callChat = true;
    roomState.callRoom = true;
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    expect(roomState.callChatViewProps?.threadId).toBeUndefined();

    roomState.search = '?threadId=%24root';
    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    expect(roomState.callChatViewProps).toMatchObject({
      focusEventInRoom: false,
      room,
      threadId: '$root',
    });
    expect(roomState.callChatViewProps?.onThreadLoadError).toEqual(expect.any(Function));
  });
});
