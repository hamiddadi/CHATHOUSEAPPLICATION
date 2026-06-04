import { useCallback, useEffect, useState } from 'react';
import { hideRoomApi } from '../api/hideRoomApi';

/**
 * Persistent hide-room state (Module 3.5 / HALL-012..015).
 *
 * The legacy Hall feed doesn't expose a hide mechanism; this hook gives
 * any consumer a synchronous `Set<roomId>` of hidden rooms plus
 * `hide(id)` / `unhide(id)` mutators with optimistic updates. Caller
 * filters their displayed list with `!hidden.has(room.id)`.
 *
 * 3-second undo window matches Clubhouse's behaviour — the call is
 * synchronously persisted, but the consumer can call `unhide(id)`
 * anytime to revert.
 */
export const useExtHideRoom = () => {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await hideRoomApi.list();
        if (!cancelled) setHidden(new Set(items));
      } catch {
        /* keep empty */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hide = useCallback(async (roomId: string): Promise<void> => {
    setHidden(prev => {
      const next = new Set(prev);
      next.add(roomId);
      return next;
    });
    try {
      await hideRoomApi.hide(roomId);
    } catch {
      // Rollback on failure
      setHidden(prev => {
        const next = new Set(prev);
        next.delete(roomId);
        return next;
      });
    }
  }, []);

  const unhide = useCallback(async (roomId: string): Promise<void> => {
    setHidden(prev => {
      const next = new Set(prev);
      next.delete(roomId);
      return next;
    });
    try {
      await hideRoomApi.unhide(roomId);
    } catch {
      setHidden(prev => {
        const next = new Set(prev);
        next.add(roomId);
        return next;
      });
    }
  }, []);

  return { hidden, ready, hide, unhide };
};
