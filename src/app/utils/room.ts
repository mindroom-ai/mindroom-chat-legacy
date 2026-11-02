import { IconName, IconSrc } from 'folds';

import {
  EventTimeline,
  EventTimelineSet,
  EventType,
  IMentions,
  IPowerLevelsContent,
  IPushRule,
  IPushRules,
  JoinRule,
  MatrixClient,
  MatrixEvent,
  MsgType,
  NotificationCountType,
  RelationType,
  Room,
  RoomMember,
} from 'matrix-js-sdk';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { AccountDataEvent } from '../../types/matrix/accountData';
import {
  IRoomCreateContent,
  Membership,
  MessageEvent,
  NotificationType,
  RoomToParents,
  RoomType,
  StateEvent,
  UnreadInfo,
} from '../../types/matrix/room';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from './editEvent';
import { mxcUrlToHttp } from './mediaUrl';
import {
  copyMindroomResolvedEditMetadata,
  getMindroomLongTextSource,
  logMindroomEditDebug,
} from '../mindroom/messages/editResolution';
import { countCacheProbe } from '../mindroom/threads/cacheProbe';

export const logEditDebug = logMindroomEditDebug;

export const getStateEvent = (
  room: Room,
  eventType: StateEvent,
  stateKey = ''
): MatrixEvent | undefined =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(eventType, stateKey) ??
  undefined;

export const getStateEvents = (room: Room, eventType: StateEvent): MatrixEvent[] =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(eventType) ?? [];

export const getAccountData = (
  mx: MatrixClient,
  eventType: AccountDataEvent
): MatrixEvent | undefined => mx.getAccountData(eventType as any);

export const getMDirects = (mDirectEvent: MatrixEvent): Set<string> => {
  const roomIds = new Set<string>();
  const userIdToDirects = mDirectEvent?.getContent();

  if (userIdToDirects === undefined) return roomIds;

  Object.keys(userIdToDirects).forEach((userId) => {
    const directs = userIdToDirects[userId];
    if (Array.isArray(directs)) {
      directs.forEach((id) => {
        if (typeof id === 'string') roomIds.add(id);
      });
    }
  });

  return roomIds;
};

export const isDirectInvite = (room: Room | null, myUserId: string | null): boolean => {
  if (!room || !myUserId) return false;
  const me = room.getMember(myUserId);
  const memberEvent = me?.events?.member;
  const content = memberEvent?.getContent();
  return content?.is_direct === true;
};

export const isSpace = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  if (!event) return false;
  return event.getContent().type === RoomType.Space;
};

/** The room that holds a homeserver's shared emoji packs, which no room list or picker shows. */
export const isMindroomEmojiRoom = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  return event?.getContent().type === RoomType.MindroomEmoji;
};

export const isRoom = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  if (!event) return true;
  const { type } = event.getContent();
  return type !== RoomType.Space && type !== RoomType.MindroomEmoji;
};

export const isUnsupportedRoom = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  if (!event) return true; // Consider room unsupported if m.room.create event doesn't exist
  return event.getContent().type !== undefined && event.getContent().type !== RoomType.Space;
};

export function isValidChild(mEvent: MatrixEvent): boolean {
  return (
    mEvent.getType() === StateEvent.SpaceChild &&
    Array.isArray(mEvent.getContent<{ via: string[] }>().via)
  );
}

export const getAllParents = (roomToParents: RoomToParents, roomId: string): Set<string> => {
  const allParents = new Set<string>();

  const addAllParentIds = (rId: string) => {
    if (allParents.has(rId)) return;
    allParents.add(rId);

    const parents = roomToParents.get(rId);
    parents?.forEach((id) => addAllParentIds(id));
  };
  addAllParentIds(roomId);
  allParents.delete(roomId);
  return allParents;
};

export const getSpaceChildren = (room: Room) =>
  getStateEvents(room, StateEvent.SpaceChild).reduce<string[]>((filtered, mEvent) => {
    const stateKey = mEvent.getStateKey();
    if (isValidChild(mEvent) && stateKey) {
      filtered.push(stateKey);
    }
    return filtered;
  }, []);

export const mapParentWithChildren = (
  roomToParents: RoomToParents,
  roomId: string,
  children: string[]
) => {
  const allParents = getAllParents(roomToParents, roomId);
  children.forEach((childId) => {
    if (allParents.has(childId)) {
      // Space cycle detected.
      return;
    }
    const parents = roomToParents.get(childId) ?? new Set<string>();
    parents.add(roomId);
    roomToParents.set(childId, parents);
  });
};

export const getRoomToParents = (mx: MatrixClient): RoomToParents => {
  const map: RoomToParents = new Map();
  mx.getRooms()
    .filter((room) => isSpace(room))
    .forEach((room) => mapParentWithChildren(map, room.roomId, getSpaceChildren(room)));

  return map;
};

export const getOrphanParents = (roomToParents: RoomToParents, roomId: string): string[] => {
  const parents = getAllParents(roomToParents, roomId);
  const orphanParents = Array.from(parents).filter(
    (parentRoomId) => !roomToParents.has(parentRoomId)
  );

  return orphanParents;
};

export const isMutedRule = (rule: IPushRule) =>
  // Check for empty actions (new spec) or dont_notify (deprecated)
  (rule.actions.length === 0 || rule.actions[0] === 'dont_notify') &&
  rule.conditions?.[0]?.kind === 'event_match';

export const findMutedRule = (overrideRules: IPushRule[], roomId: string) =>
  overrideRules.find((rule) => rule.rule_id === roomId && isMutedRule(rule));

export const getNotificationType = (mx: MatrixClient, roomId: string): NotificationType => {
  let roomPushRule: IPushRule | undefined;
  try {
    roomPushRule = mx.getRoomPushRule('global', roomId);
  } catch {
    roomPushRule = undefined;
  }

  if (!roomPushRule) {
    const overrideRules = mx.getAccountData(EventType.PushRules)?.getContent<IPushRules>()
      ?.global?.override;
    if (!overrideRules) return NotificationType.Default;

    return findMutedRule(overrideRules, roomId) ? NotificationType.Mute : NotificationType.Default;
  }

  if (roomPushRule.actions[0] === 'notify') return NotificationType.AllMessages;
  return NotificationType.MentionsAndKeywords;
};

const NOTIFICATION_EVENT_TYPES = [
  'm.room.create',
  'm.room.message',
  'm.room.encrypted',
  'm.room.member',
  'm.sticker',
];
export const isNotificationEvent = (mEvent: MatrixEvent) => {
  const eType = mEvent.getType();
  if (!NOTIFICATION_EVENT_TYPES.includes(eType)) {
    return false;
  }
  if (eType === 'm.room.member') return false;

  if (mEvent.isRedacted()) return false;
  if (mEvent.getRelation()?.rel_type === 'm.replace') return false;

  return true;
};

export const roomHaveNotification = (room: Room): boolean => {
  const total = room.getUnreadNotificationCount(NotificationCountType.Total);
  const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight);

  return total > 0 || highlight > 0;
};

const isThreadOnlyRoomActivity = (room: Room, mEvent: MatrixEvent): boolean => {
  const mEventId = mEvent.getId();
  const relationTargetId = mEvent.getRelation()?.event_id;
  const relatedEvent = relationTargetId ? room.findEventById(relationTargetId) : undefined;
  const relatedEventId = relatedEvent?.getId();
  const isThreadReplyMessage =
    !!mEventId && !!mEvent.threadRootId && mEvent.threadRootId !== mEventId;
  const isThreadReplyRelatedEvent =
    !!relatedEventId &&
    !!relatedEvent?.threadRootId &&
    relatedEvent.threadRootId !== relatedEventId;
  return isThreadReplyMessage || isThreadReplyRelatedEvent;
};

// A reference that is not a message (a canvas's shared state, poll answers) never shows, whatever it
// refers to, and neither does one still encrypted or that cannot be decrypted, so an encrypted copy
// never shows as a placeholder. A message that carries a reference shows like any other.
export const isHiddenReferenceEvent = (mEvent: MatrixEvent): boolean =>
  mEvent.getRelation()?.rel_type === RelationType.Reference &&
  (mEvent.getType() !== MessageEvent.RoomMessage || mEvent.isDecryptionFailure());

const isHiddenRoomActivity = (room: Room, mEvent: MatrixEvent): boolean =>
  isHiddenReferenceEvent(mEvent) || isThreadOnlyRoomActivity(room, mEvent);

export const roomHaveUnread = (mx: MatrixClient, room: Room) => {
  const userId = mx.getUserId();
  if (!userId) return false;
  const readUpToId = room.getEventReadUpTo(userId);
  const liveEvents = room.getLiveTimeline().getEvents();
  const latestVisibleMainEvent = [...liveEvents]
    .reverse()
    .find((event) => !isHiddenRoomActivity(room, event));

  if (latestVisibleMainEvent?.getSender() === userId) {
    return false;
  }

  // Only a message counts as unread, whether or not the read position is loaded.
  for (let i = liveEvents.length - 1; i >= 0; i -= 1) {
    const event = liveEvents[i];
    if (!event) return false;
    if (event.getId() === readUpToId) return false;
    if (isHiddenRoomActivity(room, event)) continue;
    if (isNotificationEvent(event)) return true;
  }
  return false;
};

export const getUnreadInfo = (room: Room): UnreadInfo => {
  const total = room.getUnreadNotificationCount(NotificationCountType.Total);
  const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight);
  return {
    roomId: room.roomId,
    highlight,
    total: highlight > total ? highlight : total,
  };
};

export const getUnreadInfos = (mx: MatrixClient): UnreadInfo[] => {
  const unreadInfos = mx.getRooms().reduce<UnreadInfo[]>((unread, room) => {
    if (room.isSpaceRoom()) return unread;
    if (room.getMyMembership() !== 'join') return unread;
    if (getNotificationType(mx, room.roomId) === NotificationType.Mute) return unread;

    if (roomHaveNotification(room) || roomHaveUnread(mx, room)) {
      unread.push(getUnreadInfo(room));
    }

    return unread;
  }, []);
  return unreadInfos;
};

export const getRoomIconSrc = (
  icons: Record<IconName, IconSrc>,
  roomType?: string,
  joinRule?: JoinRule
): IconSrc => {
  if (roomType === RoomType.Space) {
    if (joinRule === JoinRule.Public) return icons.SpaceGlobe;
    if (
      joinRule === JoinRule.Invite ||
      joinRule === JoinRule.Knock ||
      joinRule === JoinRule.Private
    ) {
      return icons.SpaceLock;
    }
    return icons.Space;
  }

  if (roomType === RoomType.Call) {
    if (joinRule === JoinRule.Public) return icons.VolumeHighGlobe;
    if (
      joinRule === JoinRule.Invite ||
      joinRule === JoinRule.Knock ||
      joinRule === JoinRule.Private
    ) {
      return icons.VolumeHighLock;
    }
    return icons.VolumeHigh;
  }

  if (joinRule === JoinRule.Public) return icons.HashGlobe;
  if (
    joinRule === JoinRule.Invite ||
    joinRule === JoinRule.Knock ||
    joinRule === JoinRule.Private
  ) {
    return icons.HashLock;
  }
  return icons.Hash;
};

export const getRoomAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  size: 32 | 96 = 32,
  useAuthentication = false
): string | undefined => {
  const mxcUrl = room.getMxcAvatarUrl();
  return mxcUrl
    ? mxcUrlToHttp(mx, mxcUrl, useAuthentication, size, size, 'crop') ?? undefined
    : undefined;
};

export const getDirectRoomAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  size: 32 | 96 = 32,
  useAuthentication = false
): string | undefined => {
  const mxcUrl = room.getAvatarFallbackMember()?.getMxcAvatarUrl();

  if (!mxcUrl) {
    return getRoomAvatarUrl(mx, room, size, useAuthentication);
  }

  return mxcUrlToHttp(mx, mxcUrl, useAuthentication, size, size, 'crop') ?? undefined;
};

export const trimReplyFromBody = (body: string): string => {
  // The fallback starts the body, and its sender ends at the first `> `: trying every later
  // start or split backtracked quadratically on bodies with no closing blank line.
  const match = body.match(/^> <.(?:(?!> ).)*> .+\n(?:>.*\n)*\n/);
  if (!match) return body;
  return body.slice(match[0].length);
};

export const trimReplyFromFormattedBody = (formattedBody: string): string => {
  const suffix = '</mx-reply>';
  const i = formattedBody.lastIndexOf(suffix);
  if (i < 0) {
    return formattedBody;
  }
  return formattedBody.slice(i + suffix.length);
};

export const parseReplyBody = (userId: string, body: string) =>
  `> <${userId}> ${body.replace(/\n/g, '\n> ')}\n\n`;

export const parseReplyFormattedBody = (
  roomId: string,
  userId: string,
  eventId: string,
  formattedBody: string
): string => {
  const replyToLink = `<a href="https://matrix.to/#/${encodeURIComponent(
    roomId
  )}/${encodeURIComponent(eventId)}">In reply to</a>`;
  const userLink = `<a href="https://matrix.to/#/${encodeURIComponent(userId)}">${userId}</a>`;

  return `<mx-reply><blockquote>${replyToLink}${userLink}<br />${formattedBody}</blockquote></mx-reply>`;
};

export const getMemberDisplayName = (room: Room, userId: string): string | undefined => {
  const member = room.getMember(userId);
  const name = member?.rawDisplayName;
  if (name === userId) return undefined;
  return name;
};

export const getMemberSearchStr = (
  member: RoomMember,
  query: string,
  mxIdToName: (mxId: string) => string
): string[] => [
  member.rawDisplayName === member.userId ? mxIdToName(member.userId) : member.rawDisplayName,
  query.startsWith('@') || query.indexOf(':') > -1 ? member.userId : mxIdToName(member.userId),
];

export const getMemberAvatarMxc = (room: Room, userId: string): string | undefined => {
  const member = room.getMember(userId);
  return member?.getMxcAvatarUrl();
};

export const isMembershipChanged = (mEvent: MatrixEvent): boolean =>
  mEvent.getContent().membership !== mEvent.getPrevContent().membership ||
  mEvent.getContent().reason !== mEvent.getPrevContent().reason;

export const decryptAllTimelineEvent = async (mx: MatrixClient, timeline: EventTimeline) => {
  const crypto = mx.getCrypto();
  if (!crypto) return;
  const decryptionPromises = timeline
    .getEvents()
    .filter((event) => event.isEncrypted())
    .reverse()
    .map((event) => event.attemptDecryption(crypto as CryptoBackend, { isRetry: true }));
  await Promise.allSettled(decryptionPromises);
};

export const getReactionContent = (eventId: string, key: string, shortcode?: string) => ({
  'm.relates_to': {
    event_id: eventId,
    key,
    rel_type: 'm.annotation',
  },
  shortcode,
});

export const getEventReactions = (timelineSet: EventTimelineSet, eventId: string) =>
  timelineSet.relations.getChildEventsForEvent(
    eventId,
    RelationType.Annotation,
    EventType.Reaction
  );

export const getEventEdits = (timelineSet: EventTimelineSet, eventId: string, eventType: string) =>
  timelineSet.relations.getChildEventsForEvent(eventId, RelationType.Replace, eventType);

/**
 * Deterministic event ordering (CINNY-207 D12): higher `origin_server_ts`
 * wins; same-millisecond ties are broken by lexicographically larger
 * `event_id`, matching the spec rule for `m.replace` aggregation. When both
 * timestamp and event id tie (two instances of the same logical event from
 * different sources) the incumbent wins, so callers' candidate ordering only
 * decides which *instance* of an event is kept, never which logical event.
 */
export const isEventOrderedAfter = (candidate: MatrixEvent, current: MatrixEvent): boolean => {
  if (candidate.getTs() !== current.getTs()) return candidate.getTs() > current.getTs();
  const candidateId = candidate.getId();
  const currentId = current.getId();
  if (!candidateId || !currentId) return false;
  return candidateId > currentId;
};

export const getLatestEdit = (
  targetEvent: MatrixEvent,
  editEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  const targetSender = targetEvent.getSender();

  return editEvents.reduce<MatrixEvent | undefined>((latest, editEvent) => {
    if (editEvent.isRedacted() || editEvent.getSender() !== targetSender) return latest;
    if (!latest) return editEvent;

    return isEventOrderedAfter(editEvent, latest) ? editEvent : latest;
  }, undefined);
};

const copyResolvedMessageMetadata = (
  resolvedContent: Record<string, unknown>,
  sources: Array<Record<string, unknown> | undefined>
): void => {
  sources.forEach((source) => {
    if (!source) return;

    Object.entries(source).forEach(([key, value]) => {
      if (resolvedContent[key] !== undefined) return;
      if (key === 'm.mentions') {
        resolvedContent[key] = value;
      }
    });
  });

  copyMindroomResolvedEditMetadata(resolvedContent, sources);
};

const copyEditMetadataFallbacksToLatestEdit = (
  latestEdit: MatrixEvent,
  candidateEdits: MatrixEvent[]
): void => {
  const latestContent = latestEdit.getContent() as Record<string, unknown>;
  const latestNewContent = latestContent['m.new_content'];
  if (
    !latestNewContent ||
    typeof latestNewContent !== 'object' ||
    Array.isArray(latestNewContent)
  ) {
    return;
  }

  const fallbackSources = candidateEdits
    .filter((event) => event !== latestEdit)
    .sort((a, b) => b.getTs() - a.getTs())
    .map((event) => event.getContent() as Record<string, unknown>);

  copyResolvedMessageMetadata(latestNewContent as Record<string, unknown>, [
    latestContent,
    ...fallbackSources,
  ]);
};

export const getEditedEvent = (
  mEventId: string,
  mEvent: MatrixEvent,
  timelineSet: EventTimelineSet,
  serializedReplacementCandidate = getSerializedReplacementEvent(mEvent)
): MatrixEvent | undefined => {
  const replacingEventCandidate = mEvent.replacingEvent() ?? undefined;
  // CINNY-207 AC2 render-gap RG3 (2026-07-04): observability at the
  // render-pipeline seam. See cacheProbe.ts for interpretation.
  if (replacingEventCandidate) {
    countCacheProbe('renderTargetHadReplacement');
  } else {
    countCacheProbe('renderTargetLackedReplacement');
  }
  const replacingEvent = isSameSenderEditEvent(mEvent, replacingEventCandidate)
    ? replacingEventCandidate
    : undefined;
  if (replacingEventCandidate && !replacingEvent) {
    logEditDebug('getEditedEvent:replacingEventRejected', {
      eventId: mEventId,
      replacingEventId: replacingEventCandidate.getId(),
      replacingSender: replacingEventCandidate.getSender(),
      targetSender: mEvent.getSender(),
      reason: 'sender_mismatch',
    });
  }

  const serializedReplacement = isSameSenderEditEvent(mEvent, serializedReplacementCandidate)
    ? serializedReplacementCandidate
    : undefined;
  if (serializedReplacementCandidate && !serializedReplacement) {
    logEditDebug('getEditedEvent:serializedReplacementRejected', {
      eventId: mEventId,
      replacingEventId: serializedReplacementCandidate.getId(),
      replacingSender: serializedReplacementCandidate.getSender(),
      targetSender: mEvent.getSender(),
      reason: 'sender_mismatch',
    });
  }

  const edits = getEventEdits(timelineSet, mEventId, mEvent.getType());
  const relations = edits?.getRelations() ?? [];
  // The SDK aggregates edits from every sender; only the original sender's may
  // pick the shown edit or supply its metadata fallbacks.
  const candidateEdits = [...relations, replacingEvent, serializedReplacement].filter(
    (editEvent): editEvent is MatrixEvent => isSameSenderEditEvent(mEvent, editEvent)
  );
  const latestEdit = getLatestEdit(mEvent, candidateEdits);
  logEditDebug('getEditedEvent:resolved', {
    eventId: mEventId,
    sdkReplacementId: replacingEvent?.getId(),
    sdkReplacementTs: replacingEvent?.getTs(),
    serializedReplacementId: serializedReplacement?.getId(),
    serializedReplacementTs: serializedReplacement?.getTs(),
    relationCount: relations.length,
    selectedEditId: latestEdit?.getId(),
    selectedEditTs: latestEdit?.getTs(),
    source:
      latestEdit === replacingEvent
        ? 'sdk'
        : latestEdit === serializedReplacement
        ? 'serialized'
        : latestEdit
        ? 'relations'
        : 'none',
  });
  if (latestEdit) {
    copyEditMetadataFallbacksToLatestEdit(latestEdit, candidateEdits);
  }
  return latestEdit;
};

export const getLatestMessageContent = (
  mEvent: MatrixEvent,
  editedEvent?: MatrixEvent,
  metadataFallbackEvents: MatrixEvent[] = []
): Record<string, unknown> => {
  const originalContent = mEvent.getContent() as Record<string, unknown>;
  const editedContent = editedEvent?.getContent() as Record<string, unknown> | undefined;
  const newContent = editedContent?.['m.new_content'];

  if (!newContent || typeof newContent !== 'object' || Array.isArray(newContent)) {
    return originalContent;
  }

  const resolvedContent: Record<string, unknown> = {
    ...(newContent as Record<string, unknown>),
    'm.new_content': newContent as Record<string, unknown>,
  };
  const metadataFallbackSources = metadataFallbackEvents
    .filter((event) => event !== editedEvent)
    .sort((a, b) => b.getTs() - a.getTs())
    .map((event) => event.getContent() as Record<string, unknown>);

  copyResolvedMessageMetadata(resolvedContent, [
    editedContent,
    ...metadataFallbackSources,
    originalContent,
  ]);

  return resolvedContent;
};

export const canEditEvent = (mx: MatrixClient, mEvent: MatrixEvent) => {
  const content = mEvent.getContent();
  const relationType = content['m.relates_to']?.rel_type;
  return (
    mEvent.getSender() === mx.getUserId() &&
    (!relationType || relationType === RelationType.Thread) &&
    mEvent.getType() === MessageEvent.RoomMessage &&
    (content.msgtype === MsgType.Text ||
      content.msgtype === MsgType.Emote ||
      content.msgtype === MsgType.Notice ||
      // A message too long for one event is sent as a long-text file and edited like text.
      (content.msgtype === MsgType.File && getMindroomLongTextSource(content) !== undefined))
  );
};

export const getLatestEditableEvt = (
  timeline: EventTimeline,
  canEdit: (mEvent: MatrixEvent) => boolean
): MatrixEvent | undefined => {
  const events = timeline.getEvents();

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (canEdit(evt)) return evt;
  }
  return undefined;
};

export const reactionOrEditEvent = (mEvent: MatrixEvent) =>
  mEvent.getRelation()?.rel_type === RelationType.Annotation ||
  mEvent.getRelation()?.rel_type === RelationType.Replace;

export const getMentionContent = (userIds: string[], room: boolean): IMentions => {
  const mMentions: IMentions = {};
  if (userIds.length > 0) {
    mMentions.user_ids = userIds;
  }
  if (room) {
    mMentions.room = true;
  }

  return mMentions;
};

export const getCommonRooms = (
  mx: MatrixClient,
  rooms: string[],
  otherUserId: string
): string[] => {
  const commonRooms: string[] = [];

  rooms.forEach((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.getMyMembership() !== Membership.Join) return;

    const common = room.hasMembershipState(otherUserId, Membership.Join);
    if (common) {
      commonRooms.push(roomId);
    }
  });

  return commonRooms;
};

export const bannedInRooms = (mx: MatrixClient, rooms: string[], otherUserId: string): boolean =>
  rooms.some((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.getMyMembership() !== Membership.Join) return false;

    const banned = room.hasMembershipState(otherUserId, Membership.Ban);
    return banned;
  });

export const getAllVersionsRoomCreator = (room: Room): Set<string> => {
  const creators = new Set<string>();

  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const createContent = createEvent?.getContent<IRoomCreateContent>();
  const creator = createEvent?.getSender();
  if (typeof creator === 'string') creators.add(creator);

  if (createContent && Array.isArray(createContent.additional_creators)) {
    createContent.additional_creators.forEach((c) => {
      if (typeof c === 'string') creators.add(c);
    });
  }

  return creators;
};

export const guessPerfectParent = (
  mx: MatrixClient,
  roomId: string,
  parents: string[]
): string | undefined => {
  if (parents.length === 1) {
    return parents[0];
  }

  const getSpecialUsers = (rId: string): string[] => {
    const specialUsers: Set<string> = new Set();

    const r = mx.getRoom(rId);
    if (!r) return [];

    getAllVersionsRoomCreator(r).forEach((c) => specialUsers.add(c));

    const powerLevels = getStateEvent(
      r,
      StateEvent.RoomPowerLevels
    )?.getContent<IPowerLevelsContent>();

    const { users_default: usersDefault, users } = powerLevels ?? {};
    const defaultPower = typeof usersDefault === 'number' ? usersDefault : 0;

    if (typeof users === 'object')
      Object.keys(users).forEach((userId) => {
        if (users[userId] > defaultPower) {
          specialUsers.add(userId);
        }
      });

    return Array.from(specialUsers);
  };

  let perfectParent: string | undefined;
  let score = 0;

  const roomSpecialUsers = getSpecialUsers(roomId);
  parents.forEach((parentId) => {
    const parentSpecialUsers = getSpecialUsers(parentId);
    const matchedUsersCount = parentSpecialUsers.filter((userId) =>
      roomSpecialUsers.includes(userId)
    ).length;

    if (matchedUsersCount > score) {
      score = matchedUsersCount;
      perfectParent = parentId;
    }
  });

  return perfectParent;
};
