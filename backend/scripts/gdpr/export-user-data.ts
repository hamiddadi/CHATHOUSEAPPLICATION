/**
 * RGPD Article 20 — data portability export (standalone).
 *
 * Usage:
 *   npx tsx scripts/gdpr/export-user-data.ts <userId>
 *
 * Produces a real .zip at ./exports/export-<userId>-<timestamp>.zip containing:
 *   - profil.json    the User row, with `passwordHash` stripped
 *   - messages.json  1:1 Messages (sender or receiver) + group GroupMessages (sender)
 *   - follows.json   Follow rows where the user is follower or following
 *   - audit.json     AuditLog rows where the user is actor or target
 *
 * Exits 1 with a clear message when no userId arg is given or the user is not
 * found. Serves as the basis for the authenticated GET /api/users/me/export
 * portability endpoint.
 *
 * The project ships no zip library, so this file implements a small, correct
 * zero-dependency ZIP writer using the STORE method (no compression) with
 * proper CRC-32, local file headers, a central directory, and an
 * end-of-central-directory record.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Relative path from scripts/gdpr/ up to src/config/database:
//   scripts/gdpr -> .. -> scripts -> .. -> backend root -> src/config/database
import { prisma } from '../../src/config/database';

// ──────────────────────────────────────────────────────────────────────────
// CRC-32 (IEEE 802.3 polynomial 0xEDB88320), table-driven.
// ──────────────────────────────────────────────────────────────────────────
const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buf) {
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (CRC_TABLE[idx] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// ──────────────────────────────────────────────────────────────────────────
// Minimal STORE-method ZIP writer.
// ──────────────────────────────────────────────────────────────────────────
interface ZipEntry {
  name: string;
  data: Buffer;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

/**
 * Encode a Date as a DOS date/time pair (used by both the local and central
 * headers). DOS time has 2-second resolution and a 1980 epoch.
 */
const dosDateTime = (d: Date): { date: number; time: number } => {
  const year = Math.max(1980, d.getFullYear());
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { date: date & 0xffff, time: time & 0xffff };
};

const buildZip = (entries: ZipEntry[]): Buffer => {
  const { date: dosDate, time: dosTime } = dosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // ── Local file header (30 bytes + name) ──
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6); // general purpose flag: bit 11 = UTF-8 names
    local.writeUInt16LE(0, 8); // compression method: 0 = STORE
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size (== uncompressed for STORE)
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localParts.push(local, nameBuf, data);

    // ── Central directory header (46 bytes + name) ──
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0x0800, 8); // general purpose flag: UTF-8
    central.writeUInt16LE(0, 10); // compression method: STORE
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20); // compressed size
    central.writeUInt32LE(size, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);

  // ── End of central directory record (22 bytes) ──
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // central dir records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total central dir records
  eocd.writeUInt32LE(centralDir.length, 12); // size of central directory
  eocd.writeUInt32LE(localData.length, 16); // offset of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localData, centralDir, eocd]);
};

// ──────────────────────────────────────────────────────────────────────────
// JSON serialisation: handle Date and BigInt so prisma rows round-trip.
// ──────────────────────────────────────────────────────────────────────────
const jsonBuffer = (value: unknown): Buffer =>
  Buffer.from(
    JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val), 2),
    'utf8',
  );

const main = async (): Promise<void> => {
  const userId = process.argv[2];
  if (!userId) {
    // eslint-disable-next-line no-console
    console.error('Usage: npx tsx scripts/gdpr/export-user-data.ts <userId>');
    process.exit(1);
    return;
  }

  // ── profil.json — User row minus passwordHash ──
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    // eslint-disable-next-line no-console
    console.error(`No user found with id "${userId}".`);
    process.exit(1);
    return;
  }
  // Strip the credential hash before export. Keep the rest verbatim.
  const { passwordHash: _passwordHash, ...profile } = user;

  // ── messages.json — 1:1 messages (sender or receiver) + group msgs (sender) ──
  const [directMessages, groupMessages] = await Promise.all([
    prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.groupMessage.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // ── follows.json — follower or following ──
  const follows = await prisma.follow.findMany({
    where: { OR: [{ followerId: userId }, { followingId: userId }] },
    orderBy: { createdAt: 'asc' },
  });

  // ── audit.json — actor or target ──
  const audit = await prisma.auditLog.findMany({
    where: { OR: [{ actorId: userId }, { targetUserId: userId }] },
    orderBy: { createdAt: 'asc' },
  });

  const entries: ZipEntry[] = [
    { name: 'profil.json', data: jsonBuffer(profile) },
    { name: 'messages.json', data: jsonBuffer({ directMessages, groupMessages }) },
    { name: 'follows.json', data: jsonBuffer(follows) },
    { name: 'audit.json', data: jsonBuffer(audit) },
  ];

  const zip = buildZip(entries);

  const exportsDir = resolve(process.cwd(), 'exports');
  await mkdir(exportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(exportsDir, `export-${userId}-${timestamp}.zip`);
  // Path is server-generated (fixed exports/ dir + sanitised timestamp); the
  // userId comes from a trusted operator-supplied CLI arg, not a web request.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(outPath, zip);

  // eslint-disable-next-line no-console
  console.log(`✅ Wrote export for user ${userId}:`);
  // eslint-disable-next-line no-console
  console.log(`   ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `   profil.json + messages (${directMessages.length} DM, ${groupMessages.length} group) + ` +
      `follows (${follows.length}) + audit (${audit.length})`,
  );
};

main()
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
