import { apiClient } from '../../../shared/services/api/apiClient';

export interface InvitationRecord {
  id: string;
  invitedPhone: string;
  invitedName: string;
  acceptedUserId: string | null;
  createdAt: string;
}

export const nominatorApi = {
  async me(): Promise<{ remaining: number; history: InvitationRecord[] }> {
    const { data } = await apiClient.get<{ remaining: number; history: InvitationRecord[] }>(
      '/ext/nominator/me',
    );
    return data;
  },
  async invite(
    phone: string,
    name: string,
  ): Promise<{ remaining: number; record: InvitationRecord }> {
    const { data } = await apiClient.post<{ remaining: number; record: InvitationRecord }>(
      '/ext/nominator/invite',
      { phone, name },
    );
    return data;
  },
};
