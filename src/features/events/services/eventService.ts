import { apiClient } from '../../../shared/services/api/apiClient';
import type { UserSummary } from '../../../shared/types/domain';

/**
 * Scheduled-room (a.k.a. "Event") API client. Events are just rooms with
 * a future `scheduledFor`; keeping the service separate from the live
 * room service keeps concerns tidy — RSVPs and upcoming queries don't
 * belong to the live-room lifecycle.
 */

export interface ScheduledEvent {
  id: string;
  title: string;
  description: string | null;
  hostId: string;
  clubId: string | null;
  scheduledFor: string;
  isLive: boolean;
  isPrivate: boolean;
  rsvpCount: number;
  host: UserSummary;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  topic?: string;
  scheduledFor: string; // ISO 8601
  clubId?: string;
  isPrivate?: boolean;
  maxSpeakers?: number;
}

interface Envelope<T> {
  success: true;
  data: T;
}

// Raw shape returned by the backend /api/rooms endpoints. The server
// includes `host` + `_count.rsvps` via roomInclude; we normalise those
// fields into the ScheduledEvent shape below.
interface RawRoom {
  id: string;
  title: string;
  description: string | null;
  hostId: string;
  clubId: string | null;
  isLive: boolean;
  isPrivate: boolean;
  scheduledFor: string | null;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  _count?: { rsvps?: number };
}

const toEvent = (r: RawRoom): ScheduledEvent => ({
  id: r.id,
  title: r.title,
  description: r.description,
  hostId: r.hostId,
  clubId: r.clubId,
  // Callers only pass rooms we know to be scheduled; fall back to an
  // empty string for the unlikely race where the host ends it first.
  scheduledFor: r.scheduledFor ?? '',
  isLive: r.isLive,
  isPrivate: r.isPrivate,
  rsvpCount: r._count?.rsvps ?? 0,
  host: {
    id: r.host.id,
    username: r.host.username ?? '',
    displayName: r.host.displayName ?? r.host.username ?? '',
    avatarUrl: r.host.avatarUrl,
  },
});

export const eventService = {
  async listUpcoming(clubId?: string): Promise<ScheduledEvent[]> {
    const res = await apiClient.get<Envelope<RawRoom[]>>('/rooms', {
      params: { filter: 'upcoming', ...(clubId ? { clubId } : {}) },
    });
    return res.data.data.map(toEvent);
  },

  async listMine(): Promise<ScheduledEvent[]> {
    const res = await apiClient.get<Envelope<RawRoom[]>>('/rooms/events/mine');
    return res.data.data.map(toEvent);
  },

  async create(input: CreateEventInput): Promise<ScheduledEvent> {
    const res = await apiClient.post<Envelope<RawRoom>>('/rooms', {
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      topic: input.topic,
      scheduledFor: input.scheduledFor,
      clubId: input.clubId,
      isPrivate: input.isPrivate ?? false,
      maxSpeakers: input.maxSpeakers,
    });
    return toEvent(res.data.data);
  },

  async rsvp(eventId: string): Promise<{ rsvped: true }> {
    const res = await apiClient.post<Envelope<{ rsvped: true }>>(`/rooms/${eventId}/rsvp`);
    return res.data.data;
  },

  async cancelRsvp(eventId: string): Promise<{ cancelled: true }> {
    const res = await apiClient.delete<Envelope<{ cancelled: true }>>(`/rooms/${eventId}/rsvp`);
    return res.data.data;
  },

  async listRsvps(eventId: string): Promise<UserSummary[]> {
    const res = await apiClient.get<Envelope<UserSummary[]>>(`/rooms/${eventId}/rsvps`);
    return res.data.data;
  },
};
