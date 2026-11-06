import { expect, test, type Page, type Request } from '@playwright/test';
import {
  getHomeserver,
  getPrimaryCredentials,
  getSecondaryCredentials,
  hasPrimaryCredentials,
} from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const STREAM_STATUS = 'io.mindroom.stream_status';

const receiptFor = (eventId: string, threadId: string) => (request: Request) =>
  request.method() === 'POST' &&
  /\/receipt\/m\.read(\.private)?\//.test(request.url()) &&
  request.url().endsWith(`/${encodeURIComponent(eventId)}`) &&
  request.postDataJSON()?.thread_id === threadId;

// Headless Chromium always reports focus; emulate leaving and returning to the window.
const setWindowFocus = (page: Page, focused: boolean) =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => value });
    document.dispatchEvent(new FocusEvent(value ? 'focusin' : 'focusout'));
  }, focused);

test('reads a streamed reply watched to the end, and one finished while away stays unread', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials() || !getSecondaryCredentials(), 'Two Matrix accounts required');
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const secondCredentials = getSecondaryCredentials()!;
  const reader = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const agent = await loginToMatrix(
    homeserver,
    secondCredentials.username,
    secondCredentials.password
  );
  const stamp = Date.now();
  const roomName = `Stream finish receipts ${stamp}`;
  const roomId = await createPrivateRoom(homeserver, reader.accessToken, {
    name: roomName,
    topic: 'Streamed reply read receipt regression fixture.',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(homeserver, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: `Question ${stamp}`,
  });
  const threadReply = (body: string, accessToken: string, extra: Record<string, unknown> = {}) =>
    sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body,
      ...extra,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  // A prior threaded receipt keeps the SDK from treating later replies as read by a legacy client.
  const readerReply = await threadReply('Please answer', reader.accessToken);
  await matrixFetch(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(readerReply)}`,
    {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({ thread_id: rootId }),
    }
  );
  const streamReply = (body: string) =>
    threadReply(body, agent.accessToken, { [STREAM_STATUS]: 'streaming' });
  const editReply = (replyId: string, body: string, status: string) =>
    sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body, [STREAM_STATUS]: status },
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });

  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const firstReply = await streamReply('Thinking');
  await page.getByRole('link', { name: roomName }).first().click();
  const card = page.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(card).toBeVisible();
  const openReceipt = page.waitForRequest(receiptFor(firstReply, rootId));
  await card.click();
  await openReceipt;
  await expect(page.getByText('Thinking', { exact: true })).toBeVisible();

  // Receipts are recorded from here on, since the client may send one before an event's ID is known.
  const receipts: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/receipt/')) receipts.push(request);
  });
  const receiptSent = (eventId: string) => receipts.find(receiptFor(eventId, rootId));

  // The watched reply streams and finishes: a receipt reaches the terminal edit.
  const streaming = await editReply(firstReply, 'Partial answer', 'streaming');
  await expect(page.getByText('Partial answer')).toBeVisible();
  const finished = await editReply(firstReply, 'Final answer', 'completed');
  await expect.poll(() => !!receiptSent(finished)).toBe(true);
  expect((await receiptSent(finished)!.response())?.ok()).toBe(true);
  await expect(page.getByText('Final answer')).toBeVisible();
  expect(receiptSent(streaming)).toBeUndefined();

  // A reply that finishes while the window is in the background stays unread
  // until the user comes back to it.
  const secondReply = await streamReply('Second thinking');
  await expect(page.getByText('Second thinking')).toBeVisible();
  await setWindowFocus(page, false);
  const unfocusedFinish = await editReply(secondReply, 'Second answer', 'completed');
  await expect(page.getByText('Second answer')).toBeVisible();
  // A receipt would follow the render within a frame; give it ample time to show up.
  await page.waitForTimeout(1500);
  expect(receiptSent(unfocusedFinish)).toBeUndefined();
  await setWindowFocus(page, true);
  await expect.poll(() => !!receiptSent(unfocusedFinish)).toBe(true);
  expect((await receiptSent(unfocusedFinish)!.response())?.ok()).toBe(true);

  // A reply read half-way is unread again when it finishes while the user is
  // away from the thread, and reading it to the end clears the card.
  const thirdReply = await streamReply('Third thinking');
  await expect(page.getByText('Third thinking')).toBeVisible();
  await expect.poll(() => !!receiptSent(thirdReply)).toBe(true);
  await page.goBack();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-thread-unread');
  const awayFinish = await editReply(thirdReply, 'Third answer', 'completed');
  await expect(card).toHaveAttribute('data-thread-unread', 'true');
  await card.click();
  await expect(page.getByText('Third answer')).toBeVisible();
  await expect.poll(() => !!receiptSent(awayFinish)).toBe(true);
  expect((await receiptSent(awayFinish)!.response())?.ok()).toBe(true);
  await page.goBack();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-thread-unread');
});
