import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { UserSummary } from '../../../shared/types/domain';

/**
 * Room Replays — completed LiveKit Egress recordings, served from object
 * storage. The feature is feature-flagged server-side: when egress isn't
 * configured these lists are simply empty (no recordings are ever produced).
 *
 * Backend contract — backend/src/modules/recordings:
 *   GET /recordings              → recent public replays (with room + host)
 *   GET /recordings/room/:roomId → a room's completed replays
 */

interface RawReplayUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface RawReplay {
  id: string;
  roomId: string;
  status: string;
  fileUrl: string | null;
  durationMs: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  room?: { id: string; title: string; host: RawReplayUser };
}

export interface Replay {
  id: string;
  roomId: string;
  fileUrl: string;
  durationMs: number | null;
  createdAt: string;
  roomTitle: string | null;
  host: UserSummary | null;
}

const toSummary = (u: RawReplayUser): UserSummary => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
});

const toReplay = (r: RawReplay): Replay => ({
  id: r.id,
  roomId: r.roomId,
  fileUrl: r.fileUrl ?? '',
  durationMs: r.durationMs,
  createdAt: r.createdAt,
  roomTitle: r.room?.title ?? null,
  host: r.room?.host ? toSummary(r.room.host) : null,
});

export const recordingService = {
  async recent(): Promise<Replay[]> {
    const res = await apiClient.get<Envelope<RawReplay[]>>('/recordings');
    return res.data.data.map(toReplay);
  },

  async forRoom(roomId: string): Promise<Replay[]> {
    const res = await apiClient.get<Envelope<RawReplay[]>>(`/recordings/room/${roomId}`);
    return res.data.data.map(toReplay);
  },
};
