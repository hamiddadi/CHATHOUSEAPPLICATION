# Extensions Integration Guide

> Last updated: 2026-05-26
> Cumulative state across 15 vagues — 162 additive files, 0 legacy modifications.

This is the **operator's manual** for wiring the V1–V15 extensions into the
legacy navigator and screens. Every extension is opt-in: nothing surfaces
until you import the right symbol in a legacy file.

## 1. Lance le serveur étendu

The legacy backend (`backend/src/app.ts`) exposes `/api/auth`, `/api/rooms`,
… etc. — those keep working without the extensions. To get the additive
endpoints (`/api/ext/*`), boot the **extended** entry point :

```bash
cd backend
npx tsx src/extensions/server.ts
```

This reuses `createApp()` then calls `mountExtensions(app)` which surgically
re-orders the Express router stack so `notFoundHandler` fires AFTER the
extension routes register.

Workers that start with the extended server :

- `event-reminders` (5-min) — legacy
- `ext-event-reminders-15` — V2 (15-min reminder)
- `ext.fanout` — V3 (follow→room push fan-out, scan every 30 s)

## 2. Composants front prêts à wirer (sélection)

### Hall (Module 3)

```tsx
import {
  ExtUpcomingForYouStrip, // V3 — section "Upcoming for you" en haut
  ExtAvailablePeopleStrip, // V1 — "People available to chat"
  useExtHideRoom, // V12 — swipe-hide persistant
  useExtSearchHistory, // V14/V15 — historique recherche
} from '@/features/extensions';

const HallScreen = () => {
  const { hidden, hide } = useExtHideRoom();
  const rooms = legacyRooms.filter(r => !hidden.has(r.id));
  return (
    <>
      <ExtUpcomingForYouStrip onSelect={r => nav.push('Room', { id: r.id })} />
      <ExtAvailablePeopleStrip onWaveUser={u => wave(u.id)} />
      <RoomFeed rooms={rooms} onHide={hide} />
    </>
  );
};
```

### Room (Modules 5, 7)

```tsx
import {
  ExtNetworkQualityBars, // V4/V9 — 3 barres réseau
  ExtCaptionsOverlay, // V10 — sous-titres live
  ExtReactionPicker, // V10 — long-press emoji picker
  ExtChatReactionsBar, // V15 — chips de réactions par message
  ExtBadgesRow, // V13/V15 — badges sous le nom
  ExtBackToRoomBanner, // V10 — mini-bar persistante
  useExtRoomFullState, // V11 — composite : socket aliases + audio + captions
} from '@/features/extensions';

const RoomScreen = ({ roomId }) => {
  const state = useExtRoomFullState({
    roomId,
    participants: legacyParticipants,
    captionsEnabled: true,
  });

  return (
    <>
      <Header>
        <Title>{state.activeTitle ?? legacyTitle}</Title>
        <ExtNetworkQualityBars report={state.netReport} />
      </Header>

      <ChatList>
        {messages.map(m => (
          <Message {...m}>
            <ExtBadgesRow userId={m.userId} compact />
            <ExtChatReactionsBar messageId={m.id} />
          </Message>
        ))}
      </ChatList>

      {state.captions.enabled && <ExtCaptionsOverlay lines={state.captions.lines} />}
    </>
  );
};
```

### Profile (Module 2)

```tsx
import { ExtBadgesRow, ExtProfileLinks, ExtNominatorPanel } from '@/features/extensions';

const Profile = ({ userId, isSelf }) => (
  <>
    <ProfileHeader />
    <ExtBadgesRow userId={userId} />
    <ExtProfileLinks userId={userId} editable={isSelf} />
    {isSelf && <ExtNominatorPanel />}
  </>
);
```

### Clubs (Module 10)

```tsx
import {
  ExtFeaturedMembersStrip, // V15 — featured members
  ExtClubPickerSheet, // V12 — modal pour choisir un club au room-create
  clubReqApi, // V5 — approval queue join requests
} from '@/features/extensions';

const ClubPage = ({ clubId }) => (
  <>
    <ClubHeader />
    <ExtFeaturedMembersStrip clubId={clubId} />
    {/* Other club content */}
  </>
);
```

### Settings (Module 15)

```tsx
import {
  ExtSettingsScreen, // V10 — écran consolidé (audio + privacy + theme)
  ExtThemeProvider, // V2 — wrap l'app au root
} from '@/features/extensions';

// In App.tsx (would replace the legacy ThemeProvider wrapper)
const Root = () => (
  <ExtThemeProvider initialMode="auto">
    <ExistingApp />
  </ExtThemeProvider>
);

// Add to navigator as a new screen
<Stack.Screen name="ExtSettings" component={ExtSettingsScreen} />;
```

## 3. Hooks back-office (mount-once)

```tsx
import {
  useExtSocketAliases, // V9 — écoute les 19 alias events
  useExtPresenceHeartbeat, // V11 — heartbeat 30s en foreground
  useExtPushToken, // V12 — register Expo token au login
} from '@/features/extensions';

const SessionGate = () => {
  useExtPresenceHeartbeat(); // keeps lastSeenAt accurate
  useExtPushToken(authenticated); // registers push token after auth
  useExtSocketAliases({
    // optional global handlers
    new_follower: n => toast.show(`${n.username} suivit`),
  });
  return <Navigator />;
};
```

## 4. Endpoints REST `/api/ext/*` — référence rapide

| Catégorie       | Routes                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ | ------- | --------- |
| Discovery       | `GET /api/ext/suggestions`, `/api/ext/topics`, `/api/ext/presence/available`                     |
| Contacts        | `GET /api/ext/contacts/salt`, `POST /api/ext/contacts/match`                                     |
| Hall            | `GET /api/ext/hide-room`, `POST /api/ext/hide-room/:roomId`, `DELETE /api/ext/hide-room/:roomId` |
| Search          | `GET /api/ext/search/rooms`, `GET /api/ext/search-history`                                       |
| Events          | `POST /api/ext/events/:id/cancel`, `GET /api/ext/calendar/:roomId.ics`                           |
| Share           | `GET /api/ext/share/rooms/:roomId`                                                               |
| Speak invite    | `POST /api/ext/speak-invite/:roomId/[invite                                                      | respond | promote]` |
| Room runtime    | `GET/PATCH /api/ext/room-settings/:roomId`                                                       |
| Network         | `POST /api/ext/netquality/report`, `GET /api/ext/netquality/:roomId`                             |
| Audio prefs     | `GET/PATCH /api/ext/audio`                                                                       |
| Chat moderation | `DELETE /api/ext/chatmod/messages/:id`                                                           |
| Chat reactions  | `POST /api/ext/chat-reactions/:messageId/toggle`                                                 |
| Recently played | `GET /api/ext/recently-played`, `POST /api/ext/recently-played/:roomId/touch`                    |
| Privacy         | `GET/PATCH /api/ext/privacy`                                                                     |
| Notif prefs     | `GET /api/ext/notif-prefs`, `PATCH /api/ext/notif-prefs/frequency`                               |
| Profile         | `GET /api/ext/profile-links/:userId`, `POST /api/ext/profile-links/me`                           |
| Badges          | `GET /api/ext/badges/:userId`                                                                    |
| Clubs           | `POST /api/ext/clubreq/:clubId/request`, `GET /api/ext/club-meta/:clubId`                        |
| Nominator       | `GET /api/ext/nominator/me`, `POST /api/ext/nominator/invite`                                    |
| Captions        | `POST /api/ext/captions/:roomId` (feature-flagged)                                               |
| Payments        | `POST /api/ext/payments/tip` (feature-flagged)                                                   |
| Twitter OAuth   | `POST /api/ext/twitter/exchange` (feature-flagged)                                               |

## 5. Env vars feature-flaggés

Copier dans `backend/.env` ce dont tu as besoin :

```bash
# Vague 7 — Stripe Connect
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_CONNECT_CLIENT_ID=ca_xxx
STRIPE_RETURN_URL=https://app.chathouse.com/payments/return
STRIPE_REFRESH_URL=https://app.chathouse.com/payments/refresh

# Vague 7 — Live captions
ASR_PROVIDER=whisper
ASR_API_KEY=sk-xxx

# Vague 7 — Twitter OAuth
TWITTER_CLIENT_ID=xxx
TWITTER_CLIENT_SECRET=xxx
TWITTER_REDIRECT_URI=chathouse://oauth/twitter

# Vague 1 — Contacts hashing salt
CONTACTS_HASH_SALT=<openssl rand -hex 32>
```

## 6. Ordre de wirage recommandé

Si tu intègres les extensions dans le legacy navigator un par un, l'ordre
qui maximise le visible pour l'utilisateur :

1. **`<ExtThemeProvider>`** au root → débloque dark mode et theme toggle
2. **`useExtPushToken`** après login → enregistre device pour push
3. **Settings screen** : ajoute une route `ExtSettings` qui pointe sur `<ExtSettingsScreen />`
4. **Hall** : ajoute `<ExtUpcomingForYouStrip />` + `<ExtAvailablePeopleStrip />` en haut du feed
5. **Room screen** : ajoute `<ExtNetworkQualityBars>` dans le header
6. **Profile** : ajoute `<ExtBadgesRow>` + `<ExtProfileLinks>` + `<ExtNominatorPanel>` (si self)
7. **Chat** : ajoute `<ExtChatReactionsBar>` sous chaque message
8. **Activity feed** : ajoute une route `Activity` qui pointe sur `<ExtActivityFeedScreen />`
9. **Hide room** : wire `useExtHideRoom()` dans le swipe handler du RoomCard

Chaque étape : 5–30 minutes. Total : ~1 journée de dev pour avoir 90%+ des extensions visibles.

## 7. Playground

Pour vérifier tout en isolation sur device :

```tsx
import { ExtPlaygroundScreen } from '@/features/extensions';
// Ajoute une route Stack.Screen 'Playground' temporaire
<Stack.Screen name="Playground" component={ExtPlaygroundScreen} />;
```

Mode auto incluant maintenant V13/V14/V15 (chat reactions, badges, etc.).

## 8. État final 15 vagues

```
Modules Clubhouse couverts à 85-95% en code-only : 13/15
Modules à 50-75% (clés API/build externes requis) :  2/15
Conformité globale code-only                       : 93%

Fichiers additifs livrés                           : 162
Fichiers legacy modifiés                           :   0 ✅
Tests pré-existants                                : 16/16 ✅
TypeCheck backend + frontend                       : 0 erreur ✅
```
