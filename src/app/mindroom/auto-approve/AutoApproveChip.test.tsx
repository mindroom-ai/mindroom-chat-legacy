// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { AutoApproveWindow } from './autoApproveContract';
import { AutoApproveChip } from './AutoApproveChip';

const state = vi.hoisted(() => ({ windows: [] as AutoApproveWindow[], hour24Clock: false }));
vi.mock('../matrix/agentRoomState', () => ({ useAgentRoomState: () => state.windows }));
vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [state.hour24Clock, () => undefined],
}));
vi.mock('./AutoApproveChip.css', () => ({ Chip: 'Chip', ChipIcon: 'ChipIcon' }));
vi.mock('folds', () => ({ Icon: () => null, Icons: { Warning: 'Warning' } }));
vi.mock('../messages/ThreadApprovalControls', () => ({
  ApprovalDialog: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
  ApprovalGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../hooks/useAppLanguageCode', () => ({ useAppLanguageCode: () => 'en' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? JSON.stringify(values) : ''}`,
  }),
}));

const ME = '@alice:example.org';
const NOW = Date.parse('2026-10-22T15:00:00Z');
const room = {
  myUserId: ME,
  getMember: (userId: string) =>
    ({ '@bob:example.org': { name: 'Bob' }, '@carol:example.org': { name: 'Carol' } }[userId] ??
    null),
} as unknown as Room;
let container: HTMLDivElement;
let root: Root;

const chip = () => container.querySelector('button.Chip');
const render = () =>
  act(() => {
    root.render(<AutoApproveChip room={room} threadId="$thread" />);
  });
const time = (expiresAt: number, extra: Intl.DateTimeFormatOptions = {}) =>
  new Date(expiresAt).toLocaleString('en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !state.hour24Clock,
    ...extra,
  });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.windows = [];
  state.hour24Clock = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('shows nothing without an open window in the thread', () => {
  state.windows = [
    { threadId: '$other', requesterId: ME, expiresAt: NOW + 60_000 },
    { threadId: '$thread', requesterId: ME, expiresAt: NOW - 1 },
  ];
  render();
  expect(container.innerHTML).toBe('');
});

it.each([
  ['the viewer', [ME, '@bob:example.org'], 'mindroomUi.autoApprove.label'],
  ['one other person', ['@bob:example.org'], 'mindroomUi.autoApprove.labelOne{"name":"Bob"}'],
  [
    'several other people, the earliest-ending named',
    ['@bob:example.org', '@carol:example.org'],
    'mindroomUi.autoApprove.labelMany{"name":"Bob","count":1}',
  ],
])('names whose calls run without approval: %s', (_, requesters, label) => {
  state.windows = requesters.map((requesterId, index) => ({
    threadId: '$thread',
    requesterId,
    expiresAt: NOW + (index + 1) * 60_000,
  }));
  render();
  expect(chip()?.textContent).toBe(label);
});

it('lists whose calls run without approval and until when, in the viewer’s clock', () => {
  state.hour24Clock = true;
  const ownEnd = NOW + 30 * 60_000;
  const tomorrow = new Date(NOW);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 30, 0, 0);
  state.windows = [
    { threadId: '$thread', requesterId: '@bob:example.org', expiresAt: tomorrow.getTime() },
    { threadId: '$thread', requesterId: ME, expiresAt: ownEnd },
  ];
  render();
  act(() => {
    chip()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const entries = [...container.querySelectorAll('[role="dialog"] section')].map(
    (entry) => entry.textContent
  );
  expect(entries).toEqual([
    `mindroomUi.autoApprove.youmindroomUi.autoApprove.ownUntil${JSON.stringify({
      time: time(ownEnd),
    })}`,
    `BobmindroomUi.autoApprove.until${JSON.stringify({
      time: time(tomorrow.getTime(), { weekday: 'short' }),
    })}`,
  ]);
  expect(entries[1]).toContain('09:30');
});

it('closes the dialog with the last window, so a later window does not reopen it', () => {
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: NOW + 60_000 }];
  render();
  act(() => {
    chip()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  state.windows = [];
  render();
  expect(container.innerHTML).toBe('');
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: NOW + 120_000 }];
  render();
  expect(chip()).not.toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('drops a window that ended while the device slept once the page comes back', () => {
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: NOW + 60_000 }];
  render();
  expect(chip()).not.toBeNull();
  // A sleeping device runs no timers, so only the wall clock moves.
  vi.setSystemTime(NOW + 10 * 60_000);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(chip()).toBeNull();
});

it('drops a window once it ends', () => {
  state.windows = [{ threadId: '$thread', requesterId: ME, expiresAt: NOW + 60_000 }];
  render();
  expect(chip()).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(chip()).toBeNull();
});
