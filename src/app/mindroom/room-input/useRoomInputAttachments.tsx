import React, { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { Editor } from 'slate';
import {
  Box,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Text,
  toRem,
} from 'folds';
import { Dialog } from '../../components/glass/GlassPrimitives';
import { ComposerIconButton } from '../../components/editor/ComposerIconButton';
import { IconTooltip } from '../tooltip/IconTooltip';
import { useFilePicker } from '../../hooks/useFilePicker';
import { useFileDropZone } from '../../hooks/useFileDrop';
import {
  TUploadItem,
  TUploadMetadata,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../../state/room/roomInputDrafts';
import { UploadCardRenderer } from '../../components/upload-card';
import { UploadBoard, UploadBoardContent, UploadBoardHeader } from '../../components/upload-board';
import { Upload, UploadStatus, createUploadFamilyObserverAtom } from '../../state/upload';
import { TUploadContent, getMatrixUploadErrorStage } from '../../utils/matrix';
import {
  getMindroomRoomInputPasteMarkerFileNames,
  removeMindroomRoomInputPasteMarkerElements,
} from './RoomInputMindroomExtensions';
import { isMindroomPasteFileName } from '../messages/pasteAttachmentMarker';
import { useRoomInputPaste } from './useRoomInputPaste';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';

type UseRoomInputAttachmentsOptions = {
  mx: MatrixClient;
  room: Room;
  roomId: string;
  draftKey?: string;
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement>;
  isMarkdown: boolean;
  createUploadItems: (
    files: File[],
    getMetadata?: (file: File, index: number) => TUploadMetadata
  ) => Promise<TUploadItem[]>;
};

export const useRoomInputAttachments = ({
  mx,
  room,
  roomId,
  draftKey,
  editor,
  fileDropContainerRef,
  isMarkdown,
  createUploadItems,
}: UseRoomInputAttachmentsOptions) => {
  const { t } = useTranslation();
  const store = useStore();
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [uploadBoard, setUploadBoard] = useState(true);
  const roomFiles = useAtomValue(roomIdToUploadItemsAtomFamily(roomId));
  const selectedFiles = useMemo(
    () => roomFiles.filter((item) => !item.composerDraftKey || item.composerDraftKey === draftKey),
    [roomFiles, draftKey]
  );
  const enrolledRef = useRef<TUploadItem[]>([]);
  const [enrolledItems, setEnrolledItems] = useState<TUploadItem[]>([]);
  const protectedFilesRef = useRef(new Map<TUploadContent, number>());
  const listenersRef = useRef(new Set<() => void>());
  const observedUploadFiles = useMemo(
    () => Array.from(new Set([...selectedFiles, ...enrolledItems].map((item) => item.file))),
    [selectedFiles, enrolledItems]
  );
  // A stable observer avoids needless editor focus/selection disruption on ordinary renders.
  const uploadFamilyObserverAtom = useMemo(
    () => createUploadFamilyObserverAtom(roomUploadAtomFamily, observedUploadFiles),
    [observedUploadFiles]
  );
  const uploads = useAtomValue(uploadFamilyObserverAtom);
  useEffect(() => {
    let disposed = false;
    // Store writes can trigger effects before append publishes preparation errors or
    // remove finishes clearing enrollment. Notify only after the whole operation returns.
    queueMicrotask(() => {
      if (!disposed) listenersRef.current.forEach((listener) => listener());
    });
    return () => {
      disposed = true;
    };
  }, [uploads, selectedFiles, enrolledItems]);

  const access = useMemo<RoomInputAttachmentAccess>(() => {
    const enroll = (items: TUploadItem[]) => {
      enrolledRef.current = [...items];
      if (mountedRef.current) setEnrolledItems(enrolledRef.current);
    };
    return {
      snapshot: (ownerRoomId) => {
        // Read the store directly: consumers can append, replace metadata, remove, or send
        // before React commits the render caused by the atom update.
        const roomItems = store.get(
          roomIdToUploadItemsAtomFamily(ownerRoomId ?? roomIdRef.current)
        );
        // New sends and the board see only this draft's paste files. In-flight sessions
        // explicitly name their room so navigation cannot hide their enrolled files.
        const staged =
          ownerRoomId === undefined
            ? roomItems.filter(
                (item) => !item.composerDraftKey || item.composerDraftKey === draftKeyRef.current
              )
            : roomItems;
        const enrolled = enrolledRef.current;
        const files = new Set([...staged, ...enrolled].map((item) => item.file));
        return {
          staged: [...staged],
          enrolled: [...enrolled],
          uploads: Array.from(files, (file) => store.get(roomUploadAtomFamily(file))),
        };
      },
      append: (ownerRoomId, items) => {
        if (items.length === 0) return;
        if (mountedRef.current && ownerRoomId === roomIdRef.current) setUploadBoard(true);
        const scopedItems = items.map((item) =>
          item.metadata.mindroomPasteAttachment && draftKeyRef.current && !item.composerDraftKey
            ? { ...item, composerDraftKey: draftKeyRef.current }
            : item
        );
        store.set(roomIdToUploadItemsAtomFamily(ownerRoomId), { type: 'PUT', item: scopedItems });
        items.forEach((item) => {
          if (item.prepError) store.set(roomUploadAtomFamily(item.file), { error: item.prepError });
        });
      },
      remove: (ownerRoomId, files) => {
        enroll(enrolledRef.current.filter((item) => !files.includes(item.file)));
        const ownerAtom = roomIdToUploadItemsAtomFamily(ownerRoomId);
        const removable = store.get(ownerAtom).filter((item) => files.includes(item.file));
        if (removable.length > 0) store.set(ownerAtom, { type: 'DELETE', item: removable });
        files.forEach((file) => roomUploadAtomFamily.remove(file));
      },
      enroll,
      clearEnrollment: () => enroll([]),
      protectPasteItems: (items) => {
        const files = new Set(items.map((item) => item.file));
        files.forEach((file) =>
          protectedFilesRef.current.set(file, (protectedFilesRef.current.get(file) ?? 0) + 1)
        );
        let released = false;
        return () => {
          if (released) return;
          released = true;
          files.forEach((file) => {
            const count = protectedFilesRef.current.get(file) ?? 0;
            if (count <= 1) protectedFilesRef.current.delete(file);
            else protectedFilesRef.current.set(file, count - 1);
          });
        };
      },
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
  }, [store]);

  const appendUploadItems = useCallback(
    (items: TUploadItem[]) =>
      access.append(
        roomId,
        items.map((item) =>
          item.metadata.mindroomPasteAttachment && draftKey
            ? { ...item, composerDraftKey: draftKey }
            : item
        )
      ),
    [access, roomId, draftKey]
  );
  const handleFiles = useCallback(
    async (files: File[]) => {
      appendUploadItems(await createUploadItems(files));
    },
    [appendUploadItems, createUploadItems]
  );
  const pickFile = useFilePicker(handleFiles, true);
  const onPaste = useRoomInputPaste({
    editor,
    draftKey,
    isMarkdown,
    handleFiles,
    createUploadItems,
    appendUploadItems,
  });
  const dropZoneVisible = useFileDropZone(fileDropContainerRef, handleFiles);
  const handleFileMetadata = useCallback(
    (fileItem: TUploadItem, metadata: TUploadMetadata) => {
      store.set(roomIdToUploadItemsAtomFamily(roomIdRef.current), {
        type: 'REPLACE',
        item: fileItem,
        replacement: { ...fileItem, metadata },
      });
    },
    [store]
  );
  const removeUploadsFromBoard = useCallback(
    (upload: TUploadContent | TUploadContent[]) => {
      access.remove(roomIdRef.current, Array.isArray(upload) ? upload : [upload]);
    },
    [access]
  );
  const getUploadContentName = useCallback((content: TUploadContent): string | undefined => {
    if ('name' in content && typeof content.name === 'string') return content.name;
    return undefined;
  }, []);

  const getPasteUploadFileName = useCallback(
    (fileItem: TUploadItem): string | undefined => {
      const fileName =
        getUploadContentName(fileItem.originalFile) ?? getUploadContentName(fileItem.file);
      return fileName && isMindroomPasteFileName(fileName) ? fileName : undefined;
    },
    [getUploadContentName]
  );

  const getPasteUploadFileNames = useCallback(
    (upload: TUploadContent | TUploadContent[]): Set<string> => {
      const uploadList = Array.isArray(upload) ? upload : [upload];
      const fileNames = new Set<string>();

      access.snapshot().staged.forEach((fileItem) => {
        if (
          !uploadList.some(
            (candidate) => candidate === fileItem.file || candidate === fileItem.originalFile
          )
        ) {
          return;
        }

        const fileName = getPasteUploadFileName(fileItem);
        if (fileName) fileNames.add(fileName);
      });

      return fileNames;
    },
    [access, getPasteUploadFileName]
  );

  const handleRemoveUpload = useCallback(
    (upload: TUploadContent | TUploadContent[]) => {
      const pasteFileNames = getPasteUploadFileNames(upload);
      removeUploadsFromBoard(upload);
      removeMindroomRoomInputPasteMarkerElements(editor, pasteFileNames);
    },
    [editor, getPasteUploadFileNames, removeUploadsFromBoard]
  );

  const handleCancelUpload = useCallback(
    (uploadsToCancel: Upload[]) => {
      const boardFiles = new Set(access.snapshot().staged.map((item) => item.file));
      const boardUploadsToCancel = uploadsToCancel.filter((upload) => boardFiles.has(upload.file));
      boardUploadsToCancel.forEach((upload) => {
        if (upload.status === UploadStatus.Loading) {
          mx.cancelUpload(upload.promise);
        }
      });
      const uploadFilesToCancel = boardUploadsToCancel.map((upload) => upload.file);
      const pasteFileNames = getPasteUploadFileNames(uploadFilesToCancel);
      removeUploadsFromBoard(uploadFilesToCancel);
      removeMindroomRoomInputPasteMarkerElements(editor, pasteFileNames);
    },
    [access, editor, getPasteUploadFileNames, mx, removeUploadsFromBoard]
  );

  const handleEditorChange = useCallback(() => {
    const markerFileNames = getMindroomRoomInputPasteMarkerFileNames(editor.children);
    const { staged, enrolled } = access.snapshot();
    const orphanPasteUploads = staged.filter((fileItem) => {
      const fileName = getPasteUploadFileName(fileItem);
      if (fileName === undefined || markerFileNames.has(fileName)) return false;
      if (fileItem.prepError && getMatrixUploadErrorStage(fileItem.prepError) === 'create') {
        return false;
      }
      return (
        !enrolled.some((sendItem) => sendItem.file === fileItem.file) &&
        !protectedFilesRef.current.has(fileItem.file)
      );
    });

    if (orphanPasteUploads.length > 0) {
      removeUploadsFromBoard(orphanPasteUploads.map((fileItem) => fileItem.file));
    }
  }, [access, editor, getPasteUploadFileName, removeUploadsFromBoard]);

  const board = selectedFiles.length > 0 && (
    <UploadBoard
      header={
        <UploadBoardHeader
          open={uploadBoard}
          onToggle={() => setUploadBoard(!uploadBoard)}
          uploadFamilyObserverAtom={uploadFamilyObserverAtom}
          onCancel={handleCancelUpload}
        />
      }
    >
      {uploadBoard && (
        <Scroll size="300" hideTrack visibility="Hover">
          <UploadBoardContent>
            {Array.from(selectedFiles)
              .reverse()
              .map((fileItem, index) => (
                <UploadCardRenderer
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  isEncrypted={room.hasEncryptionStateEvent()}
                  fileItem={fileItem}
                  setMetadata={handleFileMetadata}
                  onRemove={handleRemoveUpload}
                />
              ))}
          </UploadBoardContent>
        </Scroll>
      )}
    </UploadBoard>
  );
  const dropOverlay = (
    <Overlay
      open={dropZoneVisible}
      backdrop={<OverlayBackdrop />}
      style={{ pointerEvents: 'none' }}
    >
      <OverlayCenter>
        <Dialog variant="Primary">
          <Box
            direction="Column"
            justifyContent="Center"
            alignItems="Center"
            gap="500"
            style={{ padding: toRem(60) }}
          >
            <Icon size="600" src={Icons.File} />
            <Text size="H4" align="Center">
              {t('composer.dropFiles', {
                roomName: room.name || t('composer.roomFallback'),
              })}
            </Text>
            <Text align="Center">{t('composer.dropFilesHint')}</Text>
          </Box>
        </Dialog>
      </OverlayCenter>
    </Overlay>
  );
  const attachButton = (
    <IconTooltip label={t('composer.attach')} position="Top">
      {(triggerRef) => (
        <ComposerIconButton
          ref={triggerRef}
          onClick={() => pickFile('*')}
          size="300"
          radii="300"
          aria-label={t('composer.attach')}
        >
          <Icon src={Icons.PlusCircle} />
        </ComposerIconButton>
      )}
    </IconTooltip>
  );
  return { access, board, dropOverlay, attachButton, onPaste, onEditorChange: handleEditorChange };
};
