// @vitest-environment jsdom

import React from 'react';
import { EventEmitter } from 'events';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  MatrixEvent,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasPanelProps } from './CanvasPanel';
import type { CanvasSaved } from './canvasDocument';
import { RoomCanvasPanel } from './RoomCanvasPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const panels = vi.hoisted(() => ({ props: undefined as CanvasPanelProps | undefined }));

vi.mock('./CanvasPanel', () => ({
  CanvasPanel: (props: CanvasPanelProps) => {
    panels.props = props;
    return null;
  },
}));
// Uploaded pages download through the media API; these requests carry their page inline.
vi.mock('./useCanvasPage', () => ({
  useCanvasPage: (_mx: unknown, _roomId: string, _revision: string, canvas: { html?: string }) =>
    canvas.html === undefined ? { status: 'loading' } : { status: 'ready', html: canvas.html },
}));
// Saved state is read from IndexedDB; these tests decide when it is ready.
const saved = vi.hoisted(() => ({ ready: true, value: {} as CanvasSaved }));
vi.mock('./useCanvasSavedState', () => ({
  useCanvasSavedState: () => ({
    ready: saved.ready,
    read: () => saved.value,
    save: (change: CanvasSaved) => {
      saved.value = { ...saved.value, ...change };
    },
  }),
}));
// Sharing sends Matrix events; these tests check what the panel asks it to share.
const shares = vi.hoisted(() => ({ enabled: [] as boolean[], saves: [] as CanvasSaved[] }));
vi.mock('./useCanvasStateShare', () => ({
  useCanvasStateShare: (_mx: unknown, _room: unknown, _canvasId: string, enabled: boolean) => {
    shares.enabled.push(enabled);
    return (record: CanvasSaved) => shares.saves.push(record);
  },
}));
vi.mock('../sidebar/ResizablePanel', () => ({
  CONVERSATION_MIN_WIDTH: 360,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../hooks/useTheme', () => ({
  ThemeKind: { Light: 'light', Dark: 'dark' },
  useTheme: () => ({ id: 'light-theme', kind: 'light' }),
}));
vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_planner:example.org';
const VIEWER = '@alice:example.org';

const room = Object.assign(new EventEmitter(), {
  roomId: ROOM_ID,
  getMember: (userId: string) => ({ userId, membership: 'join', rawDisplayName: 'Planner' }),
}) as unknown as Room;

const metadata = (html: string) => ({
  version: 1,
  action: 'show_canvas',
  requester_id: VIEWER,
  agent_user_id: AGENT,
  room_id: ROOM_ID,
  thread_id: '$thread',
  canvas: { title: 'Plans', html },
});

const request = (extra: Record<string, unknown> = {}) =>
  new MatrixEvent({
    event_id: '$canvas',
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: {
      msgtype: 'm.notice',
      body: 'Interactive panel: Plans.',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      'io.mindroom.ui_action': { ...metadata('<p>Step 1</p>'), ...extra },
    },
  });

const edit = (html = '<p>Step 2</p>', { id = '$edit', ts = 2, sender = AGENT } = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.notice',
      body: '* Interactive panel: Plans.',
      'm.new_content': {
        msgtype: 'm.notice',
        body: 'Interactive panel: Plans.',
        'io.mindroom.ui_action': metadata(html),
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas' },
    },
  });

let container: HTMLDivElement;
let root: Root;
let mx: MatrixClient;

const render = (event: MatrixEvent, onClose = vi.fn()) =>
  act(() => {
    root.render(
      <RoomCanvasPanel
        mx={mx}
        room={room}
        event={event}
        onClose={onClose}
        expanded={false}
        onToggleExpanded={() => undefined}
        libraries={false}
      />
    );
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  panels.props = undefined;
  saved.ready = true;
  saved.value = {};
  shares.enabled = [];
  shares.saves = [];
  mx = Object.assign(new EventEmitter(), {
    getSafeUserId: () => VIEWER,
  }) as unknown as MatrixClient;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const history = (event: MatrixEvent, ...pages: MatrixEvent[][]) => {
  const relations = vi.fn();
  pages.forEach((events, index) =>
    relations.mockResolvedValueOnce({
      originalEvent: event,
      events,
      nextBatch: index < pages.length - 1 ? `page-${index + 1}` : null,
    })
  );
  Object.assign(mx, { relations });
  return relations;
};

describe('RoomCanvasPanel', () => {
  it('lists every version of the canvas and shows the one the user picks', async () => {
    const event = request();
    const second = edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 });
    const third = edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 });
    const forged = edit('<p>Forged</p>', {
      id: '$forged',
      ts: 250,
      sender: '@mindroom_x:example.org',
    });
    event.makeReplaced(third);
    const relations = history(event, [third, forged], [second]);
    render(event);
    await act(async () => undefined);
    expect(relations).toHaveBeenCalledWith(ROOM_ID, '$canvas', 'm.replace', 'm.room.message', {
      dir: 'b',
      limit: 50,
    });
    expect(relations).toHaveBeenLastCalledWith(ROOM_ID, '$canvas', 'm.replace', 'm.room.message', {
      dir: 'b',
      limit: 50,
      from: 'page-1',
    });
    expect(panels.props?.version).toEqual({ current: 3, total: 3 });
    act(() => panels.props?.onSelectVersion?.(1));
    expect(panels.props?.canvas).toMatchObject({
      revisionEventId: '$canvas',
      html: '<p>Step 1</p>',
    });
    expect(panels.props?.version).toEqual({ current: 1, total: 3 });
    // A later update adds a version without pulling the user away from the one they chose.
    const fourth = edit('<p>Step 4</p>', { id: '$edit-4', ts: 400 });
    history(event, [fourth, third, second]);
    await act(async () => event.makeReplaced(fourth));
    expect(panels.props?.canvas.revisionEventId).toBe('$canvas');
    expect(panels.props?.version).toEqual({ current: 1, total: 4 });
    act(() => panels.props?.onSelectVersion?.(4));
    expect(panels.props?.canvas.html).toBe('<p>Step 4</p>');
    // The newest version follows updates again.
    const fifth = edit('<p>Step 5</p>', { id: '$edit-5', ts: 500 });
    history(event, [fifth, fourth, third, second]);
    await act(async () => event.makeReplaced(fifth));
    expect(panels.props?.canvas.html).toBe('<p>Step 5</p>');
    expect(panels.props?.version).toEqual({ current: 5, total: 5 });
  });

  it('lists only edits of this canvas', async () => {
    const event = request();
    const second = edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 });
    const elsewhere = edit('<p>Elsewhere</p>', { id: '$elsewhere', ts: 150 });
    (elsewhere.getContent()['m.relates_to'] as { event_id: string }).event_id = '$other';
    event.makeReplaced(second);
    history(event, [elsewhere, second]);
    render(event);
    await act(async () => undefined);
    expect(panels.props?.version).toEqual({ current: 2, total: 2 });
  });

  it('keeps a version deleted while its history was still loading out of the list', async () => {
    const event = request();
    const second = edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 });
    const third = edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 });
    event.makeReplaced(third);
    let finish: (value: unknown) => void = () => undefined;
    const relations = vi
      .fn()
      .mockResolvedValueOnce({ originalEvent: event, events: [third, second], nextBatch: 'page-1' })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
    Object.assign(mx, { relations });
    render(event);
    await act(async () => undefined);
    act(() => {
      room.emit(
        RoomEvent.Timeline,
        new MatrixEvent({ type: 'm.room.redaction', redacts: '$edit-2', content: {} }),
        room,
        false
      );
    });
    await act(async () => finish({ originalEvent: event, events: [], nextBatch: null }));
    expect(panels.props?.version).toEqual({ current: 2, total: 2 });
  });

  it('reaches every listed version when the shown one is not the newest listed', async () => {
    const event = request();
    const second = edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 });
    const third = edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 });
    event.makeReplaced(third);
    history(event, [third, second]);
    render(event);
    await act(async () => undefined);
    // The newest edit is deleted and the client knows no other, so it shows the request again.
    act(() => {
      room.emit(
        RoomEvent.Timeline,
        new MatrixEvent({ type: 'm.room.redaction', redacts: '$edit-3', content: {} }),
        room,
        false
      );
      event.makeReplaced(undefined);
    });
    expect(panels.props?.version).toEqual({ current: 1, total: 2 });
    act(() => panels.props?.onSelectVersion?.(2));
    expect(panels.props?.canvas.html).toBe('<p>Step 2</p>');
  });

  it('keeps the known versions when the history does not reach the shown one', async () => {
    const event = request();
    const second = edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 });
    const third = edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 });
    event.makeReplaced(third);
    history(event, [second]);
    render(event);
    await act(async () => undefined);
    expect(panels.props?.version).toEqual({ current: 2, total: 2 });
    expect(panels.props?.canvas.revisionEventId).toBe('$edit-3');
  });

  it('drops a deleted version, and leaves it for the latest when it was chosen', async () => {
    const event = request();
    const second = edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 });
    const third = edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 });
    event.makeReplaced(third);
    history(event, [third, second]);
    render(event);
    await act(async () => undefined);
    act(() => panels.props?.onSelectVersion?.(2));
    expect(panels.props?.canvas.html).toBe('<p>Step 2</p>');
    act(() => {
      // The edit was only fetched, never loaded, so the timeline is where its deletion shows.
      room.emit(
        RoomEvent.Timeline,
        new MatrixEvent({ type: 'm.room.redaction', redacts: '$edit-2', content: {} }),
        room,
        false
      );
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 3</p>');
    expect(panels.props?.version).toEqual({ current: 2, total: 2 });
  });

  it('offers no versions for a canvas never updated, and the known ones when history fails', async () => {
    const event = request();
    Object.assign(mx, { relations: vi.fn().mockRejectedValue(new Error('offline')) });
    render(event);
    await act(async () => undefined);
    expect(panels.props?.version).toBeUndefined();
    await act(async () => event.makeReplaced(edit()));
    expect(panels.props?.version).toEqual({ current: 2, total: 2 });
    act(() => panels.props?.onSelectVersion?.(1));
    expect(panels.props?.canvas.html).toBe('<p>Step 1</p>');
  });

  it('shares each save of a canvas whose request shares its state, whole, and tells the panel', () => {
    render(request({ share_state: true }));
    expect(shares.enabled.at(-1)).toBe(true);
    expect(panels.props?.shared).toBe(true);
    // The page's own saves before the user works in it are kept but not shared.
    panels.props?.onSaveState?.({ json: '{"done":[]}' }, false);
    expect(shares.saves).toEqual([]);
    panels.props?.onSaveState?.({ json: '{"done":["tent"]}' }, true);
    panels.props?.onSaveState?.({ inputs: '{"#rate":"7"}' }, true);
    expect(shares.saves.at(-1)).toEqual({ json: '{"done":["tent"]}', inputs: '{"#rate":"7"}' });

    act(() => root.unmount());
    root = createRoot(container);
    render(request());
    expect(shares.enabled.at(-1)).toBe(false);
    expect(panels.props?.shared).toBe(false);
  });

  it('starts the page only once its saved state is read', () => {
    saved.ready = false;
    saved.value = { json: '{"slots":[1]}', inputs: '{"#rate":"7"}' };
    render(request());
    expect(panels.props?.canvas).toMatchObject({ html: '', status: 'loading' });
    saved.ready = true;
    render(request());
    expect(panels.props?.canvas.html).toBe('<p>Step 1</p>');
    expect(panels.props?.canvas.status).toBeUndefined();
    expect(panels.props?.savedState?.()).toEqual({
      json: '{"slots":[1]}',
      inputs: '{"#rate":"7"}',
    });
    // Saving one part keeps the other.
    panels.props?.onSaveState?.({ inputs: '{"#rate":"8"}' }, true);
    expect(panels.props?.savedState?.()).toEqual({
      json: '{"slots":[1]}',
      inputs: '{"#rate":"8"}',
    });
  });

  it('shows the request and follows its edits', () => {
    const event = request();
    render(event);
    expect(panels.props?.canvas.html).toBe('<p>Step 1</p>');
    act(() => event.makeReplaced(edit()));
    expect(panels.props?.canvas.html).toBe('<p>Step 2</p>');
    expect(panels.props?.canvas.revisionEventId).toBe('$edit');
  });

  it('follows an edit that lands on another copy of the request', () => {
    render(request());
    // A reset timeline or cached thread page can hold a different object for the same event.
    const copy = request();
    copy.makeReplaced(edit());
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, copy);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 2</p>');
  });

  it('never rolls back to an older edit or an edit from someone else on another copy', () => {
    const event = request();
    render(event);
    act(() => event.makeReplaced(edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 })));
    const older = request();
    older.makeReplaced(edit('<p>Step 2</p>', { id: '$edit-2', ts: 200 }));
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, older);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 3</p>');
    const foreign = request();
    foreign.makeReplaced(
      edit('<p>Forged</p>', { id: '$forged', ts: 400, sender: '@mindroom_other:example.org' })
    );
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, foreign);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 3</p>');
    expect(panels.props?.canvas.revisionEventId).toBe('$edit-3');
  });

  it('ignores a newer copy whose edit the protocol rejects', () => {
    const event = request();
    render(event);
    act(() => event.makeReplaced(edit('<p>Step 3</p>', { id: '$edit-3', ts: 300 })));
    const broken = request();
    const invalid = edit('<p>Broken</p>', { id: '$edit-4', ts: 400 });
    (invalid.getContent()['m.new_content'] as Record<string, Record<string, unknown>>)[
      'io.mindroom.ui_action'
    ].canvas = { title: '', html: '<p>Broken</p>' };
    broken.makeReplaced(invalid);
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, broken);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 3</p>');
    expect(panels.props?.canvas.revisionEventId).toBe('$edit-3');
  });

  it('breaks a same-millisecond tie between edits by event ID, like Matrix', () => {
    const event = request();
    render(event);
    act(() => event.makeReplaced(edit('<p>A</p>', { id: '$edit-a', ts: 300 })));
    const copy = request();
    copy.makeReplaced(edit('<p>B</p>', { id: '$edit-b', ts: 300 }));
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, copy);
    });
    expect(panels.props?.canvas.html).toBe('<p>B</p>');
  });

  it('closes when another copy of the request is deleted', async () => {
    const onClose = vi.fn();
    render(request(), onClose);
    const copy = request();
    await act(async () => {
      room.emit(
        MatrixEventEvent.BeforeRedaction,
        copy,
        new MatrixEvent({ type: 'm.room.redaction' })
      );
      copy.makeRedacted(
        new MatrixEvent({ type: 'm.room.redaction', redacts: '$canvas', content: {} }),
        room
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores edits of other events', () => {
    render(request());
    const other = new MatrixEvent({ ...request().event, event_id: '$other' });
    other.makeReplaced(edit());
    act(() => {
      mx.emit(MatrixEventEvent.Replaced, other);
    });
    expect(panels.props?.canvas.html).toBe('<p>Step 1</p>');
  });

  it('closes when the request is deleted', async () => {
    const onClose = vi.fn();
    const event = request();
    render(event, onClose);
    await act(async () => {
      event.emit(
        MatrixEventEvent.BeforeRedaction,
        event,
        new MatrixEvent({ type: 'm.room.redaction' })
      );
      event.makeRedacted(
        new MatrixEvent({ type: 'm.room.redaction', redacts: '$canvas', content: {} }),
        room
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
