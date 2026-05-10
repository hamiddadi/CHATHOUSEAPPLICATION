import { env } from '../../../config/env';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'alive';
  timestamp: string;
  services?: { database: boolean; redis: boolean };
}

/**
 * Dev-only connectivity probe. Strips the `/api` suffix from `API_BASE_URL`
 * since `/health` is mounted at the root. Short 5s timeout so we fail fast
 * when the backend isn't running instead of hanging at boot.
 *
 * Emulator notes:
 *  - iOS simulator → `localhost:4000` works as-is
 *  - Android emulator → set `API_BASE_URL` to `http://10.0.2.2:4000/api` in app.json
 *  - Physical device → use the LAN IP of your dev machine
 */
export const probeBackendHealth = async (): Promise<void> => {
  const base = env.API_BASE_URL.replace(/\/api\/?$/, '');
  const url = `${base}/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = (await res.json()) as HealthResponse;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.info(`[health-probe] ${url} → ${res.status} ${body.status}`, body.services ?? {});
    }
  } catch (err) {
    if (__DEV__) {
      // Demoted from `console.warn` to `console.info` — the dev backend
      // being offline is the normal case when developers boot the app
      // standalone (Expo Go, simulator without API running). The yellow
      // box noise drowned out actual issues.
      // eslint-disable-next-line no-console
      console.info(
        `[health-probe] ${url} unreachable (dev backend likely offline):`,
        err instanceof Error ? err.message : err,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }
};
