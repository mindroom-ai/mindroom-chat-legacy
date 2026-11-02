/**
 * CINNY-207 P5.1: engine reconciler.
 *
 * Every thread open schedules one reconcile pass through the
 * P4.1 `BackfillScheduler`. Coverage decides what to PAINT (D7); the
 * reconciler decides what to REPAIR. When cache and server agree the
 * pass is a cheap no-op (fetch, diff, empty). When they diverge (a
 * missed edit, redaction, or relation) the pass applies the repair in place using
 * the P1.2 machinery (`hydrateCachedEvents` → `applyCachedRedactions`,
 * `applyCachedReplaceRelations`, `reconcileRelationEventsWithAggregation`)
 * and fires a single `onRepaired` tick so the render layer picks up
 * the change without per-repair flicker.
 *
 * Scheduler wiring:
 *   - Kind: `'reconcile'` (own dedup domain). Because AC8's dedup key
 *     includes `kind`, a reconcile job and a `'thread-backfill'` job
 *     on the same thread coexist by design — they do different things
 *     (backfill fetches older history; reconcile checks the tail for
 *     server-truth divergence).
 *   - Priority: band 0 (the user is looking at this room / thread
 *     right now; a reconcile that trails a `noteRoomFocused` is the
 *     freshest signal we have).
 *   - Coalescing: falls out of the scheduler for free — a second
 *     `scheduleReconcile` while the first is in-flight returns the
 *     same promise identity, `schedulerDeduped` bumps.
 *
 * Tuwunel stale-copy handling (P3 gate work):
 *   Empirically the docker Tuwunel homeserver serves un-pruned redacted
 *   events on `/relations` and `/messages` for ~10 seconds after a
 *   redaction. `createPreferLiveEventMapper` (see `eventRepository.ts`)
 *   is the single source of truth for re-applying that redaction onto
 *   the SDK live instance (cascades through the SDK's
 *   `Relations.BeforeRedaction` listener and removes stale reaction
 *   chips). The reconciler MUST funnel every fetched raw event through
 *   that mapper — bypassing it would let a stale server copy un-repair
 *   a fresh redaction the client already knew about.
 *
 * F7 removal: the pre-P5 tail refresh (`refreshLatestThreadRelationsTail`)
 * capped at a single limit-200 batch, so a divergence more than 200
 * events deep never converged after open. The reconciler pages further:
 * it keeps requesting until the returned chunk overlaps the cached
 * window by event id, or the SDK signals "no more", or the abort signal
 * fires. Bounded above by `MAX_RECONCILE_ITERATIONS` for the same
 * reason `fetchAllThreadRelations` has a cap — a pathological
 * homeserver can otherwise stream tokens indefinitely.
 */

import { RelationType } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import {
  createPreferLiveEventMapper,
  persistThreadEventCacheSnapshotCommitted,
} from '../threads/eventRepository';
import {
  collectRedactedRelationTargetsFromLookup,
  hydrateCachedEvents,
  reconcileRelationEventsWithAggregation,
} from '../threads/eventCacheEditUtils';
import { logTimelineDebug } from '../threads/timelineDebug';
import { countCacheProbe } from '../threads/cacheProbe';
import { mergeThreadRenderEvents } from '../threads/threadRenderUtils';
import { hasLoadedFirstThreadPage } from '../threads/sdk/threadBootstrapSdk';
import type { BackfillScheduler } from './backfillScheduler';
import { captureCacheStoreWriteLease } from '../threads/cacheStore';
import type { HydratedThreadCachePage } from '../threads/types';
import {
  collectEmbeddedRelationEventIds,
  collectExplicitRedactedEventIds,
  describeRawEventRevision,
  hasEventRevisionUpgrade,
  isEditKnownToRevision,
  mergeEventRevisionDescriptors,
  type EventRevisionDescriptor,
} from '../threads/eventRevision';
import {
  DEFAULT_CONTINUATION_STORE,
  scanThreadRelations,
  type ThreadReconcileContinuationStore,
} from './reconcilerScan';

export type ScheduleReconcileArgs = {
  readonly mx: MatrixClient;
  readonly sessionId: string;
  readonly scheduler: BackfillScheduler;
  readonly roomId: string;
  /**
   * Optional pre-resolved room. When present the reconciler uses it
   * directly instead of `mx.getRoom(roomId)` — required for test
   * harnesses whose mock client's `getRoom` returns null (and cheaper
   * than an extra Map lookup in production).
   */
  readonly room?: Room;
  /**
   * Thread whose relation tail should be reconciled.
   */
  readonly threadId: string;
  /**
   * Hydrated cache page from the open path. Used to diff the fetched
   * server page against what we already have.
   */
  readonly cachedPage?: HydratedThreadCachePage;
  /**
   * Fired at most once per pass, and only when the reconciler actually
   * applied a repair. Receives the fully-mapped, prefer-live event
   * batch the reconciler fetched — the SAME set that was injected
   * into the SDK thread model via `addFetchedEventsToThread`
   * on the SDK-side leg of the P5-GATE-FIX v3 dual-injection.
   *
   * Why the batch is handed to the callback (P5-GATE-FIX v3): the
   * complete-coverage cache-first path skips SDK bootstrap by design;
   * `useThreadRenderState.buildThreadEvents` reads the SDK-populated
   * `thread.events` AND the component-owned
   * `fallbackThreadEventsState.events`. SDK-only injection leaves the
   * fallback state stale on that path. The component-side callback
   * routes this batch through `setSupplementalThreadEvents(threadId,
   * batch)`, whose internal `mergeThreadRenderEvents` dedups by event
   * id — so re-passing a live-known event is a no-op. Keeping this
   * boundary out of the engine preserves the P3.3 render-only
   * invariant (engine does NOT import `setSupplementalThreadEvents`).
   *
   * The intent remains a single batched render tick — the caller does
   * not need to distinguish which repair changed what.
   */
  readonly onRepaired?: (repairedEvents: readonly MatrixEvent[]) => void;
  /**
   * Optional debug trace id. When present, reconciler observability
   * events (`reconcile-scheduled`, `reconcile-complete`) attach it so
   * a capture can be correlated with the surrounding thread-open flow.
   */
  readonly debugTraceId?: string;
  /** Test seam for observing or failing the durable repair write. */
  readonly persistRepair?: typeof persistThreadEventCacheSnapshotCommitted;
  /** Test seam for the durable bounded-scan cursor. */
  readonly continuationStore?: ThreadReconcileContinuationStore;
};

export type ReconcileResult = {
  readonly repaired: boolean;
  /** Total mapped events fetched across all iterations. */
  readonly fetchedCount: number;
  /** Number of `/relations` pages actually issued (bounded above). */
  readonly iterations: number;
  /** True when the executor short-circuited on abort. */
  readonly aborted: boolean;
  /** Canonical repaired view delivered independently to every observer. */
  readonly repairedEvents?: readonly MatrixEvent[];
  /** Defined for repaired passes: whether the repaired cache transaction committed. */
  readonly durable?: boolean;
};

/**
 * CINNY-207 P5-GATE-FIX v2 (AC2 instance-race): resolve the MatrixEvent
 * instances the repair pipeline should mutate.
 *
 * Contract:
 *   - When `cachedPage.hydratedEvents` is populated (the standard
 *     complete-coverage cache-first path), we operate on THOSE
 *     instances — the render layer is holding exactly the same
 *     object references via `fallbackThreadEventsState.events` (see
 *     `useThreadRenderState.buildThreadEvents`), so a `makeReplaced`
 *     or `makeRedacted` call here becomes visible on the next tick.
 *   - Additionally, for each hydrated instance we consult `preferLive`
 *     — if the SDK has a newer live instance for the same event id
 *     (e.g. a live sync just landed the m.replace target update while
 *     the cache still held an older copy), we prefer the live one so
 *     the repair sees the freshest state. This mirrors P1.2's
 *     both-ways-heal contract and keeps the cache path aligned with
 *     the SDK-live path.
 *   - Absent `hydratedEvents` (defensive fallback), we re-hydrate the
 *     raw JSON via `preferLive` — the prior P5.1 behavior. On
 *     complete-coverage this branch is unreachable in production
 *     because `hydrateThreadFromCache` always sets `hydratedEvents`.
 *
 * Root event handling: `hydratedRootEvent` follows the same rule; when
 * absent we fall back to remapping `cachedPage.rootEvent`. Kept
 * ordered "root first, then events" to match the array shape
 * `mapCachedThreadPageEvents` produced pre-fix.
 */
const resolveCachedSnapshotEventsForRepair = ({
  cachedPage,
  preferLive,
  room,
}: {
  cachedPage: HydratedThreadCachePage;
  preferLive: (rawEvent: Partial<IEvent>) => MatrixEvent;
  room: Room;
}): MatrixEvent[] => {
  // Prefer the SDK live instance only when the SDK actually knows the
  // id — otherwise `preferLive` would return a fresh clone (via the
  // wrapped `mapEvent`), which would defeat the whole point of this
  // helper by reintroducing the fresh-clone race the fix is closing.
  // A live-instance win here is the P1.2 both-ways-heal case (SDK's
  // live copy is newer than what the cache clone has); we accept that
  // trade because the SDK subsequently notifies the render layer
  // through the standard thread events + re-render tick.
  const preferredForInstance = (mEvent: MatrixEvent): MatrixEvent => {
    const eventId = mEvent.getId();
    if (!eventId) return mEvent;
    const liveInstance = room.findEventById(eventId);
    return liveInstance ?? mEvent;
  };

  if (cachedPage.hydratedEvents && cachedPage.hydratedEvents.length > 0) {
    const collected: MatrixEvent[] = [];
    if (cachedPage.hydratedRootEvent) {
      collected.push(preferredForInstance(cachedPage.hydratedRootEvent));
    } else if (cachedPage.rootEvent) {
      collected.push(preferLive(cachedPage.rootEvent));
    }
    for (const mEvent of cachedPage.hydratedEvents) {
      // Skip a hydrated instance whose id matches the root we already
      // pushed (defensive — the hydrated events list from
      // `hydrateThreadFromCache` typically does not contain the root
      // as a separate entry, but check for identity to avoid a double
      // entry into the applier's id-to-target map).
      const eventId = mEvent.getId();
      if (
        eventId &&
        cachedPage.hydratedRootEvent &&
        cachedPage.hydratedRootEvent.getId() === eventId
      ) {
        continue;
      }
      collected.push(preferredForInstance(mEvent));
    }
    return collected;
  }

  // Defensive fallback: no hydratedEvents on the page. Rebuild via
  // preferLive from raw JSON — the prior P5.1 behavior. On any path
  // that reaches this branch, the render is not currently holding
  // cache-clone instances (e.g. room-scope reconcile with no thread
  // context), so the object-identity contract does not apply.
  const collected: MatrixEvent[] = [];
  if (cachedPage.rootEvent) {
    collected.push(preferLive(cachedPage.rootEvent));
  }
  for (const rawEvent of cachedPage.events) {
    collected.push(preferLive(rawEvent));
  }
  return collected;
};

const buildCachedRevisionMap = (
  cachedPage: HydratedThreadCachePage
): Map<string, EventRevisionDescriptor> => {
  const revisions = new Map<string, EventRevisionDescriptor>();
  const add = (rawEvent: Partial<IEvent> | undefined): void => {
    const eventId = rawEvent?.event_id;
    if (typeof eventId !== 'string' || eventId.length === 0 || !rawEvent) return;
    const candidate = describeRawEventRevision(rawEvent);
    const current = revisions.get(eventId);
    revisions.set(eventId, current ? mergeEventRevisionDescriptors(current, candidate) : candidate);
  };
  add(cachedPage.rootEvent);
  cachedPage.events.forEach(add);
  return revisions;
};

const buildCachedSenderMap = (cachedPage: HydratedThreadCachePage): Map<string, string> => {
  const senders = new Map<string, string>();
  [cachedPage.rootEvent, ...cachedPage.events].forEach((rawEvent) => {
    if (typeof rawEvent?.event_id === 'string' && typeof rawEvent.sender === 'string') {
      senders.set(rawEvent.event_id, rawEvent.sender);
    }
  });
  return senders;
};

/**
 * The cache folds a same-sender edit into the target it stores and keeps no
 * record of the edit itself, so such a fetched edit is only news when the
 * cached target does not already carry it or a newer one.
 */
const isEditFoldedIntoCache = (
  rawEvent: Partial<IEvent>,
  cachedRevisions: ReadonlyMap<string, EventRevisionDescriptor>,
  cachedSenders: ReadonlyMap<string, string>
): boolean => {
  const relation = (rawEvent.content as Record<string, unknown> | undefined)?.['m.relates_to'] as
    | { rel_type?: string; event_id?: string }
    | undefined;
  if (relation?.rel_type !== RelationType.Replace || typeof relation.event_id !== 'string') {
    return false;
  }
  const target = cachedRevisions.get(relation.event_id);
  if (!target) return false;
  return isEditKnownToRevision(rawEvent, cachedSenders.get(relation.event_id), target);
};

/**
 * True when the diff between the fetched page and the cache introduces
 * an in-place change: a new event id, a redaction whose target was in
 * cache, or an edit whose target was in cache. The reconciler only
 * fires `onRepaired` when this returns true; a diff of pure "same ids,
 * same content" costs zero ticks (the D7 cheap no-op).
 */
const detectDivergence = (
  fetched: Partial<IEvent>[],
  cachedRevisions: Map<string, EventRevisionDescriptor>,
  cachedSenders: ReadonlyMap<string, string>,
  cachedEmbeddedRelationEventIds: ReadonlySet<string>
): boolean => {
  // Redaction targets known to the fetch: divergent when the cache still
  // embeds them as relations, or still holds an unredacted revision of them
  // (an interrupted multi-record write can leave the target record behind
  // its redaction record). The set is a slight superset of raw `redacts`
  // extraction — tombstoned fetched events in it also trip the revision
  // upgrade below, so folding them here only widens toward idempotent
  // repairs.
  for (const eventId of collectExplicitRedactedEventIds(fetched)) {
    if (cachedEmbeddedRelationEventIds.has(eventId)) return true;
    const targetRevision = cachedRevisions.get(eventId);
    if (targetRevision && !targetRevision.redacted) return true;
  }

  for (const rawEvent of fetched) {
    const id = rawEvent.event_id;
    if (typeof id !== 'string' || id.length === 0) continue;

    // New event we did not have. Covers "message the server has that
    // we missed" and "reaction added while offline".
    const cachedRevision = cachedRevisions.get(id);
    if (!cachedRevision) {
      if (isEditFoldedIntoCache(rawEvent, cachedRevisions, cachedSenders)) continue;
      return true;
    }

    if (
      hasEventRevisionUpgrade(describeRawEventRevision(rawEvent), cachedRevision, 'authoritative')
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Add the fetched events (oldest first) to the SDK thread, which after an app
 * open usually holds only its latest page. Events older than that page go in
 * as backfill, and newer ones are appended as history, not live events
 * (replies still announce NewReply). Listeners re-rendered and persisted each
 * live event on its own, which froze the app for seconds when a reconcile
 * fetched a long thread.
 * The repaired batch reaches the render through `onRepaired` and the cache
 * through `persistRepair`. An unopened thread is left alone: loading its first
 * page replaces its timeline and replays its buffered relations.
 *
 * Only events newer than every event an older segment holds go to the live
 * segment. After a sync gap, or once history is joined behind it, older
 * segments hold part of the history; anything not newer than them belongs in
 * or behind them, and prepending it to the live segment put it after newer
 * events, which SDK pagination then linked into a segment cycle that froze the
 * app. Pagination places that history, even when the fetched page does not
 * overlap the older segments.
 */
const addFetchedEventsToThread = (thread: Thread, events: MatrixEvent[]): void => {
  if (!hasLoadedFirstThreadPage(thread)) return;
  const timelineSet = thread.getUnfilteredTimelineSet();
  // Adding an event first applies a deferred sync-gap reset; apply it before
  // reading the segments, so they are the ones the events go into.
  if (events.some((event) => !timelineSet.eventIdToTimeline(event.getId()!))) {
    void thread.flushPendingTimelineReset();
  }
  let newestElsewhereTs = -Infinity;
  timelineSet.getTimelines().forEach((timeline) => {
    if (timeline === thread.liveTimeline) return;
    timeline.getEvents().forEach((event) => {
      newestElsewhereTs = Math.max(newestElsewhereTs, event.getTs());
    });
  });
  const liveEvents = events.filter((event) => event.getTs() > newestElsewhereTs);
  const [earliest] = thread.events;
  // A window that starts at the root already reaches the thread's start.
  if (earliest !== undefined && earliest.getId() === thread.id) {
    thread.addEventsAsHistory(liveEvents);
    return;
  }
  const newerIndex = earliest
    ? liveEvents.findIndex((event) => event.getTs() >= earliest.getTs())
    : -1;
  const backfillCount = newerIndex === -1 ? liveEvents.length : newerIndex;
  // Backfill is prepended one event at a time, so it goes in newest first.
  if (backfillCount > 0) thread.addEvents(liveEvents.slice(0, backfillCount).reverse(), true);
  if (backfillCount < liveEvents.length) thread.addEventsAsHistory(liveEvents.slice(backfillCount));
};

/**
 * Executor for a thread reconcile pass. Fetches `/relations` pages
 * (bounded by MAX_RECONCILE_ITERATIONS) until either the fetched chunk
 * overlaps the cached window by event id (server-truth caught up with
 * cache), the SDK signals `next_batch=undefined`, or an abort fires.
 * Then hydrates the merged event set through the P1.2 machinery to
 * apply any missed edits / redactions / aggregation changes in place.
 *
 * Return value flows back to the reconciler's outer promise so tests
 * (and future callers) can observe whether the pass repaired anything.
 */
const runThreadReconcilePass = async ({
  mx,
  sessionId,
  room,
  roomId,
  threadId,
  cachedPage,
  signal,
  debugTraceId,
  persistRepair,
  continuationStore,
}: {
  mx: MatrixClient;
  sessionId: string;
  room: Room;
  roomId: string;
  threadId: string;
  cachedPage: HydratedThreadCachePage | undefined;
  signal: AbortSignal;
  debugTraceId: string | undefined;
  persistRepair: typeof persistThreadEventCacheSnapshotCommitted;
  continuationStore: ThreadReconcileContinuationStore;
}): Promise<ReconcileResult> => {
  const cachedRevisions = cachedPage
    ? buildCachedRevisionMap(cachedPage)
    : new Map<string, EventRevisionDescriptor>();
  const cachedSenders = cachedPage ? buildCachedSenderMap(cachedPage) : new Map<string, string>();
  const cachedEmbeddedRelationEventIds = collectEmbeddedRelationEventIds(
    cachedPage
      ? [...(cachedPage.rootEvent ? [cachedPage.rootEvent] : []), ...cachedPage.events]
      : []
  );
  const mapper = mx.getEventMapper();
  const preferLive = createPreferLiveEventMapper(room, mapper);

  const scan = await scanThreadRelations({
    mx,
    sessionId,
    room,
    roomId,
    threadId,
    cachedPage,
    cachedEventIds: new Set(cachedRevisions.keys()),
    signal,
    debugTraceId,
    preferLive,
    continuationStore,
  });
  const {
    allMapped,
    allRaw,
    fetchedCount,
    fetchFailed: fetchFailedOccurred,
    iterations,
    pagedPastOverlapForShortfall,
    scanExit,
    serverConfirmedStart,
  } = scan;

  if (scan.aborted) {
    return { repaired: false, fetchedCount, iterations, aborted: true };
  }

  // Zero-fetch fast path — the D7 cheap no-op. When the server returned
  // no events (or all fetches failed) there is nothing to reconcile and
  // no tick to fire.
  if (allMapped.length === 0) {
    await scan.settleWithoutRepair();
    // CINNY-207 AC2 STEP 1 (2026-07-04): treat "fetch failed with no
    // usable pages" AND "server returned empty chunks" as the same
    // outcome bucket for probe purposes — both are silent exits with
    // no divergence assessment possible. `fetchFailedOccurred` flags
    // the first (SDK threw at least once), but both branches must
    // increment a counter so the invariant
    //   reconcilesScheduled == sum(outcome counters)
    // holds. Using a single bucket keeps that arithmetic honest;
    // splitting SDK-threw vs empty-chunk would require another
    // counter and the diagnosis value is low.
    countCacheProbe('reconcilesFetchFailed');
    logTimelineDebug(debugTraceId, 'reconcile-complete', {
      fetchedCount: 0,
      iterations,
      repaired: false,
      roomId,
      threadId,
      fetchFailedOccurred,
    });
    return { repaired: false, fetchedCount, iterations, aborted: false };
  }

  // Deterministic divergence check: does the fetched page introduce
  // anything the cache does not already agree with? Uses the same
  // event-ID and bundled-relation shape the applier will act on, so a
  // negative here proves the applier would be a no-op — skip both the
  // hydrate call and the onRepaired tick to keep the "cached was right"
  // path zero-cost.
  const diverged = detectDivergence(
    allRaw,
    cachedRevisions,
    cachedSenders,
    cachedEmbeddedRelationEventIds
  );

  if (!diverged) {
    await scan.settleWithoutRepair();
    // 2026-07-10 missing-middle fix (upstream #118 review finding): a
    // shortfall-driven full drain that found no divergence still observed
    // the server-confirmed start, so record it with the snapshot. Restricted
    // to shortfall-driven multi-page passes so the ordinary single-page
    // "cached was right" open keeps its zero-persist D7 guarantee.
    if (serverConfirmedStart && pagedPastOverlapForShortfall && allMapped.length > 0) {
      const noDivergenceRootEvent =
        room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId) ?? undefined;
      const startSnapshot = persistRepair({
        sessionId,
        room,
        threadId,
        events: allMapped,
        rootEvent: noDivergenceRootEvent,
        relationSnapshotMode: 'authoritative',
        authoritativeRawEvents: allRaw,
        beforeTokenForEarliest: null,
      });
      await startSnapshot.write.catch(() => false);
      countCacheProbe('reconcilerPersists');
    }
    // CINNY-207 AC2 STEP 1 (2026-07-04): the D7 no-op path — the
    // reconciler ran end to end and confirmed the cache agreed with
    // server truth. Cheap by design; the counter separates this from
    // silent failures upstream.
    countCacheProbe('reconcilesNoDivergence');
    logTimelineDebug(debugTraceId, 'reconcile-complete', {
      fetchedCount,
      iterations,
      repaired: false,
      roomId,
      threadId,
    });
    return { repaired: false, fetchedCount, iterations, aborted: false };
  }

  // Inject the fetched tail before hydration so SDK thread indices and the
  // cache-first render fallback converge on the same MatrixEvent instances.
  // `addEvents` is idempotent by event id.
  const liveThread = room.getThread(threadId);
  if (liveThread && allMapped.length > 0) {
    addFetchedEventsToThread(liveThread, allMapped);
  } else if (!liveThread && allMapped.length > 0) {
    // Complete cache-first opens may intentionally have no SDK thread yet;
    // the repaired batch still reaches the render fallback via `onRepaired`.
    countCacheProbe('reconcilesThreadNull');
    logTimelineDebug(debugTraceId, 'reconcile-thread-null', {
      roomId,
      threadId,
      mappedCount: allMapped.length,
      note: 'room.getThread returned null at injection time — SDK bootstrap skipped by complete-coverage cache-first path; convergence relies on the render-fallback leg via onRepaired',
    });
  }

  // Hydrate the union through the same redaction/edit/aggregation pipeline
  // as cache reads. Re-read the timeline set after `addEvents`, because the
  // SDK may create it during injection.
  const liveThreadTimelineSet = liveThread?.getUnfilteredTimelineSet();
  // Preserve the cache-first render instances; prefer a matching SDK live
  // instance only when one exists. This makes in-place edit/redaction repair
  // visible regardless of whether SDK bootstrap ran.
  const cachedSnapshotEvents = cachedPage
    ? resolveCachedSnapshotEventsForRepair({
        cachedPage,
        preferLive,
        room,
      })
    : [];
  const mergedForHydrate = mergeThreadRenderEvents(cachedSnapshotEvents, allMapped);
  const redactedRelationTargets = collectRedactedRelationTargetsFromLookup(
    allMapped,
    cachedSnapshotEvents
  );
  hydrateCachedEvents({
    room,
    events: mergedForHydrate,
    timelineSets: liveThreadTimelineSet ? [liveThreadTimelineSet] : undefined,
  });
  // Additional pass to reconcile redactions that the prefer-live mapper
  // healed on the live instance — those still need aggregation cleanup
  // against the live timeline's `Relations` container.
  if (liveThreadTimelineSet && redactedRelationTargets.length > 0) {
    reconcileRelationEventsWithAggregation(
      allMapped,
      [{ relations: liveThreadTimelineSet.relations, timelineSet: liveThreadTimelineSet }],
      undefined,
      redactedRelationTargets
    );
  }
  countCacheProbe('reconcilesRepaired');

  // Persist through the engine's normal snapshot boundary so the current
  // repaired view and the next cache-first reopen agree. A failed write still
  // returns the in-memory repair, but does not claim durable convergence.
  const rootEvent =
    room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId) ?? undefined;
  let durable = false;
  const canPersistRepair = scan.scanComplete || (await scan.prepareRepairPersistence());
  if (canPersistRepair) {
    // 2026-07-10 missing-middle fix: when a fresh-head drain observed
    // `next_batch` exhaustion with no fetch failures, record the server-
    // confirmed start via `beforeTokenForEarliest: null` so the next open
    // of a healed thread takes the legitimate complete-coverage paint
    // instead of re-draining. Deliberately NOT upgraded here:
    // `relationSnapshotComplete` — the PR #84 contract reserves that proof
    // for the background prewarm's full /relations drain.
    const repairSnapshot = persistRepair({
      sessionId,
      room,
      threadId,
      events: allMapped,
      rootEvent,
      relationSnapshotMode: 'authoritative',
      authoritativeRawEvents: allRaw,
      ...(serverConfirmedStart ? { beforeTokenForEarliest: null } : {}),
    });
    const writeCommitted = await repairSnapshot.write.catch(() => false);
    countCacheProbe('reconcilerPersists');
    durable = await scan.commitRepairPersistence(writeCommitted === true);
  }

  // `mergedForHydrate` includes cache-held targets as well as fetched
  // relation children, so the caller receives the exact instances mutated by
  // hydration. The render-side sink deduplicates them by event id.
  logTimelineDebug(debugTraceId, 'reconcile-complete', {
    durable,
    fetchedCount,
    iterations,
    scanExit,
    repaired: true,
    roomId,
    threadId,
  });
  return {
    repaired: true,
    fetchedCount,
    iterations,
    aborted: false,
    repairedEvents: mergedForHydrate,
    durable,
  };
};

/**
 * Schedule a reconcile pass. Producer of a `BackfillScheduler` job of
 * kind `'reconcile'` at band 0.
 *
 * D7 rule enforced here: SCHEDULING is unconditional (every open
 * schedules exactly one reconcile — that's AC9). COALESCING happens
 * inside the scheduler — a second call for the same
 * (roomId, threadId, 'reconcile') key while the first is in-flight
 * returns the same promise identity, and `schedulerDeduped` bumps.
 * That gives the "cached was right" path zero extra network use even
 * when multiple UI events (thread open + tab focus) both call in.
 */
export const scheduleReconcile = (args: ScheduleReconcileArgs): Promise<ReconcileResult> => {
  const {
    mx,
    sessionId,
    scheduler,
    roomId,
    room: providedRoom,
    threadId,
    cachedPage,
    onRepaired,
    debugTraceId,
    persistRepair = persistThreadEventCacheSnapshotCommitted,
    continuationStore = DEFAULT_CONTINUATION_STORE,
  } = args;

  // P5-GATE-FIX (AC2 observability): every scheduleReconcile call
  // bumps the counter. That gives a
  // capture the ability to prove the open path fired vs. never fired,
  // regardless of what the scheduler ends up doing (dedup, abort, etc.
  // — those have their own counters). Same lesson as `schedulerFailed`
  // from the P4 gate fix: without a "was it even scheduled?" counter,
  // trace analysis is guesswork.
  countCacheProbe('reconcilesScheduled');

  logTimelineDebug(debugTraceId, 'reconcile-scheduled', {
    roomId,
    threadId,
  });

  const writeLease = captureCacheStoreWriteLease(sessionId, roomId);
  const reconcilePromise = scheduler.enqueue<ReconcileResult>({
    roomId,
    threadId,
    kind: 'reconcile',
    priority: 0,
    execute: (signal) => {
      const room = providedRoom ?? mx.getRoom?.(roomId);
      if (!room) {
        countCacheProbe('reconcilesNoRoom');
        return Promise.resolve({
          repaired: false,
          fetchedCount: 0,
          iterations: 0,
          aborted: false,
        });
      }
      return runThreadReconcilePass({
        mx,
        sessionId,
        room,
        roomId,
        threadId,
        cachedPage,
        signal,
        debugTraceId,
        persistRepair: (snapshot) => persistRepair({ ...snapshot, writeLease }),
        continuationStore,
      });
    },
  });

  if (!onRepaired) return reconcilePromise;

  // Observers are attached to the shared network result, not captured
  // by the first deduped executor. A close/reopen while reconciliation
  // is running therefore lets the new mounted view receive the same
  // repaired batch even if the old callback's mount guard declines it.
  return reconcilePromise.then((result) => {
    if (result.repaired && result.repairedEvents) {
      onRepaired(result.repairedEvents);
      countCacheProbe('reconcilesOnRepairedFired');
    }
    return result;
  });
};
