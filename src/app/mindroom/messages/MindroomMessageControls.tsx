import type { MatrixEvent } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  as,
  config,
} from 'folds';
import React, { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { getEventAttachmentOwner } from './eventAttachments';
import { Dialog, Header, MenuItem } from '../../components/glass/GlassPrimitives';
import { PageScroll } from '../../components/page';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { stopPropagation } from '../../utils/keyboard';
import { assignElementRef } from '../../utils/react';
import { MindroomAiRunInfo, getMindroomAiRunInfo } from './aiRun';
import {
  MindroomLongTextSource,
  getMindroomLongTextSource,
  getMindroomLongTextSourceIdentity,
} from './longText';
import {
  downloadMindroomLongTextSidecarBlob,
  getMindroomLongTextDownloadName,
} from './longTextDownload';
import { saveFile } from '../native/nativeFileSave';
import { useMindroomLongTextResolvedContent } from './MindroomLongTextText';
import * as css from './MindroomMessageControls.css';
import { MindroomReplyDetails } from './MindroomReplyDetails';
import { glassDenseOverBackdrop } from '../../styles/Glass.css';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';

export function useMindroomMessageControls(
  content: Record<string, unknown>,
  menuOpen: boolean,
  mEvent?: MatrixEvent
) {
  const longTextSource = useMemo(() => {
    const source = getMindroomLongTextSource(content);
    return source ? { ...source, owner: getEventAttachmentOwner(mEvent) } : undefined;
  }, [content, mEvent]);
  const resolvedLongTextContent = useMindroomLongTextResolvedContent(longTextSource, menuOpen);
  const longTextLoading = longTextSource !== undefined && resolvedLongTextContent === undefined;
  const viewerId = useMatrixClient().getUserId() ?? undefined;
  const parsedAiRunInfo = getMindroomAiRunInfo(content);
  // Anyone can write these keys; a cost counts only from MindRoom's own accounts, as in thread totals.
  const aiRunInfo =
    parsedAiRunInfo?.costUsd !== undefined &&
    !isMindroomAgentUserIdForViewer(mEvent?.getSender(), viewerId)
      ? { ...parsedAiRunInfo, costUsd: undefined }
      : parsedAiRunInfo;

  return {
    aiRunInfo,
    eventId: mEvent?.getId(),
    longTextLoading,
    longTextSource,
    resolvedLongTextContent,
  };
}

function MindroomAiRunInfoDialog({
  info,
  eventId,
  open,
  onClose,
  returnFocusRef,
}: {
  info: MindroomAiRunInfo;
  eventId?: string;
  open: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();

  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            setReturnFocus: () => returnFocusRef.current ?? false,
            onDeactivate: onClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog
            className={glassDenseOverBackdrop}
            variant="Surface"
            role="dialog"
            aria-modal="true"
            aria-label={t('mindroomUi.messages.mindroomMessageControls.replyDetails')}
          >
            <PageScroll
              className={css.ReplyDetailsScroll}
              header={
                <Header
                  style={{
                    padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                    borderBottomWidth: config.borderWidth.B300,
                  }}
                  variant="Surface"
                  size="500"
                >
                  <Box grow="Yes">
                    <Text size="H4">
                      {t('mindroomUi.messages.mindroomMessageControls.replyDetails')}
                    </Text>
                  </Box>
                  <IconButton
                    size="300"
                    onClick={onClose}
                    radii="300"
                    aria-label={t('mindroomUi.messages.mindroomMessageControls.close')}
                  >
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Header>
              }
            >
              <MindroomReplyDetails info={info} eventId={eventId} />
            </PageScroll>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function MindroomAiRunInfoButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={css.AiRunInfoButton}
      aria-label={t('mindroomUi.messages.mindroomMessageControls.replyDetails')}
      aria-haspopup="dialog"
      aria-pressed={open}
      onClick={onOpen}
    >
      <Icon size="50" src={Icons.Info} />
    </button>
  );
}

export const MindroomAiRunMenuItem = as<
  'button',
  {
    onOpen: () => void;
  }
>(({ onOpen, ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Info} />}
      radii="300"
      onClick={onOpen}
      aria-haspopup="dialog"
      {...props}
      ref={ref}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {t('mindroomUi.messages.mindroomMessageControls.replyDetails')}
      </Text>
    </MenuItem>
  );
});

export type MindroomAiRunControlsRenderProps = {
  dialog: ReactNode;
  messageBaseRef: React.Ref<HTMLDivElement>;
  onOpen: () => void;
  open: boolean;
};

export function MindroomAiRunControls({
  info,
  eventId,
  forwardedRef,
  children,
}: {
  info: MindroomAiRunInfo;
  eventId?: string;
  forwardedRef: React.Ref<HTMLDivElement> | undefined;
  children: (props: MindroomAiRunControlsRenderProps) => ReactNode;
}) {
  const messageBaseRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const handleMessageBaseRef = useCallback(
    (node: HTMLDivElement | null) => {
      messageBaseRef.current = node;
      assignElementRef(forwardedRef, node);
    },
    [forwardedRef]
  );

  return children({
    dialog: (
      <MindroomAiRunInfoDialog
        info={info}
        eventId={eventId}
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={messageBaseRef}
      />
    ),
    messageBaseRef: handleMessageBaseRef,
    onOpen: () => setOpen(true),
    open,
  });
}

export const MindroomDownloadOriginalMenuItem = as<
  'button',
  {
    source: MindroomLongTextSource;
    onClose?: () => void;
  }
>(({ source, onClose, ...props }, ref) => {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const downloadedFileRef = useRef<{ identity: string; blob: Blob }>();
  const downloadInProgressRef = useRef(false);

  const [downloadState, download] = useAsyncCallback(
    useCallback(async () => {
      const identity = getMindroomLongTextSourceIdentity(source);
      let blob = downloadedFileRef.current?.identity === identity && downloadedFileRef.current.blob;
      if (!blob) {
        blob = await downloadMindroomLongTextSidecarBlob(mx, source, true);
        downloadedFileRef.current = { identity, blob };
      }
      const saved = await saveFile(blob, getMindroomLongTextDownloadName(source));
      if (saved) onClose?.();
    }, [mx, source, onClose])
  );
  const handleDownload = () => {
    if (downloadState.status === AsyncStatus.Loading || downloadInProgressRef.current) return;
    downloadInProgressRef.current = true;
    void download()
      .catch(() => undefined)
      .finally(() => {
        downloadInProgressRef.current = false;
      });
  };

  return (
    <MenuItem
      size="300"
      after={
        downloadState.status === AsyncStatus.Loading ? (
          <Spinner fill="Soft" size="100" />
        ) : (
          <Icon
            size="100"
            src={downloadState.status === AsyncStatus.Error ? Icons.Warning : Icons.Download}
          />
        )
      }
      radii="300"
      onClick={handleDownload}
      disabled={downloadState.status === AsyncStatus.Loading}
      aria-disabled={downloadState.status === AsyncStatus.Loading}
      {...props}
      ref={ref}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {downloadState.status === AsyncStatus.Loading
          ? t('mindroomUi.messages.mindroomMessageControls.downloadingOriginal')
          : downloadState.status === AsyncStatus.Error
          ? t('mindroomUi.messages.mindroomMessageControls.retryDownloadOriginal')
          : t('mindroomUi.messages.mindroomMessageControls.downloadOriginal')}
      </Text>
    </MenuItem>
  );
});
