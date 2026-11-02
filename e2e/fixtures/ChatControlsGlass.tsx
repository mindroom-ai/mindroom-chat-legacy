import React, { useState } from 'react';
import { Button, Icon, Icons, Text, color } from 'folds';
import { Chip } from '../../src/app/components/glass/GlassPrimitives';
import { VoiceRecordingCapsule } from '../../src/app/mindroom/voice/VoiceRecordingCapsule';
import { CollapsibleMessage } from '../../src/app/mindroom/threads/CollapsibleMessage';
import { MFile } from '../../src/app/components/message/MsgTypeRenderers';
import {
  UrlPreview,
  UrlPreviewContent,
  UrlPreviewDescription,
} from '../../src/app/components/url-preview/UrlPreview';
import {
  UploadCard,
  UploadCardError,
  UploadCardProgress,
} from '../../src/app/components/upload-card/UploadCard';
import { MindroomPasteAttachmentContent } from '../../src/app/mindroom/messages/MindroomPasteAttachmentContent';
import { MindroomMessageExtras } from '../../src/app/mindroom/messages/MindroomMessageExtras';
import { MsgType } from 'matrix-js-sdk';

export function ChatControlsGlass() {
  const [paused, setPaused] = useState(false);
  const [action, setAction] = useState('');
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 16,
        background: color.Surface.Container,
        color: color.Surface.OnContainer,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 18,
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        <section
          data-testid="floating-controls"
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}
        >
          <Text size="H4">Recording and floating controls</Text>
          <div data-testid="recording">
            <VoiceRecordingCapsule
              phase={paused ? 'paused' : 'recording'}
              elapsedMs={12000}
              waveform={[0.1, 0.3, 0.6, 0.4, 0.8, 0.5, 0.2, 0.7, 0.9, 0.3]}
              canPause
              onPause={() => setPaused(true)}
              onResume={() => setPaused(false)}
              onDiscard={() => setAction('Recording discarded')}
            />
          </div>
          <div data-testid="disclosure">
            <CollapsibleMessage forceOverflowing>
              <Text as="p">A longer message can be expanded without leaving the conversation.</Text>
            </CollapsibleMessage>
          </div>
          <div data-testid="expanded-disclosure">
            <CollapsibleMessage forceOverflowing collapseMode="initially-expanded">
              <Text as="p">The expanded message keeps its collapse control within reach.</Text>
            </CollapsibleMessage>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {[
              ['Jump to Latest', Icons.ArrowBottom],
              ['Load older messages', Icons.ArrowTop],
              ['Load newer messages', Icons.ArrowBottom],
              ['Jump to Unread', Icons.MessageUnread],
              ['Mark as Read', Icons.CheckTwice],
            ].map(([label, icon]) => (
              <Chip
                key={label}
                variant={label === 'Jump to Unread' ? 'Primary' : 'SurfaceVariant'}
                radii="Pill"
                before={<Icon size="50" src={icon} />}
                onClick={() => setAction(label)}
              >
                <Text size="L400">{label}</Text>
              </Chip>
            ))}
          </div>
          <output aria-live="polite">{action}</output>
        </section>
        <section
          data-testid="card-shells"
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}
        >
          <Text size="H4">Attachments and message extras</Text>
          <div data-testid="attachment">
            <MFile
              outlined
              content={{
                msgtype: MsgType.File,
                body: 'release-notes.txt',
                url: 'mxc://example.org/notes',
                info: { mimetype: 'text/plain', size: 2400 },
              }}
              renderFileContent={() => (
                <Button size="300" variant="Secondary" fill="Soft">
                  Download · 2.4 KB
                </Button>
              )}
            />
          </div>
          <UrlPreview data-testid="link" style={{ maxWidth: '100%' }}>
            <UrlPreviewContent>
              <Text size="T300">Release notes</Text>
              <UrlPreviewDescription>Changes worth sharing with the team.</UrlPreviewDescription>
              <Text size="B300">example.org</Text>
            </UrlPreviewContent>
          </UrlPreview>
          <div data-testid="paste">
            <MindroomPasteAttachmentContent
              attachment={{
                id: 'paste-aabbcc',
                fileName: 'meeting-notes.txt',
                mxcUri: 'mxc://example.org/meeting',
                mimeType: 'text/plain',
                chars: 3200,
                size: 3200,
              }}
            />
          </div>
          <div data-testid="upload">
            <UploadCard
              outlined
              before={<Icon src={Icons.File} />}
              bottom={<UploadCardProgress sentBytes={640} totalBytes={1000} />}
            >
              <Text size="T300">Uploading notes.txt</Text>
            </UploadCard>
          </div>
          <div data-testid="upload-error">
            <UploadCard
              outlined
              compact
              bottom={<UploadCardError>Upload interrupted. Retry.</UploadCardError>}
            >
              <Text size="T300">draft.txt</Text>
            </UploadCard>
          </div>
          <MindroomMessageExtras
            extras={{
              version: 1,
              sections: [
                {
                  title: 'Additional notes',
                  contentType: 'text/plain',
                  content: 'Keep the content sharp.\nOnly the enclosing surface uses glass.',
                  collapsed: false,
                },
              ],
            }}
            htmlReactParserOptions={{}}
            markerContent={{}}
          />
        </section>
      </div>
    </main>
  );
}
