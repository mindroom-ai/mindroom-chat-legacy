// @vitest-environment jsdom
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { act, create } from 'react-test-renderer';
import { createClient, Room } from 'matrix-js-sdk';
import { createEditor } from 'slate';
import { expect, it, vi } from 'vitest';
import { RoomView } from './MindroomRoomView';
import { RoomViewTyping } from '../../features/room/RoomViewTyping';
import { useRoomInputSendSessionController } from './useRoomInputSendSessionController';
import { TUploadItem } from '../../state/room/roomInputDrafts';
import { Upload, UploadStatus } from '../../state/upload';
import type { RoomInputAttachmentAccess } from '../room-input/roomInputAttachmentAccess';

const jobsBar = vi.hoisted(() => ({
  canCancel: true,
  props: [] as { threadId: string | null; canCancel: boolean }[],
}));
const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');
mx.store.storeRoom(room);
const editor = createEditor();
const ignored: string[] = [];
const scheduler = { abort: vi.fn() };
const noop = () => undefined;
let navigate: (id: string) => void;
let completeUpload: () => void;
let api: ReturnType<typeof useRoomInputSendSessionController>;
let mounts = 0;
const first = new File(['first'], 'first.png');
const second = new File(['second'], 'second.png');
const item = (file: File): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
  metadata: { markedAsSpoiler: false },
});
const ready = (file: File): Upload => ({
  file,
  status: UploadStatus.Success,
  mxc: `mxc://example.org/${file.name}`,
});

vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  Box: 'div',
  Text: 'span',
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../hooks/useIgnoredUsers', () => ({ useIgnoredUsers: () => ignored }));
vi.mock('../engine', () => ({
  enqueueThreadApprovalBackfill: async () => ({ events: [], repairedEventIds: [] }),
  useMindroomSyncEngine: () => ({ scheduler }),
}));
vi.mock('./roomLiveEventArrive', () => ({ useLiveEventArrive: () => undefined }));
vi.mock('../../hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => [] }));
vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: (type: string) => type !== 'io.mindroom.background_job_cancel' || jobsBar.canCancel,
  }),
}));
vi.mock('../../hooks/useKeyDown', () => ({ useKeyDown: () => undefined }));
vi.mock('../../state/hooks/settings', () => ({ useSetting: () => [false] }));
vi.mock('../../components/editor', () => ({ useEditor: () => editor }));
vi.mock('../../components/editor/utils', () => ({
  resetEditor: vi.fn(),
  resetEditorHistory: vi.fn(),
  restoreEditorContent: vi.fn(),
}));
vi.mock('../../components/page', () => ({ Page: 'div' }));
vi.mock('../../features/room/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../../features/room/RoomViewFollowing', () => ({
  RoomViewFollowing: () => null,
  RoomViewFollowingPlaceholder: () => null,
}));
vi.mock('../../features/room/RoomInputPlaceholder', () => ({ RoomInputPlaceholder: 'div' }));
vi.mock('../../features/room/RoomTombstone', () => ({ RoomTombstone: () => null }));
vi.mock('./MindroomRoomViewHeader', () => ({ RoomViewHeader: () => null }));
vi.mock('./ThreadContextBanner', () => ({ ThreadContextBanner: () => null }));
vi.mock('./MindroomRoomTimeline', () => ({ RoomTimeline: () => null }));
vi.mock('../messages/ThreadApprovalControls', () => ({ ThreadApprovalQueue: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({
  BackgroundJobsBar: (props: { threadId: string | null; canCancel: boolean }) => {
    jobsBar.props.push({ threadId: props.threadId, canCancel: props.canCancel });
    return null;
  },
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: ({ threadId }: { threadId?: string }) => ({
    effectiveThreadId: threadId,
    viewMode: 'compact',
    handleRoomMessageSent: (id: string) => {
      if (!threadId) navigate(id);
    },
  }),
}));
vi.mock('../room-input/MindroomRoomInput', () => ({ RoomInput: React.forwardRef(Composer) }));

function Composer(
  { threadId, onRoomMessageSent }: { threadId?: string; onRoomMessageSent?: (id: string) => void },
  _ref: React.ForwardedRef<HTMLDivElement>
) {
  const selectedFilesRef = useRef([item(first), item(second)]);
  const uploadsRef = useRef<Upload[]>([
    ready(first),
    {
      file: second,
      status: UploadStatus.Loading,
      promise: Promise.resolve({ content_uri: 'mxc://example.org/second.png' }),
      progress: { loaded: 0, total: second.size },
    },
  ]);
  const [version, setVersion] = useState(0);
  const enrolledRef = useRef<TUploadItem[]>([]);
  const listenersRef = useRef(new Set<() => void>());
  const attachments = useMemo<RoomInputAttachmentAccess>(
    () => ({
      snapshot: () => ({
        staged: [...selectedFilesRef.current],
        enrolled: [...enrolledRef.current],
        uploads: [...uploadsRef.current],
      }),
      append: (_roomId, items) => {
        selectedFilesRef.current = [...selectedFilesRef.current, ...items];
        setVersion((value) => value + 1);
      },
      remove: (_roomId, files) => {
        selectedFilesRef.current = selectedFilesRef.current.filter(
          (value) => !files.includes(value.file)
        );
        enrolledRef.current = enrolledRef.current.filter((value) => !files.includes(value.file));
        uploadsRef.current = uploadsRef.current.filter((value) => !files.includes(value.file));
        setVersion((value) => value + 1);
      },
      enroll: (items) => {
        enrolledRef.current = [...items];
        setVersion((value) => value + 1);
      },
      clearEnrollment: () => {
        enrolledRef.current = [];
        setVersion((value) => value + 1);
      },
      protectPasteItems: () => noop,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    []
  );
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) listenersRef.current.forEach((listener) => listener());
    });
    return () => {
      disposed = true;
    };
  }, [version]);
  const controller = useRoomInputSendSessionController({
    mx,
    room,
    roomId: room.roomId,
    threadId,
    editor,
    clearReplyDraft: noop,
    sendTypingStatus: noop,
    attachments,
    buildUploadMessageContent: async (fileItem, url) => ({
      msgtype: 'm.file',
      body: fileItem.file.name,
      url,
    }),
    onRoomMessageSent,
  });
  useEffect(() => {
    mounts += 1;
  }, []);
  useEffect(() => {
    api = controller;
    completeUpload = () => {
      uploadsRef.current = [ready(second)];
      setVersion((value) => value + 1);
    };
  }, [controller]);
  return null;
}

it('continues the pending second upload and caption when the first upload opens its thread', async () => {
  let sent = 0;
  const send = vi
    .spyOn(mx, 'sendMessage')
    .mockImplementation(async () => ({ event_id: `$sent-${++sent}` }));
  function Conversation() {
    const [threadId, setThreadId] = useState<string>();
    navigate = setThreadId;
    return <RoomView room={room} threadId={threadId} />;
  }
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(<Conversation />);
    });
    await act(async () => {
      await api.startSendSession({ textContent: { msgtype: 'm.text', body: 'caption' } });
    });
    expect(send.mock.calls.map((call) => call[1].body)).toEqual(['first.png']);
    await act(async () => completeUpload());
    expect(send.mock.calls.map((call) => call[1].body)).toEqual([
      'first.png',
      'second.png',
      'caption',
    ]);
    expect(mounts).toBe(1);
    expect(send.mock.calls[1][1]['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
      event_id: '$sent-1',
    });
    expect(send.mock.calls[2][1]['m.relates_to']).toMatchObject({
      rel_type: 'm.thread',
      event_id: '$sent-1',
    });
  } finally {
    act(() => renderer?.unmount());
    send.mockRestore();
  }
});

it('gives the jobs bar the open thread and whether the viewer may send a cancel', async () => {
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(<RoomView room={room} threadId="$thread" />);
    });
    expect(jobsBar.props.at(-1)).toEqual({ threadId: '$thread', canCancel: true });
    jobsBar.canCancel = false;
    await act(async () => {
      renderer.update(<RoomView room={room} />);
    });
    expect(jobsBar.props.at(-1)).toEqual({ threadId: null, canCancel: false });
  } finally {
    jobsBar.canCancel = true;
    act(() => renderer?.unmount());
  }
});

it('shows the room-wide typing bar on the main timeline only', async () => {
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => {
      renderer = create(<RoomView room={room} threadId="$thread" />);
    });
    expect(renderer.root.findAllByType(RoomViewTyping)).toHaveLength(0);
    await act(async () => {
      renderer.update(<RoomView room={room} />);
    });
    expect(renderer.root.findAllByType(RoomViewTyping)).toHaveLength(1);
  } finally {
    act(() => renderer?.unmount());
  }
});

vi.mock('../engine/engineContext', () => ({
  useMindroomSyncEngine: () => ({
    noteRoomFocused: () => undefined,
    clearRoomFocus: () => undefined,
  }),
}));
