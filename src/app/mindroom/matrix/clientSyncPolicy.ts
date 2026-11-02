import type { IServerVersions, MatrixClient } from 'matrix-js-sdk/lib/client';
import { buildFeatureSupportMap, Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { Filter } from 'matrix-js-sdk/lib/filter';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';

import { readClientCachedSpecVersions } from '../../state/cachedSpecVersions';

export const LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT = 500;
export const STARTUP_SYNC_TIMELINE_LIMIT = 20;

type IndexedDBStoreWithSyncAccumulator = IndexedDBStore & {
  backend?: {
    syncAccumulator?: {
      opts?: {
        maxTimelineEntries?: number;
      };
    };
  };
};

export const configureLargeSyncArchive = (indexedDBStore: IndexedDBStore): void => {
  const syncAccumulator = (indexedDBStore as IndexedDBStoreWithSyncAccumulator).backend
    ?.syncAccumulator;
  if (!syncAccumulator?.opts) return;

  syncAccumulator.opts.maxTimelineEntries = Math.max(
    syncAccumulator.opts.maxTimelineEntries ?? 0,
    LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT
  );
};

const createStartupSyncFilter = (mx: MatrixClient): Filter => {
  const filter = new Filter(mx.getUserId());
  filter.setDefinition({
    room: {
      timeline: {
        limit: STARTUP_SYNC_TIMELINE_LIMIT,
      },
      state: {
        lazy_load_members: true,
      },
      // Custom ephemeral types reach only clients that opt into them.
      ephemeral: {
        types: ['m.typing', 'm.receipt', 'io.mindroom.live'],
      },
    },
  });

  if (mx.canSupport.get(Feature.ThreadUnreadNotifications) !== ServerSupport.Unsupported) {
    filter.setUnreadThreadNotifications(true);
  }

  return filter;
};

export const startClient = async (mx: MatrixClient) => {
  const cached = readClientCachedSpecVersions(mx);
  if (cached) {
    const cachedServerVersions = cached as IServerVersions;
    // SDK getVersions() returns serverVersionsPromise without rebuilding canSupport;
    // the real-SDK startClient regression test pins both sides of this contract.
    (mx as unknown as { serverVersionsPromise?: Promise<IServerVersions> }).serverVersionsPromise =
      Promise.resolve(cachedServerVersions);
    mx.canSupport = await buildFeatureSupportMap(cachedServerVersions);
  }

  await mx.startClient({
    filter: createStartupSyncFilter(mx),
    lazyLoadMembers: true,
    threadSupport: true,
  });
};
