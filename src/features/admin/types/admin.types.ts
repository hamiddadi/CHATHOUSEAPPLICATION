export type AppRole = 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';

export type AuditAction =
  | 'USER_ROLE_CHANGED'
  | 'USER_SUSPENDED'
  | 'USER_UNSUSPENDED'
  | 'USER_DELETED'
  | 'ROOM_FORCE_ENDED'
  | 'REPORT_RESOLVED'
  | 'REPORT_DISMISSED'
  | 'GODMODE_ACCESS'
  | 'IMPERSONATION_STARTED'
  | 'IMPERSONATION_ENDED';

export interface AdminUser {
  id: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  phoneNumber: string | null;
  avatarUrl: string | null;
  appRole: AppRole;
  isOnline: boolean;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  followerCount: number;
  followingCount: number;
  deletedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AdminUserDetail extends AdminUser {
  bio: string | null;
  twitter: string | null;
  instagram: string | null;
  interests: string[];
  currentRoomId: string | null;
  _count?: { hostedRooms?: number; participants?: number };
}

export interface AdminStats {
  users: { total: number; online: number; suspended: number; new24h: number; new7d: number };
  rooms: { live: number; total: number };
  reports: { open: number; total: number };
  messages: { last24h: number };
}

export interface AdminReport {
  id: string;
  reporterId: string;
  reporter: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  reported: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  reportedRoom: { id: string; title: string; isLive: boolean; hostId: string } | null;
  targetKind: 'USER' | 'ROOM';
  reason: 'SPAM' | 'HARASSMENT' | 'FAKE_PROFILE' | 'OTHER';
  details: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AdminAuditLogEntry {
  id: string;
  actorId: string;
  actor: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  action: AuditAction;
  targetUserId: string | null;
  targetUser: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  targetRoomId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminRoom {
  id: string;
  title: string;
  isLive: boolean;
  isPrivate: boolean;
  participantCount: number;
  hostId: string;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  endedAt: string | null;
  _count?: { participants?: number };
}

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const ROLE_RANK: Record<AppRole, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export const isAtLeast = (have: AppRole, need: AppRole): boolean =>
  ROLE_RANK[have] >= ROLE_RANK[need];
