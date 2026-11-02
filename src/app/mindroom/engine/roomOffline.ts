import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { prefetchEventAttachments } from '../messages/attachmentRepository';
import { collectEventAttachments } from '../messages/eventAttachments';
import { isCacheWritable } from '../threads/cacheHealth';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
  clearRoomCachedContent,
  readRoomAttachmentStorage,
  setRoomAttachmentPinned,
  runCacheEvictionIfOverBudget,
  loadRoomTailDiscontinuity,
  setEvictionDownloadingRoomIds,
  type CacheStoreWriteLease,
} from '../threads/cacheStore';
import {
  readRoomOfflineProgress,
  updateRoomOfflineProgress,
} from '../threads/cacheStore/cacheStoreMeta';
import {
  loadRoomOfflineEventBatch,
  loadCachedEventAcrossRoomScopes,
} from '../threads/cacheStore/cacheStoreEvents';
import { readRoomMissingAttachmentEventIds } from '../threads/cacheStore/cacheStoreAttachments';
import { persistRoomChunkWithPreferLive } from '../threads/eventRepository';
import { clearRoomThreadOpenSeedSnapshots } from '../threads/threadOpenSeedCache';
import { enqueueRoomDeepHistoryJob } from './deepHistoryJob';
import { createOfflineConnection, type OfflineConnection } from './offlineConnection';
import { CURRENT_ROOM_DEEP_HISTORY_TARGET, type PrefetchConfig } from './prefetchPolicy';
import type { BackfillScheduler } from './backfillScheduler';

export type OfflineRoomStatus =
  | 'idle'
  | 'saving'
  | 'ready'
  | 'offline'
  | 'hidden'
  | 'space'
  | 'read-only'
  | 'limited'
  | 'error'
  | 'unavailable';
export type OfflineRoomSnapshot = {
  status: OfflineRoomStatus;
  loaded: boolean;
  opened: boolean;
  storageAvailable: boolean;
  historyExhausted: boolean;
  historyComplete: boolean;
  hasGap: boolean;
  undecryptedEvents: number;
  unresolvedRelations: number;
  savedEvents: number;
  bytes: number;
  saved: number;
  missing: number;
  missingEssential: number;
  pinned: boolean;
  downloading: boolean;
};
export type OfflineRoomController = {
  getSnapshot(roomId: string): OfflineRoomSnapshot;
  subscribe(roomId: string, listener: () => void): () => void;
  download(roomId: string, options?: { includeAllMedia?: boolean }): void;
  cancel(roomId: string): void;
  setPinned(roomId: string, pinned: boolean): Promise<void>;
  clear(roomId: string): Promise<void>;
};
const initialSnapshot = (): OfflineRoomSnapshot => ({
  status: 'idle',
  loaded: false,
  opened: false,
  storageAvailable: false,
  historyExhausted: false,
  historyComplete: false,
  hasGap: false,
  undecryptedEvents: 0,
  unresolvedRelations: 0,
  savedEvents: 0,
  bytes: 0,
  saved: 0,
  missing: 0,
  missingEssential: 0,
  pinned: false,
  downloading: false,
});
type RoomIntent = {
  snapshot: OfflineRoomSnapshot;
  used: number;
  reserved: number;
  visit: number;
  explicit: boolean;
  fullScanPending: boolean;
  includeAllMedia: boolean;
  canceled: boolean;
  running: boolean;
  warmed: boolean;
  dirty: boolean;
};

/** Engine-owned intent and coverage. CacheStore owns durable state and leases;
 * BackfillScheduler owns all work slots and deduplication. */
export const createRoomOfflineController = ({
  mx,
  sessionId,
  scheduler,
  connection = createOfflineConnection(),
  getPrefetchConfig,
  onChanged,
  onPolicyChange,
}: {
  mx: MatrixClient;
  sessionId: string;
  scheduler: BackfillScheduler;
  connection?: OfflineConnection;
  getPrefetchConfig: () => PrefetchConfig;
  onChanged: (roomId: string) => void;
  onPolicyChange?: () => void;
}) => {
  const rooms = new Map<string, RoomIntent>();
  const listeners = new Map<string, Set<() => void>>();
  let focused: string | undefined;
  let started = false;
  let unsubscribe: (() => void) | undefined;
  const state = (roomId: string) => {
    let value = rooms.get(roomId);
    if (!value) {
      value = {
        snapshot: initialSnapshot(),
        used: 0,
        reserved: 0,
        visit: 0,
        explicit: false,
        fullScanPending: false,
        includeAllMedia: false,
        canceled: false,
        running: false,
        warmed: false,
        dirty: false,
      };
      rooms.set(roomId, value);
    }
    return value;
  };
  // Eviction frees whole unprotected rooms; a requested download must not be one.
  const protectDownloads = () =>
    setEvictionDownloadingRoomIds(
      sessionId,
      [...rooms].filter(([, intent]) => intent.explicit).map(([roomId]) => roomId)
    );
  const publish = (roomId: string, patch: Partial<OfflineRoomSnapshot>) => {
    const intent = state(roomId);
    intent.snapshot = { ...intent.snapshot, ...patch, downloading: intent.explicit };
    listeners.get(roomId)?.forEach((notify) => notify());
  };
  const eligible = (roomId: string) => {
    const intent = state(roomId);
    return (
      !intent.canceled &&
      (intent.explicit || focused === roomId || getPrefetchConfig().scope === 'all-rooms')
    );
  };
  const pauseReason = (roomId: string, checkAllowance = true): OfflineRoomStatus | undefined => {
    const intent = state(roomId);
    if (!started || !eligible(roomId)) return 'idle';
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'hidden';
    if (!connection.getSnapshot().connected) return 'offline';
    if (!isCacheWritable()) return 'read-only';
    if (
      checkAllowance &&
      !intent.explicit &&
      intent.used >= (connection.getSnapshot().unmetered ? CURRENT_ROOM_DEEP_HISTORY_TARGET : 200)
    )
      return 'limited';
    return undefined;
  };
  const allowance = (roomId: string): number => {
    if (pauseReason(roomId)) return 0;
    const intent = state(roomId);
    return intent.explicit
      ? 200
      : Math.max(
          0,
          Math.min(
            200,
            (connection.getSnapshot().unmetered ? CURRENT_ROOM_DEEP_HISTORY_TARGET : 200) -
              intent.used -
              intent.reserved
          )
        );
  };
  const reservePage = (roomId: string) => {
    const limit = allowance(roomId);
    if (!limit) return undefined;
    const intent = state(roomId);
    const visit = intent.visit;
    const lease = captureCacheStoreWriteLease(sessionId, roomId);
    intent.reserved += limit;
    return {
      limit,
      settle: (count: number) => {
        if (intent.visit !== visit) return;
        intent.reserved -= limit;
        if (isCacheStoreWriteLeaseCurrent(lease)) intent.used += count;
      },
    };
  };
  const refresh = async (
    roomId: string,
    lease = captureCacheStoreWriteLease(sessionId, roomId)
  ) => {
    try {
      const [progress, attachments, gap] = await Promise.all([
        readRoomOfflineProgress(sessionId, roomId),
        readRoomAttachmentStorage(sessionId, roomId),
        loadRoomTailDiscontinuity(sessionId, roomId),
      ]);
      if (!isCacheStoreWriteLeaseCurrent(lease)) return;
      publish(roomId, {
        ...attachments,
        loaded: true,
        opened: progress.opened === true,
        historyExhausted: progress.exhausted === true,
        historyComplete: progress.exhausted === true && !gap,
        hasGap: !!gap,
        savedEvents: progress.savedEvents ?? 0,
        undecryptedEvents: progress.undecryptedEventIds?.length ?? 0,
        unresolvedRelations: Object.keys(progress.unresolvedRelations ?? {}).length,
      });
    } catch {
      if (isCacheStoreWriteLeaseCurrent(lease))
        publish(roomId, { loaded: true, storageAvailable: false, status: 'unavailable' });
    }
  };
  const bodyBatch = async (
    roomId: string,
    events: MatrixEvent[],
    lease: CacheStoreWriteLease,
    live = false
  ) => {
    const paused = () => !!pauseReason(roomId, false);
    if (!events.length || paused() || !isCacheStoreWriteLeaseCurrent(lease)) return;
    let admitted = true;
    const owners = collectEventAttachments(events);
    const essential = new Set(
      owners
        .filter((owner) => owner.attachments.some((attachment) => attachment.essential))
        .map((owner) => owner.eventId)
    );
    const ordered = events
      .filter((event) => {
        const owner = owners.find((item) => item.eventId === event.getId());
        return owner?.attachments.some(
          (attachment) => attachment.autoDownload || state(roomId).includeAllMedia
        );
      })
      .sort((a, b) => Number(essential.has(b.getId()!)) - Number(essential.has(a.getId()!)));
    if (!ordered.length) return;
    for (const event of ordered) {
      if (paused() || !isCacheStoreWriteLeaseCurrent(lease)) return;
      // The scheduler retains one replacement behind a draining job with the same key.
      // Superseding live work must not join an older revision's download and lose this update.
      if (live) scheduler.abort(roomId, event.getId(), 'room-attachments');
      await scheduler
        .enqueue({
          roomId,
          threadId: live ? event.getId() : undefined,
          kind: 'room-attachments',
          priority: 4,
          execute: async (signal) => {
            if (paused() || !isCacheStoreWriteLeaseCurrent(lease)) return;
            await prefetchEventAttachments(mx, [event], {
              signal,
              writeLease: lease,
              includeAllMedia: state(roomId).includeAllMedia,
              canDownload: async () => {
                admitted = await canSavePage(roomId, lease);
                return admitted && !paused() && isCacheStoreWriteLeaseCurrent(lease);
              },
            });
          },
        })
        .catch((error: unknown) => {
          if (!live || !(error instanceof Error) || error.name !== 'AbortError') throw error;
        });
      if (
        !admitted ||
        (owners.some((owner) => owner.eventId === event.getId() && owner.attachments.length) &&
          !(await canSavePage(roomId, lease)))
      )
        return false;
    }
    return true;
  };
  const canSavePage = async (
    roomId: string,
    lease = captureCacheStoreWriteLease(sessionId, roomId)
  ) => {
    const pressure = (await runCacheEvictionIfOverBudget(sessionId)).underPressure;
    if (!isCacheStoreWriteLeaseCurrent(lease)) return false;
    if (pressure) publish(roomId, { status: 'space' });
    return !pressure;
  };
  const run = async (roomId: string): Promise<void> => {
    const intent = state(roomId);
    if (intent.running) {
      intent.dirty = true;
      return;
    }
    intent.running = true;
    intent.dirty = false;
    const lease = captureCacheStoreWriteLease(sessionId, roomId);
    const current = () => started && isCacheStoreWriteLeaseCurrent(lease) && eligible(roomId);
    try {
      await refresh(roomId, lease);
      if (!current() || !intent.snapshot.storageAvailable) return;
      const pause = pauseReason(roomId);
      if (pause) {
        publish(roomId, { status: pause });
        return;
      }
      const room = mx.getRoom(roomId);
      if (!room) return;
      // Eviction clears a room's progress along with its text, so a room this
      // session warmed before may come back empty.
      const evictedSinceWarm = !intent.snapshot.opened;
      if (!(await updateRoomOfflineProgress(sessionId, roomId, { opened: true }, lease))) {
        publish(roomId, { status: isCacheWritable() ? 'error' : 'read-only' });
        return;
      }
      publish(roomId, { status: 'saving' });
      const recent = room.getLiveTimeline()?.getEvents?.().slice(-200) ?? [];
      if ((!intent.warmed || evictedSinceWarm) && recent.length) {
        const saved = await persistRoomChunkWithPreferLive({
          mx,
          sessionId,
          room,
          chunk: recent.map((event) => event.event),
          mappedEvents: recent,
          roomTailLoaded: !(await loadRoomTailDiscontinuity(sessionId, roomId)),
          writeLease: lease,
        });
        if (saved && (await bodyBatch(roomId, saved.events, lease)) === false) {
          await refresh(roomId, lease);
          return;
        }
      }
      intent.warmed = true;
      // Automatic work visits pending owners only. Explicit Download also repairs old retained data.
      const retryProgress = await readRoomOfflineProgress(sessionId, roomId);
      // Each explicit request covers the prefix skipped by automatic continuation.
      let after = intent.explicit ? undefined : retryProgress.retryAfterEventId ?? undefined;
      intent.fullScanPending = false;
      let retried = 0;
      const pendingIds = intent.explicit
        ? []
        : [
            ...new Set([
              ...(await readRoomMissingAttachmentEventIds(sessionId, roomId)),
              ...(retryProgress.undecryptedEventIds ?? []),
              ...Object.keys(retryProgress.unresolvedRelations ?? {}),
            ]),
          ].sort();
      do {
        if (!current() || pauseReason(roomId)) break;
        const ids = pendingIds.filter((id) => !after || id > after).slice(0, 200);
        const batch = intent.explicit
          ? await loadRoomOfflineEventBatch(sessionId, roomId, after)
          : {
              events: (
                await Promise.all(
                  ids.map((id) => loadCachedEventAcrossRoomScopes(sessionId, roomId, id))
                )
              ).filter((event): event is NonNullable<typeof event> => !!event),
              nextEventId: pendingIds.some((id) => id > (ids.at(-1) ?? after ?? ''))
                ? ids.at(-1)
                : undefined,
            };
        const saved = await persistRoomChunkWithPreferLive({
          mx,
          sessionId,
          room,
          chunk: batch.events,
          roomTailLoaded: false,
          writeLease: lease,
        });
        if (saved && (await bodyBatch(roomId, saved.events, lease)) === false) {
          await refresh(roomId, lease);
          return;
        }
        if (!current() || pauseReason(roomId, false)) return;
        after = batch.nextEventId;
        if (
          !(await updateRoomOfflineProgress(
            sessionId,
            roomId,
            { retryAfterEventId: after ?? null },
            lease
          ))
        )
          return;
        // Download may have promoted this in-flight pass. The existing rerun
        // starts its full scan before this pass can finish the new intent.
        if (intent.fullScanPending) return;
        retried += batch.events.length;
      } while (
        after &&
        (intent.explicit ||
          retried < (connection.getSnapshot().unmetered ? CURRENT_ROOM_DEEP_HISTORY_TARGET : 200))
      );
      while (current() && !pauseReason(roomId)) {
        if (!(await canSavePage(roomId))) return;
        const page = await enqueueRoomDeepHistoryJob({
          mx,
          sessionId,
          scheduler,
          roomId,
          writeLease: lease,
          reservePage,
          canRun: () => current() && !pauseReason(roomId),
        });
        if (!current()) return;
        if (!page) {
          // A gap page can hold the shared allowance. Keep its active status
          // until it settles, including failures that publish no recovery.
          await Promise.allSettled(
            scheduler
              .pendingJobs()
              .filter((job) => job.roomId === roomId && job.kind === 'gap-fill')
              .map((job) => job.promise)
          );
          if (current()) publish(roomId, { status: pauseReason(roomId) ?? 'idle' });
          return;
        }
        // Essential bodies for this committed page precede the next page.
        const bodiesAdmitted = await bodyBatch(roomId, page.events, lease);

        await refresh(roomId, lease);
        onChanged(roomId);
        if (bodiesAdmitted === false) return;
        if (intent.fullScanPending) return;
        if (page.exhausted) {
          intent.explicit = intent.explicit && intent.snapshot.hasGap;
          protectDownloads();
          publish(roomId, { status: 'ready' });
          return;
        }
      }
      if (current()) publish(roomId, { status: pauseReason(roomId) ?? 'idle' });
    } catch (error) {
      if (current())
        publish(roomId, {
          status:
            pauseReason(roomId) ??
            (error instanceof Error && error.name === 'AbortError' ? 'idle' : 'error'),
        });
    } finally {
      intent.running = false;
      if (intent.dirty && started && eligible(roomId) && !pauseReason(roomId)) {
        intent.dirty = false;
        void run(roomId);
      }
    }
  };
  const recheck = () => {
    rooms.forEach((intent, roomId) => {
      const pause = pauseReason(roomId);
      if (pause) {
        scheduler
          .pendingJobs()
          .filter(
            (job) =>
              job.roomId === roomId &&
              ['room-deep-history', 'room-attachments', 'gap-fill'].includes(job.kind)
          )
          .forEach((job) => scheduler.abort(roomId, job.threadId, job.kind));
        publish(roomId, { status: pause });
      } else if (roomId === focused || intent.explicit) void run(roomId);
    });
    onPolicyChange?.();
  };
  const controller: OfflineRoomController = {
    getSnapshot: (roomId) => state(roomId).snapshot,
    subscribe: (roomId, listener) => {
      const set = listeners.get(roomId) ?? new Set();
      set.add(listener);
      listeners.set(roomId, set);
      void refresh(roomId).catch(() => undefined);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(roomId);
      };
    },
    download: (roomId, options) => {
      const intent = state(roomId);
      intent.explicit = true;
      intent.fullScanPending = true;
      intent.canceled = false;
      intent.includeAllMedia = options?.includeAllMedia === true;
      protectDownloads();
      onPolicyChange?.();
      void run(roomId);
    },
    cancel: (roomId) => {
      const intent = state(roomId);
      intent.explicit = false;
      intent.fullScanPending = false;
      intent.canceled = true;
      intent.dirty = false;
      protectDownloads();
      scheduler
        .pendingJobs()
        .filter(
          (job) =>
            job.roomId === roomId &&
            ['room-deep-history', 'room-attachments', 'gap-fill'].includes(job.kind)
        )
        .forEach((job) => scheduler.abort(roomId, job.threadId, job.kind));
      publish(roomId, { status: 'idle' });
    },
    setPinned: async (roomId, pinned) => {
      await setRoomAttachmentPinned(sessionId, roomId, pinned);
      await refresh(roomId);
    },
    clear: async (roomId) => {
      controller.cancel(roomId);
      state(roomId).warmed = false;
      scheduler
        .pendingJobs()
        .filter((job) => job.roomId === roomId)
        .forEach((job) => scheduler.abort(roomId, job.threadId, job.kind));
      await clearRoomCachedContent(sessionId, roomId);
      const room = mx.getRoom(roomId);
      if (room) clearRoomThreadOpenSeedSnapshots(room);
      publish(roomId, {
        ...initialSnapshot(),
        loaded: true,
        storageAvailable: state(roomId).snapshot.storageAvailable,
        status: isCacheWritable() ? 'idle' : 'read-only',
      });
      onChanged(roomId);
    },
  };
  return {
    controller,
    allowance,
    canSavePage,
    reservePage,
    recheck,
    focus: (roomId: string) => {
      if (focused === roomId) return;
      const previous = focused;
      focused = roomId;
      const intent = state(roomId);
      intent.used = 0;
      intent.reserved = 0;
      intent.visit += 1;
      if (previous && !state(previous).explicit) {
        scheduler.abort(previous, undefined, 'room-deep-history');
        scheduler.abort(previous, undefined, 'room-attachments');
      }
      void run(roomId);
    },
    blur: (roomId: string) => {
      if (focused === roomId) {
        focused = undefined;
        recheck();
      }
    },
    observe: async (
      events: MatrixEvent[],
      roomId: string,
      lease = captureCacheStoreWriteLease(sessionId, roomId)
    ): Promise<void> => {
      try {
        const progress = await readRoomOfflineProgress(sessionId, roomId);
        if (
          !progress.opened ||
          !started ||
          !isCacheStoreWriteLeaseCurrent(lease) ||
          state(roomId).canceled
        )
          return;
        await bodyBatch(roomId, events, lease, true);
        if (listeners.has(roomId)) await refresh(roomId, lease);
      } catch {
        /* Live paint and ordinary sync persistence remain available. */
      }
    },
    start: () => {
      started = true;
      // stop() released the protection; downloads it paused resume on recheck.
      protectDownloads();
      unsubscribe = connection.subscribe(recheck);
      void (typeof navigator === 'undefined' ? undefined : navigator.storage?.persist?.())?.catch(
        () => undefined
      );
    },
    stop: () => {
      started = false;
      setEvictionDownloadingRoomIds(sessionId, []);
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
};
