import { apiClient } from '../../../shared/services/api/apiClient';
import type {
  AdminAuditLogEntry,
  AdminReport,
  AdminRoom,
  AdminStats,
  AdminUser,
  AdminUserDetail,
  AppRole,
  AuditAction,
  Paginated,
} from '../types/admin.types';
import type { Envelope } from '../../../shared/types/api';

export interface ListUsersParams {
  q?: string;
  role?: AppRole;
  suspended?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ListReportsParams {
  status?: 'open' | 'resolved' | 'all';
  kind?: 'USER' | 'ROOM';
  limit?: number;
  cursor?: string;
}

export interface ListAuditLogParams {
  actorId?: string;
  targetUserId?: string;
  action?: AuditAction;
  limit?: number;
  cursor?: string;
}

export const adminService = {
  async whoami(): Promise<{ id: string; appRole: AppRole }> {
    const res = await apiClient.get<Envelope<{ id: string; appRole: AppRole }>>('/admin/me');
    return res.data.data;
  },

  async stats(): Promise<AdminStats> {
    const res = await apiClient.get<Envelope<AdminStats>>('/admin/stats');
    return res.data.data;
  },

  async listUsers(params: ListUsersParams = {}): Promise<Paginated<AdminUser>> {
    const res = await apiClient.get<Envelope<Paginated<AdminUser>>>('/admin/users', {
      params,
    });
    return res.data.data;
  },

  async getUser(userId: string): Promise<AdminUserDetail> {
    const res = await apiClient.get<Envelope<AdminUserDetail>>(`/admin/users/${userId}`);
    return res.data.data;
  },

  async setRole(userId: string, role: AppRole): Promise<AdminUser> {
    const res = await apiClient.patch<Envelope<AdminUser>>(`/admin/users/${userId}/role`, { role });
    return res.data.data;
  },

  async suspend(
    userId: string,
    input: { reason: string; durationMinutes?: number },
  ): Promise<AdminUser> {
    const res = await apiClient.post<Envelope<AdminUser>>(`/admin/users/${userId}/suspend`, input);
    return res.data.data;
  },

  async unsuspend(userId: string): Promise<AdminUser> {
    const res = await apiClient.post<Envelope<AdminUser>>(`/admin/users/${userId}/unsuspend`);
    return res.data.data;
  },

  async deleteUser(userId: string): Promise<{ deleted: true }> {
    const res = await apiClient.delete<Envelope<{ deleted: true }>>(`/admin/users/${userId}`);
    return res.data.data;
  },

  async listReports(params: ListReportsParams = {}): Promise<Paginated<AdminReport>> {
    const res = await apiClient.get<Envelope<Paginated<AdminReport>>>('/admin/reports', {
      params,
    });
    return res.data.data;
  },

  async resolveReport(
    reportId: string,
    input: { outcome: 'resolved' | 'dismissed'; notes?: string },
  ): Promise<{ ok: true }> {
    const res = await apiClient.post<Envelope<{ ok: true }>>(
      `/admin/reports/${reportId}/resolve`,
      input,
    );
    return res.data.data;
  },

  async listRooms(params: { live?: boolean; limit?: number } = {}): Promise<AdminRoom[]> {
    const res = await apiClient.get<Envelope<AdminRoom[]>>('/admin/rooms', { params });
    return res.data.data;
  },

  async forceEndRoom(roomId: string, reason: string): Promise<{ ended: true }> {
    const res = await apiClient.post<Envelope<{ ended: true }>>(
      `/admin/rooms/${roomId}/force-end`,
      { reason },
    );
    return res.data.data;
  },

  async listAuditLog(params: ListAuditLogParams = {}): Promise<Paginated<AdminAuditLogEntry>> {
    const res = await apiClient.get<Envelope<Paginated<AdminAuditLogEntry>>>('/admin/audit-log', {
      params,
    });
    return res.data.data;
  },

  async startImpersonation(userId: string): Promise<{
    token: string;
    expiresInSec: number;
    user: {
      id: string;
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    };
  }> {
    const res = await apiClient.post<
      Envelope<{
        token: string;
        expiresInSec: number;
        user: {
          id: string;
          username: string | null;
          displayName: string | null;
          avatarUrl: string | null;
        };
      }>
    >(`/admin/users/${userId}/impersonate`);
    return res.data.data;
  },

  async stopImpersonation(userId: string): Promise<{ ok: true }> {
    const res = await apiClient.post<Envelope<{ ok: true }>>(
      `/admin/users/${userId}/stop-impersonating`,
    );
    return res.data.data;
  },

  /**
   * Pull a CSV export as raw text. Caller decides whether to share, save
   * to disk via expo-file-system, or paste into a clipboard.
   */
  async exportCsv(kind: 'users' | 'audit-log' | 'reports'): Promise<string> {
    const res = await apiClient.get<string>(`/admin/export/${kind}.csv`, {
      responseType: 'text',
      headers: { Accept: 'text/csv' },
      // axios default JSON parsing would garble the CSV; force a plain
      // string transformer so the response stays bytes-faithful.
      transformResponse: [d => d],
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  },
};
