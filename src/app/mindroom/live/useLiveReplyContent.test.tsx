// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from './liveFrame';
import { loadLiveMarkdown } from './liveMarkdown';
import { getLiveReplyStore, LIVE_REPLY_FRESHNESS_MS } from './liveReplyStore';
import { useLiveReplyContent } from './useLiveReplyContent';
import { isMindroomThinkingPlaceholderBody } from '../messages/thinkingPlaceholder';

const ROOM = '!room:example';
const REPLY = '$reply';
const AGENT = '@agent:example';
const SID = '1761858000123-0a1b2c3d';

const tool = { type: 'tool_call_started', tool_name: 'web_search' };
const snapshot = (
  seq: number,
  md = 'Live **text**',
  reasoning = 'Weighing options'
): LiveFrame => ({
  reply: REPLY,
  sid: SID,
  seq,
  snapshot: {
    md,
    reasoning,
    tools: [tool],
    status: 'streaming',
    activity: 'Preparing isolated worker... 3s elapsed.',
  },
});

const durable = (status: string, extra: Record<string, unknown> = {}): IContent => {
  const newContent = {
    msgtype: 'm.text',
    body: 'Durable',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>Durable</p>',
    'io.mindroom.stream_status': status,
    ...extra,
  };
  return { ...newContent, 'm.new_content': newContent };
};

const replyEvent = (sender = AGENT, unsigned: Record<string, unknown> = {}) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM,
    event_id: REPLY,
    sender,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Thinking...' },
    unsigned,
  });

function Harness({
  mx,
  event,
  content,
}: {
  mx: MatrixClient;
  event: MatrixEvent;
  content: IContent;
}) {
  const { content: shown, live } = useLiveReplyContent(mx, event, content);
  return <pre data-live={live}>{JSON.stringify(shown)}</pre>;
}

describe('useLiveReplyContent', () => {
  let mx: MatrixClient;
  let renderer: ReactTestRenderer | undefined;

  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mx = {} as MatrixClient;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    getLiveReplyStore(mx).clear();
    vi.useRealTimers();
  });

  const store = () => getLiveReplyStore(mx);
  const ingest = (frame: LiveFrame, sender = AGENT, receivedAt = Date.now()) =>
    act(() => store().ingest(ROOM, sender, frame, receivedAt));
  const render = (content: IContent, event = replyEvent()) => {
    act(() => {
      renderer = create(<Harness mx={mx} event={event} content={content} />);
    });
  };
  const rendered = () => {
    const tree = renderer?.toJSON();
    if (!tree || Array.isArray(tree)) throw new Error('Nothing rendered');
    return tree;
  };
  const shown = (): Record<string, unknown> => JSON.parse(rendered().children?.[0] as string);
  const live = () => rendered().props['data-live'];

  it('shows the live state of a fresh entry from the reply sender while the reply streams', () => {
    ingest(snapshot(0));
    render(durable('streaming', { 'com.mindroom.message_extras': { sections: [] } }));

    expect(shown()).toEqual({
      msgtype: 'm.text',
      body: 'Live **text**',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Live <strong>text</strong></p>\n',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.tool_trace': { version: 2, events: [tool] },
      'io.mindroom.live_activity': 'Preparing isolated worker... 3s elapsed.',
      'io.mindroom.live_reasoning': 'Weighing options',
      'com.mindroom.message_extras': { sections: [] },
    });
    expect(live()).toBe(true);
  });

  it('shows the thinking placeholder while the live Markdown is empty', () => {
    ingest(snapshot(0, ''));
    render(durable('pending'));

    expect(shown()).toMatchObject({
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
    });
    expect(shown()).not.toHaveProperty('formatted_body');
  });

  it('follows new frames without a new durable edit', () => {
    ingest(snapshot(0, 'One'));
    render(durable('streaming'));
    ingest({
      reply: REPLY,
      sid: SID,
      seq: 1,
      delta: { md: { at: 3, del: 0, ins: ' two', len: 7 } },
    });

    expect(shown().body).toBe('One two');
  });

  it.each(['completed', 'cancelled', 'error', 'approval_pending'])(
    'lets a durable %s reply win and drops the entry',
    (status) => {
      ingest(snapshot(0));
      render(durable(status));

      expect(shown().body).toBe('Durable');
      expect(live()).toBe(false);
      expect(store().get(ROOM, REPLY)).toBeUndefined();
    }
  );

  it.each([
    ['as new as', 4],
    ['newer than', 5],
  ])('lets a durable checkpoint %s the entry win until a newer frame', (_name, checkpointSeq) => {
    ingest(snapshot(4, 'Frame four'));
    render(
      durable('streaming', { 'io.mindroom.live_checkpoint': { sid: SID, seq: checkpointSeq } })
    );

    expect(shown().body).toBe('Durable');
    expect(live()).toBe(true);

    ingest(snapshot(6, 'Frame six'));
    expect(shown().body).toBe('Frame six');
  });

  it('keeps only the live reasoning over a durable checkpoint that covers the entry', () => {
    const checkpointed = durable('streaming', {
      'io.mindroom.live_checkpoint': { sid: SID, seq: 4 },
    });
    ingest(snapshot(4, 'Frame four'));
    render(checkpointed);

    expect(shown()).toEqual({ ...checkpointed, 'io.mindroom.live_reasoning': 'Weighing options' });
  });

  it('keeps a running call output over a covering checkpoint while the call runs', () => {
    const running = { type: 'tool_call_started', tool_name: 'run_shell_command' };
    const checkpointed = durable('streaming', {
      'io.mindroom.live_checkpoint': { sid: SID, seq: 4 },
      'io.mindroom.tool_trace': { version: 2, events: [running] },
    });
    const frame = snapshot(4);
    ingest({
      ...frame,
      snapshot: { ...frame.snapshot!, tools: [{ ...running, progress: 'step 3' }] },
    });
    render(checkpointed);

    expect(shown()['io.mindroom.tool_trace']).toEqual({
      version: 2,
      events: [{ ...running, progress: 'step 3' }],
    });
  });

  it('shows no output for a call the covering checkpoint shows completed', () => {
    const completed = { type: 'tool_call_completed', tool_name: 'run_shell_command' };
    const checkpointed = durable('streaming', {
      'io.mindroom.live_checkpoint': { sid: SID, seq: 4 },
      'io.mindroom.tool_trace': { version: 2, events: [completed] },
    });
    const frame = snapshot(4);
    ingest({
      ...frame,
      snapshot: {
        ...frame.snapshot!,
        tools: [{ type: 'tool_call_started', tool_name: 'run_shell_command', progress: 'step 3' }],
      },
    });
    render(checkpointed);

    expect(shown()['io.mindroom.tool_trace']).toEqual({ version: 2, events: [completed] });
  });

  it('shows a covering durable checkpoint as it is when the entry has no reasoning', () => {
    const checkpointed = durable('streaming', {
      'io.mindroom.live_checkpoint': { sid: SID, seq: 4 },
    });
    ingest(snapshot(4, 'Frame four', ''));
    render(checkpointed);

    expect(shown()).toEqual(checkpointed);
  });

  describe('a durable progress edit with worker warm-up lines', () => {
    const LINE_ONE = '⏳ Preparing isolated worker for `shell.run_shell_command`... 35s elapsed.';
    const LINE_TWO = '⏳ Preparing isolated worker for `python`... 2s elapsed.';
    const lineHtml = (line: string) => line.replace(/`([^`]+)`/g, '<code>$1</code>');
    const warmingUp = (lines: string[], extra: Record<string, unknown> = {}, text = 'Durable') =>
      durable('streaming', {
        body: `${text}\n\n${lines.join('\n')}`,
        formatted_body: `<p>${text}</p>\n${lines
          .map((line) => `<p>${lineHtml(line)}</p>`)
          .join('')}`,
        'io.mindroom.warmup_suffix': lines.join('\n'),
        ...extra,
      });

    it.each([
      ['one line', [LINE_ONE]],
      ['two lines', [LINE_ONE, LINE_TWO]],
    ])('shows %s below the body, as live frames do', (_name, lines) => {
      render(warmingUp(lines));

      expect(shown()).toMatchObject({
        body: 'Durable',
        formatted_body: '<p>Durable</p>\n',
        'io.mindroom.live_activity': lines.join('\n'),
      });
      expect(shown()).not.toHaveProperty('m.new_content');
    });

    it('moves a failure line whose error the HTML escapes', () => {
      const failure = '⚠️ Worker startup failed for `shell`: can\'t run `a < b & "c"`.';
      const failureHtml =
        '⚠️ Worker startup failed for <code>shell</code>: can&#x27;t run `a &lt; b &amp; &quot;c&quot;`.';
      render(
        durable('streaming', {
          body: `Durable\n\n${failure}`,
          formatted_body: `<p>Durable</p>\n<p>${failureHtml}</p>`,
          'io.mindroom.warmup_suffix': failure,
        })
      );

      expect(shown()).toMatchObject({ body: 'Durable', 'io.mindroom.live_activity': failure });
    });

    it('shows them below the body while its checkpoint covers the live entry', () => {
      ingest(snapshot(4, 'Frame four'));
      render(warmingUp([LINE_ONE], { 'io.mindroom.live_checkpoint': { sid: SID, seq: 4 } }));

      expect(shown()).toMatchObject({
        body: 'Durable',
        'io.mindroom.live_activity': LINE_ONE,
        'io.mindroom.live_reasoning': 'Weighing options',
      });
    });

    it('keeps the thinking placeholder recognizable when the reply has no text yet', () => {
      render(warmingUp([LINE_ONE], {}, 'Thinking...'));

      expect(isMindroomThinkingPlaceholderBody(shown())).toBe(true);
      expect(shown()['io.mindroom.live_activity']).toBe(LINE_ONE);
    });

    it.each([
      ['a body that does not end in the suffix', { body: `${LINE_ONE}\n\nDurable` }],
      ['HTML without the suffix paragraph', { formatted_body: '<p>Durable</p>' }],
      ['HTML whose last paragraph is other text', { formatted_body: '<p>Durable</p><p>Other</p>' }],
      [
        'HTML with fewer paragraphs than lines',
        {
          body: `Durable\n\n${LINE_ONE}\n${LINE_TWO}`,
          formatted_body: `<p>${lineHtml(LINE_ONE)}${lineHtml(LINE_TWO)}</p>`,
          'io.mindroom.warmup_suffix': `${LINE_ONE}\n${LINE_TWO}`,
        },
      ],
      ['no HTML', { formatted_body: undefined }],
      // Resolved edits keep `io.mindroom.*` keys of older edits, so a final edit can carry one.
      [
        'a final edit that kept an older suffix',
        {
          body: 'Done',
          formatted_body: '<p>Done</p>',
          'io.mindroom.stream_status': 'completed',
        },
      ],
    ])('leaves %s as it is', (_name, override) => {
      const content = { ...warmingUp([LINE_ONE]), ...override };
      render(content);

      expect(shown()).toEqual(JSON.parse(JSON.stringify(content)));
    });
  });

  it('keeps the overlay over an older checkpoint', () => {
    ingest(snapshot(4, 'Frame four'));
    render(durable('streaming', { 'io.mindroom.live_checkpoint': { sid: SID, seq: 3 } }));

    expect(shown().body).toBe('Frame four');
  });

  it('keeps the overlay over a checkpoint of an older publisher', () => {
    ingest(snapshot(0, 'Restarted'));
    render(
      durable('streaming', {
        'io.mindroom.live_checkpoint': { sid: '1761858000000-ffffffff', seq: 90 },
      })
    );

    expect(shown().body).toBe('Restarted');
  });

  it('renders the durable reply and drops the entry of another sender', () => {
    ingest(snapshot(0), '@mallory:example');
    render(durable('streaming'));

    expect(shown().body).toBe('Durable');
    expect(store().get(ROOM, REPLY)).toBeUndefined();
  });

  it('renders the durable reply of a redacted event and drops the entry', () => {
    ingest(snapshot(0));
    render(
      durable('streaming'),
      replyEvent(AGENT, { redacted_because: { type: 'm.room.redaction', sender: AGENT } })
    );

    expect(shown().body).toBe('Durable');
    expect(store().get(ROOM, REPLY)).toBeUndefined();
  });

  it('renders the durable reply when the entry is past its freshness', () => {
    ingest(snapshot(0), AGENT, Date.now() - LIVE_REPLY_FRESHNESS_MS);
    render(durable('streaming'));

    expect(shown().body).toBe('Durable');
    expect(store().get(ROOM, REPLY)).toBeUndefined();
  });

  it('returns to the durable reply when the entry expires without any new event', () => {
    ingest(snapshot(0));
    render(durable('streaming'));
    expect(shown().body).toBe('Live **text**');

    act(() => {
      vi.advanceTimersByTime(LIVE_REPLY_FRESHNESS_MS);
    });

    expect(shown().body).toBe('Durable');
  });

  it('uses a frame stored before the reply rendered', () => {
    ingest(snapshot(0, 'Early'));
    vi.advanceTimersByTime(1000);
    render(durable('streaming'));

    expect(shown().body).toBe('Early');
  });
});
