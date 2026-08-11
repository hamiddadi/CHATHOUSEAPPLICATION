import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { purgeLivekitRevocationsForUser } from '../modules/rooms/livekit-revocation.outbox';

const DIRECT_USER_KEY_PREFIXES = [
  'ext:audio:prefs:',
  'ext:badges:',
  'ext:hiddenz:',
  'ext:nominator:count:',
  'ext:nominator:history:',
  'ext:notif:freq:',
  'ext:notif:mute:club:',
  'ext:notif:mute:user:',
  'ext:profile:links:',
  'ext:recent:',
  'ext:searchhist:',
] as const;

const CHAT_REACTION_PREFIX = 'ext:chatreact:';

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const scanKeys = async (pattern: string): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const page = await redis.scan(cursor, { MATCH: pattern, COUNT: 200 });
    cursor = page.cursor;
    keys.push(...page.keys);
  } while (cursor !== '0');
  return keys;
};

const deleteKeys = async (keys: readonly string[]): Promise<void> => {
  for (let offset = 0; offset < keys.length; offset += 500) {
    const chunk = keys.slice(offset, offset + 500);
    if (chunk.length > 0) await redis.del([...chunk]);
  }
};

const reactionKeysForMessage = async (messageId: string): Promise<string[]> =>
  scanKeys(`${CHAT_REACTION_PREFIX}${messageId}:*`);

const invitationHistoryFor = async (
  userId: string,
): Promise<
  {
    id: string;
    invitedPhone: string;
    invitedName: string;
    acceptedUserId: string | null;
    createdAt: string;
  }[]
> => {
  const rows = await redis.lRange(`ext:nominator:history:${userId}`, 0, -1);
  return rows.flatMap(raw => {
    const item = parseJson<{
      id?: unknown;
      invitedPhone?: unknown;
      invitedName?: unknown;
      acceptedUserId?: unknown;
      createdAt?: unknown;
    }>(raw);
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.invitedPhone !== 'string' ||
      typeof item.invitedName !== 'string' ||
      typeof item.createdAt !== 'string'
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        invitedPhone: item.invitedPhone,
        invitedName: item.invitedName,
        acceptedUserId: typeof item.acceptedUserId === 'string' ? item.acceptedUserId : null,
        createdAt: item.createdAt,
      },
    ];
  });
};

/**
 * Redis-backed extension data that belongs in a GDPR access/portability
 * archive. Short-lived OAuth verifier material and payment cache mappings are
 * intentionally excluded; their durable, user-facing equivalents live in
 * PostgreSQL and are already exported by usersService.
 */
export const exportExtensionData = async (userId: string) => {
  const [hostedRooms, ownedClubs] = await Promise.all([
    prisma.room.findMany({ where: { hostId: userId }, select: { id: true } }),
    prisma.club.findMany({ where: { ownerId: userId }, select: { id: true } }),
  ]);

  const [
    audioPreferences,
    manualBadges,
    hiddenRooms,
    invitationQuota,
    invitationHistory,
    notificationFrequency,
    mutedClubs,
    mutedUsers,
    profileLinks,
    recentlyPlayed,
    searchHistory,
    networkKeys,
    joinRequestKeys,
    reactionUserKeys,
    lastDeliveryKeys,
  ] = await Promise.all([
    redis.get(`ext:audio:prefs:${userId}`),
    redis.sMembers(`ext:badges:${userId}`),
    redis.zRangeWithScores(`ext:hiddenz:${userId}`, 0, -1),
    redis.get(`ext:nominator:count:${userId}`),
    invitationHistoryFor(userId),
    redis.get(`ext:notif:freq:${userId}`),
    redis.sMembers(`ext:notif:mute:club:${userId}`),
    redis.sMembers(`ext:notif:mute:user:${userId}`),
    redis.get(`ext:profile:links:${userId}`),
    redis.zRangeWithScores(`ext:recent:${userId}`, 0, -1),
    redis.lRange(`ext:searchhist:${userId}`, 0, -1),
    scanKeys(`ext:netq:*:${userId}`),
    scanKeys(`ext:clubreq:*:${userId}`),
    scanKeys(`${CHAT_REACTION_PREFIX}*:user`),
    scanKeys(`ext:notif:lastdel:*:${userId}`),
  ]);

  const [networkQuality, joinRequests, chatReactions, lastNotificationDelivery] = await Promise.all(
    [
      Promise.all(
        networkKeys.map(async key => ({
          roomId: key.slice('ext:netq:'.length, -(userId.length + 1)),
          report: parseJson<unknown>(await redis.get(key)),
        })),
      ),
      Promise.all(
        joinRequestKeys.map(async key => ({
          clubId: key.slice('ext:clubreq:'.length, -(userId.length + 1)),
          request: parseJson<unknown>(await redis.get(key)),
        })),
      ),
      Promise.all(
        reactionUserKeys.map(async key => {
          const emoji = await redis.hGet(key, userId);
          return emoji
            ? {
                messageId: key.slice(CHAT_REACTION_PREFIX.length, -':user'.length),
                emoji,
              }
            : null;
        }),
      ),
      Promise.all(
        lastDeliveryKeys.map(async key => ({
          kind: key.slice('ext:notif:lastdel:'.length, -(userId.length + 1)),
          deliveredAtEpochMs: Number(await redis.get(key)),
        })),
      ),
    ],
  );

  const [roomSettings, clubMetadata] = await Promise.all([
    Promise.all(
      hostedRooms.map(async room => ({
        roomId: room.id,
        settings: parseJson<unknown>(await redis.get(`ext:roomset:${room.id}`)),
        captionsEnabled: (await redis.get(`ext:captions:enabled:${room.id}`)) === '1',
      })),
    ),
    Promise.all(
      ownedClubs.map(async club => ({
        clubId: club.id,
        coverUrl: (await redis.hGet(`ext:clubmeta:${club.id}`, 'coverUrl')) ?? null,
        featuredMemberIds: await redis.lRange(`ext:clubmeta:featured:${club.id}`, 0, -1),
      })),
    ),
  ]);

  return {
    audioPreferences: parseJson<unknown>(audioPreferences),
    manualBadges,
    hiddenRooms: hiddenRooms.map(item => ({
      roomId: item.value,
      hiddenUntilEpochMs: item.score,
    })),
    invitations: {
      remaining: Number(invitationQuota ?? 0),
      history: invitationHistory,
    },
    notificationPreferences: {
      frequency: notificationFrequency ?? 'normal',
      mutedClubIds: mutedClubs,
      mutedUserIds: mutedUsers,
      lastDelivery: lastNotificationDelivery,
    },
    profileLinks: parseJson<unknown[]>(profileLinks) ?? [],
    recentlyPlayed: recentlyPlayed.map(item => ({
      roomId: item.value,
      playedAtEpochMs: item.score,
    })),
    searchHistory,
    networkQuality,
    clubJoinRequests: joinRequests,
    chatReactions: chatReactions.filter((item): item is NonNullable<typeof item> => item !== null),
    hostedRoomSettings: roomSettings,
    ownedClubMetadata: clubMetadata,
  };
};

const removeUserFromReactionIndexes = async (userId: string): Promise<void> => {
  const hashes = await scanKeys(`${CHAT_REACTION_PREFIX}*:user`);
  for (const hash of hashes) {
    const emoji = await redis.hGet(hash, userId);
    if (!emoji) continue;
    const messageId = hash.slice(CHAT_REACTION_PREFIX.length, -':user'.length);
    await Promise.all([
      redis.hDel(hash, userId),
      redis.sRem(`${CHAT_REACTION_PREFIX}${messageId}:by:${emoji}`, userId),
    ]);
  }
};

const anonymizeNominatorHistoryReferences = async (userId: string): Promise<void> => {
  const histories = await scanKeys('ext:nominator:history:*');
  for (const historyKey of histories) {
    const rows = await redis.lRange(historyKey, 0, -1);
    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index];
      if (raw === undefined) continue;
      const record = parseJson<Record<string, unknown>>(raw);
      if (!record || record.acceptedUserId !== userId) continue;
      record.acceptedUserId = null;
      await redis.lSet(historyKey, index, JSON.stringify(record));
    }
  }
};

/**
 * Erase or anonymize Redis extension state before the PostgreSQL user cascade.
 * The function throws on Redis/DB failure so the hard-delete worker can retry
 * instead of declaring an account purged while personal extension data remains.
 */
export const purgeExtensionDataForUser = async (userId: string): Promise<void> => {
  const [hostedRooms, ownedClubs, authoredOrHostedMessages, nominatorRows] = await Promise.all([
    prisma.room.findMany({ where: { hostId: userId }, select: { id: true } }),
    prisma.club.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.roomChatMessage.findMany({
      where: {
        OR: [{ userId }, { room: { hostId: userId } }],
      },
      select: { id: true },
    }),
    redis.lRange(`ext:nominator:history:${userId}`, 0, -1),
  ]);

  // OutboxEvent intentionally has no User FK so provider retries survive a
  // normal domain transition. Remove its embedded userId explicitly before
  // the account cascade; a failed query aborts this purge and remains retryable.
  await purgeLivekitRevocationsForUser(userId);

  const directKeys = DIRECT_USER_KEY_PREFIXES.map(prefix => `${prefix}${userId}`);
  const patternGroups = await Promise.all([
    scanKeys(`ext:notif:lastdel:*:${userId}`),
    scanKeys(`ext:netq:*:${userId}`),
    scanKeys(`ext:clubreq:*:${userId}`),
    scanKeys(`ext:speakinv:*:${userId}`),
    scanKeys(`ext:fanout:v2:claim:*:${userId}`),
    scanKeys(`ext:notif:deliveryclaim:*:${userId}:*`),
  ]);

  for (const requestKey of patternGroups[2] ?? []) {
    const clubId = requestKey.slice('ext:clubreq:'.length, -(userId.length + 1));
    await redis.sRem(`ext:clubreq:club:${clubId}`, userId);
  }

  for (const raw of nominatorRows) {
    const record = parseJson<{ invitedPhoneHmac?: unknown }>(raw);
    if (typeof record?.invitedPhoneHmac !== 'string') continue;
    const key = `ext:nominator:invited:${record.invitedPhoneHmac}`;
    if ((await redis.get(key)) === userId) await redis.del(key);
  }

  for (const { id: roomId } of hostedRooms) {
    const roomKeys = await Promise.all([
      scanKeys(`ext:netq:${roomId}:*`),
      scanKeys(`ext:speakinv:${roomId}:*`),
      scanKeys(`ext:fanout:v2:claim:${roomId}:*`),
    ]);
    await deleteKeys([
      `ext:roomset:${roomId}`,
      `ext:captions:enabled:${roomId}`,
      `ext:fanout:notified:${roomId}`,
      `ext:fanout:v2:notified:${roomId}`,
      ...roomKeys.flat(),
    ]);
  }

  for (const { id: clubId } of ownedClubs) {
    const pendingIds = await redis.sMembers(`ext:clubreq:club:${clubId}`);
    await deleteKeys([
      `ext:clubreq:club:${clubId}`,
      ...pendingIds.map(id => `ext:clubreq:${clubId}:${id}`),
      `ext:clubmeta:${clubId}`,
      `ext:clubmeta:featured:${clubId}`,
    ]);
  }

  for (const { id } of authoredOrHostedMessages) {
    await deleteKeys(await reactionKeysForMessage(id));
  }

  await removeUserFromReactionIndexes(userId);
  await anonymizeNominatorHistoryReferences(userId);

  const [muteSets, featuredLists, speakInviteKeys, twitterStateKeys, fanoutRecipientSets] =
    await Promise.all([
      scanKeys('ext:notif:mute:user:*'),
      scanKeys('ext:clubmeta:featured:*'),
      scanKeys('ext:speakinv:*'),
      scanKeys('ext:twitter:pkce:*'),
      scanKeys('ext:fanout:v2:notified:*'),
    ]);
  await Promise.all([
    ...muteSets.map(key => redis.sRem(key, userId)),
    ...featuredLists.map(key => redis.lRem(key, 0, userId)),
    ...fanoutRecipientSets.map(key => redis.sRem(key, userId)),
  ]);

  const embeddedKeysToDelete: string[] = [];
  for (const key of speakInviteKeys) {
    const payload = parseJson<{ hostId?: unknown }>(await redis.get(key));
    if (payload?.hostId === userId) embeddedKeysToDelete.push(key);
  }
  for (const key of twitterStateKeys) {
    const payload = parseJson<{ userId?: unknown }>(await redis.get(key));
    if (payload?.userId === userId) embeddedKeysToDelete.push(key);
  }

  await deleteKeys([...directKeys, ...patternGroups.flat(), ...embeddedKeysToDelete]);
};
