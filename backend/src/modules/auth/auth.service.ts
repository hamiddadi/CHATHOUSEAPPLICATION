import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, compare } from 'bcrypt';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  decodeTokenTtl,
} from '../../utils/jwt';
import { revokeAccessToken } from '../../middlewares/auth.middleware';
import { sendMail } from '../../config/mailer';
import { logger } from '../../config/logger';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schema';

const SALT_ROUNDS = 12;
const REFRESH_TTL_DAYS = 7;
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

const issueTokenPair = async (userId: string) => {
  const jti = randomUUID();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, jti);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { token: jti, userId, expiresAt },
  });

  return { accessToken, refreshToken };
};

export const authService = {
  async register(input: RegisterInput) {
    // Defensive normalization: the Zod schema already lowercases email, but
    // normalize here too so the uniqueness check and the stored value stay
    // consistent even if a future caller bypasses the schema.
    const email = input.email.toLowerCase();
    const [emailTaken, usernameTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { username: input.username } }),
    ]);
    if (emailTaken) throw new AppError('AUTH_005');
    if (usernameTaken) throw new AppError('AUTH_006');

    const passwordHash = await hash(input.password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        username: input.username,
        email,
        passwordHash,
        displayName: input.displayName ?? input.username,
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
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.identifier.toLowerCase() }, { username: input.identifier }],
      },
    });
    if (!user || !user.passwordHash) throw new AppError('AUTH_001');

    const ok = await compare(input.password, user.passwordHash);
    if (!ok) throw new AppError('AUTH_001');

    const tokens = await issueTokenPair(user.id);
    return {
      user: userToPublic(user),
      ...tokens,
    };
  },

  async refresh(refreshToken: string) {
    const claims = verifyRefreshToken(refreshToken);
    const record = await prisma.refreshToken.findUnique({ where: { token: claims.jti } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new AppError('AUTH_004');
    }

    // Rotate: revoke the old jti, issue a new one. Classic refresh-token rotation.
    await prisma.refreshToken.update({
      where: { token: claims.jti },
      data: { revokedAt: new Date() },
    });
    return issueTokenPair(claims.sub);
  },

  async logout(userId: string, accessToken: string) {
    // 1. Blacklist the still-valid access token in Redis until its natural exp
    const ttl = decodeTokenTtl(accessToken);
    await revokeAccessToken(accessToken, ttl);

    // 2. Revoke every refresh token for the user (cross-device logout)
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Issue a one-shot password reset token. We store only the SHA-256 of the
   * raw token so a DB leak doesn't hand attackers live reset links. The raw
   * token is the only thing emailed to the user. Intentionally returns
   * `{ ok: true }` even when the email doesn't exist to avoid an oracle.
   */
  async forgotPassword(input: ForgotPasswordInput) {
    // Match the normalized (lowercase) email stored at registration time.
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    // Phone-only users (no email) can't use password reset either.
    if (!user || !user.email) {
      // Same response whether or not the user exists (anti-enumeration).
      return { ok: true };
    }

    const raw = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = hashResetToken(raw);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    // Invalidate any previously-issued reset token for this user.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await prisma.passwordResetToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    });

    await sendMail({
      to: user.email,
      subject: 'Reset your Chathouse password',
      text: `Use this token within ${RESET_TOKEN_TTL_MINUTES} minutes to reset your password:\n\n${raw}`,
    });
    // Never log the raw reset token, even in dev: logs are not a safe channel
    // for a live, single-use credential. Log only a non-sensitive marker for
    // manual testing; the raw token is delivered solely via email.
    if (env.NODE_ENV === 'test') {
      logger.debug(`[reset] token issued for user ${user.id} (ttl ${RESET_TOKEN_TTL_MINUTES}m)`);
    }

    return { ok: true };
  },

  async resetPassword(input: ResetPasswordInput) {
    const tokenHash = hashResetToken(input.token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError('AUTH_003', 'Reset token invalid or expired');
    }

    const passwordHash = await hash(input.newPassword, SALT_ROUNDS);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all refresh tokens — the user must reauthenticate on every
      // device after a password reset.
      prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

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
