import React from 'react';
import { Button, Text, color } from 'folds';
import parse from 'html-react-parser';
import { CustomEditor, useEditor } from '../../src/app/components/editor';
import { MindroomThreadSummaryCard } from '../../src/app/mindroom/messages/MindroomThreadSummaryCard';
import { MindroomToolApprovalCard } from '../../src/app/mindroom/messages/MindroomToolApprovalCard';
import {
  ApprovalGroup,
  ApprovalHistory,
} from '../../src/app/mindroom/messages/ThreadApprovalControls';
import { ApprovalReceipt } from '../../src/app/mindroom/messages/ApprovalReceipt';
import { useMindroomToolTraceMarkerParserOptions } from '../../src/app/mindroom/messages/MindroomHtmlBlocks';
import { resolveHtmlReactParserOptions } from '../../src/app/utils/htmlReactParserOptions';
import type { ToolApprovalData } from '../../src/app/mindroom/messages/toolApproval';
import * as approvals from '../../src/app/mindroom/messages/ThreadApprovals.css';

const approval: ToolApprovalData = {
  approvalId: 'glass-review',
  toolName: 'web_search',
  toolCallId: 'glass-review',
  arguments: { query: 'Release notes' },
  agentName: 'Research',
  requesterId: '@avery:example.org',
  approverUserId: null,
  approvable: true,
  status: 'pending',
  requestedAt: '',
  expiresAt: '2999-01-01T00:00:00Z',
  threadId: '$glass-thread',
  resolvedAt: null,
  resolvedBy: null,
  resolutionReason: null,
  autoApproveOptions: [],
  autoApproval: null,
  scope: null,
  provenance: null,
  responseEventId: null,
  argumentsTruncated: false,
  fullArguments: null,
  argumentSource: null,
};
const toolHtml = '<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>read_file</code> [2]</p>';

const toolBaseOptions = {};
const toolContent = { formatted_body: toolHtml };

export function MessageGlass() {
  const toolParserOptions = resolveHtmlReactParserOptions(
    useMindroomToolTraceMarkerParserOptions(toolBaseOptions, toolContent)
  );
  const editor = useEditor();
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 16,
        background: color.Surface.Container,
        color: color.Surface.OnContainer,
      }}
    >
      <div style={{ display: 'grid', gap: 16, maxWidth: 600, margin: '0 auto' }}>
        <Text size="H4">Conversation surfaces</Text>
        <div data-testid="summary">
          <MindroomThreadSummaryCard
            summaryInfo={{ summaryText: 'Review the release notes together', messageCount: 12 }}
            renderBody={({ body }) => body}
          />
        </div>
        <div data-testid="tool">{parse(toolHtml, toolParserOptions)}</div>
        <div data-testid="history">
          <ApprovalHistory
            records={[
              {
                eventId: '$approval',
                sender: '@research:example.org',
                wireStatus: 'approved',
                approval: { ...approval, status: 'approved' },
              },
            ]}
          />
        </div>
        <div data-testid="approval">
          <MindroomToolApprovalCard
            approval={approval}
            roomId="!glass:example.org"
            eventId="$pending"
          />
        </div>
        <div data-testid="receipt">
          <ApprovalReceipt approval={{ ...approval, status: 'approved' }} />
        </div>
        <div data-testid="approval-group">
          <ApprovalGroup>
            <b>web_search · 2 calls</b>
            <small>Research · Requested by Avery</small>
            <div className={approvals.Actions}>
              <Button size="300" variant="Success" fill="Soft" outlined>
                Approve all 2 once
              </Button>
              <Button size="300" variant="Critical" fill="Soft" outlined>
                Deny all 2
              </Button>
            </div>
          </ApprovalGroup>
        </div>
        <div>
          <div className={approvals.Bar} data-testid="approval-bar">
            <small>2 calls paused for approval</small>
            <Button size="300" variant="Warning" fill="Soft">
              Review 2
            </Button>
          </div>
          <div data-testid="composer">
            <CustomEditor editor={editor} editableName="Message" placeholder="Send a message" />
          </div>
        </div>
      </div>
    </main>
  );
}
