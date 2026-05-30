import { useEffect, useRef } from 'react';
import { getSocket } from '../../../shared/services/realtime/socketClient';

/**
 * React hook that subscribes to the Vague 8 socket aliases (Clubhouse-spec
 * event names emitted in addition to the legacy scoped names) and lets the
 * caller react to each. Pure additive — uses the existing `getSocket()`
 * factory without modifying it.
 *
 * Pass partial handler maps; unspecified events are ignored.
 *
 * @example
 *   useExtSocketAliases({
 *     room_title_updated: ({ roomId, title }) => updateTitle(roomId, title),
 *     network_quality:    ({ bars, warning }) => setBars(bars, warning),
 *   });
 */

export interface ExtSocketAliasHandlers {
  // Room lifecycle
  room_title_updated?: (p: { roomId: string; title: string }) => void;
  room_closed?: (p: { roomId: string; reason?: string }) => void;
  room_participant_joined?: (p: {
    roomId: string;
    user: { id: string; username: string | null; displayName: string | null };
  }) => void;
  room_participant_left?: (p: { roomId: string; userId: string }) => void;
  participants_update?: (p: { roomId: string; count: number }) => void;

  // Moderation
  role_promoted_to_moderator?: (p: { roomId: string; userId: string; role: 'MODERATOR' }) => void;
  mute_all_speakers?: (p: { roomId: string; by: string }) => void;
  speaker_moved_to_audience?: (p: { roomId: string; userId: string; role: 'LISTENER' }) => void;
  speak_invite_sent?: (p: { roomId: string; fromUserId: string }) => void;
  speak_invite_response?: (p: { roomId: string; userId: string; accepted: boolean }) => void;

  // Audio
  network_quality?: (p: { roomId: string; bars: 1 | 2 | 3; warning: string | null }) => void;
  audio_reconnecting?: (p: { roomId: string }) => void;
  audio_reconnected?: (p: { roomId: string }) => void;

  // Social
  room_started_by_following?: (p: {
    roomId: string;
    hostId: string;
    hostName: string | null;
    title: string;
  }) => void;
  ping_user?: (p: { fromUserId: string; roomId: string; type: 'ping' | 'wave' }) => void;
  join_request?: (p: { clubId: string; requesterId: string; message: string | null }) => void;
  join_request_response?: (p: { clubId: string; approved: boolean }) => void;

  // Chat
  chat_disabled?: (p: { roomId: string; by: string }) => void;
  chat_enabled?: (p: { roomId: string; by: string }) => void;
}

const EVENT_NAMES: (keyof ExtSocketAliasHandlers)[] = [
  'room_title_updated',
  'room_closed',
  'room_participant_joined',
  'room_participant_left',
  'participants_update',
  'role_promoted_to_moderator',
  'mute_all_speakers',
  'speaker_moved_to_audience',
  'speak_invite_sent',
  'speak_invite_response',
  'network_quality',
  'audio_reconnecting',
  'audio_reconnected',
  'room_started_by_following',
  'ping_user',
  'join_request',
  'join_request_response',
  'chat_disabled',
  'chat_enabled',
];

export const useExtSocketAliases = (handlers: ExtSocketAliasHandlers): void => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;
    let cleanups: (() => void)[] = [];

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      for (const name of EVENT_NAMES) {
        const listener = (payload: unknown): void => {
          const fn = handlersRef.current[name];
          if (typeof fn === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (fn as any)(payload);
          }
        };
        socket.on(name, listener);
        cleanups.push(() => socket.off(name, listener));
      }
    })();

    return () => {
      cancelled = true;
      for (const off of cleanups) off();
      cleanups = [];
    };
  }, []);
};
