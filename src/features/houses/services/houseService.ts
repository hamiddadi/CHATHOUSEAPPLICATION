import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { House, HousePrivacy, HouseSummary } from '../../../shared/types/domain';

export interface CreateHouseInput {
  name: string;
  description: string;
  privacy: HousePrivacy;
  iconUrl?: string | null;
}

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
};
