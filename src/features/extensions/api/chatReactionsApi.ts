import { apiClient } from '../../../shared/services/api/apiClient';

export type ReactionsByEmoji = Record<string, { count: number; byMe: boolean }>;

export const chatReactionsApi = {
  async list(messageId: string): Promise<ReactionsByEmoji> {
    const { data } = await apiClient.get<{ reactions: ReactionsByEmoji }>(
      `/ext/chat-reactions/${messageId}`,
    );
    return data.reactions;
  },
  async toggle(messageId: string, emoji: string): Promise<ReactionsByEmoji> {
    const { data } = await apiClient.post<{ reactions: ReactionsByEmoji }>(
      `/ext/chat-reactions/${messageId}/toggle`,
      { emoji },
    );
    return data.reactions;
  },
};
