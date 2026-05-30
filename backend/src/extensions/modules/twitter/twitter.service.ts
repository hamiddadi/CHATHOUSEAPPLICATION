import { extError } from '../../utils/ExtAppError';
import { logger } from '../../../config/logger';

/**
 * Twitter / X OAuth import scaffold (Module 1.7 / AUTH-013/014).
 *
 * Implements the OAuth 2.0 PKCE flow to fetch a user's display name,
 * username, profile picture, and bio. Feature-flagged on
 * TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET env vars.
 *
 * The flow:
 *   1. Mobile app calls /ext/twitter/url → server returns authorize URL
 *      with state + code_challenge
 *   2. User completes OAuth in a webview → redirect with `code`
 *   3. Mobile app calls /ext/twitter/exchange?code=...&codeVerifier=...
 *      → server fetches the access_token then GET /2/users/me
 *      → returns {name, username, profile_image_url, description}
 *   4. Frontend pre-fills SetupProfile with the returned values.
 *
 * No DB schema change — the imported data is held in client state.
 */

const isConfigured = (): boolean =>
  Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);

interface TwitterImportResult {
  name: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
}

export const twitterService = {
  configured: isConfigured,

  authorizeUrl(state: string, codeChallenge: string): string {
    const rawClientId = process.env.TWITTER_CLIENT_ID;
    if (!isConfigured() || !rawClientId) {
      throw extError('PAY_NOT_CONFIGURED', 'Twitter OAuth not configured');
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
      throw extError('PAY_NOT_CONFIGURED', 'Twitter OAuth not configured');
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
      throw extError('PAY_INVALID', 'Twitter token exchange failed');
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
      throw extError('PAY_INVALID', 'Twitter user fetch failed');
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
