// @vitest-environment jsdom
import React from 'react';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedScheduledTask } from '../threads/scheduledTaskContract';
import { RoomSchedulesDialog } from './RoomSchedulesDialog';

vi.mock('./roomSchedules.css', () => ({
  Dialog: 'dialog',
  Header: 'header',
  Content: 'content',
  Empty: 'empty',
  Card: 'card',
  Wrap: 'wrap',
  Prompt: 'prompt',
  Metadata: 'metadata',
  Awaiting: 'awaiting',
}));
vi.mock('../../components/page', () => ({
  PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
    React.createElement('div', null, header, children),
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useMentionClickHandler', () => ({ useMentionClickHandler: () => vi.fn() }));
vi.mock('../../plugins/react-custom-html-parser', () => ({
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => undefined,
}));

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const recurrenceLines = (task: Partial<ParsedScheduledTask>): string[] => {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      <RoomSchedulesDialog
        roomId="!room:example.org"
        tasks={[
          {
            taskId: 'task',
            status: 'pending',
            threadId: null,
            newThread: false,
            executeAt: null,
            scheduleType: 'cron',
            ...task,
          },
        ]}
        onClose={vi.fn()}
        onOpenThread={vi.fn()}
      />
    );
  });
  const lines = renderer!.root
    .findAll((node) => node.type === 'p')
    .map(textOf)
    .filter(Boolean);
  act(() => renderer!.unmount());
  const start = lines.indexOf('Recurrence') + 1;
  return lines.slice(start, lines.indexOf('Prompt'));
};

describe('RoomSchedulesDialog recurrence', () => {
  it('shows the description as the runtime wrote it and marks the cron expression as UTC', () => {
    expect(
      recurrenceLines({
        cronDescription: 'At 12:00, only on Monday (America/Los_Angeles)',
        cronExpression: '0 19 * * 1',
      })
    ).toEqual(['At 12:00, only on Monday (America/Los_Angeles)', '0 19 * * 1 (UTC)']);
  });

  it('does not add a zone to a description from a runtime that names none', () => {
    expect(
      recurrenceLines({ cronDescription: 'At 12:00, only on Monday', cronExpression: '0 19 * * 1' })
    ).toEqual(['At 12:00, only on Monday', '0 19 * * 1 (UTC)']);
  });

  it('marks the cron expression as UTC when it is the only recurrence line', () => {
    expect(recurrenceLines({ cronExpression: '0 19 * * 1' })).toEqual(['0 19 * * 1 (UTC)']);
  });

  it('shows no zone without a description or cron expression', () => {
    expect(recurrenceLines({})).toEqual(['Execution time unavailable']);
  });
});
