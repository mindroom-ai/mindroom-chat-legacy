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

/** A room where an agent streams thread replies to a question from the reader. */
const setupStreamRoom = async (name: string) => {
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
  const roomName = `${name} ${stamp}`;
  const roomId = await createPrivateRoom(homeserver, reader.accessToken, {
    name: roomName,
    topic: 'Streamed reply read receipt regression fixture.',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const send = (accessToken: string, content: Record<string, unknown>) =>
    sendRoomMessage(homeserver, accessToken, roomId, content);
  const threadReply = (
    rootId: string,
    body: string,
    accessToken: string,
    extra: Record<string, unknown> = {}
  ) =>
    send(accessToken, {
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
  const readReply = (rootId: string, eventId: string) =>
    matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
        accessToken: reader.accessToken,
        body: JSON.stringify({ thread_id: rootId }),
      }
    );
  /** A thread whose reader has already sent a threaded receipt. */
  const startThread = async (question: string) => {
    const rootId = await send(reader.accessToken, { msgtype: 'm.text', body: question });
    // A prior threaded receipt keeps the SDK from treating later replies as read by a legacy client.
    await readReply(rootId, await threadReply(rootId, 'Please answer', reader.accessToken));
    return rootId;
  };
  const streamReply = (rootId: string, body: string) =>
    threadReply(rootId, body, agent.accessToken, { [STREAM_STATUS]: 'streaming' });
  // MindRoom sends the stream status both inside and outside the replacement content.
  const editReply = (replyId: string, body: string, status: string) =>
    send(agent.accessToken, {
      msgtype: 'm.text',
      body: `* ${body}`,
      [STREAM_STATUS]: status,
      'm.new_content': { msgtype: 'm.text', body, [STREAM_STATUS]: status },
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
  return {
    agent,
    credentials,
    editReply,
    homeserver,
    reader,
    readReply,
    roomId,
    roomName,
    send,
    startThread,
    streamReply,
  };
};

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
  const { credentials, editReply, homeserver, reader, roomId, roomName, startThread, ...fixture } =
    await setupStreamRoom('Stream finish receipts');
  const rootId = await startThread(`Question ${Date.now()}`);
  const streamReply = (body: string) => fixture.streamReply(rootId, body);

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

test('reads a reply finished elsewhere that this device knows only as a bundled edit', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials() || !getSecondaryCredentials(), 'Two Matrix accounts required');
  const {
    agent,
    credentials,
    editReply,
    homeserver,
    reader,
    readReply,
    roomId,
    roomName,
    send,
    startThread,
    streamReply,
  } = await setupStreamRoom('Bundled stream finish');
  // The reader read each reply mid-stream on another device, and it finished while away.
  const finishWhileAway = async (rootId: string, answer: string) => {
    const replyId = await streamReply(rootId, 'Thinking');
    await editReply(replyId, 'Partial answer', 'streaming');
    await readReply(rootId, replyId);
    return editReply(replyId, answer, 'completed');
  };
  const olderRoot = await startThread('Older question');
  const olderFinish = await finishWhileAway(olderRoot, 'Older answer');
  // Push the older thread out of the first sync, so its finish is known only bundled with its reply.
  for (let index = 0; index < 25; index += 1) {
    await send(agent.accessToken, { msgtype: 'm.text', body: `Filler ${index}` });
  }
  const newerRoot = await startThread('Newer question');
  const newerFinish = await finishWhileAway(newerRoot, 'Newer answer');

  const receipts: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/receipt/')) receipts.push(request);
  });
  const receiptResponse = async (eventId: string) => {
    const request = receipts.find(
      (entry) =>
        entry.url().includes(`/rooms/${encodeURIComponent(roomId)}/receipt/`) &&
        entry.url().endsWith(`/${encodeURIComponent(eventId)}`)
    );
    return (await request?.response())?.status();
  };

  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const roomLink = page.getByRole('link', { name: roomName }).first();
  await roomLink.click();
  const olderCard = page.locator(`[data-thread-root-id="${olderRoot}"]`);
  const newerCard = page.locator(`[data-thread-root-id="${newerRoot}"]`);
  await expect(olderCard).toHaveAttribute('data-thread-unread', 'true');
  await expect(newerCard).toHaveAttribute('data-thread-unread', 'true');

  // Opening the thread reads its finish.
  await olderCard.click();
  await expect(page.getByText('Older answer')).toBeVisible();
  await expect.poll(() => receiptResponse(olderFinish)).toBe(200);
  await page.goBack();
  await expect(olderCard).toBeVisible();
  await expect(olderCard).not.toHaveAttribute('data-thread-unread');

  // Marking the room read reads the newest finish.
  await roomLink.click({ button: 'right' });
  await page.getByRole('button', { name: 'Mark as Read', exact: true }).click();
  await expect.poll(() => receiptResponse(newerFinish)).toBe(200);
  await expect(newerCard).not.toHaveAttribute('data-thread-unread');
});
