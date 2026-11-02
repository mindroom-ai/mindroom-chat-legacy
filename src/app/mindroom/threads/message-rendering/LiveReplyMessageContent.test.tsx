import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../../hooks/useMatrixClient';
import { getLiveReplyStore } from '../../live/liveReplyStore';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';

vi.mock('../../../components/RenderMessageContent', async () => {
  const ReactImport = await import('react');
  return {
    RenderMessageContent: (props: Record<string, unknown>) =>
      ReactImport.createElement('render-message-content', props),
  };
});

const ROOM = '!room:example';
const REPLY = '$reply';
const AGENT = '@mindroom_agent:example';

const reply = new MatrixEvent({
  type: 'm.room.message',
  room_id: ROOM,
  event_id: REPLY,
  sender: AGENT,
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Thinking...' },
});
const durable = (status: string): IContent => ({
  msgtype: 'm.text',
  body: 'See https://example.org/docs',
  'io.mindroom.stream_status': status,
});

describe('LiveReplyMessageContent', () => {
  const mx = {} as MatrixClient;
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    getLiveReplyStore(mx).clear();
  });

  const renderedUrlPreview = (content: IContent) => {
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <LiveReplyMessageContent
            mEvent={reply}
            displayName="Agent"
            msgType="m.text"
            ts={1}
            getContent={(() => content) as never}
            urlPreview
            htmlReactParserOptions={{}}
            linkifyOpts={{}}
          />
        </MatrixClientProvider>
      );
    });
    return renderer?.root.findByType('render-message-content' as never).props.urlPreview;
  };

  it('holds URL previews while live frames show over the reply', () => {
    act(() =>
      getLiveReplyStore(mx).ingest(
        ROOM,
        AGENT,
        {
          reply: REPLY,
          sid: '1761858000123-0a1b2c3d',
          seq: 0,
          snapshot: {
            md: 'See https://exa',
            reasoning: '',
            tools: [],
            status: 'streaming',
            activity: '',
          },
        },
        Date.now()
      )
    );

    expect(renderedUrlPreview(durable('streaming'))).toBe(false);
  });

  it('shows URL previews of the final edit', () => {
    expect(renderedUrlPreview(durable('completed'))).toBe(true);
  });
});
