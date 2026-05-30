import { prisma } from '../../../config/database';

const PUBLIC_USER = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  followerCount: true,
} as const;

/**
 * Contact discovery.
 *
 * Previous design hashed phone numbers client-side with a shared salt that
 * was (a) a guessable hard-coded fallback and (b) handed to every
 * authenticated caller via `GET /salt`. With the salt known, the low-entropy
 * E.164 space (~10^10) is trivially enumerable, so the hashing protected
 * nothing — any attacker with an account could de-anonymise every user's
 * number. It also loaded up to 100k users + their PII into memory per call.
 *
 * New design: the client sends raw E.164 numbers over TLS and the server
 * matches them against the UNIQUE (indexed) `phoneNumber` column with a
 * single `IN` query. No reversible hash, no salt to leak, no full-table
 * scan. Trade-off: the server briefly sees the caller's address-book numbers
 * in transit — acceptable over TLS and standard for contact discovery, and
 * the numbers are never persisted.
 */
export const contactsService = {
  async match(userId: string, phoneNumbers: string[]): Promise<unknown[]> {
    if (phoneNumbers.length === 0) return [];

    // De-duplicate; the router already caps the array length.
    const unique = Array.from(new Set(phoneNumbers));

    const matched = await prisma.user.findMany({
      where: {
        phoneNumber: { in: unique },
        deletedAt: null,
        id: { not: userId },
      },
      select: PUBLIC_USER, // never selects phoneNumber — no PII in the response
    });

    return matched;
  },
};
