import { createHash, randomBytes } from 'node:crypto';
import { hash, compare } from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import { verifyRefreshToken, decodeTokenTtl } from '../../utils/jwt';
import { revokeAccessToken, invalidateUserAuthCache } from '../../middlewares/auth.middleware';
import { issueTokenPair } from '../../utils/issueTokenPair';
import { disconnectUserSockets } from '../../socket/realtime';
import { sendMail } from '../../config/mailer';
import { logger } from '../../config/logger';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import { resolveAccountSessionScope } from './account-lifecycle';
import {
  currentLegalDocumentVersion,
  legalAcceptanceSelect,
  legalAcceptanceStatus,
  resolveLegalAcceptance,
} from './legal-acceptance';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schema';

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_TOKEN_BYTES = 32;

const hashResetToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

const userToPublic = (u: {
  id: string;
  username: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  termsAcceptedVersion: string | null;
  termsAcceptedAt: Date | null;
  privacyNoticeAcknowledgedVersion: string | null;
  privacyNoticeAcknowledgedAt: Date | null;
  legalAcceptanceLocale: string | null;
  deletedAt?: Date | null;
}) => ({
  id: u.id,
  username: u.username ?? '',
  email: u.email ?? '',
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
  bio: u.bio,
  termsAcceptedVersion: u.termsAcceptedVersion,
  termsAcceptedAt: u.termsAcceptedAt?.toISOString() ?? null,
  privacyNoticeAcknowledgedVersion: u.privacyNoticeAcknowledgedVersion,
  privacyNoticeAcknowledgedAt: u.privacyNoticeAcknowledgedAt?.toISOString() ?? null,
  legalAcceptanceLocale: u.legalAcceptanceLocale,
  accountState: u.deletedAt ? ('PENDING_DELETION' as const) : ('ACTIVE' as const),
  deletedAt: u.deletedAt?.toISOString() ?? null,
  permanentDeletionAt: u.deletedAt
    ? new Date(
        u.deletedAt.getTime() + env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null,
  ...legalAcceptanceStatus(u),
});

export const authService = {
  async register(input: RegisterInput) {
    if (env.NODE_ENV !== 'test' && input.ageConfirmed !== true) {
      throw new AppError('AGE_001');
    }
    const legalAcceptance = resolveLegalAcceptance(input);
    // Defensive normalization: the Zod schema already lowercases email, but
    // normalize here too so the uniqueness check and the stored value stay
    // consistent even if a future caller bypasses the schema. Username is
    // case-insensitive (AUTH-05): lowercase it the same way so 'JohnDoe' and
    // 'johndoe' can't both exist and username login stays deterministic.
    const email = input.email.toLowerCase();
    const username = input.username.toLowerCase();
    const [emailTaken, usernameTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { username } }),
    ]);
    if (emailTaken) throw new AppError('AUTH_005');
    if (usernameTaken) throw new AppError('AUTH_006');

    const passwordHash = await hash(input.password, SALT_ROUNDS);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          displayName: input.displayName ?? input.username,
          ...(input.ageConfirmed ? { ageConfirmedAt: new Date() } : {}),
          ...legalAcceptance,
        },
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          ...legalAcceptanceSelect,
        },
      });
    } catch (error) {
      // The availability reads above provide the friendly fast path, but two
      // registrations can pass them concurrently. The database unique indexes
      // are authoritative; translate their race winner into the same stable
      // API errors instead of leaking a Prisma P2002 as SERVER_001.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.['target'])
          ? error.meta['target'].join(',')
          : String(error.meta?.['target'] ?? '');
        if (/email/i.test(target)) throw new AppError('AUTH_005');
        if (/username/i.test(target)) throw new AppError('AUTH_006');

        // Some Prisma/driver combinations omit the conflicting columns from
        // P2002 metadata. Resolve that case from the now-committed winner so a
        // known registration collision still cannot escape as a 500.
        const [emailWinner, usernameWinner] = await Promise.all([
          prisma.user.findUnique({ where: { email }, select: { id: true } }),
          prisma.user.findUnique({ where: { username }, select: { id: true } }),
        ]);
        if (emailWinner) throw new AppError('AUTH_005');
        if (usernameWinner) throw new AppError('AUTH_006');
      }
      throw error;
    }

    const tokens = await issueTokenPair(user.id);
    return { user: userToPublic(user), ...tokens };
  },

  async login(input: LoginInput) {
    // Both email and username are stored lowercase (AUTH-05), so lowercase the
    // identifier on both branches to keep login deterministic regardless of the
    // case the user typed.
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: input.identifier.toLowerCase() },
          { username: input.identifier.toLowerCase() },
        ],
      },
    });
    if (!user || !user.passwordHash) throw new AppError('AUTH_001');

    const ok = await compare(input.password, user.passwordHash);
    if (!ok) throw new AppError('AUTH_001');

    const scope = resolveAccountSessionScope(user);
    const tokens = await issueTokenPair(user.id, { scope });
    return {
      user: userToPublic(user),
      ...tokens,
    };
  },

  async refresh(refreshToken: string) {
    const claims = verifyRefreshToken(refreshToken);

    // Reject expired tokens up front (the conditional revoke below can't see
    // expiry). A non-existent jti also lands here as AUTH_004.
    const record = await prisma.refreshToken.findUnique({ where: { token: claims.jti } });
    if (!record || record.expiresAt < new Date()) {
      throw new AppError('AUTH_004');
    }

    // AUTH-02: replay of an already-rotated jti is a token-theft signal —
    // revoke the whole family for that user so neither side keeps a live pair.
    if (record.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppError('AUTH_004');
    }

    // Recovery refresh tokens remain recovery-scoped. A signed scope can never
    // be upgraded through refresh; only explicit cancel-deletion rotates the
    // account to a fresh active token family.
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { suspendedUntil: true, deletedAt: true },
    });
    if (!user) throw new AppError('AUTH_003');
    const authoritativeScope = resolveAccountSessionScope({ id: record.userId, ...user });
    const requestedScope = claims.scope ?? 'active';
    if (authoritativeScope !== requestedScope) throw new AppError('AUTH_003');

    // AUTH-02: atomic conditional rotation. Two concurrent refreshes with the
    // same jti both reach here, but only one wins the conditional update
    // (revokedAt: null guard) — the loser sees count===0 and is rejected, so a
    // single jti never yields two live token families.
    const rotated = await prisma.refreshToken.updateMany({
      where: { token: claims.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) throw new AppError('AUTH_004');

    return issueTokenPair(record.userId, { scope: requestedScope });
  },

  async logout(userId: string, accessToken: string) {
    const ttl = decodeTokenTtl(accessToken);

    // Revoke every refresh token (cross-device logout) AND bump tokenVersion
    //    so every OTHER device's still-valid access token is rejected at once
    //    (AUTH-03) — not just the caller's blacklisted one. Drop the auth cache
    //    so the next request re-reads the bumped version immediately.
    const revokedAt = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      }),
    ]);
    // Commit the durable fallback first. If Redis is unavailable, protected
    // requests fail closed while it is down and tokenVersion remains the source
    // of truth after recovery. Disconnect sockets before cache I/O so a failed
    // Redis write cannot leave an already-revoked realtime session connected.
    disconnectUserSockets(userId, 'logout');
    await Promise.all([revokeAccessToken(accessToken, ttl), invalidateUserAuthCache(userId)]);
  },

  /**
   * Issue a one-shot password reset token. We store only the SHA-256 of the
   * raw token so a DB leak doesn't hand attackers live reset links. The raw
   * token is the only thing emailed to the user. The entire lookup/delivery
   * flow runs as a tracked background task in production so response status
   * and provider latency cannot reveal whether the email exists.
   */
  async forgotPassword(input: ForgotPasswordInput) {
    const normalizedEmail = input.email.toLowerCase();
    await scheduleBackgroundTask(
      (async () => {
        const raw = randomBytes(RESET_TOKEN_BYTES).toString('hex');
        const tokenHash = hashResetToken(raw);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
        const issuedAt = new Date();
        const recipient = await prisma.$transaction(async tx => {
          // Serialize token issuance with account deletion/suspension. The
          // generic HTTP response remains identical, but an inactive account
          // must neither gain a fresh credential nor trigger outbound email.
          await tx.$queryRaw`SELECT id FROM "User" WHERE email = ${normalizedEmail} FOR NO KEY UPDATE`;
          const user = await tx.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, email: true, deletedAt: true, suspendedUntil: true },
          });
          if (
            !user?.email ||
            user.deletedAt ||
            (user.suspendedUntil && user.suspendedUntil > issuedAt)
          ) {
            return null;
          }

          // Invalidate every previous token and persist the replacement while
          // the account-state lock is still held.
          await tx.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: issuedAt },
          });
          await tx.passwordResetToken.create({
            data: { tokenHash, userId: user.id, expiresAt },
          });
          return { id: user.id, email: user.email };
        });
        if (!recipient) return;

        await sendMail({
          to: recipient.email,
          subject: 'Reset your ChatHouse password',
          text: `Use this token within ${RESET_TOKEN_TTL_MINUTES} minutes to reset your password:\n\n${raw}`,
        });
        // Never log the raw reset token, even in dev/test.
        if (env.NODE_ENV === 'test') {
          logger.debug(
            `[reset] token issued for user ${recipient.id} (ttl ${RESET_TOKEN_TTL_MINUTES}m)`,
          );
        }
      })(),
      err =>
        logger.error('password reset delivery task failed', {
          err: err instanceof Error ? err.message : String(err),
        }),
    );

    return { ok: true };
  },

  async resetPassword(input: ResetPasswordInput) {
    const tokenHash = hashResetToken(input.token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError('AUTH_003', 'Reset token invalid or expired');
    }

    const passwordHash = await hash(input.newPassword, SALT_ROUNDS);
    const now = new Date();
    await prisma.$transaction(async tx => {
      // Lock the account before the reset-token row. This matches the
      // moderation/GDPR lock order and makes a concurrent suspension either
      // happen wholly before (reject) or wholly after this reset. A valid
      // email token must not mutate a moderation-locked account.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${record.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: record.userId },
        select: { deletedAt: true, suspendedUntil: true },
      });
      if (!user) throw new AppError('AUTH_003');
      if (user.suspendedUntil && user.suspendedUntil > now) {
        throw new AppError('AUTH_007');
      }
      if (user.deletedAt) {
        throw new AppError('AUTH_003', 'Reset token invalid or expired');
      }

      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new AppError('AUTH_003', 'Reset token invalid or expired');
      }
      // AUTH-03: bump tokenVersion in the same write so every access token
      // issued before the reset is rejected cross-device (a reset usually means
      // the account was compromised), not just the refresh tokens.
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      // Revoke all refresh tokens — the user must reauthenticate on every
      // device after a password reset.
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    await invalidateUserAuthCache(record.userId);
    disconnectUserSockets(record.userId, 'password_reset');

    return { ok: true };
  },

  /**
   * Dev-only shortcut: skip OTP + phone verification and log in as a
   * seeded test user. Refuses to run when NODE_ENV === 'production' so
   * this can never be used as an attack vector on a live deployment.
   * The test user is upsertable — first call creates it, subsequent
   * calls reuse the same row, so state persists across app reloads.
   */
  async devLogin() {
    if (env.NODE_ENV === 'production') {
      // Use AUTH_003 (Unauthorized) rather than NOT_FOUND so an attacker
      // probing prod doesn't get a 404 hint that the endpoint exists.
      throw new AppError('AUTH_003', 'dev-login disabled in production');
    }

    const username = 'devuser';
    const email = 'dev@chathouse.local';
    const displayName = 'Dev User';
    const devLegalAcceptance = resolveLegalAcceptance({
      termsAccepted: true,
      privacyNoticeAcknowledged: true,
      legalDocumentVersion: currentLegalDocumentVersion(),
      legalLocale: 'en',
    });

    // Upsert so repeat calls are idempotent. Force
    // `hasCompletedOnboarding: true` so the RootNavigator skips the
    // onboarding flow and lands directly on Main — the whole point of
    // this bypass. Select the flag back so the frontend mapper sees it.
    const user = await prisma.user.upsert({
      where: { username },
      create: {
        username,
        email,
        displayName,
        hasCompletedOnboarding: true,
        ...devLegalAcceptance,
      },
      update: {
        displayName,
        hasCompletedOnboarding: true,
        ...devLegalAcceptance,
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        hasCompletedOnboarding: true,
        ...legalAcceptanceSelect,
      },
    });

    const tokens = await issueTokenPair(user.id);
    return {
      user: { ...userToPublic(user), hasCompletedOnboarding: user.hasCompletedOnboarding },
      ...tokens,
      isNewUser: false,
    };
  },
};
