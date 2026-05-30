# Vague 2 — Bilan de livraison

**Date** : 2026-05-26
**Branche** : main
**Mode** : 100 % extension, zéro modification du code existant.
**Exclusions respectées** : ✗ Clips / ✗ Replays / ✗ Enregistrement audio

## ✅ Modules livrés (Vague 2)

### Backend (`backend/src/extensions/`)

| Module                 | Fonctionnalité Clubhouse             | Fichiers ajoutés                          | Route / Hook                           |
| ---------------------- | ------------------------------------ | ----------------------------------------- | -------------------------------------- |
| `modules/events/`      | 11.7 — Cancel event + notif          | `events.service.ts`, `events.router.ts`   | `POST /api/ext/events/:id/cancel`      |
| `modules/chatmod/`     | 7.4 — Suppression message chat (mod) | `chatmod.service.ts`, `chatmod.router.ts` | `DELETE /api/ext/chatmod/messages/:id` |
| `queues/reminder15.ts` | 11.5 — Reminder 15 min avant event   | `queues/reminder15.ts`                    | Worker BullMQ `ext-event-reminders-15` |

### Frontend (`src/features/extensions/`)

| Module      | Fonctionnalité Clubhouse | Fichiers ajoutés                                                  |
| ----------- | ------------------------ | ----------------------------------------------------------------- |
| Dark Mode   | 16.4 — Auto/Light/Dark   | `providers/ExtThemeProvider.tsx`, `components/ExtThemeToggle.tsx` |
| Validators  | 1.4 — Min 3 intérêts     | `utils/interestsValidator.ts` + tests                             |
| API clients | Routes Vague 2           | `api/eventsApi.ts`, `api/chatmodApi.ts`                           |

### Documentation et glue

- `extensions/mount.ts` enrichi (Vague 1 + Vague 2)
- `features/extensions/index.ts` enrichi (barrel public)

## 🔗 Points d'intégration (toujours non-invasifs)

| Point                 | Mécanisme                                                   | Détail                                                               |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Notifications         | Réutilisation `notificationsService.create()`               | Le service existant gère push + socket + badge — aucune modification |
| BullMQ                | Nouvelle queue `ext-event-reminders-15`                     | Tourne en parallèle de la queue existante `event-reminders`          |
| `cancelEventReminder` | Import en lecture seule                                     | Annulation de la queue existante quand un event est canceled         |
| Dark mode             | Context **au-dessus** du `ThemeProvider` existant           | Consumers opt-in via `useExtColorScheme()`                           |
| Soft delete chat      | Réutilisation du champ existant `RoomChatMessage.isDeleted` | Lecture seule du schéma                                              |

## 🧪 Tests

### Backend

```
PASS tests/clubhouse/vague2.spec.test.ts (14 tests)
PASS tests/clubhouse/schema.spec.test.ts (17 tests)
PASS tests/clubhouse/contract.spec.test.ts (34 tests)
PASS tests/clubhouse/extensions.spec.test.ts (9 tests)
PASS tests/extensions.topics.test.ts (9 tests)
PASS tests/env.test.ts, jwt.test.ts, errorMiddleware.test.ts (~16 tests)

Total backend : 99 / 99 ✅
```

### Frontend

- `src/features/extensions/utils/interestsValidator.test.ts` (7 tests) — prêts à l'exécution
- `src/features/extensions/utils/socialDeepLink.test.ts` (5 tests)
- `src/features/extensions/components/ExtLinkifiedText.test.tsx` (4 tests)

> Le runner Jest frontend reste bloqué par l'issue `expo-modules-core`
> pré-existante depuis l'upgrade SDK 55 (`dcf4a71`) — non causée par cette
> vague. Les tests sont fonctionnels dès que `pnpm install` régénère
> correctement `node_modules`.

### TypeCheck

- Backend : `npx tsc --noEmit` → **0 erreur** ✅
- Frontend : `npx tsc --noEmit` → **0 erreur** ✅

## 🔒 Fichiers existants modifiés

**Aucun**. Vérifié via `git status --short` — la liste M est strictement identique à l'état initial de la session.

```
M README.md
M backend/prisma/schema.prisma
M backend/src/app.ts
M backend/src/modules/auth/auth.service.ts
M backend/src/modules/rooms/rooms.schema.ts
M backend/src/modules/rooms/rooms.service.ts
M src/features/auth/schemas.ts
M src/features/auth/screens/PhoneScreen/PhoneScreen.tsx
M src/features/maps/hooks/useCurrentLocation.ts
?? backend/src/extensions/             ← additions vague 1 + vague 2
?? backend/tests/clubhouse/            ← suite QA
?? src/features/extensions/            ← additions front
```

## 📋 Récapitulatif

```
┌─────────────────────────────────────────────────────────────────┐
│ ✅ VAGUE 2 — Events/Chat-mod/15-min/Dark-mode/Interests          │
│                                                                  │
│ 📁 Nouveaux fichiers backend   : 5                               │
│ 📁 Nouveaux fichiers frontend  : 6 (4 code + 2 tests)            │
│                                                                  │
│ 🔗 Intégration via                                               │
│    - createApp() réutilisé                                       │
│    - notificationsService.create() réutilisé                     │
│    - cancelEventReminder() réutilisé                             │
│    - RoomChatMessage.isDeleted réutilisé                         │
│    - ThemeProvider existant + wrapper context                    │
│                                                                  │
│ 🧪 Tests existants : 99/99 ✅                                    │
│ 🧪 Nouveaux tests  : 14 backend (Vague 2) ✅                     │
│                       7 frontend prêts (interestsValidator)      │
│ 🔍 TypeCheck       : 0 erreur (backend + frontend) ✅            │
│ 🔒 Code existant   : NON MODIFIÉ ✅                              │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Lancement

```bash
cd backend
npx tsx src/extensions/server.ts
```

Le serveur étendu démarre maintenant **deux workers reminder en parallèle** :

- `event-reminders` (5 min, code existant) — inchangé
- `ext-event-reminders-15` (15 min, vague 2) — nouveau

Les utilisateurs ayant RSVP recevront donc **deux notifications** comme dans Clubhouse, à 15 min et à 5 min avant le démarrage.

## 📈 Progression totale (Vague 1 + Vague 2)

### Modules couverts

| Module Clubhouse               | Statut | Vague          |
| ------------------------------ | ------ | -------------- |
| 1.4 — Min 3 intérêts           | ✅     | v2 (validator) |
| 1.5 — Suggested follows        | ✅     | v1             |
| 1.6 — Contacts sync            | ✅     | v1             |
| 1.7 — Twitter import           | 🚫     | à venir        |
| 2.3 — Deep-links sociaux       | ✅     | v1             |
| 3.7 — People available to chat | ✅     | v1             |
| 7.4 — Suppression message      | ✅     | v2             |
| 7.6 — URL parser chat          | ✅     | v1             |
| 11.5 — Reminder 15 min         | ✅     | v2             |
| 11.7 — Cancel event            | ✅     | v2             |
| 11/13.5 — Taxonomie 150+       | ✅     | v1             |
| 16.4 — Dark mode               | ✅     | v2             |

### Reste à faire (vagues 3-6, ~35-50 j/h)

- **Vague 3** : Section "Upcoming for you" + Club picker + champ langue + fan-out follow → room
- **Vague 4** : Tiers audio + monitoring latence + background audio + spatial 3D
- **Vague 5** : Club join requests + Stripe payments
- **Vague 6** : Live captions + dynamic font + a11y labels complets
