import { MOCK_ROOMS, MOCK_ROOM_SUMMARIES, findRoomById } from '../../../shared/mocks/rooms.mock';
import type { Room, RoomSummary, RoomVisibility } from '../../../shared/types/domain';

const wait = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

export interface CreateRoomInput {
  title: string;
  description?: string;
  visibility: RoomVisibility;
  houseId?: string | null;
  scheduledFor?: string | null;
}

/**
 * Signatures match what the backend will return.
 * Swap this module to hit apiClient when backend ships.
 */
export const roomService = {
  async list(): Promise<RoomSummary[]> {
    await wait(250);
    return [...MOCK_ROOM_SUMMARIES];
  },

  async get(id: string): Promise<Room> {
    await wait(200);
    const room = findRoomById(id);
    if (!room) throw new Error(`Room ${id} not found`);
    return room;
  },

  async create(input: CreateRoomInput): Promise<Room> {
    await wait(400);
    if (input.title.trim().length === 0) throw new Error('Title is required');
    const template = MOCK_ROOMS[0];
    if (!template) throw new Error('Mock seed missing');
    return {
      ...template,
      id: `r-new-${Date.now()}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      visibility: input.visibility,
      houseId: input.houseId ?? null,
      houseName: null,
      scheduledFor: input.scheduledFor ?? null,
      isLive: input.scheduledFor == null,
      listeners: [],
      speakers: template.speakers.slice(0, 1),
      speakersCount: 1,
      listenersCount: 0,
    };
  },

  async join(roomId: string): Promise<{ joined: true }> {
    await wait(150);
    if (!findRoomById(roomId)) throw new Error(`Room ${roomId} not found`);
    return { joined: true };
  },

  async leave(roomId: string): Promise<{ left: true }> {
    await wait(100);
    if (!findRoomById(roomId)) throw new Error(`Room ${roomId} not found`);
    return { left: true };
  },

  async raiseHand(roomId: string): Promise<{ queued: true }> {
    await wait(100);
    if (!findRoomById(roomId)) throw new Error(`Room ${roomId} not found`);
    return { queued: true };
  },
};
