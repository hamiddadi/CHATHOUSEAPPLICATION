/**
 * Chathouse — Database Seed Script
 * =================================
 * Populates the Postgres database with realistic test data.
 *
 * Run: npx tsx scripts/seed.ts
 * Requires: DATABASE_URL set in .env (or environment)
 *
 * FK insertion order:
 *   1. Users (+ admin + test accounts)
 *   2. Follows
 *   3. Clubs → ClubMembers
 *   4. Rooms
 *   5. Participants
 *   6. Messages (DMs)
 *   7. RoomChatMessages
 *   8. RoomReactions
 *   9. RoomHandRaises
 *  10. Notifications
 */

/* eslint-disable no-console */
import 'dotenv/config';
import type {
  Prisma,
  Role,
  RoomType,
  NotificationType,
  ClubPrivacy,
  ClubMemberRole,
} from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// Faker — lazy dynamic import so the seed still compiles even if @faker-js
// is not yet installed (it's devDependencies-only).
// ---------------------------------------------------------------------------
const loadFaker = async () => {
  try {
    const mod = await import('@faker-js/faker');
    return mod.faker;
  } catch {
    console.error('❌ @faker-js/faker not installed. Run: npm i -D @faker-js/faker');
    process.exit(1);
  }
};

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BCRYPT_ROUNDS = 10;
const hashPassword = (plain: string) => bcrypt.hashSync(plain, BCRYPT_ROUNDS);

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const pickN = <T>(arr: T[], n: number): T[] => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(n, shuffled.length));
};
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randBool = (pct = 0.5) => Math.random() < pct;

const CATEGORIES = ['tech', 'design', 'crypto', 'ai', 'music', 'business', 'health'] as const;
const CATEGORY_EMOJIS: Record<string, string> = {
  tech: '💻',
  design: '🎨',
  crypto: '🪙',
  ai: '🤖',
  music: '🎵',
  business: '💼',
  health: '🏥',
};
const ROOM_TYPES: RoomType[] = ['OPEN', 'SOCIAL', 'CLOSED'];
const NOTIF_TYPES: NotificationType[] = [
  'ROOM_INVITE',
  'NEW_FOLLOWER',
  'ROOM_STARTED',
  'SPEAKER_REQUEST',
  'MENTION',
  'CLUB_INVITE',
  'WAVE',
  'HAND_ACCEPTED',
  'RSVP_REMINDER',
  'NEW_MESSAGE',
];
const EMOJIS = ['👍', '❤️', '🔥', '😂', '👏', '🙌', '💯', '🎉'];

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------
async function main() {
  const faker = await loadFaker();
  console.log('\n🌱 CHATHOUSE SEED — starting…\n');

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Users (500 normal + 1 admin + 5 test)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('👥 Creating 506 users…');
  const usersData: Parameters<typeof prisma.user.create>[0]['data'][] = [];

  // Admin account
  usersData.push({
    username: 'admin',
    email: 'admin@chathouse.dev',
    passwordHash: hashPassword('Admin1234!'),
    displayName: 'Admin Chathouse',
    firstName: 'Admin',
    lastName: 'Chathouse',
    avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Admin',
    bio: 'Platform administrator',
    isOnline: true,
    hasCompletedOnboarding: true,
    interests: ['tech', 'business'],
    followerCount: 0,
    followingCount: 0,
  });

  // 5 Test accounts
  for (let i = 1; i <= 5; i++) {
    usersData.push({
      username: `testuser${i}`,
      email: `test${i}@chathouse.dev`,
      passwordHash: hashPassword('Test1234!'),
      displayName: `Test User ${i}`,
      firstName: `Test`,
      lastName: `User${i}`,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=test${i}`,
      bio: faker.lorem.sentence(),
      isOnline: randBool(0.6),
      hasCompletedOnboarding: true,
      interests: pickN([...CATEGORIES], randInt(1, 4)),
      followerCount: 0,
      followingCount: 0,
    });
  }

  // 500 Random users
  const usedUsernames = new Set([
    'admin',
    ...Array.from({ length: 5 }, (_, i) => `testuser${i + 1}`),
  ]);
  const usedEmails = new Set([
    'admin@chathouse.dev',
    ...Array.from({ length: 5 }, (_, i) => `test${i + 1}@chathouse.dev`),
  ]);

  for (let i = 0; i < 500; i++) {
    let uname: string;
    do {
      uname = faker.internet
        .username()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20);
    } while (usedUsernames.has(uname) || uname.length < 3);
    usedUsernames.add(uname);

    let email: string;
    do {
      email = faker.internet.email().toLowerCase();
    } while (usedEmails.has(email));
    usedEmails.add(email);

    usersData.push({
      username: uname,
      email,
      passwordHash: hashPassword('Password1!'),
      displayName: faker.person.fullName(),
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      avatarUrl: faker.image.avatar(),
      bio: randBool(0.7) ? faker.lorem.sentences(randInt(1, 3)) : null,
      twitter: randBool(0.3) ? faker.internet.username().slice(0, 15) : null,
      instagram: randBool(0.3) ? faker.internet.username().slice(0, 15) : null,
      phoneNumber: randBool(0.4) ? faker.phone.number({ style: 'international' }) : null,
      isOnline: randBool(0.25),
      isVisible: randBool(0.85),
      latitude: randBool(0.3) ? faker.location.latitude() : null,
      longitude: randBool(0.3) ? faker.location.longitude() : null,
      lastSeenAt: randBool(0.6) ? faker.date.recent({ days: 7 }) : null,
      hasCompletedOnboarding: randBool(0.9),
      interests: pickN([...CATEGORIES], randInt(0, 5)),
      followerCount: 0,
      followingCount: 0,
    });
  }

  // Insert all users in a transaction
  const createdUsers = await prisma.$transaction(
    usersData.map(data => prisma.user.create({ data })),
  );
  const userIds = createdUsers.map(u => u.id);
  console.log(`  ✅ ${createdUsers.length} users created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: Follows (each user follows 5–80 random others, no self-follow)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('👥 Creating follow relationships…');
  const followPairs = new Set<string>();
  const followsData: { followerId: string; followingId: string }[] = [];

  for (const uid of userIds) {
    const count = randInt(5, 80);
    const targets = pickN(
      userIds.filter(id => id !== uid),
      count,
    );
    for (const target of targets) {
      const key = `${uid}:${target}`;
      if (!followPairs.has(key)) {
        followPairs.add(key);
        followsData.push({ followerId: uid, followingId: target });
      }
    }
  }

  // Batch insert follows in chunks to avoid PG param limit
  const CHUNK = 500;
  for (let i = 0; i < followsData.length; i += CHUNK) {
    const chunk = followsData.slice(i, i + CHUNK);
    await prisma.follow.createMany({ data: chunk, skipDuplicates: true });
  }
  console.log(`  ✅ ${followsData.length} follow relationships created`);

  // Update denormalized follower/following counts
  console.log('  📊 Updating follower/following counts…');
  for (const uid of userIds) {
    const followerCount = followsData.filter(f => f.followingId === uid).length;
    const followingCount = followsData.filter(f => f.followerId === uid).length;
    await prisma.user.update({
      where: { id: uid },
      data: { followerCount, followingCount },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: Clubs (20 clubs)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('🏠 Creating 20 clubs…');
  const clubNames = new Set<string>();
  const clubsData: Parameters<typeof prisma.club.create>[0]['data'][] = [];

  for (let i = 0; i < 20; i++) {
    let name: string;
    do {
      name = faker.company.name().slice(0, 45);
    } while (clubNames.has(name));
    clubNames.add(name);

    const cat = pick([...CATEGORIES]);
    clubsData.push({
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 55),
      description: faker.lorem.paragraph(),
      iconUrl: faker.image.avatar(),
      privacy: pick(['OPEN', 'SOCIAL', 'PRIVATE'] as ClubPrivacy[]),
      category: cat,
      categoryEmoji: CATEGORY_EMOJIS[cat] ?? '🏠',
      ownerId: pick(userIds),
      memberCount: 1,
    });
  }

  const createdClubs = await prisma.$transaction(
    clubsData.map(data => prisma.club.create({ data })),
  );
  console.log(`  ✅ ${createdClubs.length} clubs created`);

  // Club members
  console.log('  👥 Adding club members…');
  const clubMemberPairs = new Set<string>();
  let totalClubMembers = 0;

  for (const club of createdClubs) {
    const memberCount = randInt(5, 50);
    const candidates = userIds.filter(id => id !== club.ownerId);
    const members = pickN(candidates, memberCount);

    // Owner is always ADMIN
    clubMemberPairs.add(`${club.id}:${club.ownerId}`);
    await prisma.clubMember.create({
      data: { clubId: club.id, userId: club.ownerId, role: 'ADMIN' },
    });

    for (const uid of members) {
      const key = `${club.id}:${uid}`;
      if (clubMemberPairs.has(key)) continue;
      clubMemberPairs.add(key);

      await prisma.clubMember.create({
        data: {
          clubId: club.id,
          userId: uid,
          role: pick(['MEMBER', 'MEMBER', 'MEMBER', 'MODERATOR'] as ClubMemberRole[]),
        },
      });
      totalClubMembers++;
    }

    await prisma.club.update({
      where: { id: club.id },
      data: { memberCount: members.length + 1 },
    });
  }
  console.log(`  ✅ ${totalClubMembers} club memberships created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: Rooms (100 rooms)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('🎙️ Creating 100 rooms…');
  const roomsCreated: { id: string; hostId: string; isLive: boolean }[] = [];

  for (let i = 0; i < 100; i++) {
    const category = pick([...CATEGORIES]);
    const isLive = randBool(0.65);
    const isScheduled = !isLive && randBool(0.5);
    const hostId = pick(userIds);
    const roomType = pick(ROOM_TYPES);
    const clubId = randBool(0.3) ? pick(createdClubs).id : null;

    const room = await prisma.room.create({
      data: {
        title: faker.lorem.sentence({ min: 3, max: 8 }).slice(0, 60),
        description: faker.lorem.paragraph(),
        hostId,
        clubId,
        isLive,
        isPrivate: roomType === 'CLOSED',
        roomType,
        chatEnabled: randBool(0.8),
        recordingEnabled: randBool(0.15),
        topic: category,
        topics: pickN([...CATEGORIES], randInt(1, 3)),
        maxSpeakers: randInt(5, 20),
        scheduledFor: isScheduled ? faker.date.future({ years: 0.1 }) : null,
        endedAt: !isLive && !isScheduled ? faker.date.recent({ days: 3 }) : null,
        participantCount: 0,
      },
    });
    roomsCreated.push({ id: room.id, hostId, isLive });
  }
  console.log(`  ✅ ${roomsCreated.length} rooms created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: Participants (2–50 per live room)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('🎧 Adding participants to rooms…');
  const participantPairs = new Set<string>();
  let totalParticipants = 0;

  for (const room of roomsCreated) {
    if (!room.isLive) continue;

    const count = randInt(2, 50);
    const candidates = userIds.filter(id => id !== room.hostId);
    const members = pickN(candidates, count - 1); // -1 because host is always a participant

    // Host as HOST role
    const hostKey = `${room.hostId}:${room.id}`;
    if (!participantPairs.has(hostKey)) {
      participantPairs.add(hostKey);
      await prisma.participant.create({
        data: {
          userId: room.hostId,
          roomId: room.id,
          role: 'HOST',
          isMuted: false,
        },
      });
      totalParticipants++;
    }

    for (const uid of members) {
      const key = `${uid}:${room.id}`;
      if (participantPairs.has(key)) continue;
      participantPairs.add(key);

      const role = pick([
        'SPEAKER',
        'SPEAKER',
        'LISTENER',
        'LISTENER',
        'LISTENER',
        'MODERATOR',
      ] as Role[]);
      await prisma.participant.create({
        data: {
          userId: uid,
          roomId: room.id,
          role,
          isMuted: randBool(0.4),
        },
      });
      totalParticipants++;
    }

    // Update denormalized count
    await prisma.room.update({
      where: { id: room.id },
      data: { participantCount: members.length + 1 },
    });
  }
  console.log(`  ✅ ${totalParticipants} participants added`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 6: Messages (DMs — 500 random DMs)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('💬 Creating 500 DM messages…');
  const msgsData: Prisma.MessageCreateManyInput[] = [];

  for (let i = 0; i < 500; i++) {
    const senderId = pick(userIds);
    let receiverId: string;
    do {
      receiverId = pick(userIds);
    } while (receiverId === senderId);

    msgsData.push({
      content: faker.lorem.sentence(),
      senderId,
      receiverId,
      isRead: randBool(0.7),
      createdAt: faker.date.recent({ days: 14 }),
    });
  }
  await prisma.message.createMany({ data: msgsData });
  console.log(`  ✅ ${msgsData.length} DMs created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 7: Room Chat Messages (5–20 per live room)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('💬 Creating room chat messages…');
  let totalRoomMessages = 0;
  const liveRooms = roomsCreated.filter(r => r.isLive);

  for (const room of liveRooms) {
    const count = randInt(5, 20);
    for (let i = 0; i < count; i++) {
      await prisma.roomChatMessage.create({
        data: {
          roomId: room.id,
          userId: pick(userIds),
          content: faker.lorem.sentence().slice(0, 480),
          createdAt: faker.date.recent({ days: 1 }),
        },
      });
      totalRoomMessages++;
    }
  }
  console.log(`  ✅ ${totalRoomMessages} room chat messages created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 8: Room Reactions (emojis)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('🔥 Creating room reactions…');
  let totalReactions = 0;

  for (const room of liveRooms.slice(0, 30)) {
    const count = randInt(5, 30);
    for (let i = 0; i < count; i++) {
      await prisma.roomReaction.create({
        data: {
          roomId: room.id,
          userId: pick(userIds),
          emoji: pick(EMOJIS),
          createdAt: faker.date.recent({ days: 1 }),
        },
      });
      totalReactions++;
    }
  }
  console.log(`  ✅ ${totalReactions} reactions created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 9: Hand Raises
  // ═══════════════════════════════════════════════════════════════════════
  console.log('✋ Creating hand raises…');
  const handRaisePairs = new Set<string>();
  let totalHandRaises = 0;

  for (const room of liveRooms.slice(0, 20)) {
    const count = randInt(1, 5);
    for (let i = 0; i < count; i++) {
      const uid = pick(userIds);
      const key = `${room.id}:${uid}`;
      if (handRaisePairs.has(key)) continue;
      handRaisePairs.add(key);

      await prisma.roomHandRaise.create({
        data: {
          roomId: room.id,
          userId: uid,
        },
      });
      totalHandRaises++;
    }
  }
  console.log(`  ✅ ${totalHandRaises} hand raises created`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 10: Notifications (200)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('🔔 Creating 200 notifications…');
  const notifData: Prisma.NotificationCreateManyInput[] = [];

  for (let i = 0; i < 200; i++) {
    const recipientId = pick(userIds);
    let actorId: string;
    do {
      actorId = pick(userIds);
    } while (actorId === recipientId);

    const type = pick(NOTIF_TYPES);
    const titles: Record<NotificationType, string> = {
      ROOM_INVITE: 'Room Invitation',
      NEW_FOLLOWER: 'New Follower',
      ROOM_STARTED: 'Room Live',
      SPEAKER_REQUEST: 'Speaker Request',
      MENTION: 'You were mentioned',
      CLUB_INVITE: 'Club Invitation',
      WAVE: '👋 Wave',
      HAND_ACCEPTED: 'Promoted to Speaker',
      RSVP_REMINDER: 'Event Starting Soon',
      NEW_MESSAGE: 'New Message',
    };

    notifData.push({
      userId: recipientId,
      actorId,
      type,
      title: titles[type],
      body: faker.lorem.sentence(),
      isRead: randBool(0.7),
      targetId: randBool(0.5) ? (pick(liveRooms)?.id ?? null) : null,
      targetType:
        type === 'ROOM_INVITE' || type === 'ROOM_STARTED'
          ? 'room'
          : type === 'CLUB_INVITE'
            ? 'club'
            : 'user',
      createdAt: faker.date.recent({ days: 30 }),
    });
  }
  await prisma.notification.createMany({ data: notifData });
  console.log(`  ✅ ${notifData.length} notifications created`);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('  🎉 SEED COMPLETE — Summary');
  console.log('══════════════════════════════════════════');
  console.log(`  Users:              ${createdUsers.length}`);
  console.log(`  Follows:            ${followsData.length}`);
  console.log(`  Clubs:              ${createdClubs.length}`);
  console.log(`  Club Members:       ${totalClubMembers}`);
  console.log(`  Rooms:              ${roomsCreated.length}`);
  console.log(`  Participants:       ${totalParticipants}`);
  console.log(`  DMs:                ${msgsData.length}`);
  console.log(`  Room Chat Messages: ${totalRoomMessages}`);
  console.log(`  Room Reactions:     ${totalReactions}`);
  console.log(`  Hand Raises:        ${totalHandRaises}`);
  console.log(`  Notifications:      ${notifData.length}`);
  console.log('══════════════════════════════════════════');
  console.log('\n  🔑 Admin:  admin@chathouse.dev / Admin1234!');
  console.log('  🔑 Tests:  test1…5@chathouse.dev / Test1234!');
  console.log('');
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
