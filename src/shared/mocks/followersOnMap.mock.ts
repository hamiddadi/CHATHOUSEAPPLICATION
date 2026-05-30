import type { FollowerOnMap } from '../types/domain';
import { pickUser as basePickUser } from './_helpers';

const DEFAULT_LAT = 14.7167;
const DEFAULT_LNG = -17.4677;

const pickUser = (idx: number): ReturnType<typeof basePickUser> =>
  basePickUser(idx, 'MOCK_USER_SUMMARIES is empty.');

/**
 * Mock followers spread around a default Dakar centroid.
 * `jitter()` yields small +/- deltas so markers don't overlap in demo mode.
 */
const jitter = (base: number, seed: number): number => base + Math.sin(seed * 12.9898) * 0.01;

export const MOCK_FOLLOWERS_ON_MAP: readonly FollowerOnMap[] = [
  {
    ...pickUser(0),
    location: {
      latitude: jitter(DEFAULT_LAT, 1),
      longitude: jitter(DEFAULT_LNG, 2),
      updatedAt: new Date().toISOString(),
    },
    presence: 'online',
    liveRoomId: 'r1',
    liveRoomTitle: 'Scaling to 10M users',
    lastSeenMinutesAgo: 0,
  },
  {
    ...pickUser(1),
    location: {
      latitude: jitter(DEFAULT_LAT, 3),
      longitude: jitter(DEFAULT_LNG, 4),
      updatedAt: new Date().toISOString(),
    },
    presence: 'online',
    liveRoomId: null,
    liveRoomTitle: null,
    lastSeenMinutesAgo: 0,
  },
  {
    ...pickUser(2),
    location: {
      latitude: jitter(DEFAULT_LAT, 5),
      longitude: jitter(DEFAULT_LNG, 6),
      updatedAt: new Date().toISOString(),
    },
    presence: 'recently_active',
    liveRoomId: null,
    liveRoomTitle: null,
    lastSeenMinutesAgo: 24,
  },
  {
    ...pickUser(3),
    location: {
      latitude: jitter(DEFAULT_LAT, 7),
      longitude: jitter(DEFAULT_LNG, 8),
      updatedAt: new Date().toISOString(),
    },
    presence: 'online',
    liveRoomId: 'r2',
    liveRoomTitle: 'The Death of Minimalism',
    lastSeenMinutesAgo: 0,
  },
  {
    ...pickUser(4),
    location: {
      latitude: jitter(DEFAULT_LAT, 9),
      longitude: jitter(DEFAULT_LNG, 10),
      updatedAt: new Date().toISOString(),
    },
    presence: 'recently_active',
    liveRoomId: null,
    liveRoomTitle: null,
    lastSeenMinutesAgo: 48,
  },
];

export const DEFAULT_MAP_CENTER = {
  latitude: DEFAULT_LAT,
  longitude: DEFAULT_LNG,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};
