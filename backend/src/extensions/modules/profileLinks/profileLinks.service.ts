import { redis } from '../../../config/redis';
import { AppError } from '../../../middlewares/error.middleware';
import { readJson, writeJson } from '../../utils/redisJson';
import { extError } from '../../utils/ExtAppError';
import { premiumService } from '../premium/premium.service';

/**
 * Custom links on a user profile (Module 2.2 / PROFIL-008).
 *
 * The legacy `User` model only has `twitter` and `instagram` columns. This
 * extension stores up to 5 additional named links per user (blog, podcast,
 * Substack, etc.) in Redis without schema migration.
 *
 * Layout : `ext:profile:links:<userId>` = JSON array
 */

// Premium gating: free accounts get a small allowance; premium unlocks the
// full set. The cap is enforced server-side (the client only hints the upsell).
const FREE_MAX_LINKS = 2;
const PREMIUM_MAX_LINKS = 5;
const TTL_S = 365 * 24 * 3600;
const key = (userId: string) => `ext:profile:links:${userId}`;

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
  icon?: string | null;
}

// Reject hosts that resolve to internal infrastructure. A profile link is
// only rendered client-side today, but a future server-side preview/fetch
// would otherwise be an SSRF sink (e.g. http://169.254.169.254/...). Cheap
// to gate now while we own the validation. NB: this is a literal-host guard,
// not a DNS-resolution guard — a hostname that resolves to a private IP can
// still slip through; tighten with a resolver check if a server fetch lands.
const isPrivateHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  // IPv6 loopback / unspecified / unique-local / link-local
  if (
    h === '::1' ||
    h === '::' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80')
  ) {
    return true;
  }
  // IPv4 loopback / private (RFC1918) / link-local / unspecified
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

const validateUrl = (s: string): void => {
  if (s.length > 500) {
    throw new AppError('VALIDATION_001', 'URL too long');
  }
  // Single source of truth: parse with the WHATWG URL parser instead of the
  // loose regex (the router's Zod .url() is the first gate; this is defence
  // in depth + the private-host check).
  let parsed: URL;
  try {
    parsed = new URL(s);
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

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const read = async (userId: string): Promise<ProfileLink[]> => {
  const arr = await readJson<ProfileLink[]>(key(userId));
  return Array.isArray(arr) ? arr : [];
};

const write = async (userId: string, links: ProfileLink[]): Promise<void> => {
  if (links.length === 0) {
    await redis.del(key(userId));
  } else {
    await writeJson(key(userId), links, TTL_S);
  }
};

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
    const current = await read(userId);
    const premium = await premiumService.isPremium(userId);
    const cap = premium ? PREMIUM_MAX_LINKS : FREE_MAX_LINKS;
    if (current.length >= cap) {
      // Free user hitting the free cap → PREMIUM_REQUIRED so the client can show
      // the upsell; a premium user at the hard cap gets a plain validation error.
      if (!premium) {
        throw extError(
          'PREMIUM_REQUIRED',
          `Free accounts can add up to ${FREE_MAX_LINKS} links — upgrade to Premium for ${PREMIUM_MAX_LINKS}.`,
        );
      }
      throw new AppError('VALIDATION_001', `Limit of ${PREMIUM_MAX_LINKS} links reached`);
    }
    const next: ProfileLink[] = [
      ...current,
      { id: newId(), label, url: input.url, icon: input.icon ?? null },
    ];
    await write(userId, next);
    return next;
  },

  async remove(userId: string, linkId: string): Promise<ProfileLink[]> {
    const current = await read(userId);
    const next = current.filter(l => l.id !== linkId);
    await write(userId, next);
    return next;
  },

  async update(
    userId: string,
    linkId: string,
    patch: { label?: string; url?: string; icon?: string | null },
  ): Promise<ProfileLink[]> {
    const current = await read(userId);
    const next = current.map(l => {
      if (l.id !== linkId) return l;
      const updated = { ...l };
      if (patch.label !== undefined) {
        const trimmed = patch.label.trim().slice(0, 40);
        if (trimmed.length > 0) updated.label = trimmed;
      }
      if (patch.url !== undefined) {
        validateUrl(patch.url);
        updated.url = patch.url;
      }
      if (patch.icon !== undefined) updated.icon = patch.icon;
      return updated;
    });
    await write(userId, next);
    return next;
  },
};
