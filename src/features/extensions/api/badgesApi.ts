import { apiClient } from '../../../shared/services/api/apiClient';

export type Badge =
  | 'verified'
  | 'top_speaker'
  | 'early'
  | 'host'
  | 'club_owner'
  | 'nominator'
  | 'staff';

export const BADGE_META: Record<Badge, { label: string; emoji: string; tone: string }> = {
  verified: { label: 'Verified', emoji: '✓', tone: '#2A8BF2' },
  top_speaker: { label: 'Top speaker', emoji: '🎙', tone: '#22C55E' },
  early: { label: 'Early member', emoji: '🌱', tone: '#F59E0B' },
  host: { label: 'Host', emoji: '⭐', tone: '#0F172A' },
  club_owner: { label: 'Club owner', emoji: '🏠', tone: '#7C3AED' },
  nominator: { label: 'Nominator', emoji: '💎', tone: '#06B6D4' },
  staff: { label: 'Staff', emoji: '🛡', tone: '#EF4444' },
};

export const badgesApi = {
  async list(userId: string): Promise<Badge[]> {
    const { data } = await apiClient.get<{ items: Badge[] }>(`/ext/badges/${userId}`);
    return data.items;
  },
};
