import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, MemoryStore } from 'matrix-js-sdk';
import { color } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { DarkTheme, LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/hooks/useMatrixClient';
import { MindroomToolApprovalCard } from '../../src/app/mindroom/messages/MindroomToolApprovalCard';
import type { ToolApprovalData } from '../../src/app/mindroom/messages/toolApproval';

applyThemeToDom(
  new URLSearchParams(window.location.search).get('theme') === 'dark' ? DarkTheme : LightTheme
);

const approval: ToolApprovalData = {
  approvalId: 'excel-edit',
  toolName: 'microsoft_files_excel_update_range',
  toolCallId: 'excel-edit',
  arguments: {
    file: '/drives/b!fixture/items/01FORECAST',
    worksheet: 'Q3 Forecast',
    address: 'B2:D4',
    values: [
      ['Revenue', 1250000, '=B3*1.08'],
      [null, '0042', null],
      ['Churn', 0.031, null],
    ],
    expected_formulas: [
      ['Revenue', 1180000, '=B3*1.05'],
      ['', '', 'Draft'],
      ['Churn', 0.034, ''],
    ],
    expected_web_url: 'https://contoso.sharepoint.com/sites/finance/Shared Documents/Forecast.xlsx',
    number_formats: [
      [null, null, null],
      [null, '@', null],
      [null, '0.0%', '0.0%'],
    ],
  },
  agentName: 'Finance',
  requesterId: '@avery:example.org',
  approverUserId: null,
  approvable: true,
  status: 'pending',
  requestedAt: '',
  expiresAt: '2999-01-01T00:00:00Z',
  threadId: '$excel-thread',
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
  schedule: null,
};

const matrixClient = createClient({
  baseUrl: window.location.origin,
  userId: '@fixture:localhost',
  store: new MemoryStore(),
});

createRoot(document.getElementById('root')!).render(
  <MatrixClientProvider value={matrixClient}>
    <main
      style={{
        minHeight: '100vh',
        padding: 16,
        background: color.Surface.Container,
        color: color.Surface.OnContainer,
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto' }} data-testid="approval">
        <MindroomToolApprovalCard
          approval={approval}
          roomId="!excel:example.org"
          eventId="$pending"
        />
      </div>
    </main>
  </MatrixClientProvider>
);
