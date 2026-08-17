import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Room } from '../../../shared/types/domain';
import { roomService } from '../services/roomService';
import { roomKeys } from './useRooms';
import { useRoomMembership } from './useRoomMembership';

jest.mock('../services/roomService', () => ({
  roomService: { join: jest.fn(), leave: jest.fn() },
}));

const mockJoin = roomService.join as jest.MockedFunction<typeof roomService.join>;
const mockLeave = roomService.leave as jest.MockedFunction<typeof roomService.leave>;

const joinedRoom = (id: string): Room => ({
  id,
  title: 'Joined room',
  description: null,
  category: 'tech',
  categoryEmoji: '💻',
  visibility: 'public',
  houseId: null,
  houseName: null,
  hostId: 'host-1',
  speakers: [],
  listeners: [{ id: 'me', username: 'me', displayName: 'Me', avatarUrl: null }],
  speakersCount: 0,
  listenersCount: 1,
  participantCount: 1,
  totalAttendees: 1,
  isLocked: false,
  isLive: true,
  isRecording: false,
  chatEnabled: true,
  chatVisibility: 'ALL',
  startedAt: '2026-01-01T00:00:00.000Z',
  scheduledFor: null,
});
const joinedResult = (id: string, changed: boolean | null = true) => ({
  room: joinedRoom(id),
  changed,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useRoomMembership', () => {
  let client: QueryClient;
  let wrapper: React.FC<React.PropsWithChildren>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLeave.mockResolvedValue({ left: true });
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  });

  afterEach(() => {
    client.clear();
  });

  it('stays joining until REST succeeds, then caches the post-join room first', async () => {
    const join = deferred<Room>();
    mockJoin.mockReturnValueOnce(join.promise.then(room => ({ room, changed: true })));
    const { result } = renderHook(() => useRoomMembership('room-1'), { wrapper });

    expect(result.current.status).toBe('joining');
    expect(client.getQueryData(roomKeys.detail('room-1'))).toBeUndefined();

    act(() => join.resolve(joinedRoom('room-1')));

    await waitFor(() => expect(result.current.status).toBe('joined'));
    expect(client.getQueryData(roomKeys.detail('room-1'))).toEqual(joinedRoom('room-1'));
  });

  it('surfaces an offline failure and retries only when requested', async () => {
    mockJoin
      .mockRejectedValueOnce({
        kind: 'network',
        message: "Impossible d'atteindre le serveur.",
      })
      .mockResolvedValueOnce(joinedResult('room-1'));

    const { result } = renderHook(() => useRoomMembership('room-1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatchObject({ kind: 'network' });
    expect(mockJoin).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('joined'));
    expect(mockJoin).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale join response after navigating to another room', async () => {
    const stale = deferred<Room>();
    mockJoin
      .mockReturnValueOnce(stale.promise.then(room => ({ room, changed: true })))
      .mockResolvedValueOnce(joinedResult('room-2'));
    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string }) => useRoomMembership(roomId),
      { initialProps: { roomId: 'room-1' }, wrapper },
    );

    rerender({ roomId: 'room-2' });
    expect(result.current.status).toBe('joining');
    await waitFor(() => expect(result.current.status).toBe('joined'));
    act(() => stale.resolve(joinedRoom('room-1')));

    expect(client.getQueryData(roomKeys.detail('room-1'))).toBeUndefined();
    expect(client.getQueryData(roomKeys.detail('room-2'))).toEqual(joinedRoom('room-2'));
    await waitFor(() => expect(mockLeave).toHaveBeenCalledWith('room-1'));
  });

  it('compensates a join that succeeds after the screen unmounts', async () => {
    const late = deferred<Room>();
    mockJoin.mockReturnValueOnce(late.promise.then(room => ({ room, changed: true })));
    const { unmount } = renderHook(() => useRoomMembership('room-late'), { wrapper });

    unmount();
    act(() => late.resolve(joinedRoom('room-late')));

    await waitFor(() => expect(mockLeave).toHaveBeenCalledWith('room-late'));
    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(roomKeys.detail('room-late'))).toBeUndefined();
  });

  it('finishes late cleanup before a same-room remount joins again', async () => {
    const late = deferred<Room>();
    const leave = deferred<{ left: true }>();
    mockJoin
      .mockReturnValueOnce(late.promise.then(room => ({ room, changed: true })))
      .mockResolvedValueOnce(joinedResult('room-1'));
    mockLeave.mockReturnValueOnce(leave.promise);

    const first = renderHook(() => useRoomMembership('room-1'), { wrapper });
    first.unmount();
    const second = renderHook(() => useRoomMembership('room-1'), { wrapper });

    act(() => late.resolve(joinedRoom('room-1')));
    await waitFor(() => expect(mockLeave).toHaveBeenCalledWith('room-1'));
    expect(mockJoin).toHaveBeenCalledTimes(1);

    act(() => leave.resolve({ left: true }));
    await waitFor(() => expect(second.result.current.status).toBe('joined'));
    expect(mockJoin).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(roomKeys.detail('room-1'))).toEqual(joinedRoom('room-1'));

    second.unmount();
  });

  it('does not leave when an abandoned join fails', async () => {
    const late = deferred<Room>();
    mockJoin.mockReturnValueOnce(late.promise.then(room => ({ room, changed: true })));
    const { unmount } = renderHook(() => useRoomMembership('room-failed'), { wrapper });

    unmount();
    act(() => late.reject(new Error('offline')));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockLeave).not.toHaveBeenCalled();
  });

  it.each([
    ['an already-active membership', false],
    ['a legacy response without changed', null],
  ] as const)('does not compensate %s after unmount', async (_label, changed) => {
    const late = deferred<Room>();
    mockJoin.mockReturnValueOnce(late.promise.then(room => ({ room, changed })));
    const { unmount } = renderHook(() => useRoomMembership('room-existing'), { wrapper });

    unmount();
    act(() => late.resolve(joinedRoom('room-existing')));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockLeave).not.toHaveBeenCalled();
  });
});
