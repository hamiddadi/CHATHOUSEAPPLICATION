import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import {
  requireAdmin,
  requireAuth,
  requireModerator,
  requireSuperAdmin,
} from '../../middlewares/auth.middleware';
import { adminController } from './admin.controller';
import { auditLogService } from './auditLog.service';

export const adminRouter: Router = Router();

// Master switch — when GODMODE_ENABLED=false the entire surface returns
// ADMIN_003 (410 Gone) even for the highest-ranked accounts. Useful as an
// "emergency lockdown" toggle without redeploying.
const requireGodmodeEnabled: RequestHandler = (_req, _res, next) => {
  if (!env.GODMODE_ENABLED) return next(new AppError('ADMIN_003'));
  next();
};

// Tag every successful admin call as "godmode access" in the audit trail.
// We only persist the breadcrumb when the role check passed, so failed
// authn attempts don't pollute the log (those land in winston instead).
const recordGodmodeAccess: RequestHandler = (req, _res, next) => {
  if (!req.userId) return next();
  const ctx = auditLogService.context(req);
  // Fire-and-forget — record() swallows persistence errors itself.
  void auditLogService.record({
    actorId: req.userId,
    action: 'GODMODE_ACCESS',
    targetType: 'route',
    targetId: req.path,
    metadata: { method: req.method },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  next();
};

adminRouter.use(requireGodmodeEnabled, requireAuth);

// Whoami — accessible to any authed user so the client can probe whether
// to show the godmode entry. The response only reveals the caller's own
// role, never anyone else's.
adminRouter.get('/me', asyncHandler(adminController.me));

// Read-only stats + lists: MODERATOR can see them.
adminRouter.use(requireModerator, recordGodmodeAccess);
adminRouter.get('/stats', asyncHandler(adminController.stats));
adminRouter.get('/users', asyncHandler(adminController.listUsers));
adminRouter.get('/users/:userId', asyncHandler(adminController.getUser));
adminRouter.get('/reports', asyncHandler(adminController.listReports));
adminRouter.get('/rooms', asyncHandler(adminController.listRooms));
adminRouter.post('/reports/:reportId/resolve', asyncHandler(adminController.resolveReport));
adminRouter.post('/users/:userId/suspend', asyncHandler(adminController.suspend));
adminRouter.post('/users/:userId/unsuspend', asyncHandler(adminController.unsuspend));

// Write operations on rooms: ADMIN+
const adminOnly = Router({ mergeParams: true });
adminOnly.use(requireAdmin);
adminOnly.post('/rooms/:roomId/force-end', asyncHandler(adminController.forceEndRoom));
adminRouter.use(adminOnly);

// Sensitive: role assignment + hard delete + audit log access — SUPER_ADMIN
// only. Audit log is read-only; hard delete is soft (sets deletedAt) but
// still privileged because it kicks off a downstream purge.
const superOnly = Router({ mergeParams: true });
superOnly.use(requireSuperAdmin);
superOnly.patch('/users/:userId/role', asyncHandler(adminController.setRole));
superOnly.delete('/users/:userId', asyncHandler(adminController.deleteUser));
superOnly.get('/audit-log', asyncHandler(adminController.listAuditLog));
// Impersonation — SUPER_ADMIN only. Issues a 15-min token; both start and
// stop are audited so the trail captures the full window.
superOnly.post('/users/:userId/impersonate', asyncHandler(adminController.startImpersonation));
superOnly.post(
  '/users/:userId/stop-impersonating',
  asyncHandler(adminController.stopImpersonation),
);
// CSV exports — privileged for two reasons: (a) the data is wide and
// includes PII, (b) downloads bypass the in-app rate-limit so we want a
// full audit row per pull (handled by recordGodmodeAccess upstream).
superOnly.get('/export/users.csv', asyncHandler(adminController.exportUsersCsv));
superOnly.get('/export/audit-log.csv', asyncHandler(adminController.exportAuditLogCsv));
superOnly.get('/export/reports.csv', asyncHandler(adminController.exportReportsCsv));
adminRouter.use(superOnly);
