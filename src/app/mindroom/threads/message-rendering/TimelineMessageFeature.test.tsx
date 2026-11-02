import React, { createRef } from 'react';
import {
  EventStatus,
  MatrixEvent,
  MatrixEventEvent,
  type Room,
  type EventTimelineSet,
} from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  makeEvent,
  makeRoom,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { MessageLayout, MessageSpacing } from '../../../state/settings';
import { MessageEvent } from '../../../../types/matrix/room';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT } from '../roomTimelineMessageExtensions';
import type { ThreadRecord } from '../types';
import type { TimelineMessageRow } from './types';

// Shared timeline fixtures stub the subscription. This suite deliberately exercises it.
vi.doUnmock('../../../features/room/message/EncryptedContent');

vi.mock('../../messages/MindroomThreadSummaryMarker', async () => {
  const ReactImport = await import('react');
  return {
    MindroomThreadSummaryMarker: (props: Record<string, unknown>) =>
      ReactImport.createElement('summary-marker', props),
  };
});

const summaryEvent = (id: string) =>
  makeEvent(id, {
    threadRootId: '$thread',
    content: {
      msgtype: 'm.notice',
      body: 'Fixing token refresh',
      'io.mindroom.thread_summary': {
        version: 1,
        summary: 'Fixing token refresh',
        message_count: 21,
      },
    },
  }) as unknown as MatrixEvent;
const summaryMarkers = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => (node.type as unknown) === 'summary-marker');
const renderedContent = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll(
    (node) => node.type === RenderMessageContent && typeof node.props.msgType === 'string'
  );

const rowFor = (event: MatrixEvent, index = 0, previousEventId?: string): TimelineMessageRow => ({
  eventId: event.getId()!,
  event,
  index,
  previousEventId,
  timelineSet: {} as EventTimelineSet,
  collapse: false,
  highlighted: true,
});

const mountFeature = async (rows: TimelineMessageRow[], threadId?: string) => {
  const { useTimelineMessageFeature } = await import('./useTimelineMessageFeature');
  const room = makeRoom({ liveEvents: [] }) as unknown as Room;
  const editor = createEditor();
  const scrollRef = createRef<HTMLDivElement>();
  let feature!: ReturnType<typeof useTimelineMessageFeature>;
  const data = {
    threadRecordMap: new Map(),
    threadEventMap: new Map(),
    handleOpenReply: vi.fn(),
    approvalTimeline: {
      hiddenEventIds: new Set<string>(),
      historyByResponseId: new Map(),
      fallbackGroupsByEventId: new Map(),
    },
    threadSummaryTimeline: {
      hiddenEventIds: new Set<string>(),
      markersByEventId: new Map(),
    },
  };
  const Harness = () => {
    feature = useTimelineMessageFeature({
      room,
      editor,
      threadId,
      scrollRef,
      showThreadRepliesInRoom: false,
      messageLayout: MessageLayout.Compact,
      messageSpacing: '400' as MessageSpacing,
      hideActivity: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      showHiddenEvents: false,
    });
    return feature.wrapExpansion(<>{rows.map((row) => feature.renderEvent(row, data))}</>);
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness />);
  });
  return {
    renderer,
    feature: () => feature,
    data,
    update: () => act(() => renderer.update(<Harness />)),
  };
};

describe('timeline message feature', () => {
  it('shares framing while retaining message, approval and sticker edit/reply policy', async () => {
    const events = [
      MessageEvent.RoomMessage,
      MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT,
      MessageEvent.Sticker,
    ].map((type, index) => {
      const event = makeEvent(`$${index}`, { type }) as unknown as MatrixEvent;
      Object.defineProperty(event, 'replyEventId', { value: '$target' });
      return event;
    });
    const { renderer, data, update } = await mountFeature(
      events.map((event, index) => rowFor(event, index))
    );
    events.forEach((event) =>
      data.threadRecordMap.set(event.getId()!, {
        roomId: '!room:example.org',
        threadRootId: event.getId(),
        status: { isKnownThreadRoot: true, replyCount: 1, isResolved: false },
        presentation: { replyParticipantIds: [] },
      } as unknown as ThreadRecord)
    );
    update();
    const messages = events.map((event) =>
      renderer.root.findByProps({ 'data-message-id': event.getId() })
    );
    expect(messages.map((message) => !!message.props.onEditId)).toEqual([true, false, false]);
    expect(messages.map((message) => !!message.props.reply)).toEqual([true, true, false]);
    expect(messages.map((message) => !!message.props.reactions)).toEqual([true, true, false]);
    expect(messages.map((message) => message.props.highlight)).toEqual([true, true, true]);
    act(() => messages[0].props.onEditId('$0'));
    expect(renderer.root.findByProps({ 'data-message-id': '$0' }).props.edit).toBe(true);
    expect(messages[1].props.edit).toBeUndefined();
    expect(messages[2].props.edit).toBeUndefined();
  });

  it('gives message content its event ID so tool calls can find their approval cards', async () => {
    const event = makeEvent('$reply', { type: MessageEvent.RoomMessage }) as unknown as MatrixEvent;
    const { renderer } = await mountFeature([rowFor(event)]);
    expect(renderedContent(renderer).map((node) => node.props.eventId)).toContain('$reply');
  });

  it('captures each predecessor before adjacent reply elements render', async () => {
    const events = ['$first', '$second', '$fallback'].map(
      (id) => new MatrixEvent({ event_id: id, type: MessageEvent.RoomMessage, content: {} })
    );
    Object.defineProperty(events[0], 'replyEventId', { value: '$older' });
    Object.defineProperty(events[1], 'replyEventId', { value: '$first' });
    Object.defineProperty(events[2], 'replyEventId', { value: '$older' });
    events[2].getWireContent = () => ({
      'm.relates_to': { rel_type: 'm.thread', is_falling_back: true },
    });
    let previousEventId = '$older';
    const rows = events.map((event, index) => {
      const row = rowFor(event, index, previousEventId);
      previousEventId = event.getId()!;
      return row;
    });
    const { renderer } = await mountFeature(rows, '$root');
    expect(
      events.map(
        (event) => !!renderer.root.findByProps({ 'data-message-id': event.getId() }).props.reply
      )
    ).toEqual([false, false, false]);
  });

  it('returns state and unsupported-event null results synchronously', async () => {
    const { feature, data } = await mountFeature([]);
    const event = makeEvent('$state', {
      type: 'example.hidden',
      stateKey: '',
    }) as unknown as MatrixEvent;
    expect(feature().renderEvent(rowFor(event), data)).toBeNull();
    const unknown = makeEvent('$unknown', { type: 'example.unknown' }) as unknown as MatrixEvent;
    expect(feature().renderEvent(rowFor(unknown), data)).toBeNull();
  });

  it('preserves known-state precedence and the row highlight', async () => {
    const event = makeEvent('$name', {
      type: 'm.room.name',
      stateKey: '',
    }) as unknown as MatrixEvent;
    const { renderer } = await mountFeature([rowFor(event)]);
    expect(renderer.root.findByProps({ 'data-message-id': '$name' }).props.highlight).toBe(true);
  });

  it('keeps predecessor capture in the real timeline render batch', async () => {
    const { RoomTimeline } = await import('../../../features/room/RoomTimeline');
    const ControlledTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const root = makeEvent('$root');
    const first = makeEvent('$first', { threadRootId: '$root' });
    const second = makeEvent('$second', { threadRootId: '$root' });
    const fallback = makeEvent('$fallback', { threadRootId: '$root' });
    const replies = [first, second, fallback];
    replies.forEach((event, index) => {
      Object.defineProperty(event, 'replyEventId', { value: index === 1 ? '$first' : '$older' });
      Object.assign(event, {
        getWireContent: () => ({
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: '$root',
            is_falling_back: index === 2,
          },
        }),
      });
    });
    threadRenderStateMock.threadEvents = [root, ...replies];
    const room = makeRoom({ liveEvents: [root] });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ControlledTimeline room={room} threadId="$root" />);
      await flushAsyncWork(1);
    });
    expect(
      replies.map(
        (event) => !!renderer.root.findByProps({ 'data-message-id': event.getId() }).props.reply
      )
    ).toEqual([true, false, false]);
  });

  it('consumes live expansion candidates through the rendered collapse control', async () => {
    const event = makeEvent('$live') as unknown as MatrixEvent;
    const { feature, renderer, update } = await mountFeature([rowFor(event)]);
    feature().markLiveExpansionCandidate('$live');
    update();
    const expanded = renderer.root.find((node) => node.props.expansionKey === '$live');
    expect(expanded.props.collapseMode).toBe('initially-expanded');
    act(() => expanded.props.onInitialExpandConsumed());
    update();
    expect(
      renderer.root.find((node) => node.props.expansionKey === '$live').props.collapseMode
    ).toBe('default');
  });

  it('places approval history once for message, approval fallback and decrypted approval rows', async () => {
    const { ApprovalHistory } = await import('../../messages/ThreadApprovalControls');
    const message = makeEvent('$message') as unknown as MatrixEvent;
    const approval = makeEvent('$approval', {
      type: MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT,
    }) as unknown as MatrixEvent;
    const encrypted = new MatrixEvent({
      event_id: '$encrypted-approval',
      type: MessageEvent.RoomMessageEncrypted,
      content: {},
    });
    const events = [message, approval, encrypted];
    const { renderer, data, update } = await mountFeature(
      events.map((event, index) => rowFor(event, index))
    );
    data.approvalTimeline.historyByResponseId.set('$message', [{ eventId: '$history-message' }]);
    data.approvalTimeline.fallbackGroupsByEventId.set('$approval', [
      { eventId: '$history-approval' },
    ]);
    data.approvalTimeline.fallbackGroupsByEventId.set('$encrypted-approval', [
      { eventId: '$history-encrypted' },
    ]);
    update();
    await act(async () => {
      await encrypted.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            type: MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT,
            content: { approval_id: 'approval-1' },
          },
        }),
      } as Parameters<MatrixEvent['attemptDecryption']>[0]);
    });
    expect(
      renderer.root
        .findAllByType(ApprovalHistory)
        .flatMap((node) => node.props.records.map((record: { eventId: string }) => record.eventId))
    ).toEqual(['$history-message', '$history-approval', '$history-encrypted']);
  });

  it('renders newly decrypted content and cleans up subscriptions on replacement and unmount', async () => {
    const event = new MatrixEvent({
      event_id: '$encrypted',
      type: MessageEvent.RoomMessageEncrypted,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      content: {},
    });
    const rows = [rowFor(event)];
    const { renderer, update } = await mountFeature(rows);
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    await act(async () => {
      await event.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            type: MessageEvent.RoomMessage,
            content: { body: 'Now decrypted', msgtype: 'm.text' },
          },
        }),
      } as Parameters<MatrixEvent['attemptDecryption']>[0]);
    });
    const content = renderer.root.findAll((node) => typeof node.props.getContent === 'function');
    expect(
      content.some(
        (node) =>
          node.props.eventType === MessageEvent.RoomMessage && node.props.msgType === 'm.text'
      )
    ).toBe(true);
    expect(content[0].props.getContent()).toEqual({ body: 'Now decrypted', msgtype: 'm.text' });
    const replacement = new MatrixEvent({
      event_id: '$encrypted',
      type: MessageEvent.RoomMessageEncrypted,
      content: {},
    });
    rows[0] = rowFor(replacement);
    update();
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(replacement.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    act(() => renderer.unmount());
    expect(replacement.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('leaves the failed root of an open thread to the thread footer', async () => {
    const { FailedSendActions } = await import('../../messages/FailedSendActions');
    const [root, reply] = ['~root', '~reply'].map((id) => {
      const event = makeEvent(id, { content: { body: id } }) as unknown as MatrixEvent;
      event.status = EventStatus.NOT_SENT;
      return event;
    });
    const { renderer } = await mountFeature([rowFor(root), rowFor(reply, 1, '~root')], '~root');

    expect(renderer.root.findAllByType(FailedSendActions).map((node) => node.props.event)).toEqual([
      reply,
    ]);
  });

  it('resolves edits on mutable events again when the feature rerenders', async () => {
    const event = makeEvent('$mutable', {
      content: { body: 'First', msgtype: 'm.text' },
    }) as unknown as MatrixEvent;
    const { renderer, update } = await mountFeature([rowFor(event)]);
    event.getContent = () => ({ body: 'Stream update', msgtype: 'm.text' });
    update();
    const message = renderer.root.findByProps({ 'data-message-id': '$mutable' });
    expect(message.props.resolvedMessageContent.body).toBe('Stream update');
    expect(
      renderer.root.findAll((node) => node.props.getContent?.().body === 'Stream update').length
    ).toBeGreaterThan(0);
  });

  it('shrinks a summary in an open thread to a marker carrying its plan', async () => {
    const event = summaryEvent('$summary');
    const { renderer, data, update } = await mountFeature([rowFor(event)], '$thread');
    data.threadSummaryTimeline.markersByEventId.set('$summary', {
      first: false,
      previousSummaryText: 'Push bug',
    });
    update();

    const [marker] = summaryMarkers(renderer);
    expect(marker.props.summaryInfo.summaryText).toBe('Fixing token refresh');
    expect(marker.props.plan).toEqual({ first: false, previousSummaryText: 'Push bug' });
    expect(renderedContent(renderer)).toHaveLength(0);
  });

  it('keeps the summary card for a summary outside an open thread', async () => {
    const { renderer } = await mountFeature([rowFor(summaryEvent('$summary'))]);

    expect(summaryMarkers(renderer)).toHaveLength(0);
    expect(renderedContent(renderer)).toHaveLength(1);
  });
});
