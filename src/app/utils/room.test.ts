import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  canEditEvent,
  getEditedEvent,
  getLatestEdit,
  getLatestMessageContent,
  isMindroomEmojiRoom,
  isRoom,
  roomHaveUnread,
  trimReplyFromBody,
} from './room';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: `${eventId}`,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeThreadReplyEvent = (eventId: string, ts: number, sender = '@bob:example.org') =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: '$thread-root',
        'm.in_reply_to': {
          event_id: '$thread-root',
        },
        is_falling_back: true,
        rel_type: RelationType.Thread,
      },
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const attachSerializedReplacement = ({
  targetEvent,
  replacementEventId,
  ts,
  sender = '@alice:example.org',
}: {
  targetEvent: MatrixEvent;
  replacementEventId: string;
  ts?: number;
  sender?: string;
}) => {
  targetEvent.event.unsigned = {
    'm.relations': {
      'm.replace': {
        content: {
          body: '* bundled',
          'm.new_content': {
            body: 'bundled',
            msgtype: 'm.text',
          },
          'm.relates_to': {
            event_id: targetEvent.getId(),
            rel_type: 'm.replace',
          },
          msgtype: 'm.text',
        },
        event_id: replacementEventId,
        ...(typeof ts === 'number' ? { origin_server_ts: ts } : {}),
        room_id: '!room:example.org',
        sender,
        type: 'm.room.message',
      },
    },
  };
};

describe('canEditEvent', () => {
  const me = '@alice:example.org';
  const mx = { getUserId: () => me } as any;
  const longTextFile = {
    msgtype: 'm.file',
    body: 'The start of a long message',
    url: 'mxc://example.org/sidecar',
    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  };
  const event = (content: Record<string, unknown>, sender = me) =>
    new MatrixEvent({
      content,
      event_id: '$event',
      room_id: '!room:example.org',
      sender,
      type: 'm.room.message',
    });

  it('edits your own message sent as a long-text file like text', () => {
    expect(canEditEvent(mx, event(longTextFile))).toBe(true);
  });

  it("does not edit an ordinary file or someone else's long text", () => {
    expect(
      canEditEvent(mx, event({ msgtype: 'm.file', body: 'a.txt', url: 'mxc://example.org/a' }))
    ).toBe(false);
    expect(canEditEvent(mx, event(longTextFile, '@mindroom_writer:example.org'))).toBe(false);
  });
});

describe('room edit helpers', () => {
  it('prefers the newest edit when the SDK replacement is newer than relation edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk-latest', 3000, '$target');
    const staleRelationEdit = makeEditEvent('$stale', 2000, '$target');

    targetEvent.makeReplaced(sdkReplacement);

    const getChildEventsForEvent = vi.fn().mockReturnValue({
      getRelations: () => [staleRelationEdit],
    });
    const timelineSet = {
      relations: {
        getChildEventsForEvent,
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(sdkReplacement);
    expect(getChildEventsForEvent).toHaveBeenCalled();
  });

  it('prefers newer relation edits over a stale SDK replacement', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const staleSdkReplacement = makeEditEvent('$sdk-stale', 2000, '$target');
    const completedRelationEdit = makeEditEvent('$completed', 3000, '$target');

    targetEvent.makeReplaced(staleSdkReplacement);

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [completedRelationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(completedRelationEdit);
  });

  it('falls back to relation edits when SDK replacement is unavailable', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const olderEdit = makeEditEvent('$older', 2000, '$target');
    const newerEdit = makeEditEvent('$newer', 3000, '$target');
    const otherSenderEdit = makeEditEvent('$other', 4000, '$target', '@bob:example.org');

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [olderEdit, otherSenderEdit, newerEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);
    expect(editedEvent).toBe(newerEdit);
  });

  it('prefers a newer serialized replacement over stale sdk and relation edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 2000, '$target');
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    targetEvent.makeReplaced(sdkReplacement);
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: 4000,
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent?.getId()).toBe('$serialized');
  });

  it('breaks same-timestamp ties by event id regardless of candidate order (D12)', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target');
    const secondEdit = makeEditEvent('$edit-2', 2000, '$target');

    expect(getLatestEdit(targetEvent, [firstEdit, secondEdit])).toBe(secondEdit);
    expect(getLatestEdit(targetEvent, [secondEdit, firstEdit])).toBe(secondEdit);
  });

  it('keeps the incumbent instance when timestamp and event id both tie', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const instanceA = makeEditEvent('$edit-1', 2000, '$target');
    const instanceB = makeEditEvent('$edit-1', 2000, '$target');

    expect(getLatestEdit(targetEvent, [instanceA, instanceB])).toBe(instanceA);
    expect(getLatestEdit(targetEvent, [instanceB, instanceA])).toBe(instanceB);
  });

  it('resolves a serialized-replacement/relation-edit timestamp tie by event id', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: 3000,
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent?.getId()).toBe('$serialized');
  });

  it('ignores serialized replacements without origin_server_ts', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: undefined,
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(relationEdit);
  });

  it('rejects sender-mismatched serialized replacements before candidate selection', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const relationEdit = makeEditEvent('$relation', 3000, '$target');
    attachSerializedReplacement({
      targetEvent,
      replacementEventId: '$serialized',
      ts: 4000,
      sender: '@mallory:example.org',
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [relationEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);

    expect(editedEvent).toBe(relationEdit);
  });

  it('preserves top-level MindRoom metadata from the replacement wrapper content', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'Thinking...  ⋯');
    const replacementEvent = new MatrixEvent({
      content: {
        body: '* Final answer',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'completed',
        },
        'io.mindroom.stream_status': 'completed',
        'm.new_content': {
          body: 'Final answer',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-final',
      origin_server_ts: 2000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

    const resolvedContent = getLatestMessageContent(targetEvent, replacementEvent);

    expect(resolvedContent).toMatchObject({
      body: 'Final answer',
      msgtype: 'm.text',
      'io.mindroom.ai_run': {
        version: 1,
        status: 'completed',
      },
      'io.mindroom.stream_status': 'completed',
    });
  });

  it('preserves MindRoom message extras when replacement new_content omits them', () => {
    const extras = {
      version: 1,
      sections: [
        {
          title: 'Evidence',
          content_type: 'text/plain',
          content: 'extra payload',
        },
      ],
    };
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'Thinking...  ⋯');
    const replacementEvent = new MatrixEvent({
      content: {
        body: '* Final answer',
        'com.mindroom.message_extras': extras,
        'm.new_content': {
          body: 'Final answer',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-final',
      origin_server_ts: 2000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

    const resolvedContent = getLatestMessageContent(targetEvent, replacementEvent);

    expect(resolvedContent['com.mindroom.message_extras']).toEqual(extras);
  });

  it('uses newer replacement events as MindRoom metadata fallbacks for streaming edits', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'Thinking...  ⋯');
    const traceMetadata = {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'run_shell_command',
          result_preview: 'Done',
        },
      ],
    };
    const priorReplacementEvent = new MatrixEvent({
      content: {
        body: '* Prior',
        'm.new_content': {
          body: 'Prior\n\n🔧 `run_shell_command` [1]',
          'io.mindroom.tool_trace': traceMetadata,
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-prior',
      origin_server_ts: 2000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    const latestReplacementEvent = new MatrixEvent({
      content: {
        body: '* Latest',
        'm.new_content': {
          body: 'Latest\n\n🔧 `run_shell_command` [1]\n\n🔧 `run_shell_command` [2] ⏳',
          'io.mindroom.stream_status': 'streaming',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          event_id: '$target',
          rel_type: 'm.replace',
        },
        msgtype: 'm.text',
      },
      event_id: '$edit-latest',
      origin_server_ts: 3000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [priorReplacementEvent, latestReplacementEvent],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);
    const resolvedContent = getLatestMessageContent(targetEvent, editedEvent);

    expect(resolvedContent.body).toBe(
      'Latest\n\n🔧 `run_shell_command` [1]\n\n🔧 `run_shell_command` [2] ⏳'
    );
    expect(resolvedContent['io.mindroom.stream_status']).toBe('streaming');
    expect(resolvedContent['io.mindroom.tool_trace']).toEqual(traceMetadata);
  });

  it("never takes MindRoom metadata from another sender's edit", () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@mindroom_research:example.org');
    const agentEdit = makeEditEvent(
      '$agent-edit',
      2000,
      '$target',
      '@mindroom_research:example.org'
    );
    const foreignEdit = makeEditEvent('$foreign-edit', 3000, '$target', '@mallory:example.org');
    foreignEdit.getContent()['m.new_content']['com.mindroom.message_extras'] = {
      version: 1,
      sections: [{ title: 'Sign in', content_type: 'text/plain', content: 'https://evil' }],
    };
    const timelineSet = {
      relations: {
        getChildEventsForEvent: vi.fn().mockReturnValue({
          getRelations: () => [agentEdit, foreignEdit],
        }),
      },
    } as any;

    const editedEvent = getEditedEvent('$target', targetEvent, timelineSet);
    const resolvedContent = getLatestMessageContent(targetEvent, editedEvent);

    expect(editedEvent).toBe(agentEdit);
    expect(resolvedContent.body).toBe('$agent-edit');
    expect(resolvedContent['com.mindroom.message_extras']).toBeUndefined();
    expect(agentEdit.getContent()['m.new_content']['com.mindroom.message_extras']).toBeUndefined();
  });
});

describe('roomHaveUnread', () => {
  it('ignores hidden thread-only activity when no visible main-timeline unread remains', () => {
    const threadReply = makeThreadReplyEvent('$thread-reply', 1000);
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => null),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [threadReply],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(false);
  });

  it("ignores another member's reference, such as a canvas's shared state, even when its target is not loaded", () => {
    const sharedState = new MatrixEvent({
      content: { version: 1, 'm.relates_to': { rel_type: 'm.reference', event_id: '$canvas' } },
      event_id: '$copy',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@bob:example.org',
      type: 'io.mindroom.canvas_state',
    });
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => '$older'),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [sharedState],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(false);
  });

  it("counts another member's message that carries a reference as unread", () => {
    const message = new MatrixEvent({
      content: {
        body: 'hello',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: 'm.reference', event_id: '$target' },
      },
      event_id: '$message',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@bob:example.org',
      type: 'm.room.message',
    });
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => '$older'),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [message],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(true);
  });

  it("ignores an agent's background state, reactions and redactions when the read position is not loaded", () => {
    const agent = '@mindroom_mind:example.org';
    const backgroundJobs = new MatrixEvent({
      content: { jobs: [] },
      event_id: '$jobs',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: agent,
      state_key: agent,
      type: 'io.mindroom.background_jobs',
    });
    const reaction = new MatrixEvent({
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$root', key: '👀' } },
      event_id: '$reaction',
      origin_server_ts: 1001,
      room_id: '!room:example.org',
      sender: agent,
      type: 'm.reaction',
    });
    const redaction = new MatrixEvent({
      content: { redacts: '$reaction' },
      event_id: '$redaction',
      origin_server_ts: 1002,
      redacts: '$reaction',
      room_id: '!room:example.org',
      sender: agent,
      type: 'm.room.redaction',
    });
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => null),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [backgroundJobs, reaction, redaction],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(false);
  });

  it("counts another member's message as unread when the read position is not loaded", () => {
    const mainEvent = makeMessageEvent('$main', 1000, '@bob:example.org');
    const room = {
      findEventById: vi.fn(() => undefined),
      getEventReadUpTo: vi.fn(() => '$older'),
      getLiveTimeline: vi.fn(() => ({
        getEvents: () => [mainEvent],
      })),
    } as any;
    const mx = {
      getUserId: vi.fn(() => '@alice:example.org'),
    } as any;

    expect(roomHaveUnread(mx, room)).toBe(true);
  });
});

describe('trimReplyFromBody', () => {
  it('strips a leading reply fallback without backtracking on unclosed ones', () => {
    expect(trimReplyFromBody('> <@a:b> quoted\n> second line\n\nreply')).toBe('reply');
    expect(trimReplyFromBody('> <@a:b> > nested > quote\n\nreply\n\nmore')).toBe('reply\n\nmore');
    expect(trimReplyFromBody('> <@a:b> no blank line\n> quoted\nreply')).toBe(
      '> <@a:b> no blank line\n> quoted\nreply'
    );
    // A quote later in the body is not a fallback; slicing its length off the start garbled it.
    expect(trimReplyFromBody('hi\n> <@a:b> q\n\nr')).toBe('hi\n> <@a:b> q\n\nr');

    // Every `> ` could end the sender and every line could start a fallback, and each try
    // rescanned the rest, so these bodies froze every viewer.
    const unclosedLine = `> <${'> '.repeat(20_000)}`;
    const unclosedLines = '> <a> b\n'.repeat(8_000);
    const start = performance.now();
    expect(trimReplyFromBody(unclosedLine)).toBe(unclosedLine);
    expect(trimReplyFromBody(unclosedLines)).toBe(unclosedLines);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

/** A room whose m.room.create event has the given `type`, or none for an ordinary room. */
const roomOfType = (type?: string) => ({
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (eventType: string) =>
        eventType === 'm.room.create' ? { getContent: () => ({ type }) } : null,
    }),
  }),
});

describe('isRoom', () => {
  it('counts a room without a type', () => {
    expect(isRoom(roomOfType() as never)).toBe(true);
  });

  it('counts a voice room', () => {
    expect(isRoom(roomOfType('org.matrix.msc3417.call') as never)).toBe(true);
  });

  it('does not count a space', () => {
    expect(isRoom(roomOfType('m.space') as never)).toBe(false);
  });

  it('does not count the server emoji room, so it stays out of room lists', () => {
    expect(isRoom(roomOfType('io.mindroom.emoji') as never)).toBe(false);
  });
});

describe('isMindroomEmojiRoom', () => {
  it('matches the server emoji room', () => {
    expect(isMindroomEmojiRoom(roomOfType('io.mindroom.emoji') as never)).toBe(true);
  });

  it('does not match an ordinary room, a voice room or a space', () => {
    expect(isMindroomEmojiRoom(roomOfType() as never)).toBe(false);
    expect(isMindroomEmojiRoom(roomOfType('org.matrix.msc3417.call') as never)).toBe(false);
    expect(isMindroomEmojiRoom(roomOfType('m.space') as never)).toBe(false);
  });

  // Pickers list joined room IDs, and `mx.getRoom` may have no room for one; `isRoom` would drop it.
  it('does not match a room the client does not have', () => {
    expect(isMindroomEmojiRoom(null)).toBe(false);
  });
});
