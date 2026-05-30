import type { Socket } from 'socket.io';
import { logger } from '../../config/logger';
import * as sfu from '../../webrtc/mediasoup.manager';
import { canPublishInRoom, isActiveRoomParticipant } from '../../webrtc/roomAuthz';
import { env } from '../../config/env';

interface RoomScoped {
  roomId: string;
}
interface ConnectPayload {
  transportId: string;
  dtlsParameters: unknown;
}
interface ProducePayload {
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: unknown;
}
interface ConsumePayload {
  roomId: string;
  consumerTransportId: string;
  producerId: string;
  rtpCapabilities: unknown;
}
interface ResumePayload {
  consumerId: string;
}

type Ack<T = unknown> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

/**
 * Register the mediasoup (`rtc:*`) events on the socket. When mediasoup is
 * not ready (disabled, native build missing) the ack always returns
 * `{ ok: false, error: 'RTC_DISABLED' }` so the client can fall back
 * gracefully without blocking.
 */
export const registerRtcHandlers = (socket: Socket): void => {
  const me = (): string => socket.data.userId as string;

  const requireMember = async (roomId: string): Promise<void> => {
    const ok = await isActiveRoomParticipant(roomId, me());
    if (!ok) throw new Error('NOT_A_ROOM_MEMBER');
  };

  const guard =
    <P, R>(name: string, fn: (p: P) => Promise<R>) =>
    async (payload: P, ack?: Ack<R>) => {
      if (!sfu.isReady()) {
        ack?.({ ok: false, error: 'RTC_DISABLED' });
        return;
      }
      try {
        const data = await fn(payload);
        ack?.({ ok: true, data });
      } catch (err) {
        logger.warn(`${name} failed`, { err });
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : 'RTC_UNKNOWN_ERROR',
        });
      }
    };

  // iceServers are returned alongside RTP capabilities so the client can
  // build its PeerConnection with the right STUN/TURN list in one round-trip.
  socket.on(
    'rtc:get-rtp-capabilities',
    guard<RoomScoped, { rtpCapabilities: unknown; iceServers: typeof env.ICE_SERVERS_JSON }>(
      'rtc:get-rtp-capabilities',
      async p => {
        await requireMember(p.roomId);
        const rtpCapabilities = await sfu.getRtpCapabilities(p.roomId);
        return { rtpCapabilities, iceServers: env.ICE_SERVERS_JSON };
      },
    ),
  );

  socket.on(
    'rtc:create-transport',
    guard<RoomScoped, unknown>('rtc:create-transport', async p => {
      await requireMember(p.roomId);
      return sfu.createWebRtcTransport(p.roomId);
    }),
  );

  socket.on(
    'rtc:connect-transport',
    guard<ConnectPayload, { connected: true }>('rtc:connect-transport', async p => {
      // Defence in depth: every other rtc:* event verifies room membership.
      // Resolve the transport's room and require the caller is a member before
      // attaching DTLS parameters, so a client guessing a transportId can't
      // sabotage a transport in a room it never joined.
      // TODO(audit): tag each transport with its ownerUserId in
      // createWebRtcTransport and re-check ownership here for full isolation.
      const roomId = sfu.getTransportRoomId(p.transportId);
      if (!roomId) throw new Error('TRANSPORT_NOT_FOUND');
      await requireMember(roomId);
      await sfu.connectTransport(p.transportId, p.dtlsParameters);
      return { connected: true };
    }),
  );

  socket.on(
    'rtc:produce',
    guard<ProducePayload, { producerId: string }>('rtc:produce', async p => {
      // Defence in depth: only HOST/MODERATOR/SPEAKER can publish audio.
      // Without this, a listener with a transport could bypass the stage
      // promotion flow and produce audio anyway.
      const roomId = sfu.getTransportRoomId(p.transportId);
      if (!roomId) throw new Error('TRANSPORT_NOT_FOUND');
      const allowed = await canPublishInRoom(roomId, me());
      if (!allowed) throw new Error('NOT_A_SPEAKER');
      const producerId = await sfu.produce(p.transportId, p.kind, p.rtpParameters, me());
      return { producerId };
    }),
  );

  socket.on(
    'rtc:consume',
    guard<ConsumePayload, unknown>('rtc:consume', async p => {
      await requireMember(p.roomId);
      return sfu.consume(p.roomId, p.consumerTransportId, p.producerId, p.rtpCapabilities);
    }),
  );

  socket.on(
    'rtc:resume-consumer',
    guard<ResumePayload, { resumed: true }>('rtc:resume-consumer', async p => {
      await sfu.resumeConsumer(p.consumerId);
      return { resumed: true };
    }),
  );

  // Discovery for late joiners: after `rtc:get-rtp-capabilities` + transport
  // setup, the client calls this to know which peers are already publishing,
  // then consumes each producer in turn.
  socket.on(
    'rtc:list-producers',
    guard<RoomScoped, sfu.ProducerInfo[]>('rtc:list-producers', async p => {
      await requireMember(p.roomId);
      return sfu.listProducersForRoom(p.roomId, me());
    }),
  );
};
