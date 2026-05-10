/* eslint-disable no-console */
import { io } from 'socket.io-client';

const API = process.env.API ?? 'http://localhost:4000';
const PASSWORD = 'smoke-password-123';

const register = async () => {
  const u = `rtcp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const r = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, email: `${u}@test.local`, password: PASSWORD }),
  });
  const body = await r.json();
  if (!body.success) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return { id: body.data.user.id, token: body.data.accessToken };
};

const createRoom = async token => {
  const r = await fetch(`${API}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'rtc producers smoke' }),
  });
  return (await r.json()).data.id;
};

const joinRoom = async (token, roomId) => {
  await fetch(`${API}/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
};

const connect = token =>
  new Promise((resolve, reject) => {
    const s = io(API, { transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

const emitAck = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 10_000);
    socket.emit(event, payload, res => {
      clearTimeout(t);
      resolve(res);
    });
  });

const run = async () => {
  const host = await register();
  const listener = await register();
  const roomId = await createRoom(host.token);
  await joinRoom(listener.token, roomId);
  console.log('[smoke] roomId:', roomId);

  const hostSock = await connect(host.token);
  const listenerSock = await connect(listener.token);

  // Both clients subscribe to the `room:<id>` socket channel so they receive
  // the `room:ended` broadcast later.
  await emitAck(hostSock, 'room:join', { roomId });
  await emitAck(listenerSock, 'room:join', { roomId });

  console.log('[smoke] rtc:list-producers (host, empty room)');
  const empty = await emitAck(hostSock, 'rtc:list-producers', { roomId });
  console.log('   →', empty.ok, 'count:', empty.data?.length);

  console.log('[smoke] rtc:list-producers from an outsider socket');
  const outsider = await register();
  const outsiderSock = await connect(outsider.token);
  const denied = await emitAck(outsiderSock, 'rtc:list-producers', { roomId });
  console.log('   →', denied.ok, 'error:', denied.error);

  console.log('[smoke] listener subscribes to room:ended');
  const endedPromise = new Promise(resolve => listenerSock.once('room:ended', resolve));

  console.log('[smoke] host triggers room:end');
  await emitAck(hostSock, 'room:end', { roomId });

  const ended = await Promise.race([
    endedPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('room:ended not received')), 5_000)),
  ]);
  console.log('   → room:ended received:', ended);

  console.log('[smoke] rtc:list-producers after end (expect NOT_A_ROOM_MEMBER)');
  const afterEnd = await emitAck(hostSock, 'rtc:list-producers', { roomId });
  console.log('   →', afterEnd.ok, 'error:', afterEnd.error);

  hostSock.disconnect();
  listenerSock.disconnect();
  outsiderSock.disconnect();
  console.log('[smoke] done ✅');
};

run().catch(err => {
  console.error('[smoke] ❌', err);
  process.exit(1);
});
