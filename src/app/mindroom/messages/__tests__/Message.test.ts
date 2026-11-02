import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_AVATAR_SIZE } from '../../../components/message/layout/config';

type HostNodeMock = {
  focus: ReturnType<typeof vi.fn>;
  getBoundingClientRect: () => { x: number; y: number; width: number; height: number };
  props: Record<string, unknown>;
  type: unknown;
};

let lastMessageBaseNode: HostNodeMock | undefined;

const domMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));
const longTextMocks = vi.hoisted(() => ({
  downloadMindroomLongTextSidecarBlob: vi.fn(),
  getMindroomLongTextSource: vi.fn(() => undefined),
  useMindroomLongTextResolvedContent: vi.fn(() => undefined),
}));

// These renderer/UI mocks should move into shared Vitest setup once the repo adds one.
vi.mock('../../../features/room/message/styles.css', () => ({
  BubbleAvatarBase: 'BubbleAvatarBase',
  MessageAvatar: 'MessageAvatar',
  MessageAvatarWithModel: 'MessageAvatarWithModel',
  MessageBase: 'MessageBase',
  MessageBaseBubbleCollapsed: 'MessageBaseBubbleCollapsed',
  MessageContentWithDisclosure: 'MessageContentWithDisclosure',
  MessageMenuGroup: 'MessageMenuGroup',
  MessageMenuItemText: 'MessageMenuItemText',
  MessageOptionsBar: 'MessageOptionsBar',
  MessageOptionsBase: 'MessageOptionsBase',
}));

vi.mock('../MindroomModelBadge.css', () => ({
  Badge: 'Badge',
  Icon: 'Icon',
  Label: 'Label',
}));

vi.mock('../MessageCopyActions.css', () => ({
  CopyActionDivider: 'CopyActionDivider',
}));

vi.mock('../MindroomMessageControls.css', () => ({
  AiRunInfoButton: 'AiRunInfoButton',
  ReplyDetailsScroll: 'ReplyDetailsScroll',
  MenuItemText: 'MenuItemText',
}));

vi.mock('../../../components/page', async () => {
  const { createElement } = await import('react');
  return {
    PageScroll: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
      createElement('div', null, header, children),
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children: React.ReactNode;
    focusTrapOptions?: Record<string, unknown>;
  }) => React.createElement('focus-trap', { focusTrapOptions }, children),
}));

vi.mock('react-aria', () => ({
  useHover: ({ onHoverChange }: { onHoverChange?: (hovering: boolean) => void }) => {
    React.useEffect(() => {
      onHoverChange?.(true);
    }, [onHoverChange]);

    return { hoverProps: {} };
  },
  useFocusWithin: () => ({ focusWithinProps: {} }),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const { createElement } = reactModule;

  const div =
    (tag = 'div') =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      createElement(tag, props, children);

  return {
    Avatar: div(),
    Box: div(),
    Button: div('button'),
    Dialog: div(),
    Header: div(),
    Icon: ({ src }: { src?: string }) => createElement('span', null, src ?? 'icon'),
    IconButton: ({
      children,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      [key: string]: unknown;
    }) => createElement('button', { ...props, onClick, type: 'button' }, children),
    Icons: {
      CheckTwice: 'CheckTwice',
      Cross: 'Cross',
      Delete: 'Delete',
      Download: 'Download',
      Info: 'Info',
      Link: 'Link',
      Pencil: 'Pencil',
      Pin: 'Pin',
      ReplyArrow: 'ReplyArrow',
      SmilePlus: 'SmilePlus',
      Terminal: 'Terminal',
      Text: 'Text',
      ThreadPlus: 'ThreadPlus',
      User: 'User',
      VerticalDots: 'VerticalDots',
      Warning: 'Warning',
    },
    Input: div('input'),
    Line: div('hr'),
    Menu: div(),
    MenuItem: ({
      children,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      [key: string]: unknown;
    }) => createElement('button', { ...props, onClick, type: 'button' }, children),
    Modal: div(),
    Overlay: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? createElement('div', null, children) : null,
    OverlayBackdrop: div(),
    OverlayCenter: div(),
    PopOut: ({
      children,
      content,
      anchor,
    }: {
      children?: React.ReactNode;
      content?: React.ReactNode;
      anchor?: unknown;
    }) => createElement('div', null, children, anchor ? content : null),
    Spinner: () => createElement('div', null, 'spinner'),
    Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      createElement('span', props, children),
    Tooltip: div(),
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<unknown>) => React.ReactNode;
    }) => createElement(reactModule.Fragment, null, children(null)),
    as: (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
      reactModule.forwardRef(render),
    color: {
      Critical: { Main: '#f00' },
      Success: { Main: '#0a0' },
    },
    config: {
      borderWidth: {
        B300: '1px',
      },
      space: {
        S200: '8px',
        S400: '16px',
      },
    },
  };
});

vi.mock('../../../components/message', () => ({
  AvatarBase: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  BubbleLayout: ({
    before,
    header,
    children,
  }: {
    before?: React.ReactNode;
    header?: React.ReactNode;
    children?: React.ReactNode;
  }) => React.createElement('div', null, before, header, children),
  CompactLayout: ({ before, children }: { before?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, before, children),
  MessageBase: React.forwardRef(
    (
      {
        children,
        ...props
      }: {
        children?: React.ReactNode;
        [key: string]: unknown;
      },
      ref: React.Ref<HostNodeMock>
    ) => {
      const nodeRef = React.useRef<HostNodeMock>({
        focus: vi.fn(),
        getBoundingClientRect: () => ({
          x: 10,
          y: 20,
          width: 30,
          height: 40,
        }),
        props: {},
        type: 'div',
      });

      nodeRef.current.props = props;
      lastMessageBaseNode = nodeRef.current;

      if (typeof ref === 'function') {
        ref(nodeRef.current);
      } else if (ref) {
        const mutableRef = ref as React.MutableRefObject<HostNodeMock | null>;
        mutableRef.current = nodeRef.current;
      }

      return React.createElement('div', props, children);
    }
  ),
  ModernLayout: ({ before, children }: { before?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, before, children),
  Time: () => React.createElement('span', null, 'time'),
  Username: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('button', { ...props, type: 'button' }, children),
  UsernameBold: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../../utils/room', () => ({
  canEditEvent: () => false,
  getEventEdits: () => undefined,
  getEditedEvent: () => undefined,
  getLatestMessageContent: (mEvent: { getContent: () => Record<string, unknown> }) =>
    mEvent.getContent(),
  getMemberAvatarMxc: () => undefined,
  getMemberDisplayName: () => 'Alice',
}));

vi.mock('../../../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: () => '!room:example.org',
  getMxIdLocalPart: () => 'alice',
  isRoomAlias: () => false,
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:example.org',
    sendStateEvent: vi.fn(),
    redactEvent: vi.fn(),
    reportEvent: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useRecentEmoji', () => ({
  useRecentEmoji: () => [],
}));

vi.mock('../../../hooks/useImagePacks', () => ({
  useRelevantImagePacks: () => [],
}));

vi.mock('../../../components/event-readers', () => ({
  EventReaders: () => React.createElement('div', null, 'readers'),
}));

vi.mock('../../../components/text-viewer', () => ({
  TextViewer: () => React.createElement('div', null, 'viewer'),
}));

vi.mock('../../../hooks/useAsyncCallback', () => ({
  AsyncStatus: {
    Error: 'Error',
    Loading: 'Loading',
    Success: 'Success',
  },
  useAsyncCallback: () => [{ status: 'Idle' }, vi.fn()],
}));

vi.mock('../../../components/emoji-board', () => ({
  EmojiBoard: () => React.createElement('div', null, 'emoji-board'),
}));

vi.mock('../../../features/room/reaction-viewer', () => ({
  ReactionViewer: () => React.createElement('div', null, 'reactions'),
}));

vi.mock('../../../features/room/message/MessageEditor', () => ({
  MessageEditor: () => React.createElement('div', null, 'editor'),
}));

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: () => React.createElement('div', null, 'avatar'),
}));

vi.mock('../../../utils/dom', () => ({
  copyToClipboard: domMocks.copyToClipboard,
}));

vi.mock('../../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../../plugins/matrix-to', () => ({
  getMatrixToRoomEvent: () => 'https://matrix.to/#/!room:example.org/$event',
}));

vi.mock('../../../plugins/via-servers', () => ({
  getViaServers: () => [],
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useRoomPinnedEvents', () => ({
  useRoomPinnedEvents: () => [],
}));
vi.mock('../../threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    pinnedEventIds: [],
    canPin: true,
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));

vi.mock('../../../../types/matrix/room', () => ({
  StateEvent: {
    RoomPinnedEvents: 'm.room.pinned_events',
  },
}));

vi.mock('../../../components/power', () => ({
  PowerIcon: () => null,
}));

vi.mock('../../../../util/colorMXID', () => ({
  default: () => '#333',
}));

vi.mock('../../../hooks/useMemberPowerTag', () => ({
  getPowerTagIconSrc: () => undefined,
}));

// The bug-report flow pulls in thread and Matrix plumbing this message-menu test does not exercise.
vi.mock('../../bug-reports/MessageBugReportItem', async () => {
  const { createElement } = await import('react');
  return {
    MessageBugReportItem: () =>
      createElement('button', null, createElement('span', null, 'Report a bug')),
  };
});

vi.mock('../longText', () => ({
  getMindroomLongTextSource: longTextMocks.getMindroomLongTextSource,
}));

vi.mock('../MindroomLongTextText', () => ({
  downloadMindroomLongTextSidecarBlob: longTextMocks.downloadMindroomLongTextSidecarBlob,
  useMindroomLongTextResolvedContent: longTextMocks.useMindroomLongTextResolvedContent,
}));

vi.mock('../../../state/settings', () => ({
  MessageLayout: {
    Compact: 'Compact',
    Bubble: 'Bubble',
    Modern: 'Modern',
  },
}));

const getMessageComponent = async () =>
  (await import('../../../features/room/message/Message')).Message;

beforeEach(() => {
  lastMessageBaseNode = undefined;
  vi.clearAllMocks();
  longTextMocks.getMindroomLongTextSource.mockReturnValue(undefined);
  longTextMocks.useMindroomLongTextResolvedContent.mockReturnValue(undefined);
});

const createMessageEvent = (content: Record<string, unknown>, eventId = '$event') =>
  ({
    threadRootId: undefined,
    getContent: () => content,
    getId: () => eventId,
    getSender: () => '@alice:example.org',
    getTs: () => 1,
    isRedacted: () => false,
  } as const);

const createRoom = () =>
  ({
    roomId: '!room:example.org',
    getTimelineForEvent: () => undefined,
  } as const);

type RenderedMessage = {
  renderer: ReactTestRenderer;
  messageBaseNode?: HostNodeMock;
};

const renderMessage = async (
  content: Record<string, unknown>,
  {
    collapse = true,
    eventId = '$event',
    resolvedMessageContent,
    serverActions = false,
  }: {
    collapse?: boolean;
    eventId?: string;
    resolvedMessageContent?: Record<string, unknown>;
    serverActions?: boolean;
  } = {}
): Promise<RenderedMessage> => {
  const Message = await getMessageComponent();
  let renderer!: ReactTestRenderer;
  lastMessageBaseNode = undefined;

  await act(async () => {
    renderer = create(
      React.createElement(
        Message,
        {
          room: createRoom(),
          mEvent: createMessageEvent(content, eventId),
          collapse,
          highlight: false,
          canDelete: serverActions,
          canPinEvent: serverActions,
          canSendReaction: serverActions,
          resolvedMessageContent,
          messageLayout: 'Modern',
          messageSpacing: '400',
          onUserClick: vi.fn(),
          onUsernameClick: vi.fn(),
          onReplyClick: vi.fn(),
          onReactionToggle: vi.fn(),
          hour24Clock: false,
          dateFormatString: 'MMM D',
        },
        React.createElement('div', null, 'message body')
      )
    );
  });

  return { renderer, messageBaseNode: lastMessageBaseNode };
};

const hasSpanText = (renderer: ReactTestRenderer, text: string): boolean =>
  renderer.root.findAllByType('span').some((node) => node.children.join('') === text);

const getButtonByText = (
  renderer: ReactTestRenderer,
  text: string
): ReactTestInstance | undefined =>
  renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((spanNode) => spanNode.children.join('') === text)
    );

const getButtonByAriaLabel = (
  renderer: ReactTestRenderer,
  ariaLabel: string
): ReactTestInstance | undefined =>
  renderer.root.findAllByType('button').find((node) => node.props['aria-label'] === ariaLabel);

const getButtonByIcon = (
  renderer: ReactTestRenderer,
  icon: string
): ReactTestInstance | undefined =>
  renderer.root
    .findAllByType('button')
    .find((node) =>
      node.findAllByType('span').some((spanNode) => spanNode.children.join('') === icon)
    );

const getDialogFocusTrapOptions = (renderer: ReactTestRenderer): Record<string, unknown> => {
  const dialogFocusTrap = renderer.root
    .findAllByType('focus-trap')
    .find((node) => typeof node.props.focusTrapOptions?.setReturnFocus === 'function');

  if (!dialogFocusTrap) {
    throw new Error('Expected AI run dialog focus trap to be present');
  }

  return dialogFocusTrap.props.focusTrapOptions;
};

/** The value beside a reply-details row label. */
const rowValue = (renderer: ReactTestRenderer, label: string): string | undefined => {
  const cells = renderer.root.findAll(
    (node) => node.type === 'span' && (node.props.as === 'dt' || node.props.as === 'dd')
  );
  const term = cells.findIndex(
    (node) => node.props.as === 'dt' && node.children.join('') === label
  );
  return term < 0 ? undefined : cells[term + 1]?.children.join('');
};

const hasNodeTitle = (renderer: ReactTestRenderer, title: string): boolean =>
  renderer.root.findAll((node) => node.props.title === title).length > 0;

const openContextMenu = async (renderer: ReactTestRenderer) => {
  const menuButton = getButtonByIcon(renderer, 'VerticalDots');

  expect(menuButton).toBeDefined();

  await act(async () => {
    menuButton?.props.onClick({
      currentTarget: {
        parentElement: {
          parentElement: {
            getBoundingClientRect: () => ({
              x: 100,
              y: 200,
              width: 24,
              height: 24,
            }),
          },
        },
      },
    });
  });
};

const mindroomAiRunContent = {
  msgtype: 'm.text',
  body: 'hello',
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    run_id: 'run-123',
    session_id: 'session-456',
    model: {
      config: 'fast',
      provider: 'openai',
      id: 'gpt-5-mini',
    },
    usage: {
      input_tokens: 40,
      output_tokens: 2,
      total_tokens: 42,
      cache_read_tokens: 20,
      cache_write_tokens: 5,
      time_to_first_token: 0.042,
    },
    context: {
      input_tokens: 65,
      window_tokens: 100,
      cache_read_input_tokens: 20,
      cache_write_input_tokens: 5,
      uncached_input_tokens: 45,
    },
    tools: {
      count: 3,
    },
  },
} as const;

describe('Message local-echo actions', () => {
  it('hides every action that needs a confirmed server event id', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'pending root',
      },
      {
        eventId: '~!room:example.org:txn-root',
        serverActions: true,
      }
    );

    expect(getButtonByIcon(renderer, 'ReplyArrow')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'ThreadPlus')).toBeUndefined();
    expect(getButtonByIcon(renderer, 'SmilePlus')).toBeUndefined();

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Reply')).toBeUndefined();
    expect(getButtonByText(renderer, 'Reply in Thread')).toBeUndefined();
    expect(getButtonByText(renderer, 'Add Reaction')).toBeUndefined();
    expect(getButtonByText(renderer, 'Copy Link')).toBeUndefined();
    expect(getButtonByText(renderer, 'Pin Message')).toBeUndefined();
    expect(getButtonByText(renderer, 'Delete')).toBeUndefined();
    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    // Failed and pending local echoes are prime bug-report targets, so it is not server-gated.
    expect(getButtonByText(renderer, 'Report a bug')).toBeDefined();
  });

  it('keeps confirmed message actions available', async () => {
    const { renderer } = await renderMessage(
      {
        msgtype: 'm.text',
        body: 'confirmed root',
      },
      {
        serverActions: true,
      }
    );

    expect(getButtonByIcon(renderer, 'ReplyArrow')).toBeDefined();
    expect(getButtonByIcon(renderer, 'ThreadPlus')).toBeDefined();
    expect(getButtonByIcon(renderer, 'SmilePlus')).toBeDefined();
    // The hover toolbar's icons name themselves, as the menu items do.
    expect(getButtonByIcon(renderer, 'SmilePlus').props['aria-label']).toBe('Add Reaction');
    expect(getButtonByIcon(renderer, 'ReplyArrow').props['aria-label']).toBe('Reply');
    expect(getButtonByIcon(renderer, 'ThreadPlus').props['aria-label']).toBe('Reply in Thread');
    expect(getButtonByIcon(renderer, 'VerticalDots').props['aria-label']).toBe('More Options');

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Reply')).toBeDefined();
    expect(getButtonByText(renderer, 'Reply in Thread')).toBeDefined();
    expect(getButtonByText(renderer, 'Add Reaction')).toBeDefined();
    expect(getButtonByText(renderer, 'Copy Link')).toBeDefined();
    expect(getButtonByText(renderer, 'Pin Message')).toBeDefined();
    expect(getButtonByText(renderer, 'Delete')).toBeDefined();
  });
});

describe('Message reply details menu item', () => {
  it('does not render Reply details in the context menu for messages without ai_run metadata', async () => {
    const { renderer } = await renderMessage({
      msgtype: 'm.text',
      body: 'hello',
    });

    await openContextMenu(renderer);

    expect(hasSpanText(renderer, 'Reply details')).toBe(false);
  }, 10000);

  it('opens reply details from the context menu and configures explicit return focus', async () => {
    const { renderer, messageBaseNode } = await renderMessage(mindroomAiRunContent);
    const aiRunAvatars = renderer.root.findAll(
      (node) => node.type === 'div' && node.props['data-user-id'] === '@alice:example.org'
    );
    const aiRunAvatarStacks = renderer.root.findAll(
      (node) => node.type === 'div' && node.props.className === 'MessageAvatarWithModel'
    );

    expect(aiRunAvatars).toHaveLength(1);
    expect(aiRunAvatars[0]?.props.size).toBe(MESSAGE_AVATAR_SIZE);
    expect(aiRunAvatarStacks).toHaveLength(1);
    expect(aiRunAvatarStacks[0]?.findAll((node) => node === aiRunAvatars[0])).toHaveLength(1);
    expect(hasSpanText(renderer, 'Fast')).toBe(true);
    expect(hasNodeTitle(renderer, 'fast (openai / gpt-5-mini)')).toBe(true);
    expect(hasSpanText(renderer, 'Reply details')).toBe(false);

    await openContextMenu(renderer);

    const detailsButton = getButtonByText(renderer, 'Reply details');

    expect(detailsButton).toBeDefined();
    expect(detailsButton?.props['aria-pressed']).toBeUndefined();
    expect(messageBaseNode).toBeDefined();

    await act(async () => {
      detailsButton?.props.onClick();
    });

    expect(hasSpanText(renderer, 'Reply details')).toBe(true);
    expect(hasSpanText(renderer, 'Tokens')).toBe(true);
    expect(hasSpanText(renderer, '42')).toBe(true);
    expect(hasSpanText(renderer, 'Input')).toBe(true);
    expect(hasSpanText(renderer, 'Output')).toBe(true);
    const setReturnFocus = getDialogFocusTrapOptions(renderer).setReturnFocus as () =>
      | HostNodeMock
      | false;
    expect(messageBaseNode).toBeDefined();
    expect(setReturnFocus).toBeTypeOf('function');
  });

  it('keeps the header info button path opening the same reply details', async () => {
    const { renderer } = await renderMessage(mindroomAiRunContent, { collapse: false });

    const infoButton = getButtonByAriaLabel(renderer, 'Reply details');

    expect(infoButton).toBeDefined();

    await act(async () => {
      infoButton?.props.onClick();
    });

    expect(hasSpanText(renderer, 'Reply details')).toBe(true);
    expect(hasSpanText(renderer, 'openai · gpt-5-mini')).toBe(true);
    expect(hasSpanText(renderer, '65 of 100 · 65.0%')).toBe(true);
    expect(hasSpanText(renderer, '3 tool calls')).toBe(true);
    expect(hasSpanText(renderer, '42 ms')).toBe(true);
    expect(rowValue(renderer, 'Configured model')).toBe('fast');
    expect(rowValue(renderer, 'Run ID')).toBe('run-123');
    expect(rowValue(renderer, 'Session ID')).toBe('session-456');
  });
});

describe('Message copy text overflow integration', () => {
  it('copies the hydrated long-text body from the context menu', async () => {
    const longTextSource = {
      previewContent: {
        msgtype: 'm.file',
        body: 'Long text overflow…',
        url: 'mxc://mindroom/overflow',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
      mxcUri: 'mxc://mindroom/overflow',
      isV2ContentJson: true,
    };
    const resolvedLongTextContent = {
      msgtype: 'm.text',
      body: 'Resolved overflow body',
    };

    longTextMocks.getMindroomLongTextSource.mockReturnValue(longTextSource);
    longTextMocks.useMindroomLongTextResolvedContent.mockImplementation((source, enabled) => {
      const [resolvedContent, setResolvedContent] = React.useState<
        Record<string, unknown> | undefined
      >(() => undefined);

      React.useEffect(() => {
        if (!source || !enabled) {
          setResolvedContent(undefined);
          return;
        }

        void Promise.resolve().then(() => {
          setResolvedContent(resolvedLongTextContent);
        });
      }, [enabled, source]);

      return resolvedContent;
    });

    const { renderer } = await renderMessage({
      msgtype: 'm.file',
      body: 'Long text overflow…',
      url: 'mxc://mindroom/overflow',
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    });

    await openContextMenu(renderer);

    await act(async () => {
      await Promise.resolve();
    });

    const copyTextButton = getButtonByText(renderer, 'Copy Text');

    expect(copyTextButton).toBeDefined();

    await act(async () => {
      copyTextButton?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Resolved overflow body');
  });
});

describe('Message copy text tool markers', () => {
  const toolMarkerContent = {
    msgtype: 'm.text',
    body: 'Let me check.\n\n🔧 `search_web` [1]\n\nIt is sunny.',
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'search_web',
          args_preview: 'query=weather',
          result_preview: 'Sunny',
        },
      ],
    },
  };

  it('keeps markers the rendered HTML shows as text', async () => {
    const body = 'Markers look like this:\n\n```\n🔧 `search_web` [1]\n```';
    const { renderer } = await renderMessage({
      msgtype: 'm.text',
      body,
      format: 'org.matrix.custom.html',
      formatted_body:
        '<p>Markers look like this:</p>\n<pre><code>🔧 `search_web` [1]\n</code></pre>\n',
    });

    await openContextMenu(renderer);

    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(body);
  });

  it('copies the reply without tool markers from the primary action', async () => {
    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Let me check.\n\nIt is sunny.');
  });

  it('copies the reply with structured tool calls from the side action', async () => {
    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    const copyWithToolCallsButton = getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls');
    expect(copyWithToolCallsButton).toBeDefined();

    await act(async () => {
      copyWithToolCallsButton?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(
      [
        'Let me check.',
        '',
        '**🔧 Tool call 1**',
        '',
        '```',
        'search_web(query=weather)',
        '```',
        '',
        'Result:',
        '',
        '```',
        'Sunny',
        '```',
        '',
        'It is sunny.',
      ].join('\n')
    );
  });

  it('copies tool calls from the primary action when the reply has no other text', async () => {
    const { renderer } = await renderMessage({
      msgtype: 'm.text',
      body: '🔧 `shell` [1] ⏳',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'shell', args_preview: 'cmd=ls' }],
      },
    });

    await openContextMenu(renderer);

    // The side action would copy the same text, so it is not offered.
    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();

    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith(
      ['**🔧 Tool call 1 (running)**', '', '```', 'shell(cmd=ls)', '```'].join('\n')
    );
  });

  it('hides the side action while long text is still loading', async () => {
    longTextMocks.getMindroomLongTextSource.mockReturnValue({
      previewContent: toolMarkerContent,
      mxcUri: 'mxc://mindroom/overflow',
      isV2ContentJson: true,
    });

    const { renderer } = await renderMessage(toolMarkerContent);

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Copy Text (loading…)')).toBeDefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
  });

  it('copies the edited content the timeline resolved', async () => {
    const { renderer } = await renderMessage(
      { msgtype: 'm.text', body: 'original reply' },
      { resolvedMessageContent: toolMarkerContent }
    );

    await openContextMenu(renderer);

    await act(async () => {
      getButtonByText(renderer, 'Copy Text')?.props.onClick();
    });

    expect(domMocks.copyToClipboard).toHaveBeenCalledWith('Let me check.\n\nIt is sunny.');
  });

  it('shows a labelled tool-call row on touch screens', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: coarse'),
    }));
    try {
      const { renderer } = await renderMessage(toolMarkerContent);

      await openContextMenu(renderer);

      expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
      const labelledRow = getButtonByText(renderer, 'Copy Text with Tool Calls');
      expect(labelledRow).toBeDefined();

      await act(async () => {
        labelledRow?.props.onClick();
      });

      expect(domMocks.copyToClipboard).toHaveBeenCalledWith(
        expect.stringContaining('**🔧 Tool call 1**')
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hides the side action for replies without tool markers', async () => {
    const { renderer } = await renderMessage({ msgtype: 'm.text', body: 'plain reply' });

    await openContextMenu(renderer);

    expect(getButtonByText(renderer, 'Copy Text')).toBeDefined();
    expect(getButtonByAriaLabel(renderer, 'Copy Text with Tool Calls')).toBeUndefined();
  });
});
