# 06 - Scripts d'automatisation des boutons critiques

> **ChatHouse** — app audio live facon Clubhouse (React Native / Expo SDK 55, temps reel `socket.io-client` + audio **LiveKit** `@livekit/react-native`, push, i18n FR/EN, roles guest/standard/admin, Android + iOS).
>
> **Perimetre teste** : 50 ecrans · 381 boutons · 991 cas de test. Ce document fournit les **scripts d'automatisation executables** pour **14 boutons critiques** (>= 12 exiges) couvrant **auth, room live, messages, moderation admin et profil/follow**.

## Conventions communes (a lire avant tout)

| Element             | Convention reelle du depot                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection unitaire  | `getByLabelText(i18n.t('cle'))` (la plupart), `getByPlaceholderText(...)`, `getByText(...)`, `getByRole('button' / 'checkbox' / 'radio' / 'tab', { name })`. RTL = `@testing-library/react-native` v13.                                                                                             |
| Harness unitaire    | `import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';` + `import { i18n } from '@/core/i18n';`. `renderScreen` retourne `{ navigation, queryClient }` ; navigation deja mockee (`navigate`, `goBack`, `replace`, `canGoBack`…).                                    |
| Mocks globaux       | `jest-setup.ts` neutralise LiveKit, socket.io, axios, expo-audio, haptics, clipboard, secure-store, image-picker, location, notifications, NetInfo, Sentry. Les **hooks de service** (`useRooms`, `useMessages`, `useAdmin`, `useFollow`…) et les **stores** (`authStore`) se mockent **par test**. |
| i18n                | i18n **reel** charge (EN par defaut dans les tests) → on assert sur les vraies chaines via `i18n.t(...)`. FR/EN a couvrir en E2E par bascule de langue.                                                                                                                                             |
| Detox               | `by.label(...)` (= accessibilityLabel), `by.text(...)`, `by.id(...)` (testID). `element(...).tap()`, `waitFor(...).toBeVisible().withTimeout(ms)`, `expect(...).toExist()`.                                                                                                                         |
| Maestro             | Flow YAML : `tapOn`, `assertVisible`, `inputText`, `runFlow when:` (conditionnel), `extendedWaitUntil`. Selection par `id` (testID), `text`, ou `accessibilityText` (= accessibilityLabel sur iOS, contentDescription sur Android).                                                                 |
| Comptes de test     | Voir plan §5.1 : `guest`, `standard` (USER), `moderator`, `admin` (ADMIN), `super_admin`, `devuser`.                                                                                                                                                                                                |
| Mock LiveKit/socket | En E2E on **n'ouvre pas** de vrai canal LiveKit pour les assertions deterministes → backend `:4000` en mode test + flag `REALTIME_ENABLED` ; la voix reelle reste **manuelle sur build EAS** (cf. §15).                                                                                             |

> **Note generale data-testid** : la convention actuelle privilegie `accessibilityLabel`. On n'ajoute un `testID` que lorsque le locator est **ambigu** (label duplique, libelle dynamique non stable, cellule de liste indistincte). Chaque section signale ces cas dans son bloc **« data-testid a ajouter »**.

---

## Index des 14 boutons couverts

| #   | Feature  | Ecran                         | Bouton                              | Priorite | Type            |
| --- | -------- | ----------------------------- | ----------------------------------- | -------- | --------------- |
| 1   | auth     | Numero de telephone           | Recevoir un code                    | P0       | submit          |
| 2   | auth     | Code OTP                      | Champ code 6 chiffres (auto-submit) | P0       | input-submit    |
| 3   | auth     | Nom d'utilisateur             | Valider                             | P0       | submit          |
| 4   | rooms    | Fil des rooms                 | Rejoindre (Join)                    | P0       | navigation      |
| 5   | rooms    | Room audio en direct          | Micro Mute/Unmute                   | P0       | toggle          |
| 6   | rooms    | Room audio en direct          | Lever/Baisser la main               | P0       | realtime-action |
| 7   | rooms    | Room audio en direct          | Fermer la room (End Room)           | P0       | destructive     |
| 8   | rooms    | Room audio en direct          | Quitter                             | P0       | navigation      |
| 9   | messages | Conversation (detail)         | Envoyer le message                  | P0       | submit          |
| 10  | messages | Conversation (detail)         | Enregistrer message vocal (Micro)   | P0       | realtime-action |
| 11  | admin    | Signalements                  | Resoudre (signalement)              | P0       | destructive     |
| 12  | admin    | Rooms (admin)                 | Fermer la room (force-end)          | P0       | destructive     |
| 13  | admin    | Detail utilisateur            | Suspendre (1h/24h/7d/Perm)          | P0       | destructive     |
| 14  | profile  | Suggestions a suivre / Profil | Suivre / Following                  | P1       | toggle          |

---

## 1. AUTH — « Recevoir un code » (PhoneScreen)

**Locator** : `getByRole('button', { name: i18n.t('auth.phone.submit') })` (= « Recevoir un code »). Pre-requis : case `role='checkbox'` cochee (>= 16 ans) + numero E.164 valide. Declenche `requestOtp(E.164)` puis `navigate('Otp', { phoneNumber })`.

### (a) Detox — e2e natif

```js
// e2e/auth-phone.e2e.js
describe('Phone → Recevoir un code', () => {
  beforeEach(async () => {
    await device.launchApp({ delete: true, newInstance: true });
    await element(by.label('auth.landing.cta.getStartedA11y')).tap(); // Landing → Phone
  });

  it('envoie l’OTP et navigue vers Otp avec un numero valide', async () => {
    await element(by.label('auth.phone.ageVerification')).tap(); // case 16 ans
    await element(by.id('phone-input')).typeText('612345678'); // local FR
    const submit = element(by.label('auth.phone.submit'));
    await waitFor(submit).toBeVisible().withTimeout(2000);
    await submit.tap();
    // navigation vers l’ecran OTP (titre)
    await waitFor(element(by.text('Enter the code')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('reste desactive tant que la case 16 ans n’est pas cochee (multi-clic)', async () => {
    await element(by.id('phone-input')).typeText('612345678');
    const submit = element(by.label('auth.phone.submit'));
    await submit.multiTap(4); // rafale
    await expect(element(by.text('Enter the code'))).not.toBeVisible(); // pas de nav
  });
});
```

### (b) Maestro — flow YAML

```yaml
# .maestro/auth_phone_request_code.yaml
appId: com.chathouse.app
---
- launchApp:
    clearState: true
- tapOn:
    id: 'auth.landing.cta.getStartedA11y'
- assertVisible:
    id: 'auth.phone.submit'
- tapOn:
    id: 'auth.phone.ageVerification' # >= 16 ans
- tapOn:
    id: 'phone-input'
- inputText: '612345678'
- tapOn:
    id: 'auth.phone.submit'
- extendedWaitUntil:
    visible:
      text: 'Enter the code' # ecran OTP
    timeout: 6000
# Robustesse multi-clic : un seul ecran OTP doit etre empile (pas de double nav)
```

### (c) Unitaire — React Native Testing Library

```tsx
// PhoneScreen.test.tsx (extrait : pattern reel du depot)
it('requests an OTP and navigates to Otp once valid number and age are provided', async () => {
  const requestOtp = jest.fn().mockResolvedValue(undefined);
  // authStore mocke pour exposer requestOtp via le selecteur (cf. test existant)
  const { navigation } = renderScreen(<PhoneScreen />);

  fireEvent.press(screen.getByRole('checkbox')); // 16 ans
  fireEvent.changeText(
    screen.getByPlaceholderText(i18n.t('auth.phone.placeholder')),
    '4155551234', // prefixe +1 ajoute
  );
  const submit = screen.getByRole('button', { name: i18n.t('auth.phone.submit') });
  await waitFor(() => expect(submit.props.accessibilityState?.disabled).toBe(false));

  fireEvent.press(submit);

  await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+14155551234'));
  expect(navigation.navigate).toHaveBeenCalledWith('Otp', { phoneNumber: '+14155551234' });
});

it('ne soumet pas quand le formulaire est invalide (defauts)', () => {
  const requestOtp = jest.fn();
  renderScreen(<PhoneScreen />);
  fireEvent.press(screen.getByRole('button', { name: i18n.t('auth.phone.submit') }));
  expect(requestOtp).not.toHaveBeenCalled(); // garde disabled
});
```

> **data-testid a ajouter** : `phone-input` sur le `TextInput` du numero (le placeholder traduit suffit en unitaire mais devient fragile en E2E si la langue change ; preferer un `testID` stable). La case 16 ans est selectionnable par `role='checkbox'` en unitaire ; en E2E ajouter `testID="phone-age-checkbox"` si l’accessibilityLabel n’est pas expose cote natif.

---

## 2. AUTH — Champ code OTP auto-submit (OtpScreen)

**Locator** : `getByLabelText('Verification code, 6 digits')`. La saisie des 6 chiffres declenche `verifyOtp(phone, code)` ; nouvel utilisateur → `navigate('Name', { phoneNumber })`, utilisateur existant → route vers Main. Gere 5 tentatives max + verrouillage.

### (a) Detox

```js
// e2e/auth-otp.e2e.js
it('verifie le code et route un nouvel utilisateur vers Name', async () => {
  await element(by.label('Verification code, 6 digits')).typeText('123456');
  // auto-submit : pas de bouton, l’ecran Name doit apparaitre (compte test "isNewUser")
  await waitFor(element(by.label('auth.name.submit')))
    .toBeVisible()
    .withTimeout(6000);
});

it('affiche l’erreur de code invalide et le compteur de tentatives', async () => {
  await element(by.label('Verification code, 6 digits')).typeText('000000'); // code seede faux
  await waitFor(element(by.text('Invalid code. Please try again.')))
    .toBeVisible()
    .withTimeout(4000);
});
```

### (b) Maestro

```yaml
# .maestro/auth_otp_autosubmit.yaml
appId: com.chathouse.app
---
- tapOn:
    accessibilityText: 'Verification code, 6 digits'
- inputText: '123456' # auto-submit, pas de bouton
- extendedWaitUntil:
    visible:
      id: 'auth.name.submit' # nouvel utilisateur → Name
    timeout: 6000
---
# Variante code errone (compte seede avec OTP attendu different)
- tapOn:
    accessibilityText: 'Verification code, 6 digits'
- inputText: '000000'
- assertVisible:
    text: 'Invalid code. Please try again.'
```

### (c) Unitaire (pattern reel)

```tsx
it('verifies the code and navigates to Name for a new user', async () => {
  const verifyOtp = jest.fn().mockResolvedValue({ isNewUser: true });
  // setupStore({ verifyOtp }) — authStore mocke selecteur-aware
  const { navigation } = renderScreen(<OtpScreen />, {
    routeName: 'Otp',
    routeParams: { phoneNumber: '+33612345678' },
  });

  fireEvent.changeText(screen.getByLabelText('Verification code, 6 digits'), '123456');

  await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('+33612345678', '123456'));
  await waitFor(() =>
    expect(navigation.navigate).toHaveBeenCalledWith('Name', { phoneNumber: '+33612345678' }),
  );
});

it('shows invalid-code error + remaining attempts on failure', async () => {
  const verifyOtp = jest.fn().mockRejectedValue(new Error('bad code'));
  renderScreen(<OtpScreen />, { routeName: 'Otp', routeParams: { phoneNumber: '+33612345678' } });
  fireEvent.changeText(screen.getByLabelText('Verification code, 6 digits'), '000000');
  expect((await screen.findAllByText(i18n.t('auth.otp.errors.invalid'))).length).toBeGreaterThan(0);
  expect(screen.getByText(i18n.t('auth.otp.attemptsRemaining', { count: 4 }))).toBeTruthy();
});
```

> **Assertion temps-reel / robustesse** : verifier en E2E qu’une saisie **partielle puis complete** n’envoie qu’**un** `verifyOtp` (pas d’appel par chiffre) et que le verrouillage apres 5 echecs masque le champ. Le label `'Verification code, 6 digits'` est en dur dans le code (pas une cle i18n) → stable cross-langue.

---

## 3. AUTH — « Valider » le pseudo (UsernameScreen)

**Locator** : `getByRole('button', { name: i18n.t('auth.username.submit') })`. Declenche `PATCH /users/me/username`, promeut la session en `authenticated` et fait sortir du stack Auth. Risque double-soumission + conflit de pseudo (USER_002).

### (a) Detox

```js
// e2e/auth-username.e2e.js
it('valide un pseudo libre et sort du stack Auth', async () => {
  await element(by.id('username-input')).typeText('claude_dev');
  const submit = element(by.label('auth.username.submit'));
  await waitFor(submit).toBeVisible().withTimeout(2000);
  await submit.tap();
  // sortie du stack Auth → ecran principal (feed des rooms)
  await waitFor(element(by.label('feed.startNewA11y')))
    .toBeVisible()
    .withTimeout(8000);
});

it('affiche l’erreur de conflit sans fermer l’ecran (pseudo deja pris)', async () => {
  await element(by.id('username-input')).typeText('taken_handle'); // seede comme pris
  await element(by.label('auth.username.submit')).tap();
  await waitFor(element(by.id('username-input')))
    .toBeVisible()
    .withTimeout(4000); // reste
});
```

### (b) Maestro

```yaml
# .maestro/auth_username_validate.yaml
appId: com.chathouse.app
---
- tapOn:
    id: 'username-input'
- inputText: 'claude_dev'
- tapOn:
    id: 'auth.username.submit'
- extendedWaitUntil:
    visible:
      id: 'feed.startNewA11y' # FAB du feed = on a quitte le stack Auth
    timeout: 8000
---
# Raccourci pill de suggestion (remplit le champ et active le CTA)
- tapOn:
    text: '@claude1'
- assertVisible:
    id: 'auth.username.submit'
```

### (c) Unitaire

```tsx
it('valide le pseudo et promeut la session', async () => {
  const setUsername = jest.fn().mockResolvedValue(undefined); // authStore mocke
  renderScreen(<UsernameScreen />);

  fireEvent.changeText(
    screen.getByPlaceholderText(i18n.t('auth.username.placeholder')),
    'claude_dev',
  );
  const submit = screen.getByRole('button', { name: i18n.t('auth.username.submit') });
  await waitFor(() => expect(submit.props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(submit);

  await waitFor(() => expect(setUsername).toHaveBeenCalledWith('claude_dev'));
});

it('multi-clic rapide ne declenche qu’une soumission', async () => {
  const setUsername = jest.fn().mockResolvedValue(undefined);
  renderScreen(<UsernameScreen />);
  fireEvent.changeText(
    screen.getByPlaceholderText(i18n.t('auth.username.placeholder')),
    'claude_dev',
  );
  const submit = screen.getByRole('button', { name: i18n.t('auth.username.submit') });
  await waitFor(() => expect(submit.props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(submit);
  fireEvent.press(submit);
  fireEvent.press(submit);
  await waitFor(() => expect(setUsername).toHaveBeenCalledTimes(1)); // garde isPending
});
```

> **data-testid a ajouter** : `username-input` (le placeholder traduit est fragile cross-langue en E2E). La pill de suggestion `@<handle>` est selectionnable par texte mais son contenu est dynamique → pour un flow Maestro deterministe, ajouter `testID="username-suggestion-0"` sur la premiere pill.

---

## 4. ROOMS — « Rejoindre (Join) » (RoomFeedScreen)

**Locator** : `getByLabelText('Join room: {title}')` → `navigation.navigate('Room', { roomId })`. Cible de la synchro hallway socket (une room peut apparaitre/disparaitre en temps reel).

### (a) Detox

```js
// e2e/room-feed-join.e2e.js
it('rejoint une room live depuis le feed', async () => {
  await waitFor(element(by.label('Join room: Building in public')))
    .toBeVisible()
    .withTimeout(8000);
  await element(by.label('Join room: Building in public')).tap();
  // ecran Room : barre d’action (Invite + Leave quietly visibles a tout participant)
  await waitFor(element(by.label('Leave quietly')))
    .toBeVisible()
    .withTimeout(6000);
});

it('multi-tap rapide n’empile pas deux ecrans Room', async () => {
  const join = element(by.label('Join room: Building in public'));
  await join.multiTap(3);
  await waitFor(element(by.label('Leave quietly')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Leave quietly')).tap(); // une seule fois → retour feed
  await expect(element(by.label('Leave quietly'))).not.toBeVisible();
});
```

### (b) Maestro

```yaml
# .maestro/room_feed_join.yaml
appId: com.chathouse.app
---
- assertVisible:
    accessibilityText: 'Join room: Building in public'
- tapOn:
    accessibilityText: 'Join room: Building in public'
- extendedWaitUntil:
    visible:
      accessibilityText: 'Leave quietly'
    timeout: 6000
```

### (c) Unitaire (pattern reel RoomFeedScreen)

```tsx
it('navigates to Room when Join is pressed', () => {
  // useHallwayFeed mocke pour fournir une room live "Building in public" (id room-1)
  const { navigation } = renderScreen(<RoomFeedScreen />);
  fireEvent.press(screen.getByLabelText('Join room: Building in public'));
  expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-1' });
});

it('reflete une room ajoutee via le socket hallway (temps-reel)', async () => {
  // emuler l’event socket hallway:room-added puis re-render
  // (le mock socket de jest-setup expose .on ; declencher le handler manuellement)
  renderScreen(<RoomFeedScreen />);
  await waitFor(() => expect(screen.getByLabelText('Join room: Late night jazz')).toBeTruthy());
});
```

> **data-testid a ajouter** : le label inclut le titre de la room (dynamique). Pour un flow E2E robuste sur un jeu seede, fixer un titre connu OU ajouter `testID="room-card-${roomId}"` sur la carte. Le multi-tap est le risque cle (R4) — toujours couvrir.

---

## 5. ROOMS — Micro Mute / Unmute (RoomScreen)

**Locator** : `getByLabelText(i18n.t('room.muteA11y'))` / `getByLabelText(i18n.t('room.unmuteA11y'))` (« Mute microphone » / « Unmute microphone »). Coupe/retablit la voix LiveKit avec **rollback optimiste 3 niveaux** (UI / store / LiveKit) ; doit survivre au force-mute host et a la reconnexion.

### (a) Detox

```js
// e2e/room-mute.e2e.js  — backend test, LiveKit en mode mock (cf. §15)
it('bascule mute → unmute et persiste l’etat', async () => {
  // pre-requis : etre speaker/host (compte seede host de la room)
  await waitFor(element(by.label('Mute microphone')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Mute microphone')).tap();
  await waitFor(element(by.label('Unmute microphone')))
    .toBeVisible()
    .withTimeout(3000);
  await element(by.label('Unmute microphone')).tap();
  await waitFor(element(by.label('Mute microphone')))
    .toBeVisible()
    .withTimeout(3000);
});

it('survit a la reconnexion sans hot-unmute (manuel-assiste)', async () => {
  await element(by.label('Mute microphone')).tap(); // → muted
  await device.setURLBlacklist(['.*livekit.*']); // coupe le transport
  await device.setURLBlacklist([]); // reconnecte
  await expect(element(by.label('Unmute microphone'))).toBeVisible(); // reste muted
});
```

### (b) Maestro

```yaml
# .maestro/room_mute_toggle.yaml
appId: com.chathouse.app
---
- assertVisible:
    accessibilityText: 'Mute microphone'
- tapOn:
    accessibilityText: 'Mute microphone'
- assertVisible:
    accessibilityText: 'Unmute microphone'
- tapOn:
    accessibilityText: 'Unmute microphone'
- assertVisible:
    accessibilityText: 'Mute microphone'
```

### (c) Unitaire

```tsx
it('appelle setMuted lors du toggle micro (rollback optimiste UI)', async () => {
  const setMuted = jest.fn().mockResolvedValue(undefined);
  // useRoomAudio mocke → audioState({ status: 'connected', setMuted })
  // useRoom mocke → makeRoom({ hostId: VIEWER_ID }) pour etre speaker/host
  renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });

  fireEvent.press(screen.getByLabelText(i18n.t('room.muteA11y', 'Mute microphone')));
  await waitFor(() => expect(setMuted).toHaveBeenCalledWith(true));
  // apres succes : le label bascule vers "Unmute microphone"
  await waitFor(() =>
    expect(screen.getByLabelText(i18n.t('room.unmuteA11y', 'Unmute microphone'))).toBeTruthy(),
  );
});

it('rollback : si setMuted rejette, l’UI revient a l’etat precedent', async () => {
  const setMuted = jest.fn().mockRejectedValue(new Error('livekit fail'));
  renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });
  fireEvent.press(screen.getByLabelText(i18n.t('room.muteA11y', 'Mute microphone')));
  await waitFor(() => expect(setMuted).toHaveBeenCalled());
  // l’UI ne doit PAS rester sur "Unmute" si l’appel a echoue
  await waitFor(() =>
    expect(screen.getByLabelText(i18n.t('room.muteA11y', 'Mute microphone'))).toBeTruthy(),
  );
});
```

> **Mock LiveKit** : `@livekit/react-native` est deja stub en unitaire (`jest-setup.ts`). En E2E, le toggle audio doit etre validable sans micro reel → exposer un **mode test du transport** (LiveKit en no-op) cote backend `:4000` ; la **voix audible reelle** reste verifiee **manuellement sur build EAS dev-client** (R3). Le label mute/unmute est dynamique selon `isMuted` — couvrir les deux etats.

---

## 6. ROOMS — Lever / Baisser la main (RoomScreen)

**Locator** : `getByLabelText(i18n.t('room.raiseA11y'))` / `getByLabelText(i18n.t('room.lowerA11y'))` (« Raise hand » / « Lower hand »). Flip optimiste + reconciliation `serverHandRaised` ; alimente la file de moderation du host (temps reel).

### (a) Detox

```js
// e2e/room-raise-hand.e2e.js
it('leve puis baisse la main (auditeur)', async () => {
  await waitFor(element(by.label('Raise hand')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Raise hand')).tap();
  await waitFor(element(by.label('Lower hand')))
    .toBeVisible()
    .withTimeout(3000);
  await element(by.label('Lower hand')).tap();
  await waitFor(element(by.label('Raise hand')))
    .toBeVisible()
    .withTimeout(3000);
});
```

### (b) Maestro

```yaml
# .maestro/room_raise_hand.yaml
appId: com.chathouse.app
---
- tapOn:
    accessibilityText: 'Raise hand'
- assertVisible:
    accessibilityText: 'Lower hand'
- tapOn:
    accessibilityText: 'Lower hand'
- assertVisible:
    accessibilityText: 'Raise hand'
```

### (c) Unitaire

```tsx
it('leve la main via useRaiseHand puis bascule le label', async () => {
  const raise = { ...mutationStub(), mutateAsync: jest.fn().mockResolvedValue(undefined) };
  // mockUseRaiseHand.mockReturnValue(raise) ; viewer = simple auditeur (pas host)
  renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });

  fireEvent.press(screen.getByLabelText(i18n.t('room.raiseA11y', 'Raise hand')));
  await waitFor(() => expect(raise.mutateAsync).toHaveBeenCalledWith('room-1'));
  await waitFor(() =>
    expect(screen.getByLabelText(i18n.t('room.lowerA11y', 'Lower hand'))).toBeTruthy(),
  );
});

it('reconcilie sur serverHandRaised (resnap verite serveur)', async () => {
  // useHandRaises mocke pour renvoyer la main du viewer cote serveur
  renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });
  await waitFor(() =>
    expect(screen.getByLabelText(i18n.t('room.lowerA11y', 'Lower hand'))).toBeTruthy(),
  );
});
```

> **Assertion temps-reel** : en multi-device (E2E/manuel), apres « Raise hand » cote auditeur, la **cellule main levee** doit apparaitre cote host (event `room:hand_raised`). L’automatisation unitaire verifie le flip + la reconciliation ; le cross-device est valide en campagne manuelle (cf. `03-scenarios-temps-reel.md`).

---

## 7. ROOMS — Fermer la room / End Room (RoomScreen, host)

**Locator** : `getByLabelText(i18n.t('room.closeRoom', 'End Room'))`. **Destructif host** : `endRoom` + broadcast `room:ended` → ferme la room pour TOUS. **Confirmation Alert obligatoire**, anti double-pop. Visible uniquement si `viewer === hostId`.

### (a) Detox

```js
// e2e/room-end.e2e.js  — compte host
it('ferme la room apres confirmation et revient en arriere', async () => {
  await waitFor(element(by.label('End Room')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('End Room')).tap();
  // Alert de confirmation (titre/bouton destructif) — libelle selon i18n
  await element(by.text('End Room')).atIndex(1).tap(); // bouton destructif de l’Alert
  await waitFor(element(by.label('feed.startNewA11y')))
    .toBeVisible()
    .withTimeout(6000); // retour feed
});

it('non-host : le bouton End Room n’existe pas', async () => {
  await expect(element(by.label('End Room'))).not.toExist();
});
```

### (b) Maestro

```yaml
# .maestro/room_end.yaml
appId: com.chathouse.app
---
- assertVisible:
    accessibilityText: 'End Room'
- tapOn:
    accessibilityText: 'End Room'
# Alert systeme de confirmation
- tapOn:
    text: 'End Room' # bouton destructif de l’Alert
- extendedWaitUntil:
    visible:
      id: 'feed.startNewA11y' # on est ressorti au feed
    timeout: 6000
```

### (c) Unitaire

```tsx
import { Alert } from 'react-native';

it('host : confirme l’Alert puis endRoom + goBack', async () => {
  const end = { ...mutationStub(), mutateAsync: jest.fn().mockResolvedValue(undefined) };
  // mockUseEndRoom.mockReturnValue(end) ; makeRoom({ hostId: VIEWER_ID })
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
    // declenche le bouton destructif
    (btns as { style?: string; onPress?: () => void }[])
      .find(b => b.style === 'destructive')
      ?.onPress?.();
  });
  const { navigation } = renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });

  fireEvent.press(screen.getByLabelText(i18n.t('room.closeRoom', 'End Room')));
  await waitFor(() => expect(end.mutateAsync).toHaveBeenCalledWith('room-1'));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  alertSpy.mockRestore();
});

it('non-host : pas de bouton End Room', () => {
  // makeRoom({ hostId: 'someone-else' }), viewer = VIEWER_ID
  renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });
  expect(screen.queryByLabelText(i18n.t('room.closeRoom', 'End Room'))).toBeNull();
});
```

> **data-testid a ajouter** : le bouton destructif de l’Alert porte le **meme texte** que le bouton de l’ecran (« End Room ») → en Detox utiliser `.atIndex(1)`. Pour fiabiliser, l’Alert pourrait differencier le libelle (ex. « Confirmer la fermeture »). En unitaire on pilote l’Alert via `Alert.alert` spy (pattern reel du depot pour AdminUserDetail).

---

## 8. ROOMS — « Quitter » (RoomScreen)

**Locator** : `getByLabelText(i18n.t('room.leaveQuietly', 'Leave quietly'))`. `leaveRoom` + libere l’audio ; **doit toujours `goBack` meme si l’appel reseau echoue** (`onSettled`).

### (a) Detox

```js
// e2e/room-leave.e2e.js
it('quitte la room et revient au feed', async () => {
  await waitFor(element(by.label('Leave quietly')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Leave quietly')).tap();
  await waitFor(element(by.label('feed.startNewA11y')))
    .toBeVisible()
    .withTimeout(6000);
});

it('quitte meme hors-ligne (leave best-effort)', async () => {
  await device.setURLBlacklist(['.*']); // coupe le reseau
  await element(by.label('Leave quietly')).tap();
  await waitFor(element(by.label('feed.startNewA11y')))
    .toBeVisible()
    .withTimeout(6000);
  await device.setURLBlacklist([]);
});
```

### (b) Maestro

```yaml
# .maestro/room_leave.yaml
appId: com.chathouse.app
---
- assertVisible:
    accessibilityText: 'Leave quietly'
- tapOn:
    accessibilityText: 'Leave quietly'
- extendedWaitUntil:
    visible:
      id: 'feed.startNewA11y'
    timeout: 6000
```

### (c) Unitaire (pattern reel)

```tsx
it('leaves the room and pops the screen when leave is pressed', async () => {
  const leave = { ...mutationStub(), mutateAsync: jest.fn().mockResolvedValue(undefined) };
  // mockUseLeaveRoom.mockReturnValue(leave)
  const { navigation } = renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });
  fireEvent.press(screen.getByLabelText('Leave quietly'));
  await waitFor(() => expect(leave.mutateAsync).toHaveBeenCalledWith('room-1'));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
});

it('goBack meme si leave rejette (onSettled)', async () => {
  const leave = { ...mutationStub(), mutateAsync: jest.fn().mockRejectedValue(new Error('net')) };
  const { navigation } = renderScreen(<RoomScreen />, { routeParams: { roomId: 'room-1' } });
  fireEvent.press(screen.getByLabelText('Leave quietly'));
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled()); // sort quand meme
});
```

---

## 9. MESSAGES — « Envoyer le message » (ChatDetailScreen)

**Locator** : `getByLabelText(i18n.t('chat.sendA11y'))` (« Envoyer le message »). Saisie via `getByPlaceholderText(i18n.t('chat.inputPlaceholder'))`. Envoi optimiste + invalidation conversations ; risque doublon multi-clic + echec reseau.

### (a) Detox

```js
// e2e/chat-send.e2e.js
it('envoie un message texte et l’affiche dans le fil', async () => {
  await element(by.id('chat-input')).typeText('Hello!');
  await waitFor(element(by.label('chat.sendA11y')))
    .toBeVisible()
    .withTimeout(2000);
  await element(by.label('chat.sendA11y')).tap();
  await waitFor(element(by.text('Hello!')))
    .toBeVisible()
    .withTimeout(5000); // bulle optimiste
  await expect(element(by.id('chat-input'))).toHaveText(''); // champ reset
});

it('multi-tap rapide n’envoie pas de doublon', async () => {
  await element(by.id('chat-input')).typeText('Once');
  await element(by.label('chat.sendA11y')).multiTap(4);
  await expect(element(by.text('Once'))).toExist(); // une seule bulle attendue
});
```

### (b) Maestro

```yaml
# .maestro/chat_send_text.yaml
appId: com.chathouse.app
---
- tapOn:
    id: 'chat-input'
- inputText: 'Hello!'
- tapOn:
    accessibilityText: 'Envoyer le message' # FR ; cle chat.sendA11y
- assertVisible:
    text: 'Hello!'
```

### (c) Unitaire (pattern reel)

```tsx
it('envoie le texte et reset le champ', async () => {
  const sendMutate = jest.fn().mockResolvedValue(undefined);
  // mockUseSendMessage.mockReturnValue({ ...mutationStub(), mutateAsync: sendMutate })
  renderScreen(<ChatDetailScreen />, { routeParams: { conversationId: 'peer-1' } });

  fireEvent.changeText(screen.getByPlaceholderText(i18n.t('chat.inputPlaceholder')), 'Hello!');
  fireEvent.press(await screen.findByLabelText(i18n.t('chat.sendA11y')));

  await waitFor(() =>
    expect(sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'peer-1', text: 'Hello!' }),
    ),
  );
});

it('le bouton Envoyer disparait quand le champ est vide (bascule micro)', () => {
  renderScreen(<ChatDetailScreen />, { routeParams: { conversationId: 'peer-1' } });
  // champ vide → micro visible, send absent
  expect(screen.queryByLabelText(i18n.t('chat.sendA11y'))).toBeNull();
  expect(screen.getByLabelText(i18n.t('chat.micA11y'))).toBeTruthy();
});
```

> **Assertion temps-reel** : chaque frappe emet `chat:typing` (throttle 2,5 s) → en E2E multi-device, l’indicateur « ecrit… » apparait chez le pair. **data-testid a ajouter** : `chat-input` sur le `TextInput` (placeholder traduit fragile en E2E). Le bouton Envoyer **remplace** le micro selon le contenu → couvrir la bascule champ-vide / champ-rempli.

---

## 10. MESSAGES — Micro / enregistrer un vocal (ChatDetailScreen)

**Locator** : `getByLabelText(i18n.t('chat.micA11y'))` (« Enregistrer un message vocal »). Demarre la capture (permission micro + module natif `expo-audio`) ; visible quand le champ texte est vide.

### (a) Detox

```js
// e2e/chat-voice.e2e.js  — necessite permission micro accordee au lancement
it('demarre l’enregistrement vocal puis l’envoie', async () => {
  await waitFor(element(by.label('chat.micA11y')))
    .toBeVisible()
    .withTimeout(4000);
  await element(by.label('chat.micA11y')).tap(); // start capture
  await waitFor(element(by.label('voice.sendA11y')))
    .toBeVisible()
    .withTimeout(3000);
  await element(by.label('voice.sendA11y')).tap(); // upload + envoi
  await waitFor(element(by.label('voice.playA11y')))
    .toBeVisible()
    .withTimeout(8000); // bulle vocale
});

it('annule l’enregistrement (action destructive)', async () => {
  await element(by.label('chat.micA11y')).tap();
  await element(by.label('voice.cancelA11y')).tap();
  await waitFor(element(by.label('chat.micA11y')))
    .toBeVisible()
    .withTimeout(3000); // retour etat initial
});
```

### (b) Maestro

```yaml
# .maestro/chat_voice_record.yaml
appId: com.chathouse.app
---
# Permission micro accordee via launchApp permissions (cf. config)
- tapOn:
    accessibilityText: 'Enregistrer un message vocal' # chat.micA11y (FR)
- assertVisible:
    accessibilityText: 'Envoyer le message vocal' # voice.sendA11y
- tapOn:
    accessibilityText: 'Envoyer le message vocal'
- extendedWaitUntil:
    visible:
      accessibilityText: 'Lire le message vocal' # voice.playA11y
    timeout: 8000
```

### (c) Unitaire

```tsx
it('demarre la capture vocale au tap micro', () => {
  const startRecording = jest.fn();
  // mockUseVoiceMessage.mockReturnValue({ state: 'idle', startRecording, ... })
  renderScreen(<ChatDetailScreen />, { routeParams: { conversationId: 'peer-1' } });
  fireEvent.press(screen.getByLabelText(i18n.t('chat.micA11y')));
  expect(startRecording).toHaveBeenCalledTimes(1);
});

it('envoie le clip via useSendVoiceMessage', async () => {
  const upload = jest.fn().mockResolvedValue(undefined);
  // useVoiceMessage → state 'recorded' avec uri ; useSendVoiceMessage → upload
  renderScreen(<ChatDetailScreen />, { routeParams: { conversationId: 'peer-1' } });
  fireEvent.press(screen.getByLabelText(i18n.t('voice.sendA11y')));
  await waitFor(() => expect(upload).toHaveBeenCalled());
});
```

> **Mock natif** : `expo-audio` est stub en unitaire (`useAudioRecorder` no-op dans `jest-setup.ts`) → on mocke `useVoiceMessage` pour piloter l’etat. La **capture audio reelle** (permission micro OS, module natif) est **manuelle sur build EAS** (Expo Go insuffisant, R3). Couvrir : permission refusee (Alert `micNeeded`), echec d’upload (toast, pas de bulle), double-envoi desactive pendant l’upload.

---

## 11. ADMIN — « Resoudre » un signalement (AdminReportsScreen)

**Locator** : `getByLabelText(i18n.t('admin.reports.resolveA11y'))` (« Resoudre ce signalement »). **Destructif** : confirmation `Alert` obligatoire → `POST /admin/reports/:id/resolve {outcome:'resolved'}`. Desactive pendant `busy` (anti-doublon). Compte requis : `admin` / `moderator`.

### (a) Detox

```js
// e2e/admin-reports-resolve.e2e.js  — compte admin
it('resout un signalement ouvert apres confirmation', async () => {
  await element(by.label('admin.home.reports')).tap(); // AdminHome → Reports
  await waitFor(element(by.label('admin.reports.resolveA11y')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('admin.reports.resolveA11y')).tap();
  await element(by.text('Resolve')).atIndex(1).tap(); // bouton de l’Alert
  // la row passe en "resolu" (badge) ou disparait de l’onglet Ouverts
  await waitFor(element(by.label('admin.reports.resolveA11y')))
    .not.toBeVisible()
    .withTimeout(5000);
});
```

### (b) Maestro

```yaml
# .maestro/admin_reports_resolve.yaml
appId: com.chathouse.app
---
- tapOn:
    id: 'admin.home.reports'
- assertVisible:
    id: 'admin.reports.resolveA11y'
- tapOn:
    id: 'admin.reports.resolveA11y'
- tapOn:
    text: 'Resolve' # confirmation Alert
- extendedWaitUntil:
    notVisible:
      id: 'admin.reports.resolveA11y' # retire de l’onglet Ouverts
    timeout: 5000
```

### (c) Unitaire (pattern reel)

```tsx
import { Alert } from 'react-native';

it('resout via Alert de confirmation → POST resolve {resolved}', async () => {
  const resolve = { ...mutationState(), mutate: jest.fn() };
  // mockUseResolveReport.mockReturnValue(resolve) ; useAdminReports → 1 report ouvert
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
    (btns as { onPress?: () => void; style?: string }[])
      .find(b => b.style !== 'cancel')
      ?.onPress?.();
  });
  renderScreen(<AdminReportsScreen />);

  fireEvent.press(await screen.findByLabelText(i18n.t('admin.reports.resolveA11y')));
  await waitFor(() =>
    expect(resolve.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String), outcome: 'resolved' }),
    ),
  );
  alertSpy.mockRestore();
});

it('boutons desactives pendant busy (anti double-resolution)', async () => {
  const resolve = { ...mutationState(), isPending: true };
  renderScreen(<AdminReportsScreen />);
  const btn = await screen.findByLabelText(i18n.t('admin.reports.resolveA11y'));
  expect(btn.props.accessibilityState?.disabled).toBe(true);
});
```

> **data-testid a ajouter** : le bouton « Resolve » de l’Alert porte un texte distinct du bouton de la row (a11y `resolveA11y` vs texte « Resolve ») → en Detox `atIndex(1)` cible l’Alert. **Gating de role** : un compte `USER` ne doit jamais atteindre cet ecran (cf. test « Godmode » gate `appRole >= MODERATOR`).

---

## 12. ADMIN — « Fermer la room » / force-end (AdminRoomsScreen)

**Locator** : `getByLabelText('Fermer la room {room.title}')` (= `t('admin.rooms.closeRoom')` + titre). **Destructif + temps-reel** : `POST /admin/rooms/:id/force-end` ferme le canal LiveKit et ejecte tous les participants. Confirmation (`promptForReason`), anti double-fermeture. Compte : `admin`.

### (a) Detox

```js
// e2e/admin-rooms-forceend.e2e.js  — compte admin
it('force-end une room live et la retire de la liste', async () => {
  await element(by.label('admin.home.rooms')).tap(); // AdminHome → AdminRooms
  await waitFor(element(by.label('Fermer la room Building in public')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Fermer la room Building in public')).tap();
  await element(by.text('Fermer')).atIndex(1).tap(); // confirmation + motif
  await waitFor(element(by.label('Fermer la room Building in public')))
    .not.toBeVisible()
    .withTimeout(6000); // room disparue
});
```

### (b) Maestro

```yaml
# .maestro/admin_rooms_force_end.yaml
appId: com.chathouse.app
---
- tapOn:
    id: 'admin.home.rooms'
- assertVisible:
    accessibilityText: 'Fermer la room Building in public'
- tapOn:
    accessibilityText: 'Fermer la room Building in public'
- tapOn:
    text: 'Fermer' # bouton destructif de l’Alert
- extendedWaitUntil:
    notVisible:
      accessibilityText: 'Fermer la room Building in public'
    timeout: 6000
```

### (c) Unitaire

```tsx
import { Alert } from 'react-native';

it('force-end via Alert → useForceEndRoom avec l’id de la room', async () => {
  const forceEnd = { ...mutationState(), mutate: jest.fn() };
  // mockUseForceEndRoom.mockReturnValue(forceEnd) ; useAdminRooms → 1 room live (room-1)
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
    (btns as { onPress?: () => void; style?: string }[])
      .find(b => b.style === 'destructive')
      ?.onPress?.();
  });
  renderScreen(<AdminRoomsScreen />);

  fireEvent.press(await screen.findByLabelText('Fermer la room Building in public'));
  await waitFor(() =>
    expect(forceEnd.mutate).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'room-1' })),
  );
  alertSpy.mockRestore();
});

it('multi-clic rapide ne declenche qu’une fermeture', async () => {
  const forceEnd = { ...mutationState(), mutate: jest.fn(), isPending: false };
  renderScreen(<AdminRoomsScreen />);
  const btn = await screen.findByLabelText('Fermer la room Building in public');
  fireEvent.press(btn);
  fireEvent.press(btn);
  fireEvent.press(btn);
  // l’Alert ne s’ouvre qu’une fois pertinente ; la garde busy empeche les doublons
  await waitFor(() => expect(forceEnd.mutate.mock.calls.length).toBeLessThanOrEqual(1));
});
```

> **Assertion temps-reel multi-device** : apres force-end cote admin, les **participants** de la room doivent etre ejectes (event `room:ended`) → couvrir en campagne multi-device. **data-testid** : le label inclut le titre (dynamique) ; pour un jeu seede figer le titre ou ajouter `testID="admin-room-${roomId}"`.

---

## 13. ADMIN — « Suspendre » (AdminUserDetailScreen)

**Locator** : `getByLabelText('Suspendre {label}')` (1h / 24h / 7d / Permanente). **Destructif** : coupe l’acces serveur ; payload `{ userId, durationMinutes, reason }` via `Alert.prompt` (motif). Visible si l’acteur a un rang strictement superieur a la cible. Compte : `admin` / `super_admin`.

### (a) Detox

```js
// e2e/admin-suspend.e2e.js  — compte admin, cible USER
it('suspend la cible 1h apres saisie du motif', async () => {
  await element(by.label('admin.users.searchPlaceholder')).typeText('jane');
  await element(by.label('Open Jane Doe')).tap(); // ligne → detail
  await waitFor(element(by.label('Suspendre 1h')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Suspendre 1h')).tap();
  // Alert.prompt (iOS) : saisir le motif puis confirmer
  await element(by.type('UITextField')).typeText('Spam');
  await element(by.text('Suspendre')).tap();
  await waitFor(element(by.label('admin.userDetail.unsuspendBtn')))
    .toBeVisible()
    .withTimeout(6000); // etat suspendu
});
```

### (b) Maestro

```yaml
# .maestro/admin_suspend_user.yaml
appId: com.chathouse.app
---
- tapOn:
    id: 'admin.users.searchPlaceholder'
- inputText: 'jane'
- tapOn:
    accessibilityText: 'Open Jane Doe'
- assertVisible:
    accessibilityText: 'Suspendre 1h'
- tapOn:
    accessibilityText: 'Suspendre 1h'
# Saisie du motif dans l’Alert.prompt puis confirmation
- inputText: 'Spam'
- tapOn:
    text: 'Suspendre'
- assertVisible:
    id: 'admin.userDetail.unsuspendBtn'
```

### (c) Unitaire (pattern reel du depot)

```tsx
import { Alert } from 'react-native';

it('suspends the user when a suspension preset is pressed', async () => {
  const suspend = mutationState();
  // mockUseSuspendUser.mockReturnValue(suspend) ; cible appRole USER, acteur ADMIN
  const promptSpy = jest
    .spyOn(Alert as unknown as { prompt: (...a: unknown[]) => void }, 'prompt')
    .mockImplementation((...a: unknown[]) => {
      const buttons = a[2] as { style?: string; onPress?: (t?: string) => void }[];
      buttons.find(b => b.style === 'destructive')?.onPress?.(undefined); // motif -> defaut
    });

  renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
  fireEvent.press(screen.getByLabelText(`Suspendre ${i18n.t('admin.userDetail.suspend1h')}`));

  await waitFor(() => expect(suspend.mutate as jest.Mock).toHaveBeenCalledTimes(1));
  const [args] = (suspend.mutate as jest.Mock).mock.calls[0];
  expect(args).toEqual(
    expect.objectContaining({ userId: 'u1', reason: 'Moderation', durationMinutes: 60 }),
  );
  promptSpy.mockRestore();
});

it('cache les actions quand l’acteur ne peut pas agir sur la cible (gating)', () => {
  // acteur ADMIN, cible SUPER_ADMIN → rang non strictement superieur
  renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
  expect(screen.getByText(i18n.t('admin.userDetail.noActionPerm'))).toBeTruthy();
  expect(screen.queryByText(i18n.t('admin.userDetail.suspendSection'))).toBeNull();
});
```

> **Note Alert.prompt** : `Alert.prompt` n’existe **que sur iOS** sous jest-expo → le pattern reel pilote le bouton destructif directement. En Detox iOS la saisie passe par `by.type('UITextField')` ; sur **Android** (pas de `Alert.prompt`) le motif transite par un champ custom → ajouter `testID="suspend-reason-input"`. **data-testid** : les boutons de duree sont distingues par leur label (`Suspendre 1h/24h/7d/...`) — stables ; la ligne utilisateur `Open Jane Doe` depend du nom seede.

---

## 14. PROFIL / FOLLOW — « Suivre / Following » (ExtSuggestedFollows + ProfileScreen)

**Locator** : `getByLabelText(i18n.t('extensions.suggested.followUserA11y', 'Follow {{name}}', { name }))` (suggestions) ou `getByRole('button', { name: 'Follow' | 'Following' })` (profil). **Toggle viralite** : `useFollow` (`POST/DELETE /follow/:id`) avec **update optimiste + garde anti-double-follow + rollback** ; invalide `profileKeys`.

### (a) Detox

```js
// e2e/follow.e2e.js
it('suit un utilisateur et bascule le bouton en Following', async () => {
  await waitFor(element(by.label('Follow Jane Doe')))
    .toBeVisible()
    .withTimeout(6000);
  await element(by.label('Follow Jane Doe')).tap();
  await waitFor(element(by.text('Following')))
    .toBeVisible()
    .withTimeout(4000);
});

it('garde anti-double-follow : multi-tap = un seul POST (etat stable)', async () => {
  await element(by.label('Follow Jane Doe')).multiTap(4);
  await waitFor(element(by.text('Following')))
    .toBeVisible()
    .withTimeout(4000);
  // pas de bascule erratique : reste "Following"
  await expect(element(by.text('Following'))).toBeVisible();
});
```

### (b) Maestro

```yaml
# .maestro/follow_toggle.yaml
appId: com.chathouse.app
---
- assertVisible:
    accessibilityText: 'Follow Jane Doe'
- tapOn:
    accessibilityText: 'Follow Jane Doe'
- assertVisible:
    text: 'Following'
```

### (c) Unitaire (pattern reel ExtSuggestedFollows)

```tsx
it('calls onFollow and reflects the followed state in the button', async () => {
  const onFollow = jest.fn().mockResolvedValue(undefined);
  renderScreen(<ExtSuggestedFollowsScreen onFollow={onFollow} />);

  fireEvent.press(
    screen.getByLabelText(
      i18n.t('extensions.suggested.followUserA11y', 'Follow {{name}}', { name: 'Jane Doe' }),
    ),
  );
  expect(onFollow).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Jane Doe' }));
  await waitFor(() =>
    expect(screen.getByText(i18n.t('extensions.suggested.following', 'Following'))).toBeTruthy(),
  );
});

it('garde anti-double-follow : un seul appel malgre le multi-clic', async () => {
  const onFollow = jest.fn().mockResolvedValue(undefined);
  renderScreen(<ExtSuggestedFollowsScreen onFollow={onFollow} />);
  const followLabel = i18n.t('extensions.suggested.followUserA11y', 'Follow {{name}}', {
    name: 'Jane Doe',
  });
  fireEvent.press(screen.getByLabelText(followLabel));
  fireEvent.press(screen.getByLabelText(followLabel));
  await waitFor(() =>
    expect(screen.getByText(i18n.t('extensions.suggested.following', 'Following'))).toBeTruthy(),
  );
  expect(onFollow).toHaveBeenCalledTimes(1);
});
```

> **Rollback** : sur echec reseau, le bouton doit **revenir** a « Follow » (Alert + re-sync via `onError`) → ajouter un test `onFollow` rejette qui verifie le retour a l’etat initial. **data-testid** : le label inclut le nom (`Follow {{name}}`) ; si `displayName` est null, le code retombe sur `username` → risque de label vide a verifier (ajouter `testID="follow-btn-${userId}"` pour les flows E2E deterministes).

---

## 15. Strategie d'automatisation

### 15.1 Quoi en unitaire (Jest + RNTL) vs E2E (Detox / Maestro)

| Niveau                                                         | Cible                                                                                                                                                                                                                      | Boutons de ce document                                                                                                   | Pourquoi                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unitaire / composant** (Jest + RNTL, harness `renderScreen`) | Logique de bouton, branches de role, garde anti-multi-clic, rollback optimiste, etats vide/erreur, validation de formulaire, appels de hook/mutation, `navigation.navigate/goBack/replace`                                 | **Les 14** — un test par bouton minimum (positif + robustesse)                                                           | Rapide, deterministe, mocks complets (LiveKit/socket/axios/audio deja neutralises). Couvre 80 % des axes fonctionnels et de regression. Lancer **feature par feature** en `--runInBand` (PC ~1 Go libre, OOM en parallele). |
| **E2E device** (Detox natif **ou** Maestro)                    | Parcours bout-en-bout reels : tunnel auth complet (Phone→OTP→Username), join→mute→leave room, envoi message + reception, force-end + ejection, suspend + invalidation, deep-links, navigation inter-stacks, permissions OS | #1-#3 (tunnel auth), #4-#8 (parcours room), #9-#10 (chat), #11-#13 (admin destructif sur donnees jetables), #14 (follow) | Valide l’integration reelle (navigation, react-query, backend `:4000`), ce que l’unitaire ne voit pas. **1-2 cas par bouton** (smoke), pas la combinatoire complete.                                                        |
| **Manuel** (build EAS dev-client)                              | Voix LiveKit audible, capture micro reelle, multi-device temps reel (mute force/kick/role/end propages), reseaux 3G/coupure mid-call, accessibilite lecteur d’ecran, FR/EN, fragmentation OS                               | Volets audio de #5, #6, #10 ; volets temps-reel multi-device de #6, #7, #11, #12                                         | Module natif absent en Expo Go (banniere `unsupported`) ; l’audio et le vrai multi-device ne s’automatisent pas de facon fiable (R3).                                                                                       |

> **Regle** : si un comportement depend du **rendu d’un composant + d’un hook mocke**, c’est de l’**unitaire**. S’il depend de la **navigation reelle entre ecrans, du backend, ou d’une permission OS**, c’est de l’**E2E**. La **voix reelle et le multi-device temps reel** restent **manuels**.

### 15.2 Choix Detox vs Maestro

- **Maestro** = smoke quotidienne / PR : flows YAML lisibles, faible maintenance, ideal pour les parcours nominaux (auth, join room, send message, follow). Selection par `id` (testID) recommandee pour la stabilite cross-langue FR/EN.
- **Detox** = scenarios de robustesse necessitant le **controle device** (`setURLBlacklist` pour le hors-ligne/coupure mid-call, `multiTap`, manipulation d’Alert systeme, gestion fine des timeouts) : rollback mute, leave hors-ligne, anti-double-fermeture admin.
- Les deux ciblent le **build EAS dev-client / preview** ; l’audio reste no-op (transport LiveKit en mode test). Ne pas dupliquer : un meme parcours nominal en Maestro **ou** Detox, pas les deux.

### 15.3 Integration CI

```
PR (chaque push)
 ├─ Lint + typecheck (pre-commit husky : eslint --max-warnings 0)
 ├─ Jest unitaire — par feature, --runInBand (contrainte memoire)
 │     npx jest auth   --runInBand
 │     npx jest rooms  --runInBand
 │     npx jest admin  --runInBand   (... 14 features)
 └─ (option) Maestro Cloud — smoke auth + 1 parcours room sur 1 device Android + 1 iOS

Nightly / pre-release
 ├─ Build EAS preview (Android APK + iOS simulateur)
 ├─ Detox e2e (matrice device : Android 10/15, iOS 15/18) — P0 #1-#13
 └─ Rapport : taux d’execution, screenshots d’echec, video (Detox artifacts)
```

- **Gate de merge** : Jest vert (`npm run test:ci`) obligatoire. Maestro smoke non-bloquant en PR (informatif), bloquant en pre-release.
- **Parallelisme** : en CI (RAM suffisante) Jest peut tourner en parallele ; **en local** rester `--runInBand` feature par feature.
- **Flakiness** : les E2E temps-reel doivent utiliser `extendedWaitUntil` / `waitFor(...).withTimeout(...)` (jamais de `sleep` fixe). Retry max 2 sur les E2E, 0 sur l’unitaire.

### 15.4 Gestion des comptes de test

| Compte          | appRole         | Usage automatisation                                                                     |
| --------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `e2e-standard`  | USER            | Auth tunnel, join/quitter room, chat, follow, RSVP.                                      |
| `e2e-host`      | USER            | Host d’une room seede (mute, raise hand, end room).                                      |
| `e2e-moderator` | MODERATOR       | Acces Godmode/Reports sans actions super-admin.                                          |
| `e2e-admin`     | ADMIN           | Force-end room, resolve report, suspend (cible USER).                                    |
| `e2e-super`     | SUPER_ADMIN     | Definir le role, usurper, audit log, suspend SUPER.                                      |
| `e2e-target-*`  | USER (jetables) | **Cibles destructibles** pour suspend/delete/force-end — recreees a chaque run via seed. |

- **Provisioning** : seed deterministe via l’API `:4000` en mode test (script `seed-e2e` avant la suite) → rooms live a titres figes (« Building in public »), conversations avec historique, reports ouverts, users suspendables. Reset entre runs (idempotent).
- **Auth E2E** : injecter un **token de session de test** (ou bypass OTP cote backend test : code fixe `123456`) pour eviter le SMS reel ; le tunnel OTP complet (#1-#3) se teste sur un numero de test avec OTP connu.
- **Isolation** : chaque action destructive (#11-#13) opere sur un `e2e-target-*` **jetable**, jamais sur un compte reutilise — l’ordre de campagne smoke (cf. `02-priorisation.md` §5) joue le RGPD/suppression **en dernier**.
- **Secrets** : tokens et numeros de test en variables CI (jamais commit) ; respecter R11 (token d’invitation jamais logge).

### 15.5 Mock LiveKit / audio en automatisation

| Contexte                | Strategie                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unitaire (Jest)**     | `@livekit/react-native`, `@livekit/react-native-webrtc`, `livekit-client` deja stub dans `jest-setup.ts` (`AudioSession` no-op, `useRoom`/`useParticipant` mockables). `useRoomAudio` / `useRoomSocket` mockes **par test** pour piloter `status`, `setMuted`, `scores`. `expo-audio` data-only. Aucun transport reel.          |
| **E2E (Detox/Maestro)** | Backend `:4000` en **mode test** : delivre des tokens LiveKit valides mais le transport peut etre **route vers un SFU de test ou un no-op** → les **etats** (muted/unmuted, connected/reconnecting, hand raised) sont assertables via l’UI **sans audio reel**. Le label mute/unmute et la bascule d’etat suffisent pour l’E2E. |
| **Reconnexion**         | Detox `setURLBlacklist(['.*livekit.*'])` puis vidage → verifie que le mute **survit** (resnap depuis `currentRoomStore`, pas de hot-unmute).                                                                                                                                                                                    |
| **Voix audible reelle** | **Jamais automatisee** : verifiee **manuellement** sur build EAS dev-client (2-3 devices), avec permission micro reelle, force-mute host, banniere `unsupported` sous Expo Go (R3).                                                                                                                                             |

> **Conclusion** : l’automatisation couvre l’**etat** et la **logique** de l’audio (mute/unmute, raise hand, end/leave), pas le **signal audio**. Le coeur Clubhouse (voix live multi-device) reste un point de **validation manuelle obligatoire** avant chaque livraison, conforme aux criteres « Pret a livrer » du plan (`00-plan-overview.md` §8.3).
