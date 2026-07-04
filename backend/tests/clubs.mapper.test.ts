/**
 * Unit tests for the clubs `toApi` mapper. Pure mapping — no Postgres/Redis.
 *
 * Focus: the membership signal (`isJoinedByMe`, role-bearing roster entry) MUST
 * be decoupled from the truncated `club.members` slice. `clubInclude.take`
 * bounds the roster at 100 rows, so a member past the 100th oldest is absent
 * from `club.members`. Deriving membership from that slice (the regression this
 * fixes) would wrongly lock such a member out of their own PRIVATE roster and
 * hide their admin/moderator CTAs. `toApi` now takes an explicit, authoritative
 * `viewerMembership` and guarantees the viewer's own row is present in `members`.
 */
import type { ClubMemberRole, ClubPrivacy } from '@prisma/client';
import { toApi } from '../src/modules/clubs/clubs.mapper';
import type { ClubWithRelations, ViewerMembership } from '../src/modules/clubs/clubs.mapper';

const makeUser = (id: string) => ({
  id,
  username: `u_${id}`,
  displayName: `User ${id}`,
  avatarUrl: null,
  bio: null,
});

const makeMember = (
  userId: string,
  role: ClubMemberRole = 'MEMBER',
  joinedAt = new Date('2026-01-01T00:00:00.000Z'),
): ClubWithRelations['members'][number] => ({
  id: `cm_${userId}`,
  clubId: 'club_1',
  userId,
  role,
  joinedAt,
  user: makeUser(userId),
});

const makeClub = (
  privacy: ClubPrivacy,
  members: ClubWithRelations['members'],
  ownerId: string,
  memberCount = members.length,
): ClubWithRelations => ({
  id: 'club_1',
  name: 'Test House',
  slug: 'test-house',
  description: null,
  rules: null,
  category: 'general',
  categoryEmoji: '🏠',
  iconUrl: null,
  privacy,
  ownerId,
  memberCount,
  isVerified: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  members,
  _count: { members: memberCount, rooms: 0 },
});

const membershipFor = (
  userId: string,
  role: ClubMemberRole = 'MEMBER',
  joinedAt = new Date('2026-06-01T00:00:00.000Z'),
): ViewerMembership => ({
  role,
  joinedAt,
  user: makeUser(userId),
});

describe('toApi — membership signal decoupled from the truncated roster', () => {
  it('PRIVATE house, viewer is a member beyond the take window (absent from club.members): isJoinedByMe true, roster visible, viewer present', () => {
    // Simulate the >100 case at unit scale: `club.members` is the truncated
    // slice and does NOT contain the viewer, but the authoritative membership
    // lookup found their row.
    const ownerId = 'owner';
    const viewerId = 'viewer_101';
    const slice = [makeMember(ownerId, 'ADMIN'), makeMember('m2'), makeMember('m3')];
    const club = makeClub('PRIVATE', slice, ownerId, 101);

    const api = toApi(club, viewerId, membershipFor(viewerId, 'MEMBER'));

    // Membership is derived from the explicit signal, not the slice.
    expect(api.isJoinedByMe).toBe(true);
    // canSeeMembers is true (member of a PRIVATE house) → roster is served.
    expect(api.members.length).toBeGreaterThan(0);
    // The viewer's own row is merged in even though it was outside the slice,
    // so the FE role-derivation (scanning members for the viewer) works.
    const self = api.members.find(m => m.id === viewerId);
    expect(self).toBeDefined();
    expect(self?.role).toBe('member');
    // The aggregate count stays authoritative regardless of the slice size.
    expect(api.membersCount).toBe(101);
  });

  it('preserves the viewer admin role from the explicit signal for a member beyond the window', () => {
    const ownerId = 'owner';
    const viewerId = 'admin_101';
    const slice = [makeMember(ownerId, 'ADMIN'), makeMember('m2')];
    const club = makeClub('PRIVATE', slice, ownerId, 150);

    const api = toApi(club, viewerId, membershipFor(viewerId, 'ADMIN'));

    const self = api.members.find(m => m.id === viewerId);
    expect(self?.role).toBe('admin');
    expect(api.isJoinedByMe).toBe(true);
  });

  it('does NOT duplicate the viewer row when they are already within the slice', () => {
    const ownerId = 'owner';
    const viewerId = 'viewer_in_slice';
    const slice = [makeMember(ownerId, 'ADMIN'), makeMember(viewerId, 'MODERATOR')];
    const club = makeClub('PRIVATE', slice, ownerId, 2);

    const api = toApi(club, viewerId, membershipFor(viewerId, 'MODERATOR'));

    const own = api.members.filter(m => m.id === viewerId);
    expect(own).toHaveLength(1);
    expect(own[0]?.role).toBe('moderator');
    expect(api.isJoinedByMe).toBe(true);
  });

  it('non-regression — non-member of a PRIVATE house: empty roster, count preserved, not joined', () => {
    const ownerId = 'owner';
    const outsiderId = 'outsider';
    const slice = [makeMember(ownerId, 'ADMIN'), makeMember('m2'), makeMember('m3')];
    const club = makeClub('PRIVATE', slice, ownerId, 3);

    const api = toApi(club, outsiderId, null);

    expect(api.isJoinedByMe).toBe(false);
    expect(api.members).toHaveLength(0);
    expect(api.membersCount).toBe(3);
  });

  it('non-regression — normal member within the window (<100): roster served unchanged, no synthetic row', () => {
    const ownerId = 'owner';
    const viewerId = 'm2';
    const slice = [makeMember(ownerId, 'ADMIN'), makeMember(viewerId), makeMember('m3')];
    const club = makeClub('PRIVATE', slice, ownerId, 3);

    const api = toApi(club, viewerId, membershipFor(viewerId, 'MEMBER'));

    expect(api.isJoinedByMe).toBe(true);
    // Exactly the slice, no duplication / no injected row.
    expect(api.members).toHaveLength(3);
    expect(api.members.map(m => m.id).sort()).toEqual([ownerId, 'm3', viewerId].sort());
  });

  it('non-regression — OPEN house stays fully public to a non-member', () => {
    const ownerId = 'owner';
    const outsiderId = 'outsider';
    const slice = [makeMember(ownerId, 'ADMIN'), makeMember('m2')];
    const club = makeClub('OPEN', slice, ownerId, 2);

    const api = toApi(club, outsiderId, null);

    expect(api.isJoinedByMe).toBe(false);
    expect(api.members).toHaveLength(2);
    expect(api.members.map(m => m.id).sort()).toEqual([ownerId, 'm2'].sort());
  });

  it('SOCIAL house roster is public to a non-member (discoverable), not joined', () => {
    const ownerId = 'owner';
    const outsiderId = 'outsider';
    const slice = [makeMember(ownerId, 'ADMIN')];
    const club = makeClub('SOCIAL', slice, ownerId, 1);

    const api = toApi(club, outsiderId, null);

    expect(api.isJoinedByMe).toBe(false);
    expect(api.members).toHaveLength(1);
  });
});
