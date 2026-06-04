import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '../../../shared/services/realtime/socketClient';

// The backend relays `chat:typing` as a fire-and-forget event with no
// "stopped typing" counterpart, so the receiver clears the indicator on a
// timer. TTL must comfortably exceed the sender's throttle window below.
const TYPING_TTL_MS = 4_000;
// Cap outgoing typing pings to one per window while the user keeps typing —
// the indicator only needs to be refreshed before its TTL elapses.
const TYPING_THROTTLE_MS = 2_500;

/**
 * Two-way typing indicator for a 1:1 DM thread, scoped to `peerId` (the
 * conversation id, which is the peer's user id).
 *
 * Contract (see backend `chat.handler.ts`):
 *   - emit `chat:typing { receiverId }` → relayed to the peer
 *   - receive `chat:typing { senderId }` → peer is typing
 *
 * Returns `isPeerTyping` (drives the "typing…" UI) and a throttled
 * `notifyTyping()` to call from the input's `onChangeText`.
 */
export const useTypingIndicator = (
  peerId: string,
): { isPeerTyping: boolean; notifyTyping: () => void } => {
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const lastEmitRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!peerId) return;
    // Race-safety: the screen can unmount (or peerId change) while getSocket()
    // is still pending; `cancelled` stops us attaching a leaked listener.
    let cancelled = false;
    let unbind: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;
      socketRef.current = socket;

      const onTyping = (payload: { senderId?: string }): void => {
        if (payload?.senderId !== peerId) return;
        setIsPeerTyping(true);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setIsPeerTyping(false), TYPING_TTL_MS);
      };

      socket.on('chat:typing', onTyping);
      unbind = () => socket.off('chat:typing', onTyping);
    })();

    return () => {
      cancelled = true;
      unbind?.();
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
      socketRef.current = null;
      setIsPeerTyping(false);
    };
  }, [peerId]);

  const notifyTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !peerId) return;
    const now = Date.now();
    if (now - lastEmitRef.current < TYPING_THROTTLE_MS) return;
    lastEmitRef.current = now;
    socket.emit('chat:typing', { receiverId: peerId });
  }, [peerId]);

  return { isPeerTyping, notifyTyping };
};
