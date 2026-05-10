import { adminService } from '../services/adminService';
import {
  getImpersonationToken,
  useImpersonationState,
  type ImpersonatedUser,
} from './impersonationState';

/**
 * Public Zustand-flavoured wrapper around `useImpersonationState`. Adds
 * the network-bound `start`/`stop` methods (which would otherwise create
 * a require cycle through adminService → apiClient → interceptors).
 *
 * Components subscribe to `useImpersonationStore(selector)` to access
 * reactive state; non-React callers (notably the axios interceptor) read
 * from `getImpersonationToken()` directly — that getter lives in
 * `impersonationState.ts` and has no transitive dep on apiClient.
 */
interface ImpersonationApi {
  token: string | null;
  user: ImpersonatedUser | null;
  expiresAt: number | null;
  start: (userId: string) => Promise<void>;
  stop: () => Promise<void>;
  isActive: () => boolean;
}

const start = async (userId: string): Promise<void> => {
  const { token, expiresInSec, user } = await adminService.startImpersonation(userId);
  useImpersonationState.getState().setSession(token, user, expiresInSec);
};

const stop = async (): Promise<void> => {
  const { user } = useImpersonationState.getState();
  useImpersonationState.getState().clear();
  if (user) {
    try {
      await adminService.stopImpersonation(user.id);
    } catch {
      // Best-effort: local state already cleared, the audit trail is
      // non-critical to UX.
    }
  }
};

const isActive = (): boolean => {
  const s = useImpersonationState.getState();
  return Boolean(s.token && s.expiresAt && s.expiresAt > Date.now());
};

/**
 * Selector-friendly hook compatible with the previous `useImpersonationStore`
 * API (`useImpersonationStore(s => s.token)`, etc.).
 *
 * IMPORTANT — each primitive is subscribed via its OWN selector so the
 * inner Zustand call returns a stable reference. The previous version
 * returned a fresh `{ token, user, expiresAt }` object on every store
 * read, which Zustand v5 rejects with an "infinite loop" warning
 * (`getSnapshot` must return cached references).
 *
 * The downstream snapshot built here is a one-shot per-render allocation
 * passed to the user's selector — it never feeds back into Zustand's
 * subscription system, so no loop.
 */
export function useImpersonationStore(): ImpersonationApi;
export function useImpersonationStore<T>(selector: (s: ImpersonationApi) => T): T;
export function useImpersonationStore<T>(
  selector?: (s: ImpersonationApi) => T,
): T | ImpersonationApi {
  const token = useImpersonationState(s => s.token);
  const user = useImpersonationState(s => s.user);
  const expiresAt = useImpersonationState(s => s.expiresAt);
  const snapshot: ImpersonationApi = { token, user, expiresAt, start, stop, isActive };
  return selector ? selector(snapshot) : snapshot;
}

export { getImpersonationToken };
