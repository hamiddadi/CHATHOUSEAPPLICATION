import { io, type Socket } from 'socket.io-client';
import { env } from '../../../config/env';
import { tokenStorage } from '../../../features/auth/services/tokenStorage';

let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;

/**
 * Returns a connected Socket.IO client, or `null` if realtime is disabled
 * (env.REALTIME_ENABLED === false) — callers then fall back to mock data.
 *
 * Idempotent: concurrent calls share the same connection promise.
 */
export const getSocket = async (): Promise<Socket | null> => {
  if (!env.REALTIME_ENABLED) return null;
  if (socket?.connected) return socket;
  if (connecting) return connecting;

  connecting = (async () => {
    const session = await tokenStorage.get();
    const s = io(env.WS_BASE_URL, {
      transports: ['websocket'],
      auth: { token: session?.accessToken ?? '' },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    socket = s;
    return s;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
};

export const disconnectSocket = (): void => {
  socket?.disconnect();
  socket = null;
};
