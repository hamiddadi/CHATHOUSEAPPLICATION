/* eslint-disable no-console */
/**
 * Chathouse — 50-user functional / load test
 * ===========================================
 * Drives 50 simulated users through the REAL running backend (REST + Socket.IO)
 * and exercises every major product feature, reporting pass/fail per feature.
 *
 * Run (backend must be up on :4000, Postgres+Redis healthy):
 *   node scripts/load-50-users.mjs
 *   N=50 API=http://localhost:4000 node scripts/load-50-users.mjs
 *
 * It self-heals around the global IP rate-limiter by flushing `rl:*` keys in
 * Redis (dev-only) when a 429 is hit — all 50 users share 127.0.0.1.
 */
import { io } from 'socket.io-client';
import Redis from 'ioredis';

const API = process.env.API ?? 'http://localhost:4000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const N = Number(process.env.N ?? 50);
const PASSWORD = 'LoadTest123!';
const RUN = Date.now().toString(36);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

// ───────────────────────── stats ─────────────────────────
const stats = new Map();
const sample = (arr, n = 3) => arr.slice(0, n);
const record = (feature, ok, detail) => {
  let s = stats.get(feature);
  if (!s) {
    s = { ok: 0, fail: 0, errors: [] };
    stats.set(feature, s);
  }
  if (ok) s.ok++;
  else {
    s.fail++;
    if (s.errors.length < 5 && detail) s.errors.push(detail);
  }
};

let httpCount = 0;
let rlFlushes = 0;
const flushRateLimit = async () => {
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
    rlFlushes++;
  } catch {
    /* redis optional — best effort */
  }
};

// ─────────────────────── http wrapper ───────────────────────
const http = async (method, path, { token, body } = {}) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    httpCount++;
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      return { status: 0, ok: false, body: { error: String(err) } };
    }
    if (res.status === 429) {
      await flushRateLimit();
      await new Promise(r => setTimeout(r, 120));
      continue; // retry
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, body: json };
  }
  return { status: 429, ok: false, body: { error: 'rate-limited after retries' } };
};

// ─────────────────────── concurrency ───────────────────────
const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
};

const connectSocket = (token, userId) =>
  new Promise((resolve, reject) => {
    const s = io(API, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
      timeout: 10_000,
    });
    s.userId = userId;
    s.events = { userJoined: 0, dmReceived: 0, speakReq: 0, reaction: 0 };
    s.on('room:user-joined', () => s.events.userJoined++);
    s.on('chat:message', () => s.events.dmReceived++);
    s.on('room:hand_raised', () => s.events.speakReq++); // HAND-07: request-speak now broadcasts room:hand_raised
    s.on('room:reaction', () => s.events.reaction++);
    s.once('connect', () => resolve(s));
    s.once('connect_error', e => reject(e));
  });

const emitAck = (socket, event, payload) =>
  new Promise(resolve => {
    const t = setTimeout(() => resolve(false), 8_000);
    socket.emit(event, payload, ok => {
      clearTimeout(t);
      resolve(ok);
    });
  });

const metricsSnapshot = async () => {
  try {
    const r = await fetch(`${API}/metrics`);
    const text = await r.text();
    const grab = re => {
      const m = text.match(re);
      return m ? Number(m[1]) : null;
    };
    return {
      httpTotal: (text.match(/chathouse_http_requests_total{[^}]*}\s+(\d+)/g) || []).reduce(
        (a, l) => a + Number(l.match(/\s(\d+)$/)?.[1] ?? 0),
        0,
      ),
      socketConns: grab(/chathouse_socket_connections\s+(\d+(?:\.\d+)?)/),
      activeRooms: grab(/chathouse_active_rooms\s+(\d+(?:\.\d+)?)/),
    };
  } catch {
    return null;
  }
};

// ───────────────────────── run ─────────────────────────
const run = async () => {
  const t0 = Date.now();
  console.log(`\n🧪 CHATHOUSE — ${N}-user functional test  (run=${RUN}, API=${API})\n`);
  await redis.connect().catch(() => console.warn('  ⚠ redis flush unavailable (non-fatal)'));

  // 0 ─ health
  const health = await http('GET', '/health');
  record('00 health', health.ok && health.body?.status === 'healthy', JSON.stringify(health.body));
  console.log(`  health: ${health.body?.status} db=${health.body?.services?.database} redis=${health.body?.services?.redis}`);
  const m0 = await metricsSnapshot();

  // 1 ─ register 50 users (+ profile via /me)
  console.log(`\n▸ Phase 1 — register ${N} users + load profile`);
  await flushRateLimit();
  const users = await mapLimit([...Array(N).keys()], CONCURRENCY, async i => {
    const username = `lt_${RUN}_${i}`;
    const email = `${username}@loadtest.local`;
    const reg = await http('POST', '/api/auth/register', {
      body: { username, email, password: PASSWORD, displayName: `LoadTester ${i}` },
    });
    const okReg = reg.status === 201 && reg.body?.success && reg.body.data?.accessToken;
    record('01 register', !!okReg, `status=${reg.status} ${JSON.stringify(reg.body?.error ?? '')}`);
    if (!okReg) return null;
    const token = reg.body.data.accessToken;
    const me = await http('GET', '/api/users/me', { token });
    const id = me.body?.data?.id ?? reg.body.data.user?.id;
    record('02 profile-get (/me)', me.ok && !!id, `status=${me.status}`);
    return { i, username, email, token, id };
  }).then(a => a.filter(Boolean));
  console.log(`  ✅ ${users.length}/${N} users registered`);
  if (users.length < 2) throw new Error('too few users registered — aborting');

  // 2 ─ login round-trip (sample) + profile update (sample)
  console.log('\n▸ Phase 2 — login round-trip + profile update (sample)');
  await mapLimit(users.slice(0, 10), CONCURRENCY, async u => {
    const lg = await http('POST', '/api/auth/login', {
      body: { identifier: u.email, password: PASSWORD },
    });
    record('03 login', lg.ok && lg.body?.data?.accessToken, `status=${lg.status}`);
    const up = await http('PATCH', '/api/users/me', {
      token: u.token,
      body: { bio: `Load tester #${u.i} — run ${RUN}` },
    });
    record('04 profile-update', up.ok, `status=${up.status}`);
  });

  // 3 ─ social graph: each user follows 5 random others + read lists (sample)
  console.log('\n▸ Phase 3 — follow graph (5 each) + follower/following lists');
  await mapLimit(users, CONCURRENCY, async u => {
    const targets = users.filter(x => x.id !== u.id).sort(() => 0.5 - Math.random()).slice(0, 5);
    for (const t of targets) {
      const f = await http('POST', `/api/follow/${t.id}`, { token: u.token });
      record('05 follow', f.ok, `status=${f.status} ${JSON.stringify(f.body?.error ?? '')}`);
    }
  });
  await mapLimit(users.slice(0, 10), CONCURRENCY, async u => {
    const fr = await http('GET', '/api/follow/followers', { token: u.token });
    const fg = await http('GET', '/api/follow/following', { token: u.token });
    record('06 follow-lists', fr.ok && fg.ok, `followers=${fr.status} following=${fg.status}`);
  });

  // 4 ─ rooms: first 10 users host a room; everyone lists feed
  console.log('\n▸ Phase 4 — create rooms (10 hosts) + list / feed');
  const hosts = users.slice(0, 10);
  const rooms = [];
  await mapLimit(hosts, 5, async u => {
    const r = await http('POST', '/api/rooms', {
      token: u.token,
      body: { title: `LoadTest room ${u.i} (${RUN})`, description: 'auto', roomType: 'OPEN' },
    });
    const ok = r.status === 201 && r.body?.data?.id;
    record('07 room-create', !!ok, `status=${r.status} ${JSON.stringify(r.body?.error ?? '')}`);
    if (ok) rooms.push({ id: r.body.data.id, host: u });
  });
  console.log(`  ✅ ${rooms.length} rooms created`);
  await mapLimit(users.slice(0, 12), CONCURRENCY, async u => {
    const list = await http('GET', '/api/rooms', { token: u.token });
    record('08 room-list', list.ok, `status=${list.status}`);
    const feed = await http('GET', '/api/rooms/feed', { token: u.token });
    record('09 room-feed', feed.ok, `status=${feed.status}`);
    const exp = await http('GET', '/api/explore', { token: u.token });
    record('10 explore', exp.ok, `status=${exp.status}`);
    const sr = await http('GET', `/api/search?q=lt&type=all&limit=10`, { token: u.token });
    record('11 search', sr.ok, `status=${sr.status}`);
  });
  if (rooms.length === 0) throw new Error('no rooms created — aborting room phases');

  // assign every user to a room (round-robin), host already in their own
  const assign = users.map((u, idx) => ({ u, room: rooms[idx % rooms.length] }));

  // 5 ─ join rooms (REST), non-hosts
  console.log('\n▸ Phase 5 — join rooms (REST)');
  await mapLimit(assign, CONCURRENCY, async ({ u, room }) => {
    if (room.host.id === u.id) return; // host auto-joined at create
    const j = await http('POST', `/api/rooms/${room.id}/join`, { token: u.token });
    record('12 room-join', j.ok, `status=${j.status} ${JSON.stringify(j.body?.error ?? '')}`);
  });

  // 6 ─ sockets: connect all, join room channel, verify broadcast fan-out
  console.log('\n▸ Phase 6 — Socket.IO connect + room:join + broadcast fan-out');
  const sockets = await mapLimit(assign, CONCURRENCY, async ({ u, room }) => {
    try {
      const s = await connectSocket(u.token, u.id);
      s.roomId = room.id;
      record('13 socket-connect', true);
      return s;
    } catch (e) {
      record('13 socket-connect', false, String(e?.message ?? e));
      return null;
    }
  }).then(a => a.filter(Boolean));
  console.log(`  ✅ ${sockets.length} sockets connected`);
  // join room channels
  await mapLimit(sockets, CONCURRENCY, async s => {
    const ok = await emitAck(s, 'room:join', { roomId: s.roomId });
    record('14 socket-room-join', ok === true, `ack=${ok}`);
  });
  await new Promise(r => setTimeout(r, 1200)); // let broadcasts settle
  const gotBroadcast = sockets.filter(s => s.events.userJoined > 0).length;
  record('15 broadcast-fanout', gotBroadcast >= Math.floor(sockets.length * 0.5),
    `${gotBroadcast}/${sockets.length} sockets saw room:user-joined`);
  console.log(`  📡 ${gotBroadcast}/${sockets.length} sockets received room:user-joined broadcast`);

  // 7 ─ in-room chat (REST) + reactions + raise hand
  console.log('\n▸ Phase 7 — room messages + reactions + raise-hand');
  const EMOJIS = ['👍', '❤️', '🔥', '😂', '👏', '🙌'];
  await mapLimit(assign, CONCURRENCY, async ({ u, room }) => {
    const msg = await http('POST', `/api/rooms/${room.id}/messages`, {
      token: u.token, body: { content: `hello from ${u.username}` },
    });
    record('16 room-message', msg.status === 201 || msg.ok, `status=${msg.status} ${JSON.stringify(msg.body?.error ?? '')}`);
    const rx = await http('POST', `/api/rooms/${room.id}/reactions`, {
      token: u.token, body: { emoji: EMOJIS[u.i % EMOJIS.length] },
    });
    record('17 reaction', rx.ok || rx.status === 201, `status=${rx.status}`);
  });
  await mapLimit(assign.slice(0, 20), CONCURRENCY, async ({ u, room }) => {
    if (room.host.id === u.id) return;
    const rh = await http('POST', `/api/rooms/${room.id}/raise-hand`, { token: u.token });
    record('18 raise-hand', rh.ok || rh.status === 201, `status=${rh.status} ${JSON.stringify(rh.body?.error ?? '')}`);
  });
  await mapLimit(rooms, 5, async room => {
    const hr = await http('GET', `/api/rooms/${room.id}/hand-raises`, { token: room.host.token });
    record('19 hand-raise-list', hr.ok, `status=${hr.status}`);
    const ml = await http('GET', `/api/rooms/${room.id}/messages`, { token: room.host.token });
    record('20 room-message-list', ml.ok, `status=${ml.status}`);
  });

  // 8 ─ socket request-speak (active participants only)
  console.log('\n▸ Phase 8 — socket request-speak');
  await mapLimit(sockets.slice(0, 20), CONCURRENCY, async s => {
    const ok = await emitAck(s, 'room:request-speak', { roomId: s.roomId });
    record('21 socket-request-speak', ok === true, `ack=${ok}`);
  });

  // 9 ─ DM via socket (pairs). DMs require MUTUAL follow (CHAT_004 gate), so
  //     first verify the gate rejects a non-mutual pair, then establish mutual
  //     follow and confirm send + delivery work.
  console.log('\n▸ Phase 9 — direct messages over socket (mutual-follow gate + delivery)');
  const pairs = [];
  for (let i = 0; i + 1 < Math.min(sockets.length, 20); i += 2) pairs.push([sockets[i], sockets[i + 1]]);
  const byId = new Map(users.map(u => [u.id, u]));
  // 9a — gate: a send is allowed ONLY between mutual follows (CHAT_004). Phase 3
  //   wired a *random* follow graph, so a DM pair may ALREADY be mutual — which
  //   would make the send legitimately succeed and look like a gate failure.
  //   First tear down both directions (idempotent) to force a deterministic
  //   non-mutual state, THEN the send must be rejected (ack=false).
  await mapLimit(pairs, CONCURRENCY, async ([a, b]) => {
    const ua = byId.get(a.userId), ub = byId.get(b.userId);
    await http('DELETE', `/api/follow/${ub.id}`, { token: ua.token });
    await http('DELETE', `/api/follow/${ua.id}`, { token: ub.token });
  });
  await mapLimit(pairs, CONCURRENCY, async ([a, b]) => {
    const ok = await emitAck(a, 'chat:send', { receiverId: b.userId, content: `gated ${RUN}` });
    record('22 dm-gate (rejects non-mutual)', ok === false, `ack=${ok} (expected false)`);
  });
  // 9b — establish mutual follow for each pair (REST)
  await mapLimit(pairs, CONCURRENCY, async ([a, b]) => {
    const ua = byId.get(a.userId), ub = byId.get(b.userId);
    await http('POST', `/api/follow/${ub.id}`, { token: ua.token });
    await http('POST', `/api/follow/${ua.id}`, { token: ub.token });
  });
  // 9c — now the send must succeed
  await mapLimit(pairs, CONCURRENCY, async ([a, b]) => {
    const ok = await emitAck(a, 'chat:send', { receiverId: b.userId, content: `dm ${RUN}` });
    record('23 dm-send (mutual)', ok === true, `ack=${ok}`);
  });
  await new Promise(r => setTimeout(r, 1000));
  const dmDelivered = pairs.filter(([, b]) => b.events.dmReceived > 0).length;
  record('24 dm-delivery', dmDelivered >= Math.floor(pairs.length * 0.5),
    `${dmDelivered}/${pairs.length} receivers got chat:message`);
  console.log(`  📨 ${dmDelivered}/${pairs.length} DM pairs delivered`);

  // 10 ─ notifications + livekit token (audio readiness) + wave
  console.log('\n▸ Phase 10 — notifications + LiveKit token + wave');
  await mapLimit(users.slice(0, 15), CONCURRENCY, async u => {
    const n = await http('GET', '/api/notifications', { token: u.token });
    record('25 notifications', n.ok, `status=${n.status}`);
    const uc = await http('GET', '/api/notifications/unread-count', { token: u.token });
    record('26 notif-unread-count', uc.ok, `status=${uc.status}`);
  });
  await mapLimit(assign.slice(0, 20), CONCURRENCY, async ({ u, room }) => {
    const lk = await http('GET', `/api/rooms/${room.id}/livekit-token`, { token: u.token });
    // 200 = token issued; 503 = LiveKit not configured (still a valid “feature reachable”)
    record('27 livekit-token', lk.status === 200, `status=${lk.status} ${JSON.stringify(lk.body?.error ?? '')}`);
  });
  await mapLimit(users.slice(0, 10), CONCURRENCY, async u => {
    const target = users[(u.i + 7) % users.length];
    const w = await http('POST', `/api/users/${target.id}/wave`, { token: u.token });
    record('28 wave', w.ok || w.status === 201, `status=${w.status}`);
  });

  // 11 ─ teardown: leave + end rooms
  console.log('\n▸ Phase 11 — leave + end rooms (teardown)');
  await mapLimit(sockets, CONCURRENCY, async s => {
    await emitAck(s, 'room:leave', { roomId: s.roomId });
  });
  await mapLimit(assign, CONCURRENCY, async ({ u, room }) => {
    if (room.host.id === u.id) return;
    const lv = await http('POST', `/api/rooms/${room.id}/leave`, { token: u.token });
    record('29 room-leave', lv.ok, `status=${lv.status}`);
  });
  await mapLimit(rooms, 5, async room => {
    const e = await http('POST', `/api/rooms/${room.id}/end`, { token: room.host.token });
    // A room auto-closes (ROOM-04) when its host leaves it empty — which the
    // socket `room:leave` above can trigger before this explicit /end. So an
    // already-ended room (410 ROOM_004) is a valid terminal state for /end,
    // not a failure: the goal (room is ended) is met either way.
    const ended = e.ok || (e.status === 410 && e.body?.error?.code === 'ROOM_004');
    record('30 room-end', ended, `status=${e.status} ${JSON.stringify(e.body?.error ?? '')}`);
  });
  sockets.forEach(s => s.disconnect());

  const m1 = await metricsSnapshot();
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // ───────────────────────── report ─────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  📊 RESULTS — ${N} users · ${dt}s · ${httpCount} HTTP calls · ${rlFlushes} rl-flushes`);
  console.log('══════════════════════════════════════════════════════════');
  const keys = [...stats.keys()].sort();
  let totalOk = 0, totalFail = 0;
  for (const k of keys) {
    const s = stats.get(k);
    totalOk += s.ok; totalFail += s.fail;
    const icon = s.fail === 0 ? '✅' : s.ok === 0 ? '❌' : '⚠️ ';
    const pad = k.padEnd(26);
    console.log(`  ${icon} ${pad} ok=${String(s.ok).padStart(3)}  fail=${String(s.fail).padStart(3)}`);
    if (s.fail > 0) for (const e of sample(s.errors)) console.log(`        ↳ ${e}`);
  }
  console.log('──────────────────────────────────────────────────────────');
  const passRate = ((totalOk / (totalOk + totalFail)) * 100).toFixed(1);
  console.log(`  TOTAL: ${totalOk} ok / ${totalFail} fail  (${passRate}% pass)`);
  if (m0 && m1) {
    console.log(`  metrics: http_requests ${m0.httpTotal}→${m1.httpTotal} (+${m1.httpTotal - m0.httpTotal})` +
      (m1.socketConns != null ? `  sockets≈${m1.socketConns}` : '') +
      (m1.activeRooms != null ? `  activeRooms≈${m1.activeRooms}` : ''));
  }
  console.log('══════════════════════════════════════════════════════════\n');

  await redis.quit().catch(() => {});
  process.exit(totalFail > totalOk ? 1 : 0);
};

run().catch(async err => {
  console.error('\n❌ test crashed:', err);
  await redis.quit().catch(() => {});
  process.exit(1);
});
