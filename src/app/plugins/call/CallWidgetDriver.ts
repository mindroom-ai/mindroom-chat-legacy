import {
  type Capability,
  type ISendDelayedEventDetails,
  type ISendEventDetails,
  type IReadEventRelationsResult,
  type IRoomEvent,
  WidgetDriver,
  type IWidgetApiErrorResponseDataDetails,
  type ISearchUserDirectoryResult,
  type IGetMediaConfigResult,
  OpenIDRequestState,
  SimpleObservable,
  IOpenIDUpdate,
} from 'matrix-widget-api';
import {
  EventType,
  type IContent,
  MatrixError,
  type MatrixEvent,
  Direction,
  type SendDelayedEventResponse,
  type StateEvents,
  type TimelineEvents,
  MatrixClient,
} from 'matrix-js-sdk';
import { getCallCapabilities } from './utils';
import { downloadMedia, mxcUrlToHttp } from '../../utils/matrix';
import { authenticatedMediaRequestInit } from '../../utils/mediaUrl';

const TO_DEVICE_ENCRYPTION_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;
const TO_DEVICE_BACKGROUND_RETRY_DELAYS_MS = [5000, 10_000, 20_000, 30_000] as const;

type ToDeviceRecipient = { userId: string; deviceId: string };
type MatrixCrypto = NonNullable<ReturnType<MatrixClient['getCrypto']>>;
type EncryptedToDeviceBatch = Awaited<ReturnType<MatrixCrypto['encryptToDeviceMessages']>>;

const recipientKey = ({ userId, deviceId }: ToDeviceRecipient): string =>
  `${userId}\u0000${deviceId}`;
const recipientGenerationKey = (eventType: string, recipient: ToDeviceRecipient): string =>
  `${eventType}\u0000${recipientKey(recipient)}`;

export class CallWidgetDriver extends WidgetDriver {
  private allowedCapabilities: Set<Capability>;

  private readonly mx: MatrixClient;

  private disposed = false;

  private encryptionGeneration = new Map<string, number>();

  private nextEncryptionGeneration = 0;

  public constructor(mx: MatrixClient, private inRoomId: string) {
    super();
    this.mx = mx;

    const deviceId = mx.getDeviceId();
    if (!deviceId) throw new Error('Failed to initialize CallWidgetDriver! Device ID not found.');

    this.allowedCapabilities = getCallCapabilities(inRoomId, mx.getSafeUserId(), deviceId);
  }

  public async validateCapabilities(requested: Set<Capability>): Promise<Set<Capability>> {
    const allow = Array.from(requested).filter((cap) => this.allowedCapabilities.has(cap));
    return new Set(allow);
  }

  public async sendEvent(
    eventType: string,
    content: IContent,
    stateKey: string | null = null,
    targetRoomId: string | null = null
  ): Promise<ISendEventDetails> {
    const roomId = targetRoomId || this.inRoomId;

    let r: { event_id: string } | null;
    if (typeof stateKey === 'string') {
      r = await this.mx.sendStateEvent(
        roomId,
        eventType as keyof StateEvents,
        content as StateEvents[keyof StateEvents],
        stateKey
      );
    } else if (eventType === EventType.RoomRedaction) {
      // special case: extract the `redacts` property and call redact
      r = await this.mx.redactEvent(roomId, content.redacts);
    } else {
      r = await this.mx.sendEvent(
        roomId,
        eventType as keyof TimelineEvents,
        content as TimelineEvents[keyof TimelineEvents]
      );
    }

    return { roomId, eventId: r.event_id };
  }

  public async sendDelayedEvent(
    delay: number | null,
    parentDelayId: string | null,
    eventType: string,
    content: IContent,
    stateKey: string | null = null,
    targetRoomId: string | null = null
  ): Promise<ISendDelayedEventDetails> {
    const roomId = targetRoomId || this.inRoomId;

    let delayOpts;
    if (delay !== null) {
      delayOpts = {
        delay,
        ...(parentDelayId !== null && { parent_delay_id: parentDelayId }),
      };
    } else if (parentDelayId !== null) {
      delayOpts = {
        parent_delay_id: parentDelayId,
      };
    } else {
      throw new Error('Must provide at least one of delay or parentDelayId');
    }

    let r: SendDelayedEventResponse | null;
    if (stateKey !== null) {
      // state event
      r = await this.mx._unstable_sendDelayedStateEvent(
        roomId,
        delayOpts,
        eventType as keyof StateEvents,
        content as StateEvents[keyof StateEvents],
        stateKey
      );
    } else {
      // message event
      r = await this.mx._unstable_sendDelayedEvent(
        roomId,
        delayOpts,
        null,
        eventType as keyof TimelineEvents,
        content as TimelineEvents[keyof TimelineEvents]
      );
    }

    return {
      roomId,
      delayId: r.delay_id,
    };
  }

  public async cancelScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.mx._unstable_cancelScheduledDelayedEvent(delayId);
  }

  public async restartScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.mx._unstable_restartScheduledDelayedEvent(delayId);
  }

  public async sendScheduledDelayedEvent(delayId: string): Promise<void> {
    await this.mx._unstable_sendScheduledDelayedEvent(delayId);
  }

  public async sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: { [userId: string]: { [deviceId: string]: object } }
  ): Promise<void> {
    if (encrypted) {
      const crypto = this.mx.getCrypto();
      if (!crypto) throw new Error('E2EE not enabled');

      // attempt to re-batch these up into a single request
      const invertedContentMap: { [content: string]: { userId: string; deviceId: string }[] } = {};

      // eslint-disable-next-line no-restricted-syntax
      for (const userId of Object.keys(contentMap)) {
        const userContentMap = contentMap[userId];
        // eslint-disable-next-line no-restricted-syntax
        for (const deviceId of Object.keys(userContentMap)) {
          const content = userContentMap[deviceId];
          const stringifiedContent = JSON.stringify(content);
          invertedContentMap[stringifiedContent] = invertedContentMap[stringifiedContent] || [];
          invertedContentMap[stringifiedContent].push({ userId, deviceId });
        }
      }

      const generation = this.nextEncryptionGeneration + 1;
      this.nextEncryptionGeneration = generation;
      Object.entries(contentMap).forEach(([userId, userContentMap]) => {
        Object.keys(userContentMap).forEach((deviceId) => {
          this.encryptionGeneration.set(
            recipientGenerationKey(eventType, { userId, deviceId }),
            generation
          );
        });
      });
      await Promise.all(
        Object.entries(invertedContentMap).map(async ([stringifiedContent, recipients]) => {
          const content = JSON.parse(stringifiedContent);
          const pendingRecipients = await this.encryptAndQueueToDevice(
            crypto,
            eventType,
            content,
            recipients,
            TO_DEVICE_ENCRYPTION_RETRY_DELAYS_MS,
            generation
          );

          if (pendingRecipients.length > 0 && !this.disposed) {
            void this.retryEncryptedToDeviceInBackground(
              crypto,
              eventType,
              content,
              pendingRecipients,
              generation
            );
          }
        })
      );
    } else {
      await this.mx.queueToDevice({
        eventType,
        batch: Object.entries(contentMap).flatMap(([userId, userContentMap]) =>
          Object.entries(userContentMap).map(([deviceId, content]) => ({
            userId,
            deviceId,
            payload: content,
          }))
        ),
      });
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.encryptionGeneration.clear();
  }

  private async encryptAndQueueToDevice(
    crypto: MatrixCrypto,
    eventType: string,
    content: object,
    recipients: ToDeviceRecipient[],
    retryDelaysMs: readonly number[],
    generation: number
  ): Promise<ToDeviceRecipient[]> {
    let pendingRecipients = recipients;

    // Rust crypto omits recipients whose device keys have not reached its
    // store yet. That is common when an agent joins immediately after a call
    // room is created. An empty batch is otherwise indistinguishable from
    // success to Element Call, which then never re-sends the media key.
    // eslint-disable-next-line no-restricted-syntax
    for (const delayMs of retryDelaysMs) {
      pendingRecipients = this.currentEncryptionRecipients(
        eventType,
        pendingRecipients,
        generation
      );
      if (pendingRecipients.length === 0) return [];
      if (delayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
      pendingRecipients = this.currentEncryptionRecipients(
        eventType,
        pendingRecipients,
        generation
      );
      if (pendingRecipients.length === 0) return [];

      this.prepareRoomEncryption(crypto);
      let batch: EncryptedToDeviceBatch;
      try {
        // For tracked users this waits for an in-flight key query. Avoid
        // downloadUncached: that API's returned map does not populate the Rust
        // store used by encryptToDeviceMessages.
        const deviceInfo = await crypto.getUserDeviceInfo(
          Array.from(new Set(pendingRecipients.map(({ userId }) => userId)))
        );
        pendingRecipients = this.currentEncryptionRecipients(
          eventType,
          pendingRecipients,
          generation
        );
        if (pendingRecipients.length === 0) return [];
        const knownRecipients = pendingRecipients.filter((recipient) =>
          deviceInfo.get(recipient.userId)?.has(recipient.deviceId)
        );
        if (knownRecipients.length === 0) continue;
        batch = await crypto.encryptToDeviceMessages(eventType, knownRecipients, content);
        pendingRecipients = this.currentEncryptionRecipients(
          eventType,
          pendingRecipients,
          generation
        );
        if (pendingRecipients.length === 0) return [];
      } catch {
        // Key queries and Olm session creation can race the member join. Keep
        // the exact recipient set pending and retry without widening delivery.
        continue;
      }

      const currentRecipientKeys = new Set(pendingRecipients.map(recipientKey));
      const currentBatch = {
        ...batch,
        batch: batch.batch.filter((recipient) => currentRecipientKeys.has(recipientKey(recipient))),
      };
      const encryptedRecipients = new Set(currentBatch.batch.map(recipientKey));

      if (currentBatch.batch.length > 0) {
        try {
          await this.mx.queueToDevice(currentBatch);
        } catch {
          // A rejected local queue write provides no accepted-recipient result.
          // Keep the exact recipients pending and create fresh ciphertext on
          // retry rather than risk treating an unqueued call key as delivered.
          continue;
        }
      }

      pendingRecipients = this.currentEncryptionRecipients(
        eventType,
        pendingRecipients.filter((recipient) => !encryptedRecipients.has(recipientKey(recipient))),
        generation
      );
      if (pendingRecipients.length === 0) return [];
    }

    return pendingRecipients;
  }

  private prepareRoomEncryption(crypto: MatrixCrypto): void {
    const room = this.mx.getRoom(this.inRoomId);
    if (!room) return;
    // Call-only rooms may never encrypt an ordinary timeline event. Start the
    // SDK's supported preparation on every timed attempt: this lets a room
    // that was initially absent recover and lets Rust's serialized preparation
    // chain restart after an earlier failure. The exact-device polling below
    // bridges the API's intentionally non-awaitable completion.
    crypto.prepareToEncrypt(room);
  }

  private async retryEncryptedToDeviceInBackground(
    crypto: MatrixCrypto,
    eventType: string,
    content: object,
    recipients: ToDeviceRecipient[],
    generation: number
  ): Promise<void> {
    let pendingRecipients = recipients;
    let retryIndex = 0;

    while (pendingRecipients.length > 0 && !this.disposed) {
      const delayMs =
        TO_DEVICE_BACKGROUND_RETRY_DELAYS_MS[
          Math.min(retryIndex, TO_DEVICE_BACKGROUND_RETRY_DELAYS_MS.length - 1)
        ];
      pendingRecipients = await this.encryptAndQueueToDevice(
        crypto,
        eventType,
        content,
        pendingRecipients,
        [delayMs],
        generation
      );
      retryIndex += 1;
    }
  }

  private currentEncryptionRecipients(
    eventType: string,
    recipients: ToDeviceRecipient[],
    generation: number
  ): ToDeviceRecipient[] {
    if (this.disposed) return [];
    return recipients.filter(
      (recipient) =>
        this.encryptionGeneration.get(recipientGenerationKey(eventType, recipient)) === generation
    );
  }

  public async readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number,
    since: string | undefined
  ): Promise<IRoomEvent[]> {
    const safeLimit =
      limit > 0 ? Math.min(limit, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER; // relatively arbitrary

    const room = this.mx.getRoom(roomId);
    if (room === null) return [];
    const results: MatrixEvent[] = [];
    const events = room.getLiveTimeline().getEvents();

    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (results.length >= safeLimit) break;
      if (since !== undefined && ev.getId() === since) break;

      if (
        ev.getType() === eventType &&
        !ev.isState() &&
        (eventType !== EventType.RoomMessage || !msgtype || msgtype === ev.getContent().msgtype) &&
        (ev.getStateKey() === undefined || stateKey === undefined || ev.getStateKey() === stateKey)
      ) {
        results.push(ev);
      }
    }

    return results.map((e) => e.getEffectiveEvent() as IRoomEvent);
  }

  public async askOpenID(observer: SimpleObservable<IOpenIDUpdate>): Promise<void> {
    return observer.update({
      state: OpenIDRequestState.Allowed,
      token: await this.mx.getOpenIdToken(),
    });
  }

  public async readRoomState(
    roomId: string,
    eventType: string,
    stateKey: string | undefined
  ): Promise<IRoomEvent[]> {
    const room = this.mx.getRoom(roomId);
    if (room === null) return [];
    const state = room.getLiveTimeline().getState(Direction.Forward);
    if (state === undefined) return [];

    if (stateKey === undefined)
      return state.getStateEvents(eventType).map((e) => e.getEffectiveEvent() as IRoomEvent);
    const event = state.getStateEvents(eventType, stateKey);
    return event === null ? [] : [event.getEffectiveEvent() as IRoomEvent];
  }

  public async readEventRelations(
    eventId: string,
    roomId?: string,
    relationType?: string,
    eventType?: string,
    from?: string,
    to?: string,
    limit?: number,
    direction?: 'f' | 'b'
  ): Promise<IReadEventRelationsResult> {
    const dir = direction as Direction;
    const targetRoomId = roomId ?? this.inRoomId ?? undefined;

    if (typeof targetRoomId !== 'string') {
      throw new Error('Error while reading the current room');
    }

    const { events, nextBatch, prevBatch } = await this.mx.relations(
      targetRoomId,
      eventId,
      relationType ?? null,
      eventType ?? null,
      { from, to, limit, dir }
    );

    return {
      chunk: events.map((e) => e.getEffectiveEvent() as IRoomEvent),
      nextBatch: nextBatch ?? undefined,
      prevBatch: prevBatch ?? undefined,
    };
  }

  public async searchUserDirectory(
    searchTerm: string,
    limit?: number
  ): Promise<ISearchUserDirectoryResult> {
    const { limited, results } = await this.mx.searchUserDirectory({ term: searchTerm, limit });

    return {
      limited,
      results: results.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
      })),
    };
  }

  public async getMediaConfig(): Promise<IGetMediaConfigResult> {
    return this.mx.getMediaConfig();
  }

  public async uploadFile(file: XMLHttpRequestBodyInit): Promise<{ contentUri: string }> {
    const uploadResult = await this.mx.uploadContent(file);

    return { contentUri: uploadResult.content_uri };
  }

  public async downloadFile(contentUri: string): Promise<{ file: XMLHttpRequestBodyInit }> {
    const httpUrl = mxcUrlToHttp(this.mx, contentUri, true);
    if (!httpUrl) {
      throw new Error('Call widget failed to download file! No http url!');
    }
    // This is the client's own request, so it sends the access token itself rather than relying on
    // the service worker, which may not control the page.
    const blob = await downloadMedia(httpUrl, authenticatedMediaRequestInit(this.mx, httpUrl));
    return { file: blob };
  }

  public getKnownRooms(): string[] {
    return this.mx.getVisibleRooms().map((r) => r.roomId);
  }

  // eslint-disable-next-line class-methods-use-this
  public processError(error: unknown): IWidgetApiErrorResponseDataDetails | undefined {
    return error instanceof MatrixError
      ? { matrix_api_error: error.asWidgetApiErrorData() }
      : undefined;
  }
}
