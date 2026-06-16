import { apiClient } from '../../../shared/services/api/apiClient';
import { roomService, type CreateRoomInput } from './roomService';

/**
 * Pure contract test for the room service. We mock `apiClient` so axios never
 * loads (and no network is touched) and assert that every room-control button's
 * service method hits the EXACT backend method + path + body. This locks the
 * full create/moderation surface — most importantly the `ping` regression where
 * the service used to POST a since-removed `/users/:id/ping` alias (which always
 * 404'd) instead of the canonical `/rooms/:id/ping/:userId` route.
 */
jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const api = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

// Minimal RawRoom that `toRoom`/`toSummary` can map without throwing.
const rawRoom = (over: Record<string, unknown> = {}) => ({
  id: 'room1',
  title: 'Hello',
  description: null,
  hostId: 'host1',
  clubId: null,
  isLive: true,
  isPrivate: false,
  topic: null,
  topics: [],
  scheduledFor: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  participants: [],
  ...over,
});

const baseCreate: CreateRoomInput = { title: 'My room', visibility: 'public' };

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { data: rawRoom() } });
  api.post.mockResolvedValue({ data: { data: rawRoom() } });
  api.patch.mockResolvedValue({ data: { data: {} } });
  api.delete.mockResolvedValue({ data: { data: {} } });
});

describe('roomService.create — the 3 room types map to backend gating fields', () => {
  it('PUBLIC → POST /rooms with isPrivate:false, roomType:OPEN', async () => {
    await roomService.create({ ...baseCreate, visibility: 'public' });
    expect(api.post).toHaveBeenCalledWith(
      '/rooms',
      expect.objectContaining({ isPrivate: false, roomType: 'OPEN' }),
    );
  });

  it('SOCIAL → POST /rooms with isPrivate:false, roomType:SOCIAL (keeps follow-gate path)', async () => {
    await roomService.create({ ...baseCreate, visibility: 'social' });
    expect(api.post).toHaveBeenCalledWith(
      '/rooms',
      expect.objectContaining({ isPrivate: false, roomType: 'SOCIAL' }),
    );
  });

  it('CLOSED/private → POST /rooms with isPrivate:true, roomType:CLOSED', async () => {
    await roomService.create({ ...baseCreate, visibility: 'closed' });
    expect(api.post).toHaveBeenCalledWith(
      '/rooms',
      expect.objectContaining({ isPrivate: true, roomType: 'CLOSED' }),
    );
  });

  it('trims the title and defaults chatEnabled=true, recordingEnabled=false', async () => {
    await roomService.create({ ...baseCreate, title: '  Spaced  ' });
    expect(api.post).toHaveBeenCalledWith(
      '/rooms',
      expect.objectContaining({ title: 'Spaced', chatEnabled: true, recordingEnabled: false }),
    );
  });

  it('rejects an empty/whitespace title before calling the API', async () => {
    await expect(roomService.create({ ...baseCreate, title: '   ' })).rejects.toThrow(
      'Title is required',
    );
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('roomService — in-room moderation routes', () => {
  it('raise hand → POST /rooms/:id/raise-hand', async () => {
    await roomService.raiseHand('r1');
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/raise-hand');
  });

  it('lower hand → DELETE /rooms/:id/raise-hand', async () => {
    await roomService.lowerHand('r1');
    expect(api.delete).toHaveBeenCalledWith('/rooms/r1/raise-hand');
  });

  it('mute SELF → PATCH /rooms/:id/mute { isMuted } (no userId)', async () => {
    const res = await roomService.setMute('r1', true);
    expect(api.patch).toHaveBeenCalledWith('/rooms/r1/mute', { isMuted: true });
    expect(res).toEqual({ isMuted: true });
  });

  it('mute a SINGLE person → PATCH /rooms/:id/mute { isMuted:true, userId }', async () => {
    await roomService.setMute('r1', true, 'u2');
    expect(api.patch).toHaveBeenCalledWith('/rooms/r1/mute', { isMuted: true, userId: 'u2' });
  });

  it('UNMUTE → PATCH /rooms/:id/mute { isMuted:false, userId }', async () => {
    await roomService.setMute('r1', false, 'u2');
    expect(api.patch).toHaveBeenCalledWith('/rooms/r1/mute', { isMuted: false, userId: 'u2' });
  });

  it('mute ALL (default) → POST /rooms/:id/mute-all { includeHost:false }', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { mutedCount: 3 } } });
    const res = await roomService.muteAll('r1');
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/mute-all', { includeHost: false });
    expect(res).toEqual({ mutedCount: 3 });
  });

  it('mute ALL incl. host → POST /rooms/:id/mute-all { includeHost:true }', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { mutedCount: 4 } } });
    await roomService.muteAll('r1', true);
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/mute-all', { includeHost: true });
  });

  it('promote to speaker (invite-to-speak) → PATCH /rooms/:id/role { userId, role:SPEAKER }', async () => {
    await roomService.setRole('r1', 'u2', 'SPEAKER');
    expect(api.patch).toHaveBeenCalledWith('/rooms/r1/role', { userId: 'u2', role: 'SPEAKER' });
  });

  it('remove from stage (back to audience) → PATCH /rooms/:id/role { role:LISTENER }', async () => {
    await roomService.setRole('r1', 'u2', 'LISTENER');
    expect(api.patch).toHaveBeenCalledWith('/rooms/r1/role', { userId: 'u2', role: 'LISTENER' });
  });

  it('add people (invite to room) → POST /rooms/:id/invite { userIds }', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { invitedCount: 2 } } });
    const res = await roomService.invite('r1', ['a', 'b']);
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/invite', { userIds: ['a', 'b'] });
    expect(res).toEqual({ invitedCount: 2 });
  });

  it('kick → POST /rooms/:id/kick { userId, banMinutes }', async () => {
    const res = await roomService.kick('r1', 'u2', { banMinutes: 30 });
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/kick', { userId: 'u2', banMinutes: 30 });
    expect(res).toEqual({ kicked: true });
  });

  it('join / leave → POST /rooms/:id/join and /leave', async () => {
    await roomService.join('r1');
    await roomService.leave('r1');
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/join');
    expect(api.post).toHaveBeenCalledWith('/rooms/r1/leave');
  });
});

describe('roomService.ping — REGRESSION: must hit canonical /rooms/:id/ping/:userId', () => {
  it('POSTs the canonical room-scoped path (both ids in the path, no body)', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { pinged: true } } });
    const res = await roomService.ping('targetUser', 'roomX');
    expect(api.post).toHaveBeenCalledWith('/rooms/roomX/ping/targetUser');
    expect(res).toEqual({ pinged: true });
  });

  it('does NOT call the removed /users/:id/ping alias (would 404)', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { pinged: true } } });
    await roomService.ping('targetUser', 'roomX');
    const url = api.post.mock.calls[0][0] as string;
    expect(url).not.toMatch(/^\/users\//);
    expect(url).toMatch(/^\/rooms\/[^/]+\/ping\/[^/]+$/);
  });
});
