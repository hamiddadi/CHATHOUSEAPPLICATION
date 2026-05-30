import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { House, HouseMember, HousePrivacy, HouseSummary } from '../../../shared/types/domain';

export interface CreateHouseInput {
  name: string;
  description: string;
  privacy: HousePrivacy;
  iconUrl?: string | null;
}

export type HouseMemberRole = HouseMember['role'];

/**
 * Compact room shape surfaced in the house detail "En direct" / "Planifiées"
 * sections. We keep this independent from the rooms feature's `RoomSummary`
 * mapper (which we must not touch) and map the raw `/rooms` payload directly.
 */
export interface HouseRoom {
  id: string;
  title: string;
  isLive: boolean;
  scheduledFor: string | null;
  participantCount: number;
}

interface RawHouseRoom {
  id: string;
  title: string;
  isLive: boolean;
  scheduledFor: string | null;
  participantCount?: number;
  _count?: { participants?: number };
}

const toHouseRoom = (raw: RawHouseRoom): HouseRoom => ({
  id: raw.id,
  title: raw.title,
  isLive: raw.isLive,
  scheduledFor: raw.scheduledFor,
  participantCount: raw.participantCount ?? raw._count?.participants ?? 0,
});

// Backend /api/clubs envelope already matches House / HouseSummary shape:
// fields & casing normalised server-side (privacy/role lowercased, dates as
// ISO strings). Keep the service thin — pure transport.

export const houseService = {
  async list(filter: 'mine' | 'discover' = 'mine'): Promise<HouseSummary[]> {
    const res = await apiClient.get<Envelope<HouseSummary[]>>('/clubs', {
      params: { filter },
    });
    return res.data.data;
  },

  async get(id: string): Promise<House> {
    const res = await apiClient.get<Envelope<House>>(`/clubs/${id}`);
    return res.data.data;
  },

  async create(input: CreateHouseInput): Promise<House> {
    const res = await apiClient.post<Envelope<House>>('/clubs', {
      name: input.name.trim(),
      description: input.description.trim() || undefined,
      privacy: input.privacy === 'private' ? 'PRIVATE' : 'OPEN',
      iconUrl: input.iconUrl ?? undefined,
    });
    return res.data.data;
  },

  async join(houseId: string): Promise<{ joined: true }> {
    const res = await apiClient.post<Envelope<{ joined: true }>>(`/clubs/${houseId}/join`);
    return res.data.data;
  },

  async invite(houseId: string, userIds: readonly string[]): Promise<{ sent: number }> {
    const res = await apiClient.post<Envelope<{ sent: number }>>(`/clubs/${houseId}/invite`, {
      userIds,
    });
    return res.data.data;
  },

  async acceptInvitation(
    houseId: string,
    _inviteToken: string | undefined,
  ): Promise<{ joined: true }> {
    // The invite token is carried by the CLUB_INVITE notification payload;
    // the backend only needs the club id to add the current user as a member.
    const res = await apiClient.post<Envelope<{ joined: true }>>(`/clubs/${houseId}/accept`);
    return res.data.data;
  },

  async setMemberRole(houseId: string, userId: string, role: HouseMemberRole): Promise<House> {
    const res = await apiClient.patch<Envelope<House>>(`/clubs/${houseId}/members/${userId}/role`, {
      role,
    });
    return res.data.data;
  },

  /**
   * Rooms attached to a house, split via the `filter` band:
   *   filter: 'live'      → currently live rooms
   *   filter: 'upcoming'  → scheduled rooms
   * Hits GET /rooms?clubId=…&filter=… (the rooms list endpoint already
   * supports clubId scoping) without touching the rooms feature service.
   */
  async listRooms(houseId: string, filter: 'live' | 'upcoming'): Promise<HouseRoom[]> {
    const res = await apiClient.get<Envelope<RawHouseRoom[]>>('/rooms', {
      params: { clubId: houseId, filter },
    });
    return res.data.data.map(toHouseRoom);
  },
};
