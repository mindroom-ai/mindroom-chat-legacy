// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import {
  ApprovalHistory,
  ApprovalReviewGroup,
  ThreadApprovalPermissions,
  ThreadApprovalQueue,
} from './ThreadApprovalControls';
import { ThreadApprovals } from './ThreadApprovalProvider';
import { parseToolApprovalContent } from './toolApproval';

let current: ThreadApprovals;
vi.mock('../../components/page', () => ({
  PageScroll: ({
    header,
    children,
    scrollRef,
  }: {
    header?: React.ReactNode;
    children: React.ReactNode;
    scrollRef?: React.RefObject<HTMLDivElement>;
  }) => (
    <div ref={scrollRef}>
      {header}
      {children}
    </div>
  ),
}));
vi.mock('./ApprovalArgumentFields.css', () => ({
  Arguments: 'Arguments',
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
}));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('./ThreadApprovalProvider', () => ({ useThreadApprovals: () => current }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));
vi.mock('./ApprovalArguments', () => ({ ApprovalArguments: () => null }));
vi.mock('../../styles/Glass.css', () => ({
  glassDenseOverBackdrop: 'glass-dense-over-backdrop',
}));
vi.mock('./ThreadApprovals.css', () => ({
  Bar: 'Bar',
  BarDetail: 'BarDetail',
  BarStatus: 'BarStatus',
  ReviewButton: 'ReviewButton',
  ReviewButtonPending: 'ReviewButtonPending',
  ReviewPulse: 'ReviewPulse',
  Chip: 'Chip',
  HeaderChip: 'HeaderChip',
  ReceiptHeader: 'ReceiptHeader',
  ReceiptLabel: 'ReceiptLabel',
  ReceiptMeta: 'ReceiptMeta',
  ReceiptChevron: 'ReceiptChevron',
  Receipt: 'Receipt',
  ReceiptTool: 'ReceiptTool',
  ReceiptBody: 'ReceiptBody',
  Stack: 'Stack',
  HistoryBody: 'HistoryBody',
  DialogBody: 'DialogBody',
  DialogScroll: 'DialogScroll',
  Group: 'Group',
  Actions: 'Actions',
  Call: 'Call',
  CallHeader: 'CallHeader',
  Section: 'Section',
  SectionHeader: 'SectionHeader',
  SectionIcon: 'SectionIcon',
  SectionTitle: 'SectionTitle',
  SectionCount: 'SectionCount',
  SectionMeta: 'SectionMeta',
  StatusChip: 'StatusChip',
  StatusChipAttention: 'StatusChipAttention',
  StatusChipDone: 'StatusChipDone',
  Durations: 'Durations',
  DurationRow: 'DurationRow',
  Segmented: 'Segmented',
  Segment: 'Segment',
  SingleCall: 'SingleCall',
  CallsToggle: 'CallsToggle',
  DenyRow: 'DenyRow',
  SectionBody: 'SectionBody',
  SectionTool: 'SectionTool',
  BarTitle: 'BarTitle',
  DialogHeading: 'DialogHeading',
}));
vi.mock('focus-trap-react', async (importOriginal) => {
  const { default: FocusTrap } = await importOriginal<typeof import('focus-trap-react')>();
  return {
    // JSDOM has no layout; keep the real trap and focus handoffs.
    default: (props: React.ComponentProps<typeof FocusTrap>) => (
      <FocusTrap
        {...props}
        focusTrapOptions={{
          ...props.focusTrapOptions,
          tabbableOptions: { displayCheck: 'none' },
        }}
      />
    ),
  };
});

it.each(['review', 'permissions'] as const)(
  'focuses the %s dialog on open and restores the composer when its trigger disappears',
  async (mode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const composer = document.createElement('input');
    document.body.append(container, composer);
    const root = createRoot(container);
    const Controls = mode === 'review' ? ThreadApprovalQueue : ThreadApprovalPermissions;
    current = {
      roomId: '!room:example.org',
      threadId: '$thread',
      records: [
        {
          eventId: '$approval',
          sender: '@router:example.org',
          wireStatus: mode === 'review' ? 'pending' : 'approved',
          approval: parseToolApprovalContent('io.mindroom.tool_approval', {
            approval_id: 'one',
            tool_name: 'search',
            agent_name: 'assistant',
            status: mode === 'review' ? 'pending' : 'approved',
            approver_user_id: '@alice:example.org',
            arguments: {},
            requested_at: '2026-09-12T12:00:00Z',
            expires_at: '2999-09-12T12:00:00Z',
            auto_approval:
              mode === 'permissions'
                ? {
                    grant_id: 'grant',
                    expires_at: '2999-09-12T12:00:00Z',
                    revoked_at: null,
                  }
                : undefined,
          })!,
        },
      ],
      now: Date.now(),
      pendingEventIds: new Set(mode === 'review' ? ['$approval'] : []),
      loading: false,
      refresh: () => undefined,
      ingestTimeline: () => undefined,
      actions: new Map(),
      submit: async () => undefined,
      focusConversation: () => composer.focus(),
    };
    try {
      await act(async () => root.render(<Controls />));
      const trigger = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === (mode === 'review' ? 'Review 1' : '1 active permission')
      )!;
      trigger.focus();
      await act(async () => trigger.click());
      const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
      await vi.waitFor(() => expect(document.activeElement).toBe(close));
      current = {
        ...current,
        pendingEventIds: new Set(),
        records: current.records.map((record) => ({
          ...record,
          wireStatus: 'approved',
          approval: { ...record.approval, status: 'approved', autoApproval: null },
        })),
      };
      await act(async () => root.render(<Controls />));
      await act(async () => close.click());
      await vi.waitFor(() => expect(document.activeElement).toBe(composer));
      expect(trigger.isConnected).toBe(false);
    } finally {
      act(() => root.unmount());
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    }
  }
);

it.each([
  { calls: 2, submitted: 0, unapprovable: 0, approveAll: 2, denyAll: 2 },
  { calls: 1, submitted: 0, unapprovable: 0, approveAll: 0, denyAll: 0 },
  { calls: 2, submitted: 1, unapprovable: 0, approveAll: 0, denyAll: 0 },
  { calls: 2, submitted: 0, unapprovable: 1, approveAll: 0, denyAll: 2 },
])(
  'offers bulk actions only for more than one actionable call: $calls calls, $submitted submitted, $unapprovable unapprovable',
  async ({ calls, submitted, unapprovable, approveAll, denyAll }) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const records = Array.from({ length: calls }, (_, index) => ({
      eventId: `$approval-${index}`,
      sender: '@router:example.org',
      wireStatus: 'pending' as const,
      approval: parseToolApprovalContent('io.mindroom.tool_approval', {
        approval_id: `call-${index}`,
        tool_name: 'search',
        agent_name: 'assistant',
        status: 'pending',
        approver_user_id: '@alice:example.org',
        approvable: index >= unapprovable,
        arguments: { index },
        requested_at: '2026-09-12T12:00:00Z',
        expires_at: '2999-09-12T12:00:00Z',
      })!,
    }));
    current = {
      roomId: '!room:example.org',
      threadId: '$thread',
      records,
      now: Date.now(),
      pendingEventIds: new Set(records.map((record) => record.eventId)),
      loading: false,
      refresh: () => undefined,
      ingestTimeline: () => undefined,
      actions: new Map(
        records
          .slice(0, submitted)
          .map((record) => [record.eventId, { kind: 'decision', status: 'submitted' }] as const)
      ),
      submit: async () => undefined,
    };
    try {
      await act(async () => root.render(<ApprovalReviewGroup records={records} />));
      const toggle = [...container.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-expanded') === 'false'
      );
      if (toggle) await act(async () => toggle.click());
      const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
      expect(labels.filter((label) => label === 'Approve')).toHaveLength(
        calls - submitted - unapprovable
      );
      expect(labels.filter((label) => label?.startsWith('Approve all'))).toEqual(
        approveAll ? [`Approve all ${approveAll} once`] : []
      );
      expect(labels.filter((label) => label?.startsWith('Deny all'))).toEqual(
        denyAll ? [`Deny all ${denyAll}`] : []
      );
      expect(container.textContent).not.toContain('Reason for denying all');
    } finally {
      act(() => root.unmount());
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    }
  }
);

const approvalRecord = (index: number, overrides: Record<string, unknown> = {}) => ({
  eventId: `$approval-${index}`,
  sender: '@router:example.org',
  wireStatus: (overrides.status as 'pending' | 'approved') ?? 'pending',
  approval: parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: `call-${index}`,
    tool_name: 'search',
    agent_name: 'assistant',
    status: 'pending',
    approver_user_id: '@alice:example.org',
    arguments: { index },
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2999-09-12T12:00:00Z',
    ...overrides,
  })!,
});

const renderInto = async (element: React.ReactElement) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    rerender: (next: React.ReactElement) => act(async () => root.render(next)),
    cleanup: () => {
      act(() => root.unmount());
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    },
  };
};

it('says which agent is waiting for the viewer and for which tools', async () => {
  const records = [
    approvalRecord(0, { tool_name: 'send_email' }),
    approvalRecord(1),
    approvalRecord(2),
  ];
  current = {
    roomId: '!room:example.org',
    threadId: '$thread',
    records,
    now: Date.now(),
    pendingEventIds: new Set(records.map((record) => record.eventId)),
    loading: false,
    refresh: () => undefined,
    ingestTimeline: () => undefined,
    actions: new Map(),
    submit: async () => undefined,
  };
  const { container, cleanup } = await renderInto(<ThreadApprovalQueue />);
  try {
    const status = container.querySelector('[role="status"]')?.textContent;
    expect(status).toContain('assistant is waiting for you');
    expect(status).toContain('send_email, 2× search');
    expect(container.querySelector('button.ReviewButtonPending')?.textContent).toContain(
      'Review 3'
    );
  } finally {
    cleanup();
  }
});

it('names the person who decided a single historical approval', async () => {
  const { container, cleanup } = await renderInto(
    <ApprovalHistory
      records={[
        approvalRecord(0, {
          status: 'approved',
          resolved_by: '@alice:example.org',
          resolved_at: '2026-09-12T12:01:00Z',
        }),
      ]}
    />
  );
  try {
    const line = container.querySelector('button[aria-expanded]')?.textContent;
    expect(line).toContain('You approved search');
    // The most telling argument follows the decision, as in "path docs/changelog.md".
    expect(line).toContain('index 0');
  } finally {
    cleanup();
  }
});

const reviewContext = (records: ReturnType<typeof approvalRecord>[], submit = vi.fn()) => {
  current = {
    roomId: '!room:example.org',
    threadId: '$thread',
    records,
    now: Date.now(),
    pendingEventIds: new Set(records.map((record) => record.eventId)),
    loading: false,
    refresh: () => undefined,
    ingestTimeline: () => undefined,
    actions: new Map(),
    submit,
  };
  return submit;
};
const buttonsIn = (container: HTMLElement) => [...container.querySelectorAll('button')];

it('presents one pending call with its status, people, and decisions', async () => {
  const records = [
    approvalRecord(0, {
      tool_name: 'send_email',
      requester_id: '@alice:example.org',
      thread_id: '$thread',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      auto_approve_options: [300, 600, 1800],
      approval_scope: {
        id: 'scope-1',
        entity_name: 'assistant',
        invoking_agent: 'assistant',
        operation: { tool_name: 'send_email' },
      },
    }),
  ];
  const submit = reviewContext(records);
  const { container, cleanup } = await renderInto(<ApprovalReviewGroup records={records} />);
  try {
    expect(container.textContent).toContain('send_email');
    expect(container.textContent).toContain('Waiting for you');
    expect(container.textContent).toContain('assistant · requested by you · expires in 24 hours');
    const fiveMinutes = buttonsIn(container).find(
      (button) => button.getAttribute('aria-label') === 'Allow for 5 minutes'
    );
    expect(fiveMinutes?.textContent).toBe('5 min');
    // What a timed approval allows stays on screen, not behind a tooltip.
    expect(container.textContent).toContain('Arguments may differ between calls.');
    await act(async () => fiveMinutes?.click());
    expect(submit).toHaveBeenLastCalledWith(records[0], { status: 'approved', duration: 300 });
    await act(async () =>
      buttonsIn(container)
        .find((button) => button.textContent === 'Approve once')
        ?.click()
    );
    expect(submit).toHaveBeenLastCalledWith(records[0], { status: 'approved' });
  } finally {
    cleanup();
  }
});

it('asks for a reason only after Deny all, then denies every call with it', async () => {
  const timed = {
    thread_id: '$thread',
    requester_id: '@alice:example.org',
    auto_approve_options: [300, 600, 1800],
    approval_scope: {
      id: 'scope-1',
      entity_name: 'assistant',
      invoking_agent: 'assistant',
      operation: { tool_name: 'search' },
    },
  };
  const records = [approvalRecord(0, timed), approvalRecord(1, timed)];
  const submit = reviewContext(records);
  const { container, cleanup } = await renderInto(<ApprovalReviewGroup records={records} />);
  const button = (label: string) =>
    buttonsIn(container).find((candidate) => candidate.textContent === label);
  const reasonInput = () =>
    container.querySelector<HTMLInputElement>('[aria-label="Reason for denying all (optional)"]');
  try {
    const fiveMinutes = () =>
      buttonsIn(container).find(
        (candidate) => candidate.getAttribute('aria-label') === 'Allow for 5 minutes'
      );
    expect(fiveMinutes()).toBeDefined();
    await act(async () => button('Deny all 2')?.click());
    expect(button('Deny all 2')).toBeUndefined();
    expect(fiveMinutes()).toBeUndefined();
    await act(async () => button('Cancel')?.click());
    expect(reasonInput()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    await act(async () => button('Deny all 2')?.click());
    const input = reasonInput();
    expect(input).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'Wrong channel');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Confirm deny all 2')?.click());
    expect(submit).toHaveBeenCalledWith(records[0], { status: 'denied', reason: 'Wrong channel' });
    expect(submit).toHaveBeenCalledWith(records[1], { status: 'denied', reason: 'Wrong channel' });
  } finally {
    cleanup();
  }
});

it('shows the confirmed outcome when a call resolves while the review is open', async () => {
  const records = [approvalRecord(0, { status: 'approved', resolved_by: '@alice:example.org' })];
  reviewContext(records);
  const { container, cleanup } = await renderInto(<ApprovalReviewGroup records={records} />);
  try {
    expect(container.textContent).toContain('Approved');
    expect(container.textContent).not.toContain('Waiting for');
  } finally {
    cleanup();
  }
});

it('lists the calls with their errors once bulk actions no longer apply', async () => {
  const records = [approvalRecord(0), approvalRecord(1)];
  reviewContext(records);
  const { container, rerender, cleanup } = await renderInto(
    <ApprovalReviewGroup records={records} />
  );
  try {
    expect(container.textContent).toContain('Show 2 calls');
    current = {
      ...current,
      actions: new Map([
        [records[0].eventId, { kind: 'decision', status: 'submitted' }],
        [records[1].eventId, { kind: 'decision', status: 'error', error: 'Network down' }],
      ]),
    };
    await rerender(<ApprovalReviewGroup records={records} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Network down');
    expect(container.textContent).not.toContain('Show 2 calls');
  } finally {
    cleanup();
  }
});

it('folds the calls of a group behind a toggle while bulk approval is offered', async () => {
  const records = [approvalRecord(0), approvalRecord(1)];
  reviewContext(records);
  const { container, cleanup } = await renderInto(<ApprovalReviewGroup records={records} />);
  try {
    const labels = () => buttonsIn(container).map((button) => button.textContent);
    expect(labels().filter((label) => label === 'Approve')).toHaveLength(0);
    expect(labels()).toContain('Approve all 2 once');
    const toggle = buttonsIn(container).find((button) =>
      button.textContent?.startsWith('Show 2 calls')
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => toggle?.click());
    expect(labels().filter((label) => label === 'Approve')).toHaveLength(2);
  } finally {
    cleanup();
  }
});

it.each([
  { calls: 1, submitted: 1, statuses: 1, shown: 'the call' },
  { calls: 2, submitted: 2, statuses: 2, shown: 'each call' },
  { calls: 3, submitted: 1, statuses: 1, shown: 'the folded calls' },
])(
  'says a submitted decision waits for the room once, under $shown',
  async ({ calls, submitted, statuses }) => {
    const records = Array.from({ length: calls }, (_, index) => approvalRecord(index));
    reviewContext(records);
    current = {
      ...current,
      actions: new Map(
        records
          .slice(0, submitted)
          .map((record) => [record.eventId, { kind: 'decision', status: 'submitted' }] as const)
      ),
    };
    const { container, cleanup } = await renderInto(<ApprovalReviewGroup records={records} />);
    try {
      const waiting = [...container.querySelectorAll('[role="status"]')].filter(
        (node) => node.textContent === 'Submitted. Waiting for room update.'
      );
      // A listed call reports its own submission; folded calls report it once, for the group.
      expect(waiting).toHaveLength(statuses);
    } finally {
      cleanup();
    }
  }
);

it('says a submitted decision waits for the room once after the folded calls are shown', async () => {
  const records = [approvalRecord(0), approvalRecord(1), approvalRecord(2)];
  reviewContext(records);
  current = {
    ...current,
    actions: new Map([[records[0].eventId, { kind: 'decision', status: 'submitted' }]]),
  };
  const { container, cleanup } = await renderInto(<ApprovalReviewGroup records={records} />);
  try {
    const toggle = buttonsIn(container).find((button) =>
      button.textContent?.startsWith('Show 3 calls')
    );
    expect(toggle).toBeDefined();
    await act(async () => toggle?.click());
    const waiting = [...container.querySelectorAll('[role="status"]')].filter(
      (node) => node.textContent === 'Submitted. Waiting for room update.'
    );
    expect(waiting).toHaveLength(1);
  } finally {
    cleanup();
  }
});
