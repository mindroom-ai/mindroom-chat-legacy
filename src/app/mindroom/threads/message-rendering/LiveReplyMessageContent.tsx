import React, { type ComponentProps } from 'react';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import type { GetContentCallback } from '../../../../types/matrix/room';
import { useLiveReplyContent } from '../../live/useLiveReplyContent';

/**
 * Message content with the reply's live frames over it while they are newer than its edits.
 * Live text can end in a cut-off URL, so URL previews wait for the final edit.
 */
export function LiveReplyMessageContent(props: ComponentProps<typeof RenderMessageContent>) {
  const { mEvent, getContent, urlPreview } = props;
  const { content, live } = useLiveReplyContent(useMatrixClient(), mEvent, getContent());
  return (
    <RenderMessageContent
      {...props}
      urlPreview={urlPreview && !live}
      getContent={(() => content) as GetContentCallback}
    />
  );
}
