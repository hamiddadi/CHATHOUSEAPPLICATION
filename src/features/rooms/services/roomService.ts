import { apiClient } from '../../../shared/services/api/apiClient';
import type {
  Room,
  RoomCategory,
  RoomParticipant,
  RoomSummary,
  RoomVisibility,
  UserSummary,
} from '../../../shared/types/domain';
import type { Envelope } from '../../../shared/types/api';

/**
 * Backend is now authoritative for rooms. The service translates the
 * Prisma-shaped payload into the frontend's `Room` type, which was
 * shaped around mocks and carries a few derived fields (category,
 * visibility, houseName) the backend doesn't store verbatim.
 */

export interface CreateRoomInput {
  title: string;
  description?: string;
  visibility: RoomVisibility;
  houseId?: string | null;
  scheduledFor?: string | null;
  topics?: readonly string[];
  coHostIds?: readonly string[];
  isPrivate?: boolean;
  chatEnabled?: boolean;
  maxSpeakers?: number;
}

interface RawUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  // Backend-computed: is this listener followed by the current viewer?
  // Absent on legacy payloads — treated as `undefined` (see RoomScreen
  // fallback that keeps the previous positional split when no flag exists).
  followedByViewer?: boolean;
}

/**
 * A room listener carries the optional `followedByViewer` enrichment on top
 * of the lightweight `UserSummary`. Kept local to the service (domain types
 * are frozen — the Prisma client can't be regenerated) so the RoomScreen can
 * partition listeners into "followed by you" vs "others" without a positional
 * heuristic.
 */
export type RoomListener = UserSummary & { followedByViewer?: boolean };

interface RawParticipant {
  role: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'LISTENER';
  isMuted: boolean;
  user: RawUser;
}

interface RawRoom {
  id: string;
  title: string;
  description: string | null;
  hostId: string;
  clubId: string | null;
  isLive: boolean;
  isPrivate: boolean;
  // Mutual-follow gating tier. Spread verbatim from the Prisma room in the
  // backend `get` serializer, so it's present on fetched rooms (absent on
  // some legacy/feed payloads — `pickVisibility` falls back to isPrivate).
  roomType?: 'OPEN' | 'SOCIAL' | 'CLOSED';
  chatEnabled?: boolean;
  chatVisibility?: 'ALL' | 'MODS_ONLY';
  topic: string | null;
  topics?: string[];
  scheduledFor: string | null;
  createdAt: string;
  endedAt: string | null;
  host?: RawUser;
  participants?: RawParticipant[];
  club?: { id: string; name: string; iconUrl: string | null } | null;
  participantCount?: number;
  _count?: { rsvps?: number; participants?: number };
  knownSpeakers?: RawUser[];
  hasKnownSpeakers?: boolean;
}

// Feed page size requested from GET /rooms/feed (backend caps at 50).
const FEED_PAGE_SIZE = 30;
// Avatar preview counts surfaced in a room summary card.
const TOP_SPEAKERS_PREVIEW = 3;
const TOP_LISTENERS_PREVIEW = 5;

const CATEGORY_EMOJI: Record<RoomCategory, string> = {
  tech: '💻',
  design: '🎨',
  crypto: '🪙',
  ai: '🤖',
  music: '🎵',
  business: '💼',
  health: '🩺',
};

const toSummaryUser = (u: RawUser | undefined): UserSummary => ({
  id: u?.id ?? '',
  username: u?.username ?? '',
  displayName: u?.displayName ?? u?.username ?? '',
  avatarUrl: u?.avatarUrl ?? null,
});

// Like `toSummaryUser` but preserves the backend's `followedByViewer` flag so
// the room view can split listeners into "followed by you" vs "others". The
// flag is only forwarded when present (truthy or explicit boolean); legacy
// payloads leave it `undefined`.
const toListener = (u: RawUser | undefined): RoomListener => {
  const base = toSummaryUser(u);
  return u?.followedByViewer === undefined
    ? base
    : { ...base, followedByViewer: u.followedByViewer };
};

const pickCategory = (raw: RawRoom): RoomCategory => {
  const tags = [...(raw.topics ?? []), raw.topic ?? ''];
  for (const t of tags) {
    const lower = t.trim().toLowerCase();
    if (lower in CATEGORY_EMOJI) return lower as RoomCategory;
  }
  return 'tech';
};

const pickVisibility = (raw: RawRoom): RoomVisibility => {
  // Prefer the explicit roomType when the backend sends it; fall back to the
  // legacy isPrivate flag so feed/legacy payloads without roomType still read
  // correctly (closed when private, public otherwise).
  if (raw.roomType === 'CLOSED' || raw.isPrivate) return 'closed';
  if (raw.roomType === 'SOCIAL') return 'social';
  return 'public';
};

const toParticipant = (p: RawParticipant): RoomParticipant => ({
  ...toSummaryUser(p.user),
  role: p.role.toLowerCase() as RoomParticipant['role'],
  audio: p.isMuted ? 'muted' : 'idle',
  handRaised: false,
});

const toRoom = (raw: RawRoom): Room => {
  const participants = raw.participants ?? [];
  const speakers = participants.filter(p => p.role !== 'LISTENER').map(toParticipant);
  const listeners = participants.filter(p => p.role === 'LISTENER').map(p => toListener(p.user));

  const category = pickCategory(raw);
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    category,
    categoryEmoji: CATEGORY_EMOJI[category],
    visibility: pickVisibility(raw),
    houseId: raw.clubId,
    // The backend now embeds the club (id/name/iconUrl) in the room
    // payload, so we surface its name + icon directly.
    houseName: raw.club?.name ?? null,
    houseIcon: raw.club?.iconUrl ?? null,
    hostId: raw.hostId,
    speakers,
    listeners,
    speakersCount: speakers.length,
    listenersCount: listeners.length,
    participantCount: raw.participantCount ?? speakers.length + listeners.length,
    isLive: raw.isLive,
    isRecording: false,
    chatEnabled: raw.chatEnabled ?? true,
    chatVisibility: raw.chatVisibility ?? 'ALL',
    startedAt: raw.createdAt,
    scheduledFor: raw.scheduledFor,
  };
};

const toSummary = (raw: RawRoom): RoomSummary => {
  const category = pickCategory(raw);
  const participants = raw.participants ?? [];
  const speakers = participants.filter(p => p.role !== 'LISTENER');
  const listeners = participants.filter(p => p.role === 'LISTENER');
  return {
    id: raw.id,
    title: raw.title,
    category,
    categoryEmoji: CATEGORY_EMOJI[category],
    houseName: raw.club?.name ?? null,
    houseIcon: raw.club?.iconUrl ?? null,
    speakersCount: speakers.length,
    listenersCount: listeners.length,
    participantCount: raw.participantCount ?? speakers.length + listeners.length,
    scheduledFor: raw.scheduledFor,
    isLive: raw.isLive,
    topSpeakers: speakers.slice(0, TOP_SPEAKERS_PREVIEW).map(p => toSummaryUser(p.user)),
    topListeners: listeners.slice(0, TOP_LISTENERS_PREVIEW).map(p => toSummaryUser(p.user)),
  };
};

const visibilityToBackend = (
  v: RoomVisibility,
  hint?: boolean,
): {
  isPrivate: boolean;
  roomType: 'OPEN' | 'SOCIAL' | 'CLOSED';
} => {
  // Map the 3-way UI visibility onto the backend's two independent gating
  // mechanisms (both enforced in rooms.service.join):
  //   - 'closed' → isPrivate=true,  roomType=CLOSED → invite-only
  //   - 'social' → isPrivate=false, roomType=SOCIAL → mutual-follow gate
  //   - 'public' → isPrivate=false, roomType=OPEN   → anyone can join
  // SOCIAL must keep isPrivate=false so the follow-gate path runs rather than
  // the stricter invite-only path. `hint` (explicit isPrivate override) only
  // forces the private flag; roomType still follows the chosen visibility.
  const roomType = v === 'closed' ? 'CLOSED' : v === 'social' ? 'SOCIAL' : 'OPEN';
  const isPrivate = hint !== undefined ? hint : v === 'closed';
  return { isPrivate, roomType };
};

export interface RoomsListFilter {
  topic?: string;
  following?: boolean;
  clubs?: boolean;
  // When set, bypass the personalised feed and hit GET /rooms which honors
  // the list filters (notably `upcoming` for scheduled rooms).
  filter?: 'live' | 'upcoming' | 'mine';
}

export const roomService = {
  async list(filter: RoomsListFilter = {}): Promise<RoomSummary[]> {
    // The `upcoming`/`mine`/`live` list filters live on GET /rooms (the
    // personalised /rooms/feed only ranks live rooms). Route there when a
    // `filter` is requested so the "À venir" band can pull scheduled rooms.
    if (filter.filter) {
      const res = await apiClient.get<Envelope<RawRoom[]>>('/rooms', {
        params: {
          limit: FEED_PAGE_SIZE,
          filter: filter.filter,
          ...(filter.clubs ? { clubs: 'true' } : {}),
        },
      });
      return res.data.data.map(toSummary);
    }
    const res = await apiClient.get<Envelope<RawRoom[]>>('/rooms/feed', {
      params: {
        limit: FEED_PAGE_SIZE,
        ...(filter.topic ? { topic: filter.topic } : {}),
        ...(filter.following ? { following: 'true' } : {}),
        ...(filter.clubs ? { clubs: 'true' } : {}),
      },
    });
    return res.data.data.map(toSummary);
  },

  async get(id: string): Promise<Room> {
    const res = await apiClient.get<Envelope<RawRoom>>(`/rooms/${id}`);
    return toRoom(res.data.data);
  },

  async create(input: CreateRoomInput): Promise<Room> {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) throw new Error('Title is required');
    const { isPrivate, roomType } = visibilityToBackend(input.visibility, input.isPrivate);
    const res = await apiClient.post<Envelope<RawRoom>>('/rooms', {
      title: trimmed,
      description: input.description?.trim() || undefined,
      isPrivate,
      roomType,
      chatEnabled: input.chatEnabled ?? true,
      maxSpeakers: input.maxSpeakers,
      clubId: input.houseId ?? undefined,
      scheduledFor: input.scheduledFor ?? undefined,
      topics: input.topics ?? [],
      coHostIds: input.coHostIds ?? [],
    });
    return toRoom(res.data.data);
  },

  async join(roomId: string): Promise<{ joined: true }> {
    await apiClient.post(`/rooms/${roomId}/join`);
    return { joined: true };
  },

  async leave(roomId: string): Promise<{ left: true }> {
    await apiClient.post(`/rooms/${roomId}/leave`);
    return { left: true };
  },

  async raiseHand(roomId: string): Promise<{ queued: true }> {
    await apiClient.post(`/rooms/${roomId}/raise-hand`);
    return { queued: true };
  },

  async lowerHand(roomId: string): Promise<{ lowered: true }> {
    await apiClient.delete(`/rooms/${roomId}/raise-hand`);
    return { lowered: true };
  },

  async setMute(
    roomId: string,
    isMuted: boolean,
    targetUserId?: string,
  ): Promise<{ isMuted: boolean }> {
    await apiClient.patch(`/rooms/${roomId}/mute`, {
      isMuted,
      ...(targetUserId ? { userId: targetUserId } : {}),
    });
    return { isMuted };
  },

  async setRole(
    roomId: string,
    userId: string,
    role: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'LISTENER',
  ): Promise<{ userId: string; role: string }> {
    await apiClient.patch(`/rooms/${roomId}/role`, { userId, role });
    return { userId, role };
  },

  async kick(
    roomId: string,
    userId: string,
    options: { banMinutes?: number; reason?: string } = {},
  ): Promise<{ kicked: true }> {
    await apiClient.post(`/rooms/${roomId}/kick`, { userId, ...options });
    return { kicked: true };
  },

  async end(roomId: string): Promise<{ ended: true }> {
    await apiClient.delete(`/rooms/${roomId}`);
    return { ended: true };
  },

  async report(
    roomId: string,
    input: { reason: 'spam' | 'harassment' | 'fake_profile' | 'other'; details?: string },
  ): Promise<{ reportId: string }> {
    const res = await apiClient.post<Envelope<{ reportId: string }>>(
      `/rooms/${roomId}/report`,
      input,
    );
    return res.data.data;
  },

  async listHandRaises(roomId: string): Promise<(UserSummary & { raisedAt: string })[]> {
    const res = await apiClient.get<Envelope<(RawUser & { raisedAt: string })[]>>(
      `/rooms/${roomId}/hand-raises`,
    );
    return res.data.data.map(u => ({ ...toSummaryUser(u), raisedAt: u.raisedAt }));
  },

  async listMessages(roomId: string): Promise<
    {
      id: string;
      content: string;
      createdAt: string;
      user: UserSummary;
      replyTo: { id: string; content: string; user: UserSummary } | null;
    }[]
  > {
    const res = await apiClient.get<
      Envelope<
        {
          id: string;
          content: string;
          createdAt: string;
          user: RawUser;
          replyTo: { id: string; content: string; user: RawUser } | null;
        }[]
      >
    >(`/rooms/${roomId}/messages`);
    return res.data.data.map(m => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt,
      user: toSummaryUser(m.user),
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.content,
            user: toSummaryUser(m.replyTo.user),
          }
        : null,
    }));
  },

  async sendMessage(
    roomId: string,
    content: string,
    replyToId?: string,
  ): Promise<{
    id: string;
    content: string;
    createdAt: string;
    user: UserSummary;
    replyTo: { id: string; content: string; user: UserSummary } | null;
  }> {
    const res = await apiClient.post<
      Envelope<{
        id: string;
        content: string;
        createdAt: string;
        user: RawUser;
        replyTo: { id: string; content: string; user: RawUser } | null;
      }>
    >(`/rooms/${roomId}/messages`, {
      content,
      ...(replyToId ? { replyToId } : {}),
    });
    return {
      id: res.data.data.id,
      content: res.data.data.content,
      createdAt: res.data.data.createdAt,
      user: toSummaryUser(res.data.data.user),
      replyTo: res.data.data.replyTo
        ? {
            id: res.data.data.replyTo.id,
            content: res.data.data.replyTo.content,
            user: toSummaryUser(res.data.data.replyTo.user),
          }
        : null,
    };
  },

  async sendReaction(roomId: string, emoji: string): Promise<{ ok: true }> {
    await apiClient.post(`/rooms/${roomId}/reactions`, { emoji });
    return { ok: true };
  },

  async updateTitle(roomId: string, title: string): Promise<{ title: string }> {
    const res = await apiClient.patch<Envelope<{ title: string }>>(`/rooms/${roomId}/title`, {
      title,
    });
    return res.data.data;
  },

  async toggleChat(
    roomId: string,
    input: { chatEnabled?: boolean; chatVisibility?: 'all' | 'mods' },
  ): Promise<{ chatEnabled: boolean; chatVisibility: 'ALL' | 'MODS_ONLY' }> {
    const res = await apiClient.patch<
      Envelope<{ chatEnabled: boolean; chatVisibility: 'ALL' | 'MODS_ONLY' }>
    >(`/rooms/${roomId}/chat`, input);
    return res.data.data;
  },

  async muteAll(roomId: string, includeHost = false): Promise<{ mutedCount: number }> {
    const res = await apiClient.post<Envelope<{ mutedCount: number }>>(
      `/rooms/${roomId}/mute-all`,
      { includeHost },
    );
    return res.data.data;
  },

  async invite(roomId: string, userIds: readonly string[]): Promise<{ invitedCount: number }> {
    const res = await apiClient.post<Envelope<{ invitedCount: number }>>(
      `/rooms/${roomId}/invite`,
      { userIds: [...userIds] },
    );
    return res.data.data;
  },

  async ping(targetUserId: string, roomId: string): Promise<{ pinged: true }> {
    const res = await apiClient.post<Envelope<{ pinged: true }>>(`/users/${targetUserId}/ping`, {
      roomId,
    });
    return res.data.data;
  },

  /**
   * Fetch a freshly-signed Agora token bound to the caller's CURRENT
   * role in the room. Use the result immediately for `joinChannel` and
   * remember to refetch ~30s before `expiresAt` so the SDK can renew
   * without dropping the call. Backend returns 503 (AGORA_001) when the
   * server-side certificate isn't configured — caller should fall back
   * to env.AGORA_TEMP_TOKEN if present.
   */
  async getAgoraToken(roomId: string): Promise<{
    token: string;
    appId: string;
    channel: string;
    uid: number;
    role: 'publisher' | 'subscriber';
    expiresAt: string;
    expiresInSec: number;
  }> {
    const res = await apiClient.get<
      Envelope<{
        token: string;
        appId: string;
        channel: string;
        uid: number;
        role: 'publisher' | 'subscriber';
        expiresAt: string;
        expiresInSec: number;
      }>
    >(`/rooms/${roomId}/agora-token`);
    return res.data.data;
  },

  /**
   * Rooms the caller hosted that have ended. Powers the "Rooms
   * récentes" section on MyProfile. Backend caps limit at 50.
   */
  async myHistory(limit = 20): Promise<RoomSummary[]> {
    const res = await apiClient.get<Envelope<RawRoom[]>>('/rooms/history/mine', {
      params: { limit },
    });
    return res.data.data.map(toSummary);
  },
};
