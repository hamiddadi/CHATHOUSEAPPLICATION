import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { House, HouseMember, HousePrivacy, HouseSummary } from '../../../shared/types/domain';

// Backend club privacy enum (uppercase). The FE uses lowercase `HousePrivacy`;
// this maps each value 1:1 so a SOCIAL house is created as SOCIAL rather than
// silently downgraded to OPEN.
const PRIVACY_TO_DB: Record<HousePrivacy, 'OPEN' | 'PRIVATE' | 'SOCIAL'> = {
  open: 'OPEN',
  private: 'PRIVATE',
  social: 'SOCIAL',
};

export interface CreateHouseInput {
  name: string;
  description: string;
  privacy: HousePrivacy;
  iconUrl?: string | null;
}

export interface UpdateHouseInput {
  name?: string;
  description?: string;
  privacy?: HousePrivacy;
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
      privacy: PRIVACY_TO_DB[input.privacy],
      iconUrl: input.iconUrl ?? undefined,
    });
    return res.data.data;
  },

  async update(id: string, input: UpdateHouseInput): Promise<House> {
    const res = await apiClient.patch<Envelope<House>>(`/clubs/${id}`, {
      name: input.name !== undefined ? input.name.trim() : undefined,
      description: input.description !== undefined ? input.description.trim() : undefined,
      privacy: input.privacy !== undefined ? PRIVACY_TO_DB[input.privacy] : undefined,
      iconUrl: input.iconUrl ?? undefined,
    });
    return res.data.data;
  },

  async remove(id: string): Promise<{ deleted: true }> {
    const res = await apiClient.delete<Envelope<{ deleted: true }>>(`/clubs/${id}`);
    return res.data.data;
  },

  async join(houseId: string): Promise<{ joined: true }> {
    const res = await apiClient.post<Envelope<{ joined: true }>>(`/clubs/${houseId}/join`);
    return res.data.data;
  },

  async leave(houseId: string): Promise<{ left: true }> {
    // Backend rejects the owner with CLUB_005 (they must delete the house
    // instead) — callers should hide the action for the owner.
    const res = await apiClient.post<Envelope<{ left: true }>>(`/clubs/${houseId}/leave`);
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

  async removeMember(houseId: string, userId: string): Promise<House> {
    const res = await apiClient.delete<Envelope<House>>(`/clubs/${houseId}/members/${userId}`);
    return res.data.data;
  },

  /**
   * Rooms attached to a house, split via the `filter` band:
   *   filter: 'live'      → currently live rooms
   *   filter: 'upcoming'  → scheduled rooms
   *   filter: 'past'      → ended rooms (archive)
   * Hits GET /rooms?clubId=…&filter=… (the rooms list endpoint already
   * supports clubId scoping) without touching the rooms feature service.
   */
  async listRooms(houseId: string, filter: 'live' | 'upcoming' | 'past'): Promise<HouseRoom[]> {
    const res = await apiClient.get<Envelope<RawHouseRoom[]>>('/rooms', {
      params: { clubId: houseId, filter },
    });
    return res.data.data.map(toHouseRoom);
  },
};
