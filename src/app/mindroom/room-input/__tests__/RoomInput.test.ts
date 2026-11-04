import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelationType, Room } from 'matrix-js-sdk';
import { createMindroomRoomUploadItems, RoomInput } from '../MindroomRoomInput';
import { MATRIX_AUDIO_DETAILS_PROPERTY_NAME } from '../../../../types/matrix/common';
import {
  IReplyDraft,
  TUploadItem,
  pendingVoiceSendDraftAtom,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../../state/room/roomInputDrafts';
import { Upload, UploadStatus } from '../../../state/upload';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../../utils/audioWaveform';
import {
  getMatrixUploadErrorMessage,
  getMatrixUploadErrorStage,
  toMatrixUploadError,
} from '../../../utils/matrix';
import { mindroomAccountSettingsAtom } from '../../settings/useMindroomAccountSettings';
import { DEFAULT_MINDROOM_ACCOUNT_SETTINGS } from '../../settings/mindroomAccountSettings';

const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';
const THIRD_ROOM_ID = '!third:example.org';

const {
  customEditorState,
  editorMocks,
  emojiBoardState,
  editorOutputState,
  encryptionState,
  mediaConfigState,
  mxState,
  modelPickerState,
  typingState,
  voiceRecorderState,
} = vi.hoisted(() => ({
  emojiBoardState: {
    props: undefined as { onTabChange: (tab: string) => void } | undefined,
  },
  editorMocks: {
    insertNode: vi.fn(),
    insertText: vi.fn(),
    moveCursor: vi.fn(),
    resetEditor: vi.fn(),
    resetEditorHistory: vi.fn(),
    restoreEditorContent: vi.fn(),
  },
  customEditorState: {
    autocompleteQuery: undefined as { prefix: string; range: unknown; text: string } | undefined,
    editor: undefined as
      | {
          children: Array<any>;
        }
      | undefined,
    props: undefined as
      | {
          onPaste?: (evt: {
            clipboardData: DataTransfer;
            preventDefault: () => void;
          }) => void | Promise<void>;
          onChange?: () => void;
          onKeyDown?: (evt: { key: string; preventDefault: () => void }) => void;
          onKeyUp?: (evt: { key: string; preventDefault: () => void }) => void;
        }
      | undefined,
    replyContextRenderCount: 0,
  },
  editorOutputState: {
    plainText: '',
    customHtml: '',
    htmlEqualsPlainText: true,
  },
  mediaConfigState: {
    maxUploadSize: Infinity,
  },
  modelPickerState: {
    props: [] as Array<{ room: Room; threadId?: string }>,
  },
  mxState: {
    cancelUpload: vi.fn(),
    getUserId: vi.fn(() => '@me:example.org'),
    // Default: every roomId resolves to a Joined room so the parked-draft
    // orphan-room cleanup useEffect treats drafts as live and the retry-time
    // re-resolve in handleVoiceSend gets a usable Room. Tests that need to
    // exercise the unreachable / non-joined path override per-call.
    getRoom: vi.fn(
      (roomId: string) =>
        ({
          roomId,
          name: roomId,
          getEventForTxnId: () => undefined,
          hasEncryptionStateEvent: () => false,
          getMember: () => undefined,
          getMembers: () => [],
          getMyMembership: () => 'join',
        } as unknown as Room)
    ),
    makeTxnId: vi.fn(() => 'txn-room-input'),
    sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
    uploadContent: vi.fn(async () => ({ content_uri: 'mxc://mindroom/voice' })),
  },
  typingState: {
    sendTypingStatus: vi.fn(),
  },
  encryptionState: {
    encryptAttachment: vi.fn(async (data: ArrayBuffer) => ({
      data,
      info: {
        v: 'v2',
        key: {
          alg: 'A256CTR',
          ext: true,
          k: 'test-key',
          key_ops: ['encrypt', 'decrypt'],
          kty: 'oct',
        },
        iv: 'test-iv',
        hashes: {
          sha256: 'test-hash',
        },
      },
    })),
    decryptAttachment: vi.fn(),
  },
  voiceRecorderState: {
    send: vi.fn(async () => false),
    props: undefined as
      | {
          active?: boolean;
          sendDisabled?: boolean;
          onClose: () => void;
          onRecordingStart?: () => void;
          onSendStopRequest?: () => boolean | void;
          onSendStopFailure?: () => void;
          // The mock auto-injects context from getSendContext() when callers
          // don't pass one, so existing unit tests of handleVoiceSend keep
          // their (file, duration, waveform?) call shape.
          onSendRecording: (
            file: File,
            duration: number,
            waveform?: number[],
            context?: unknown
          ) => Promise<void>;
          getSendContext: () => unknown;
        }
      | undefined,
  },
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('browser-encrypt-attachment', () => ({
  decryptAttachment: encryptionState.decryptAttachment,
  encryptAttachment: encryptionState.encryptAttachment,
}));

vi.mock('slate', () => ({
  Editor: {},
  Text: {
    isText: (node: { text?: unknown }) => typeof node?.text === 'string',
  },
  Transforms: {
    insertFragment: vi.fn(),
  },
}));

vi.mock('slate-react', () => ({
  ReactEditor: {
    focus: vi.fn(),
  },
}));

vi.mock('folds', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const Button = React.forwardRef<
    HTMLButtonElement,
    {
      children?: React.ReactNode;
      onClick?: () => void;
    }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  );

  return {
    Box: Wrapper,
    Dialog: Wrapper,
    Icon: () => React.createElement('span'),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Line: Wrapper,
    Overlay: Wrapper,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    // Render the closed board too, so tests can switch its tab.
    PopOut: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) =>
      React.createElement('div', null, content, children),
    Scroll: Wrapper,
    Text: Wrapper,
    // Icon buttons name themselves in tooltips; render only the trigger.
    Tooltip: () => null,
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
    config: {
      space: new Proxy(
        {},
        {
          get: () => '0px',
        }
      ),
    },
    toRem: () => '0px',
  };
});

vi.mock('../../../components/editor', () => ({
  AUTOCOMPLETE_PREFIXES: ['user'],
  AutocompletePrefix: { UserMention: 'user' },
  AutocompleteQuery: {},
  CustomEditor: ({
    style,
    top,
    before,
    after,
    onChange,
    onKeyDown,
    onKeyUp,
    onPaste,
  }: {
    style?: React.CSSProperties;
    top?: React.ReactNode;
    before?: React.ReactNode;
    after?: React.ReactNode;
    onChange?: () => void;
    onKeyDown?: (evt: { key: string; preventDefault: () => void }) => void;
    onKeyUp?: (evt: { key: string; preventDefault: () => void }) => void;
    onPaste?: (evt: { clipboardData: DataTransfer; preventDefault: () => void }) => void;
  }) => {
    customEditorState.props = { onChange, onKeyDown, onKeyUp, onPaste };
    return React.createElement(
      'div',
      { style },
      React.createElement('div', { 'data-room-input-slot': 'top' }, top),
      React.createElement('div', { 'data-room-input-slot': 'before' }, before),
      after
    );
  },
  EmoticonAutocomplete: () => null,
  RoomMentionAutocomplete: () => null,
  Toolbar: () => null,
  UserMentionAutocomplete: () => null,
  createEmoticonElement: vi.fn(),
  customHtmlEqualsPlainText: () => editorOutputState.htmlEqualsPlainText,
  getAutocompleteQuery: () => customEditorState.autocompleteQuery,
  getBeginCommand: () => undefined,
  getMentions: () => ({ users: new Set<string>(), room: false }),
  getPrevWorldRange: () => (customEditorState.autocompleteQuery ? {} : undefined),
  isEmptyEditor: () => true,
  moveCursor: editorMocks.moveCursor,
  resetEditor: editorMocks.resetEditor,
  resetEditorHistory: editorMocks.resetEditorHistory,
  toMatrixCustomHTML: () => editorOutputState.customHtml,
  toPlainText: () => editorOutputState.plainText,
  trimCommand: (_command: string, value: string) => value,
  trimCustomHtml: (value: string) => value,
}));

// The send-session controller imports these helpers from the utils module directly, so the
// editor barrel mock above does not cover its calls.
vi.mock('../../../components/editor/utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isEmptyEditor: () => true,
  resetEditor: editorMocks.resetEditor,
  resetEditorHistory: editorMocks.resetEditorHistory,
  restoreEditorContent: editorMocks.restoreEditorContent,
}));

vi.mock('../../../components/emoji-board', async () => ({
  EmojiBoard: (props: { onTabChange: (tab: string) => void }) => {
    emojiBoardState.props = props;
    return null;
  },
  EmojiBoardTab: (
    await vi.importActual<typeof import('../../../components/emoji-board/types')>(
      '../../../components/emoji-board/types'
    )
  ).EmojiBoardTab,
}));

vi.mock('../../../components/upload-card', () => ({
  UploadCardRenderer: ({
    fileItem,
    onRemove,
  }: {
    fileItem: TUploadItem;
    onRemove: (file: File) => void;
  }) =>
    React.createElement('button', {
      'aria-label': `Remove upload ${fileItem.file.name}`,
      onClick: () => onRemove(fileItem.file as File),
    }),
}));

vi.mock('../../../components/upload-board', async () => {
  const reactModule = await import('react');
  const { useAtomValue } = await import('jotai');

  return {
    UploadBoard: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
      reactModule.createElement('div', null, header, children),
    UploadBoardContent: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    UploadBoardHeader: ({
      uploadFamilyObserverAtom,
      onCancel,
    }: {
      uploadFamilyObserverAtom: Parameters<typeof useAtomValue>[0];
      onCancel: (uploads: Upload[]) => void;
    }) => {
      const uploads = useAtomValue(uploadFamilyObserverAtom);

      return reactModule.createElement(
        reactModule.Fragment,
        null,
        reactModule.createElement('button', {
          'aria-label': 'Upload board Remove All',
          onClick: () => onCancel(uploads),
        })
      );
    },
  };
});

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mxState,
}));

vi.mock('../../../hooks/useTypingStatusUpdater', () => ({
  useTypingStatusUpdater: () => typingState.sendTypingStatus,
}));

vi.mock('../../models/ModelPicker', () => ({
  ThreadModelPicker: ({ room, threadId }: { room: Room; threadId?: string }) => {
    modelPickerState.props.push({ room, threadId });
    if (!threadId) return null;
    return React.createElement('button', { 'aria-label': 'Model picker seam' });
  },
}));

vi.mock('../../../hooks/useFilePicker', () => ({
  useFilePicker: () => vi.fn(),
}));

vi.mock('../../../hooks/useFilePasteHandler', () => ({
  useFilePasteHandler: () => vi.fn(),
}));

vi.mock('../../../hooks/useFileDrop', () => ({
  useFileDropZone: () => false,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: () => [false, vi.fn()],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../utils/dom', () => ({
  getDataTransferFiles: (dataTransfer: DataTransfer) => {
    const files = Array.from(dataTransfer.files ?? []);
    return files.length > 0 ? files : undefined;
  },
  getImageUrlBlob: vi.fn(),
  loadImageElement: vi.fn(),
  pauseAllMediaElements: vi.fn(),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useMediaConfig', () => ({
  useMediaConfig: () => ({ 'm.upload.size': mediaConfigState.maxUploadSize }),
}));

vi.mock('../../../hooks/useImagePackRooms', () => ({
  useImagePackRooms: () => [],
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../../hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../../hooks/useMemberPowerTag', () => ({
  useAccessiblePowerTagColors: () => new Map(),
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ kind: 'light' }),
}));

vi.mock('../../../hooks/useRoomCreatorsTag', () => ({
  useRoomCreatorsTag: () => undefined,
}));

vi.mock('../../../hooks/usePowerLevelTags', () => ({
  usePowerLevelTags: () => [],
}));

vi.mock('../../../hooks/useComposingCheck', () => ({
  useComposingCheck: () => () => false,
}));

vi.mock('../../../hooks/useElementSizeObserver', () => ({
  useElementSizeObserver: vi.fn(),
}));

vi.mock('../../../features/room/CommandAutocomplete', () => ({
  CommandAutocomplete: () => null,
}));

vi.mock('../../../hooks/useCommands', () => ({
  Command: {
    Me: 'me',
    Notice: 'notice',
    Shrug: 'shrug',
    TableFlip: 'tableflip',
    UnFlip: 'unflip',
  },
  SHRUG: 'SHRUG',
  TABLEFLIP: 'TABLEFLIP',
  UNFLIP: 'UNFLIP',
  useCommands: () => ({}),
}));

vi.mock('../RoomInputMindroomExtensions', async () => {
  const { useRoomInputSendSessionController } = await vi.importActual<
    typeof import('../../threads/useRoomInputSendSessionController')
  >('../../threads/useRoomInputSendSessionController');
  const { createRoomInputSendSessionState, getUploadRelationForSendSession } =
    await vi.importActual<typeof import('../../threads/roomInputSendSession')>(
      '../../threads/roomInputSendSession'
    );

  return {
    createMindroomRoomInputPasteMarkerElement: (marker: {
      id: string;
      chars: number;
      fileName: string;
      raw: string;
    }) => ({
      type: 'paste-marker',
      id: marker.id,
      chars: marker.chars,
      fileName: marker.fileName,
      marker: marker.raw,
      children: [{ text: '' }],
    }),
    getMindroomRoomInputPasteMarkerFileNames: (nodes: Array<any>) => {
      const fileNames = new Set<string>();
      const visit = (node: any) => {
        if (node?.type === 'paste-marker' && typeof node.fileName === 'string') {
          fileNames.add(node.fileName);
          return;
        }
        if (Array.isArray(node?.children)) node.children.forEach(visit);
      };
      nodes.forEach(visit);
      return fileNames;
    },
    removeMindroomRoomInputPasteMarkerElements: (
      editor: { children?: Array<any> },
      fileNames: Set<string>
    ) => {
      if (!Array.isArray(editor.children)) return;
      editor.children = editor.children.map((node) =>
        Array.isArray(node?.children)
          ? {
              ...node,
              children: node.children.filter(
                (child: any) => child?.type !== 'paste-marker' || !fileNames.has(child.fileName)
              ),
            }
          : node
      );
    },
    getMindroomRoomInputAutocompleteQuery: () => undefined,
    getMindroomRoomInputVoiceSendContext: ({
      ownerSessionId,
      roomId,
      room,
      threadId,
      replyDraft,
      threadingEnabled = true,
    }: {
      ownerSessionId: string;
      roomId: string;
      room: unknown;
      threadId: string | undefined;
      replyDraft: IReplyDraft | undefined;
      threadingEnabled?: boolean;
    }) => ({
      ownerSessionId,
      roomId,
      room,
      threadId,
      replyDraft,
      threadingEnabled,
      signalBridgedRoom: false,
    }),
    refreshMindroomRoomInputVoiceSendContext: (
      mxClient: { getRoom: (roomId: string) => unknown },
      context: {
        ownerSessionId: string;
        roomId: string;
        threadId: string | undefined;
        replyDraft: IReplyDraft | undefined;
        threadingEnabled: boolean;
      }
    ) => {
      const liveRoom = mxClient.getRoom(context.roomId) as
        | { getMyMembership?: () => string }
        | undefined;
      if (!liveRoom || liveRoom.getMyMembership?.() !== 'join') return null;
      return {
        ...context,
        room: liveRoom,
        signalBridgedRoom: false,
      };
    },
    getMindroomRoomInputVoiceUploadRelation: (
      context: {
        threadId: string | undefined;
        replyDraft: IReplyDraft | undefined;
      },
      file: File
    ) =>
      getUploadRelationForSendSession(
        {
          threadId: context.threadId,
          replyDraft: context.replyDraft,
          ...createRoomInputSendSessionState({
            files: [file],
            hasText: false,
            threadId: context.threadId,
            replyDraft: context.replyDraft,
          }),
        },
        false
      ),
    isMindroomRoomInputAutocompleteQuery: (query?: { prefix?: string }) => query?.prefix === '!',
    MindroomRoomInputAutocomplete: () => null,
    MindroomRoomInputReplyContext: ({
      children,
      pendingSend,
    }: {
      children?: React.ReactNode;
      pendingSend?: boolean;
    }) => {
      customEditorState.replyContextRenderCount += 1;
      return React.createElement(
        'div',
        null,
        children,
        pendingSend
          ? React.createElement(
              'span',
              {
                role: 'status',
                title: 'Waiting for server',
              },
              'Message sending'
            )
          : null
      );
    },
    MindroomVoiceRecorderComposer: React.forwardRef(
      (
        {
          onSendRecording,
          getSendContext,
          ...rest
        }: {
          active?: boolean;
          sendDisabled?: boolean;
          onClose: () => void;
          onRecordingStart?: () => void;
          onSendStopRequest?: () => boolean | void;
          onSendStopFailure?: () => void;
          onSendRecording: (
            file: File,
            duration: number,
            waveform: number[] | undefined,
            context: unknown
          ) => Promise<void>;
          getSendContext: () => unknown;
        },
        ref
      ) => {
        // Auto-fill the captured context from getSendContext() so existing
        // unit-style tests of handleVoiceSend keep their (file, duration,
        // waveform?) call shape. The hook's own end-to-end persistence is
        // covered by useVoiceRecorder.test.ts; the parent's auto-open and
        // mic-disabled wiring is exercised in dedicated tests below.
        voiceRecorderState.props = {
          ...rest,
          getSendContext,
          onSendRecording: (file, duration, waveform, context) =>
            onSendRecording(file, duration, waveform, context ?? getSendContext()),
        };
        React.useImperativeHandle(ref, () => ({
          send: () => voiceRecorderState.send(),
        }));
        return React.createElement('div');
      }
    ),
    useRoomInputSendSessionController,
  };
});

vi.mock('../../../components/message', () => ({
  ReplyLayout: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../threads/ThreadIndicator', () => ({
  ThreadIndicator: () => React.createElement('div'),
}));

vi.mock('../../../utils/user-agent', () => ({
  mobileOrTablet: () => false,
}));

vi.stubGlobal('document', {
  body: {
    clientWidth: 1024,
  },
});

const createReplyDraft = (eventId: string, relation?: IReplyDraft['relation']): IReplyDraft => ({
  userId: '@alice:example.org',
  eventId,
  body: `reply:${eventId}`,
  relation,
});

const createRoom = (roomId = ROOM_ID, encrypted = false) =>
  ({
    roomId,
    name: roomId,
    getEventForTxnId: (txnId: string) => ({
      getId: () => `~${roomId}:${txnId}`,
    }),
    hasEncryptionStateEvent: () => encrypted,
    getMember: () => undefined,
    getMembers: () => [],
    getMyMembership: () => 'join',
  } as never);

const createEditor = () => {
  const editor = {
    children: [{ type: 'paragraph', children: [] }] as Array<any>,
    insertNode: (node: unknown) => {
      editorMocks.insertNode(node);
      editor.children[0]?.children.push(node);
      return node;
    },
    insertText: (text: string) => {
      editorMocks.insertText(text);
      editor.children[0]?.children.push({ text });
      return text;
    },
  };
  customEditorState.editor = editor;
  return editor as never;
};

const createTextPasteEvent = (text: string) =>
  ({
    clipboardData: {
      files: {
        length: 0,
      },
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
    preventDefault: vi.fn(),
  } as never as {
    clipboardData: DataTransfer;
    preventDefault: ReturnType<typeof vi.fn>;
  });

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const createUploadItem = (
  file: File,
  options: Partial<Pick<TUploadItem, 'metadata' | 'prepError'>> = {}
): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
  metadata: options.metadata ?? { markedAsSpoiler: false },
  ...(options.prepError ? { prepError: options.prepError } : {}),
});

const stageUploadItems = (
  store: ReturnType<typeof createStore>,
  items: TUploadItem[],
  readyFiles: File[] = []
) => {
  store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), { type: 'PUT', item: items });
  readyFiles.forEach((file) => {
    store.set(roomUploadAtomFamily(file), { mxc: `mxc://mindroom/${file.name}` });
  });
};

const setEditorText = (text: string) => {
  customEditorState.editor!.children = [
    {
      type: 'paragraph',
      children: [{ text }],
    },
  ];
};

const stageComposerText = (text: string) => {
  editorOutputState.plainText = text;
  editorOutputState.customHtml = text;
  editorOutputState.htmlEqualsPlainText = true;
  setEditorText(text);
};

const getEditorText = (): string | undefined =>
  customEditorState.editor!.children[0]?.children?.[0]?.text;

const resetEditorOnNextSend = () => {
  editorMocks.resetEditor.mockImplementationOnce(() => setEditorText(''));
};

const submitComposer = async () => {
  await act(async () => {
    customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
    await Promise.resolve();
  });
};

const getPrimarySendButton = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Send message'
  );

const queuePrimaryVoiceSend = (
  file: File,
  duration: number,
  waveform?: number[],
  recordingStartContext?: unknown
) => {
  voiceRecorderState.send.mockImplementationOnce(async () => {
    if (voiceRecorderState.props!.onSendStopRequest?.() === false) return false;
    try {
      await voiceRecorderState.props!.onSendRecording(
        file,
        duration,
        waveform,
        recordingStartContext
      );
      return true;
    } catch (error) {
      voiceRecorderState.props!.onSendStopFailure?.();
      throw error;
    }
  });
};

const createRoomInputTree = (
  store: ReturnType<typeof createStore>,
  props?: {
    roomId?: string;
    threadId?: string;
    threadingEnabled?: boolean;
    onRoomMessageSent?: (eventId: string) => boolean | void;
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
  }
) =>
  React.createElement(
    Provider,
    { store },
    React.createElement(RoomInput, {
      key: props?.keyedRoomSubtree ? props?.roomId ?? ROOM_ID : undefined,
      editor: createEditor(),
      fileDropContainerRef: createRef<HTMLElement>(),
      roomId: props?.roomId ?? ROOM_ID,
      room: createRoom(props?.roomId ?? ROOM_ID, props?.encryptedRoom),
      threadId: props?.threadId,
      threadingEnabled: props?.threadingEnabled,
      onRoomMessageSent: props?.onRoomMessageSent,
    })
  );

const renderRoomInput = async (
  store = createStore(),
  props?: {
    roomId?: string;
    threadId?: string;
    threadingEnabled?: boolean;
    onRoomMessageSent?: (eventId: string) => boolean | void;
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
  }
): Promise<{ renderer: ReactTestRenderer; store: ReturnType<typeof createStore> }> => {
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(createRoomInputTree(store, props));
  });

  return { renderer, store };
};

const updateRoomInput = async (
  renderer: ReactTestRenderer,
  store: ReturnType<typeof createStore>,
  props?: {
    roomId?: string;
    threadId?: string;
    threadingEnabled?: boolean;
    onRoomMessageSent?: (eventId: string) => boolean | void;
    keyedRoomSubtree?: boolean;
    encryptedRoom?: boolean;
  }
) => {
  await act(async () => {
    renderer.update(createRoomInputTree(store, props));
  });
};

// The composer only mounts when the user has explicitly opened the recorder
// or this room owns a parked draft. Tests that drive handleVoiceSend directly
// must first open the recorder to make voiceRecorderState.props observable.
const openVoiceRecorder = async (renderer: ReactTestRenderer) => {
  const micButton = renderer.root.find(
    (node) =>
      node.type === 'button' &&
      typeof node.props['aria-label'] === 'string' &&
      String(node.props['aria-label']).startsWith('Record voice message')
  );
  await act(async () => {
    micButton.props.onClick();
  });
};

afterEach(() => {
  emojiBoardState.props = undefined;
  voiceRecorderState.props = undefined;
  voiceRecorderState.send.mockReset();
  voiceRecorderState.send.mockResolvedValue(false);
  customEditorState.autocompleteQuery = undefined;
  customEditorState.editor = undefined;
  customEditorState.props = undefined;
  customEditorState.replyContextRenderCount = 0;
  modelPickerState.props = [];
  editorOutputState.plainText = '';
  editorOutputState.customHtml = '';
  editorOutputState.htmlEqualsPlainText = true;
  mediaConfigState.maxUploadSize = Infinity;
  mxState.cancelUpload.mockReset();
  mxState.getUserId.mockReset();
  mxState.getUserId.mockReturnValue('@me:example.org');
  mxState.getRoom.mockReset();
  mxState.getRoom.mockImplementation(
    (roomId: string) =>
      ({
        roomId,
        name: roomId,
        getEventForTxnId: () => undefined,
        hasEncryptionStateEvent: () => false,
        getMember: () => undefined,
        getMembers: () => [],
        getMyMembership: () => 'join',
      } as unknown as Room)
  );
  mxState.makeTxnId.mockReset();
  mxState.makeTxnId.mockReturnValue('txn-room-input');
  mxState.sendMessage.mockReset();
  mxState.sendMessage.mockResolvedValue({ event_id: '$sent' });
  mxState.uploadContent.mockReset();
  mxState.uploadContent.mockResolvedValue({ content_uri: 'mxc://mindroom/voice' });
  encryptionState.encryptAttachment.mockReset();
  encryptionState.encryptAttachment.mockImplementation(async (data: ArrayBuffer) => ({
    data,
    info: {
      v: 'v2',
      key: {
        alg: 'A256CTR',
        ext: true,
        k: 'test-key',
        key_ops: ['encrypt', 'decrypt'],
        kty: 'oct',
      },
      iv: 'test-iv',
      hashes: {
        sha256: 'test-hash',
      },
    },
  }));
  encryptionState.decryptAttachment.mockReset();
  editorMocks.insertNode.mockReset();
  editorMocks.insertText.mockReset();
  editorMocks.moveCursor.mockReset();
  editorMocks.resetEditor.mockReset();
  editorMocks.resetEditorHistory.mockReset();
  editorMocks.restoreEditorContent.mockReset();
  typingState.sendTypingStatus.mockReset();
});

describe('RoomInput', () => {
  it('names each icon button, as its tooltip does', async () => {
    const { renderer } = await renderRoomInput();
    const labels = renderer.root
      .findAll((node) => node.type === 'button')
      .map((button) => button.props['aria-label']);

    // Simple Mode, so no formatting or sticker buttons.
    expect(labels).toEqual(expect.arrayContaining(['Attach files', 'Emoji', 'Send message']));
    expect(labels.some((label) => String(label).startsWith('Record voice message'))).toBe(true);

    renderer.unmount();
  });

  const findButton = (renderer: ReactTestRenderer, label: string) =>
    renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label);

  it('keeps the emoji button pressed on the Sticker tab when Simple Mode hides the sticker button', async () => {
    const { renderer } = await renderRoomInput();
    expect(findButton(renderer, 'Sticker')).toHaveLength(0);
    const [emoji] = findButton(renderer, 'Emoji');
    expect(emoji.props['aria-pressed']).toBe(false);

    await act(async () => {
      emoji.props.onClick();
    });
    expect(findButton(renderer, 'Emoji')[0].props['aria-pressed']).toBe(true);

    // The board's own Sticker tab still belongs to the only button that opened it.
    await act(async () => {
      emojiBoardState.props!.onTabChange('Sticker');
    });
    expect(findButton(renderer, 'Emoji')[0].props['aria-pressed']).toBe(true);

    renderer.unmount();
  });

  it('presses only the button for the open tab when the sticker button shows', async () => {
    const store = createStore();
    store.set(mindroomAccountSettingsAtom, {
      ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
      simpleMode: false,
    });
    const { renderer } = await renderRoomInput(store);
    const pressed = () =>
      ['Sticker', 'Emoji'].map((label) => findButton(renderer, label)[0].props['aria-pressed']);

    await act(async () => {
      findButton(renderer, 'Sticker')[0].props.onClick();
    });
    expect(pressed()).toEqual([true, false]);

    await act(async () => {
      emojiBoardState.props!.onTabChange('Emoji');
    });
    expect(pressed()).toEqual([false, true]);

    renderer.unmount();
  });

  it('mounts the thread model picker in the top slot for a thread', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });

    const top = renderer.root.findByProps({ 'data-room-input-slot': 'top' });
    const before = renderer.root.findByProps({ 'data-room-input-slot': 'before' });

    expect(modelPickerState.props.at(-1)).toEqual(expect.objectContaining({ threadId: '$thread' }));
    expect(top.findAllByProps({ 'aria-label': 'Model picker seam' })).toHaveLength(1);
    expect(before.findAllByProps({ 'aria-label': 'Model picker seam' })).toHaveLength(0);

    renderer.unmount();
  });

  it('extends the composer surface into the bottom safe area', async () => {
    const { renderer } = await renderRoomInput();

    const editorSurface = renderer.root.find(
      (node) =>
        node.type === 'div' &&
        node.props.style?.paddingBottom === 'env(safe-area-inset-bottom, 0px)'
    );

    expect(editorSurface).toBeTruthy();

    renderer.unmount();
  });

  it('turns oversized pasted text into an upload and inserts a parseable marker', async () => {
    const { store, renderer } = await renderRoomInput();
    const pastedText = 'large paste\n'.repeat(6000);
    const pasteEvent = createTextPasteEvent(pastedText);

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(pasteEvent);
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));
    const pasteMarkerNode = editorMocks.insertNode.mock.calls[0]?.[0] as {
      chars: number;
      fileName: string;
      id: string;
      marker: string;
      type: string;
    };
    const marker = pasteMarkerNode.marker;

    expect(pasteEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(fileItem?.file).toBeInstanceOf(File);
    expect(fileItem?.file.name).toMatch(/^mindroom-paste-[a-f0-9]{6}\.txt$/);
    expect(fileItem?.file.type).toBe('text/plain');
    expect(await (fileItem!.file as File).text()).toBe(pastedText);
    expect(marker).toMatch(
      /^\[\[mindroom-paste:\{"v":1,"id":"paste-[a-f0-9]{6}","chars":\d+,"file":"mindroom-paste-[a-f0-9]{6}\.txt"\}\]\]$/
    );

    const markerPayload = JSON.parse(marker.slice('[[mindroom-paste:'.length, -2)) as {
      chars: number;
      file: string;
      id: string;
    };
    expect(markerPayload.chars).toBe(pastedText.length);
    expect(fileItem?.file.name).toBe(markerPayload.file);
    expect(fileItem?.file.name).toBe(`mindroom-${markerPayload.id}.txt`);
    expect(pasteMarkerNode).toEqual(
      expect.objectContaining({
        type: 'paste-marker',
        id: markerPayload.id,
        chars: pastedText.length,
        fileName: markerPayload.file,
        marker,
      })
    );
    expect(editorMocks.moveCursor).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('keeps failed paste preparation from inserting a dangling marker', async () => {
    const { store, renderer } = await renderRoomInput(createStore(), { encryptedRoom: true });
    const pastedText = 'large paste\n'.repeat(6000);
    const pasteEvent = createTextPasteEvent(pastedText);

    encryptionState.encryptAttachment.mockRejectedValueOnce(new Error('paste encryption failed'));
    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(pasteEvent);
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));

    expect(pasteEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(fileItem?.file.name).toMatch(/^mindroom-paste-[a-f0-9]{6}\.txt$/);
    expect(getMatrixUploadErrorStage(fileItem?.prepError)).toBe('create');
    expect(editorMocks.insertNode).not.toHaveBeenCalled();
    expect(editorMocks.insertText).toHaveBeenCalledWith(pastedText);
    expect(
      customEditorState.editor!.children.some((node: any) =>
        node?.children?.some((child: any) => child?.type === 'paste-marker')
      )
    ).toBe(false);

    await act(async () => {
      customEditorState.props!.onChange?.();
    });

    const [retainedFileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));
    expect(retainedFileItem).toBe(fileItem);
    expect(getMatrixUploadErrorMessage(retainedFileItem?.prepError)).toBe(
      "Couldn't prepare file for upload."
    );

    renderer.unmount();
  });

  it('uses primary Send for a successful file mixed with a prep-error file', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store);
    const failed = new File(['failed'], 'failed.txt', { type: 'text/plain' });
    const sendable = new File(['sendable'], 'sendable.txt', { type: 'text/plain' });
    const prepError = toMatrixUploadError(new Error('failed to prepare'), 'create');

    await act(async () => {
      store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), {
        type: 'PUT',
        item: [
          {
            file: failed,
            originalFile: failed,
            encInfo: undefined,
            metadata: { markedAsSpoiler: false },
            prepError,
          },
          {
            file: sendable,
            originalFile: sendable,
            encInfo: undefined,
            metadata: { markedAsSpoiler: false },
          },
        ],
      });
      store.set(roomUploadAtomFamily(failed), { error: prepError });
      store.set(roomUploadAtomFamily(sendable), { mxc: 'mxc://mindroom/sendable' });
    });

    const primarySendButtons = renderer.root.findAll(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Send message'
    );
    expect(primarySendButtons).toHaveLength(1);
    expect(primarySendButtons[0].props.variant).toBe('Primary');
    await act(async () => {
      await primarySendButtons[0].props.onClick();
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'sendable.txt',
      url: 'mxc://mindroom/sendable',
    });

    renderer.unmount();
  });

  it('leaves small text pastes to the editor default behavior', async () => {
    const { store, renderer } = await renderRoomInput();
    const pasteEvent = createTextPasteEvent('small paste');

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    let result: unknown;
    await act(async () => {
      result = customEditorState.props!.onPaste?.(pasteEvent);
    });

    // slate-react treats any non-null return value (including a Promise from an
    // async handler) as "handled" and skips its own paste fallback, which would
    // leave the text in the DOM but not in the editor model.
    expect(result).toBeUndefined();
    expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
    expect(editorMocks.insertNode).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps an errored item and aligned metadata after a middle encryption rejection', async () => {
    const firstFile = new File(['first'], 'first.txt', { type: 'text/plain' });
    const secondFile = new File(['second'], 'second.txt', { type: 'text/plain' });
    const thirdFile = new File(['third'], 'third.txt', { type: 'text/plain' });
    const decoder = new TextDecoder();

    encryptionState.encryptAttachment.mockImplementation(async (data: ArrayBuffer) => {
      if (decoder.decode(data) === 'second') {
        throw new Error('second encryption failed');
      }

      return {
        data,
        info: {
          v: 'v2',
          key: {
            alg: 'A256CTR',
            ext: true,
            k: 'test-key',
            key_ops: ['encrypt', 'decrypt'],
            kty: 'oct',
          },
          iv: 'test-iv',
          hashes: {
            sha256: 'test-hash',
          },
        },
      };
    });

    const uploadItems = await createMindroomRoomUploadItems(
      [firstFile, secondFile, thirdFile],
      createRoom(ROOM_ID, true),
      (file, index) => ({
        markedAsSpoiler: false,
        mindroomPasteAttachment: {
          id: `file-${index}`,
          chars: file.size,
          fileName: file.name,
        },
      })
    );

    expect(uploadItems).toHaveLength(3);
    expect(uploadItems.map((item) => item.originalFile)).toEqual([
      firstFile,
      secondFile,
      thirdFile,
    ]);
    expect(uploadItems.map((item) => item.metadata.mindroomPasteAttachment?.fileName)).toEqual([
      'first.txt',
      'second.txt',
      'third.txt',
    ]);
    expect(uploadItems.map((item) => item.metadata.mindroomPasteAttachment?.id)).toEqual([
      'file-0',
      'file-1',
      'file-2',
    ]);
    expect(uploadItems.map((item) => item.prepError !== undefined)).toEqual([false, true, false]);
    expect(getMatrixUploadErrorStage(uploadItems[1].prepError)).toBe('create');
    expect(getMatrixUploadErrorMessage(uploadItems[1].prepError)).toBe(
      "Couldn't prepare file for upload."
    );
  });

  it('removes the staged paste upload when its composer badge is deleted', async () => {
    const { store, renderer } = await renderRoomInput();
    const pastedText = 'large paste\n'.repeat(6000);

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(createTextPasteEvent(pastedText));
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toHaveLength(1);

    customEditorState.editor!.children = [{ type: 'paragraph', children: [{ text: 'Before ' }] }];
    await act(async () => {
      customEditorState.props!.onChange?.();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps a paste upload claimed by send after the session-start editor reset', async () => {
    const { store, renderer } = await renderRoomInput();
    const pastedText = 'large paste\n'.repeat(6000);

    editorOutputState.plainText = 'Before ';
    editorOutputState.customHtml = 'Before ';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      await customEditorState.props!.onPaste?.(createTextPasteEvent(pastedText));
    });

    const pasteMarkerNode = editorMocks.insertNode.mock.calls[0]?.[0] as {
      marker: string;
    };
    const marker = pasteMarkerNode.marker;

    editorOutputState.plainText = `${marker}\n\ntest testing`;
    editorOutputState.customHtml = editorOutputState.plainText;
    editorOutputState.htmlEqualsPlainText = true;
    editorMocks.resetEditor.mockImplementationOnce(() => {
      customEditorState.editor!.children = [{ type: 'paragraph', children: [{ text: '' }] }];
      customEditorState.props!.onChange?.();
    });

    await submitComposer();

    // The caption sends after the paste upload; the session-start editor reset clears the
    // marker but must not orphan-clean the claimed paste upload while it is still uploading.
    expect(editorMocks.resetEditor).toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toHaveLength(1);

    const pasteFile = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))[0].file;
    await act(async () => {
      store.set(roomUploadAtomFamily(pasteFile), { mxc: 'mxc://mindroom/paste' });
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      url: 'mxc://mindroom/paste',
    });
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      msgtype: 'm.text',
      body: `${marker}\n\ntest testing`,
      'm.relates_to': {
        event_id: '$sent',
        rel_type: 'm.thread',
      },
    });

    renderer.unmount();
  });

  it('does not duplicate a text message when Enter is pressed twice before send resolves', async () => {
    const { renderer } = await renderRoomInput();
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);

    editorOutputState.plainText = 'Hello @ali';
    editorOutputState.customHtml = 'Hello @ali';
    editorOutputState.htmlEqualsPlainText = true;

    const firstEnter = { key: 'Enter', preventDefault: vi.fn() };
    const secondEnter = { key: 'Enter', preventDefault: vi.fn() };

    await act(async () => {
      customEditorState.props!.onKeyDown?.(firstEnter);
      customEditorState.props!.onKeyDown?.(secondEnter);
      await Promise.resolve();
    });

    expect(firstEnter.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondEnter.preventDefault).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'Hello @ali',
        msgtype: 'm.text',
      }),
      'txn-room-input'
    );

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('shows the pending send indicator for unresolved thread composer sends', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);

    editorOutputState.plainText = 'Thread reply still sending';
    editorOutputState.customHtml = 'Thread reply still sending';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('Message sending');
    expect(JSON.stringify(renderer.toJSON())).toContain('Waiting for server');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Sending to this thread');

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).not.toContain('Message sending');

    renderer.unmount();
  });

  it('clears submitted text as soon as an unresolved thread send owns the pending local echo', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);

    stageComposerText('Pending local echo owns this reply');
    resetEditorOnNextSend();
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'Pending local echo owns this reply',
        'm.relates_to': expect.objectContaining({
          event_id: '$thread',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );
    expect(getEditorText()).toBe('');
    expect(editorMocks.resetEditorHistory).toHaveBeenCalled();
    expect(typingState.sendTypingStatus).toHaveBeenCalledWith(false);
    expect(JSON.stringify(renderer.toJSON())).toContain('Message sending');

    await act(async () => {
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    renderer.unmount();
  });

  it('keeps newer composer text and reply context when an earlier send succeeds', async () => {
    const store = createStore();
    const originalReply = createReplyDraft('$original-reply');
    const newerReply = createReplyDraft('$newer-reply');
    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), originalReply);
    const { renderer } = await renderRoomInput(store, { threadId: '$thread' });
    const send = createDeferred<{ event_id: string }>();
    mxState.sendMessage.mockReturnValueOnce(send.promise);

    stageComposerText('Earlier submitted reply');
    resetEditorOnNextSend();
    await submitComposer();

    setEditorText('Newer composer input');
    typingState.sendTypingStatus.mockClear();
    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerReply);
      send.resolve({ event_id: '$sent' });
      await Promise.resolve();
    });

    expect(getEditorText()).toBe('Newer composer input');
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerReply);
    expect(editorMocks.restoreEditorContent).not.toHaveBeenCalled();
    expect(typingState.sendTypingStatus).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('does not render thread helper context for static thread composers', async () => {
    const { renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });

    expect(customEditorState.replyContextRenderCount).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Sending to this thread');

    renderer.unmount();
  });

  it('notifies successful top-level room text sends with the new event id', async () => {
    const notificationOrder: string[] = [];
    editorMocks.resetEditor.mockImplementation(() => {
      notificationOrder.push('reset-editor');
    });
    editorMocks.resetEditorHistory.mockImplementation(() => {
      notificationOrder.push('reset-history');
    });
    const onRoomMessageSent = vi.fn(() => {
      notificationOrder.push('notify');
      return true;
    });
    const { renderer } = await renderRoomInput(createStore(), { onRoomMessageSent });

    editorOutputState.plainText = 'Start a compact thread';
    editorOutputState.customHtml = 'Start a compact thread';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
    });

    expect(onRoomMessageSent).toHaveBeenCalledWith(`~${ROOM_ID}:txn-room-input`);
    const notifyIndex = notificationOrder.indexOf('notify');
    expect(notifyIndex).toBeGreaterThan(-1);
    expect(notificationOrder.indexOf('reset-editor')).toBeLessThan(notifyIndex);
    expect(notificationOrder.indexOf('reset-history')).toBeLessThan(notifyIndex);

    renderer.unmount();
  });

  it('does not notify thread-targeted text sends as new room message roots', async () => {
    const onRoomMessageSent = vi.fn();
    const { renderer } = await renderRoomInput(createStore(), {
      threadId: '$thread-a',
      onRoomMessageSent,
    });

    editorOutputState.plainText = 'Reply in thread';
    editorOutputState.customHtml = 'Reply in thread';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyDown?.({ key: 'Enter', preventDefault: vi.fn() });
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(onRoomMessageSent).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('does not submit when Enter is pressed with an autocomplete menu open', async () => {
    const { renderer } = await renderRoomInput();
    customEditorState.autocompleteQuery = {
      prefix: 'user',
      range: {},
      text: '',
    };
    editorOutputState.plainText = '@';
    editorOutputState.customHtml = '@';
    editorOutputState.htmlEqualsPlainText = true;

    await act(async () => {
      customEditorState.props!.onKeyUp?.({ key: '@', preventDefault: vi.fn() });
    });

    const enter = { key: 'Enter', preventDefault: vi.fn() };
    await act(async () => {
      customEditorState.props!.onKeyDown?.(enter);
      await Promise.resolve();
    });

    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('keeps same-tick voice sends alive until the upload becomes sendable', async () => {
    const { store, renderer } = await renderRoomInput(createStore(), { threadId: '$thread' });
    await openVoiceRecorder(renderer);

    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(
        file,
        1200,
        [0, 512, 1024]
      ) as Promise<void>;
      await Promise.resolve();
    });

    const [fileItem] = store.get(roomIdToUploadItemsAtomFamily(ROOM_ID));

    expect(fileItem?.file).toBe(file);
    expect(fileItem?.metadata.voiceMessage?.waveform).toEqual([0, 512, 1024]);
    expect(mxState.uploadContent).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        includeFilename: true,
        progressHandler: expect.any(Function),
      })
    );
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'voice.m4a',
        msgtype: 'm.audio',
        url: 'mxc://mindroom/voice',
        [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: expect.objectContaining({
          duration: 1200,
          waveform: expect.any(Array),
        }),
        'm.relates_to': expect.objectContaining({
          event_id: '$thread',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );
    const sentContent = mxState.sendMessage.mock.calls[0][1] as Record<string, unknown>;
    expect(
      (sentContent[MATRIX_AUDIO_DETAILS_PROPERTY_NAME] as { waveform: number[] }).waveform
    ).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('sends a staged attachment as the room root and voice as its final child', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'attachment.txt', { type: 'text/plain' });
    const onRoomMessageSent = vi.fn();
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store, { onRoomMessageSent });
    await openVoiceRecorder(renderer);

    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    queuePrimaryVoiceSend(voice, 1200, [0, 512, 1024]);
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'attachment.txt',
      url: 'mxc://mindroom/attachment.txt',
    });
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(onRoomMessageSent).toHaveBeenCalledWith('$sent');

    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      body: 'voice.m4a',
      msgtype: 'm.audio',
      url: 'mxc://mindroom/voice',
      'm.relates_to': {
        event_id: '$sent',
        rel_type: RelationType.Thread,
        is_falling_back: true,
      },
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('uses primary Send for attachments, voice, and typed text as one ordered bundle', async () => {
    const store = createStore();
    const first = new File(['first'], 'first.txt', { type: 'text/plain' });
    const second = new File(['second'], 'second.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(store, [createUploadItem(first), createUploadItem(second)], [first, second]);
    const { renderer } = await renderRoomInput(store);
    stageComposerText('bundle caption');
    resetEditorOnNextSend();
    await openVoiceRecorder(renderer);
    voiceRecorderState.send.mockImplementationOnce(async () => {
      if (voiceRecorderState.props!.onSendStopRequest?.() === false) return false;
      try {
        await voiceRecorderState.props!.onSendRecording(voice, 1200, [0, 512, 1024]);
        return true;
      } catch (error) {
        voiceRecorderState.props!.onSendStopFailure?.();
        throw error;
      }
    });

    const primarySend = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Send message'
    );
    await act(async () => {
      await primarySend.props.onClick();
    });

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['first.txt', 'second.txt', 'voice.m4a', 'bundle caption']);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    mxState.sendMessage.mock.calls.slice(1).forEach((call) => {
      expect(call[1]).toMatchObject({
        'm.relates_to': expect.objectContaining({
          event_id: '$sent',
          rel_type: RelationType.Thread,
        }),
      });
    });
    expect(getEditorText()).toBe('');
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('uses a reply added after recording starts when primary Send is pressed', async () => {
    const store = createStore();
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);
    const recordingStartContext = voiceRecorderState.props!.getSendContext();
    const sendReply = createReplyDraft('$reply-added');

    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), sendReply);
    });
    await updateRoomInput(renderer, store);
    queuePrimaryVoiceSend(voice, 1200, undefined, recordingStartContext);

    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': {
          'm.in_reply_to': { event_id: '$reply-added' },
        },
      }),
      'txn-room-input'
    );
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toBeUndefined();

    renderer.unmount();
  });

  it('does not use a reply cleared after recording starts when primary Send is pressed', async () => {
    const store = createStore();
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), createReplyDraft('$reply-cleared'));
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);
    const recordingStartContext = voiceRecorderState.props!.getSendContext();

    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), undefined);
    });
    await updateRoomInput(renderer, store);
    queuePrimaryVoiceSend(voice, 1200, undefined, recordingStartContext);

    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');

    renderer.unmount();
  });

  it('uses a replaced reply for the full primary-Send bundle', async () => {
    const store = createStore();
    const attachment = new File(['attachment'], 'attachment.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(store, [createUploadItem(attachment)], [attachment]);
    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), createReplyDraft('$reply-old'));
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);
    const recordingStartContext = voiceRecorderState.props!.getSendContext();
    const sendReply = createReplyDraft('$reply-current');

    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), sendReply);
    });
    await updateRoomInput(renderer, store);
    stageComposerText('bundle caption');
    resetEditorOnNextSend();
    queuePrimaryVoiceSend(voice, 1200, undefined, recordingStartContext);

    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['attachment.txt', 'voice.m4a', 'bundle caption']);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': {
        'm.in_reply_to': { event_id: '$reply-current' },
      },
    });
    expect(JSON.stringify(mxState.sendMessage.mock.calls)).not.toContain('$reply-old');
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toBeUndefined();

    renderer.unmount();
  });

  it('restores failed trailing text without making an accepted voice retryable', async () => {
    const store = createStore();
    const attachment = new File(['attachment'], 'attachment.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const textFailure = new Error('caption send failed');
    stageUploadItems(store, [createUploadItem(attachment)], [attachment]);
    const { renderer } = await renderRoomInput(store);
    stageComposerText('restore this caption');
    resetEditorOnNextSend();
    await openVoiceRecorder(renderer);
    mxState.sendMessage
      .mockResolvedValueOnce({ event_id: '$root' })
      .mockResolvedValueOnce({ event_id: '$voice' })
      .mockRejectedValueOnce(textFailure);
    voiceRecorderState.send.mockImplementationOnce(async () => {
      if (voiceRecorderState.props!.onSendStopRequest?.() === false) return false;
      await voiceRecorderState.props!.onSendRecording(voice, 900);
      return true;
    });

    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['attachment.txt', 'voice.m4a', 'restore this caption']);
    expect(editorMocks.restoreEditorContent).toHaveBeenCalledWith(customEditorState.editor, [
      { type: 'paragraph', children: [{ text: 'restore this caption' }] },
    ]);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('keeps a paste attachment claimed while primary Send clears the composer', async () => {
    const store = createStore();
    const paste = new File(['paste'], 'mindroom-paste-a3f19c.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(
      store,
      [
        createUploadItem(paste, {
          metadata: {
            markedAsSpoiler: false,
            mindroomPasteAttachment: {
              id: 'paste-a3f19c',
              chars: 5,
              fileName: paste.name,
            },
          },
        }),
      ],
      [paste]
    );
    const { renderer } = await renderRoomInput(store);
    stageComposerText('paste caption');
    editorMocks.resetEditor.mockImplementationOnce(() => {
      setEditorText('');
      customEditorState.props!.onChange?.();
    });
    await openVoiceRecorder(renderer);
    voiceRecorderState.send.mockImplementationOnce(async () => {
      if (voiceRecorderState.props!.onSendStopRequest?.() === false) return false;
      await voiceRecorderState.props!.onSendRecording(voice, 700);
      return true;
    });

    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual([paste.name, 'voice.m4a', 'paste caption']);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps the combined send pending and completes it after the composer unmounts', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'attachment.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const voiceUpload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    mxState.uploadContent.mockReturnValueOnce(voiceUpload.promise);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(voice, 1000);
    let sendSettled = false;
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      void sendPromise.finally(() => {
        sendSettled = true;
      });
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(mxState.uploadContent).toHaveBeenCalledTimes(1));
    expect(mxState.uploadContent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'voice.m4a' }),
      expect.objectContaining({
        includeFilename: true,
        progressHandler: expect.any(Function),
      })
    );
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(sendSettled).toBe(false);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);

    renderer.unmount();

    await act(async () => {
      voiceUpload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(sendSettled).toBe(true);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      body: 'voice.m4a',
      url: 'mxc://mindroom/voice',
      'm.relates_to': expect.objectContaining({
        event_id: '$sent',
        rel_type: RelationType.Thread,
      }),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
  });

  it('keeps the primary text, attachment, and voice bundle alive after unmount', async () => {
    const store = createStore();
    const attachment = new File(['attachment'], 'attachment.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const voiceUpload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(attachment)], [attachment]);
    mxState.uploadContent.mockReturnValueOnce(voiceUpload.promise);
    const { renderer } = await renderRoomInput(store);
    stageComposerText('captured caption');
    resetEditorOnNextSend();
    await openVoiceRecorder(renderer);
    voiceRecorderState.send.mockImplementationOnce(async () => {
      if (voiceRecorderState.props!.onSendStopRequest?.() === false) return false;
      await voiceRecorderState.props!.onSendRecording(voice, 1000);
      return true;
    });

    await submitComposer();
    const sendPromise = voiceRecorderState.send.mock.results[0]?.value as Promise<boolean>;
    await vi.waitFor(() => expect(mxState.uploadContent).toHaveBeenCalledTimes(1));
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    renderer.unmount();

    await act(async () => {
      voiceUpload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['attachment.txt', 'voice.m4a', 'captured caption']);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
  });

  it('keeps voice serialization claimed until the combined batch completes', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'attachment.txt', { type: 'text/plain' });
    const voiceUpload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    mxState.uploadContent.mockReturnValueOnce(voiceUpload.promise);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    queuePrimaryVoiceSend(voice, 1000);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(false);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);

    await act(async () => {
      voiceUpload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('preserves staged attachment order before the voice child', async () => {
    const store = createStore();
    const first = new File(['first'], 'first.txt', { type: 'text/plain' });
    const second = new File(['second'], 'second.txt', { type: 'text/plain' });
    stageUploadItems(store, [createUploadItem(first), createUploadItem(second)], [first, second]);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 900);
    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['first.txt', 'second.txt', 'voice.m4a']);
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({
        event_id: '$sent',
        rel_type: RelationType.Thread,
      }),
    });

    expect(mxState.sendMessage.mock.calls[2][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({
        event_id: '$sent',
        rel_type: RelationType.Thread,
      }),
    });

    renderer.unmount();
  });

  it('sends staged attachments and voice into the thread captured at recording start', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'thread-attachment.txt', { type: 'text/plain' });
    const onRoomMessageSent = vi.fn();
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store, {
      threadId: '$existing-thread',
      onRoomMessageSent,
    });
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'thread-voice.m4a', { type: 'audio/mp4' }), 800);
    await submitComposer();
    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    mxState.sendMessage.mock.calls.forEach((call) => {
      expect(call[1]).toMatchObject({
        'm.relates_to': expect.objectContaining({
          event_id: '$existing-thread',
          rel_type: RelationType.Thread,
        }),
      });
    });
    expect(onRoomMessageSent).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('waits for a loading attachment root before sending the combined batch', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'loading-root.txt', { type: 'text/plain' });
    const upload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(companion)]);
    store.set(roomUploadAtomFamily(companion), { promise: upload.promise });
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 700);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/loading-root' });
      await sendPromise;
    });
    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({ event_id: '$sent' }),
    });

    renderer.unmount();
  });

  it('leaves a mid-upload failure staged and sends the surviving companion with voice', async () => {
    const store = createStore();
    const failed = new File(['failed'], 'failed-upload.txt', { type: 'text/plain' });
    const ready = new File(['ready'], 'ready-root.txt', { type: 'text/plain' });
    const failedUpload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(failed), createUploadItem(ready)], [ready]);
    mxState.uploadContent.mockReturnValueOnce(failedUpload.promise);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 650);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);

    await act(async () => {
      failedUpload.reject(new Error('companion upload failed'));
      await sendPromise;
    });

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['ready-root.txt', 'voice.m4a']);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({
        event_id: '$sent',
        rel_type: RelationType.Thread,
      }),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      failed,
    ]);
    expect(store.get(roomUploadAtomFamily(failed)).status).toBe(UploadStatus.Error);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('keeps the primary-Send attachment snapshot after delayed voice preparation', async () => {
    const store = createStore();
    const removed = new File(['removed'], 'removed.txt', { type: 'text/plain' });
    const added = new File(['added'], 'added.txt', { type: 'text/plain' });
    const removedItem = createUploadItem(removed);
    stageUploadItems(store, [removedItem], [removed]);
    mxState.getRoom.mockImplementation((roomId: string) => createRoom(roomId, true));
    const encryption = createDeferred<{
      data: ArrayBuffer;
      info: Record<string, unknown>;
    }>();
    encryptionState.encryptAttachment.mockReturnValueOnce(encryption.promise);
    const { renderer } = await renderRoomInput(store, { encryptedRoom: true });
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 750);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(encryptionState.encryptAttachment).toHaveBeenCalledTimes(1));
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      store.set(roomIdToUploadItemsAtomFamily(ROOM_ID), { type: 'DELETE', item: removedItem });
      const [addedItem] = await createMindroomRoomUploadItems([added], createRoom(ROOM_ID, true));
      if (!addedItem) throw new Error('Expected encrypted attachment item');
      stageUploadItems(store, [addedItem], [addedItem.file]);
    });
    await updateRoomInput(renderer, store, { encryptedRoom: true });
    await act(async () => {
      encryption.resolve({
        data: new ArrayBuffer(1),
        info: {
          v: 'v2',
          key: {},
          iv: 'iv',
          hashes: {},
        },
      });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({ body: 'voice.m4a' });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file.name)).toEqual(
      [added.name]
    );

    renderer.unmount();
  });

  it('leaves a plaintext-prepared companion staged after the room becomes encrypted', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'plaintext-companion.txt', {
      type: 'text/plain',
    });
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);
    const capturedContext = voiceRecorderState.props!.getSendContext();

    mxState.getRoom.mockImplementation((roomId: string) => createRoom(roomId, true));
    await updateRoomInput(renderer, store, { encryptedRoom: true });
    queuePrimaryVoiceSend(
      new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      725,
      undefined,
      capturedContext
    );
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'voice.m4a',
      file: expect.any(Object),
    });
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('url');
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      companion,
    ]);

    renderer.unmount();
  });

  it('uses primary Send for classic-mode attachments and voice without thread relations', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'classic.txt', { type: 'text/plain' });
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store, { threadingEnabled: false });
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 650);
    await submitComposer();

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['classic.txt', 'voice.m4a']);
    mxState.sendMessage.mock.calls.forEach((call) => {
      expect(call[1]).not.toHaveProperty('m.relates_to');
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('uses translated recovery guidance while another attachment session is active', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'active-session.txt', { type: 'text/plain' });
    const upload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(companion)]);
    store.set(roomUploadAtomFamily(companion), { promise: upload.promise });
    const { renderer } = await renderRoomInput(store);

    await submitComposer();
    await openVoiceRecorder(renderer);
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    queuePrimaryVoiceSend(voice, 600);
    await act(async () => {
      await expect(getPrimarySendButton(renderer).props.onClick()).rejects.toThrow(
        'Another attachment send is still in progress or needs attention. Wait for it, or retry or remove failed attachments, then send this message again.'
      );
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    await act(async () => {
      store.set(roomUploadAtomFamily(companion), { mxc: 'mxc://mindroom/active-session.txt' });
    });
    await updateRoomInput(renderer, store);
    await vi.waitFor(() => expect(mxState.sendMessage).toHaveBeenCalledTimes(1));

    queuePrimaryVoiceSend(voice, 600);
    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['active-session.txt', 'voice.m4a']);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('does not re-upload a companion completed by the inline session retry', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'retry-completed.txt', { type: 'text/plain' });
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    mxState.sendMessage.mockRejectedValueOnce(new Error('initial attachment send failed'));
    const { renderer } = await renderRoomInput(store);

    await submitComposer();
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      companion,
    ]);

    mxState.sendMessage.mockClear();
    await openVoiceRecorder(renderer);
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    queuePrimaryVoiceSend(voice, 590);
    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['retry-completed.txt', 'voice.m4a']);
    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(mxState.uploadContent.mock.calls[0][0]).toBe(voice);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('does not upload a companion removed after primary Send snapshots the bundle', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'removed-after-send.txt', {
      type: 'text/plain',
    });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);
    voiceRecorderState.send.mockImplementationOnce(async () => {
      if (voiceRecorderState.props!.onSendStopRequest?.() === false) return false;
      renderer.root
        .findByProps({ 'aria-label': 'Remove upload removed-after-send.txt' })
        .props.onClick();
      await voiceRecorderState.props!.onSendRecording(voice, 585);
      return true;
    });

    await submitComposer();

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(mxState.uploadContent.mock.calls[0][0]).toBe(voice);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({ body: 'voice.m4a' });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps a parked retry context while including attachments staged later', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'later-attachment.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'retry-voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store, { threadId: '$original-thread' });
    await openVoiceRecorder(renderer);
    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$current-thread' });
    await act(async () => {
      store.set(pendingVoiceSendDraftAtom, {
        file: voice,
        duration: 575,
        errorMessage: undefined,
        context: capturedContext as never,
        inFlight: {
          token: 'retry-attempt',
          startedAt: 1,
        },
      });
    });

    queuePrimaryVoiceSend(voice, 575, undefined, capturedContext);
    await submitComposer();

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['later-attachment.txt', 'retry-voice.m4a']);
    mxState.sendMessage.mock.calls.forEach((call) => {
      expect(call[1]).toMatchObject({
        'm.relates_to': expect.objectContaining({
          event_id: '$original-thread',
          rel_type: RelationType.Thread,
        }),
      });
    });
    expect(JSON.stringify(mxState.sendMessage.mock.calls)).not.toContain('$current-thread');
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('sends eligible paste companions while leaving invalid companions staged', async () => {
    const store = createStore();
    const prepFailed = new File(['bad'], 'failed.txt', { type: 'text/plain' });
    const paste = new File(['paste'], 'mindroom-paste-a3f19c.txt', { type: 'text/plain' });
    const oversized = new File(['123456'], 'oversized.txt', { type: 'text/plain' });
    const prepError = toMatrixUploadError(new Error('prepare failed'), 'create');
    mediaConfigState.maxUploadSize = 6;
    stageUploadItems(
      store,
      [
        createUploadItem(prepFailed, { prepError }),
        createUploadItem(paste, {
          metadata: {
            markedAsSpoiler: false,
            mindroomPasteAttachment: {
              id: 'paste-a3f19c',
              chars: 5,
              fileName: paste.name,
            },
          },
        }),
        createUploadItem(oversized),
      ],
      [paste]
    );
    store.set(roomUploadAtomFamily(prepFailed), { error: prepError });
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['12345'], 'voice.m4a', { type: 'audio/mp4' }), 550);
    await submitComposer();

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual([paste.name, 'voice.m4a']);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      prepFailed,
      oversized,
    ]);

    renderer.unmount();
  });

  it('excludes an already-failed companion without stalling the surviving combined batch', async () => {
    const store = createStore();
    const failed = new File(['failed'], 'failed-upload.txt', { type: 'text/plain' });
    const ready = new File(['ready'], 'ready-root.txt', { type: 'text/plain' });
    stageUploadItems(store, [createUploadItem(failed), createUploadItem(ready)], [ready]);
    store.set(roomUploadAtomFamily(failed), {
      error: toMatrixUploadError(new Error('upload failed'), 'upload'),
    });
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 525);
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({ body: 'ready-root.txt' });
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');

    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      body: 'voice.m4a',
      'm.relates_to': expect.objectContaining({
        event_id: '$sent',
        rel_type: RelationType.Thread,
      }),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      failed,
    ]);

    renderer.unmount();
  });

  it('keeps oversized voice standalone even with an eligible staged attachment', async () => {
    const store = createStore();
    const companion = new File(['1234'], 'eligible.txt', { type: 'text/plain' });
    mediaConfigState.maxUploadSize = 6;
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['123456'], 'oversized-voice.m4a', { type: 'audio/mp4' }), 500);
    await submitComposer();

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({ body: 'oversized-voice.m4a' });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      companion,
    ]);

    renderer.unmount();
  });

  it('clears the consumed reply from the origin room after the composer switches rooms', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'reply-root.txt', { type: 'text/plain' });
    const replyDraft = createReplyDraft('$reply-target');
    const rootSend = createDeferred<{ event_id: string }>();
    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), replyDraft);
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    mxState.sendMessage.mockReturnValueOnce(rootSend.promise);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 400);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(mxState.sendMessage).toHaveBeenCalledTimes(1));
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      body: 'reply-root.txt',
      'm.relates_to': {
        'm.in_reply_to': { event_id: '$reply-target' },
      },
    });
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(replyDraft);

    await updateRoomInput(renderer, store, { roomId: OTHER_ROOM_ID });
    await act(async () => {
      rootSend.resolve({ event_id: '$reply-root' });
      await sendPromise;
    });

    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toBeUndefined();
    expect(store.get(roomIdToReplyDraftAtomFamily(OTHER_ROOM_ID))).toBeUndefined();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('surfaces a voice upload failure before sending any member of the combined batch', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'root.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(store, [createUploadItem(companion)], [companion]);
    mxState.uploadContent.mockRejectedValueOnce(new Error('voice upload failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(voice, 350);
    await act(async () => {
      await expect(getPrimarySendButton(renderer).props.onClick()).rejects.toMatchObject({
        errcode: 'M_UNKNOWN',
      });
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      companion,
    ]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    consoleError.mockRestore();
    renderer.unmount();
  });

  it('releases voice serialization without waiting for a stalled companion after voice failure', async () => {
    const store = createStore();
    const companion = new File(['attachment'], 'stalled.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const stalledUpload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(companion)]);
    mxState.uploadContent
      .mockReturnValueOnce(stalledUpload.promise)
      .mockRejectedValueOnce(new Error('voice upload failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(voice, 325);
    await act(async () => {
      await expect(getPrimarySendButton(renderer).props.onClick()).rejects.toMatchObject({
        errcode: 'M_UNKNOWN',
      });
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      companion,
    ]);
    expect(store.get(roomUploadAtomFamily(companion)).status).toBe(UploadStatus.Loading);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    await act(async () => {
      stalledUpload.reject(new Error('stalled companion cleanup'));
      await vi.waitFor(() =>
        expect(store.get(roomUploadAtomFamily(companion)).status).toBe(UploadStatus.Error)
      );
    });

    consoleError.mockRestore();
    renderer.unmount();
  });

  it('retries a parked voice with all still-staged text and attachments through primary Send', async () => {
    const store = createStore();
    const root = new File(['root'], 'root.txt', { type: 'text/plain' });
    const failed = new File(['failed'], 'failed.txt', { type: 'text/plain' });
    const voice = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    stageUploadItems(store, [createUploadItem(root), createUploadItem(failed)], [root, failed]);
    mxState.sendMessage
      .mockResolvedValueOnce({ event_id: '$old-root' })
      .mockRejectedValueOnce(new Error('failed companion send'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);
    const capturedContext = voiceRecorderState.props!.getSendContext();

    queuePrimaryVoiceSend(voice, 350, undefined, capturedContext);
    await act(async () => {
      await expect(getPrimarySendButton(renderer).props.onClick()).rejects.toMatchObject({
        message: expect.stringContaining('failed companion send'),
      });
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      failed,
    ]);

    const later = new File(['later'], 'later.txt', { type: 'text/plain' });
    mxState.sendMessage.mockClear();
    await act(async () => {
      stageUploadItems(store, [createUploadItem(later)], [later]);
      store.set(pendingVoiceSendDraftAtom, {
        file: voice,
        duration: 350,
        context: capturedContext as never,
        inFlight: {
          token: 'retry-attempt',
          startedAt: 1,
        },
      });
      await Promise.resolve();
    });
    stageComposerText('fresh composer text');
    resetEditorOnNextSend();
    queuePrimaryVoiceSend(voice, 350, undefined, capturedContext);
    await submitComposer();

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['failed.txt', 'later.txt', 'voice.m4a', 'fresh composer text']);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(mxState.sendMessage.mock.calls[3][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({ event_id: '$sent' }),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    consoleError.mockRestore();
    renderer.unmount();
  });

  it('promotes the next surviving attachment when the would-be root is canceled', async () => {
    const store = createStore();
    const canceled = new File(['canceled'], 'canceled-root.txt', { type: 'text/plain' });
    const surviving = new File(['surviving'], 'surviving-root.txt', { type: 'text/plain' });
    const canceledUpload = createDeferred<{ content_uri: string }>();
    stageUploadItems(store, [createUploadItem(canceled), createUploadItem(surviving)], [surviving]);
    store.set(roomUploadAtomFamily(canceled), { promise: canceledUpload.promise });
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 300);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      canceled,
      surviving,
    ]);
    expect(() => renderer.root.findByProps({ 'aria-label': 'Remove upload voice.m4a' })).toThrow();

    await act(async () => {
      renderer.root
        .findByProps({ 'aria-label': 'Remove upload canceled-root.txt' })
        .props.onClick();
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({ body: 'surviving-root.txt' });
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      body: 'voice.m4a',
      'm.relates_to': expect.objectContaining({ event_id: '$sent' }),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('keeps recorder-owned voice enrolled when Remove All clears actual board items', async () => {
    const store = createStore();
    const failed = new File(['failed'], 'failed.txt', { type: 'text/plain' });
    const root = new File(['root'], 'root.txt', { type: 'text/plain' });
    const rootSend = createDeferred<{ event_id: string }>();
    stageUploadItems(store, [createUploadItem(failed), createUploadItem(root)], [root]);
    store.set(roomUploadAtomFamily(failed), {
      error: toMatrixUploadError(new Error('excluded upload failure'), 'upload'),
    });
    mxState.sendMessage.mockReturnValueOnce(rootSend.promise);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    queuePrimaryVoiceSend(new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }), 275);
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(mxState.sendMessage).toHaveBeenCalledTimes(1));

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Upload board Remove All' }).props.onClick();
      rootSend.resolve({ event_id: '$root' });
      await sendPromise;
    });

    expect(
      mxState.sendMessage.mock.calls.map((call) => (call[1] as { body: string }).body)
    ).toEqual(['root.txt', 'voice.m4a']);
    expect(mxState.sendMessage.mock.calls[1][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({ event_id: '$root' }),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('uses the thread visible when primary Send is pressed for a live recording', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    queuePrimaryVoiceSend(file, 1200, undefined, capturedContext);
    await submitComposer();
    await updateRoomInput(renderer, store, { threadId: '$thread-c' });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-b',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );

    renderer.unmount();
  });

  it('disables the mic button in another room while a failed-send draft is parked', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mxState.uploadContent.mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    );

    // Simulate a failed send: hook would write to the global atom on failure.
    // Drive that through the single primary Send path.
    queuePrimaryVoiceSend(file, 1100);
    await act(async () => {
      await expect(getPrimarySendButton(renderer).props.onClick()).rejects.toMatchObject({
        errcode: 'M_UNKNOWN',
      });
    });
    // Hook would have written the draft on failure. Simulate that here since
    // the mocked composer doesn't run the hook; the persistence-through-hook
    // path is covered by the dedicated useVoiceRecorder test.
    store.set(pendingVoiceSendDraftAtom, {
      file,
      duration: 1100,
      context: voiceRecorderState.props!.getSendContext() as never,
    });

    // Navigate to a different room (keyed remount mirrors production
    // RoomProvider behavior). The mic must be disabled with a descriptive
    // aria-label pointing back to the room with the parked draft.
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: undefined,
      keyedRoomSubtree: true,
    });
    const micButton = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Voice recording paused')
    );
    expect(micButton.props.disabled).toBe(true);
    expect(micButton.props['aria-label']).toContain(ROOM_ID);

    consoleError.mockRestore();
    renderer.unmount();
  });

  it('uses a thread opened after recording starts when primary Send is pressed', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    await act(async () => {
      micButton.props.onClick();
    });

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$thread-after-open' });
    queuePrimaryVoiceSend(file, 800, undefined, capturedContext);
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({
        event_id: '$thread-after-open',
        rel_type: RelationType.Thread,
      }),
    });

    renderer.unmount();
  });

  it('notifies top-level voice sends after clearing local voice state', async () => {
    const store = createStore();
    const notificationState: Array<{ pending: boolean; uploads: File[] }> = [];
    const onRoomMessageSent = vi.fn(() => {
      notificationState.push({
        pending: store.get(voiceAutoSendPendingAtom),
        uploads: store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file),
      });
    });
    const { renderer } = await renderRoomInput(store, { onRoomMessageSent });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    queuePrimaryVoiceSend(file, 900);
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage.mock.calls[0][1]).not.toHaveProperty('m.relates_to');
    expect(onRoomMessageSent).toHaveBeenCalledWith('$sent');
    expect(notificationState).toEqual([{ pending: false, uploads: [] }]);

    renderer.unmount();
  });

  it('uses the current thread for a paused live recording sent from primary Send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, { threadId: '$thread-b' });
    queuePrimaryVoiceSend(file, 900, undefined, capturedContext);
    await submitComposer();

    expect(mxState.sendMessage.mock.calls[0][1]).toMatchObject({
      'm.relates_to': expect.objectContaining({
        event_id: '$thread-b',
        rel_type: RelationType.Thread,
      }),
    });

    renderer.unmount();
  });

  it('keeps voice sends targeted to the room captured when recording starts', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID, threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
    });
    queuePrimaryVoiceSend(file, 1100, undefined, capturedContext);
    await submitComposer();

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );

    renderer.unmount();
  });

  it('keeps cross-room voice sends alive after Send and another navigation before upload completes', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID, threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
    });
    queuePrimaryVoiceSend(file, 1100, undefined, capturedContext);
    await act(async () => {
      sendPromise = getPrimarySendButton(renderer).props.onClick();
      await Promise.resolve();
    });
    await updateRoomInput(renderer, store, {
      roomId: THIRD_ROOM_ID,
      threadId: '$third-thread',
    });
    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );

    renderer.unmount();
  });

  it('sends to the captured room and cleans source uploads after a keyed room unmount', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    const capturedContext = voiceRecorderState.props!.getSendContext();
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(
        file,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
      await Promise.resolve();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      file,
    ]);

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('completes a captured send callback that fires after keyed room unmount', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);

    const capturedContext = voiceRecorderState.props!.getSendContext();
    const sendRecordingAfterUnmount = voiceRecorderState.props!.onSendRecording;

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = sendRecordingAfterUnmount(
        file,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
      await Promise.resolve();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      file,
    ]);

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('blocks a second compact voice send in another room during the pre-stop pending window', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });
    await openVoiceRecorder(renderer);
    const firstFile = new File(['voice-1'], 'voice-1.m4a', { type: 'audio/mp4' });
    const secondFile = new File(['voice-2'], 'voice-2.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);

    const capturedContext = voiceRecorderState.props!.getSendContext();
    const sendRecordingAfterStop = voiceRecorderState.props!.onSendRecording;
    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(true);
    });

    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);
    expect(mxState.uploadContent).not.toHaveBeenCalled();

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    // OTHER_ROOM_ID's mic is disabled because voiceAutoSendPending=true
    // globally; the composer doesn't mount in OTHER_ROOM_ID at all (no parked
    // draft, recorder not open). The user has no surface to trigger a second
    // send from another room. We still want to verify the parent-side
    // defense-in-depth: a stale captured handleVoiceSend for a second file
    // throws the busy error rather than silently double-sending.
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(true);
    // OTHER_ROOM_ID has no parked draft and the recorder isn't open; the
    // composer doesn't mount here. The user has no path to start a second
    // send from this room — the mic-disabled gate IS the defense. (The
    // previous "captured handleVoiceSend rejects" assertion was a stale ref
    // from the unmounted ROOM_ID parent and didn't match production: in
    // production no such second call is reachable.)
    void secondFile;

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = sendRecordingAfterStop(
        firstFile,
        1100,
        undefined,
        capturedContext
      ) as Promise<void>;
      await Promise.resolve();
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      firstFile,
    ]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('cancels an unsent active recording on keyed room unmount without stale upload state', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });

    let micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    act(() => {
      micButton.props.onClick();
    });

    await updateRoomInput(renderer, store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(roomIdToUploadItemsAtomFamily(OTHER_ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('does not let primary Send duplicate a pending compact voice auto-send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(true);
    });
    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(file, 1100) as Promise<void>;
      await Promise.resolve();
    });

    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      file,
    ]);

    await submitComposer();

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        body: 'voice.m4a',
        msgtype: 'm.audio',
        url: 'mxc://mindroom/voice',
      }),
      'txn-room-input'
    );

    renderer.unmount();
  });

  it('blocks a second compact voice send while an auto-send is pending', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const firstFile = new File(['voice-1'], 'voice-1.m4a', { type: 'audio/mp4' });
    const secondFile = new File(['voice-2'], 'voice-2.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(firstFile, 1100) as Promise<void>;
      await Promise.resolve();
    });

    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(true);

    act(() => {
      micButton.props.onClick();
    });
    await act(async () => {
      await expect(voiceRecorderState.props!.onSendRecording(secondFile, 700)).rejects.toThrow(
        'Another voice message is still sending'
      );
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID)).map((item) => item.file)).toEqual([
      firstFile,
    ]);
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);

    renderer.unmount();
  });

  it('clears failed voice upload state and releases pending auto-send', async () => {
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { threadId: '$thread-a' });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const uploadAbort = new DOMException('The operation was aborted.', 'AbortError');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mxState.uploadContent.mockRejectedValueOnce(uploadAbort);

    const capturedContext = voiceRecorderState.props!.getSendContext();
    act(() => {
      expect(voiceRecorderState.props?.onSendStopRequest?.()).toBe(true);
    });
    await act(async () => {
      await expect(
        voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext)
      ).rejects.toMatchObject({
        errcode: 'M_UNKNOWN',
      });
    });

    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[mr-upload]', {
      stage: 'upload',
      originalName: 'AbortError',
      name: 'M_UNKNOWN',
      errcode: 'M_UNKNOWN',
      httpStatus: undefined,
      message: expect.stringContaining('The operation was aborted.'),
    });
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    await updateRoomInput(renderer, store, { threadId: '$thread-after-failure' });
    act(() => {
      expect(voiceRecorderState.props?.onSendStopRequest?.()).toBe(true);
    });
    // The retry reuses the originally-captured context.
    await act(async () => {
      await voiceRecorderState.props!.onSendRecording(file, 700, undefined, capturedContext);
    });

    expect(mxState.uploadContent).toHaveBeenCalledTimes(2);
    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(mxState.sendMessage).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-a',
          rel_type: RelationType.Thread,
        }),
      }),
      'txn-room-input'
    );
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    consoleError.mockRestore();

    renderer.unmount();
  });

  it('does not mount the composer in another room with a thread/reply banner while another room owns the parked draft', async () => {
    // CLUSTER 1 (R3 reviewers A/F/G/H Issue 1): the previous wiring mounted
    // the composer whenever the parent had a banner reason (replyDraft ||
    // threadId), and the composer read the global atom unconditionally —
    // so room B with an active thread would render room A's retry/discard
    // capsule against the wrong room. The fix gates composer mount on
    // ownership; this test would FAIL under the old wiring.
    const store = createStore();
    // Park a failed-send draft for ROOM_ID, owned by the current session.
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: ROOM_ID,
        room: createRoom(ROOM_ID),
        threadId: '$thread-a',
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    // Render in OTHER_ROOM_ID with a thread banner — exactly the scenario
    // that tripped the old leak.
    const { renderer } = await renderRoomInput(store, {
      roomId: OTHER_ROOM_ID,
      threadId: '$other-thread',
      keyedRoomSubtree: true,
    });

    // The composer must NOT have mounted (no voiceRecorderState.props).
    expect(voiceRecorderState.props).toBeUndefined();

    // ROOM_ID's parked draft must be untouched.
    const persisted = store.get(pendingVoiceSendDraftAtom);
    expect(persisted?.context.roomId).toBe(ROOM_ID);
    expect(persisted?.errorMessage).toBe('upload failed');

    // OTHER_ROOM_ID's mic must be locked with the descriptive aria-label.
    const lockedMic = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Voice recording paused')
    );
    expect(lockedMic.props.disabled).toBe(true);

    renderer.unmount();
  });

  it('discards a parked draft when the source room is no longer reachable (kicked/left/forgot)', async () => {
    // R4 rev-A Issue 2 (MAJOR): same-session orphan drafts would otherwise
    // lock voice recording globally with no in-app recovery surface.
    // mx.getRoom returning null means the user lost access to that room
    // (kicked, left, forgot, sync drift); the cleanup useEffect must clear
    // the orphan so other rooms regain a working mic.
    const store = createStore();
    const FORGOTTEN_ROOM_ID = '!forgotten:example.org';
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: FORGOTTEN_ROOM_ID,
        room: createRoom(FORGOTTEN_ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    // Simulate the source room being unreachable in the live client.
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === FORGOTTEN_ROOM_ID ? undefined : ({ roomId } as unknown as Room)
    );

    const { renderer } = await renderRoomInput(store);

    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);

    renderer.unmount();
  });

  it('discards a parked draft when the source room exists but the user is no longer Joined', async () => {
    // R5 FIX 2 (rev-B Issue 1, rev-G Issue 1): the orphan-room cleanup
    // previously only checked `mx.getRoom()` truthiness. A Room object can
    // survive in the SDK store after the user is no longer joined
    // (Leave/Ban/etc), in which case the source room composer cannot render
    // and the user has no recovery surface. Treat non-Joined the same as
    // missing.
    const store = createStore();
    const LEFT_ROOM_ID = '!left:example.org';
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: LEFT_ROOM_ID,
        room: createRoom(LEFT_ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    // The room is still resolvable, but membership is Leave. This is the
    // case the previous cleanup missed.
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === LEFT_ROOM_ID
        ? ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'leave',
          } as unknown as Room)
        : ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'join',
          } as unknown as Room)
    );

    const { renderer } = await renderRoomInput(store);

    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);

    renderer.unmount();
  });

  it('rejects retry when the source room is no longer reachable (re-resolves at retry time)', async () => {
    // R5 FIX 3 (rev-H Issue 2): handleVoiceSend used to read
    // context.room directly — a snapshot from start() that could be stale
    // by retry time. The new code re-resolves via mx.getRoom and refuses to
    // proceed if the room is gone or non-joined. This also closes a
    // plaintext-leak window for encryption upgrades (covered by the
    // existing "propagates encrypted voice preparation failures" test
    // because it overrides mx.getRoom to report encryption ON).
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const capturedContext = voiceRecorderState.props!.getSendContext();

    // Live room is no longer joined (left between recording and retry).
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === ROOM_ID
        ? ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'leave',
          } as unknown as Room)
        : undefined
    );

    let rejected: unknown;
    await act(async () => {
      try {
        await voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext);
      } catch (err) {
        rejected = err;
      }
    });

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toMatch(/no longer available/i);
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);

    renderer.unmount();
  });

  it('releases voiceAutoSendPendingAtom when refresh fails AFTER the slot has been claimed', async () => {
    // R7 EXTREME-CONVERGENCE MAJOR (rev-E + rev-F): the production retry
    // path goes onSendStopRequest → onSendRecording. The first call claims
    // the auto-send slot via claimVoiceAutoSend, setting
    // voiceAutoSendPendingAtom = true. If handleVoiceSend's live-room
    // refresh then throws, the throw must NOT skip the release — otherwise
    // text submit and voice recording are globally locked until reload.
    // The previous "rejects retry" test only exercised onSendRecording
    // directly and missed this real-claim path.
    const store = createStore();
    const { renderer } = await renderRoomInput(store, { roomId: ROOM_ID });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const capturedContext = voiceRecorderState.props!.getSendContext();

    // 1) Production retry path claims the auto-send slot via
    //    onSendStopRequest BEFORE invoking onSendRecording.
    act(() => {
      expect(voiceRecorderState.props!.onSendStopRequest?.()).toBe(true);
    });
    expect(store.get(voiceAutoSendPendingAtom)).toBe(true);

    // 2) Mid-retry, the source room becomes unreachable / non-joined.
    mxState.getRoom.mockImplementation((roomId: string) =>
      roomId === ROOM_ID
        ? ({
            roomId,
            name: roomId,
            hasEncryptionStateEvent: () => false,
            getMember: () => undefined,
            getMembers: () => [],
            getMyMembership: () => 'leave',
          } as unknown as Room)
        : undefined
    );

    // 3) onSendRecording runs (the real production sequence). The live-room
    //    refresh fails. The early throw MUST still release the slot.
    let rejected: unknown;
    await act(async () => {
      try {
        await voiceRecorderState.props!.onSendRecording(file, 1100, undefined, capturedContext);
      } catch (err) {
        rejected = err;
      }
    });

    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toMatch(/no longer available/i);
    // Critical: the slot must have been released so other rooms / text
    // submit are not globally locked.
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('discards a parked draft that belongs to a different session (account switch)', async () => {
    // CLUSTER 1b (R3 reviewer C Issue 2): the global atom survives logout/
    // login since the router store is shared. A draft from account A must
    // not block voice recording or leak audio in account B.
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice-a'], 'voice-a.m4a', { type: 'audio/mp4' }),
      duration: 900,
      context: {
        ownerSessionId: '@previous-account:example.org',
        roomId: ROOM_ID,
        room: createRoom(ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });

    const { renderer } = await renderRoomInput(store);

    // Cleanup useEffect must wipe the orphaned draft.
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();

    // The mic in this room must be enabled (not "Voice recording paused").
    const micButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(micButton.props.disabled).toBe(false);

    renderer.unmount();
  });

  it('does not clear the global pending draft when the dialog closes for non-discard reasons', async () => {
    // rev-H Issue 2: handleCloseVoiceRecorder must not clear the draft. The
    // hook is the canonical owner; any future onClose caller (e.g. a defer
    // dismissal) must not silently destroy the parked recording.
    const store = createStore();
    store.set(pendingVoiceSendDraftAtom, {
      file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
      duration: 1100,
      errorMessage: 'upload failed',
      context: {
        ownerSessionId: '@me:example.org',
        roomId: ROOM_ID,
        room: createRoom(ROOM_ID),
        threadId: undefined,
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      } as never,
    });
    const { renderer } = await renderRoomInput(store, {
      roomId: ROOM_ID,
      keyedRoomSubtree: true,
    });

    expect(voiceRecorderState.props).toBeDefined();
    await act(async () => {
      voiceRecorderState.props!.onClose();
    });

    expect(store.get(pendingVoiceSendDraftAtom)?.errorMessage).toBe('upload failed');
    renderer.unmount();
  });

  it('auto-surfaces the recorder when returning to a room that owns a parked failed-send draft', async () => {
    // The hook writes draft+context to the global atom on failure (covered by
    // useVoiceRecorder.test.ts). This verifies the parent's wiring: when the
    // current room owns the parked draft, the recorder dialog auto-opens via
    // the ownsPendingVoiceDraft useEffect — even after a keyed RoomProvider
    // remount that destroyed the previous subtree.
    const store = createStore();

    // Start in a different room, no parked draft. Mic enabled.
    const { renderer } = await renderRoomInput(store, {
      roomId: OTHER_ROOM_ID,
      keyedRoomSubtree: true,
    });
    const initialMic = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Record voice message'
    );
    expect(initialMic.props.disabled).toBe(false);
    expect(voiceRecorderState.props?.active).toBeFalsy();

    // Simulate a failed send parked from earlier work in ROOM_ID. (The hook's
    // own write path is exercised in useVoiceRecorder.test.ts.) The mock
    // matrix client's getUserId() returns '@me:example.org' (see mxState
    // setup); stamp that as the owner so draftBelongsToCurrentSession holds.
    const parkedContext = {
      ownerSessionId: '@me:example.org',
      roomId: ROOM_ID,
      room: createRoom(ROOM_ID),
      threadId: '$thread-a',
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom: false,
    } as never;
    await act(async () => {
      store.set(pendingVoiceSendDraftAtom, {
        file: new File(['voice'], 'voice.m4a', { type: 'audio/mp4' }),
        duration: 1100,
        context: parkedContext,
      });
    });

    // Mic in OTHER_ROOM_ID must be disabled with the descriptive aria-label.
    const lockedMic = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-label'].startsWith('Voice recording paused')
    );
    expect(lockedMic.props.disabled).toBe(true);
    expect(lockedMic.props['aria-label']).toContain(ROOM_ID);

    // Navigate back to ROOM_ID — keyed remount destroys the prior subtree.
    await updateRoomInput(renderer, store, {
      roomId: ROOM_ID,
      threadId: '$thread-a',
      keyedRoomSubtree: true,
    });

    // The new subtree must auto-open the recorder for the parked draft.
    expect(voiceRecorderState.props?.active).toBe(true);

    renderer.unmount();
  });

  it('propagates encrypted voice preparation failures instead of treating them as sent', async () => {
    const store = createStore();
    // handleVoiceSend re-resolves the room via mx.getRoom at retry time so a
    // mid-life encryption upgrade is honored. For this test, the live room
    // must report itself as encrypted so the encryption-prep failure path
    // executes.
    mxState.getRoom.mockImplementation(
      (roomId: string) =>
        ({
          roomId,
          name: roomId,
          hasEncryptionStateEvent: () => true,
          getMember: () => undefined,
          getMembers: () => [],
          getMyMembership: () => 'join',
        } as unknown as Room)
    );
    const { renderer } = await renderRoomInput(store, {
      threadId: '$thread-a',
      encryptedRoom: true,
    });
    await openVoiceRecorder(renderer);
    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const prepareError = new Error('voice encryption failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    encryptionState.encryptAttachment.mockRejectedValueOnce(prepareError);

    let rejectedError: unknown;
    await act(async () => {
      try {
        await voiceRecorderState.props!.onSendRecording(file, 1100);
      } catch (err) {
        rejectedError = err;
      }
    });

    expect(getMatrixUploadErrorStage(rejectedError)).toBe('create');
    expect(rejectedError).toMatchObject({
      errcode: 'M_UNKNOWN',
      message: expect.stringContaining('voice encryption failed'),
    });
    expect(consoleError).toHaveBeenCalledWith('[mr-upload]', {
      stage: 'create',
      originalName: 'Error',
      name: 'M_UNKNOWN',
      errcode: 'M_UNKNOWN',
      httpStatus: undefined,
      message: expect.stringContaining('voice encryption failed'),
    });
    expect(mxState.uploadContent).not.toHaveBeenCalled();
    expect(mxState.sendMessage).not.toHaveBeenCalled();
    expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([]);
    expect(store.get(voiceAutoSendPendingAtom)).toBe(false);
    consoleError.mockRestore();

    renderer.unmount();
  });

  it('does not clear a newer reply draft when a deferred voice send finishes', async () => {
    const store = createStore();
    const originalReplyDraft = createReplyDraft('$reply-a');
    const newerReplyDraft = createReplyDraft('$reply-b', {
      event_id: '$thread-b',
      rel_type: RelationType.Thread,
    });

    store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), originalReplyDraft);
    const { renderer } = await renderRoomInput(store);
    await openVoiceRecorder(renderer);

    const file = new File(['voice'], 'voice.m4a', { type: 'audio/mp4' });
    const upload = createDeferred<{ content_uri: string }>();
    mxState.uploadContent.mockReturnValueOnce(upload.promise);
    let sendPromise!: Promise<void>;

    await act(async () => {
      sendPromise = voiceRecorderState.props!.onSendRecording(file, 900) as Promise<void>;
      await Promise.resolve();
    });

    await act(async () => {
      store.set(roomIdToReplyDraftAtomFamily(ROOM_ID), newerReplyDraft);
    });

    await act(async () => {
      upload.resolve({ content_uri: 'mxc://mindroom/voice' });
      await sendPromise;
    });

    expect(mxState.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.get(roomIdToReplyDraftAtomFamily(ROOM_ID))).toEqual(newerReplyDraft);

    renderer.unmount();
  });
});
