import type { Socket } from 'socket.io';

interface PingPayload {
  t?: number;
}
type PongAck = (res: { serverTime: number; echo: number | null }) => void;

/**
 * Application-level RTT probe. The client emits `rtt:ping` with its send
 * timestamp and an ack callback; the server replies immediately so the client
 * can compute round-trip latency (`Date.now() - t`) for the socket transport —
 * Socket.IO's engine.io heartbeat is not exposed to app code. `serverTime` is
 * returned for optional one-way clock-offset estimation. Cheap enough to call
 * on any event type the client wants to time (drive a latency badge,
 * adaptive-quality decisions, etc.).
 */
export const registerLatencyHandlers = (socket: Socket): void => {
  socket.on('rtt:ping', (payload: PingPayload | undefined, ack?: PongAck) => {
    ack?.({ serverTime: Date.now(), echo: payload?.t ?? null });
  });
};
