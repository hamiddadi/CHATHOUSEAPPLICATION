import { useCallback, useState } from 'react';
import { clubReqApi, type ClubJoinRequest } from '../api/clubReqApi';

/**
 * Approval-aware "join a house/club" flow (Module 10.3 / CLUB-006..009).
 *
 * Routes through the additive `/api/ext/clubreq/:clubId/request` endpoint
 * instead of the legacy `POST /clubs/:id/join` so the join honours club
 * privacy without touching core `clubsService`:
 *
 *   - OPEN   → backend adds the caller directly  → status 'joined'
 *   - SOCIAL → backend queues an approval request → status 'pending'
 *   - PRIVATE→ backend rejects (invitation-only)  → throws (CLUB_003)
 *
 * The hook tracks `pending` so a screen can flip its CTA to
 * "Demande envoyée" and disable the button. It is intentionally
 * react-query-agnostic (matches the other ext hooks) — pass `onJoined`
 * to trigger whatever cache refetch the host screen uses once the caller
 * actually becomes a member.
 */
export type ExtJoinPhase = 'idle' | 'submitting' | 'joined' | 'pending' | 'error';

export interface UseExtJoinHouseOpts {
  /** Fired once the caller is a confirmed member (OPEN clubs only). */
  onJoined?: (clubId: string) => void;
  /** Fired once a pending approval request is queued (SOCIAL clubs). */
  onPending?: (clubId: string) => void;
}

export interface UseExtJoinHouseResult {
  phase: ExtJoinPhase;
  /** True while the request is in flight. */
  isSubmitting: boolean;
  /** True once a SOCIAL approval request has been queued. */
  isPending: boolean;
  /** True once an OPEN club join succeeded. */
  isJoined: boolean;
  error: Error | null;
  /** Submit the join/request. Resolves with the backend status, or null on error. */
  join: (clubId: string, message?: string) => Promise<ClubJoinRequest['status'] | null>;
  /** Reset back to idle (e.g. when navigating to a different house). */
  reset: () => void;
}

export const useExtJoinHouse = (opts: UseExtJoinHouseOpts = {}): UseExtJoinHouseResult => {
  const { onJoined, onPending } = opts;
  const [phase, setPhase] = useState<ExtJoinPhase>('idle');
  const [error, setError] = useState<Error | null>(null);

  const join = useCallback(
    async (clubId: string, message?: string): Promise<ClubJoinRequest['status'] | null> => {
      setError(null);
      setPhase('submitting');
      try {
        const res = await clubReqApi.request(clubId, message);
        // Default to 'joined' for resilience: a missing discriminator means
        // an OPEN club on an older backend that added the member directly.
        const status = res.status ?? 'joined';
        if (status === 'pending') {
          setPhase('pending');
          onPending?.(clubId);
        } else {
          setPhase('joined');
          onJoined?.(clubId);
        }
        return status;
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err : new Error('JOIN_FAILED'));
        return null;
      }
    },
    [onJoined, onPending],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
  }, []);

  return {
    phase,
    isSubmitting: phase === 'submitting',
    isPending: phase === 'pending',
    isJoined: phase === 'joined',
    error,
    join,
    reset,
  };
};
