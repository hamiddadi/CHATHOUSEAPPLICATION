import { apiClient } from '../../../shared/services/api/apiClient';

export const searchHistoryApi = {
  async list(): Promise<string[]> {
    const { data } = await apiClient.get<{ items: string[] }>('/ext/search-history');
    return data.items;
  },
  async record(query: string): Promise<void> {
    await apiClient.post('/ext/search-history/record', { query });
  },
  async clear(): Promise<void> {
    await apiClient.delete('/ext/search-history');
  },
  async remove(query: string): Promise<void> {
    await apiClient.delete('/ext/search-history/item', { data: { query } });
  },
};
