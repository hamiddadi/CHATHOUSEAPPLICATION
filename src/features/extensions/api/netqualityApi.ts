import { apiClient } from '../../../shared/services/api/apiClient';

export interface NetQualityReport {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  bars: 1 | 2 | 3 | null;
  warning: 'high_latency' | 'unstable' | 'poor' | null;
  measuredAt?: string;
}

export const netqualityApi = {
  async report(
    roomId: string,
    rttMs: number,
    jitterMs: number,
    packetLossPct: number,
  ): Promise<NetQualityReport> {
    const { data } = await apiClient.post<NetQualityReport>('/ext/netquality/report', {
      roomId,
      rttMs,
      jitterMs,
      packetLossPct,
    });
    return data;
  },
  async get(roomId: string): Promise<NetQualityReport> {
    const { data } = await apiClient.get<NetQualityReport>(`/ext/netquality/${roomId}`);
    return data;
  },
};
