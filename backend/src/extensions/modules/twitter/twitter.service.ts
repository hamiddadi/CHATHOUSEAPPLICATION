import crypto from 'node:crypto';
import { extError } from '../../utils/ExtAppError';
import { logger } from '../../../config/logger';
import { redis } from '../../../config/redis';

/**
 * Twitter / X OAuth import (Module 1.7 / AUTH-013/014).
 *
 * Implements the OAuth 2.0 PKCE flow to fetch a user's display name,
 * username, profile picture, and bio. Feature-flagged on
 * TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET env vars.
 *
 * PKCE is driven entirely server-side so the mobile client needs no crypto
 * dependency: the server mints `state` + `code_verifier`, derives the
 * `code_challenge`, and stashes the verifier in Redis keyed by `state`
 * (10-min TTL, one-time use). The flow:
 *   1. App calls POST /ext/twitter/begin → { url, state }
 *   2. App opens `url` in the system browser; user authorizes; Twitter
 *      redirects to `chathouse://oauth/twitter?code=…&state=…`
 *   3. App captures the deep link and calls POST /ext/twitter/complete
 *      { state, code } → server looks the verifier up by `state`, exchanges
 *      the code, then GET /2/users/me → { name, username, bio, avatarUrl }
 *   4. Frontend pre-fills the profile form with the returned values.
 *
 * No DB schema change — the imported data is held in client state.
 */

const isConfigured = (): boolean =>
  Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);

/** Base64url (no padding) — the encoding PKCE + OAuth `state` require. */
const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pkceKey = (state: string): string => `ext:twitter:pkce:${state}`;
const PKCE_TTL_S = 600;

interface TwitterImportResult {
  name: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
}

export const twitterService = {
  configured: isConfigured,

  /**
   * Step 1: mint state + PKCE verifier, persist the verifier in Redis keyed
   * by state (one-time, TTL'd), and return the authorize URL + state.
   */
  async beginAuth(): Promise<{ url: string; state: string }> {
    if (!isConfigured()) {
      throw extError('TWITTER_NOT_CONFIGURED');
    }
    const state = b64url(crypto.randomBytes(16));
    const codeVerifier = b64url(crypto.randomBytes(32));
    const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    await redis.setEx(pkceKey(state), PKCE_TTL_S, codeVerifier);
    return { url: this.authorizeUrl(state, codeChallenge), state };
  },

  /**
   * Step 3: look the verifier up by state (deleting it so a code can't be
   * replayed), then exchange the code for the user's profile.
   */
  async completeAuth(state: string, code: string): Promise<TwitterImportResult> {
    const key = pkceKey(state);
    const codeVerifier = await redis.get(key);
    await redis.del(key);
    if (!codeVerifier) {
      throw extError('TWITTER_STATE_INVALID');
    }
    return this.exchange(code, codeVerifier);
  },

  authorizeUrl(state: string, codeChallenge: string): string {
    const rawClientId = process.env.TWITTER_CLIENT_ID;
    if (!isConfigured() || !rawClientId) {
      throw extError('TWITTER_NOT_CONFIGURED');
    }
    const clientId = encodeURIComponent(rawClientId);
    const redirectUri = encodeURIComponent(
      process.env.TWITTER_REDIRECT_URI ?? 'chathouse://oauth/twitter',
    );
    const scope = encodeURIComponent('users.read tweet.read');
    return (
      `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${redirectUri}&scope=${scope}&state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`
    );
  },

  async exchange(code: string, codeVerifier: string): Promise<TwitterImportResult> {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    if (!isConfigured() || !clientId || !clientSecret) {
      throw extError('TWITTER_NOT_CONFIGURED');
    }
    const redirectUri = process.env.TWITTER_REDIRECT_URI ?? 'chathouse://oauth/twitter';

    // 1. Exchange code for token (PKCE + basic auth header)
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      // Log only the status + a normalized OAuth error field — the raw body
      // can reflect the code/redirect_uri or other sensitive fragments.
      const rawBody = await tokenRes.text();
      let oauthError: string | undefined;
      try {
        oauthError = (JSON.parse(rawBody) as { error?: string }).error;
      } catch {
        oauthError = undefined;
      }
      logger.warn('ext.twitter: token exchange failed', {
        status: tokenRes.status,
        error: oauthError,
      });
      throw extError('TWITTER_OAUTH_FAILED', 'Twitter token exchange failed');
    }
    const tok = (await tokenRes.json()) as { access_token: string };

    // 2. Fetch the user profile
    const userRes = await fetch(
      'https://api.twitter.com/2/users/me?user.fields=description,profile_image_url',
      {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      },
    );
    if (!userRes.ok) {
      throw extError('TWITTER_OAUTH_FAILED', 'Twitter user fetch failed');
    }
    const body = (await userRes.json()) as {
      data: {
        name: string;
        username: string;
        description?: string;
        profile_image_url?: string;
      };
    };
    return {
      name: body.data.name,
      username: body.data.username,
      bio: body.data.description ?? null,
      // Strip "_normal" suffix to get full-resolution version.
      avatarUrl: body.data.profile_image_url
        ? body.data.profile_image_url.replace('_normal', '')
        : null,
    };
  },
};
