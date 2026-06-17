import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { twitterApi, type TwitterProfile } from '../api/twitterApi';

/**
 * Drives the Twitter/X profile import OAuth dance from the client side:
 *
 *   1. `begin()` → { url, state } (PKCE verifier lives on the server)
 *   2. open `url` in the system browser
 *   3. Twitter redirects to `chathouse://oauth/twitter?code=…&state=…`,
 *      which re-foregrounds the app and fires a `Linking` 'url' event
 *   4. validate the returned `state`, then `complete(state, code)` → profile
 *
 * `start()` resolves with the imported {@link TwitterProfile} on success, or
 * `null` if the user cancelled / denied / the flow timed out. Errors that are
 * not user-cancellations reject so the caller can surface a toast.
 *
 * No-ops gracefully when the backend reports the feature unconfigured
 * (missing TWITTER_CLIENT_ID/SECRET) — `configured` stays false and the UI
 * should hide the import affordance.
 */

const REDIRECT_PREFIX = 'chathouse://oauth/twitter';
const FLOW_TIMEOUT_MS = 180_000;

/** Pull a single query param out of a deep-link URL without needing a URL polyfill. */
const getParam = (url: string, key: string): string | null => {
  const q = url.indexOf('?');
  if (q < 0) return null;
  for (const pair of url.slice(q + 1).split('&')) {
    const eq = pair.indexOf('=');
    const k = eq < 0 ? pair : pair.slice(0, eq);
    if (k === key) return decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1));
  }
  return null;
};

export const useTwitterImport = () => {
  const [configured, setConfigured] = useState(false);
  const [importing, setImporting] = useState(false);
  // Guards against overlapping flows + lets the unmount cleanup tear down a
  // dangling listener/timer if the user navigates away mid-OAuth.
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { configured: ok } = await twitterApi.status();
        if (!cancelled) setConfigured(ok);
      } catch {
        /* leave configured=false → UI hides the button */
      }
    })();
    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, []);

  const start = useCallback(async (): Promise<TwitterProfile | null> => {
    if (importing) return null;
    setImporting(true);
    try {
      const { url, state } = await twitterApi.begin();

      const code = await new Promise<string | null>((resolve, reject) => {
        let settled = false;
        let sub: { remove: () => void } | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          sub?.remove();
          if (timer) clearTimeout(timer);
          cleanupRef.current = null;
          fn();
        };

        const onUrl = ({ url: incoming }: { url: string }): void => {
          if (!incoming.startsWith(REDIRECT_PREFIX)) return;
          // Twitter echoes our `state` back; a mismatch means a stale/forged
          // redirect — treat it as a cancellation rather than completing.
          if (getParam(incoming, 'state') !== state) return finish(() => resolve(null));
          if (getParam(incoming, 'error')) return finish(() => resolve(null));
          const c = getParam(incoming, 'code');
          finish(() => resolve(c));
        };

        sub = Linking.addEventListener('url', onUrl);
        timer = setTimeout(() => finish(() => resolve(null)), FLOW_TIMEOUT_MS);
        cleanupRef.current = () => finish(() => resolve(null));

        void Linking.openURL(url).catch((e: unknown) => finish(() => reject(e)));
      });

      if (!code) return null;
      return await twitterApi.complete(state, code);
    } finally {
      setImporting(false);
    }
  }, [importing]);

  return { configured, importing, start };
};
