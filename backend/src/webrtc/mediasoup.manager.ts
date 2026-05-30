/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  MEDIA_CODECS,
  numWorkersToSpawn,
  webRtcTransportOptions,
  workerSettings,
} from '../config/mediasoup';

// Mediasoup's worker is a native child process. The npm package is in
// optionalDependencies so the rest of the API still boots when the C++
// build failed at install time (e.g. Windows dev hosts without VS Build
// Tools). All public functions below early-return when `isReady()` is false.

export type ProducerCallback = (info: ProducerInfo) => void;

export interface ProducerInfo {
  producerId: string;
  roomId: string;
  userId: string;
  kind: 'audio' | 'video';
}

let mediasoup: any | null = null;
const workers: any[] = [];
const routersByRoom = new Map<string, any>();
const transportsById = new Map<string, any>();
const transportRoomById = new Map<string, string>();
const producersById = new Map<string, any>();
// Per-room: producerId → { userId, kind } — source of truth for late-joiner
// discovery (`rtc:list-producers`) and for cleanup on room end.
const producersByRoom = new Map<string, Map<string, { userId: string; kind: 'audio' | 'video' }>>();

let onProducerAdded: ProducerCallback | null = null;
let onProducerClosed: ProducerCallback | null = null;

let nextWorkerIdx = 0;
let ready = false;

const loadMediasoup = (): any | null => {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return require('mediasoup');
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch (err) {
    logger.warn('mediasoup not available (native build missing). RTC features disabled.', {
      err: err instanceof Error ? err.message : err,
    });
    return null;
  }
};

export const initMediasoup = async (): Promise<boolean> => {
  if (!env.MEDIASOUP_ENABLED) {
    logger.info('mediasoup disabled via env (MEDIASOUP_ENABLED=false)');
    return false;
  }
  mediasoup = loadMediasoup();
  if (!mediasoup) return false;

  const n = numWorkersToSpawn();
  for (let i = 0; i < n; i++) {
    const worker = await mediasoup.createWorker(workerSettings);
    worker.on('died', () => {
      logger.error(`mediasoup worker ${worker.pid} died — exiting for supervisor restart`);
      process.exit(1);
    });
    workers.push(worker);
  }
  ready = true;
  logger.info(`mediasoup ready with ${workers.length} worker(s)`);
  return true;
};

export const isReady = (): boolean => ready;

/**
 * Register broadcast hooks. The socket layer provides one hook for newly
 * added producers and one for closed producers; the manager invokes them
 * so the transport logic stays free of `io` / `socket` references.
 */
export const onProducerEvents = (hooks: {
  onAdded: ProducerCallback;
  onClosed: ProducerCallback;
}): void => {
  onProducerAdded = hooks.onAdded;
  onProducerClosed = hooks.onClosed;
};

const pickWorker = (): any => {
  const w = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return w;
};

export const getOrCreateRouter = async (roomId: string): Promise<any> => {
  let router = routersByRoom.get(roomId);
  if (router) return router;
  const worker = pickWorker();
  router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  routersByRoom.set(roomId, router);
  return router;
};

/**
 * Fully tear down a room's SFU state. Called when the host ends the room;
 * closing the router cascades into all its transports/producers/consumers.
 */
export const closeRoom = async (roomId: string): Promise<void> => {
  const router = routersByRoom.get(roomId);
  if (!router) return;
  router.close();
  routersByRoom.delete(roomId);

  // Purge transports belonging to this room.
  for (const [tid, rid] of transportRoomById.entries()) {
    if (rid === roomId) {
      transportRoomById.delete(tid);
      transportsById.delete(tid);
    }
  }

  // Fire per-producer close hooks so the socket layer can broadcast.
  const roomProducers = producersByRoom.get(roomId);
  if (roomProducers) {
    for (const [producerId, info] of roomProducers.entries()) {
      producersById.delete(producerId);
      onProducerClosed?.({ producerId, roomId, userId: info.userId, kind: info.kind });
    }
    producersByRoom.delete(roomId);
  }
};

export const getRtpCapabilities = async (roomId: string): Promise<unknown> => {
  const router = await getOrCreateRouter(roomId);
  return router.rtpCapabilities;
};

/**
 * Reverse lookup: given a transport id, return the room it was created in.
 * Used by the rtc handler to revalidate authorisation just before produce
 * (the transport remembers its room, so the client can't cross-room).
 */
export const getTransportRoomId = (transportId: string): string | undefined =>
  transportRoomById.get(transportId);

export const createWebRtcTransport = async (roomId: string) => {
  const router = await getOrCreateRouter(roomId);
  const transport = await router.createWebRtcTransport(webRtcTransportOptions);
  transportsById.set(transport.id, transport);
  transportRoomById.set(transport.id, roomId);
  transport.on('dtlsstatechange', (state: string) => {
    if (state === 'closed') {
      transportsById.delete(transport.id);
      transportRoomById.delete(transport.id);
    }
  });
  return {
    id: transport.id as string,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
};

export const connectTransport = async (
  transportId: string,
  dtlsParameters: unknown,
): Promise<void> => {
  const transport = transportsById.get(transportId);
  if (!transport) throw new Error('TRANSPORT_NOT_FOUND');
  await transport.connect({ dtlsParameters });
};

export const produce = async (
  transportId: string,
  kind: 'audio' | 'video',
  rtpParameters: unknown,
  userId: string,
): Promise<string> => {
  const transport = transportsById.get(transportId);
  if (!transport) throw new Error('TRANSPORT_NOT_FOUND');
  const roomId = transportRoomById.get(transportId);
  if (!roomId) throw new Error('TRANSPORT_NOT_FOUND');

  const producer = await transport.produce({
    kind,
    rtpParameters,
    appData: { userId, roomId },
  });
  producersById.set(producer.id, producer);

  let roomMap = producersByRoom.get(roomId);
  if (!roomMap) {
    roomMap = new Map();
    producersByRoom.set(roomId, roomMap);
  }
  roomMap.set(producer.id, { userId, kind });

  const info: ProducerInfo = { producerId: producer.id, roomId, userId, kind };
  onProducerAdded?.(info);

  const cleanup = (): void => {
    producersById.delete(producer.id);
    const rm = producersByRoom.get(roomId);
    rm?.delete(producer.id);
    if (rm && rm.size === 0) producersByRoom.delete(roomId);
    onProducerClosed?.(info);
  };
  producer.on('transportclose', cleanup);
  producer.on('close', cleanup);

  return producer.id as string;
};

export const consume = async (
  roomId: string,
  consumerTransportId: string,
  producerId: string,
  rtpCapabilities: unknown,
) => {
  const router = routersByRoom.get(roomId);
  if (!router) throw new Error('ROUTER_NOT_FOUND');
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('CANNOT_CONSUME');
  }
  const transport = transportsById.get(consumerTransportId);
  if (!transport) throw new Error('TRANSPORT_NOT_FOUND');
  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true,
  });
  consumer.on('transportclose', () => undefined);
  consumer.on('producerclose', () => undefined);
  return {
    id: consumer.id as string,
    producerId,
    kind: consumer.kind as string,
    rtpParameters: consumer.rtpParameters,
  };
};

export const resumeConsumer = async (consumerId: string): Promise<void> => {
  // Consumers are short-lived and not tracked across calls; we rely on the
  // client-side Consumer object for mutation. This function intentionally
  // does nothing server-side — keep for API symmetry with the spec.
  void consumerId;
};

/**
 * Close every producer owned by `userId` in `roomId`. Cascading close on the
 * Producer fires the transportclose/close handlers registered in `produce()`,
 * which in turn emit `onProducerClosed` so the socket layer broadcasts
 * `rtc:producer-closed`. Idempotent — safe to call on leave and on disconnect.
 */
export const closeProducersForUserInRoom = (roomId: string, userId: string): number => {
  const roomMap = producersByRoom.get(roomId);
  if (!roomMap) return 0;
  let closed = 0;
  for (const [producerId, info] of Array.from(roomMap.entries())) {
    if (info.userId !== userId) continue;
    const producer = producersById.get(producerId);
    if (producer) {
      try {
        producer.close();
        closed += 1;
      } catch (err) {
        logger.warn('producer.close failed', { err });
      }
    }
  }
  return closed;
};

/**
 * Close every producer owned by `userId` across every room (used on socket
 * disconnect — we don't always know which rooms they were in).
 */
export const closeAllProducersForUser = (userId: string): number => {
  let closed = 0;
  for (const roomId of Array.from(producersByRoom.keys())) {
    closed += closeProducersForUserInRoom(roomId, userId);
  }
  return closed;
};

/**
 * List every active producer in a room, optionally excluding a given user
 * (so a late-joiner skips their own producer if any). Used by the client
 * immediately after `rtc:get-rtp-capabilities` to discover peers already
 * publishing audio.
 */
export const listProducersForRoom = (roomId: string, excludeUserId?: string): ProducerInfo[] => {
  const roomMap = producersByRoom.get(roomId);
  if (!roomMap) return [];
  const out: ProducerInfo[] = [];
  for (const [producerId, info] of roomMap.entries()) {
    if (excludeUserId && info.userId === excludeUserId) continue;
    out.push({ producerId, roomId, userId: info.userId, kind: info.kind });
  }
  return out;
};

export const shutdownMediasoup = async (): Promise<void> => {
  for (const router of routersByRoom.values()) {
    router.close();
  }
  routersByRoom.clear();
  transportsById.clear();
  transportRoomById.clear();
  producersById.clear();
  producersByRoom.clear();
  onProducerAdded = null;
  onProducerClosed = null;
  for (const w of workers) {
    try {
      w.close();
    } catch (err) {
      logger.warn('worker close error', { err });
    }
  }
  workers.length = 0;
  ready = false;
};
