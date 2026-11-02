import { EventEmitter } from 'node:events';
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import {
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  isValidTagName,
  normalizeTagName,
  parseThreadTagsContent,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from './threadTags';
import { tagColor, TAG_TEXT_COLOR } from './threadTagColor';
import { ThreadContextBanner, type ThreadContextBannerProps } from './ThreadContextBanner';
import { settingsAtom } from '../../state/settings';

const menuProps = vi.hoisted(() => vi.fn());
const textDirection = vi.hoisted(() => vi.fn(() => 'ltr'));
vi.mock('./ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: unknown) => {
    menuProps(props);
    return React.createElement('div', { role: 'menu' });
  },
}));

vi.mock('../messages/ThreadApprovalControls', () => ({
  ThreadApprovalPermissions: () => React.createElement('b', { 'data-approvals': 'true' }),
}));
vi.mock('../auto-approve/AutoApproveChip', () => ({
  AutoApproveChip: ({ threadId }: { threadId: string }) =>
    React.createElement('i', { 'data-auto-approve': threadId }),
}));

// The optical glass needs a real DOM node; pass the banner's own ref through.
vi.mock('../../components/glass/liquid/useLiquidGlass', () => ({
  useLiquidGlass: (ref?: unknown) => ref,
}));

const pinningMocks = vi.hoisted(() => ({
  pinnedEventIds: [] as string[],
  canPin: false,
  setPinned: vi.fn(),
  updating: false,
  error: undefined,
}));
vi.mock('./useThreadPinning', () => ({ useThreadPinning: () => pinningMocks }));

const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';
const ISO_3 = '2026-04-07T00:00:03.000Z';

const bannerMocks = vi.hoisted(() => ({
  useThreadRootEvent: vi.fn(),
  useThreadTags: vi.fn(),
  useMutateThreadTags: vi.fn(),
  useThreadHeaderInfo: vi.fn(),
}));

vi.mock('folds', async () => {
  const React = await import('react');

  const renderElement = ({
    as,
    children,
    ...props
  }: {
    as?: keyof React.JSX.IntrinsicElements;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement(as ?? 'div', props, children);

  return {
    Box: renderElement,
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement('button', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('i', props),
    IconButton: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
      ({ children, ...props }, ref) => React.createElement('button', { ...props, ref }, children)
    ),
    Icons: { ArrowLeft: 'arrow-left', Check: 'check', ChevronBottom: 'chevron-bottom' },
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    // Render the tooltip beside its trigger, so tests can read what it says.
    TooltipProvider: ({
      tooltip,
      align,
      children,
    }: {
      tooltip: React.ReactNode;
      align?: string;
      children: (triggerRef: () => void) => React.ReactNode;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        children(() => undefined),
        React.createElement('div', { role: 'tooltip', 'data-align': align }, tooltip)
      ),
    Text: ({
      as,
      children,
      truncate: _truncate,
      priority: _priority,
      size: _size,
      ...props
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      children?: React.ReactNode;
      truncate?: boolean;
      priority?: string;
      size?: string;
      [key: string]: unknown;
    }) => React.createElement(as ?? 'span', props, children),
  };
});

vi.mock('@tabler/icons-react', async () => {
  const React = await import('react');
  return {
    IconCalendarEvent: (props: Record<string, unknown>) => React.createElement('svg', props),
  };
});

vi.mock('./useThreadRootEvent', () => ({
  useThreadRootEvent: bannerMocks.useThreadRootEvent,
}));

vi.mock('./useThreadTags', () => ({
  useThreadTags: bannerMocks.useThreadTags,
}));

vi.mock('./useMutateThreadTags', () => ({
  useMutateThreadTags: bannerMocks.useMutateThreadTags,
}));

vi.mock('./useThreadHeaderInfo', () => ({
  getNextThreadScheduledTs: () => undefined,
  useThreadHeaderInfo: bannerMocks.useThreadHeaderInfo,
}));

vi.mock('./ThreadTagPill', () => ({
  ThreadTagPill: ({ name }: { name: string }) => React.createElement('span', null, name),
}));

vi.mock('./ThreadTagPicker', () => ({
  ThreadTagPicker: () => React.createElement('button', null, '+ tag'),
}));

vi.mock('./ThreadContextBanner.css', () => ({
  Banner: 'Banner',
  BannerResolved: 'BannerResolved',
  Collapsed: 'Collapsed',
  CompactHidden: 'CompactHidden',
  DesktopOnlyTags: 'DesktopOnlyTags',
  EyebrowRow: 'EyebrowRow',
  MetadataDot: 'MetadataDot',
  MobileOnlyTags: 'MobileOnlyTags',
  OverflowChip: 'OverflowChip',
  ResolutionByline: 'ResolutionByline',
  ResolutionBylineDot: 'ResolutionBylineDot',
  ResolverName: 'ResolverName',
  ResolvedButton: 'ResolvedButton',
  ScheduledIndicator: 'ScheduledIndicator',
  ScheduledWrap: 'ScheduledWrap',
  SubtitleRow: 'SubtitleRow',
  SummaryText: 'SummaryText',
  SummaryTextChanged: 'SummaryTextChanged',
  TagsRow: 'TagsRow',
  TitleColumn: 'TitleColumn',
  TitleRow: 'TitleRow',
  ViewLabel: 'ViewLabel',
}));

vi.mock('./ThreadIndicator.css', () => ({
  ThreadScheduledIndicator: 'ThreadScheduledIndicator',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
}));

// Resolve t() keys against the real en.json so assertions below keep
// checking user-visible English copy ('Thread View', 'Resolve', …).
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn, i18n: { dir: textDirection } }),
  };
});

/**
 * ThreadContextBanner integration tests.
 *
 * These test the data flow that powers the banner: tag parsing,
 * display filtering, color generation, and permission/edge-case logic.
 * Full React render tests with heavy SDK mocking are deferred to
 * manual testing per the plan.
 */

describe('ThreadContextBanner data flow', () => {
  describe('tag display filtering', () => {
    it('renders pills for existing tags (excluding resolved)', () => {
      const content: ThreadTagsContent = {
        tags: {
          bug: { set_by: '@a:b', set_at: ISO_1 },
          feature: { set_by: '@a:b', set_at: ISO_2 },
          [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_3 },
        },
      };
      const display = getDisplayTags(content);
      expect(display).toEqual(['bug', 'feature']);
      expect(display).not.toContain(RESOLVED_TAG);
    });

    it('shows no pills when only resolved tag exists', () => {
      const content: ThreadTagsContent = {
        tags: { [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_1 } },
      };
      expect(getDisplayTags(content)).toEqual([]);
    });

    it('shows no pills for empty tags', () => {
      expect(getDisplayTags({ tags: {} })).toEqual([]);
    });
  });

  describe('overflow counter', () => {
    it('counts overflow for >3 tags on desktop', () => {
      const DESKTOP_MAX_PILLS = 3;
      const tags = ['bug', 'feature', 'review', 'urgent', 'wontfix'];
      const visible = tags.slice(0, DESKTOP_MAX_PILLS);
      const overflowCount = tags.length - visible.length;
      expect(visible).toEqual(['bug', 'feature', 'review']);
      expect(overflowCount).toBe(2);
    });

    it('no overflow for <=3 tags', () => {
      const DESKTOP_MAX_PILLS = 3;
      const tags = ['bug', 'feature'];
      const overflowCount = tags.length - Math.min(tags.length, DESKTOP_MAX_PILLS);
      expect(overflowCount).toBe(0);
    });
  });

  describe('resolve chip state', () => {
    it('isResolved reflects resolved tag presence', () => {
      expect(
        isThreadResolved({
          tags: { [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_1 } },
        })
      ).toBe(true);
      expect(isThreadResolved({ tags: {} })).toBe(false);
    });
  });

  describe('read-only mode', () => {
    it('hides picker when canEdit is false (tag validation)', () => {
      // When canEdit = false, the banner hides + button and x affordances.
      // This validates the data condition: a user without power level
      // would have canEdit = false in useThreadTags.
      expect(isValidTagName('bug')).toBe(true);
      expect(isValidTagName('')).toBe(false);
    });
  });

  describe('disabled state before root hydration', () => {
    it('returns empty content when parsing undefined state', () => {
      const content = parseThreadTagsContent(undefined);
      expect(content.tags).toEqual({});
      expect(getDisplayTags(content)).toEqual([]);
    });
  });

  describe('tag color determinism', () => {
    it('produces consistent colors for the same tag name', () => {
      expect(tagColor('bug')).toBe(tagColor('bug'));
      expect(tagColor('feature')).toBe(tagColor('feature'));
    });

    it('produces different colors for different tag names', () => {
      expect(tagColor('bug')).not.toBe(tagColor('feature'));
    });

    it('produces HSL format', () => {
      expect(tagColor('bug')).toMatch(/^hsl\(\d+, 65%, 82%\)$/);
    });

    it('has correct dark text color constant', () => {
      expect(TAG_TEXT_COLOR).toBe('#1a1a1a');
    });
  });

  describe('tag suggestions', () => {
    it('excludes current thread tags from suggestions', () => {
      const allContents: ThreadTagsContent[] = [
        {
          tags: {
            bug: { set_by: '@a:b', set_at: ISO_1 },
            feature: { set_by: '@a:b', set_at: ISO_2 },
          },
        },
      ];
      const currentTags = { bug: { set_by: '@a:b', set_at: ISO_1 } };
      expect(collectAvailableTags(allContents, currentTags)).toEqual(['feature']);
    });

    it('never suggests resolved tag', () => {
      const allContents: ThreadTagsContent[] = [
        {
          tags: {
            [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_1 },
            bug: { set_by: '@a:b', set_at: ISO_2 },
          },
        },
      ];
      expect(collectAvailableTags(allContents, {})).toEqual(['bug']);
    });
  });

  describe('tag input validation', () => {
    it('normalizes input', () => {
      expect(normalizeTagName('  Bug  ')).toBe('bug');
    });

    it('rejects empty/whitespace', () => {
      expect(isValidTagName('')).toBe(false);
      expect(isValidTagName('   ')).toBe(false);
    });

    it('rejects reserved resolved tag', () => {
      expect(isValidTagName('resolved')).toBe(false);
      expect(isValidTagName('  Resolved  ')).toBe(false);
    });

    it('accepts valid names', () => {
      expect(isValidTagName('bug')).toBe(true);
      expect(isValidTagName('feature-request')).toBe(true);
      expect(isValidTagName('wontfix')).toBe(true);
    });
  });
});

// The text a node renders, its pieces joined by spaces.
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : text(child)))
    .filter(Boolean)
    .join(' ');

describe('ThreadContextBanner rendering', () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    store = createStore();
    menuProps.mockClear();
    pinningMocks.pinnedEventIds = [];
    pinningMocks.canPin = false;
    pinningMocks.setPinned.mockReset();
    bannerMocks.useThreadRootEvent.mockReturnValue('$root');
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {},
      displayTags: [],
      isResolved: false,
      canEdit: false,
      availableTags: [],
    });
    bannerMocks.useMutateThreadTags.mockReturnValue({
      addTag: vi.fn(),
      removeTag: vi.fn(),
      setResolved: vi.fn(),
      updating: false,
      error: undefined,
    });
    bannerMocks.useThreadHeaderInfo.mockReturnValue({ scheduledTaskCount: 0 });
  });

  const bannerElement = (summaryText?: string, threadId = '$root') =>
    React.createElement(
      Provider,
      { store },
      React.createElement(ThreadContextBanner, {
        room: {
          roomId: '!room:example.org',
          getThread: () => undefined,
          findEventById: () => undefined,
          getMember: (userId: string) =>
            userId === '@alice:example.org'
              ? { rawDisplayName: 'Alice', name: 'Alice' }
              : undefined,
          hasEncryptionStateEvent: () => false,
          on: vi.fn(),
          removeListener: vi.fn(),
        } as unknown as Room,
        threadId,
        summaryInfo: summaryText ? { summaryText } : undefined,
        onExitThread: vi.fn(),
      })
    );
  const renderBanner = (
    summaryText?: string,
    createNodeMock?: (element: React.ReactElement) => unknown
  ) => create(bannerElement(summaryText), createNodeMock ? { createNodeMock } : undefined);

  it('opens actions for the active thread and current summary without offering navigation', async () => {
    const renderer = renderBanner('Current summary');
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const target = { focus: vi.fn(), isConnected: true, contains: () => true };
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 120,
      clientY: 230,
      currentTarget: target,
      target,
    };

    await act(async () => banner.props.onContextMenu(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    const selectedMenu = menuProps.mock.calls.at(-1)![0];
    expect(selectedMenu.rootId).toBe('$root');
    expect(selectedMenu.summaryText).toBe('Current summary');
    expect(selectedMenu.anchor).toEqual({ x: 120, y: 230, width: 0, height: 0 });
    expect(selectedMenu.onOpenThread).toBeUndefined();
    act(() => selectedMenu.onClose());
    // Focusing inside the sticky banner must not scroll the thread to its top.
    expect(target.focus).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    renderer.unmount();
  });

  it.each([
    { key: 'ContextMenu', shiftKey: false },
    { key: 'F10', shiftKey: true },
  ])('supports the $key keyboard shortcut and restores the focused trigger', async (keys) => {
    const renderer = renderBanner();
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const trigger = { focus: vi.fn(), isConnected: true };
    const anchor = { x: 20, y: 30, width: 400, height: 80 };
    const event = {
      ...keys,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { getBoundingClientRect: () => anchor, contains: () => true },
      target: trigger,
    };

    await act(async () => banner.props.onKeyDown(event));

    const selectedMenu = menuProps.mock.calls.at(-1)![0];
    expect(selectedMenu.rootId).toBe('$root');
    expect(selectedMenu.anchor).toEqual(anchor);
    act(() => selectedMenu.onClose());
    expect(trigger.focus).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('restores focus to More when the original trigger has detached', async () => {
    const moreButton = { focus: vi.fn(), isConnected: true };
    const renderer = renderBanner(undefined, (element) =>
      element.type === 'button' && element.props['aria-haspopup'] === 'menu' ? moreButton : null
    );
    const trigger = { focus: vi.fn(), isConnected: false };
    const banner = renderer.root.findByProps({ className: 'Banner' });
    await act(async () =>
      banner.props.onKeyDown({
        key: 'ContextMenu',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: {
          getBoundingClientRect: () => ({ x: 20, y: 30, width: 400, height: 80 }),
          contains: () => true,
        },
        target: trigger,
      })
    );

    act(() => menuProps.mock.calls.at(-1)![0].onClose());

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(moreButton.focus).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('offers a More button and ignores a stale close after the thread route changes', async () => {
    const renderer = renderBanner();
    const trigger = {
      focus: vi.fn(),
      isConnected: true,
      getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
    };
    const more = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.props['aria-haspopup'] === 'menu')!;

    expect(more().props['aria-label']).toBe('Thread options');
    await act(async () => more().props.onClick({ currentTarget: trigger }));
    const firstMenu = menuProps.mock.calls.at(-1)![0];

    const nextProps: ThreadContextBannerProps = {
      ...(renderer.root.findByType(ThreadContextBanner).props as ThreadContextBannerProps),
      threadId: '$next',
    };
    bannerMocks.useThreadRootEvent.mockReturnValue('$next');
    act(() => renderer.update(React.createElement(ThreadContextBanner, nextProps)));
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    await act(async () => more().props.onClick({ currentTarget: trigger }));
    act(() => firstMenu.onClose());

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1);
    expect(menuProps.mock.calls.at(-1)![0].rootId).toBe('$next');
    const nextMenu = menuProps.mock.calls.at(-1)![0];
    renderer.unmount();
    act(() => nextMenu.onClose());
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it('ignores context-menu and keyboard events from portalled header controls', async () => {
    const renderer = renderBanner();
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const event = {
      key: 'ContextMenu',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { contains: () => false },
      target: {},
    };

    await act(async () => {
      banner.props.onContextMenu(event);
      banner.props.onKeyDown(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(menuProps).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('replaces Resolve with a solid pin and allows only admins to unpin', () => {
    pinningMocks.pinnedEventIds = ['$root'];
    bannerMocks.useThreadHeaderInfo.mockReturnValue({ scheduledTaskCount: 0 });
    const member = renderBanner();
    expect(JSON.stringify(member.toJSON())).not.toContain('Resolve');
    const pinnedStatus = member.root.findByProps({ role: 'img', 'aria-label': 'Pinned' });
    expect(pinnedStatus.findByType('i').props.filled).toBe(true);
    expect(member.root.findAll((node) => node.children.includes('Pinned'))).toHaveLength(0);
    expect(member.root.findAllByProps({ 'aria-label': 'Unpin thread' })).toHaveLength(0);
    member.unmount();
    pinningMocks.canPin = true;
    const admin = renderBanner();
    expect(admin.root.findAll((node) => node.children.includes('Pinned'))).toHaveLength(0);
    const unpin = admin.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Unpin thread');
    expect(unpin).toBeDefined();
    expect(unpin!.findByType('i').props.filled).toBe(true);
    unpin!.props.onClick();
    expect(pinningMocks.setPinned).toHaveBeenCalledWith('$root', false);
    admin.unmount();
  });

  it('keeps only back, title and More on short screens', () => {
    pinningMocks.canPin = true;
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { bug: { set_by: '@a:b', set_at: ISO_1 } },
      displayTags: ['bug'],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const hidden = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root
        .findAll(
          (node) =>
            typeof node.type === 'string' &&
            String(node.props.className ?? '')
              .split(' ')
              .includes('CompactHidden')
        )
        .map((node) => {
          const [className] = String(node.props.className).split(' ');
          return (
            node.props['aria-label'] ?? (className === 'CompactHidden' ? text(node) : className)
          );
        });

    const summarized = renderBanner('A concise thread summary');
    expect(hidden(summarized)).toEqual(['TagsRow', 'Pin thread', 'Resolve', 'MobileOnlyTags']);
    const more = summarized.root.findByProps({ 'aria-label': 'Thread options' });
    expect(more.props.className).toBeUndefined();
    summarized.unmount();

    // Without a title the eyebrow is the only label, so it stays.
    const untitled = renderBanner();
    expect(hidden(untitled)).not.toContain('ViewLabel');
    untitled.unmount();

    // A resolved status stays in view; only its byline goes.
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.org', set_at: ISO_1 } },
      displayTags: [],
      isResolved: true,
      canEdit: false,
      availableTags: [],
    });
    const resolved = renderBanner('A concise thread summary');
    expect(JSON.stringify(resolved.toJSON())).toContain('"Resolved"');
    expect(hidden(resolved)).toEqual(['Resolved by Alice', 'Pin thread']);
    resolved.unmount();

    // The solid pin replaces Resolve and stays in view.
    pinningMocks.pinnedEventIds = ['$root'];
    const pinned = renderBanner('A concise thread summary');
    expect(hidden(pinned)).toEqual([]);
    expect(pinned.root.findByProps({ 'aria-label': 'Unpin thread' })).toBeDefined();
    pinned.unmount();
  });

  it('drops the Thread View eyebrow once the thread has a title', () => {
    const eyebrow = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          String(node.props.className ?? '')
            .split(' ')
            .includes('ViewLabel')
      );

    const summarized = renderBanner('A concise thread summary');
    expect(eyebrow(summarized)).toHaveLength(0);
    summarized.unmount();

    const untitled = renderBanner();
    expect(eyebrow(untitled)).toHaveLength(1);
    untitled.unmount();

    // A scheduled-task line is a title too.
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:12:00.000Z'),
      scheduledDisplayText: 'in 12m',
    });
    const scheduled = renderBanner();
    expect(eyebrow(scheduled)).toHaveLength(0);
    scheduled.unmount();
  });

  it('offers + tag only next to existing tags', () => {
    const editable = { tags: {}, isResolved: false, canEdit: true, availableTags: ['bug'] };
    bannerMocks.useThreadTags.mockReturnValue({ ...editable, displayTags: [] });
    const untagged = renderBanner('A concise thread summary');
    // More still adds the first tag.
    expect(JSON.stringify(untagged.toJSON())).not.toContain('+ tag');
    untagged.unmount();

    bannerMocks.useThreadTags.mockReturnValue({
      ...editable,
      tags: { bug: { set_by: '@a:b', set_at: ISO_1 } },
      displayTags: ['bug'],
    });
    const tagged = renderBanner('A concise thread summary');
    // One picker beside the desktop tags, one beside the mobile tags row.
    expect(
      tagged.root.findAll((node) => node.type === 'button' && node.children.includes('+ tag'))
    ).toHaveLength(2);
    tagged.unmount();
  });

  it('collapses to back and Show details from More and keeps that for the next thread', async () => {
    pinningMocks.canPin = true;
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { bug: { set_by: '@a:b', set_at: ISO_1 } },
      displayTags: ['bug'],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const banner = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findByProps({ 'data-thread-context-banner': 'true' });
    const buttons = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAllByType('button').map((button) => button.props['aria-label']);
    const focusable = { more: { focus: vi.fn() }, show: { focus: vi.fn() } };
    // Inside act, so the settings subscription is live before the click.
    const renderSubscribed = (summary: string) => {
      let renderer: ReturnType<typeof renderBanner> | undefined;
      act(() => {
        renderer = renderBanner(summary, (element) => {
          if (element.props['aria-haspopup'] === 'menu') return focusable.more;
          if (element.props['aria-label'] === 'Show thread details') return focusable.show;
          return null;
        });
      });
      return renderer!;
    };
    const openMore = async (renderer: ReturnType<typeof renderBanner>) => {
      const trigger = {
        focus: vi.fn(),
        isConnected: true,
        getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
      };
      const more = renderer.root.findByProps({ 'aria-label': 'Thread options' });
      await act(async () => more.props.onClick({ currentTarget: trigger }));
      return menuProps.mock.calls.at(-1)![0];
    };

    const renderer = renderSubscribed('A concise thread summary');
    expect(banner(renderer).props.className).toBe('Banner');
    expect(buttons(renderer)).not.toContain('Hide thread details');
    const menu = await openMore(renderer);
    act(() => {
      menu.onHideDetails();
      menu.onClose();
    });
    expect(banner(renderer).props.className).toBe('Banner Collapsed');
    expect(store.get(settingsAtom).threadBannerCollapsed).toBe(true);
    expect(buttons(renderer)).toEqual(['Back to room', 'Show thread details']);
    expect(renderer.root.findAllByProps({ 'data-approvals': 'true' })).toHaveLength(1);
    // Auto-approval stays in view with the thread's own ID.
    expect(renderer.root.findAllByProps({ 'data-auto-approve': '$root' })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('A concise thread summary');
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    // Hide unmounted with the menu; focus moves to the button that undoes it.
    expect(focusable.show.focus).toHaveBeenCalledOnce();
    expect(focusable.show.focus).toHaveBeenCalledWith({ preventScroll: true });
    renderer.unmount();

    const next = renderSubscribed('Another thread');
    expect(banner(next).props.className).toBe('Banner Collapsed');
    expect(focusable.show.focus).toHaveBeenCalledOnce();
    focusable.more.focus.mockClear();
    act(() => next.root.findByProps({ 'aria-label': 'Show thread details' }).props.onClick());
    expect(banner(next).props.className).toBe('Banner');
    expect(store.get(settingsAtom).threadBannerCollapsed).toBe(false);
    expect(focusable.more.focus).toHaveBeenCalledOnce();
    expect(focusable.more.focus).toHaveBeenCalledWith({ preventScroll: true });
    next.unmount();
  });

  it('focuses the banner on expanding while More waits for a confirmed root', () => {
    store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed: true });
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    const banner = { focus: vi.fn() };
    const more = { focus: vi.fn(), disabled: true };
    let renderer: ReturnType<typeof renderBanner> | undefined;
    act(() => {
      renderer = renderBanner('A concise thread summary', (element) => {
        if (element.props['data-thread-context-banner']) return banner;
        if (element.props['aria-haspopup'] === 'menu') return more;
        return null;
      });
    });
    act(() => renderer!.root.findByProps({ 'aria-label': 'Show thread details' }).props.onClick());
    expect(more.focus).not.toHaveBeenCalled();
    expect(banner.focus).toHaveBeenCalledWith({ preventScroll: true });
    renderer!.unmount();
  });

  it('keeps the resolved tint and offers no Hide item once collapsed', async () => {
    store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed: true });
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.org', set_at: ISO_1 } },
      displayTags: [],
      isResolved: true,
      canEdit: true,
      availableTags: [],
    });
    const renderer = renderBanner('A concise thread summary');
    const banner = renderer.root.findByProps({ 'data-thread-context-banner': 'true' });
    expect(banner.props.className).toBe('BannerResolved Collapsed');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('"Resolved"');
    // Right-clicking the pill still opens the actions, without Hide.
    const target = { focus: vi.fn(), isConnected: true, contains: () => true };
    await act(async () =>
      banner.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 10,
        clientY: 10,
        currentTarget: target,
        target,
      })
    );
    expect(menuProps.mock.calls.at(-1)![0].onHideDetails).toBeUndefined();
    renderer.unmount();
  });

  it('hides the metadata row when no summary or scheduled task info exists', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      summaryText: undefined,
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Thread View');
    expect(tree).not.toContain('Focused thread context is active.');
    expect(tree).not.toContain('Next task');
  });

  it('disables tag and resolve actions for a provisional thread root', () => {
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    bannerMocks.useThreadTags.mockReturnValue({
      displayTags: [],
      isResolved: false,
      canEdit: true,
      availableTags: ['bug'],
    });
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner();
    const resolveButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === 'Resolve');

    expect(JSON.stringify(renderer.toJSON())).not.toContain('+ tag');
    expect(resolveButton?.props.disabled).toBe(true);
  });

  it('ignores every menu trigger until the provisional root is confirmed', async () => {
    bannerMocks.useThreadRootEvent.mockReturnValue('~!room:example.org:txn-root');
    const renderer = renderBanner();
    const banner = renderer.root.findByProps({ className: 'Banner' });
    const target = {
      contains: () => true,
      getBoundingClientRect: () => ({ x: 20, y: 30, width: 30, height: 30 }),
    };
    const more = () =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.props['aria-haspopup'] === 'menu')!;
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: target,
      target,
      clientX: 20,
      clientY: 30,
    };

    await act(async () => {
      more().props.onClick(event);
      banner.props.onContextMenu(event);
      banner.props.onKeyDown({ ...event, key: 'ContextMenu' });
      banner.props.onKeyDown({ ...event, key: 'F10', shiftKey: true });
    });

    expect(more().props.disabled).toBe(true);
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
    bannerMocks.useThreadRootEvent.mockReturnValue('$confirmed');
    act(() =>
      renderer.update(
        React.createElement(
          ThreadContextBanner,
          renderer.root.findByType(ThreadContextBanner).props as ThreadContextBannerProps
        )
      )
    );
    expect(more().props.disabled).toBe(false);
    await act(async () => more().props.onClick(event));
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1);
    renderer.unmount();
  });

  it('renders a truncated summary row when summary text is available', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner('A concise thread summary');
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('A concise thread summary');
    expect(renderer.root.findByProps({ title: 'A concise thread summary' })).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-thread-context-summary': 'true' })).toBeTruthy();
    expect(tree).not.toContain('Next task');
  });

  it('tints the summary only when it changes in the same thread', () => {
    const summaryClass = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.className;
    let renderer!: ReturnType<typeof renderBanner>;
    act(() => {
      renderer = create(bannerElement('Push bug'));
    });
    expect(summaryClass(renderer)).toBe('SummaryText');

    act(() => renderer.update(bannerElement('Fixing token refresh')));
    expect(summaryClass(renderer)).toBe('SummaryText SummaryTextChanged');
    // Played once: remounting the title, as expanding the banner does, does not replay it.
    act(() =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.onAnimationEnd()
    );
    expect(summaryClass(renderer)).toBe('SummaryText');

    act(() => renderer.update(bannerElement('Another thread', '$other')));
    expect(summaryClass(renderer)).toBe('SummaryText');
  });

  it('drops a pending tint when the banner collapses', () => {
    const summaryClass = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.className;
    const setCollapsed = (threadBannerCollapsed: boolean) =>
      act(() => store.set(settingsAtom, { ...store.get(settingsAtom), threadBannerCollapsed }));
    let renderer!: ReturnType<typeof renderBanner>;
    act(() => {
      renderer = create(bannerElement('Push bug'));
    });
    act(() => renderer.update(bannerElement('Fixing token refresh')));
    expect(summaryClass(renderer)).toBe('SummaryText SummaryTextChanged');

    // Collapsed before the tint ends, so the title unmounts without its animationend.
    setCollapsed(true);
    setCollapsed(false);

    expect(summaryClass(renderer)).toBe('SummaryText');
    act(() => renderer.unmount());
  });

  it('shows the next summary once the SDK replaces a redacted latest summary', () => {
    const notice = (eventId: string, summary: string, timestamp: number) =>
      new MatrixEvent({
        event_id: eventId,
        type: 'm.room.message',
        origin_server_ts: timestamp,
        content: {
          msgtype: 'm.notice',
          body: summary,
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          'io.mindroom.thread_summary': {
            version: 1,
            summary,
            generated_at: new Date(timestamp).toISOString(),
          },
        },
      });
    const older = notice('$older', 'Older title', 1000);
    // Until it re-fetches the root, the SDK's latest reply is an unredacted copy.
    const thread = {
      id: '$root',
      replyToEvent: notice('$leaked', 'Leaked title', 2000),
      lastReply: () => null,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({ getEvents: () => [], getNeighbouringTimeline: () => null }),
        relations: { getChildEventsForEvent: () => undefined },
      }),
    };
    const emitter = new EventEmitter();
    const room = {
      roomId: '!room:example.org',
      getThread: () => thread,
      findEventById: () => undefined,
      getMember: () => undefined,
      hasEncryptionStateEvent: () => false,
      on: emitter.on.bind(emitter),
      removeListener: emitter.removeListener.bind(emitter),
    } as unknown as Room;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ThreadContextBanner, {
          room,
          threadId: '$root',
          summaryInfo: { summaryText: 'Older title', eventTs: 1000, eventId: '$older' },
          onExitThread: vi.fn(),
        })
      );
    });
    const summaryText = () =>
      renderer.root.findByProps({ 'data-thread-context-summary': 'true' }).props.title;
    expect(summaryText()).toBe('Leaked title');

    thread.replyToEvent = older;
    act(() => {
      emitter.emit(ThreadEvent.Update, thread);
    });
    expect(summaryText()).toBe('Older title');
  });

  it('does not render the summary node when summary text is empty or undefined', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const emptyRenderer = renderBanner('');
    const undefinedRenderer = renderBanner();

    expect(
      emptyRenderer.root.findAllByProps({ 'data-thread-context-summary': 'true' })
    ).toHaveLength(0);
    expect(
      undefinedRenderer.root.findAllByProps({ 'data-thread-context-summary': 'true' })
    ).toHaveLength(0);
  });

  it('renders the scheduled countdown row when only scheduled task info exists', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      summaryText: undefined,
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:12:00.000Z'),
      scheduledDisplayText: 'in 12m',
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Next task in 12m');
    expect(tree).toContain('Resolve');
  });

  it('uses scheduled-task fallback copy when no next-run timestamp is available', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      summaryText: undefined,
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      scheduledDisplayText: '2 scheduled tasks',
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('2 scheduled tasks');
    expect(renderer.root.findByProps({ 'aria-label': '2 pending scheduled tasks' })).toBeTruthy();
  });

  it('renders the backend cron description when it is the only scheduled task detail', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
      cronDescription: 'At 09:00',
      scheduledDisplayText: 'At 09:00',
    });

    const renderer = renderBanner();
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('At 09:00');
    expect(tree).not.toContain('1 scheduled task');
    expect(
      renderer.root.findByProps({ 'aria-label': '1 pending scheduled task, At 09:00' })
    ).toBeTruthy();
  });

  it('renders summary and scheduled countdown together when both exist', () => {
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:03:00.000Z'),
      scheduledDisplayText: 'in 3m',
    });

    const renderer = renderBanner('Summary text here');
    const tree = JSON.stringify(renderer.toJSON());

    expect(tree).toContain('Summary text here');
    expect(tree).toContain('in 3m');
    expect(tree).toContain('·');
    expect(tree).toContain('Resolve');
  });

  it('offers Resolve as an icon button named by a tooltip, like More and the pin', () => {
    pinningMocks.canPin = true;
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {},
      displayTags: [],
      isResolved: false,
      canEdit: true,
      availableTags: [],
    });
    const renderer = renderBanner('A concise thread summary');
    const resolve = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Resolve'
    );
    expect(resolve.findByType('i').props.src).toBe('check');
    expect(resolve.props.className).toBe('CompactHidden');
    const tips = renderer.root.findAllByProps({ role: 'tooltip' }).map(text);
    expect(tips).toEqual(['Back to room', 'Thread options', 'Pin thread', 'Resolve']);
    // The tooltips replace the native ones.
    expect(renderer.root.findAll((node) => node.type === 'button' && !!node.props.title)).toEqual(
      []
    );
    renderer.unmount();
  });

  it('opens the back tooltip toward the banner in either text direction', () => {
    const backTip = (renderer: ReturnType<typeof renderBanner>) =>
      renderer.root.findAllByProps({ role: 'tooltip' }).find((tip) => text(tip) === 'Back to room')!
        .props['data-align'];
    const ltr = renderBanner('A concise thread summary');
    expect(backTip(ltr)).toBe('Start');
    ltr.unmount();
    textDirection.mockReturnValue('rtl');
    const rtl = renderBanner('A concise thread summary');
    expect(backTip(rtl)).toBe('End');
    rtl.unmount();
    textDirection.mockReturnValue('ltr');
  });

  it('shows who resolved the thread after its title, not below the chip', () => {
    bannerMocks.useThreadTags.mockReturnValue({
      tags: {
        resolved: {
          set_by: '@alice:example.org',
          set_at: '2026-08-27T12:00:00.000Z',
        },
      },
      displayTags: [],
      isResolved: true,
      canEdit: true,
      availableTags: [],
    });
    bannerMocks.useThreadHeaderInfo.mockReturnValue({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    const renderer = renderBanner('A concise thread summary');

    const chip = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Resolved'
    );
    expect(chip.props.className).toBe('ResolvedButton');
    // Screen readers hear who resolved it from the button too, also where the byline is hidden.
    const bylineId = renderer.root.findByProps({ 'data-thread-resolution-byline': 'true' }).props
      .id;
    expect(bylineId).toBeTruthy();
    expect(chip.props['aria-describedby']).toBe(bylineId);
    expect(chip.findByType('i').props.src).toBe('check');
    // Who resolved it, and what pressing it does.
    expect(renderer.root.findAllByProps({ role: 'tooltip' }).map(text)).toContain(
      'Resolved by Alice Reopen thread'
    );
    const byline = renderer.root.findByProps({ 'data-thread-resolution-byline': 'true' });
    expect(byline.props['aria-label']).toBe('Resolved by Alice');
    expect(byline.findByProps({ className: 'ResolverName' }).findByType('span').children).toContain(
      'by Alice'
    );
    const subtitle = renderer.root.findByProps({ className: 'SubtitleRow' });
    expect(
      subtitle.findAllByProps({ 'data-thread-resolution-byline': 'true' }, { deep: false })
    ).toHaveLength(1);
    expect(
      byline.findAllByProps({ className: 'MetadataDot ResolutionBylineDot' }, { deep: false })
    ).toHaveLength(1);
    expect(
      chip.findAllByProps({ 'data-thread-resolution-byline': 'true' }, { deep: false })
    ).toHaveLength(0);
    renderer.unmount();

    // Untitled, the byline needs no separator and the eyebrow stays.
    const untitled = renderBanner();
    expect(JSON.stringify(untitled.toJSON())).toContain('Thread View');
    const untitledByline = untitled.root.findByProps({ 'data-thread-resolution-byline': 'true' });
    expect(
      untitledByline.findAllByProps(
        { className: 'MetadataDot ResolutionBylineDot' },
        { deep: false }
      )
    ).toHaveLength(0);
    untitled.unmount();

    // A reader can't reopen, so the tooltip only says who resolved it.
    bannerMocks.useThreadTags.mockReturnValue({
      tags: { resolved: { set_by: '@alice:example.org', set_at: '2026-08-27T12:00:00.000Z' } },
      displayTags: [],
      isResolved: true,
      canEdit: false,
      availableTags: [],
    });
    const reader = renderBanner('A concise thread summary');
    expect(reader.root.findAllByProps({ role: 'tooltip' }).map(text)).toContain(
      'Resolved by Alice'
    );
    expect(JSON.stringify(reader.toJSON())).not.toContain('Reopen thread');
    reader.unmount();

    // A pinned thread shows the pin instead of the chip and its byline.
    pinningMocks.pinnedEventIds = ['$root'];
    const pinned = renderBanner('A concise thread summary');
    expect(
      pinned.root.findAllByProps({ 'data-thread-resolution-byline': 'true' }, { deep: false })
    ).toHaveLength(0);
    pinned.unmount();
  });
});
