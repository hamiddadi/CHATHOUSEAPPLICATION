import type { NotificationFrequencyTier } from '@prisma/client';
import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { ensureUserExtensionImported } from '../../utils/legacyExtensionImport';

/** Durable notification preferences; Redis is retained only for throttling. */
export type FrequencyTier = 'infrequent' | 'normal' | 'frequent';

const IMPORT_NAMESPACE = 'notification-extension-preferences-v1';
const freqKey = (userId: string) => `ext:notif:freq:${userId}`;
const clubMuteKey = (userId: string) => `ext:notif:mute:club:${userId}`;
const userMuteKey = (userId: string) => `ext:notif:mute:user:${userId}`;
const lastDeliveredKey = (userId: string, kind: string) => `ext:notif:lastdel:${kind}:${userId}`;
const durableDeliveryClaimKey = (userId: string, kind: string, deliveryId: string) =>
  `ext:notif:deliveryclaim:${kind}:${userId}:${deliveryId}`;

const FREQ_THROTTLE_MS: Record<FrequencyTier, number> = {
  frequent: 0,
  normal: 60 * 60 * 1000,
  infrequent: 24 * 60 * 60 * 1000,
};

const CAN_DELIVER_SCRIPT = `
local throttleMs = tonumber(ARGV[1])
if throttleMs <= 0 then return 1 end
local nowParts = redis.call('TIME')
local nowMs = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
local lastMs = tonumber(redis.call('GET', KEYS[1]))
if lastMs and (nowMs - lastMs) < throttleMs then
  local remainingMs = throttleMs - (nowMs - lastMs)
  if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], remainingMs) end
  return 0
end
redis.call('SET', KEYS[1], tostring(nowMs), 'PX', throttleMs)
return 1
`;

const CAN_DELIVER_DURABLY_SCRIPT = `
local throttleMs = tonumber(ARGV[1])
if redis.call('EXISTS', KEYS[2]) == 1 then return 1 end
if throttleMs <= 0 then return 1 end
local nowParts = redis.call('TIME')
local nowMs = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
local lastMs = tonumber(redis.call('GET', KEYS[1]))
if lastMs and (nowMs - lastMs) < throttleMs then
  local remainingMs = throttleMs - (nowMs - lastMs)
  if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], remainingMs) end
  return 0
end
redis.call('SET', KEYS[1], tostring(nowMs), 'PX', throttleMs)
redis.call('SET', KEYS[2], '1', 'PX', throttleMs)
return 1
`;

const normalizeFrequency = (value: string | null): FrequencyTier =>
  value === 'infrequent' || value === 'frequent' ? value : 'normal';
const toDbFrequency = (tier: FrequencyTier): NotificationFrequencyTier =>
  tier.toUpperCase() as NotificationFrequencyTier;

interface LegacyPreferences {
  frequency: FrequencyTier;
  clubIds: string[];
  userIds: string[];
}

const ensureImported = async (userId: string): Promise<void> => {
  await ensureUserExtensionImported(
    IMPORT_NAMESPACE,
    userId,
    async () => {
      const [frequency, clubIds, userIds] = await Promise.all([
        redis.get(freqKey(userId)),
        redis.sMembers(clubMuteKey(userId)),
        redis.sMembers(userMuteKey(userId)),
      ]);
      return { frequency: normalizeFrequency(frequency), clubIds, userIds };
    },
    async (tx, legacy: LegacyPreferences) => {
      await tx.userNotificationExtensionPreference.createMany({
        data: [{ userId, frequency: toDbFrequency(legacy.frequency) }],
        skipDuplicates: true,
      });
      if (legacy.clubIds.length > 0) {
        const clubs = await tx.club.findMany({
          where: { id: { in: legacy.clubIds } },
          select: { id: true },
        });
        await tx.notificationClubMute.createMany({
          data: clubs.map(club => ({ userId, clubId: club.id })),
          skipDuplicates: true,
        });
      }
      if (legacy.userIds.length > 0) {
        const users = await tx.user.findMany({
          where: { id: { in: legacy.userIds, not: userId } },
          select: { id: true },
        });
        await tx.notificationUserMute.createMany({
          data: users.map(user => ({ userId, mutedUserId: user.id })),
          skipDuplicates: true,
        });
      }
    },
  );
};

const muted = async (
  userId: string,
  opts: { clubId?: string | null; actorId?: string | null },
): Promise<boolean> => {
  const checks: Promise<unknown>[] = [];
  if (opts.actorId) {
    checks.push(
      prisma.notificationUserMute.findUnique({
        where: { userId_mutedUserId: { userId, mutedUserId: opts.actorId } },
        select: { userId: true },
      }),
    );
  }
  if (opts.clubId) {
    checks.push(
      prisma.notificationClubMute.findUnique({
        where: { userId_clubId: { userId, clubId: opts.clubId } },
        select: { userId: true },
      }),
    );
  }
  return (await Promise.all(checks)).some(Boolean);
};

export const notifPrefsExtService = {
  async getFrequency(userId: string): Promise<FrequencyTier> {
    await ensureImported(userId);
    const row = await prisma.userNotificationExtensionPreference.findUnique({
      where: { userId },
      select: { frequency: true },
    });
    return row ? (row.frequency.toLowerCase() as FrequencyTier) : 'normal';
  },

  async setFrequency(userId: string, tier: FrequencyTier): Promise<void> {
    await ensureImported(userId);
    await prisma.userNotificationExtensionPreference.upsert({
      where: { userId },
      create: { userId, frequency: toDbFrequency(tier) },
      update: { frequency: toDbFrequency(tier) },
    });
  },

  async listMutedClubs(userId: string): Promise<string[]> {
    await ensureImported(userId);
    const rows = await prisma.notificationClubMute.findMany({
      where: { userId },
      select: { clubId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(row => row.clubId);
  },

  async muteClub(userId: string, clubId: string): Promise<void> {
    await ensureImported(userId);
    await prisma.notificationClubMute.upsert({
      where: { userId_clubId: { userId, clubId } },
      create: { userId, clubId },
      update: {},
    });
  },

  async unmuteClub(userId: string, clubId: string): Promise<void> {
    await ensureImported(userId);
    await prisma.notificationClubMute.deleteMany({ where: { userId, clubId } });
  },

  async listMutedUsers(userId: string): Promise<string[]> {
    await ensureImported(userId);
    const rows = await prisma.notificationUserMute.findMany({
      where: { userId },
      select: { mutedUserId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(row => row.mutedUserId);
  },

  async muteUser(userId: string, targetId: string): Promise<void> {
    await ensureImported(userId);
    if (userId === targetId) return;
    await prisma.notificationUserMute.upsert({
      where: { userId_mutedUserId: { userId, mutedUserId: targetId } },
      create: { userId, mutedUserId: targetId },
      update: {},
    });
  },

  async unmuteUser(userId: string, targetId: string): Promise<void> {
    await ensureImported(userId);
    await prisma.notificationUserMute.deleteMany({
      where: { userId, mutedUserId: targetId },
    });
  },

  async canDeliver(
    userId: string,
    kind: string,
    opts: { clubId?: string | null; actorId?: string | null } = {},
  ): Promise<boolean> {
    await ensureImported(userId);
    if (await muted(userId, opts)) return false;
    const tier = await this.getFrequency(userId);
    const result = await redis.eval(CAN_DELIVER_SCRIPT, {
      keys: [lastDeliveredKey(userId, kind)],
      arguments: [String(FREQ_THROTTLE_MS[tier])],
    });
    return Number(result) === 1;
  },

  async canDeliverDurably(
    userId: string,
    kind: string,
    opts: { deliveryId: string; clubId?: string | null; actorId?: string | null },
  ): Promise<boolean> {
    await ensureImported(userId);
    if (await muted(userId, opts)) return false;
    const tier = await this.getFrequency(userId);
    const result = await redis.eval(CAN_DELIVER_DURABLY_SCRIPT, {
      keys: [
        lastDeliveredKey(userId, kind),
        durableDeliveryClaimKey(userId, kind, opts.deliveryId),
      ],
      arguments: [String(FREQ_THROTTLE_MS[tier])],
    });
    return Number(result) === 1;
  },
};
