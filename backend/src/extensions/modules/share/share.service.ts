import { prisma } from '../../../config/database';
import { extError } from '../../utils/ExtAppError';

/**
 * Pre-filled share URLs (Twitter / X, generic copy) for rooms & events.
 * Pure-functional service — reads existing Room data, returns string
 * URLs. No DB write.
 */

const truncate = (s: string, max = 200): string =>
  s.length <= max ? s : s.slice(0, max - 1) + '…';

interface ShareLinks {
  url: string;
  twitter: string;
  whatsapp: string;
  telegram: string;
  text: string;
}

export const shareService = {
  async roomShare(roomId: string): Promise<ShareLinks> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { host: { select: { displayName: true, username: true } } },
    });
    if (!room) throw extError('CLUB_REQ_NOT_FOUND', 'Room not found');

    const url = `https://app.chathouse.com/r/${room.id}`;
    const host = room.host.displayName ?? room.host.username ?? 'a host';
    const isScheduled = Boolean(room.scheduledFor);
    const verb = isScheduled ? 'Join me' : "I'm live";
    const tail =
      isScheduled && room.scheduledFor ? ` on ${room.scheduledFor.toUTCString()}` : ' right now';
    const text = truncate(`${verb}${tail} for "${room.title}" on Chathouse — hosted by ${host}.`);

    return {
      url,
      text,
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        text,
      )}&url=${encodeURIComponent(url)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(
        url,
      )}&text=${encodeURIComponent(text)}`,
    };
  },
};
