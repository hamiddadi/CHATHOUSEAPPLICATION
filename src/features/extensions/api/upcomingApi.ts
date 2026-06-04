import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';

export interface UpcomingEvent {
  id: string;
  title: string;
  description: string | null;
  scheduledFor: string | null;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  club: { id: string; name: string; iconUrl: string | null } | null;
  rsvpCount: number;
  rsvpedByMe: boolean;
}

// Raw room shape returned by /api/rooms/events/mine (`myUpcomingEvents`).
// The backend includes `host`, `club`, and the RSVP count via `_count.rsvps`
// through roomInclude; we normalise those into the UpcomingEvent shape.
interface RawUpcomingRoom {
  id: string;
  title: string;
  description: string | null;
  scheduledFor: string | null;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  club: { id: string; name: string; iconUrl: string | null } | null;
  rsvpedByMe?: boolean;
  _count?: { rsvps?: number };
}

const toUpcomingEvent = (r: RawUpcomingRoom): UpcomingEvent => ({
  id: r.id,
  title: r.title,
  description: r.description,
  scheduledFor: r.scheduledFor,
  host: r.host,
  club: r.club,
  rsvpCount: r._count?.rsvps ?? 0,
  rsvpedByMe: r.rsvpedByMe ?? false,
});

export const upcomingApi = {
  /**
   * Uses the existing /api/rooms/events/mine endpoint (`myUpcomingEvents`)
   * — no extension route needed since the backend already exposes it. The
   * response is wrapped in the standard `{ success, data }` envelope (sendOk),
   * so we unwrap `data` then normalise each row.
   */
  async listMine(): Promise<UpcomingEvent[]> {
    const res = await apiClient.get<Envelope<RawUpcomingRoom[]>>('/rooms/events/mine');
    return res.data.data.map(toUpcomingEvent);
  },
};
