import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { JoinRule, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomNavItem } from './RoomNavItem';
import { RoomNotificationMode } from '../../hooks/useRoomsNotificationPreferences';

const testState = vi.hoisted(() => ({
  avatarMxc: undefined as string | undefined,
  directAvatarMxc: undefined as string | undefined,
  roomAvatarMxc: undefined as string | undefined,
  backgroundJobs: [] as { jobId: string }[],
  setHover: undefined as ((hovering: boolean) => void) | undefined,
  matrixMxcUrlToHttp: vi.fn((mxc: string) =>
    mxc.startsWith('mxc://example.org/')
      ? `https://media.example.org/${mxc.slice('mxc://example.org/'.length)}`
      : null
  ),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const Container = ({ children, ...props }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', props, children);

  return {
    Avatar: Container,
    Badge: Container,
    Box: Container,
    Icon: (props: Record<string, unknown>) => reactModule.createElement('i', props),
    IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('button', props, children),
    Icons: {
      ArrowGoLeft: 'ArrowGoLeft',
      Clock: 'Clock',
      Link: 'Link',
      Message: 'Message',
      Setting: 'Setting',
      UserPlus: 'UserPlus',
      VerticalDots: 'VerticalDots',
    },
    Line: Container,
    Menu: Container,
    MenuItem: Container,
    PopOut: Container,
    Spinner: Container,
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', props, children),
    config: {
      opacity: { P300: 0.3, P500: 0.5 },
      space: { S100: '4px' },
    },
    toRem: (value: number) => `${value}rem`,
  };
});

vi.mock('react-aria', () => ({
  useFocusWithin: () => ({ focusWithinProps: {} }),
  useHover: ({ onHoverChange }: { onHoverChange: (hovering: boolean) => void }) => {
    testState.setHover = onHoverChange;
    return { hoverProps: {} };
  },
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();
  return {
    ...actual,
    useAtom: () => [false, vi.fn()],
    useAtomValue: () => ({}),
  };
});

vi.mock('../../components/nav', async () => {
  const reactModule = await import('react');
  const Container = ({ children, ...props }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', props, children);

  return {
    NavItem: Container,
    NavItemContent: Container,
    NavItemOptions: Container,
    NavLink: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) =>
      reactModule.createElement('a', { href: to, ...props }, children),
  };
});

vi.mock('../../components/unread-badge', async () => {
  const reactModule = await import('react');
  return {
    UnreadBadge: () => reactModule.createElement('span'),
    UnreadBadgeCenter: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('../../components/typing-indicator', async () => {
  const reactModule = await import('react');
  return {
    TypingIndicator: () => reactModule.createElement('span'),
  };
});

vi.mock('../../components/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: () => null,
}));

vi.mock('../../components/invite-user-prompt', () => ({
  InviteUserPrompt: () => null,
}));

vi.mock('../../components/leave-room-prompt', () => ({
  LeaveRoomPrompt: () => null,
}));

vi.mock('../../components/UseStateProvider', () => ({
  UseStateProvider: () => null,
}));

vi.mock('../../mindroom/notifications/MindroomMarkRoomReadMenuItem', () => ({
  MindroomMarkRoomReadMenuItem: () => null,
}));

vi.mock('../../components/room-avatar', async () => {
  const reactModule = await import('react');

  const RoomAvatar = ({
    src,
    alt,
    renderFallback,
  }: {
    src?: string;
    alt?: string;
    renderFallback: () => React.ReactNode;
  }) => {
    const [failedSrc, setFailedSrc] = reactModule.useState<string>();
    return !src || failedSrc === src
      ? renderFallback()
      : reactModule.createElement('img', {
          alt,
          'data-testid': 'room-avatar-image',
          onError: () => setFailedSrc(src),
          src,
        });
  };

  return {
    RoomAvatar,
    RoomIcon: (props: Record<string, unknown>) =>
      reactModule.createElement('i', { ...props, 'data-testid': 'room-icon' }),
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://media.example.org',
    getUserId: () => '@me:example.org',
    mxcUrlToHttp: testState.matrixMxcUrlToHttp,
  }),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => true,
}));

vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomAvatar: (_room: Room, direct?: boolean) =>
    direct ? testState.directAvatarMxc : testState.avatarMxc,
  useRoomName: () => 'Agent Room',
}));

vi.mock('../../state/hooks/unread', () => ({
  useRoomUnread: () => undefined,
}));

vi.mock('../../hooks/useRoomTypingMembers', () => ({
  useRoomTypingMember: () => [],
}));

vi.mock('../../hooks/useCall', () => ({
  useCallMembers: () => [],
  useCallSession: () => undefined,
}));

vi.mock('../../hooks/useCallEmbed', () => ({
  useCallEmbed: () => undefined,
  useCallStart: () => vi.fn(),
}));

vi.mock('../../state/hooks/callPreferences', () => ({
  useCallPreferencesAtom: () => ({}),
}));

vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => undefined,
}));

vi.mock('../../mindroom/tooltip/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: () => void) => React.ReactNode }) =>
    children(() => undefined),
}));

vi.mock('../../mindroom/background-jobs/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => testState.backgroundJobs,
}));

vi.mock('../../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
  isRoomAlias: () => false,
  mxcUrlToHttp: (_mx: unknown, mxc: string) =>
    mxc.startsWith('mxc://example.org/avatar')
      ? `https://media.example.org/${mxc.slice('mxc://example.org/'.length)}`
      : undefined,
}));

const room = {
  roomId: '!room:example.org',
  getJoinRule: () => JoinRule.Public,
  getMxcAvatarUrl: () => testState.roomAvatarMxc,
  getType: () => undefined,
  isCallRoom: () => false,
} as unknown as Room;

const renderRoomNavItem = (props: { direct?: boolean; showAvatar?: boolean } = {}) =>
  create(
    <RoomNavItem
      room={room}
      selected={false}
      linkPath="/room"
      notificationMode={RoomNotificationMode.Unset}
      {...props}
    />
  );

const findByTestId = (renderer: ReactTestRenderer, testId: string) =>
  renderer.root.findAll((node) => node.props['data-testid'] === testId);

describe('RoomNavItem avatar', () => {
  afterEach(() => {
    testState.avatarMxc = undefined;
    testState.directAvatarMxc = undefined;
    testState.roomAvatarMxc = undefined;
    testState.matrixMxcUrlToHttp.mockClear();
  });

  it('upgrades the privacy icon to the room avatar when avatar state appears', () => {
    const renderer = renderRoomNavItem();

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);

    testState.avatarMxc = 'mxc://example.org/avatar';
    act(() => {
      renderer.update(
        <RoomNavItem
          room={room}
          selected={false}
          linkPath="/room"
          notificationMode={RoomNotificationMode.Unset}
        />
      );
    });

    const images = findByTestId(renderer, 'room-avatar-image');
    expect(images).toHaveLength(1);
    expect(images[0].props).toMatchObject({
      alt: 'Agent Room',
      src: 'https://media.example.org/avatar',
    });
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);

    testState.avatarMxc = undefined;
    act(() => {
      renderer.update(
        <RoomNavItem
          room={room}
          selected={false}
          linkPath="/room"
          notificationMode={RoomNotificationMode.Unset}
        />
      );
    });

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);
  });

  it('keeps the privacy icon when avatar conversion fails', () => {
    testState.avatarMxc = 'mxc://example.org/invalid';

    const renderer = renderRoomNavItem();

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);
  });

  it('falls back to the privacy icon when the room avatar image fails', () => {
    testState.avatarMxc = 'mxc://example.org/avatar';

    const renderer = renderRoomNavItem();

    act(() => {
      findByTestId(renderer, 'room-avatar-image')[0].props.onError();
    });

    expect(findByTestId(renderer, 'room-icon')).toHaveLength(1);
    expect(findByTestId(renderer, 'room-avatar-image')).toHaveLength(0);

    testState.avatarMxc = 'mxc://example.org/avatar-2';
    act(() => {
      renderer.update(
        <RoomNavItem
          room={room}
          selected={false}
          linkPath="/room"
          notificationMode={RoomNotificationMode.Unset}
        />
      );
    });

    expect(findByTestId(renderer, 'room-avatar-image')[0].props.src).toBe(
      'https://media.example.org/avatar-2'
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });

  it('preserves direct-message initials when no avatar is available', () => {
    const renderer = renderRoomNavItem({ direct: true, showAvatar: true });

    expect(renderer.root.findAllByType('span').some((node) => node.children.includes('A'))).toBe(
      true
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });

  it('lazily prefers the direct member avatar and keeps initials on image failure', () => {
    testState.directAvatarMxc = 'mxc://example.org/avatar';
    testState.roomAvatarMxc = 'mxc://example.org/room-avatar';

    const renderer = renderRoomNavItem({ direct: true, showAvatar: true });

    expect(testState.matrixMxcUrlToHttp).not.toHaveBeenCalled();
    expect(findByTestId(renderer, 'room-avatar-image')[0].props.src).toBe(
      'https://media.example.org/avatar'
    );

    act(() => {
      findByTestId(renderer, 'room-avatar-image')[0].props.onError();
    });

    expect(renderer.root.findAllByType('span').some((node) => node.children.includes('A'))).toBe(
      true
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });

  it('uses the room avatar when a direct member has no avatar', () => {
    testState.roomAvatarMxc = 'mxc://example.org/room-avatar';

    const renderer = renderRoomNavItem({ direct: true, showAvatar: true });

    expect(testState.matrixMxcUrlToHttp).toHaveBeenCalledTimes(1);
    expect(findByTestId(renderer, 'room-avatar-image')[0].props.src).toBe(
      'https://media.example.org/room-avatar'
    );
    expect(findByTestId(renderer, 'room-icon')).toHaveLength(0);
  });
});

describe('RoomNavItem background jobs', () => {
  afterEach(() => {
    testState.backgroundJobs = [];
  });

  const jobsIndicators = (renderer: ReactTestRenderer) =>
    renderer.root.findAll((node) => node.type === 'i' && node.props.src === 'Clock');

  it('marks a room while an agent has background jobs in it', () => {
    expect(jobsIndicators(renderRoomNavItem())).toHaveLength(0);

    testState.backgroundJobs = [{ jobId: 'job-1' }];
    const indicators = jobsIndicators(renderRoomNavItem());

    expect(indicators).toHaveLength(1);
    expect(indicators[0].props['aria-label']).toBe('Background jobs running');
  });

  it('keeps the mark while the row is hovered, so its tooltip can name it', () => {
    testState.backgroundJobs = [{ jobId: 'job-1' }];
    const renderer = renderRoomNavItem();
    act(() => testState.setHover?.(true));

    expect(jobsIndicators(renderer)).toHaveLength(1);
  });
});
