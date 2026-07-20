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

export interface TransportOwnership {
  roomId: string;
  userId: string;
  socketId: string;
}

interface ConsumerRecord extends TransportOwnership {
  consumer: any;
  transportId: string;
}

let mediasoup: any | null = null;
const workers: any[] = [];
const routersByRoom = new Map<string, any>();
const transportsById = new Map<string, any>();
const transportOwnershipById = new Map<string, TransportOwnership>();
const producersById = new Map<string, any>();
const consumersById = new Map<string, ConsumerRecord>();
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
  for (const [tid, ownership] of transportOwnershipById.entries()) {
    if (ownership.roomId === roomId) {
      transportOwnershipById.delete(tid);
      transportsById.delete(tid);
    }
  }
  for (const [consumerId, record] of consumersById.entries()) {
    if (record.roomId === roomId) consumersById.delete(consumerId);
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
  transportOwnershipById.get(transportId)?.roomId;

export const getTransportOwnership = (transportId: string): TransportOwnership | undefined => {
  const ownership = transportOwnershipById.get(transportId);
  return ownership ? { ...ownership } : undefined;
};

const requireOwnedTransport = (
  transportId: string,
  userId: string,
  socketId: string,
  expectedRoomId?: string,
): { transport: any; ownership: TransportOwnership } => {
  const transport = transportsById.get(transportId);
  const ownership = transportOwnershipById.get(transportId);
  if (!transport || !ownership) throw new Error('TRANSPORT_NOT_FOUND');
  if (
    ownership.userId !== userId ||
    ownership.socketId !== socketId ||
    (expectedRoomId !== undefined && ownership.roomId !== expectedRoomId)
  ) {
    throw new Error('TRANSPORT_FORBIDDEN');
  }
  return { transport, ownership };
};

export const createWebRtcTransport = async (roomId: string, userId: string, socketId: string) => {
  const router = await getOrCreateRouter(roomId);
  const transport = await router.createWebRtcTransport(webRtcTransportOptions);
  transportsById.set(transport.id, transport);
  transportOwnershipById.set(transport.id, { roomId, userId, socketId });
  const cleanup = (): void => {
    transportsById.delete(transport.id);
    transportOwnershipById.delete(transport.id);
    for (const [consumerId, record] of consumersById.entries()) {
      if (record.transportId === transport.id) consumersById.delete(consumerId);
    }
  };
  transport.on('dtlsstatechange', (state: string) => {
    if (state === 'closed') {
      cleanup();
    }
  });
  transport.observer?.on('close', cleanup);
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
  userId: string,
  socketId: string,
): Promise<void> => {
  const { transport } = requireOwnedTransport(transportId, userId, socketId);
  await transport.connect({ dtlsParameters });
};

export const produce = async (
  transportId: string,
  kind: 'audio' | 'video',
  rtpParameters: unknown,
  userId: string,
  socketId: string,
): Promise<string> => {
  const { transport, ownership } = requireOwnedTransport(transportId, userId, socketId);
  const { roomId } = ownership;

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

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    const rm = producersByRoom.get(roomId);
    const wasTracked = producersById.delete(producer.id);
    const wasInRoom = rm?.delete(producer.id) ?? false;
    if (rm && rm.size === 0) producersByRoom.delete(roomId);
    // closeRoom may already have removed + broadcast this producer before a
    // delayed native close event arrives. Never fan out a duplicate close.
    if (!wasTracked && !wasInRoom) return;
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
  userId: string,
  socketId: string,
) => {
  const router = routersByRoom.get(roomId);
  if (!router) throw new Error('ROUTER_NOT_FOUND');
  const { transport } = requireOwnedTransport(consumerTransportId, userId, socketId, roomId);
  if (!producersByRoom.get(roomId)?.has(producerId)) {
    throw new Error('PRODUCER_NOT_FOUND');
  }
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('CANNOT_CONSUME');
  }
  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true,
  });
  const cleanup = (): void => {
    consumersById.delete(consumer.id);
  };
  consumersById.set(consumer.id, {
    consumer,
    roomId,
    userId,
    socketId,
    transportId: consumerTransportId,
  });
  consumer.on('transportclose', cleanup);
  consumer.on('producerclose', cleanup);
  consumer.observer?.on('close', cleanup);
  return {
    id: consumer.id as string,
    producerId,
    kind: consumer.kind as string,
    rtpParameters: consumer.rtpParameters,
  };
};

export const resumeConsumer = async (
  consumerId: string,
  userId: string,
  socketId: string,
): Promise<void> => {
  // A mediasoup consumer is created paused. The server must resume the exact
  // consumer owned by this socket after the client installs its local
  // consumer; resuming only client-side leaves the server RTP path paused.
  const record = consumersById.get(consumerId);
  if (!record) throw new Error('CONSUMER_NOT_FOUND');
  if (record.userId !== userId || record.socketId !== socketId) {
    throw new Error('CONSUMER_FORBIDDEN');
  }
  await record.consumer.resume();
};

/**
 * Close the SFU transports created by one concrete Socket.IO connection.
 * Transports are device/socket scoped, unlike account-level room membership.
 */
export const closeTransportsForSocket = (socketId: string): number => {
  let closed = 0;
  for (const [transportId, ownership] of Array.from(transportOwnershipById.entries())) {
    if (ownership.socketId !== socketId) continue;
    const transport = transportsById.get(transportId);
    transportsById.delete(transportId);
    transportOwnershipById.delete(transportId);
    try {
      transport?.close();
      closed += 1;
    } catch (err) {
      logger.warn('transport.close failed', { err, transportId, socketId });
    }
  }
  for (const [consumerId, record] of consumersById.entries()) {
    if (record.socketId === socketId) consumersById.delete(consumerId);
  }
  return closed;
};

/**
 * Close every transport for one account inside one room. Room membership is
 * account scoped, so an explicit REST/socket leave or a kick must evict all
 * of that account's devices, not only the socket that initiated the action.
 */
export const closeTransportsForUserInRoom = (roomId: string, userId: string): number => {
  let closed = 0;
  for (const [transportId, ownership] of Array.from(transportOwnershipById.entries())) {
    if (ownership.roomId !== roomId || ownership.userId !== userId) continue;
    const transport = transportsById.get(transportId);
    transportsById.delete(transportId);
    transportOwnershipById.delete(transportId);
    try {
      transport?.close();
      closed += 1;
    } catch (err) {
      logger.warn('transport.close failed', { err, transportId, roomId, userId });
    }
  }
  for (const [consumerId, record] of consumersById.entries()) {
    if (record.roomId === roomId && record.userId === userId) {
      consumersById.delete(consumerId);
    }
  }
  return closed;
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
  transportOwnershipById.clear();
  producersById.clear();
  producersByRoom.clear();
  consumersById.clear();
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
