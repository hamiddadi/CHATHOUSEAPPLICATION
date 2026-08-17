import { randomUUID } from 'node:crypto';
import { prisma, runWriteWithRetry } from '../../../config/database';
import { redis } from '../../../config/redis';
import { AppError } from '../../../middlewares/error.middleware';
import { extError, type ExtAppError } from '../../utils/ExtAppError';
import { ensureUserExtensionImported } from '../../utils/legacyExtensionImport';
import { premiumService } from '../premium/premium.service';

/**
 * Custom links on a user profile. PostgreSQL is authoritative; the legacy
 * Redis JSON array is imported exactly once on first access.
 */
const FREE_MAX_LINKS = 2;
const PREMIUM_MAX_LINKS = 5;
const IMPORT_NAMESPACE = 'profile-links-v1';
const key = (userId: string) => `ext:profile:links:${userId}`;

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
  icon?: string | null;
}

const isPrivateHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (
    h === '::1' ||
    h === '::' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80')
  ) {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
};

const validateUrl = (value: string): void => {
  if (value.length > 500) throw new AppError('VALIDATION_001', 'URL too long');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError('VALIDATION_001', 'URL must be http/https');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('VALIDATION_001', 'URL must be http/https');
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new AppError('VALIDATION_001', 'URL host not allowed');
  }
};

const newId = (): string => randomUUID();

const parseLegacy = (raw: string | null): ProfileLink[] => {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        if (
          typeof row.id !== 'string' ||
          typeof row.label !== 'string' ||
          typeof row.url !== 'string'
        ) {
          return [];
        }
        return [
          {
            id: row.id.slice(0, 64),
            label: row.label.slice(0, 40),
            url: row.url.slice(0, 500),
            icon: typeof row.icon === 'string' ? row.icon.slice(0, 16) : null,
          },
        ];
      })
      .slice(0, PREMIUM_MAX_LINKS);
  } catch {
    return [];
  }
};

const ensureImported = async (userId: string): Promise<void> => {
  await ensureUserExtensionImported(
    IMPORT_NAMESPACE,
    userId,
    async () => parseLegacy(await redis.get(key(userId))),
    async (tx, links) => {
      if (links.length === 0) return;
      await tx.profileLink.createMany({
        data: links.map((link, position) => ({ ...link, userId, position })),
        skipDuplicates: true,
      });
    },
  );
};

const read = async (userId: string): Promise<ProfileLink[]> => {
  await ensureImported(userId);
  return prisma.profileLink.findMany({
    where: { userId },
    select: { id: true, label: true, url: true, icon: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
};

const capError = (premium: boolean): ExtAppError | AppError =>
  premium
    ? new AppError('VALIDATION_001', `Limit of ${PREMIUM_MAX_LINKS} links reached`)
    : extError(
        'PREMIUM_REQUIRED',
        `Free accounts can add up to ${FREE_MAX_LINKS} links - upgrade to Premium for ${PREMIUM_MAX_LINKS}.`,
      );

export const profileLinksService = {
  async list(userId: string): Promise<ProfileLink[]> {
    return read(userId);
  },

  async add(
    userId: string,
    input: { label: string; url: string; icon?: string | null },
  ): Promise<ProfileLink[]> {
    validateUrl(input.url);
    const label = input.label.trim().slice(0, 40);
    if (label.length < 1) throw new AppError('VALIDATION_001', 'Label required');
    await ensureImported(userId);
    const premium = await premiumService.isPremium(userId);
    const cap = premium ? PREMIUM_MAX_LINKS : FREE_MAX_LINKS;

    await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          const aggregate = await tx.profileLink.aggregate({
            where: { userId },
            _count: { _all: true },
            _max: { position: true },
          });
          if (aggregate._count._all >= cap) throw capError(premium);
          await tx.profileLink.create({
            data: {
              id: newId(),
              userId,
              label,
              url: input.url,
              icon: input.icon ?? null,
              position: (aggregate._max.position ?? -1) + 1,
            },
          });
        },
        { maxWait: 10_000, timeout: 15_000 },
      ),
    );
    return read(userId);
  },

  async remove(userId: string, linkId: string): Promise<ProfileLink[]> {
    await ensureImported(userId);
    await prisma.profileLink.deleteMany({ where: { id: linkId, userId } });
    return read(userId);
  },

  async update(
    userId: string,
    linkId: string,
    patch: { label?: string; url?: string; icon?: string | null },
  ): Promise<ProfileLink[]> {
    await ensureImported(userId);
    if (patch.url !== undefined) validateUrl(patch.url);
    const label = patch.label?.trim().slice(0, 40);
    await prisma.profileLink.updateMany({
      where: { id: linkId, userId },
      data: {
        ...(label ? { label } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      },
    });
    return read(userId);
  },
};
