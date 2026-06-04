import { useState, useCallback } from 'react';
import { useExtSocketAliases, type ExtSocketAliasHandlers } from './useExtSocketAliases';
import { useExtNetworkQuality, type UseExtNetworkQualityOpts } from './useExtNetworkQuality';
import { useExtCaptions } from './useExtCaptions';
import { useExtRoomParticipantSearch, type ParticipantLike } from './useExtRoomParticipantSearch';

/**
 * Composite hook — single entry point that wires every V8/V9/V10 piece a
 * room screen could possibly need:
 *   - listens to the 19 alias socket events
 *   - polls + reports network quality bars
 *   - subscribes to live captions
 *   - exposes participant search state
 *   - tracks reconnecting flag
 *
 * Caller just renders the resulting UI from the returned values; no extra
 * wiring needed. Pure additive — does not mount or modify any legacy
 * room hook.
 */

export interface UseExtRoomFullStateOpts<P extends ParticipantLike> {
  roomId: string | null;
  participants: readonly P[];
  netStatsSampler?: UseExtNetworkQualityOpts['sampler'];
  captionsEnabled?: boolean;
  /**
   * Mirror of the legacy alias handlers so callers can react to any
   * alias event in addition to the composite state we manage.
   */
  socketHandlers?: ExtSocketAliasHandlers;
}

export const useExtRoomFullState = <P extends ParticipantLike>(
  opts: UseExtRoomFullStateOpts<P>,
) => {
  const { roomId, participants, netStatsSampler, captionsEnabled, socketHandlers } = opts;

  // Local state derived from alias broadcasts
  const [reconnecting, setReconnecting] = useState(false);
  const [participantsCount, setParticipantsCount] = useState<number | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [chatDisabled, setChatDisabled] = useState(false);

  const search = useExtRoomParticipantSearch(participants);
  const { report: netReport } = useExtNetworkQuality(roomId, {
    sampler: netStatsSampler,
    enabled: Boolean(roomId),
  });
  const captions = useExtCaptions(captionsEnabled ? roomId : null);

  const composedSocket: ExtSocketAliasHandlers = {
    ...socketHandlers,
    audio_reconnecting: p => {
      setReconnecting(true);
      socketHandlers?.audio_reconnecting?.(p);
    },
    audio_reconnected: p => {
      setReconnecting(false);
      socketHandlers?.audio_reconnected?.(p);
    },
    participants_update: p => {
      if (roomId && p.roomId === roomId) setParticipantsCount(p.count);
      socketHandlers?.participants_update?.(p);
    },
    room_title_updated: p => {
      if (roomId && p.roomId === roomId) setActiveTitle(p.title);
      socketHandlers?.room_title_updated?.(p);
    },
    room_closed: p => {
      if (roomId && p.roomId === roomId) setClosedReason(p.reason ?? 'closed');
      socketHandlers?.room_closed?.(p);
    },
    chat_disabled: p => {
      if (roomId && p.roomId === roomId) setChatDisabled(true);
      socketHandlers?.chat_disabled?.(p);
    },
    chat_enabled: p => {
      if (roomId && p.roomId === roomId) setChatDisabled(false);
      socketHandlers?.chat_enabled?.(p);
    },
  };
  useExtSocketAliases(composedSocket);

  const resetClosed = useCallback(() => setClosedReason(null), []);

  return {
    // realtime state
    reconnecting,
    participantsCount,
    activeTitle,
    closedReason,
    chatDisabled,
    // sub-hooks
    netReport,
    captions,
    search,
    // actions
    resetClosed,
  };
};
