import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toAppError, type AppError } from '../../../shared/services/api/errorHandler';
import type { Room } from '../../../shared/types/domain';
import { roomService } from '../services/roomService';
import { roomKeys } from './useRooms';

export type RoomMembershipStatus = 'joining' | 'joined' | 'error';

interface RoomMembershipState {
  status: RoomMembershipStatus;
  error: AppError | null;
  retry: () => void;
}

interface MembershipAttemptState {
  roomId: string;
  status: RoomMembershipStatus;
  error: AppError | null;
}

// Serialise membership mutations for one room across effect cleanup/re-mount
// cycles (including React Strict Mode). If a pending join completes after its
// screen was abandoned, its compensating leave must finish before a new
// instance is allowed to join the same room; otherwise the late leave could
// remove the new instance's valid Participant row.
const membershipQueues = new Map<string, Promise<void>>();

const enqueueMembershipMutation = (roomId: string, mutation: () => Promise<void>): void => {
  const previous = membershipQueues.get(roomId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(mutation);
  const settled = current.catch(() => undefined);
  membershipQueues.set(roomId, settled);
  void settled.then(() => {
    if (membershipQueues.get(roomId) === settled) {
      membershipQueues.delete(roomId);
    }
  });
};

/**
 * Establish the authenticated REST membership required by every restricted
 * room capability. RoomScreen is the common destination for feed navigation,
 * universal/deep links and mini-bar resume, so doing it here covers every
 * entry path.
 *
 * The join response carries the authoritative participant list. It is written
 * into React Query before `status` becomes `joined`; consumers can therefore
 * gate Socket.IO room-channel membership, hand raises and LiveKit on that
 * status without racing the Participant row.
 */
export const useRoomMembership = (roomId: string): RoomMembershipState => {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MembershipAttemptState>(() => ({
    roomId,
    status: 'joining',
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    setState({ roomId, status: 'joining', error: null });

    enqueueMembershipMutation(roomId, async () => {
      try {
        const joined = await roomService.join(roomId);
        if (cancelled) {
          // Compensate only when this request really activated the presence.
          // `changed=false` means the user was already in the room (for
          // example a mini-bar resume); `null` is a legacy API response and is
          // treated conservatively to avoid evicting that persistent session.
          if (joined.changed === true) {
            await roomService.leave(roomId).catch(() => undefined);
          }
          return;
        }
        // Cache first, enable restricted consumers second.
        const joinedRoom: Room = joined.room;
        queryClient.setQueryData(roomKeys.detail(roomId), joinedRoom);
        setState({ roomId, status: 'joined', error: null });
        void queryClient.invalidateQueries({ queryKey: roomKeys.list() });
      } catch (err) {
        if (cancelled) return;
        setState({ roomId, status: 'error', error: toAppError(err) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attempt, queryClient, roomId]);

  const retry = useCallback(() => {
    setAttempt(current => current + 1);
  }, []);

  // A route-param change is visible during render, before the old effect's
  // cleanup/new effect run. Never expose the previous room's "joined" state in
  // that frame, or useRoom(newId) could race ahead of POST /newId/join.
  if (state.roomId !== roomId) {
    return { status: 'joining', error: null, retry };
  }
  return { status: state.status, error: state.error, retry };
};
