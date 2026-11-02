/* eslint-disable react/prop-types */
import React, { createRef } from 'react';
import { Direction, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { act, create as baseCreate } from 'react-test-renderer';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  createDefaultThreadFilterState,
  cycleSortMode,
  resetThreadFilterState,
  updateThreadFilterKey,
} from '../roomThreadOverviewModel';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from '../threadOpenSeedCache';
import {
  createBackfillScheduler,
  createEnginePersistFacade,
  MindroomSyncEngineProvider,
  type MindroomSyncEngine,
} from '../../engine';
import type { useThreadAwareTimelineRefresh } from '../useThreadAwareTimelineRefresh';
import type { ScrollAnchorMemory } from '../../scroll/scrollAnchorMemory';

const {
  passthrough,
  scrollType,
  roomThreadOverviewType,
  roomIntroType,
  defaultPlaceholderType,
  compactPlaceholderType,
  directRoomState,
  aliveFn,
  reactionOrEditEventMock,
  inSameDayMock,
  timeDayMonthYearMock,
  isMembershipChangedMock,
  matrixClientMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  threadRenderStateMock,
  threadLastActivityTsMapMock,
  threadStreamingStateMock,
  threadResolutionMapMock,
  stateEventsByTypeMock,
  roomThreadListThreadsMock,
  ignoredUsersMock,
  roomUnreadState,
  scrollToItemMock,
  scrollToElementMock,
  retryPaginationMock,
  loadCachedRoomEventsBeforeMock,
  loadCachedRoomPaginationTokenMock,
  loadLatestCachedRoomEventsMock,
  loadCachedThreadSummariesMock,
  saveRoomEventsToCacheMock,
  saveCachedThreadSummaryMock,
  isTimelineAtLiveEndMock,
  virtualPaginatorState,
  roomTimelineVirtualizerState,
  settingsState,
} = vi.hoisted(() => ({
  passthrough: 'div',
  scrollType: 'room-timeline-scroll',
  roomThreadOverviewType: 'room-thread-overview',
  roomIntroType: 'room-intro',
  defaultPlaceholderType: 'default-placeholder',
  compactPlaceholderType: 'compact-placeholder',
  directRoomState: { value: false },
  aliveFn: () => true,
  reactionOrEditEventMock: vi.fn(() => false),
  inSameDayMock: vi.fn(() => true),
  timeDayMonthYearMock: vi.fn(() => 'time'),
  isMembershipChangedMock: vi.fn(() => false),
  matrixClientMock: {
    fetchRelations: vi.fn(),
    fetchRoomEvent: vi.fn(),
    getEventMapper: vi.fn(() => (rawEvent: unknown) => rawEvent),
    getEventTimeline: vi.fn(),
    getHomeserverUrl: vi.fn(() => 'https://example.org'),
    getRoom: vi.fn(() => null),
    getSafeUserId: vi.fn(() => '@alice:example.org'),
    getSyncState: vi.fn(() => 'SYNCING'),
    getThreadTimeline: vi.fn(),
    getUserId: vi.fn(() => '@alice:example.org'),
    on: vi.fn(),
    paginateEventTimeline: vi.fn(),
    processAggregatedTimelineEvents: vi.fn(),
    removeListener: vi.fn(),
    relations: vi.fn(),
  },
  navigateRoomMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
  threadRenderStateMock: {
    threadEventIndexMapRef: { current: new Map() },
    threadEvents: [],
    threadInitialRenderMode: 'live',
    setSupplementalThreadEvents: vi.fn(),
    resetThreadRenderState: vi.fn(),
  },
  threadLastActivityTsMapMock: new Map<string, number>(),
  threadStreamingStateMock: new Map<string, boolean>(),
  threadResolutionMapMock: new Map<
    string,
    { isResolved: boolean; tags: Record<string, unknown> | null }
  >(),
  stateEventsByTypeMock: new Map<string, unknown[]>(),
  roomThreadListThreadsMock: [] as Array<{ id?: string; rootEvent?: unknown }>,
  ignoredUsersMock: [] as string[],
  roomUnreadState: { value: false },
  scrollToItemMock: vi.fn(),
  scrollToElementMock: vi.fn(),
  retryPaginationMock: vi.fn(),
  loadCachedRoomEventsBeforeMock: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadCachedRoomPaginationTokenMock: vi.fn(async () => undefined),
  loadLatestCachedRoomEventsMock: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadCachedThreadSummariesMock: vi.fn(async () => new Map()),
  saveRoomEventsToCacheMock: vi.fn(async () => undefined),
  saveCachedThreadSummaryMock: vi.fn(async () => undefined),
  isTimelineAtLiveEndMock: vi.fn(() => true),
  settingsState: {
    prefetchDepth: 300,
  },
  virtualPaginatorState: {
    lastOptions: undefined as
      | {
          count: number;
          range: { start: number; end: number };
          onRangeChange: (range: { start: number; end: number }) => void;
          onEnd?: (backwards: boolean) => Promise<void> | void;
        }
      | undefined,
    callCount: 0,
    renderItems: true,
  },
  roomTimelineVirtualizerState: {
    lastOptions: undefined as
      | {
          count: number;
          estimateSize?: (index?: number) => number;
          getItemKey?: (index: number) => unknown;
          scrollMargin?: number;
        }
      | undefined,
    // Every options object passed to useVirtualizer, in render order.
    // `lastOptions` cannot pin FIRST-render values (later renders
    // overwrite it) — the stale-scrollMargin-on-switch pin needs the
    // first post-switch render specifically (mutant audit 2026-07-07,
    // survivor 7b). Tests that read it should reset it first.
    optionsHistory: [] as { count: number; scrollMargin?: number }[],
    virtualIndexes: undefined as number[] | undefined,
    totalSize: undefined as number | undefined,
    // The row at the reader's top. Like virtual-core's offset lookup, it
    // follows that row's index across renders; without it there is none.
    firstVisibleKey: undefined as unknown,
    // The mock instance of the current test tree (mutant audit 2026-07-07:
    // the drop-path pins call the component-installed
    // shouldAdjustScrollPositionOnItemSizeChange hook directly).
    lastInstance: undefined as Record<string, unknown> | undefined,
    measureElementMock: vi.fn(),
    scrollToIndexMock: vi.fn(),
    scrollToOffsetMock: vi.fn(),
    getOffsetForIndexMock: vi.fn(),
    setOptionsMock: vi.fn(),
  },
}));

const mountedRenderers = new Set<ReturnType<typeof baseCreate>>();
const create: typeof baseCreate = ((...args: Parameters<typeof baseCreate>) => {
  const renderer = baseCreate(...args);
  mountedRenderers.add(renderer);
  return renderer;
}) as typeof baseCreate;

vi.mock('../../messages/ThreadApprovalControls', () => ({ ApprovalHistory: () => null }));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Badge: passthrough,
    Box: passthrough,
    Chip: passthrough,
    ContainerColor: {},
    Icon: passthrough,
    Icons: {
      ArrowBottom: 'ArrowBottom',
      ArrowTop: 'ArrowTop',
      ChevronBottom: 'ChevronBottom',
      ChevronTop: 'ChevronTop',
      Code: 'Code',
      Search: 'Search',
    },
    Line: passthrough,
    Scroll: scrollType,
    Text: passthrough,
    as: () => passthrough,
    color: {
      ...actual.color,
      Success: {
        ...actual.color.Success,
        Main: '#0a0',
      },
      Warning: {
        ...actual.color.Warning,
        ContainerLine: '#aa0',
      },
    },
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S200: '8px',
        S400: '16px',
        S600: '24px',
        S700: '28px',
      },
    },
    toRem: (value: number) => `${value}rem`,
  };
});

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => matrixClientMock,
}));

vi.mock('../../../hooks/useAlive', () => ({
  useAlive: () => aliveFn,
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'messageLayout':
        return ['Compact'];
      case 'messageSpacing':
        return ['400'];
      case 'dateFormatString':
        return ['MMM D'];
      case 'prefetchDepth':
        return [settingsState.prefetchDepth];
      case 'prefetchScope':
        return ['my-server'];
      default:
        return [false];
    }
  },
}));

vi.mock('../../../state/settings', () => ({
  MessageLayout: {
    Compact: 'Compact',
    Bubble: 'Bubble',
    Modern: 'Modern',
  },
  settingsAtom: {},
}));

vi.mock('../../settings/mindroomSettings', () => ({
  mindroomSettingsAtom: {},
}));

vi.mock('../../../hooks/useRoom', () => ({
  useIsDirectRoom: () => directRoomState.value,
}));

vi.mock('../../../hooks/useIgnoredUsers', () => ({
  useIgnoredUsers: () => ignoredUsersMock,
}));

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: () => [],
    useSetAtom: () => vi.fn(),
  };
});

vi.mock('../../../hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/usePowerLevels')>()),
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set(),
}));

vi.mock('../../../hooks/useRoomCreatorsTag', () => ({
  useRoomCreatorsTag: () => [],
}));

vi.mock('../../../hooks/usePowerLevelTags', () => ({
  usePowerLevelTags: () => [],
}));

vi.mock('../../../hooks/useMemberPowerTag', () => ({
  useAccessiblePowerTagColors: () => ({}),
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ kind: 'light' }),
}));

vi.mock('../../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: () => true,
    event: () => true,
    stateEvent: () => true,
  }),
}));

vi.mock('../../../state/hooks/unread', () => ({
  useRoomUnread: () => roomUnreadState.value,
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
    navigateRoomThread: navigateRoomThreadMock,
  }),
}));

vi.mock('../../../hooks/useMentionClickHandler', () => ({
  useMentionClickHandler: () => vi.fn(),
}));

vi.mock('../../../hooks/useSpoilerClickHandler', () => ({
  useSpoilerClickHandler: () => vi.fn(),
}));

vi.mock('../../../state/hooks/userRoomProfile', () => ({
  useOpenUserRoomProfile: () => vi.fn(),
}));

vi.mock('../../../hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../../hooks/useImagePackRooms', () => ({
  useImagePackRooms: () => [],
}));

vi.mock('../../../hooks/useMemberEventParser', () => ({
  useMemberEventParser: () => () => undefined,
}));

vi.mock('../../../hooks/useVirtualPaginator', () => ({
  useVirtualPaginator: (options: {
    count: number;
    range: { start: number; end: number };
    onRangeChange: (range: { start: number; end: number }) => void;
  }) => {
    virtualPaginatorState.callCount += 1;
    virtualPaginatorState.lastOptions = options;
    return {
      getItems: () =>
        virtualPaginatorState.renderItems
          ? Array.from(
              { length: Math.max(options.range.end - options.range.start, 0) },
              (_, index) => options.range.start + index
            )
          : [],
      scrollToItem: scrollToItemMock,
      scrollToElement: scrollToElementMock,
      retryPagination: retryPaginationMock,
      observeBackAnchor: vi.fn(),
      observeFrontAnchor: vi.fn(),
    };
  },
}));

vi.mock('../../../components/virtualizer', () => ({
  VirtualTile: React.forwardRef<
    HTMLDivElement,
    {
      children?: React.ReactNode;
      style?: React.CSSProperties;
      virtualItem?: {
        index: number;
      };
    }
  >(({ children, style, virtualItem }, ref) =>
    // `style` passes through: the tile's inline `top` is the paint half
    // of the ledger contract (top = start + ledger px) and dropping it
    // left that term unpinnable (mutant audit 2026-07-07, survivor 14).
    React.createElement('div', { ref, 'data-virtual-index': virtualItem?.index, style }, children)
  ),
}));

vi.mock('@tanstack/react-virtual', () => {
  // The real useVirtualizer returns ONE stable instance for the component's
  // lifetime (useState-backed). The mock must match, otherwise effects that
  // list the virtualizer in their deps re-run on every render in tests but
  // not in production — which has already masked two real production bugs in
  // dep-gated timeline effects.
  // Keyed on the single shared harness state, so ALL useVirtualizer callers in
  // a test tree share one instance and one options ref. Safe while RoomTimeline
  // is the only consumer in these trees; a second consumer would silently
  // clobber __optionsRef each render — key per-consumer if that ever happens.
  const instances = new WeakMap<object, Record<string, unknown>>();
  return {
    useVirtualizer: (options: {
      count: number;
      estimateSize?: (index?: number) => number;
      getItemKey?: (index: number) => unknown;
      scrollMargin?: number;
    }) => {
      roomTimelineVirtualizerState.lastOptions = options;
      roomTimelineVirtualizerState.optionsHistory.push(options);
      const latestOptionsRef = { current: options };
      const key = roomTimelineVirtualizerState as unknown as object;
      let instance = instances.get(key) as
        | (Record<string, unknown> & { __optionsRef: { current: typeof options } })
        | undefined;
      if (instance) {
        instance.__optionsRef.current = options;
        instance.options = options;
        roomTimelineVirtualizerState.lastInstance = instance;
        return instance;
      }
      const optionsRef = latestOptionsRef;
      instance = {
        __optionsRef: optionsRef,
        // The real instance exposes mutable `options`, an in-place
        // `setOptions`, and a per-key measured-size Map; the ledger
        // settle calls setOptions({...options, scrollMargin: 0}) inside
        // its atomic block, and the old mock's missing setOptions threw
        // an ignored unhandled rejection on EVERY healthy settle — which
        // also made settle-ordering mutants pass by accident (mutant
        // audit 2026-07-07, harness wart + survivor 6a/6b).
        options,
        setOptions: (next: typeof options) => {
          roomTimelineVirtualizerState.setOptionsMock(next);
          instance!.options = next;
        },
        itemSizeCache: new Map(),
        getVirtualItemForOffset: (offset: number) => {
          const opts = optionsRef.current;
          const { firstVisibleKey } = roomTimelineVirtualizerState;
          if (firstVisibleKey === undefined) return undefined;
          for (let index = 0; index < opts.count; index += 1) {
            if ((opts.getItemKey?.(index) ?? index) === firstVisibleKey) {
              return { index, start: offset };
            }
          }
          return undefined;
        },
        getTotalSize: () => {
          const opts = optionsRef.current;
          const estimatedSize = opts.estimateSize?.() ?? 100;
          return roomTimelineVirtualizerState.totalSize ?? opts.count * estimatedSize;
        },
        getVirtualItems: () => {
          const opts = optionsRef.current;
          const estimatedSize = opts.estimateSize?.() ?? 100;
          const virtualIndexes =
            roomTimelineVirtualizerState.virtualIndexes ??
            Array.from({ length: opts.count }, (_value, index) => index);
          return virtualIndexes
            .filter((index) => index >= 0 && index < opts.count)
            .map((index) => ({
              end: (index + 1) * estimatedSize,
              index,
              key: opts.getItemKey?.(index) ?? index,
              lane: 0,
              size:
                (instance!.itemSizeCache as Map<unknown, number>).get(
                  opts.getItemKey?.(index) ?? index
                ) ??
                opts.estimateSize?.(index) ??
                100,
              start: index * estimatedSize,
            }));
        },
        measureElement: (node: Element | null) =>
          roomTimelineVirtualizerState.measureElementMock(node),
        // Mirrors virtual-core: a resized row keeps its new size in the size cache.
        resizeItem: (index: number, size: number) => {
          const opts = optionsRef.current;
          (instance!.itemSizeCache as Map<unknown, number>).set(
            opts.getItemKey?.(index) ?? index,
            size
          );
        },
        // virtual-core reads the row index from `data-index`; node mocks have none.
        indexFromElement: (node: Element) => {
          const value = node.getAttribute?.('data-index');
          const index = value == null ? Number.NaN : Number(value);
          return Number.isInteger(index) ? index : -1;
        },
        scrollToIndex: (...args: unknown[]) =>
          roomTimelineVirtualizerState.scrollToIndexMock(...args),
        scrollToOffset: (...args: unknown[]) =>
          roomTimelineVirtualizerState.scrollToOffsetMock(...args),
        // Mirrors virtual-core's [offset, align] tuple; the spy records the
        // call, the estimate math supplies a deterministic offset unless a
        // test overrides the spy's return value.
        getOffsetForIndex: (index: number, align?: string) => {
          const spied = roomTimelineVirtualizerState.getOffsetForIndexMock(index, align);
          if (spied !== undefined) return spied;
          const opts = optionsRef.current;
          const estimatedSize = opts.estimateSize?.() ?? 100;
          return [index * estimatedSize, align ?? 'start'] as const;
        },
      };
      instances.set(key, instance);
      roomTimelineVirtualizerState.lastInstance = instance;
      return instance;
    },
  };
});

vi.mock('../../../hooks/useMatrixEventRenderer', () => ({
  useMatrixEventRenderer:
    (
      typeToRenderer: Record<string, (...args: unknown[]) => React.ReactNode>,
      renderStateEvent?: (...args: unknown[]) => React.ReactNode,
      renderEvent?: (...args: unknown[]) => React.ReactNode
    ) =>
    (eventType: string, isStateEvent: boolean, ...args: unknown[]) => {
      const renderer = typeToRenderer[eventType];
      if (renderer) return renderer(...args);
      if (isStateEvent && renderStateEvent) return renderStateEvent(...args);
      if (!isStateEvent && renderEvent) return renderEvent(...args);
      return React.createElement('mock-event', {
        eventId: args[0],
        key: String(args[0]),
      });
    },
}));

vi.mock('../../../hooks/useIntersectionObserver', () => ({
  getIntersectionObserverEntry: () => undefined,
  useIntersectionObserver: vi.fn(),
}));

vi.mock('../../../hooks/useDebounce', () => ({
  useDebounce: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock('../../../hooks/useResizeObserver', () => ({
  getResizeObserverEntry: () => undefined,
  useResizeObserver: vi.fn(),
}));

vi.mock('../../../hooks/useDocumentFocusChange', () => ({
  useDocumentFocusChange: vi.fn(),
}));

vi.mock('../useStateEvents', () => ({
  useStateEvents: (_room: unknown, eventType: string) => stateEventsByTypeMock.get(eventType) ?? [],
}));
vi.mock('../usePinnedThreadEvents', () => ({ usePinnedThreadEvents: () => [] }));

vi.mock('../../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
    Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  };
});

vi.mock('../../../plugins/react-custom-html-parser', () => ({
  LINKIFY_OPTS: {},
  factoryRenderLinkifyWithMention: () => vi.fn(),
  getReactCustomHtmlParser: () => ({}),
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => null,
}));

vi.mock('../../../styles/CustomHtml.css', () => ({
  Code: 'Code',
}));

vi.mock('../../../features/room/RoomTimeline.css', () => ({
  TimelineFloat: () => 'TimelineFloat',
}));

vi.mock('../TimelineMinimap.css', () => ({
  MinimapContainer: 'MinimapContainer',
  MinimapBody: 'MinimapBody',
  MinimapRail: 'MinimapRail',
  MinimapStrip: {
    Rest: 'MinimapStripRest',
    Near: 'MinimapStripNear',
    Close: 'MinimapStripClose',
    Active: 'MinimapStripActive',
  },
  MinimapPreviewCard: 'MinimapPreviewCard',
  MinimapPreviewTitle: 'MinimapPreviewTitle',
  MinimapPreviewBody: 'MinimapPreviewBody',
}));

vi.mock('../../../utils/matrix', () => ({
  eventWithShortcode: (_packs: unknown, body: string) => body,
  factoryEventSentBy: () => false,
  getMxIdLocalPart: (userId: string) => userId,
}));

vi.mock('../../../utils/room', () => ({
  getStateEvent: () => undefined,
  canEditEvent: () => false,
  decryptAllTimelineEvent: vi.fn(),
  getEditedEvent: (_eventId: string, event: { __editedEvent?: unknown }) => event.__editedEvent,
  getEventReactions: () => undefined,
  getLatestMessageContent: (
    event?: { getContent?: () => Record<string, unknown> | undefined },
    editedEvent?: { getContent?: () => Record<string, unknown> | undefined }
  ) => editedEvent?.getContent?.() ?? event?.getContent?.(),
  getLatestEdit: (_target: unknown, edits: Array<{ getTs: () => number }>) =>
    edits.reduce((latest, edit) => (edit.getTs() >= latest.getTs() ? edit : latest), edits[0]),
  getLatestEditableEvt: () => undefined,
  getMemberDisplayName: () => 'Alice',
  getReactionContent: () => undefined,
  isHiddenReferenceEvent: () => false,
  isMembershipChanged: isMembershipChangedMock,
  logEditDebug: vi.fn(),
  reactionOrEditEvent: reactionOrEditEventMock,
  trimReplyFromBody: (body: string) => body,
}));

vi.mock('../../../components/message', () => ({
  DefaultPlaceholder: defaultPlaceholderType,
  CompactPlaceholder: compactPlaceholderType,
  Reply: passthrough,
  ThreadIndicator: passthrough,
  MessageBase: passthrough,
  MessageUnsupportedContent: passthrough,
  Time: passthrough,
  MessageNotDecryptedContent: passthrough,
  RedactedContent: passthrough,
  MSticker: passthrough,
  MindroomThreadSummaryCard: passthrough,
  ImageContent: passthrough,
  EventContent: passthrough,
}));

vi.mock('../ThreadIndicator', () => ({
  ThreadIndicator: passthrough,
}));

vi.mock('../../messages/MindroomThreadSummaryCard', () => ({
  MindroomThreadSummaryCard: passthrough,
}));

vi.mock('../../messages/MindroomThreadSummaryMarker.css', () => ({
  Marker: 'Marker',
  MarkerTrigger: 'MarkerTrigger',
  MarkerDetails: 'MarkerDetails',
}));

vi.mock('../../../features/room/message', () => ({
  Reactions: passthrough,
  Message: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement(
      passthrough,
      {
        ...props,
        eventId:
          typeof props['data-message-id'] === 'string' ? props['data-message-id'] : props.eventId,
      },
      children
    ),
  Event: passthrough,
  EncryptedContent: ({
    mEvent,
    children,
  }: {
    mEvent: {
      __renderInsideEncryptedContentAs?: string;
      getType: () => string;
    };
    children: (() => React.ReactNode) | React.ReactNode;
  }) => {
    if (typeof children !== 'function') return React.createElement(React.Fragment, null, children);

    const renderType = mEvent.__renderInsideEncryptedContentAs;
    if (!renderType) return React.createElement(React.Fragment, null, children());

    const getType = mEvent.getType;
    mEvent.getType = () => renderType;

    try {
      return React.createElement(React.Fragment, null, children());
    } finally {
      mEvent.getType = getType;
    }
  },
}));

vi.mock('../../../features/room/message/Reactions', () => ({
  Reactions: passthrough,
}));

vi.mock('../../../features/room/message/EncryptedContent', () => ({
  EncryptedContent: ({
    mEvent,
    children,
  }: {
    mEvent: {
      __renderInsideEncryptedContentAs?: string;
      getType: () => string;
    };
    children: (() => React.ReactNode) | React.ReactNode;
  }) => {
    if (typeof children !== 'function') return React.createElement(React.Fragment, null, children);

    const renderType = mEvent.__renderInsideEncryptedContentAs;
    if (!renderType) return React.createElement(React.Fragment, null, children());

    const getType = mEvent.getType;
    mEvent.getType = () => renderType;

    try {
      return React.createElement(React.Fragment, null, children());
    } finally {
      mEvent.getType = getType;
    }
  },
}));

vi.mock('../../messages/MindroomMessage', () => ({
  Message: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement(
      passthrough,
      {
        ...props,
        eventId:
          typeof props['data-message-id'] === 'string' ? props['data-message-id'] : props.eventId,
      },
      children
    ),
  Event: passthrough,
}));

vi.mock('../../../components/room-intro', () => ({
  RoomIntro: roomIntroType,
}));

vi.mock('../../../components/RenderMessageContent', () => ({
  RenderMessageContent: passthrough,
}));

vi.mock('../CollapsibleMessage', async () => {
  const ReactImport = await import('react');

  return {
    ExpandAllInitContext: ReactImport.createContext<boolean | undefined>(undefined),
    CollapsibleMessageStateProvider: passthrough,
    CollapsibleMessage: ({
      children,
      collapseMode = 'default',
    }: {
      children:
        | React.ReactNode
        | ((state: { expanded: boolean; loadFullContent: boolean }) => React.ReactNode);
      collapseMode?: string;
    }) =>
      ReactImport.createElement(
        passthrough,
        undefined,
        typeof children === 'function'
          ? children({ expanded: collapseMode !== 'default', loadFullContent: true })
          : children
      ),
  };
});

vi.mock('../../../components/media', () => ({
  Image: passthrough,
}));

vi.mock('../../../components/image-viewer', () => ({
  ImageViewer: passthrough,
}));

vi.mock('../../notifications/readReceipts', () => ({
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

vi.mock('../../../utils/dom', () => ({
  editableActiveElement: () => null,
  scrollToBottom: vi.fn(),
}));

vi.mock('../../../utils/time', () => ({
  inSameDay: inSameDayMock,
  minuteDifference: () => 0,
  timeDayMonthYear: timeDayMonthYearMock,
  today: () => false,
  yesterday: () => false,
}));

vi.mock('../../../components/editor', () => ({
  createMentionElement: () => ({}),
  isEmptyEditor: () => true,
  moveCursor: vi.fn(),
}));

vi.mock('../../../state/room/roomInputDrafts', () => ({
  roomIdToReplyDraftAtomFamily: () => ({}),
}));

vi.mock('../../../state/room/roomToParents', () => ({
  roomToParentsAtom: {},
}));

vi.mock('../../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../threadUtils', () => ({
  findThreadRootEvent: (room: { findEventById?: (id: string) => unknown }, id: string) =>
    room.findEventById?.(id),
  buildThreadParticipantMap: (
    events: Array<{
      getId(): string | undefined;
      threadRootId?: string;
      getSender?(): string | undefined;
      getRelation?(): { rel_type?: string } | null | undefined;
    }>,
    maxParticipants = 3
  ) => {
    const participants = new Map<string, string[]>();
    const seenEventIds = new Set<string>();
    const participantSets = new Map<string, Set<string>>();

    [...events].reverse().forEach((event) => {
      const eventId = event.getId();
      const { threadRootId } = event;
      if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
        return;
      }

      if (event.getRelation?.()?.rel_type === 'm.replace') return;

      seenEventIds.add(eventId);
      const senderId = event.getSender?.();
      if (!senderId) return;

      const threadParticipants = participants.get(threadRootId) ?? [];
      if (threadParticipants.length >= maxParticipants) return;

      const threadParticipantSet = participantSets.get(threadRootId) ?? new Set<string>();
      if (threadParticipantSet.has(senderId)) return;

      threadParticipantSet.add(senderId);
      participantSets.set(threadRootId, threadParticipantSet);
      participants.set(threadRootId, [...threadParticipants, senderId]);
    });

    return participants;
  },
  buildThreadReplyCountMap: (
    events: Array<{ getId(): string | undefined; threadRootId?: string }>
  ) => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      const eventId = event.getId();
      const { threadRootId } = event;
      if (!eventId || !threadRootId || eventId === threadRootId) return;
      counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
    });
    return counts;
  },
  buildVisibleThreadParticipantMap: (
    events: Array<{
      getId(): string | undefined;
      getSender?(): string | undefined;
      getType?(): string | undefined;
      threadRootId?: string;
    }>,
    maxParticipants = 3
  ) => {
    const participants = new Map<string, string[]>();
    [...events].reverse().forEach((event) => {
      const eventId = event.getId();
      const senderId = event.getSender?.();
      const { threadRootId } = event;
      if (
        !eventId ||
        !threadRootId ||
        eventId === threadRootId ||
        !senderId ||
        event.getType?.() === 'com.mindroom.thread.tag'
      ) {
        return;
      }
      const current = participants.get(threadRootId) ?? [];
      if (current.includes(senderId) || current.length >= maxParticipants) return;
      participants.set(threadRootId, [...current, senderId]);
    });
    return participants;
  },
  buildVisibleThreadReplyCountMap: (
    events: Array<{
      getId(): string | undefined;
      getType?(): string | undefined;
      threadRootId?: string;
    }>
  ) => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      const eventId = event.getId();
      const { threadRootId } = event;
      if (
        !eventId ||
        !threadRootId ||
        eventId === threadRootId ||
        event.getType?.() === 'com.mindroom.thread.tag'
      ) {
        return;
      }
      counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
    });
    return counts;
  },
  eventBelongsToThread: (
    event: { getId(): string | undefined; threadRootId?: string },
    threadId: string
  ) => event.getId() === threadId || event.threadRootId === threadId,
  isVisibleThreadTextMessageEventType: (eventType?: string) =>
    eventType === 'm.room.message' || eventType === 'm.room.encrypted',
  isVisibleThreadReplyEvent: (event: {
    getId(): string | undefined;
    getType?(): string | undefined;
    threadRootId?: string;
  }) => {
    const eventId = event.getId();
    return (
      !!eventId &&
      !!event.threadRootId &&
      eventId !== event.threadRootId &&
      event.getType?.() !== 'com.mindroom.thread.tag'
    );
  },
  getPreferredVisibleThreadReplyEvents: (
    thread:
      | {
          events?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
          timeline?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
        }
      | null
      | undefined
  ) => {
    const replyEvents = thread?.events?.length
      ? thread.events
      : thread?.timeline?.length
      ? thread.timeline
      : thread?.events ?? thread?.timeline ?? [];
    return replyEvents.filter(
      (event) =>
        !!event.getId() &&
        !!event.threadRootId &&
        event.getId() !== event.threadRootId &&
        event.getType?.() !== 'com.mindroom.thread.tag'
    );
  },
  getLatestRenderableVisibleThreadReplyEvent: (
    replyEvents: Array<{
      getContent?: () => Record<string, unknown> | undefined;
      getType?(): string | undefined;
    }>
  ) => {
    for (let i = replyEvents.length - 1; i >= 0; i -= 1) {
      const body = replyEvents[i].getContent?.()?.body;
      if (typeof body === 'string' && body.trim().length > 0) {
        return replyEvents[i];
      }
    }
    return undefined;
  },
  hasLoadedThreadReplyEvents: (
    thread:
      | {
          events?: unknown[];
          timeline?: unknown[];
        }
      | null
      | undefined
  ) => {
    if (thread?.events && thread.events.length > 0) return true;
    return !!thread?.timeline && thread.timeline.length > 0;
  },
  getVisibleThreadMessageCount: (
    thread:
      | {
          length?: number;
          events?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
          timeline?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
        }
      | null
      | undefined,
    fallbackMessageCount?: number
  ) => {
    const replyEvents = thread?.events?.length
      ? thread.events
      : thread?.timeline?.length
      ? thread.timeline
      : thread?.events ?? thread?.timeline ?? [];
    const visibleReplies = replyEvents.filter(
      (event) =>
        !!event.getId() &&
        !!event.threadRootId &&
        event.getId() !== event.threadRootId &&
        event.getType?.() !== 'com.mindroom.thread.tag'
    );
    if (visibleReplies.length > 0) return visibleReplies.length;
    if ((thread?.events?.length ?? 0) > 0 || (thread?.timeline?.length ?? 0) > 0) return 0;
    if (typeof thread?.length === 'number' && thread.length > 0) return thread.length;
    if (typeof fallbackMessageCount === 'number' && fallbackMessageCount > 0) {
      return fallbackMessageCount;
    }
    return 0;
  },
  getVisibleThreadEventBodyPreviewText: (
    event:
      | {
          getContent?: () => Record<string, unknown> | undefined;
        }
      | undefined
  ) => {
    const body = event?.getContent?.()?.body;
    return typeof body === 'string' && body.trim().length > 0 ? body.trim() : undefined;
  },
  getVisibleThreadParticipantIds: (
    thread:
      | {
          events?: Array<{
            getId(): string | undefined;
            getSender?(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
          timeline?: Array<{
            getId(): string | undefined;
            getSender?(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
        }
      | null
      | undefined,
    threadRootEvent?: { getSender?(): string | undefined },
    maxParticipants = 3
  ) => {
    const participantIds: string[] = [];
    const seenParticipantIds = new Set<string>();
    const replyEvents = thread?.events?.length
      ? thread.events
      : thread?.timeline?.length
      ? thread.timeline
      : thread?.events ?? thread?.timeline ?? [];

    for (
      let i = replyEvents.length - 1;
      i >= 0 && participantIds.length < maxParticipants;
      i -= 1
    ) {
      const event = replyEvents[i];
      const senderId = event.getSender?.();
      if (
        !event.getId() ||
        !event.threadRootId ||
        event.getId() === event.threadRootId ||
        event.getType?.() === 'com.mindroom.thread.tag' ||
        !senderId ||
        seenParticipantIds.has(senderId)
      ) {
        continue;
      }
      seenParticipantIds.add(senderId);
      participantIds.push(senderId);
    }

    const rootSenderId = threadRootEvent?.getSender?.();
    if (
      participantIds.length < maxParticipants &&
      rootSenderId &&
      !seenParticipantIds.has(rootSenderId)
    ) {
      participantIds.push(rootSenderId);
    }

    return participantIds;
  },
  isThreadReplyEvent: (eventId: string, threadRootId?: string) =>
    !!threadRootId && threadRootId !== eventId,
}));

vi.mock('../../messages/threadSummary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../messages/threadSummary')>();
  return {
    ...actual,
    buildThreadSummaryMap: () => new Map(),
    findLatestThreadSummaryEvent: () => undefined,
    getThreadSummaryEventInfo: () => undefined,
  };
});

vi.mock('../useThreadRenderState', () => ({
  useThreadRenderState: () => ({
    ...threadRenderStateMock,
    threadEventIndexMap: threadRenderStateMock.threadEventIndexMapRef.current,
  }),
}));

// CINNY-207 P2.3: eventRepository imports thread APIs directly from
// `./cacheStore` (the shim modules are gone), so the mock target is
// the cacheStore barrel. `loadLatestCachedThreadSummaryInfo` was dead
// code and is no longer exported.
vi.mock('../cacheStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cacheStore')>();
  const saveThreadEventsToCache = vi.fn(
    async (..._args: Parameters<typeof actual.saveThreadEventsToCache>) => undefined
  );
  return {
    ...actual,
    getThreadCursorAnchor: vi.fn((rawEvent?: { event_id?: string; origin_server_ts?: number }) =>
      rawEvent?.event_id
        ? {
            eventId: rawEvent.event_id,
            ts: rawEvent.origin_server_ts ?? 0,
          }
        : undefined
    ),
    loadCachedThreadEventsBefore: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
    loadLatestCachedThreadEvents: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
    loadLatestCachedThreadEventsBatch: vi.fn(
      async (_sessionId, _roomId, threadIds: string[]) =>
        new Map(threadIds.map((threadId) => [threadId, { events: [], hasMoreBefore: false }]))
    ),
    normalizeCachedThreadEvents: (events: unknown[]) => events,
    saveThreadEventsToCache,
    saveThreadEventsToCacheCommitted: vi.fn(
      async (...args: Parameters<typeof actual.saveThreadEventsToCacheCommitted>) => {
        await saveThreadEventsToCache(...args);
        return true;
      }
    ),
    loadCachedThreadSummaries: loadCachedThreadSummariesMock,
    saveCachedThreadSummary: saveCachedThreadSummaryMock,
    loadCachedRoomEventsBefore: loadCachedRoomEventsBeforeMock,
    loadCachedRoomPaginationToken: loadCachedRoomPaginationTokenMock,
    loadLatestCachedRoomEvents: loadLatestCachedRoomEventsMock,
    saveRoomEventsToCache: saveRoomEventsToCacheMock,
  };
});

vi.mock('../threadPaginationUtils', () => ({
  computeReconciliationToken: () => undefined,
  findEarliestLoadedThreadReplyByCacheOrder: () => undefined,
  reconcileThreadBackwardPagination: vi.fn(),
}));

vi.mock('../eventCacheTokenUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../eventCacheTokenUtils')>();
  return actual;
});

// CINNY-207 P2.3: legacy `threadSummaryCache` / `roomEventCache` shim
// mocks are folded into the `../cacheStore` mock above (single choke
// point).

vi.mock('../eventCacheEditUtils', () => ({
  aggregateCachedRelationEvents: vi.fn(),
  collectRedactedRelationTargetsFromLookup: vi.fn(() => []),
  hydrateCachedEvents: vi.fn(() => []),
  reconcileRelationEventsWithAggregation: vi.fn(),
  serializeEventsForCache: (
    _room: unknown,
    events: Array<{
      event?: Record<string, unknown>;
      getId?(): string | undefined;
      getTs?(): number;
      getContent?(): Record<string, unknown>;
    }>
  ) =>
    events.map(
      (event) =>
        event.event ?? {
          content: event.getContent?.() ?? {},
          event_id: event.getId?.(),
          origin_server_ts: event.getTs?.() ?? 0,
        }
    ),
}));

vi.mock('../timelineScrollUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../timelineScrollUtils')>();
  return {
    ...actual,
    isScrollNearBottom: () => true,
    isTimelineAtLiveEnd: isTimelineAtLiveEndMock,
    shouldAutoScrollRoomOnLiveEvent: () => false,
    shouldAutoScrollThreadOnLiveEvent: () => false,
  };
});

vi.mock('../threadEditBackfill', () => ({
  hasLikelyIncompleteStreamingBody: (value: unknown) =>
    typeof value === 'string' && /^thinking(?:\.{3}|…)(?:\s*⋯)?$/i.test(value.trim()),
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('../threadEditBackfill', () => ({
  hasLikelyIncompleteStreamingBody: (value: unknown) =>
    typeof value === 'string' && /^thinking(?:\.{3}|…)(?:\s*⋯)?$/i.test(value.trim()),
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('../RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
}));

vi.mock('../CompactRoomView', () => ({
  CompactRoomView: compactPlaceholderType,
}));

vi.mock('../useRoomThreadList', () => ({
  useRoomThreadList: (
    room: { getThreads?: () => Array<{ id?: string; rootEvent?: unknown }> } | undefined,
    enabled = true
  ) => ({
    threads: enabled
      ? roomThreadListThreadsMock.length > 0
        ? roomThreadListThreadsMock
        : room?.getThreads?.() ?? []
      : [],
  }),
}));

vi.mock('../useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: (_room: unknown, threadRootId: string) =>
    threadLastActivityTsMapMock.get(threadRootId) ?? 0,
  useThreadLastActivityTs: () => 0,
}));

vi.mock('../useThreadStreamingState', () => ({
  getThreadStreamingState: (_room: unknown, threadRootId: string) =>
    threadStreamingStateMock.get(threadRootId) ?? false,
  useThreadStreamingState: () => false,
}));

vi.mock('../useRoomThreadTags', () => ({
  useRoomThreadResolutionMap: () => threadResolutionMapMock,
}));

vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  removeEventListener: vi.fn(),
  matchMedia: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
  navigator: {
    platform: 'MacIntel',
  },
});

vi.stubGlobal('document', {
  hasFocus: () => true,
});

vi.stubGlobal('navigator', {
  platform: 'MacIntel',
});

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});

vi.stubGlobal('cancelAnimationFrame', vi.fn());

vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingTop: '0px' }));

const makeEvent = (
  eventId: string,
  opts: {
    sender?: string;
    ts?: number;
    type?: string;
    content?: Record<string, unknown>;
    isThreadRoot?: boolean;
    threadRootId?: string;
    relation?: { rel_type?: string; event_id?: string };
    renderInsideEncryptedContentAs?: string;
    associatedId?: string;
    stateKey?: string;
    unsigned?: Record<string, unknown>;
    isRedacted?: boolean;
    isRedaction?: boolean;
    isSending?: boolean;
    txnId?: string;
  } = {}
) => {
  let unsigned: Record<string, unknown> = opts.unsigned ?? {};
  return {
    __renderInsideEncryptedContentAs: opts.renderInsideEncryptedContentAs,
    event: { event_id: eventId, origin_server_ts: opts.ts ?? 0 },
    isThreadRoot: opts.isThreadRoot ?? false,
    threadRootId: opts.threadRootId,
    getAssociatedId: () => opts.associatedId,
    getContent: () => opts.content ?? { body: eventId },
    getOriginalContent: () => opts.content ?? { body: eventId },
    getId: () => eventId,
    getRelation: () => opts.relation,
    getRedactionEvent: () => undefined,
    getRoomId: () => '!room:example.org',
    getSender: () => opts.sender ?? '@alice:example.org',
    getServerAggregatedRelation: () => undefined,
    getStateKey: () => opts.stateKey,
    getTs: () => opts.ts ?? 0,
    getTxnId: () => opts.txnId,
    getType: () => opts.type ?? 'm.room.message',
    isEncrypted: () => opts.type === 'm.room.encrypted',
    getUnsigned: () => unsigned,
    setUnsigned: (next: Record<string, unknown>) => {
      unsigned = next;
    },
    isSending: () => opts.isSending ?? false,
    isRedacted: () => opts.isRedacted ?? false,
    isRedaction: () => opts.isRedaction ?? false,
    makeRedacted: vi.fn(),
    makeReplaced: vi.fn(),
    replacingEvent: () => undefined,
  };
};

const makeCachedRoomEvent = (eventId: string, ts = 0) => ({
  event_id: eventId,
  origin_server_ts: ts,
});

const makeTimeline = (
  events: ReturnType<typeof makeEvent>[] = [],
  opts: {
    backwardToken?: string | null;
    forwardToken?: string | null;
  } = {}
) => {
  const paginationTokens = {
    backward: opts.backwardToken ?? null,
    forward: opts.forwardToken ?? null,
  };

  return {
    __paginationTokens: paginationTokens,
    getEvents: () => events,
    getNeighbouringTimeline: () => null,
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? paginationTokens.backward : paginationTokens.forward,
    getRoomId: () => '!room:example.org',
    setPaginationToken: vi.fn((token: string | null, direction: Direction) => {
      if (direction === Direction.Backward) {
        paginationTokens.backward = token;
        return;
      }
      paginationTokens.forward = token;
    }),
  };
};

const makeRoom = ({
  liveEvents = [],
  liveTimeline,
  timelinesByEventId = new Map<string, ReturnType<typeof makeTimeline>>(),
  findEventById,
  threads = [],
}: {
  liveEvents?: ReturnType<typeof makeEvent>[];
  liveTimeline?: ReturnType<typeof makeTimeline>;
  timelinesByEventId?: Map<string, ReturnType<typeof makeTimeline>>;
  findEventById?: (eventId: string) => ReturnType<typeof makeEvent> | undefined;
  threads?: Array<{ id?: string; rootEvent?: ReturnType<typeof makeEvent> | undefined }>;
} = {}) => {
  const roomLiveTimeline = liveTimeline ?? makeTimeline(liveEvents);
  const currentLiveEvents = roomLiveTimeline.getEvents();
  const getEventFromTimelines = (eventId: string) =>
    currentLiveEvents.find((event) => event.getId() === eventId) ??
    Array.from(timelinesByEventId.values())
      .flatMap((timeline) => timeline.getEvents())
      .find((event) => event.getId() === eventId);
  const timelineSet = {
    getLiveTimeline: () => roomLiveTimeline,
    getTimelineForEvent: (eventId: string) =>
      currentLiveEvents.some((event) => event.getId() === eventId)
        ? roomLiveTimeline
        : timelinesByEventId.get(eventId),
  };
  (
    roomLiveTimeline as ReturnType<typeof makeTimeline> & {
      getTimelineSet?: () => typeof timelineSet;
    }
  ).getTimelineSet = () => timelineSet;
  timelinesByEventId.forEach((timeline) => {
    (
      timeline as ReturnType<typeof makeTimeline> & {
        getTimelineSet?: () => typeof timelineSet;
      }
    ).getTimelineSet = () => timelineSet;
  });
  const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
  const createThread = vi.fn(
    (
      threadId: string,
      rootEvent: ReturnType<typeof makeEvent> | undefined,
      events: ReturnType<typeof makeEvent>[] = []
    ) => {
      const existingThread = threads.find((thread) => thread.id === threadId);
      if (existingThread) return existingThread;

      const threadEvents = [...events];
      const threadLiveTimeline = makeTimeline(threadEvents);
      const threadTimelineSet = {
        addEventsToTimeline: (
          incoming: ReturnType<typeof makeEvent>[],
          _backwards: boolean,
          _state: boolean,
          timeline: ReturnType<typeof makeTimeline>,
          token: string | null
        ) => {
          incoming.forEach((event) => {
            if (!threadEvents.some((existing) => existing.getId() === event.getId()))
              threadEvents.unshift(event);
          });
          timeline.setPaginationToken(token, Direction.Backward);
        },
        getLiveTimeline: () => threadLiveTimeline,
        getTimelines: () => [threadLiveTimeline],
        getTimelineForEvent: (eventId: string) =>
          threadEvents.some((event) => event.getId() === eventId) ? threadLiveTimeline : undefined,
      };
      Object.assign(threadLiveTimeline, { getTimelineSet: () => threadTimelineSet });
      const thread = {
        id: threadId,
        rootEvent,
        events: threadEvents,
        initialEventsFetched: false,
        initialize: vi.fn(() => undefined),
        replayEvents: [] as ReturnType<typeof makeEvent>[] | null,
        timeline: threadEvents,
        get length() {
          return threadEvents.length;
        },
        setEventMetadata: vi.fn(),
        flushPendingTimelineReset: vi.fn(),
        addEvents: vi.fn((newEvents: ReturnType<typeof makeEvent>[], toStart: boolean) => {
          if (toStart) {
            threadEvents.unshift(...newEvents);
            return;
          }
          threadEvents.push(...newEvents);
        }),
        getUnfilteredTimelineSet: () => threadTimelineSet,
        lastReply: () => threadEvents.at(-1) ?? null,
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      threads.push(thread);
      return thread;
    }
  );

  return {
    __listeners: listeners,
    addEventsToTimeline: vi.fn(),
    addLiveEvents: vi.fn(async (events: ReturnType<typeof makeEvent>[]) => {
      currentLiveEvents.push(...events);
    }),
    createThread,
    roomId: '!room:example.org',
    client: {
      getUserId: () => '@alice:example.org',
    },
    findEventById: findEventById ?? ((eventId: string) => getEventFromTimelines(eventId)),
    getEventReadUpTo: () => undefined,
    getLiveTimeline: () => roomLiveTimeline,
    getMember: (userId: string) => ({ name: userId }),
    getThread: (threadId: string) => threads.find((thread) => thread.id === threadId) ?? null,
    getThreads: () => threads,
    getUnfilteredTimelineSet: () => timelineSet,
    hasEncryptionStateEvent: () => false,
    partitionThreadedEvents: (events: ReturnType<typeof makeEvent>[]) => [events, [], []],
    processThreadRoots: vi.fn(),
    relations: {
      aggregateChildEvent: vi.fn(),
    },
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
    }),
    removeListener: vi.fn((event) => {
      listeners.delete(event);
    }),
  };
};

const flushAsyncWork = async (cycles = 5) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

const waitForCondition = async (condition: () => boolean, cycles = 500) => {
  for (let index = 0; index < cycles; index += 1) {
    if (condition()) return;
    await flushAsyncWork(1);
  }

  throw new Error('Condition not reached in time');
};

const emitClientSync = (current = 'SYNCING', previous = 'SYNCING') => {
  const syncHandler = matrixClientMock.on.mock.calls.find(([event]) => event === 'sync')?.[1] as
    | ((currentState: string, previousState: string) => void)
    | undefined;
  syncHandler?.(current, previous);
};

beforeEach(() => {
  vi.clearAllMocks();
  clearThreadOpenSeedSnapshotsForTests();
  threadRenderStateMock.threadEventIndexMapRef.current = new Map();
  threadRenderStateMock.threadEvents = [];
  threadRenderStateMock.threadInitialRenderMode = 'live';
  threadLastActivityTsMapMock.clear();
  threadStreamingStateMock.clear();
  threadResolutionMapMock.clear();
  stateEventsByTypeMock.clear();
  roomThreadListThreadsMock.length = 0;
  directRoomState.value = false;
  ignoredUsersMock.length = 0;
  roomUnreadState.value = false;
  scrollToItemMock.mockReturnValue(false);
  scrollToElementMock.mockReturnValue(false);
  retryPaginationMock.mockReset();
  matrixClientMock.getEventMapper.mockImplementation(() => (rawEvent: unknown) => {
    const event = rawEvent as {
      content?: Record<string, unknown>;
      event_id?: string;
      origin_server_ts?: number;
    };

    return typeof event?.event_id === 'string'
      ? makeEvent(event.event_id, {
          content: event.content,
          ts: event.origin_server_ts ?? 0,
        })
      : rawEvent;
  });
  loadCachedRoomEventsBeforeMock.mockResolvedValue({ events: [], hasMoreBefore: false });
  loadCachedRoomPaginationTokenMock.mockResolvedValue(undefined);
  loadLatestCachedRoomEventsMock.mockResolvedValue({ events: [], hasMoreBefore: false });
  loadCachedThreadSummariesMock.mockResolvedValue(new Map());
  saveRoomEventsToCacheMock.mockResolvedValue(undefined);
  saveCachedThreadSummaryMock.mockResolvedValue(undefined);
  settingsState.prefetchDepth = 300;
  virtualPaginatorState.lastOptions = undefined;
  virtualPaginatorState.callCount = 0;
  virtualPaginatorState.renderItems = true;
  roomTimelineVirtualizerState.lastOptions = undefined;
  roomTimelineVirtualizerState.virtualIndexes = undefined;
  roomTimelineVirtualizerState.totalSize = undefined;
  roomTimelineVirtualizerState.firstVisibleKey = undefined;
  roomTimelineVirtualizerState.measureElementMock.mockClear();
  roomTimelineVirtualizerState.scrollToIndexMock.mockClear();
  roomTimelineVirtualizerState.scrollToOffsetMock.mockClear();
  isTimelineAtLiveEndMock.mockReturnValue(true);
  reactionOrEditEventMock.mockImplementation(() => false);
  isMembershipChangedMock.mockImplementation(() => false);
  matrixClientMock.fetchRelations.mockResolvedValue({
    chunk: [],
    next_batch: null,
  });
  navigateRoomMock.mockReset();
  navigateRoomThreadMock.mockReset();
  matrixClientMock.getEventTimeline.mockResolvedValue(undefined);
  matrixClientMock.fetchRoomEvent.mockReset();
  matrixClientMock.fetchRoomEvent.mockResolvedValue({});
  matrixClientMock.getSyncState.mockReturnValue('SYNCING');
  matrixClientMock.getThreadTimeline.mockResolvedValue(undefined);
  matrixClientMock.on.mockReset();
  matrixClientMock.paginateEventTimeline.mockResolvedValue(false);
  matrixClientMock.removeListener.mockReset();
});

afterEach(() => {
  mountedRenderers.forEach((renderer) => renderer.unmount());
  mountedRenderers.clear();
});
let useThreadAwareTimelineRefreshHook: typeof useThreadAwareTimelineRefresh | undefined;

type TimelineRefreshHarnessProps = {
  room: ReturnType<typeof makeRoom>;
  threadId?: string;
  liveTimelineLinked: boolean;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  onRoomRefresh: () => void;
};

const TimelineRefreshHarness = ({
  room,
  threadId,
  liveTimelineLinked,
  refreshLatestThreadSlice,
  onRoomRefresh,
}: TimelineRefreshHarnessProps) => {
  useThreadAwareTimelineRefreshHook?.({
    room: room as never,
    threadId,
    liveTimelineLinked,
    refreshLatestThreadSlice,
    onRoomRefresh,
  });

  return null;
};

const getClickableByText = (renderer: ReturnType<typeof create>, text: string) => {
  const hasTextDescendant = (node: { children: unknown[] }): boolean =>
    node.children.some((child) => {
      if (child === text) return true;
      if (typeof child === 'string') return false;
      return hasTextDescendant(child as { children: unknown[] });
    });

  const clickable = renderer.root.find((node) => {
    if (typeof node.props.onClick !== 'function') return false;

    return hasTextDescendant(node as unknown as { children: unknown[] });
  });

  return clickable;
};

const getRenderedEventIds = (renderer: ReturnType<typeof create>): string[] =>
  Array.from(
    new Set(
      renderer.root
        .findAll(
          (node) =>
            node.type === ('mock-event' as never) ||
            typeof node.props['data-message-id'] === 'string'
        )
        .map((node) =>
          typeof node.props['data-message-id'] === 'string'
            ? node.props['data-message-id']
            : node.props.eventId
        )
    )
  );

const DEFAULT_THREAD_FILTER_STATE = createDefaultThreadFilterState();
const TEST_DEFAULT_THREAD_FILTER_STATE = {
  // Most room-surface assertions in this file are about the normal timeline, not overview sorting.
  ...DEFAULT_THREAD_FILTER_STATE,
  sortBy: 'natural' as const,
  sortDirection: 'desc' as const,
  tags: new Map(),
};

const threadFilterStateFromLegacy = (
  filter?: 'all' | 'resolved' | 'unresolved' | 'unread'
): import('../roomThreadOverviewModel').ThreadFilterState => {
  switch (filter) {
    case 'resolved':
      return {
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        resolved: 'include' as const,
        tags: new Map(),
      };
    case 'unresolved':
      return {
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        resolved: 'exclude' as const,
        tags: new Map(),
      };
    case 'unread':
      return {
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        unread: 'include' as const,
        tags: new Map(),
      };
    default:
      return {
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        tags: new Map(),
      };
  }
};

// CINNY-207 P3.3: shared stub sync engine wired to the real persist
// facade. `useMindroomSyncEngine` inside RoomTimeline consumers
// resolves to this object, so persist calls flow through the real
// `persist*Snapshot` seams and hit the already-mocked
// `save…ToCache` fns. Only `persist` is exercised by these tests
// (the real client-level engine and its listeners live under
// ClientRoot, out of scope here).
const HARNESS_TEST_SESSION_ID = 'test-session';
const harnessSyncEngine: MindroomSyncEngine = {
  offline: {} as MindroomSyncEngine['offline'],
  clearRoomFocus: () => undefined,
  backgroundPageAllowance: () => 200,
  mx: matrixClientMock as unknown as MindroomSyncEngine['mx'],
  sessionId: HARNESS_TEST_SESSION_ID,
  start: () => undefined,
  stop: () => undefined,
  isLiveMode: () => true,
  persist: createEnginePersistFacade({ sessionId: HARNESS_TEST_SESSION_ID }),
  // CINNY-207 P4.1: harness gets a real (empty) scheduler so consumers
  // that reach for `engine.scheduler.enqueue(...)` in future phases don't
  // trip a type error here. No mx handoff is required — the scheduler
  // is only exercised end-to-end in dedicated tests.
  scheduler: createBackfillScheduler(),
  // CINNY-207 P4.2: harness needs a callable no-op so consumers wired
  // to `engine.noteRoomFocused(...)` don't blow up. The mock cacheStore
  // in the harness would ignore the writes anyway.
  noteRoomFocused: () => undefined,
  subscribeRoomRecovery: () => () => undefined,
};

// Pass children as a prop rather than positionally: this file is .ts, not
// .tsx, so avoiding JSX keeps its import shape unchanged.
const wrapWithSyncEngine = (element: React.ReactElement): React.ReactElement => {
  const props = { engine: harnessSyncEngine, children: element };
  return React.createElement(MindroomSyncEngineProvider, props);
};

const createControlledRoomTimelineHarness = (
  RoomTimelineComponent: (props: Record<string, unknown>) => React.ReactElement | null
) => {
  const roomInputRef = createRef<HTMLElement>();
  const compactRoomScrollStateRef: { current: ScrollAnchorMemory } = { current: new Map() };
  const editor = {} as Editor;
  const defaultSummaryMap = new Map();
  const defaultOnStoreThreadSummary = vi.fn();

  return function ControlledRoomTimelineHarness({
    room,
    eventId,
    focusEventInRoom,
    threadId,
    summaryMap = defaultSummaryMap,
    onStoreThreadSummary = defaultOnStoreThreadSummary,
    initialThreadFilter,
    initialThreadFilterState,
    initialViewMode = 'threaded',
    initialThreadSortFrozen = false,
  }: {
    room: ReturnType<typeof makeRoom>;
    eventId?: string;
    focusEventInRoom?: boolean;
    threadId?: string;
    summaryMap?: Map<string, unknown>;
    onStoreThreadSummary?: (threadRootId: string, info?: unknown) => void;
    initialThreadFilter?: 'all' | 'resolved' | 'unresolved' | 'unread';
    initialThreadFilterState?: import('../roomThreadOverviewModel').ThreadFilterState;
    initialViewMode?: 'threaded' | 'compact' | 'classic';
    initialThreadSortFrozen?: boolean;
  }) {
    const [threadFilterState, setThreadFilterState] = React.useState<
      import('../roomThreadOverviewModel').ThreadFilterState
    >(initialThreadFilterState ?? threadFilterStateFromLegacy(initialThreadFilter));
    const [viewMode, setViewMode] = React.useState<'threaded' | 'compact' | 'classic'>(
      initialViewMode
    );
    const [threadSortFreezeState, setThreadSortFreezeState] = React.useState<
      import('../roomThreadOverviewModel').ThreadSortFreezeState | null
    >(
      initialThreadSortFrozen
        ? {
            controlSignature: null,
            orderedRootIds: [],
          }
        : null
    );

    const onToggle = React.useCallback(
      (key: 'resolved' | 'streaming' | 'scheduled' | 'unread' | 'idle') => {
        setThreadFilterState((prev) => updateThreadFilterKey(prev, key));
      },
      []
    );

    const onSortDirectionChange = React.useCallback(() => {
      setThreadFilterState((prev) => {
        return { ...prev, ...cycleSortMode(prev) };
      });
    }, []);

    const onReset = React.useCallback(() => {
      setThreadFilterState(resetThreadFilterState());
    }, []);

    const onToggleThreadSortFreeze = React.useCallback(() => {
      setThreadSortFreezeState((currentState) =>
        currentState
          ? null
          : {
              controlSignature: null,
              orderedRootIds: [],
            }
      );
    }, []);

    // CINNY-207 P3.3: the room timeline consumes the persist facade
    // off `useMindroomSyncEngine`. Wrap the harness with a stub engine
    // provider so tests exercise the real persist snapshot seams
    // (which delegate to the already-mocked `save…ToCache` fns) without
    // requiring a full ClientRoot mount.
    // eslint-disable-next-line react/no-children-prop
    return React.createElement(MindroomSyncEngineProvider, {
      engine: harnessSyncEngine,
      children: React.createElement(RoomTimelineComponent, {
        room,
        eventId,
        focusEventInRoom,
        threadId,
        summaryMap,
        onStoreThreadSummary,
        threadFilterState,
        threadSortFreezeState,
        onToggle,
        onSortDirectionChange,
        onToggleThreadSortFreeze,
        setThreadSortFreezeState,
        onCycleTag: vi.fn(),
        onAddTag: vi.fn(),
        onRemoveTag: vi.fn(),
        onReset,
        viewMode,
        onViewModeChange: setViewMode,
        roomInputRef,
        compactRoomScrollStateRef,
        editor,
      }),
    });
  };
};

const setThreadAwareTimelineRefreshHook = (
  hook: typeof useThreadAwareTimelineRefresh | undefined
) => {
  useThreadAwareTimelineRefreshHook = hook;
};

export {
  React,
  Direction,
  RoomEvent,
  ThreadEvent,
  act,
  create,
  compactPlaceholderType,
  createControlledRoomTimelineHarness,
  DEFAULT_THREAD_FILTER_STATE,
  directRoomState,
  emitClientSync,
  flushAsyncWork,
  getClickableByText,
  getRenderedEventIds,
  getThreadOpenSeedSnapshot,
  ignoredUsersMock,
  isMembershipChangedMock,
  loadCachedRoomEventsBeforeMock,
  loadCachedRoomPaginationTokenMock,
  loadCachedThreadSummariesMock,
  loadLatestCachedRoomEventsMock,
  makeCachedRoomEvent,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  reactionOrEditEventMock,
  inSameDayMock,
  timeDayMonthYearMock,
  roomIntroType,
  roomThreadListThreadsMock,
  roomThreadOverviewType,
  roomUnreadState,
  saveRoomEventsToCacheMock,
  saveThreadOpenSeedSnapshot,
  scrollToItemMock,
  scrollType,
  setThreadAwareTimelineRefreshHook,
  settingsState,
  stateEventsByTypeMock,
  TEST_DEFAULT_THREAD_FILTER_STATE,
  threadLastActivityTsMapMock,
  threadStreamingStateMock,
  threadRenderStateMock,
  threadResolutionMapMock,
  TimelineRefreshHarness,
  roomTimelineVirtualizerState,
  virtualPaginatorState,
  waitForCondition,
  wrapWithSyncEngine,
  isTimelineAtLiveEndMock,
};
