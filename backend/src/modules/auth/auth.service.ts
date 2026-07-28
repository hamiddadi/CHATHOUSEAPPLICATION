import { createHash, randomBytes } from 'node:crypto';
import { hash, compare } from 'bcrypt';
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
import { ensureLoginAllowedAndRestore } from './account-lifecycle';
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
}) => ({
  id: u.id,
  username: u.username ?? '',
  email: u.email ?? '',
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
  bio: u.bio,
});

export const authService = {
  async register(input: RegisterInput) {
    if (env.NODE_ENV !== 'test' && input.ageConfirmed !== true) {
      throw new AppError('AGE_001');
    }
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
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        displayName: input.displayName ?? input.username,
        ...(input.ageConfirmed ? { ageConfirmedAt: new Date() } : {}),
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
      },
    });

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

    await ensureLoginAllowedAndRestore(user);
    const tokens = await issueTokenPair(user.id);
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

    // AUTH-01: a suspended or soft-deleted (or vanished) account must not be
    // able to extend its session via refresh, even though its JWT still
    // verifies. Mirror requireAuth's verdicts (AUTH_007 suspended, AUTH_003
    // absent/deleted).
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { suspendedUntil: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new AppError('AUTH_003');
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      throw new AppError('AUTH_007');
    }

    // AUTH-02: atomic conditional rotation. Two concurrent refreshes with the
    // same jti both reach here, but only one wins the conditional update
    // (revokedAt: null guard) — the loser sees count===0 and is rejected, so a
    // single jti never yields two live token families.
    const rotated = await prisma.refreshToken.updateMany({
      where: { token: claims.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) throw new AppError('AUTH_004');

    return issueTokenPair(record.userId);
  },

  async logout(userId: string, accessToken: string) {
    // 1. Blacklist the caller's still-valid access token in Redis until exp.
    const ttl = decodeTokenTtl(accessToken);
    await revokeAccessToken(accessToken, ttl);

    // 2. Revoke every refresh token (cross-device logout) AND bump tokenVersion
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
    await invalidateUserAuthCache(userId);
    disconnectUserSockets(userId, 'logout');
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
        // Match the normalized (lowercase) email stored at registration time.
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        // Phone-only users (no email) cannot use password reset either. Perform
        // the same token/hash work without persisting it as defense in depth;
        // the HTTP response itself is already detached from this task in prod.
        if (!user || !user.email) {
          hashResetToken(randomBytes(RESET_TOKEN_BYTES).toString('hex'));
          return;
        }

        const raw = randomBytes(RESET_TOKEN_BYTES).toString('hex');
        const tokenHash = hashResetToken(raw);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

        // Invalidate every previous token and persist the replacement atomically.
        const issuedAt = new Date();
        await prisma.$transaction([
          prisma.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: issuedAt },
          }),
          prisma.passwordResetToken.create({
            data: { tokenHash, userId: user.id, expiresAt },
          }),
        ]);

        await sendMail({
          to: user.email,
          subject: 'Reset your Chathouse password',
          text: `Use this token within ${RESET_TOKEN_TTL_MINUTES} minutes to reset your password:\n\n${raw}`,
        });
        // Never log the raw reset token, even in dev/test.
        if (env.NODE_ENV === 'test') {
          logger.debug(
            `[reset] token issued for user ${user.id} (ttl ${RESET_TOKEN_TTL_MINUTES}m)`,
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
      },
      update: { displayName, hasCompletedOnboarding: true },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        hasCompletedOnboarding: true,
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
