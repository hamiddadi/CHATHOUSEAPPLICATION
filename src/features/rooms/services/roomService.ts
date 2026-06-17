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
  // Host opt-in: record the room for later Replay (audio-only). Only takes
  // effect when the backend has egress configured (otherwise a harmless no-op).
  recordingEnabled?: boolean;
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
  recordingEnabled?: boolean;
  topic: string | null;
  topics?: string[];
  scheduledFor: string | null;
  totalAttendees?: number;
  isLocked?: boolean;
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

// Feed page size requested from GET /rooms/feed (backend caps at 50). Exported
// so the infinite-scroll hook can detect a full page (→ another page may exist).
export const FEED_PAGE_SIZE = 30;
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
    totalAttendees: raw.totalAttendees ?? 0,
    isLocked: raw.isLocked ?? false,
    isLive: raw.isLive,
    isRecording: raw.recordingEnabled ?? false,
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
    // Forward the backend's "followed speakers in this room" enrichment so the
    // card can render a friends-inside cue (it previously dropped these).
    knownSpeakers: (raw.knownSpeakers ?? []).map(toSummaryUser),
    hasKnownSpeakers: raw.hasKnownSpeakers ?? (raw.knownSpeakers?.length ?? 0) > 0,
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
  async list(filter: RoomsListFilter = {}, offset = 0): Promise<RoomSummary[]> {
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
        // Infinite scroll: advance the ranked feed by `offset` (page * size).
        ...(offset > 0 ? { offset } : {}),
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

  // Public scheduled rooms a given user is hosting — for the "Events à venir"
  // section on their profile.
  async userUpcoming(userId: string): Promise<RoomSummary[]> {
    const res = await apiClient.get<Envelope<RawRoom[]>>(`/rooms/users/${userId}/upcoming`);
    return res.data.data.map(toSummary);
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
      recordingEnabled: input.recordingEnabled ?? false,
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

  async setLock(roomId: string, locked: boolean): Promise<{ isLocked: boolean }> {
    const res = await apiClient.patch<Envelope<{ isLocked: boolean }>>(`/rooms/${roomId}/lock`, {
      locked,
    });
    return res.data.data;
  },

  // #14: flip the room between public and private after creation (host only).
  async setPrivacy(roomId: string, isPrivate: boolean): Promise<{ isPrivate: boolean }> {
    const res = await apiClient.patch<Envelope<{ isPrivate: boolean }>>(
      `/rooms/${roomId}/privacy`,
      { isPrivate },
    );
    return res.data.data;
  },

  // #32: toggle the caller's invisible/ghost state in the room.
  async setHidden(roomId: string, hidden: boolean): Promise<{ hidden: boolean }> {
    const res = await apiClient.patch<Envelope<{ hidden: boolean }>>(
      `/rooms/${roomId}/visibility`,
      { hidden },
    );
    return res.data.data;
  },

  async raiseHand(roomId: string): Promise<{ queued: true }> {
    await apiClient.post(`/rooms/${roomId}/raise-hand`);
    return { queued: true };
  },

  async lowerHand(roomId: string): Promise<{ lowered: true }> {
    await apiClient.delete(`/rooms/${roomId}/raise-hand`);
    return { lowered: true };
  },

  // #3: host/mod declines a specific listener's pending speak request (refuse).
  async dismissHandRaise(roomId: string, userId: string): Promise<{ dismissed: boolean }> {
    const res = await apiClient.delete<Envelope<{ dismissed: boolean }>>(
      `/rooms/${roomId}/hand-raises/${userId}`,
    );
    return res.data.data;
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
    // Canonical route: both ids come from the path (see rooms.controller.ts `ping`).
    // A former /users/:userId/ping alias was removed — it was broken (the shared
    // controller read the room id from params.id, which that route never provided).
    const res = await apiClient.post<Envelope<{ pinged: true }>>(
      `/rooms/${roomId}/ping/${targetUserId}`,
    );
    return res.data.data;
  },

  /**
   * Fetch a freshly-signed LiveKit token bound to the caller's CURRENT
   * role in the room. Use the result immediately for `room.connect()` and
   * remember to refetch ~30s before `expiresAt` so the SDK can renew
   * without dropping the call. Backend returns 503 (LIVEKIT_001) when the
   * server-side credentials aren't configured.
   */
  async getLivekitToken(roomId: string): Promise<{
    token: string;
    url: string;
    room: string;
    identity: string;
    canPublish: boolean;
    expiresAt: string;
    expiresInSec: number;
  }> {
    const res = await apiClient.get<
      Envelope<{
        token: string;
        url: string;
        room: string;
        identity: string;
        canPublish: boolean;
        expiresAt: string;
        expiresInSec: number;
      }>
    >(`/rooms/${roomId}/livekit-token`);
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
