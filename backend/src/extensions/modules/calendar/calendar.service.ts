import { prisma } from '../../../config/database';
import { extError } from '../../utils/ExtAppError';

/**
 * Calendar export (.ics) for scheduled events.
 *
 * Generates an RFC 5545 VCALENDAR block from a scheduled Room. Google
 * Calendar, Apple Calendar, Outlook and the iOS/Android default calendar
 * apps all consume this format natively.
 *
 * No new schema — reads existing `Room` columns (scheduledFor, title,
 * description, host).
 */

const escapeIcs = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const formatIcsDate = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Default duration when the room has no defined end (60 min). */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export const calendarService = {
  async icsForRoom(callerId: string, roomId: string): Promise<string> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        host: { select: { displayName: true, username: true } },
      },
    });
    if (!room) throw extError('CLUB_REQ_NOT_FOUND', 'Event not found');

    // Confidentiality gate: private/closed rooms only export to the host or
    // a user who has RSVP'd. Mirrors followFanout's isPrivate/CLOSED guard so
    // a .ics export cannot leak metadata (title, schedule, host) of rooms the
    // caller has no access to (IDOR fix).
    if (room.isPrivate || room.roomType === 'CLOSED') {
      const isHost = room.hostId === callerId;
      if (!isHost) {
        const rsvp = await prisma.roomRsvp.findUnique({
          where: { roomId_userId: { roomId, userId: callerId } },
          select: { id: true },
        });
        // Surface as a 404 to avoid confirming the room's existence.
        if (!rsvp) throw extError('CLUB_REQ_NOT_FOUND', 'Event not found');
      }
    }

    if (!room.scheduledFor) {
      throw extError('PAY_INVALID', 'Room is not a scheduled event');
    }

    const start = room.scheduledFor;
    const end = new Date(start.getTime() + DEFAULT_DURATION_MS);
    const now = new Date();
    const uid = `${room.id}@chathouse.app`;
    const summary = escapeIcs(`Chathouse — ${room.title}`);
    const description = escapeIcs(
      room.description ??
        `Live audio room hosted by ${room.host.displayName ?? room.host.username ?? 'a Chathouse user'}.`,
    );
    const url = `https://app.chathouse.com/r/${room.id}`;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Chathouse//Event Export//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `URL:${url}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    // ICS lines should be CRLF-terminated per the spec
    return lines.join('\r\n') + '\r\n';
  },
};
