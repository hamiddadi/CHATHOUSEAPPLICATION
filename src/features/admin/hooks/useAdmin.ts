import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminService,
  type ListAuditLogParams,
  type ListReportsParams,
  type ListUsersParams,
} from '../services/adminService';
import type { AppRole } from '../types/admin.types';

export const adminKeys = {
  all: ['admin'] as const,
  whoami: () => [...adminKeys.all, 'whoami'] as const,
  stats: () => [...adminKeys.all, 'stats'] as const,
  users: (p?: ListUsersParams) => [...adminKeys.all, 'users', p ?? {}] as const,
  user: (id: string) => [...adminKeys.all, 'user', id] as const,
  reports: (p?: ListReportsParams) => [...adminKeys.all, 'reports', p ?? {}] as const,
  rooms: (p?: { live?: boolean }) => [...adminKeys.all, 'rooms', p ?? {}] as const,
  auditLog: (p?: ListAuditLogParams) => [...adminKeys.all, 'audit-log', p ?? {}] as const,
};

export const useAdminWhoami = () =>
  useQuery({
    queryKey: adminKeys.whoami(),
    queryFn: () => adminService.whoami(),
    staleTime: 60_000,
    // Failure here = user is not admin / not logged in. Don't retry — the
    // caller branches on the absence of data, retry would just spam 401/403.
    retry: false,
  });

export const useAdminStats = () =>
  useQuery({
    queryKey: adminKeys.stats(),
    queryFn: () => adminService.stats(),
    refetchInterval: 30_000,
  });

export const useAdminUsers = (params: ListUsersParams = {}) =>
  useQuery({
    queryKey: adminKeys.users(params),
    queryFn: () => adminService.listUsers(params),
  });

export const useAdminUser = (userId: string | null) =>
  useQuery({
    queryKey: adminKeys.user(userId ?? ''),
    queryFn: () => adminService.getUser(userId as string),
    enabled: Boolean(userId),
  });

export const useSetUserRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AppRole }) =>
      adminService.setRole(userId, role),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: adminKeys.user(vars.userId) });
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, 'users'] });
    },
  });
};

export const useSuspendUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      reason,
      durationMinutes,
    }: {
      userId: string;
      reason: string;
      durationMinutes?: number;
    }) => adminService.suspend(userId, { reason, durationMinutes }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: adminKeys.user(vars.userId) });
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, 'users'] });
    },
  });
};

export const useUnsuspendUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => adminService.unsuspend(userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: adminKeys.user(userId) });
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, 'users'] });
    },
  });
};

export const useDeleteUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => adminService.deleteUser(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, 'users'] });
    },
  });
};

export const useAdminReports = (params: ListReportsParams = {}) =>
  useQuery({
    queryKey: adminKeys.reports(params),
    queryFn: () => adminService.listReports(params),
  });

export const useResolveReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      outcome,
      notes,
    }: {
      reportId: string;
      outcome: 'resolved' | 'dismissed';
      notes?: string;
    }) => adminService.resolveReport(reportId, { outcome, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, 'reports'] });
      void qc.invalidateQueries({ queryKey: adminKeys.stats() });
    },
  });
};

export const useAdminRooms = (params: { live?: boolean } = { live: true }) =>
  useQuery({
    queryKey: adminKeys.rooms(params),
    queryFn: () => adminService.listRooms(params),
  });

export const useForceEndRoom = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, reason }: { roomId: string; reason: string }) =>
      adminService.forceEndRoom(roomId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...adminKeys.all, 'rooms'] });
      void qc.invalidateQueries({ queryKey: adminKeys.stats() });
    },
  });
};

export const useAdminAuditLog = (params: ListAuditLogParams = {}) =>
  useQuery({
    queryKey: adminKeys.auditLog(params),
    queryFn: () => adminService.listAuditLog(params),
  });
