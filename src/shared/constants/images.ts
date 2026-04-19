/**
 * Real photo URLs — single source of truth.
 * Mirrors `real_images_config.json` at the repo root (external reference doc).
 *
 * Providers:
 * - randomuser.me   — real human portraits, no key, ids 0-99 for men/women
 * - picsum.photos   — seeded deterministic random photos (`/seed/{seed}/{w}/{h}`)
 * - unsplash.com    — pinned photo IDs via `images.unsplash.com/photo-{id}`
 */

const RANDOMUSER_BASE = 'https://randomuser.me/api/portraits';
const PICSUM_BASE = 'https://picsum.photos/seed';

const men = (id: number): string => `${RANDOMUSER_BASE}/men/${id}.jpg`;
const women = (id: number): string => `${RANDOMUSER_BASE}/women/${id}.jpg`;
const picsum = (seed: string, w: number, h: number): string => `${PICSUM_BASE}/${seed}/${w}/${h}`;

/* ============================================================
 * Defaults — used as fallback when no specific mapping matches
 * ========================================================== */
export const DEFAULTS = {
  avatar: men(32),
  avatarLarge: men(32),
  cover: picsum('chathouse', 800, 400),
  banner: picsum('chathouse-banner', 1080, 480),
  houseIcon: picsum('chathouse-house', 200, 200),
  background: picsum('chathouse-bg', 1080, 1920),
  roomThumb: picsum('room-default', 400, 400),
} as const;

/* ============================================================
 * 10 realistic avatars — handy for onboarding carousels,
 * invite suggestions, empty states with sample user rows, etc.
 * ========================================================== */
export const AVATARS_10: readonly string[] = [
  men(12),
  men(32),
  men(45),
  men(67),
  men(88),
  women(5),
  women(19),
  women(33),
  women(58),
  women(77),
];

/* ============================================================
 * Per-user mapping — mirrors MOCK_USER_SUMMARIES ids
 * ========================================================== */
export const USER_AVATAR_BY_ID: Readonly<Record<string, string>> = {
  'user-me': men(8),
  u1: men(12),
  u2: women(5),
  u3: men(15),
  u4: women(9),
  u5: men(33),
  u6: men(22),
  u7: women(47),
  u8: men(11),
  u9: men(3),
  u10: women(19),
  u11: men(27),
  u12: women(40),
  u13: women(44),
  u14: men(50),
  u15: women(52),
  u16: men(55),
};

/* ============================================================
 * Per-house icon mapping — mirrors MOCK_HOUSES ids
 * ========================================================== */
export const HOUSE_ICON_BY_ID: Readonly<Record<string, string>> = {
  'h-yc': picsum('ycombinator', 200, 200),
  'h-indie': picsum('indie-hackers', 200, 200),
  'h-design-mvts': picsum('design-movement', 200, 200),
  'h-dao': picsum('dao-global', 200, 200),
  'h-ai': picsum('ai-weekly', 200, 200),
  'h-women-tech': picsum('women-in-tech', 200, 200),
  'h-ui-masters': picsum('ui-masters', 200, 200),
  'h-product-club': picsum('product-club', 200, 200),
};

/* ============================================================
 * Room covers by category — keyword-driven Unsplash
 * ========================================================== */
export const ROOM_COVER_BY_CATEGORY: Readonly<Record<string, string>> = {
  tech: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=75',
  design: 'https://images.unsplash.com/photo-1558655146-d09347e92766?w=800&q=75',
  crypto: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&q=75',
  ai: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=75',
  music: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=75',
  business: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=75',
  health: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=75',
};

/* ============================================================
 * Backgrounds — full-screen / illustration use
 * ========================================================== */
export const BACKGROUNDS = {
  landing: picsum('chathouse-landing', 1080, 1920),
  emptyRooms: picsum('empty-rooms', 600, 400),
  emptyHouses: picsum('empty-houses', 600, 400),
  mapFallback: picsum('map-fallback', 800, 800),
} as const;

/* ============================================================
 * Resolvers — prefer these over raw lookups in consumer code
 * ========================================================== */
export const resolveUserAvatar = (userId: string): string =>
  USER_AVATAR_BY_ID[userId] ?? DEFAULTS.avatar;

export const resolveHouseIcon = (houseId: string): string =>
  HOUSE_ICON_BY_ID[houseId] ?? DEFAULTS.houseIcon;

export const resolveRoomCover = (category: string): string =>
  ROOM_COVER_BY_CATEGORY[category] ?? DEFAULTS.cover;

export const IMAGES = {
  defaults: DEFAULTS,
  avatars10: AVATARS_10,
  userAvatarById: USER_AVATAR_BY_ID,
  houseIconById: HOUSE_ICON_BY_ID,
  roomCoverByCategory: ROOM_COVER_BY_CATEGORY,
  backgrounds: BACKGROUNDS,
} as const;
