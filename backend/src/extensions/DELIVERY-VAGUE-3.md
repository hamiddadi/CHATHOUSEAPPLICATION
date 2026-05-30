# Vague 3 — Bilan de livraison

**Date** : 2026-05-26
**Branche** : main
**Mode** : 100 % extension, zéro modification du code existant.
**Exclusions respectées** : ✗ Clips / ✗ Replays / ✗ Enregistrement audio

## ✅ Modules livrés (Vague 3)

### Backend (`backend/src/extensions/`)

| Module                   | Fonctionnalité Clubhouse                           | Fichiers ajoutés                              | Route / Hook                   |
| ------------------------ | -------------------------------------------------- | --------------------------------------------- | ------------------------------ |
| `queues/followFanout.ts` | 12.1 / NOTIF-001 — fan-out "follow started a room" | nouveau                                       | Worker `ext.fanout` (scan 30s) |
| `modules/privacy/`       | 15.6 / 17.3 — Privacy settings                     | `privacy.service.ts`, `privacy.router.ts`     | `GET/PATCH /api/ext/privacy`   |
| `modules/searchext/`     | 13.4 / SEARCH-010 — Search rooms par langue/topic  | `searchext.service.ts`, `searchext.router.ts` | `GET /api/ext/search/rooms`    |

### Frontend (`src/features/extensions/`)

| Module                 | Fonctionnalité Clubhouse    | Fichiers ajoutés                               |
| ---------------------- | --------------------------- | ---------------------------------------------- |
| Upcoming For You strip | 3.2 / HALL-006              | `components/ExtUpcomingForYouStrip.tsx`        |
| API clients V3         | privacy + search + upcoming | `api/{privacyApi,searchExtApi,upcomingApi}.ts` |
| Hooks                  | React Query                 | `hooks/useUpcoming.ts` (groupé)                |

## 🔗 Points d'intégration (toujours non-invasifs)

| Point         | Mécanisme                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Fan-out       | Scan périodique de `Room.createdAt` + idempotency Redis SET NX                                                   |
| Notifications | Réutilisation `notificationsService.create()`                                                                    |
| Privacy       | Lecture/écriture des colonnes existantes `User.isPrivateAccount` / `allowWaves` / `isVisible` — aucune migration |
| Search        | Wrapper Prisma sur `Room.topics[]` — convention `lang:<iso>` dans `topics`                                       |
| Upcoming UI   | Consomme l'endpoint existant `/rooms/me/upcoming` (`myUpcomingEvents`)                                           |

## 🧪 Tests

```
PASS tests/clubhouse/vague3.spec.test.ts (15 tests)
PASS tests/clubhouse/vague2.spec.test.ts (14 tests)
PASS tests/clubhouse/schema.spec.test.ts (17 tests)
PASS tests/clubhouse/contract.spec.test.ts (34 tests)
PASS tests/clubhouse/extensions.spec.test.ts (9 tests)
PASS tests/extensions.topics.test.ts (9 tests)
PASS tests/env.test.ts + jwt.test.ts + errorMiddleware.test.ts (~16)

Total backend : 114 / 114 ✅
```

- TypeCheck backend : **0 erreur** ✅
- TypeCheck frontend : **0 erreur** ✅

## 🔒 Vérification non-régression

`git status --short` strictement identique à l'état initial :

- 9 fichiers `M` (déjà modifiés avant la session, intacts)
- 5 dossiers/fichiers `??` ajoutés (vague 1 + 2 + 3 + tests + queues/locationPurge.ts)

## 📈 Récapitulatif Vague 1+2+3

| ID                | Module Clubhouse         | Statut | Vague |
| ----------------- | ------------------------ | ------ | ----- |
| 1.4               | Min 3 intérêts           | ✅     | v2    |
| 1.5               | Suggested follows        | ✅     | v1    |
| 1.6               | Contacts sync            | ✅     | v1    |
| 2.3               | Deep-links sociaux       | ✅     | v1    |
| 3.2               | Upcoming for you (UI)    | ✅     | v3    |
| 3.7               | People available to chat | ✅     | v1    |
| 7.4               | Suppression message      | ✅     | v2    |
| 7.6               | URL parser chat          | ✅     | v1    |
| 11.5              | Reminder 15 min          | ✅     | v2    |
| 11.7              | Cancel event             | ✅     | v2    |
| 11/13.5           | Taxonomie 150+           | ✅     | v1    |
| 12.1 / NOTIF-001  | Fan-out follow→room      | ✅     | v3    |
| 13.4 / SEARCH-010 | Search par langue/topic  | ✅     | v3    |
| 15.6 / 17.3       | Privacy settings         | ✅     | v3    |
| 16.4              | Dark mode                | ✅     | v2    |

**14 fonctionnalités critiques** livrées en 3 vagues 100 % additives.

## 🚀 Lancement

```bash
cd backend
npx tsx src/extensions/server.ts
```

Le serveur étendu lance désormais **3 workers en parallèle** de la queue existante :

- `event-reminders` (5 min, code original — inchangé)
- `ext-event-reminders-15` (15 min, vague 2)
- `ext.fanout` (scan 30s pour follow→room, vague 3)

Plus les endpoints REST suivants en `/api/ext/*` :

- v1 : suggestions, contacts, presence, topics
- v2 : events/:id/cancel, chatmod/messages/:id
- v3 : privacy, search/rooms

## ⏭ Vagues restantes (~30-45 j/h)

- **V4** : Tiers audio (Standard/High/Music), monitoring latence, background audio, spatial 3D
- **V5** : Club join requests + Stripe Connect payments
- **V6** : Live captions, dynamic fonts, a11y labels complets
- **V7** : Twitter OAuth import, swipe-hide UI, drop-in mode
