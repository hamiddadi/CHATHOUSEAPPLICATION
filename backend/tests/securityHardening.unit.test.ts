import jwt from 'jsonwebtoken';
import {
  legacyStableMediaUrlFor,
  materializePrivateMediaUrls,
  mediaIdFromPrivateUrl,
  mediaReferenceFor,
} from '../src/modules/media/media-url';
import { decodeAudio, decodeAvatar } from '../src/modules/upload/upload.service';
import {
  listUsersSchema,
  listRoomsSchema as adminListRoomsSchema,
} from '../src/modules/admin/admin.schema';
import { listRoomsSchema } from '../src/modules/rooms/rooms.schema';
import {
  contactDiscoverySchema,
  setUsernameSchema,
  usernameAvailabilitySchema,
} from '../src/modules/users/users.schema';
import { verifyAccessToken } from '../src/utils/jwt';
import { auditLogService } from '../src/modules/admin/auditLog.service';

describe('security hardening boundaries', () => {
  it('parses query booleans strictly and rejects truthy garbage', () => {
    expect(listRoomsSchema.parse({ live: 'false', clubs: '0' })).toMatchObject({
      live: false,
      clubs: false,
    });
    expect(listRoomsSchema.parse({ live: 'true', clubs: '1' })).toMatchObject({
      live: true,
      clubs: true,
    });
    expect(listUsersSchema.parse({ suspended: 'false' }).suspended).toBe(false);
    expect(adminListRoomsSchema.parse({ live: '0' }).live).toBe(false);
    expect(() => listRoomsSchema.parse({ live: 'yes' })).toThrow();
  });

  it('canonicalizes usernames and requires a real boolean for contact consent', () => {
    expect(setUsernameSchema.parse({ username: 'Alice_42' }).username).toBe('alice_42');
    expect(usernameAvailabilitySchema.parse({ q: 'BOB' }).q).toBe('bob');
    expect(contactDiscoverySchema.parse({ allowContactDiscovery: false })).toEqual({
      allowContactDiscovery: false,
    });
    expect(() => contactDiscoverySchema.parse({ allowContactDiscovery: 'false' })).toThrow();
  });

  it('keeps a non-routable media reference durable and refreshes its capability over time', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T10:00:00Z'));
    const reference = mediaReferenceFor('avatar-1', 'https://api.example.test');
    const first = materializePrivateMediaUrls({ avatarUrl: reference }).avatarUrl;
    expect(reference).toMatch(/\/media-ref\/avatar-1\//);
    expect(first).toMatch(/\/media\/avatar-1\/\d{10}\//);

    jest.setSystemTime(new Date('2026-08-13T10:20:00Z'));
    const second = materializePrivateMediaUrls({ avatarUrl: reference }).avatarUrl;
    expect(second).not.toBe(first);
    expect(mediaIdFromPrivateUrl(reference)).toBe('avatar-1');
    jest.useRealTimers();
  });

  it('never renews a routable bearer found in arbitrary response text', () => {
    const legacy = legacyStableMediaUrlFor('voice-1', 'https://api.example.test');
    const materialized = materializePrivateMediaUrls({ audioUrl: legacy }).audioUrl;
    expect(materialized).toBe(legacy);
  });

  it('rejects access tokens that omit tokenVersion even with the correct HMAC secret', () => {
    const token = jwt.sign({ sub: 'user-1', typ: 'access' }, process.env.JWT_ACCESS_SECRET!, {
      algorithm: 'HS256',
      issuer: 'chathouse-api',
      audience: 'chathouse-app',
      expiresIn: '5m',
    });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('rejects image headers whose declared dimensions are unsafe', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    Buffer.from('IHDR').copy(png, 12);
    png.writeUInt32BE(50_000, 16);
    png.writeUInt32BE(50_000, 20);
    expect(() => decodeAvatar({ base64: png.toString('base64'), mime: 'image/png' })).toThrow(
      'Image dimensions are invalid or unsafe',
    );
  });

  it('rejects a truncated WAV that only spoofs RIFF/WAVE magic bytes', () => {
    const spoof = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE');
    expect(() => decodeAudio({ base64: spoof.toString('base64'), mime: 'audio/wav' })).toThrow(
      'Voice note content does not match its MIME type',
    );
  });

  it('fails closed when a privileged audit row cannot be persisted', async () => {
    const failure = new Error('audit unavailable');
    const client = {
      auditLog: { create: jest.fn().mockRejectedValue(failure) },
    };
    await expect(
      auditLogService.record({ actorId: 'admin-1', action: 'GODMODE_ACCESS' }, client as never),
    ).rejects.toBe(failure);
  });
});
