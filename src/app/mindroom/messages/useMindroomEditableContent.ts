import { useEffect, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getEditedEvent } from '../../utils/room';
import { hydrateCachedMindroomLongText } from './attachmentRepository';
import { loadMindroomEditableContent } from './longEdit';

export type MindroomEditableContent = {
  /** The latest content of the message, whole; missing until loaded or when it cannot be. */
  content?: Record<string, unknown>;
  failed: boolean;
};

/** The content the editor starts from: the latest edit or the message, with a long text whole. */
export const useMindroomEditableContent = (
  room: Room,
  mEvent: MatrixEvent
): MindroomEditableContent => {
  const mx = useMatrixClient();
  const [editable, setEditable] = useState<MindroomEditableContent>({ failed: false });

  useEffect(() => {
    const eventId = mEvent.getId()!;
    const timeline = room.getTimelineForEvent(eventId);
    const editedEvent = timeline && getEditedEvent(eventId, mEvent, timeline.getTimelineSet());
    const latest: Record<string, unknown> =
      editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent();
    let cancelled = false;
    // No cache owner: the editor only reads the text, usually already cached by the timeline.
    loadMindroomEditableContent(latest, (source) => hydrateCachedMindroomLongText(mx, source))
      .catch(() => undefined)
      .then((content) => {
        if (!cancelled) setEditable({ content, failed: content === undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [mx, room, mEvent]);

  return editable;
};
