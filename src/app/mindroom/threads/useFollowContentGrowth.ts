import { type MutableRefObject, type RefObject, useEffect } from 'react';
import { scrollToBottom } from '../../utils/dom';
import type { LiveReplyStore } from '../live/liveReplyStore';

/**
 * Keeps a reader who was at the bottom there while a reply streaming live frames grows the
 * scroll content without a timeline event to pin it.
 * Only growth after a frame applied anywhere in the room follows, so a block the reader expands
 * near the bottom unfolds in place unless a reply in the room is streaming at that moment.
 * The reader counts as at the bottom by their last scroll, before the growth: a measurement
 * correction can move the scroll position along with the growth, so the position after it
 * cannot tell a pinned reader from one a little above the bottom.
 * Only a timeline at its live end follows: at the bottom of older history, the growth is newer
 * events loading, and following it would page the reader through history they have not read.
 */
export const useFollowContentGrowth = (
  getScrollElement: () => HTMLElement | null,
  contentRef: RefObject<HTMLElement>,
  isViewportAtBottomNow: () => boolean,
  atLiveEndRef: MutableRefObject<boolean>,
  liveReplies: LiveReplyStore,
  roomId: string
): void => {
  useEffect(() => {
    const scrollElement = getScrollElement();
    const content = contentRef.current;
    if (!scrollElement || !content) return undefined;
    let pinned = isViewportAtBottomNow();
    let height: number | undefined;
    let frames = liveReplies.frameCount(roomId);
    const onScroll = () => {
      pinned = isViewportAtBottomNow();
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find(({ target }) => target === content);
      if (!entry) return;
      const grew = height !== undefined && entry.contentRect.height > height;
      const framed = liveReplies.frameCount(roomId) !== frames;
      height = entry.contentRect.height;
      frames = liveReplies.frameCount(roomId);
      if (grew && framed && pinned && atLiveEndRef.current) scrollToBottom(scrollElement);
    });
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener('scroll', onScroll);
    };
  }, [atLiveEndRef, contentRef, getScrollElement, isViewportAtBottomNow, liveReplies, roomId]);
};
