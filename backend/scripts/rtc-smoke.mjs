/* eslint-disable no-console */
import { io } from 'socket.io-client';

const API = process.env.API ?? 'http://localhost:4000';
const USER = `rtc_${Date.now()}`;
const PASSWORD = 'smoke-password-123';

const register = async () => {
  const r = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, email: `${USER}@test.local`, password: PASSWORD }),
  });
  const body = await r.json();
  if (!body.success) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return body.data.accessToken;
};

const createRoom = async token => {
  const r = await fetch(`${API}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'RTC smoke' }),
  });
  const body = await r.json();
  if (!body.success) throw new Error(`create room failed: ${JSON.stringify(body)}`);
  return body.data.id;
};

const connect = token =>
  new Promise((resolve, reject) => {
    const s = io(API, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });

const emitWithAck = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 10_000);
    socket.emit(event, payload, res => {
      clearTimeout(t);
      resolve(res);
    });
  });

const run = async () => {
  console.log(`[smoke] register ${USER}`);
  const token = await register();

  console.log('[smoke] create room (auto-joins host as participant)');
  const roomId = await createRoom(token);
  console.log('   → roomId:', roomId);

  console.log('[smoke] socket.io connect');
  const socket = await connect(token);

  console.log('[smoke] rtc:get-rtp-capabilities');
  const caps = await emitWithAck(socket, 'rtc:get-rtp-capabilities', { roomId });
  const codecs = caps.data?.rtpCapabilities?.codecs?.map(c => c.mimeType).join(', ');
  console.log('   →', caps.ok, 'codecs:', codecs, 'iceServers:', caps.data?.iceServers?.length);

  console.log('[smoke] rtc:create-transport');
  const t = await emitWithAck(socket, 'rtc:create-transport', { roomId });
  console.log('   →', t.ok, 'transportId:', t.data?.id, 'iceCandidates:', t.data?.iceCandidates?.length);

  console.log('[smoke] rtc:get-rtp-capabilities on non-member room (expect NOT_A_ROOM_MEMBER)');
  const denied = await emitWithAck(socket, 'rtc:get-rtp-capabilities', {
    roomId: 'room-i-am-not-in',
  });
  console.log('   →', denied.ok, 'error:', denied.error);

  socket.disconnect();
  console.log('[smoke] done ✅');
};

run().catch(err => {
  console.error('[smoke] ❌', err);
  process.exit(1);
});
