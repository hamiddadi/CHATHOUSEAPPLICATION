# Real Images — Unified Patch (optional, to be applied by the user)

This file is **documentation only**. It shows the minimal diff required to consume
[`real_images_config.json`](./real_images_config.json) without touching any component,
screen, or layout code — only URL string literals inside mock data files.

## 1. Mocks that contain avatar URLs

Files touched: only mock data files (no components, no screens, no logic).

| File | URLs to replace |
|---|---|
| `src/shared/mocks/users.mock.ts` | 16 `i.pravatar.cc/150?img=N` → `randomuser.me/api/portraits/...` |
| `src/shared/mocks/houses.mock.ts` | 8 `i.pravatar.cc/150?img=N` → seeded `picsum.photos` |
| `src/shared/mocks/followersOnMap.mock.ts` | transitive — consumes `MOCK_USER_SUMMARIES`, no change |
| `src/shared/mocks/rooms.mock.ts` | transitive — same |

## 2. Minimal diff — `src/shared/mocks/users.mock.ts`

Replace **only the URL strings** inside the `MOCK_USER_SUMMARIES` array. Nothing else.

```diff
- ref('u1', 'alex', 'Alex Rivers', 12),
- ref('u2', 'sarahc', 'Sarah Chen', 5),
- ref('u3', 'mjohnson', 'Marcus Johnson', 15),
- ref('u4', 'jordanlee', 'Jordan Lee', 9),
- ref('u5', 'caseyk', 'Casey Kim', 33),
- ref('u6', 'ryanp', 'Ryan Park', 22),
- ref('u7', 'miar', 'Mia Rodriguez', 47),
- ref('u8', 'omarh', 'Omar Hassan', 11),
+ // URLs come from real_images_config.json > user_avatars_by_id
+ ref('u1', 'alex', 'Alex Rivers', 'https://randomuser.me/api/portraits/men/12.jpg'),
+ ref('u2', 'sarahc', 'Sarah Chen', 'https://randomuser.me/api/portraits/women/5.jpg'),
+ ref('u3', 'mjohnson', 'Marcus Johnson', 'https://randomuser.me/api/portraits/men/15.jpg'),
+ ref('u4', 'jordanlee', 'Jordan Lee', 'https://randomuser.me/api/portraits/women/9.jpg'),
+ ref('u5', 'caseyk', 'Casey Kim', 'https://randomuser.me/api/portraits/men/33.jpg'),
+ ref('u6', 'ryanp', 'Ryan Park', 'https://randomuser.me/api/portraits/men/22.jpg'),
+ ref('u7', 'miar', 'Mia Rodriguez', 'https://randomuser.me/api/portraits/women/47.jpg'),
+ ref('u8', 'omarh', 'Omar Hassan', 'https://randomuser.me/api/portraits/men/11.jpg'),
```

Note: the `ref()` helper in `users.mock.ts` currently accepts a **numeric id** and builds
`https://i.pravatar.cc/150?img=${img}`. To pass full URLs instead, its signature must change
from `(id, username, displayName, img: number)` to `(id, username, displayName, url: string)`.
That **is** a source change to the helper body — if you want strict "URLs only, no logic",
use the alternative below.

## 3. Zero-code alternative — Resolver file

Create `src/shared/constants/images.ts` (new file, no existing code modified):

```ts
import config from '../../../real_images_config.json';

export const IMAGES = config;

export const resolveAvatarUrl = (userId: string): string =>
  (config.user_avatars_by_id as Record<string, string>)[userId] ?? config.defaults.avatar;
```

Then mocks that call `pickUser(idx)` are untouched. Only the consumer (optional) starts
using `resolveAvatarUrl(user.id)` where it wants the randomuser.me image.

## 4. Cover photos — keyword-driven via Unsplash

For future room covers (not currently in the app), use:

```ts
import { IMAGES } from '@shared/constants/images';
const cover = IMAGES.room_covers_by_category[room.category] ?? IMAGES.defaults.cover;
```

## 5. `.env.images.example` usage

The env patch is informational. Expo reads env through `app.json.extra`. To actually wire:

1. Copy the variables from `.env.images.example` into `.env.local` (gitignored).
2. Expose in `app.json > extra`:
   ```json
   "extra": {
     "API_BASE_URL": "...",
     "DEFAULT_AVATAR_URL": "https://randomuser.me/api/portraits/thumb/men/32.jpg"
   }
   ```
3. Read in `src/config/env.ts`:
   ```ts
   const extra = Constants.expoConfig?.extra;
   export const DEFAULT_AVATAR_URL = extra?.DEFAULT_AVATAR_URL;
   ```

Again: this is the **optional** integration path. The config file itself is self-sufficient.
