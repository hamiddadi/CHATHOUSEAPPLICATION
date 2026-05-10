import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { adminService } from './admin.service';
import { auditLogService } from './auditLog.service';
import {
  forceEndRoomSchema,
  listAuditLogSchema,
  listReportsSchema,
  listRoomsSchema,
  listUsersSchema,
  resolveReportSchema,
  setRoleSchema,
  suspendSchema,
} from './admin.schema';

const requireUserId = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};

const param = (req: Request, key: string): string => {
  const raw = req.params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) throw new AppError('NOT_FOUND_001');
  return v;
};

export const adminController = {
  // ───── Users
  async listUsers(req: Request, res: Response) {
    const input = listUsersSchema.parse(req.query);
    const result = await adminService.listUsers(input);
    sendOk(res, result);
  },

  async getUser(req: Request, res: Response) {
    const user = await adminService.getUser(param(req, 'userId'));
    sendOk(res, user);
  },

  async setRole(req: Request, res: Response) {
    const input = setRoleSchema.parse(req.body);
    const ctx = auditLogService.context(req);
    const result = await adminService.setRole(requireUserId(req), param(req, 'userId'), input, ctx);
    sendOk(res, result);
  },

  async suspend(req: Request, res: Response) {
    const input = suspendSchema.parse(req.body);
    const ctx = auditLogService.context(req);
    const result = await adminService.suspend(requireUserId(req), param(req, 'userId'), input, ctx);
    sendOk(res, result);
  },

  async unsuspend(req: Request, res: Response) {
    const ctx = auditLogService.context(req);
    const result = await adminService.unsuspend(requireUserId(req), param(req, 'userId'), ctx);
    sendOk(res, result);
  },

  async deleteUser(req: Request, res: Response) {
    const ctx = auditLogService.context(req);
    const result = await adminService.deleteUser(requireUserId(req), param(req, 'userId'), ctx);
    sendOk(res, result);
  },

  // ───── Reports
  async listReports(req: Request, res: Response) {
    const input = listReportsSchema.parse(req.query);
    const result = await adminService.listReports(input);
    sendOk(res, result);
  },

  async resolveReport(req: Request, res: Response) {
    const input = resolveReportSchema.parse(req.body);
    const ctx = auditLogService.context(req);
    const result = await adminService.resolveReport(
      requireUserId(req),
      param(req, 'reportId'),
      input,
      ctx,
    );
    sendOk(res, result);
  },

  // ───── Rooms
  async listRooms(req: Request, res: Response) {
    const input = listRoomsSchema.parse(req.query);
    const result = await adminService.listRooms(input);
    sendOk(res, result);
  },

  async forceEndRoom(req: Request, res: Response) {
    const input = forceEndRoomSchema.parse(req.body);
    const ctx = auditLogService.context(req);
    const result = await adminService.forceEndRoom(
      requireUserId(req),
      param(req, 'roomId'),
      input,
      ctx,
    );
    sendOk(res, result);
  },

  // ───── Stats
  async stats(_req: Request, res: Response) {
    const result = await adminService.stats();
    sendOk(res, result);
  },

  // ───── Audit log
  async listAuditLog(req: Request, res: Response) {
    const input = listAuditLogSchema.parse(req.query);
    const result = await adminService.listAuditLog(input);
    sendOk(res, result);
  },

  // ───── Whoami (cheap probe so the frontend can decide whether to show the entry)
  async me(req: Request, res: Response) {
    const id = requireUserId(req);
    const user = await adminService.getUser(id);
    sendOk(res, { id: user.id, appRole: user.appRole });
  },

  // ───── Impersonation
  async startImpersonation(req: Request, res: Response) {
    const ctx = auditLogService.context(req);
    const result = await adminService.startImpersonation(
      requireUserId(req),
      param(req, 'userId'),
      ctx,
    );
    sendOk(res, result);
  },

  async stopImpersonation(req: Request, res: Response) {
    const ctx = auditLogService.context(req);
    const result = await adminService.stopImpersonation(
      requireUserId(req),
      param(req, 'userId'),
      ctx,
    );
    sendOk(res, result);
  },

  // ───── CSV exports
  async exportUsersCsv(_req: Request, res: Response) {
    const csv = await adminService.exportUsersCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chathouse-users-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  },

  async exportAuditLogCsv(_req: Request, res: Response) {
    const csv = await adminService.exportAuditLogCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chathouse-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  },

  async exportReportsCsv(_req: Request, res: Response) {
    const csv = await adminService.exportReportsCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chathouse-reports-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  },
};
