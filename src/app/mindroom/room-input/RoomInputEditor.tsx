import React, {
  ClipboardEventHandler,
  KeyboardEventHandler,
  ReactNode,
  RefObject,
  useCallback,
  useRef,
  useState,
} from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { isKeyHotkey } from 'is-hotkey';
import { EventType, Room } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { Icon, Icons, PopOut } from 'folds';
import { IconButton } from '../../components/glass/GlassPrimitives';

import {
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  createEmoticonElement,
  CustomEditor,
  EditorChangeHandler,
  EmoticonAutocomplete,
  getAutocompleteQuery,
  getPrevWorldRange,
  isEmptyEditor,
  moveCursor,
  RoomMentionAutocomplete,
  Toolbar,
  UserMentionAutocomplete,
} from '../../components/editor';
import { ComposerIconButton } from '../../components/editor/ComposerIconButton';
import { EmojiBoard, EmojiBoardTab } from '../../components/emoji-board';
import { UseStateProvider } from '../../components/UseStateProvider';
import { CommandAutocomplete } from '../../features/room/CommandAutocomplete';
import { useComposingCheck } from '../../hooks/useComposingCheck';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useSetting } from '../../state/hooks/settings';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { settingsAtom } from '../../state/settings';
import { getImageInfo, mxcUrlToHttp } from '../../utils/matrix';
import { getImageUrlBlob, loadImageElement } from '../../utils/dom';
import { mobileOrTablet } from '../../utils/user-agent';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { IconTooltip } from '../tooltip/IconTooltip';
import {
  getMindroomRoomInputAutocompleteQuery,
  isMindroomRoomInputAutocompleteQuery,
  MindroomRoomInputAutocomplete,
  type MindroomRoomInputAutocompletePrefix,
} from './RoomInputMindroomExtensions';

type RoomInputAutocompletePrefix = AutocompletePrefix | MindroomRoomInputAutocompletePrefix;

type RoomInputEditorProps = {
  editor: Editor;
  room: Room;
  fileDropContainerRef: RefObject<HTMLElement>;
  onSubmit: () => void;
  onCancelReply: () => void;
  onPaste: ClipboardEventHandler;
  onChange: EditorChangeHandler;
  sendTypingStatus: (typing: boolean) => void;
  top?: ReactNode;
  before?: ReactNode;
};

export function RoomInputEditor({
  editor,
  room,
  fileDropContainerRef,
  onSubmit,
  onCancelReply,
  onPaste,
  onChange,
  sendTypingStatus,
  top,
  before,
}: RoomInputEditorProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);
  const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [toolbar, setToolbar] = useSetting(settingsAtom, 'editorToolbar');
  // Simple mode keeps the composer to attach, voice, emoji, and send — no
  // markdown toolbar or stickers. Voice stays by explicit product choice:
  // dictating a message is exactly what a non-technical user reaches for.
  const simpleMode = useSimpleMode();
  const [autocompleteQuery, setAutocompleteQuery] =
    useState<AutocompleteQuery<RoomInputAutocompletePrefix>>();
  const [hideStickerBtn, setHideStickerBtn] = useState(document.body.clientWidth < 500);
  const emojiBtnRef = useRef<HTMLButtonElement | null>(null);
  const isComposing = useComposingCheck();

  useElementSizeObserver(
    useCallback(() => fileDropContainerRef.current, [fileDropContainerRef]),
    useCallback((width) => setHideStickerBtn(width < 500), [])
  );

  const handleKeyDown: KeyboardEventHandler = useCallback(
    (evt) => {
      if (
        (isKeyHotkey('mod+enter', evt) || (!enterForNewline && isKeyHotkey('enter', evt))) &&
        !isComposing(evt)
      ) {
        evt.preventDefault();
        if (autocompleteQuery) return;
        onSubmit();
      }
      if (isKeyHotkey('escape', evt)) {
        evt.preventDefault();
        if (autocompleteQuery) {
          setAutocompleteQuery(undefined);
          return;
        }
        onCancelReply();
      }
    },
    [onSubmit, onCancelReply, enterForNewline, autocompleteQuery, isComposing]
  );

  const handleKeyUp: KeyboardEventHandler = useCallback(
    (evt) => {
      if (isKeyHotkey('escape', evt)) {
        evt.preventDefault();
        return;
      }

      if (!hideActivity) {
        sendTypingStatus(!isEmptyEditor(editor));
      }

      const prevWordRange = getPrevWorldRange(editor);
      if (!prevWordRange) {
        setAutocompleteQuery(undefined);
        return;
      }

      const mindroomCommandQuery = getMindroomRoomInputAutocompleteQuery(editor, prevWordRange);
      if (mindroomCommandQuery) {
        setAutocompleteQuery(mindroomCommandQuery);
        return;
      }

      const query = getAutocompleteQuery<AutocompletePrefix>(
        editor,
        prevWordRange,
        AUTOCOMPLETE_PREFIXES
      );
      setAutocompleteQuery(query);
    },
    [editor, sendTypingStatus, hideActivity]
  );

  const handleCloseAutocomplete = useCallback(() => {
    setAutocompleteQuery(undefined);
    ReactEditor.focus(editor);
  }, [editor]);

  const handleEmoticonSelect = (key: string, shortcode: string) => {
    editor.insertNode(createEmoticonElement(key, shortcode));
    moveCursor(editor);
  };

  const handleStickerSelect = async (mxc: string, shortcode: string, label: string) => {
    const stickerUrl = mxcUrlToHttp(mx, mxc, useAuthentication);
    if (!stickerUrl) return;

    const info = await getImageInfo(
      await loadImageElement(stickerUrl),
      await getImageUrlBlob(stickerUrl)
    );

    mx.sendEvent(room.roomId, EventType.Sticker, {
      body: label,
      url: mxc,
      info,
    });
  };

  return (
    <>
      {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
        <RoomMentionAutocomplete
          roomId={room.roomId}
          editor={editor}
          query={autocompleteQuery}
          requestClose={handleCloseAutocomplete}
        />
      )}
      {autocompleteQuery?.prefix === AutocompletePrefix.UserMention && (
        <UserMentionAutocomplete
          room={room}
          editor={editor}
          query={autocompleteQuery}
          requestClose={handleCloseAutocomplete}
        />
      )}
      {autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
        <EmoticonAutocomplete
          imagePackRooms={imagePackRooms}
          editor={editor}
          query={autocompleteQuery}
          requestClose={handleCloseAutocomplete}
        />
      )}
      {autocompleteQuery?.prefix === AutocompletePrefix.Command && (
        <CommandAutocomplete
          room={room}
          editor={editor}
          query={autocompleteQuery}
          requestClose={handleCloseAutocomplete}
        />
      )}
      {isMindroomRoomInputAutocompleteQuery(autocompleteQuery) && (
        <MindroomRoomInputAutocomplete
          editor={editor}
          query={autocompleteQuery}
          requestClose={handleCloseAutocomplete}
        />
      )}
      <CustomEditor
        editableName="RoomInput"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        editor={editor}
        placeholder={t('composer.placeholder')}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onPaste={onPaste}
        top={top}
        before={before}
        after={
          <>
            {!simpleMode && (
              <IconTooltip label={t('composer.formatting')} position="Top">
                {(triggerRef) => (
                  <ComposerIconButton
                    ref={triggerRef}
                    size="300"
                    radii="300"
                    aria-label={t('composer.formatting')}
                    aria-pressed={toolbar}
                    onClick={() => setToolbar(!toolbar)}
                  >
                    <Icon src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
                  </ComposerIconButton>
                )}
              </IconTooltip>
            )}
            <UseStateProvider initial={undefined}>
              {(emojiBoardTab: EmojiBoardTab | undefined, setEmojiBoardTab) => (
                <PopOut
                  offset={16}
                  alignOffset={-44}
                  position="Top"
                  align="End"
                  anchor={
                    emojiBoardTab === undefined
                      ? undefined
                      : emojiBtnRef.current?.getBoundingClientRect() ?? undefined
                  }
                  content={
                    <EmojiBoard
                      tab={emojiBoardTab}
                      onTabChange={setEmojiBoardTab}
                      imagePackRooms={imagePackRooms}
                      returnFocusOnDeactivate={false}
                      onEmojiSelect={handleEmoticonSelect}
                      onCustomEmojiSelect={handleEmoticonSelect}
                      onStickerSelect={handleStickerSelect}
                      requestClose={() => {
                        setEmojiBoardTab((t) => {
                          if (t) {
                            if (!mobileOrTablet()) ReactEditor.focus(editor);
                            return undefined;
                          }
                          return t;
                        });
                      }}
                    />
                  }
                >
                  {!hideStickerBtn && !simpleMode && (
                    <IconTooltip label={t('sharedUi.tabs.sticker')} position="Top">
                      {(triggerRef) => (
                        <ComposerIconButton
                          ref={triggerRef}
                          aria-label={t('sharedUi.tabs.sticker')}
                          aria-pressed={emojiBoardTab === EmojiBoardTab.Sticker}
                          onClick={() => setEmojiBoardTab(EmojiBoardTab.Sticker)}
                          size="300"
                          radii="300"
                        >
                          <Icon
                            src={Icons.Sticker}
                            filled={emojiBoardTab === EmojiBoardTab.Sticker}
                          />
                        </ComposerIconButton>
                      )}
                    </IconTooltip>
                  )}
                  <IconTooltip label={t('sharedUi.tabs.emoji')} position="Top">
                    {(triggerRef) => (
                      <ComposerIconButton
                        ref={(node: HTMLButtonElement | null) => {
                          triggerRef(node);
                          emojiBtnRef.current = node;
                        }}
                        aria-label={t('sharedUi.tabs.emoji')}
                        aria-pressed={
                          hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                        }
                        onClick={() => setEmojiBoardTab(EmojiBoardTab.Emoji)}
                        size="300"
                        radii="300"
                      >
                        <Icon
                          src={Icons.Smile}
                          filled={
                            hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                          }
                        />
                      </ComposerIconButton>
                    )}
                  </IconTooltip>
                </PopOut>
              )}
            </UseStateProvider>
            <IconTooltip label={t('composer.sendMessage')} position="Top">
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  onClick={onSubmit}
                  variant="Primary"
                  size="300"
                  radii="300"
                  aria-label={t('composer.sendMessage')}
                >
                  <Icon src={Icons.Send} />
                </IconButton>
              )}
            </IconTooltip>
          </>
        }
        bottom={toolbar && !simpleMode && <Toolbar />}
      />
    </>
  );
}
