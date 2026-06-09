# 42 - Profil (`profile`)

## Contexte ecran

- **Route** : `Profile`. L'ecran est enregistre dans DEUX stacks (`RoomsStack` et `SettingsStack`) ; la navigation sortante passe toujours par les tabs parents (`RoomsTab` / `SettingsTab`) car c'est la seule forme qui se resout depuis l'un ou l'autre host stack. Parametre optionnel `{ userId?: string }`.
- **Fichier principal** : `src/features/profile/screens/ProfileScreen/ProfileScreen.tsx`.
- **Partials** : `partials/ProfileHeaderBar.tsx` (header back/edit/share/more), `partials/ProfileIdentity.tsx` (avatar, nom, @pseudo copiable, bio, liens sociaux), `partials/ProfileStats.tsx` (compteurs following/followers), `partials/ProfileActionButtons.tsx` (Follow + Wave, autres users), `partials/SelfSections.tsx` (Mes Houses + Rooms recentes, self only).
- **Resolution de l'utilisateur affiche** : `userId = route.params?.userId ?? myId ?? ''` ou `myId = authStore.user?.id ?? meQuery.data?.id`. `isSelf = !!myId && userId === myId`. Si aucun param et `myId` inconnu (auth store en hydratation) → `userId` vide → query desactivee → `Loader`.
- **Roles requis** : `standard` et `admin` (tout compte authentifie). `guest` ne peut pas atteindre l'ecran (sous les stacks proteges). Les actions Follow / Wave / Block / Report agissent au nom du viewer connecte. La vue "self" (edit, Mes Houses, Rooms recentes) ne s'affiche que si `isSelf`.
- **Comportements temps-reel** : AUCUN WebSocket / LiveKit / push direct emis ou recu par cet ecran. Toutes les actions sont REST via `profileService` / `socialService` :
  - Follow/Unfollow → `useFollow`/`useUnfollow` (`POST/DELETE /follow/:userId`). En succes : invalidation de `profileKeys.detail(userId)` puis de tout `profileKeys.all` (rafraichit aussi `me` followingCount et les listes followers/following). En erreur : re-sync du cache + `Alert('Error', 'Action failed. Please try again.')` cote ecran.
  - Wave → `useWave` (`socialService.wave`). Succes → `Alert(t('profile.waveSent'))` = "Wave envoye". Backend renvoie `USER_005` si ping < 1h → `Alert(t('profile.waveRateLimited'))`.
  - Block → `useBlock` (supprime l'arete follow dans les 2 sens, invalide profil + blocked list). Report → `useReport`.
  - Le statut `isOnline` (pastille avatar) et les compteurs reflètent l'etat au dernier fetch : la synchro multi-utilisateur N'EST PAS poussee en temps-reel, elle apparait au prochain refetch (remontage / invalidation / focus). Les cas multi-utilisateur ci-dessous testent cette coherence eventuelle, pas un push instantane.
- **Pre-conditions globales** : compte authentifie ; reseau pour `useProfile(userId)` (`GET` du profil) et pour les mutations. Vue self : `useHouses('mine')` + `useMyRoomHistory(10)`.
- **Etats de donnees pertinents** :
  - **Chargement** : `userId` vide OU `useProfile.isLoading` → `Loader` plein ecran (`accessibilityLabel="Loading profile"`).
  - **Erreur / introuvable** : `isError` ou `!user` → `EmptyState` titre "Profile unavailable", description "This user may not exist.".
  - **Profil autre user** : header back + share + more ; identite ; stats ; boutons Follow + Wave. PAS de sections self.
  - **Profil self** : header back + edit + share (PAS de more) ; identite ; stats ; PAS de Follow/Wave ; sections "Mes Houses" et "Rooms recentes".
  - **Bio** : tronquee a 3 lignes si > 120 caracteres → bouton "Voir plus"/"Voir moins". Absente → bloc bio non rendu.
  - **Liens sociaux** : Twitter / Instagram rendus uniquement si la valeur correspondante existe.
  - **Houses self** : loading → "…", vide → "Aucun House pour l'instant.", sinon 5 lignes max + "Tout voir" (visible seulement si au moins 1 house).
  - **Rooms self** : loading → "…", vide → "Aucune room hostee pour l'instant.", sinon liste des lignes.
  - **Hors-ligne** : echec mutation Follow/Unfollow → `Alert('Error', ...)` ; Wave hors-ligne → echec silencieux sauf code `USER_005` ; query peut servir le cache (donnees periment) ou tomber en erreur.

## Matrice bouton

| #   | Bouton                       | Emplacement                          | Type                          | Locator reel                                                                                                        | Pre-condition                      | Priorite |
| --- | ---------------------------- | ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| 1   | Retour                       | Header (gauche)                      | navigation                    | `accessibilityLabel="Back"` (icone MaterialIcons `arrow-back`, role `button`, `hitSlop={8}`)                        | Ecran monte                        | P1       |
| 2   | Modifier le profil           | Header (droite, self only)           | navigation                    | `accessibilityLabel = t('profile.editProfile')` = "Modifier le profil" (icone `edit`, role `button`)                | `isSelf === true`                  | P1       |
| 3   | Partager le profil           | Header (droite)                      | submit (Share sheet)          | `accessibilityLabel="Share profile"` (icone `share`, role `button`)                                                 | `user` charge                      | P1       |
| 4   | Plus (Bloquer/Signaler)      | Header (droite, autres users)        | menu                          | `accessibilityLabel = t('profile.more')` = "Plus" (icone `more-horiz`, role `button`)                               | `isSelf === false`, `user` charge  | P1       |
| 5   | Copier le pseudo             | Corps (identite, sous le nom)        | icon / action                 | Pressable role `button`, texte visible `@{username}` (declenche `handleCopyUsername`)                               | `user.username` present            | P2       |
| 6   | Voir plus / Voir moins (bio) | Corps (sous la bio)                  | toggle                        | texte `t('profile.seeMore')` = "Voir plus" / `t('profile.seeLess')` = "Voir moins"                                  | bio > 120 caracteres (`isBioLong`) | P2       |
| 7   | Lien Twitter / X             | Corps (identite, ligne sociale)      | link                          | `accessibilityRole="link"`, `accessibilityLabel = "Twitter @{handle}"` (icone FontAwesome `twitter`)                | `user.twitter` present             | P2       |
| 8   | Lien Instagram               | Corps (identite, ligne sociale)      | link                          | `accessibilityRole="link"`, `accessibilityLabel = "Instagram @{handle}"` (icone FontAwesome `instagram`)            | `user.instagram` present           | P2       |
| 9   | Compteur Abonnements         | Corps (stats, gauche)                | navigation                    | `accessibilityRole="button"`, `accessibilityLabel = "{value} Following"` (ex. "34 Following")                       | `user` charge                      | P1       |
| 10  | Compteur Abonnes             | Corps (stats, droite)                | navigation                    | `accessibilityRole="button"`, `accessibilityLabel = "{value} Followers"` (ex. "12 Followers")                       | `user` charge                      | P1       |
| 11  | Suivre / Following           | Corps (barre d'action, autres users) | submit / follow               | composant `Button`, label `Follow` (non suivi) ou `Following` (suivi) ; `loading` lie a follow/unfollow `isPending` | `isSelf === false`, reseau         | P1       |
| 12  | Wave 🌊                      | Corps (barre d'action, autres users) | realtime-action (ping social) | Pressable role `button`, `accessibilityLabel = t('profile.wave')` = "Wave" ; `disabled` si `waveLoading`            | `isSelf === false`, reseau         | P1       |
| 13  | Tout voir (Houses)           | Corps (section Mes Houses, self)     | navigation                    | Pressable role `button`, texte `t('profile.seeAll')` = "Tout voir", `hitSlop={8}`                                   | `isSelf` et au moins 1 house       | P2       |
| 14  | Ligne House                  | Corps (cellule liste, self)          | list-item / navigation        | Pressable role `button`, `accessibilityLabel = house.name` (icone `chevron-right`)                                  | `isSelf`, houses non vide          | P1       |
| 15  | Ligne Room recente           | Corps (cellule liste, self)          | list-item / navigation        | Pressable role `button`, `accessibilityLabel = room.title` (icone `chevron-right`)                                  | `isSelf`, historique non vide      | P1       |

> Note : il n'y a NI FAB, NI champ de saisie soumissible, NI swipe/long-press, NI pull-to-refresh, NI lien legal sur cet ecran. Le ScrollView ne porte pas de `RefreshControl`. Les Alert de Block (`profile.blockConfirmTitle`/`blockConfirm`/`cancel`) et Report (`profile.reportTitle` + liste `profile.reasons.*` + `cancel`) sont des `Alert.alert` natifs declenches depuis le menu "Plus" — testes via leurs intitules i18n dans les cas associes au bouton 4. Les compteurs sans handler degradent en `View` (non focusable) — ici les deux ont un handler donc sont bien des boutons.

## Cas de test

### PROF-VIEW-001 - Retour ferme l'ecran profil

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, Wi-Fi, ecran `Profile` ouvert depuis un autre ecran (pile avec ecran precedent).
- **Etapes** :
  1. Ouvrir un profil (autre user) depuis une room ou une recherche.
  2. Taper l'icone Retour (`accessibilityLabel="Back"`) en haut a gauche.
  3. Observer la navigation.
- **Resultat attendu** : `navigation.goBack()` appele ; retour a l'ecran precedent ; aucun crash, aucune requete reseau supplementaire.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent s'affiche apres le tap ; KO si l'ecran reste ou crash.
- **Donnees de test** : `routeParams = { userId: 'other-1' }`.
- **Duree estimee** : 2 min

### PROF-VIEW-002 - Retour : multi-clic rapide ne sur-pop pas la pile

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, latence reseau elevee (4G degradee simulee), ecran ouvert.
- **Etapes** :
  1. Taper tres rapidement 4 a 5 fois l'icone Retour.
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul retour effectif ; on n'atterrit pas deux ecrans en arriere ; pas d'ecran blanc / crash.
- **Critere d'acceptation (OK/KO)** : OK si on revient exactement sur l'ecran precedent ; KO si l'app pop trop ou crashe.
- **Donnees de test** : N/A (navigation pure).
- **Duree estimee** : 3 min

### PROF-VIEW-003 - Retour : accessibilite lecteur d'ecran et police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; police systeme au max ; contraste eleve.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'a l'element Retour.
  3. Ecouter l'annonce, puis double-taper.
- **Resultat attendu** : annonce "Back, bouton" ; element focusable et atteignable ; le double-tap declenche `goBack`. Le header reste lisible en police max sans chevauchement avec les icones de droite.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce contient le label "Back" + role bouton ET le double-tap revient en arriere ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### PROF-VIEW-004 - Modifier le profil ouvre EditProfile (self)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, viewing son propre profil (`isSelf`), Wi-Fi.
- **Etapes** :
  1. Ouvrir son propre profil (Profil sans param ou avec `userId == myId`).
  2. Verifier la presence de l'icone crayon (`accessibilityLabel = "Modifier le profil"`).
  3. Taper l'icone.
- **Resultat attendu** : `navigation.navigate('SettingsTab', { screen: 'EditProfile' })` ; l'ecran EditProfile s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si EditProfile s'affiche ; KO si rien ou mauvais ecran.
- **Donnees de test** : `routeParams = { userId: 'me-1' }`, auth user id `me-1`.
- **Duree estimee** : 2 min

### PROF-VIEW-005 - Modifier le profil : absent sur le profil d'un autre + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil d'un AUTRE user ouvert (`isSelf === false`).
- **Etapes** :
  1. Ouvrir le profil d'un autre user (`userId != myId`).
  2. Verifier qu'aucune icone "Modifier le profil" n'est rendue dans le header.
  3. Sur son propre profil, taper rapidement 3 fois le crayon (latence simulee).
- **Resultat attendu** : sur un autre profil, l'affordance edit est absente (aucun crayon). Sur son propre profil, les taps multiples n'empilent qu'une seule navigation EditProfile (pas de double push).
- **Critere d'acceptation (OK/KO)** : OK si edit absent pour autrui ET un seul EditProfile empile ; KO sinon.
- **Donnees de test** : autre user `routeParams = { userId: 'other-1' }`.
- **Duree estimee** : 3 min

### PROF-VIEW-006 - Modifier le profil : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : self, TalkBack/VoiceOver actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a l'icone crayon.
  2. Ecouter l'annonce et double-taper.
- **Resultat attendu** : annonce "Modifier le profil, bouton" (label i18n + role button) ; double-tap ouvre EditProfile.
- **Critere d'acceptation (OK/KO)** : OK si annonce = label "Modifier le profil" + role bouton ET ouverture ; KO sinon.
- **Donnees de test** : `routeParams = { userId: 'me-1' }`.
- **Duree estimee** : 3 min

### PROF-VIEW-007 - Partager le profil ouvre la feuille de partage

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, `user` charge avec `username`, Wi-Fi.
- **Etapes** :
  1. Ouvrir un profil.
  2. Taper l'icone Partager (`accessibilityLabel="Share profile"`).
  3. Observer la feuille de partage native.
- **Resultat attendu** : `Share.share` invoque avec `title = "@username"`, `message = "@username sur Chathouse — https://app.chathouse.com/u/{username}"`, `url` identique. La feuille systeme s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si la feuille de partage s'ouvre avec le bon lien contenant le username/id ; KO sinon.
- **Donnees de test** : user `{ username: 'ada', id: 'other-1' }` → url `https://app.chathouse.com/u/ada`.
- **Duree estimee** : 3 min

### PROF-VIEW-008 - Partager : annulation et multi-clic rapide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard, profil ouvert. Cas additionnel : profil sans `username` (fallback `displayName`/`id`).
- **Etapes** :
  1. Taper Partager puis fermer/annuler la feuille systeme sans partager.
  2. Verifier qu'aucune erreur n'est affichee (le `catch` est un no-op).
  3. Taper Partager 4 fois rapidement.
  4. Ouvrir un profil sans `username` et taper Partager.
- **Resultat attendu** : l'annulation ne provoque ni toast ni crash. Le multi-clic n'ouvre qu'une feuille (l'OS gere la file). Sans username, l'url utilise `user.id` et le titre vaut `displayName`.
- **Critere d'acceptation (OK/KO)** : OK si aucune erreur a l'annulation, une seule feuille, fallback id correct ; KO sinon.
- **Donnees de test** : user sans username `{ username: null, id: 'other-9', displayName: 'No Handle' }` → url `https://app.chathouse.com/u/other-9`.
- **Duree estimee** : 4 min

### PROF-VIEW-009 - Partager : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : profil ouvert, TalkBack/VoiceOver actif, police max.
- **Etapes** :
  1. Balayer jusqu'a l'icone Partager.
  2. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce "Share profile, bouton" ; double-tap ouvre la feuille de partage.
- **Critere d'acceptation (OK/KO)** : OK si annonce = "Share profile" + role bouton ET ouverture ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min

### PROF-VIEW-010 - Menu Plus ouvre Bloquer / Signaler

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil d'un AUTRE user ouvert (`isSelf === false`), Wi-Fi.
- **Etapes** :
  1. Ouvrir le profil d'un autre user.
  2. Taper l'icone "Plus" (`accessibilityLabel = "Plus"`).
  3. Observer l'Alert natif.
- **Resultat attendu** : `Alert` titre "Plus", sous-titre `@username` ; actions : "Bloquer" (destructive), "Signaler", "Annuler" (cancel).
- **Critere d'acceptation (OK/KO)** : OK si les 3 actions Bloquer/Signaler/Annuler apparaissent ; KO sinon.
- **Donnees de test** : user `{ username: 'ada' }`.
- **Duree estimee** : 2 min

### PROF-VIEW-011 - Bloquer : confirmation et appel mutation

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, autre profil ouvert, Wi-Fi.
- **Etapes** :
  1. Taper "Plus" → "Bloquer".
  2. Sur l'Alert "Bloquer {handle} ?" / "Vous ne vous verrez plus ni l'un ni l'autre.", taper "Bloquer".
- **Resultat attendu** : `block.mutate(user.id)` appele ; en succes, invalidation `profileKeys.detail(userId)` + `profileKeys.all` + blocked list ; le profil/relations se mettent a jour au refetch.
- **Critere d'acceptation (OK/KO)** : OK si `block.mutate` est appele avec l'id cible apres confirmation ; KO si appele sans confirmation ou jamais.
- **Donnees de test** : user `{ id: 'other-1', username: 'ada' }`.
- **Duree estimee** : 3 min

### PROF-VIEW-012 - Bloquer/Signaler : annulation + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, autre profil ouvert. Sous-cas hors-ligne (Airplane mode).
- **Etapes** :
  1. Taper "Plus" → "Bloquer" → "Annuler" : verifier qu'aucune mutation n'est emise.
  2. Passer hors-ligne, taper "Plus" → "Signaler" → choisir "Spam".
  3. Reactiver le reseau et reobserver.
- **Resultat attendu** : l'annulation n'emet aucun `block.mutate`. En hors-ligne, `report.mutate` echoue silencieusement (pas de toast succes) ; en succes (reseau revenu) `Alert(t('profile.reportThanks'))` = "Merci — notre equipe va verifier.".
- **Critere d'acceptation (OK/KO)** : OK si annulation = aucune mutation ET report n'affiche le toast de remerciement qu'en cas de succes reel ; KO sinon.
- **Donnees de test** : reason `'spam'`, payload `{ userId: 'other-1', input: { reason: 'spam' } }`.
- **Duree estimee** : 5 min

### PROF-VIEW-013 - Menu Plus / Bloquer : accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : autre profil ouvert, TalkBack/VoiceOver actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a l'icone "Plus", ecouter l'annonce, double-taper.
  2. Naviguer dans l'Alert au lecteur d'ecran jusqu'a "Bloquer" (destructive).
- **Resultat attendu** : "Plus, bouton" annonce ; l'Alert natif est entierement lu par le lecteur d'ecran ; l'action destructive "Bloquer" est annoncee comme telle ; le focus reste piège dans l'alerte.
- **Critere d'acceptation (OK/KO)** : OK si menu + actions lus correctement au lecteur d'ecran ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### PROF-VIEW-014 - Copier le pseudo dans le presse-papier

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : profil avec `username`, Wi-Fi (offline acceptable, clipboard local).
- **Etapes** :
  1. Ouvrir un profil avec username.
  2. Taper le texte `@{username}` sous le nom.
- **Resultat attendu** : `ExpoClipboard.setStringAsync('@username')` appele ; retour haptique succes ; `Alert(t('profile.copied'), t('profile.usernameCopied'))` = "Copie" / "Pseudo copie dans le presse-papier".
- **Critere d'acceptation (OK/KO)** : OK si le presse-papier contient `@username` ET l'Alert s'affiche ; KO sinon.
- **Donnees de test** : user `{ username: 'ada' }` → presse-papier `@ada`.
- **Duree estimee** : 2 min

### PROF-VIEW-015 - Copier le pseudo : pas de username + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : profil sans `username` (cas limite), puis profil avec username.
- **Etapes** :
  1. Sur un profil sans username, taper la zone (si rendue).
  2. Sur un profil avec username, taper 5 fois rapidement.
- **Resultat attendu** : sans username, `handleCopyUsername` retourne tot (guard `if (!user?.username) return`) → aucun Alert, aucun crash. Multi-clic : copie idempotente (`@username` reste correct), Alert peut s'empiler une fois mais sans effet de bord.
- **Critere d'acceptation (OK/KO)** : OK si aucune action sans username ET copie correcte au multi-clic ; KO si crash ou contenu errone.
- **Donnees de test** : user sans username `{ username: null }`.
- **Duree estimee** : 3 min

### PROF-VIEW-016 - Copier le pseudo : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : profil avec username, TalkBack/VoiceOver actif, police max.
- **Etapes** :
  1. Balayer jusqu'au texte `@username`.
  2. Ecouter l'annonce et double-taper.
- **Resultat attendu** : l'element est annonce comme bouton contenant "@username" ; double-tap copie le pseudo et declenche l'Alert. Le texte reste lisible en police agrandie.
- **Critere d'acceptation (OK/KO)** : OK si role bouton annonce ET double-tap copie ; KO sinon.
- **Donnees de test** : user `{ username: 'ada' }`.
- **Duree estimee** : 3 min

### PROF-VIEW-017 - Voir plus / Voir moins deplie la bio

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : profil dont la bio fait plus de 120 caracteres (`isBioLong`).
- **Etapes** :
  1. Ouvrir le profil ; verifier que la bio est tronquee a 3 lignes et que "Voir plus" est visible.
  2. Taper "Voir plus".
  3. Taper "Voir moins".
- **Resultat attendu** : "Voir plus" deplie la bio (numberOfLines undefined) et l'intitule devient "Voir moins" ; "Voir moins" la retronque a 3 lignes.
- **Critere d'acceptation (OK/KO)** : OK si la bascule deplie/retronque correctement et change l'intitule ; KO sinon.
- **Donnees de test** : bio de 200 caracteres (> 120).
- **Duree estimee** : 2 min

### PROF-VIEW-018 - Bio : bouton absent quand bio courte + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : profil avec bio courte (<= 120 car.), puis bio longue.
- **Etapes** :
  1. Sur un profil a bio courte, verifier qu'aucun "Voir plus" n'est rendu.
  2. Sur un profil a bio absente, verifier que le bloc bio entier n'est pas rendu.
  3. Sur bio longue, taper "Voir plus"/"Voir moins" rapidement 6 fois.
- **Resultat attendu** : pas de bouton pour bio courte ; pas de bloc pour bio absente ; le multi-clic alterne l'etat de maniere coherente sans flicker bloquant ni crash.
- **Critere d'acceptation (OK/KO)** : OK si presence/absence conformes ET bascule stable au multi-clic ; KO sinon.
- **Donnees de test** : bio courte "Mathematician" (13 car.), bio vide `""`.
- **Duree estimee** : 3 min

### PROF-VIEW-019 - Bio : accessibilite (police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : profil a bio longue, TalkBack/VoiceOver actif, police max.
- **Etapes** :
  1. Balayer la bio puis le bouton "Voir plus".
  2. Double-taper pour deplier.
- **Resultat attendu** : la bio complete est lisible une fois depliee, sans coupure en police max ; le bouton est annonce et son intitule passe a "Voir moins".
- **Critere d'acceptation (OK/KO)** : OK si la bio depliee est entierement lisible ET le bouton bascule ; KO sinon.
- **Donnees de test** : bio 200 car.
- **Duree estimee** : 3 min

### PROF-VIEW-020 - Lien Twitter ouvre l'app / le navigateur

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : profil avec `twitter` valide, app Twitter/X installee (sinon fallback web), Wi-Fi.
- **Etapes** :
  1. Ouvrir un profil avec un handle Twitter.
  2. Taper l'icone Twitter (`accessibilityLabel = "Twitter @{handle}"`).
- **Resultat attendu** : `openTwitterHandle` tente `twitter://user?screen_name={handle}` ; si non ouvrable → fallback `https://x.com/{handle}`. Le '@' eventuel est strippe.
- **Critere d'acceptation (OK/KO)** : OK si l'app/le navigateur ouvre le bon profil X ; KO sinon.
- **Donnees de test** : `twitter: '@ada'` → handle `ada` → `https://x.com/ada`.
- **Duree estimee** : 3 min

### PROF-VIEW-021 - Liens sociaux : handle invalide + lien absent

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : profil sans twitter ni instagram ; profil avec handle malforme.
- **Etapes** :
  1. Profil sans reseaux : verifier que la ligne sociale n'est PAS rendue.
  2. Profil avec twitter `"a b!"` (espaces/caracteres interdits) : taper l'icone.
  3. Taper rapidement le lien Instagram 4 fois (profil valide).
- **Resultat attendu** : ligne sociale absente si ni twitter ni instagram. Handle invalide → `sanitizeHandle` renvoie null → `return` precoce, aucune ouverture, aucun crash. Multi-clic Instagram n'ouvre qu'une fois la cible.
- **Critere d'acceptation (OK/KO)** : OK si absence conforme, handle invalide ignore sans crash, multi-clic non bloquant ; KO sinon.
- **Donnees de test** : `twitter: 'a b!'`, instagram valide `'ada_codes'`.
- **Duree estimee** : 4 min

### PROF-VIEW-022 - Liens sociaux : accessibilite (role link)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : profil avec twitter ET instagram, TalkBack/VoiceOver actif.
- **Etapes** :
  1. Balayer jusqu'aux icones Twitter puis Instagram.
  2. Ecouter les annonces et double-taper l'un d'eux.
- **Resultat attendu** : chaque icone annoncee "Twitter @handle, lien" / "Instagram @handle, lien" (`accessibilityRole="link"`) ; double-tap ouvre la cible.
- **Critere d'acceptation (OK/KO)** : OK si role link + label handle annonces ET ouverture ; KO sinon.
- **Donnees de test** : `twitter: 'ada'`, `instagram: 'ada_codes'`.
- **Duree estimee** : 3 min

### PROF-VIEW-023 - Compteur Abonnements ouvre Followers (onglet following)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : profil charge (self ou autre), Wi-Fi.
- **Etapes** :
  1. Ouvrir un profil.
  2. Taper la colonne "Following" (`accessibilityLabel = "{value} Following"`).
- **Resultat attendu** : `navigation.navigate('SettingsTab', { screen: 'Followers', params: { userId, initialTab: 'following' } })`.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran Followers s'ouvre sur l'onglet Abonnements pour le bon userId ; KO sinon.
- **Donnees de test** : user `{ id: 'me-1', followingCount: 34 }` → label "34 Following".
- **Duree estimee** : 2 min

### PROF-VIEW-024 - Compteur Abonnes ouvre Followers (onglet followers) + format k

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : profil charge, Wi-Fi.
- **Etapes** :
  1. Ouvrir un profil avec followersCount >= 1000.
  2. Verifier le format compact (ex. 1.2k) dans le label.
  3. Taper la colonne "Followers".
- **Resultat attendu** : compteur >= 1000 affiche en `{n/1000}.1k` (ex. 1200 → "1.2k") et le label devient "1.2k Followers" ; le tap navigue vers Followers, `initialTab: 'followers'`.
- **Critere d'acceptation (OK/KO)** : OK si format k correct ET navigation onglet followers ; KO sinon.
- **Donnees de test** : `followersCount: 1200` → "1.2k".
- **Duree estimee** : 3 min

### PROF-VIEW-025 - Compteurs : multi-clic rapide + accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : profil charge, TalkBack/VoiceOver actif, police max. Sous-cas multi-clic en latence.
- **Etapes** :
  1. Balayer jusqu'a "Following" puis "Followers", ecouter les annonces.
  2. Double-taper "Followers".
  3. En latence reseau, taper 4 fois rapidement "Followers".
- **Resultat attendu** : annonces "{value} Following / Followers, bouton" (role button via ProfileStats) ; le double-tap navigue ; le multi-clic n'empile qu'une navigation vers Followers.
- **Critere d'acceptation (OK/KO)** : OK si labels lus + navigation unique au multi-clic ; KO sinon.
- **Donnees de test** : `followingCount: 34`, `followersCount: 12`.
- **Duree estimee** : 4 min

### PROF-VIEW-026 - Suivre un utilisateur (Follow)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil d'un autre user non suivi (`isFollowedByMe: false`), Wi-Fi.
- **Etapes** :
  1. Ouvrir le profil d'un autre user.
  2. Verifier le bouton libelle "Follow".
  3. Taper "Follow".
- **Resultat attendu** : `follow.mutate(user.id, { onError })` appele ; en succes, invalidation `profileKeys.detail(userId)` + `profileKeys.all` ; le bouton passe a "Following" et followersCount augmente au refetch.
- **Critere d'acceptation (OK/KO)** : OK si `follow.mutate` est appele avec l'id cible et le bouton bascule ; KO sinon.
- **Donnees de test** : user `{ id: 'other-1', isFollowedByMe: false }`.
- **Duree estimee** : 2 min

### PROF-VIEW-027 - Unfollow puis erreur reseau (Alert) + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil d'un user deja suivi (`isFollowedByMe: true`). Sous-cas hors-ligne.
- **Etapes** :
  1. Verifier le bouton "Following".
  2. Passer hors-ligne, taper "Following".
  3. Reactiver le reseau ; taper 5 fois rapidement le bouton Follow/Unfollow.
- **Resultat attendu** : `unfollow.mutate(user.id, { onError })` appele ; en echec, `onError` declenche `Alert('Error', 'Action failed. Please try again.')` et `useUnfollow.onError` re-sync le cache (le bouton revient a l'etat serveur). Le `loading` (isPending) doit empecher les mutations en rafale incoherentes ; au pire un seul aller-retour effectif visible.
- **Critere d'acceptation (OK/KO)** : OK si Alert d'erreur affiche en hors-ligne ET pas d'etat incoherent apres multi-clic ; KO sinon.
- **Donnees de test** : user `{ id: 'other-1', isFollowedByMe: true }`.
- **Duree estimee** : 5 min

### PROF-VIEW-028 - Follow : accessibilite et etat loading

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : autre profil, TalkBack/VoiceOver actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton Follow/Following, ecouter l'annonce.
  2. Double-taper et observer l'etat loading.
- **Resultat attendu** : le bouton est annonce avec son libelle "Follow"/"Following" + role bouton ; pendant `followLoading` le spinner s'affiche et l'etat occupe est percevable ; le label reste lisible en police max.
- **Critere d'acceptation (OK/KO)** : OK si label + role annonces ET loading percevable ; KO sinon.
- **Donnees de test** : user `{ isFollowedByMe: false }`.
- **Duree estimee** : 3 min

### PROF-VIEW-029 - Follow : synchro multi-utilisateur (coherence eventuelle)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes (A = viewer, B = cible) sur deux appareils ; A et B regardent le profil de B / leurs listes respectives.
- **Etapes** :
  1. Sur l'appareil A, taper "Follow" sur le profil de B.
  2. Sur A, observer le bouton et followersCount apres invalidation.
  3. Sur l'appareil B, rafraichir (remontage / focus) son ecran Followers.
- **Resultat attendu** : aucun push WebSocket/LiveKit (par design) ; cote A le bouton passe "Following" et le compteur monte apres refetch declenche par `profileKeys.all` ; cote B, A apparait dans ses abonnes seulement apres un refetch (focus/remontage), pas instantanement.
- **Critere d'acceptation (OK/KO)** : OK si la coherence est atteinte apres refetch des deux cotes (sans exiger d'instantaneite) ; KO si l'etat reste durablement divergent.
- **Donnees de test** : A `me-1`, B `other-1`.
- **Duree estimee** : 6 min

### PROF-VIEW-030 - Wave envoie un signal a l'utilisateur

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil d'un autre user, Wi-Fi, pas de wave envoye dans la derniere heure.
- **Etapes** :
  1. Ouvrir le profil d'un autre user.
  2. Taper le bouton Wave 🌊 (`accessibilityLabel = "Wave"`).
- **Resultat attendu** : `wave.mutate(user.id, ...)` ; en succes `Alert(t('profile.waveSent'))` = "Wave envoye 🌊".
- **Critere d'acceptation (OK/KO)** : OK si `wave.mutate` appele avec l'id cible ET Alert de confirmation ; KO sinon.
- **Donnees de test** : user `{ id: 'other-1' }`.
- **Duree estimee** : 2 min

### PROF-VIEW-031 - Wave : rate-limit USER_005 + multi-clic + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, autre profil. Sous-cas : wave deja envoye < 1h ; sous-cas hors-ligne.
- **Etapes** :
  1. Taper Wave une 1re fois (succes attendu).
  2. Retaper Wave immediatement (backend renvoie `USER_005`).
  3. Taper Wave 5 fois tres rapidement (verifier `disabled` pendant `waveLoading`).
  4. Passer hors-ligne et taper Wave.
- **Resultat attendu** : au 2e envoi (<1h) → `Alert(t('profile.waveRateLimited'))` = "Deja envoye recemment — reessaie plus tard.". Le bouton est `disabled` tant que `waveLoading` → pas de spam d'appels. Hors-ligne → echec sans toast de succes ; pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si rate-limit affiche l'Alert dedie ET le multi-clic ne lance pas plusieurs mutations concurrentes ; KO sinon.
- **Donnees de test** : reponse erreur `{ response: { data: { error: { code: 'USER_005' } } } }`.
- **Duree estimee** : 5 min

### PROF-VIEW-032 - Wave : accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : autre profil, TalkBack/VoiceOver actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton Wave, ecouter l'annonce.
  2. Double-taper.
- **Resultat attendu** : le bouton est annonce "Wave, bouton" (label i18n, role button) ; l'emoji 🌊 n'altere pas l'annonce du label ; `disabled` percevable pendant l'envoi ; double-tap declenche le wave.
- **Critere d'acceptation (OK/KO)** : OK si label "Wave" + role bouton annonces ET action declenchee ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min

### PROF-VIEW-033 - Wave : synchro multi-utilisateur (reception cote cible)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes A (viewer) et B (cible) sur deux appareils ; notifications activees cote B.
- **Etapes** :
  1. Sur A, envoyer un Wave a B.
  2. Cote B, verifier la reception (notification / liste d'activite, selon backend) au prochain refetch ou push.
- **Resultat attendu** : A voit "Wave envoye 🌊" ; B recoit le signal cote serveur (cet ecran n'emet pas de WebSocket : la livraison cote B depend du backend/push, pas d'un push direct depuis ProfileScreen). Pas de double-livraison si A retape (rate-limit USER_005).
- **Critere d'acceptation (OK/KO)** : OK si A confirme l'envoi ET B recoit un seul signal (pas de doublon malgre retap) ; KO sinon.
- **Donnees de test** : A `me-1`, B `other-1`.
- **Duree estimee** : 6 min

### PROF-VIEW-034 - Tout voir (Houses) ouvre HouseList (self)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, profil self, au moins 1 house dans `useHouses('mine')`, Wi-Fi.
- **Etapes** :
  1. Ouvrir son propre profil.
  2. Dans la section "Mes Houses", taper "Tout voir".
- **Resultat attendu** : `navigation.navigate('RoomsTab', { screen: 'HouseList' })` ; HouseList s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si HouseList s'affiche ; KO sinon.
- **Donnees de test** : `useHouses('mine').data = [ { id: 'h1', name: 'Tech' } ]`.
- **Duree estimee** : 2 min

### PROF-VIEW-035 - Tout voir : absent quand 0 house + accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : profil self, TalkBack/VoiceOver actif. Sous-cas : 0 house.
- **Etapes** :
  1. Avec 0 house, verifier que "Tout voir" n'est PAS rendu et que "Aucun House pour l'instant." s'affiche.
  2. Avec >= 1 house, balayer jusqu'a "Tout voir" et double-taper.
- **Resultat attendu** : "Tout voir" absent quand `houses.length === 0` ; sinon il est annonce comme bouton ("Tout voir") et le double-tap ouvre HouseList. Police max : texte lisible.
- **Critere d'acceptation (OK/KO)** : OK si presence conditionnee a >= 1 house ET annonce/role corrects ; KO sinon.
- **Donnees de test** : data `[]` puis `[{ id:'h1', name:'Tech' }]`.
- **Duree estimee** : 3 min

### PROF-VIEW-036 - Ligne House ouvre HouseDetail (self)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : profil self, au moins 1 house, Wi-Fi.
- **Etapes** :
  1. Ouvrir son profil.
  2. Dans "Mes Houses", taper une ligne House (`accessibilityLabel = house.name`).
- **Resultat attendu** : `navigation.navigate('RoomsTab', { screen: 'HouseDetail', params: { houseId } })` avec l'id de la house tapee ; HouseDetail s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si HouseDetail s'ouvre avec le bon `houseId` ; KO sinon.
- **Donnees de test** : house `{ id: 'h1', name: 'Tech Builders' }`.
- **Duree estimee** : 2 min

### PROF-VIEW-037 - Lignes House/Room : multi-clic + chargement/vide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : profil self. Sous-cas loading puis vide.
- **Etapes** :
  1. Pendant le chargement (`housesLoading`/`roomsLoading`), verifier l'affichage "…" et l'absence de lignes tapables.
  2. En etat vide, verifier les messages "Aucun House pour l'instant." / "Aucune room hostee pour l'instant.".
  3. Avec data, taper une ligne House 5 fois tres rapidement (latence).
  4. Verifier qu'au plus 5 lignes House sont rendues (slice 0..5) meme avec 12 houses.
- **Resultat attendu** : pas de lignes pendant le chargement ; messages vides corrects ; le multi-clic n'empile qu'une seule navigation HouseDetail ; seules 5 lignes House au maximum (le reste via "Tout voir").
- **Critere d'acceptation (OK/KO)** : OK si etats loading/vide conformes, max 5 houses, navigation unique au multi-clic ; KO sinon.
- **Donnees de test** : 12 houses → 5 affichees ; rooms `[]` → message vide.
- **Duree estimee** : 5 min

### PROF-VIEW-038 - Ligne Room recente ouvre Room (self)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : profil self, historique de rooms non vide (`useMyRoomHistory(10)`), Wi-Fi.
- **Etapes** :
  1. Ouvrir son profil.
  2. Dans "Rooms recentes", taper une ligne (`accessibilityLabel = room.title`).
- **Resultat attendu** : `navigation.navigate('RoomsTab', { screen: 'Room', params: { roomId } })` avec l'id de la room tapee ; l'ecran Room s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran Room s'ouvre avec le bon `roomId` ; KO sinon.
- **Donnees de test** : room `{ id: 'r1', title: 'Design Crit' }`.
- **Duree estimee** : 2 min

### PROF-VIEW-039 - Lignes House/Room : accessibilite (lecteur d'ecran + police max)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : profil self avec houses et rooms, TalkBack/VoiceOver actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a une ligne House puis une ligne Room.
  2. Ecouter les annonces et double-taper l'une d'elles.
- **Resultat attendu** : chaque ligne est annoncee avec son label (nom de la house / titre de la room) + role bouton ; les sous-titres (membres/privacy, speakers/listeners) restent lisibles en police max sans troncature bloquante (`numberOfLines={1}` mais valeurs courtes) ; double-tap navigue.
- **Critere d'acceptation (OK/KO)** : OK si lignes annoncees comme boutons avec leur titre ET navigation au double-tap ; KO sinon.
- **Donnees de test** : house `{ name: 'Tech Builders' }`, room `{ title: 'Design Crit' }`.
- **Duree estimee** : 4 min

### PROF-VIEW-040 - Etats Loader / EmptyState de l'ecran

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard. Sous-cas : auth en hydratation (userId vide), chargement profil, erreur profil.
- **Etapes** :
  1. Ouvrir l'ecran sans param et avec `myId` indisponible → verifier le `Loader` ("Loading profile").
  2. Forcer `useProfile.isLoading` → verifier le `Loader`.
  3. Forcer `useProfile.isError` (ou `user` null) → verifier l'EmptyState "Profile unavailable" / "This user may not exist.".
- **Resultat attendu** : Loader plein ecran tant que userId vide ou chargement ; EmptyState en erreur/absence d'utilisateur ; aucun bouton d'action rendu dans ces etats.
- **Critere d'acceptation (OK/KO)** : OK si chaque etat affiche le bon composant ET aucune action ne crashe ; KO sinon.
- **Donnees de test** : auth user null + meQuery sans data ; `useProfile` isError true.
- **Duree estimee** : 4 min
