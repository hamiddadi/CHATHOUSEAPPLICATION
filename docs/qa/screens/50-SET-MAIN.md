# 50 - Reglages (`settings`)

## Contexte ecran

- **Route** : `SettingsTab` > `Settings` (stack `SettingsStackParamList`, `Settings: undefined`). Onglet de la barre de navigation principale.
- **Fichier** : `src/features/settings/screens/SettingsScreen/SettingsScreen.tsx` (+ partial interne `ExtPremiumRow` dans `src/features/extensions/components/ExtPremiumRow.tsx`).
- **Roles requis** : tout utilisateur authentifie (`standard`). L'entree **Godmode** n'apparait que si `appRole >= MODERATOR` (probe `useAdminWhoami`, donc visible pour `admin`/moderateur). Pas d'acces `guest` : l'ecran suppose une session ouverte (`useMe`).
- **Comportements temps-reel** : AUCUN emetteur/recepteur WebSocket ou LiveKit sur cet ecran. Les seules actions reseau sont REST/asynchrones : recuperation du lien d'invitation (`invitesApi.getLink`, React Query, `staleTime 60s`), probe role admin (`useAdminWhoami`, cache 60s), liste des houses de l'utilisateur (`useHouses('mine')`), statut Premium (`usePremiumStatus`), et la persistance du consentement analytics (`useAnalyticsConsentStore.setEnabled`, SecureStore). Le partage d'invitation passe par la feuille systeme `Share.share`. Aucune mise a jour pousse en direct : `isRealtime = false` partout.
- **Pre-conditions globales** : utilisateur connecte, `useMe` resolu (sinon fallback identite : titre `Your profile`, `@username`, compteurs a 0). Reseau requis pour Premium / invitation / actions de navigation chargeant des donnees distantes.
- **Etats de donnees pertinents** :
  - _Identite non chargee_ : `user` undefined -> nom = `settings.yourProfile`, handle = `@settings.username`, avatar = `DEFAULTS.avatar`, compteurs = 0, clubs = 0. Le bloc bio + bouton See more/See less n'est PAS rendu (gardé par `user?.bio`).
  - _Aucune house_ : grille "Member of" vide (aucune tuile), compteur Clubs = 0.
  - _Houses > 4_ : seules les 4 premieres tuiles sont rendues (`CLUBS_TILE_COUNT = 4`), le reste via "View all".
  - _Premium non configure cote serveur_ (`status.configured` faux) : la ligne Premium ne s'affiche pas (retourne `null`).
  - _Invitations epuisees_ (`invite.remaining <= 0`) : le tap sur "Inviter des amis" ouvre une `Alert` "Plus d'invitations" au lieu de la feuille de partage.
  - _Hors-ligne_ : `getLink`/Premium echouent -> Alert d'erreur generique ; navigation locale (Edit profile, Followers, rows GDPR) reste fonctionnelle.

## Matrice bouton

| #   | Bouton                           | Emplacement                                | Type        | Locator reel                                                                                                            | Pre-condition                          | Priorite |
| --- | -------------------------------- | ------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------- |
| 1   | Wave (top bar)                   | Header (top bar)                           | menu        | `t('settings.sendWaveA11y')` = "Send a wave"                                                                            | Session ouverte, `user` charge         | P1       |
| 2   | See more / See less (bio)        | Corps (sous le handle)                     | toggle      | `t('settings.expandBioA11y')` "Expand bio" / `t('settings.collapseBioA11y')` "Collapse bio"                             | `user.bio` non vide                    | P2       |
| 3   | Stat Followers                   | Corps (rangee de stats)                    | navigation  | accessibilityLabel `` `${value} ${t('settings.followers')}` `` (ex. "1.2K Followers")                                   | `user` charge                          | P1       |
| 4   | Stat Following                   | Corps (rangee de stats)                    | navigation  | accessibilityLabel `` `${value} ${t('settings.following')}` `` (ex. "42 Following")                                     | `user` charge                          | P1       |
| 5   | Stat Clubs (lecture seule)       | Corps (rangee de stats)                    | list-item   | accessibilityLabel `` `${count} ${t('settings.clubs')}` `` (ex. "0 Clubs"), `accessibilityRole='text'` (pas de onPress) | aucune                                 | P2       |
| 6   | Edit profile                     | Corps (rangee d'actions)                   | navigation  | `t('settings.editProfile')` = "Edit profile"                                                                            | `user` charge                          | P1       |
| 7   | Wave (action profil)             | Corps (rangee d'actions)                   | menu        | `t('room.waveA11y')` = "Send a wave"                                                                                    | `user` charge                          | P1       |
| 8   | More options                     | Corps (rangee d'actions, icone more-horiz) | menu        | `t('settings.moreA11y')` = "More options"                                                                               | session ouverte                        | P0       |
| 9   | Create House                     | Corps (CTA pleine largeur)                 | navigation  | `t('settings.createHouseA11y')` = "Create a new house"                                                                  | session ouverte                        | P1       |
| 10  | View all (houses)                | Corps (entete "Member of")                 | navigation  | `t('settings.viewAll')` = "View all"                                                                                    | session ouverte                        | P2       |
| 11  | House tile                       | Corps (grille "Member of")                 | list-item   | accessibilityLabel `` `Open ${house.name}` `` (ex. "Open Design Club")                                                  | au moins 1 house                       | P1       |
| 12  | Premium (Subscribe / Manage)     | Corps (ligne Premium)                      | navigation  | `t('premium.subscribe')` "Go Premium" si free / `t('premium.manage')` "Manage subscription" si premium                  | `status.configured` vrai               | P1       |
| 13  | Godmode                          | Corps (carte admin)                        | navigation  | `t('settings.openGodmodeA11y')` = "Open Godmode"                                                                        | `appRole >= MODERATOR`                 | P1       |
| 14  | Toggle Analytics (crash reports) | Corps (section Privacy)                    | toggle      | `t('settings.anonymousErrorReportingA11y')` = "Allow anonymous crash reporting", `accessibilityRole='switch'`           | session ouverte                        | P1       |
| 15  | Privacy Policy                   | Corps (section Privacy)                    | navigation  | `t('settings.privacyPolicy')` = "Privacy Policy"                                                                        | aucune                                 | P2       |
| 16  | Terms of Service                 | Corps (section Privacy)                    | navigation  | `t('settings.termsOfService')` = "Terms of Service"                                                                     | aucune                                 | P2       |
| 17  | Export my data                   | Corps (section Privacy)                    | navigation  | `t('settings.exportData')` = "Export my data"                                                                           | session ouverte                        | P2       |
| 18  | Inviter des amis                 | Corps (section Account)                    | submit      | `t('invite.inviteFriends')` = "Invite friends"                                                                          | session ouverte, reseau pour `getLink` | P1       |
| 19  | Notifications                    | Corps (section Account)                    | navigation  | `t('settings.notifications')` = "Notifications"                                                                         | session ouverte                        | P1       |
| 20  | Delete my account                | Corps (section Account, danger)            | destructive | `t('settings.deleteAccount')` = "Delete my account"                                                                     | session ouverte                        | P0       |

> Note : l'ecran ne contient aucun bouton temps-reel (pas d'emission/reception WebSocket ni LiveKit). Aucun cas "Temps-reel multi-utilisateur" n'est donc pertinent ; il est remplace par un cas de synchro/persistance (consentement analytics multi-appareils, sign-out multi-device) la ou cela a du sens.

## Cas de test

### SET-MAIN-001 - Wave top bar ouvre l'aide "comment saluer"

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte (`Ada Lovelace` / `@ada`), Wi-Fi, `user` charge.
- **Etapes** :
  1. Ouvrir l'onglet Reglages.
  2. Taper le bouton "Wave 👋" dans la barre du haut (locator `settings.sendWaveA11y`).
  3. Observer l'Alert.
  4. Taper le bouton "My followers" (`settings.waveAlertButton`).
- **Resultat attendu** : une `Alert` titre "Wave 👋" + corps `settings.waveAlertBody` apparait avec 2 actions (My followers / OK). Le tap sur "My followers" navigue vers `Followers` avec `{ userId: user.id, initialTab: 'followers' }`.
- **Critere d'acceptation (OK/KO)** : OK si l'Alert s'ouvre puis la navigation vers Followers (onglet followers) est declenchee ; KO si rien ne se passe ou crash.
- **Donnees de test** : user `{ id: 'me-1', username: 'ada', displayName: 'Ada Lovelace' }`.
- **Duree estimee** : 3 min

### SET-MAIN-002 - Wave top bar : multi-tap rapide ne cumule pas les Alerts

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; cas limite : `user` non encore charge (`useMe` -> undefined).
- **Etapes** :
  1. Avant chargement de `user` (simuler `data: undefined`), taper 5 fois rapidement le bouton Wave du header.
  2. Laisser `user` se charger, retaper une fois.
- **Resultat attendu** : tant que `user` est undefined, `handleWave` retourne immediatement (garde `if (!user) return;`) : aucune Alert. Apres chargement, un seul tap ouvre une seule Alert (l'OS empile une seule Alert native). Pas de stack d'Alerts ni de double navigation.
- **Critere d'acceptation (OK/KO)** : OK si 0 Alert tant que user absent et 1 seule Alert ensuite ; KO si Alert affichee sans user ou plusieurs Alerts empilees.
- **Donnees de test** : `useMe -> { data: undefined }` puis `{ data: makeUser() }`.
- **Duree estimee** : 4 min

### SET-MAIN-003 - Wave top bar : lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme a 200%, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au bouton Wave du header.
  3. Ecouter l'annonce, double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Send a wave, bouton" (role `button`, label `settings.sendWaveA11y`). Le texte "Wave 👋" reste lisible et non tronque a 200%. Le double-tap ouvre l'Alert ; le focus se deplace sur l'Alert.
- **Critere d'acceptation (OK/KO)** : OK si label vocalise = "Send a wave", role bouton, et activable au double-tap sans rognage visuel ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### SET-MAIN-004 - See more deploie la bio puis See less la replie

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` avec une bio longue (> 4 lignes), Wi-Fi.
- **Etapes** :
  1. Ouvrir Reglages avec un user dont `bio` fait > 4 lignes.
  2. Verifier que la bio est tronquee a 4 lignes et que "See more" s'affiche.
  3. Taper "See more" (locator `settings.expandBioA11y` avant expansion).
  4. Taper "See less" (locator `settings.collapseBioA11y` apres expansion).
- **Resultat attendu** : tap "See more" -> bio entiere visible (numberOfLines undefined), libelle devient "See less" et label a11y devient "Collapse bio". Tap "See less" -> retour a 4 lignes, libelle "See more".
- **Critere d'acceptation (OK/KO)** : OK si l'etat de troncature et le libelle/label alternent a chaque tap ; KO si la bio ne se deploie pas ou le libelle ne change pas.
- **Donnees de test** : `makeUser({ bio: 'Ligne1\nLigne2\nLigne3\nLigne4\nLigne5\nLigne6' })`.
- **Duree estimee** : 3 min

### SET-MAIN-005 - See more absent quand pas de bio + multi-tap toggle

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` SANS bio (`bio: null`), puis variante avec bio.
- **Etapes** :
  1. Ouvrir Reglages avec `bio: null`.
  2. Verifier l'absence de tout bouton See more/See less.
  3. Sur un user AVEC bio, taper 6 fois tres vite sur le bouton See more/See less.
- **Resultat attendu** : sans bio, le bloc n'est pas rendu (aucun locator `settings.expandBioA11y`). Avec bio, le toggle reste coherent apres N taps (nombre pair -> replie, impair -> deplie) ; pas de scintillement bloquant ni crash (etat local `useState`, pas de reseau).
- **Critere d'acceptation (OK/KO)** : OK si aucun bouton bio sans `user.bio`, et etat final coherent avec la parite des taps ; KO sinon.
- **Donnees de test** : `makeUser({ bio: null })` puis `makeUser({ bio: 'texte long...' })`.
- **Duree estimee** : 3 min

### SET-MAIN-006 - See more/less : annonce d'etat lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte avec bio longue, VoiceOver/TalkBack actif, police 200%.
- **Etapes** :
  1. Focus sur le bouton bio.
  2. Ecouter le label.
  3. Double-taper, re-ecouter le label.
- **Resultat attendu** : avant expansion le label vocalise est "Expand bio" ; apres expansion il devient "Collapse bio". Role `button`. Le label reflete fidelement l'action a venir.
- **Critere d'acceptation (OK/KO)** : OK si le label a11y bascule Expand bio <-> Collapse bio selon l'etat ; KO s'il reste fige.
- **Donnees de test** : `makeUser({ bio: 'texte long...' })`.
- **Duree estimee** : 3 min

### SET-MAIN-007 - Stat Followers navigue vers la liste followers

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, `followersCount = 1200`, Wi-Fi.
- **Etapes** :
  1. Ouvrir Reglages.
  2. Taper la stat Followers (label "1.2K Followers", `formatCount(1200) = '1.2K'`).
- **Resultat attendu** : navigation vers `Followers` avec `{ userId: 'me-1', initialTab: 'followers' }`.
- **Critere d'acceptation (OK/KO)** : OK si `navigation.navigate('Followers', { userId, initialTab:'followers' })` ; KO sinon.
- **Donnees de test** : `makeUser({ followersCount: 1200 })`.
- **Duree estimee** : 2 min

### SET-MAIN-008 - Stat Following : multi-tap + user non charge

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; cas limite : `user` undefined.
- **Etapes** :
  1. Avec `user` undefined, taper la stat Following (label "0 Following").
  2. Charger `user` (`followingCount: 42`), puis taper 4 fois rapidement la stat Following (label "42 Following").
- **Resultat attendu** : sans `user`, `handleFollowingTap` ne navigue pas (garde `if (!user) return;`). Avec `user`, malgre les taps rapides la navigation `Followers` `{ initialTab:'following' }` est invoquee de maniere idempotente (la pile ne doit pas empiler 4 ecrans Followers en double — navigation react-navigation deduplique l'ecran courant).
- **Critere d'acceptation (OK/KO)** : OK si 0 navigation sans user et navigation Following coherente ensuite ; KO si navigation sans user ou ecrans empiles.
- **Donnees de test** : `makeUser({ followingCount: 42 })`.
- **Duree estimee** : 3 min

### SET-MAIN-009 - Stats : lecteur d'ecran + Clubs en lecture seule

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : VoiceOver/TalkBack actif, police 200%, `clubsCount = 0`.
- **Etapes** :
  1. Balayer les trois stats (Followers, Following, Clubs).
  2. Ecouter le role annonce pour chacune.
  3. Tenter le double-tap sur Clubs.
- **Resultat attendu** : Followers/Following annoncees comme `button` ("1.2K Followers", "42 Following") et activables ; Clubs annoncee comme `text` (label "0 Clubs"), NON activable (pas de `onPress`). Aucun nombre tronque a 200%.
- **Critere d'acceptation (OK/KO)** : OK si Clubs a le role `text` non actionnable et les deux autres le role `button` ; KO sinon.
- **Donnees de test** : `makeUser({ followersCount: 1200, followingCount: 42 })`, `useHouses('mine') -> []`.
- **Duree estimee** : 4 min

### SET-MAIN-010 - Edit profile ouvre l'ecran d'edition

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, `user` charge.
- **Etapes** :
  1. Ouvrir Reglages.
  2. Taper le bouton "Edit profile" (locator `settings.editProfile`).
- **Resultat attendu** : navigation vers la route `EditProfile`.
- **Critere d'acceptation (OK/KO)** : OK si `navigation.navigate('EditProfile')` ; KO sinon.
- **Donnees de test** : `makeUser()`.
- **Duree estimee** : 2 min

### SET-MAIN-011 - Edit profile : double-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, latence reseau elevee simulee (3G throttle) sur l'ecran cible.
- **Etapes** :
  1. Taper deux fois tres rapidement "Edit profile".
- **Resultat attendu** : un seul ecran `EditProfile` est pousse (react-navigation deduplique la double-poussee du meme ecran sur tap rapide). Aucun double-empilement, retour arriere ramene une seule fois a Reglages.
- **Critere d'acceptation (OK/KO)** : OK si un seul `EditProfile` dans la pile ; KO si deux instances empilees.
- **Donnees de test** : `makeUser()`.
- **Duree estimee** : 2 min

### SET-MAIN-012 - Edit profile : accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : lecteur d'ecran actif, police 200%, mode contraste eleve.
- **Etapes** :
  1. Focus sur le bouton "Edit profile".
  2. Ecouter, double-taper.
- **Resultat attendu** : annonce "Edit profile, bouton". Le texte du degrade reste lisible (contraste suffisant on-primary-container) a 200% sans rognage. Activation au double-tap navigue.
- **Critere d'acceptation (OK/KO)** : OK si label = "Edit profile", role bouton, lisible et activable ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### SET-MAIN-013 - Wave (action profil) ouvre l'aide

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, Wi-Fi.
- **Etapes** :
  1. Ouvrir Reglages.
  2. Taper le bouton Wave secondaire de la rangee d'actions (locator `room.waveA11y` = "Send a wave").
  3. Choisir "My followers" dans l'Alert.
- **Resultat attendu** : meme handler que la top bar (`handleWave`) : Alert "Wave 👋" puis navigation vers `Followers` (onglet followers).
- **Critere d'acceptation (OK/KO)** : OK si Alert puis navigation Followers ; KO sinon.
- **Donnees de test** : `makeUser()`.
- **Duree estimee** : 2 min

### SET-MAIN-014 - Wave (action profil) : annulation via OK + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte.
- **Etapes** :
  1. Taper le Wave de la rangee d'actions.
  2. Dans l'Alert, taper "OK" (style cancel).
  3. Re-taper 3 fois rapidement le Wave.
- **Resultat attendu** : "OK" ferme l'Alert sans navigation. Les taps rapides n'ouvrent qu'une Alert a la fois (Alert native modale), aucune navigation parasite.
- **Critere d'acceptation (OK/KO)** : OK si OK annule sans navigation et pas d'empilement d'Alerts ; KO sinon.
- **Donnees de test** : `makeUser()`.
- **Duree estimee** : 3 min

### SET-MAIN-015 - Wave (action profil) : doublon de label a11y

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif. Note QA : deux boutons distincts portent le meme label vocal "Send a wave" (top bar `settings.sendWaveA11y` et action profil `room.waveA11y`).
- **Etapes** :
  1. Balayer du haut vers le bas tout l'ecran.
  2. Reperer les deux occurrences "Send a wave".
- **Resultat attendu** : les deux boutons sont annonces "Send a wave, bouton". Tous deux fonctionnels. QA documente la collision de label (les deux declenchent le meme flux, donc non bloquant, mais a noter pour la differentiation contextuelle).
- **Critere d'acceptation (OK/KO)** : OK si les deux boutons sont focusables et activables sans piege de focus ; KO si l'un n'est pas atteignable.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### SET-MAIN-016 - More options propose la deconnexion et deconnecte

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, Wi-Fi.
- **Etapes** :
  1. Taper le bouton-icone "More options" (locator `settings.moreA11y`, icone more-horiz).
  2. Dans l'Alert titre "Account", taper "Sign out" (style destructive).
- **Resultat attendu** : Alert avec actions Cancel / Sign out. Le tap sur Sign out appelle `signOut()` (auth store) ; la session est invalidee et l'app revient au flux d'authentification/landing.
- **Critere d'acceptation (OK/KO)** : OK si `signOut` est invoque et l'utilisateur quitte la session ; KO si reste connecte.
- **Donnees de test** : auth store `signOut = jest.fn().mockResolvedValue(undefined)`.
- **Duree estimee** : 3 min

### SET-MAIN-017 - More options : Cancel + perte reseau pendant signOut

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; couper le reseau (mode avion) juste avant de confirmer.
- **Etapes** :
  1. Taper "More options".
  2. Taper "Cancel" -> verifier qu'aucune deconnexion n'a lieu.
  3. Re-ouvrir, passer en mode avion, taper "Sign out".
- **Resultat attendu** : "Cancel" ferme l'Alert sans effet. En hors-ligne, `signOut()` (qui purge le token local) doit aboutir localement meme si l'appel reseau de revocation echoue — l'utilisateur est deconnecte cote client sans rester bloque. Aucun double-Alert sur multi-tap rapide de l'icone.
- **Critere d'acceptation (OK/KO)** : OK si Cancel = no-op, et Sign out hors-ligne deconnecte cote client sans freeze ; KO si l'app reste bloquee/connectee.
- **Donnees de test** : `signOut` resolvant ; simuler echec reseau de revocation.
- **Duree estimee** : 4 min

### SET-MAIN-018 - More options : accessibilite icone seule

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : lecteur d'ecran actif, police 200%, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton-icone "More options".
  2. Ecouter l'annonce.
  3. Double-taper, naviguer dans l'Alert au lecteur d'ecran, focus sur "Sign out".
- **Resultat attendu** : bouton-icone annonce "More options, bouton" (label fourni car icone sans texte). L'Alert est entierement navigable au lecteur d'ecran, l'action destructive "Sign out" est annoncee comme telle.
- **Critere d'acceptation (OK/KO)** : OK si l'icone seule a un label vocal explicite et l'Alert est accessible ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### SET-MAIN-019 - More options : coherence multi-appareils apres sign-out

- **Type** : Temps-reel multi-utilisateur (variante synchro/persistance — pas de WebSocket sur cet ecran)
- **Priorite** : P0
- **Pre-conditions** : meme compte `standard` connecte sur 2 appareils (A et B).
- **Etapes** :
  1. Sur A, More options -> Sign out.
  2. Sur B, tenter une action authentifiee (ex. ouvrir une room).
- **Resultat attendu** : la deconnexion sur A revoque la session cote serveur ; sur B, la prochaine requete authentifiee echoue en 401 et l'app redirige vers l'auth (selon politique de tokens). A noter : la deconnexion n'est PAS poussee en temps reel — B ne se deconnecte qu'au prochain appel reseau.
- **Critere d'acceptation (OK/KO)** : OK si B finit par sortir de session au prochain appel protege ; KO si B garde un acces valide indefiniment.
- **Donnees de test** : 2 sessions du compte `me-1`.
- **Duree estimee** : 5 min

### SET-MAIN-020 - Create House ouvre le flux de creation

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, Wi-Fi.
- **Etapes** :
  1. Taper le CTA "Create House" (locator `settings.createHouseA11y`).
- **Resultat attendu** : navigation `navigation.navigate('RoomsTab', { screen: 'CreateHouse' })`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers RoomsTab/CreateHouse ; KO sinon.
- **Donnees de test** : `makeUser()`.
- **Duree estimee** : 2 min

### SET-MAIN-021 - Create House : multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, latence reseau elevee.
- **Etapes** :
  1. Taper 4 fois tres vite le CTA Create House.
- **Resultat attendu** : un seul ecran CreateHouse pousse (deduplication navigation), pas de quatre instances empilees, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si une seule poussee CreateHouse ; KO si empilement multiple.
- **Donnees de test** : `makeUser()`.
- **Duree estimee** : 2 min

### SET-MAIN-022 - Create House : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%, contraste eleve.
- **Etapes** :
  1. Focus sur le CTA Create House.
  2. Ecouter, double-taper.
- **Resultat attendu** : annonce "Create a new house, bouton" (label a11y distinct du texte visible "Create House"). Le texte + icone restent lisibles a 200%. Activation = navigation.
- **Critere d'acceptation (OK/KO)** : OK si label = "Create a new house", role bouton, lisible ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### SET-MAIN-023 - View all ouvre la liste complete des houses

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi.
- **Etapes** :
  1. Dans la section "Member of", taper "View all" (locator `settings.viewAll`).
- **Resultat attendu** : navigation `navigation.navigate('RoomsTab', { screen: 'HouseList' })`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers RoomsTab/HouseList ; KO sinon.
- **Donnees de test** : `useHouses('mine')` avec >= 1 house.
- **Duree estimee** : 2 min

### SET-MAIN-024 - View all : visible meme sans house + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` sans house (`useHouses('mine') -> []`).
- **Etapes** :
  1. Verifier que "View all" reste rendu (il est dans l'entete, independant de la grille).
  2. Taper 3 fois rapidement "View all".
- **Resultat attendu** : "View all" present meme avec grille vide ; multi-tap pousse un seul HouseList. La grille en dessous est vide (aucune tuile).
- **Critere d'acceptation (OK/KO)** : OK si View all present et navigation unique ; KO si crash ou empilement.
- **Donnees de test** : `useHouses('mine') -> []`.
- **Duree estimee** : 2 min

### SET-MAIN-025 - View all : accessibilite (hitSlop / cible tactile)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%.
- **Etapes** :
  1. Focus sur "View all".
  2. Verifier la taille de la cible tactile (hitSlop 8) et l'annonce.
- **Resultat attendu** : annonce "View all, bouton" ; la cible reste atteignable malgre le petit texte grace au `hitSlop={8}`. Lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si focusable, label "View all", cible >= ~44pt avec hitSlop ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### SET-MAIN-026 - House tile ouvre le detail de la house

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, au moins une house ("Design Club"), Wi-Fi.
- **Etapes** :
  1. Dans la grille "Member of", taper la tuile (locator `Open Design Club`).
- **Resultat attendu** : navigation `navigation.navigate('RoomsTab', { screen: 'HouseDetail', params: { houseId: 'h-9' } })`.
- **Critere d'acceptation (OK/KO)** : OK si navigation HouseDetail avec le bon `houseId` ; KO sinon.
- **Donnees de test** : `makeHouse({ id: 'h-9', name: 'Design Club' })`.
- **Duree estimee** : 2 min

### SET-MAIN-027 - House tile : > 4 houses (troncature) + nom tres long

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` avec 7 houses, dont un nom de 60 caracteres.
- **Etapes** :
  1. Charger `useHouses('mine')` avec 7 houses.
  2. Verifier que seules 4 tuiles sont rendues (`CLUBS_TILE_COUNT`).
  3. Taper la tuile au nom tres long.
  4. Couper le reseau et re-taper une tuile.
- **Resultat attendu** : exactement 4 tuiles affichees ; nom long tronque a 2 lignes (`numberOfLines={2}`) sans casser la grille. La navigation HouseDetail est tentee meme hors-ligne (chargement gere par l'ecran cible). Pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si 4 tuiles max, nom tronque proprement, navigation declenchee ; KO sinon.
- **Donnees de test** : 7 houses, une `name` = "Le Grand Club International de Design Avance et Prototypage UX".
- **Duree estimee** : 4 min

### SET-MAIN-028 - House tile : accessibilite (label dynamique)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%, 2 houses.
- **Etapes** :
  1. Balayer les tuiles.
  2. Ecouter chaque label.
- **Resultat attendu** : chaque tuile annonce "Open <nom de la house>, bouton" (label compose `Open ${house.name}`). Le nom reste lisible a 200% (2 lignes). NOTE QA : le prefixe "Open" n'est PAS internationalise (litteral anglais dans le code) — a signaler pour i18n.
- **Critere d'acceptation (OK/KO)** : OK si chaque tuile expose un label unique base sur son nom ; KO si labels identiques/illisibles.
- **Donnees de test** : houses "Design Club", "Music Lounge".
- **Duree estimee** : 3 min

### SET-MAIN-029 - Premium (free) lance le checkout Stripe

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` non premium, Premium configure cote serveur (`status.configured = true`, `premium = false`), Wi-Fi.
- **Etapes** :
  1. Verifier la presence de la ligne "ChatHouse Premium" / hint upsell.
  2. Taper la ligne (locator `premium.subscribe` = "Go Premium").
- **Resultat attendu** : `checkout.mutate` declenche ; en succes, ouverture de l'URL Stripe hebergee via `openExternalUrl(url, STRIPE_HOSTS)`. Pendant la requete, un `ActivityIndicator` remplace le chevron et la ligne est `disabled`.
- **Critere d'acceptation (OK/KO)** : OK si l'URL Stripe Checkout s'ouvre apres succes ; KO si rien/erreur silencieuse.
- **Donnees de test** : `usePremiumStatus -> { configured: true, premium: false }`, checkout renvoie `{ url: 'https://checkout.stripe.com/...' }`.
- **Duree estimee** : 4 min

### SET-MAIN-030 - Premium : echec checkout + multi-tap pendant pending

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : Premium configure, mutation checkout qui echoue (erreur reseau/serveur), ou URL non ouvrable.
- **Etapes** :
  1. Taper "Go Premium".
  2. Pendant que `checkout.isPending`, re-taper plusieurs fois.
  3. Simuler `onError` puis, dans un second essai, `onSuccess` avec une URL invalide.
- **Resultat attendu** : pendant `isPending` la ligne est `disabled` (busy) -> les re-taps sont ignores (pas de double mutation). En `onError` : Alert titre `premium.errorTitle` + message d'erreur. Si l'URL ne s'ouvre pas (`openExternalUrl` renvoie false) : Alert `premium.errorTitle` / `premium.openError`.
- **Critere d'acceptation (OK/KO)** : OK si une seule mutation par cycle et Alert d'erreur affichee en echec ; KO si double mutation ou aucune erreur remontee.
- **Donnees de test** : checkout `mockRejectedValue(new Error('network'))` ; `openExternalUrl -> false`.
- **Duree estimee** : 4 min

### SET-MAIN-031 - Premium (actif) ouvre le portail de gestion

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte premium (`status.configured = true`, `premium = true`), Wi-Fi.
- **Etapes** :
  1. Verifier le libelle "ChatHouse Premium · active" et le label a11y `premium.manage` = "Manage subscription".
  2. Taper la ligne.
- **Resultat attendu** : `portal.mutate` declenche ; en succes, ouverture du billing portal Stripe via `openExternalUrl`.
- **Critere d'acceptation (OK/KO)** : OK si le portail de facturation s'ouvre ; KO sinon.
- **Donnees de test** : `usePremiumStatus -> { configured: true, premium: true }`, portal renvoie `{ url: 'https://billing.stripe.com/...' }`.
- **Duree estimee** : 3 min

### SET-MAIN-032 - Premium : accessibilite + masquage si non configure

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif. Variante 1 : Premium non configure (`status.configured = false`). Variante 2 : configure free.
- **Etapes** :
  1. Variante 1 : balayer la zone — verifier l'absence totale de la ligne Premium.
  2. Variante 2 : focus sur la ligne, ecouter le label, verifier l'etat busy.
- **Resultat attendu** : Variante 1 : aucune ligne Premium (composant retourne `null`), aucun element a11y. Variante 2 : annonce "Go Premium, bouton" ; pendant busy l'`ActivityIndicator` est annonce/le bouton `disabled` (non activable au double-tap).
- **Critere d'acceptation (OK/KO)** : OK si masque quand non configure et label correct sinon ; KO sinon.
- **Donnees de test** : `status.configured` false puis true.
- **Duree estimee** : 4 min

### SET-MAIN-033 - Godmode visible pour moderateur et ouvre l'admin

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `admin`/moderateur (`useAdminWhoami -> { appRole: 'MODERATOR' }`).
- **Etapes** :
  1. Ouvrir Reglages.
  2. Verifier la carte Godmode (libelle "Godmode", sous-texte "Moderation access · MODERATOR").
  3. Taper la carte (locator `settings.openGodmodeA11y` = "Open Godmode").
- **Resultat attendu** : navigation `navigation.navigate('AdminHome')`.
- **Critere d'acceptation (OK/KO)** : OK si la carte s'affiche pour MODERATOR+ et navigue vers AdminHome ; KO sinon.
- **Donnees de test** : `useAdminWhoami -> { data: { appRole: 'MODERATOR' } }`.
- **Duree estimee** : 3 min

### SET-MAIN-034 - Godmode masque pour utilisateur standard + probe en echec

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` (`appRole: 'USER'`), ou probe `/admin/me` en erreur.
- **Etapes** :
  1. Ouvrir Reglages en USER -> verifier l'absence de la carte Godmode (`queryByLabelText('Open Godmode')` null).
  2. Simuler une erreur silencieuse de `useAdminWhoami` (data undefined).
- **Resultat attendu** : avec `USER`, `isAtLeast('USER','MODERATOR')` faux -> carte masquee. Avec probe en echec/undefined -> `showAdminEntry = false`, masquee, echec silencieux (pas d'erreur visible).
- **Critere d'acceptation (OK/KO)** : OK si la carte est absente pour USER et en cas d'echec probe ; KO si elle apparait.
- **Donnees de test** : `useAdminWhoami -> { data: { appRole: 'USER' } }` puis `{ data: undefined }`.
- **Duree estimee** : 3 min

### SET-MAIN-035 - Godmode : accessibilite + role dynamique dans le sous-texte

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : moderateur, lecteur d'ecran actif, police 200%.
- **Etapes** :
  1. Focus sur la carte Godmode.
  2. Ecouter label + sous-texte.
- **Resultat attendu** : annonce "Open Godmode, bouton". Le sous-texte "Moderation access · MODERATOR" (variable `{{role}}`) reste lisible a 200% et reflete le role courant.
- **Critere d'acceptation (OK/KO)** : OK si label = "Open Godmode" et sous-texte injecte le bon role ; KO sinon.
- **Donnees de test** : `appRole: 'ADMIN'` pour verifier l'injection ("Moderation access · ADMIN").
- **Duree estimee** : 3 min

### SET-MAIN-036 - Toggle Analytics active le consentement

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, consentement initial desactive (`enabled = false`).
- **Etapes** :
  1. Reperer la ligne "Anonymous error reports" (switch).
  2. Taper le switch (locator `settings.anonymousErrorReportingA11y`).
- **Resultat attendu** : `setEnabled(true)` appele (persistance SecureStore). Le thumb anime vers la droite (translateX 18, 200ms), la piste passe en couleur "on" (primary). `accessibilityState.checked` passe a true.
- **Critere d'acceptation (OK/KO)** : OK si `setEnabled(true)` appele et l'etat visuel/`checked` passe a actif ; KO sinon.
- **Donnees de test** : `useAnalyticsConsentStore` enabled=false, `setEnabled = jest.fn().mockResolvedValue(undefined)`.
- **Duree estimee** : 3 min

### SET-MAIN-037 - Toggle Analytics : multi-tap rapide + echec de persistance

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : `enabled = false`, `setEnabled` qui rejette (echec d'ecriture SecureStore).
- **Etapes** :
  1. Taper le switch 5 fois tres vite.
  2. Observer le nombre d'appels a `setEnabled` et l'argument.
  3. Simuler un rejet de `setEnabled`.
- **Resultat attendu** : `handleToggleAnalytics` calcule `!analyticsEnabled` a partir de l'etat du store ; chaque tap appelle `setEnabled` avec la valeur inversee de l'etat lu. L'echec de persistance (promesse rejetee, `void setAnalyticsEnabled`) ne doit pas crasher l'UI ; l'etat reel reflete ce que le store finit par exposer. Pas de boucle infinie ni de crash.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash sur taps rapides ni sur rejet de persistance ; KO si crash/etat incoherent fige.
- **Donnees de test** : `setEnabled = jest.fn().mockRejectedValue(new Error('secure-store'))`.
- **Duree estimee** : 4 min

### SET-MAIN-038 - Toggle Analytics : lecteur d'ecran (role switch)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : lecteur d'ecran actif, police 200%, `enabled = false`.
- **Etapes** :
  1. Focus sur le switch.
  2. Ecouter l'annonce (role + etat).
  3. Double-taper, re-ecouter.
- **Resultat attendu** : annonce "Allow anonymous crash reporting, interrupteur, desactive" (role `switch`, `accessibilityState.checked=false`). Apres activation -> "active". Le titre/description restent lisibles a 200%.
- **Critere d'acceptation (OK/KO)** : OK si role switch + etat checked annonce et bascule correctement ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### SET-MAIN-039 - Toggle Analytics : persistance multi-appareils / reinstall

- **Type** : Temps-reel multi-utilisateur (variante persistance — pas de WebSocket)
- **Priorite** : P2
- **Pre-conditions** : meme compte, consentement persiste en SecureStore (survit aux reinstalls sur le meme appareil). Note : le consentement est LOCAL a l'appareil (SecureStore), pas synchronise serveur.
- **Etapes** :
  1. Activer le consentement sur l'appareil A.
  2. Reinstaller l'app sur A -> verifier que l'etat est restaure (hydratation au boot, App.tsx).
  3. Installer sur un appareil B -> verifier que B repart sur le defaut (desactive).
- **Resultat attendu** : A conserve le choix apres reinstall ; B demarre desactive (pas de propagation cross-device, comportement attendu).
- **Critere d'acceptation (OK/KO)** : OK si A restaure et B au defaut desactive ; KO si perte sur A ou propagation involontaire sur B.
- **Donnees de test** : N/A
- **Duree estimee** : 5 min

### SET-MAIN-040 - Privacy Policy ouvre l'ecran de politique

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi (ecran legal en lecture seule cible).
- **Etapes** :
  1. Dans la section Privacy, taper "Privacy Policy" (locator `settings.privacyPolicy`).
- **Resultat attendu** : navigation `navigation.navigate('PrivacyPolicy')`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers PrivacyPolicy ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-041 - Privacy Policy : multi-tap + hors-ligne

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, mode avion.
- **Etapes** :
  1. Couper le reseau.
  2. Taper 3 fois rapidement "Privacy Policy".
- **Resultat attendu** : navigation locale (route interne) declenchee une seule fois meme hors-ligne ; l'ecran PrivacyPolicy s'ouvre (contenu statique ou message si chargement distant). Pas d'empilement multiple.
- **Critere d'acceptation (OK/KO)** : OK si une seule navigation PrivacyPolicy ; KO si empilement.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-042 - Privacy Policy : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%, contraste eleve.
- **Etapes** :
  1. Focus sur la ligne.
  2. Ecouter, double-taper.
- **Resultat attendu** : annonce "Privacy Policy, bouton" (label = `settings.privacyPolicy`). Texte lisible a 200%, chevron decoratif non focusable separement.
- **Critere d'acceptation (OK/KO)** : OK si label "Privacy Policy", role bouton ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-043 - Terms of Service ouvre les CGU

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi.
- **Etapes** :
  1. Taper "Terms of Service" (locator `settings.termsOfService`).
- **Resultat attendu** : navigation `navigation.navigate('Terms')`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers Terms ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-044 - Terms of Service : multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, latence reseau elevee.
- **Etapes** :
  1. Taper 4 fois tres vite "Terms of Service".
- **Resultat attendu** : un seul ecran Terms pousse, pas d'empilement, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si navigation unique vers Terms ; KO si multiple.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-045 - Terms of Service : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%.
- **Etapes** :
  1. Focus sur la ligne, ecouter, double-taper.
- **Resultat attendu** : annonce "Terms of Service, bouton". Lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si label correct et activable ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-046 - Export my data ouvre l'export GDPR

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte, Wi-Fi.
- **Etapes** :
  1. Reperer la ligne "Export my data" avec le hint "Article 20 of the GDPR".
  2. Taper la ligne (locator `settings.exportData`).
- **Resultat attendu** : navigation `navigation.navigate('DataExport')`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers DataExport ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-047 - Export my data : multi-tap + hors-ligne

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, mode avion.
- **Etapes** :
  1. Couper le reseau, taper 3 fois "Export my data".
- **Resultat attendu** : navigation unique vers DataExport ; l'ecran cible gere l'absence de reseau (l'export reel necessitera la connexion). Pas d'empilement.
- **Critere d'acceptation (OK/KO)** : OK si navigation unique ; KO si empilement/crash.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-048 - Export my data : accessibilite (label + hint)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%.
- **Etapes** :
  1. Focus sur la ligne, ecouter.
- **Resultat attendu** : annonce "Export my data, bouton" (label = `settings.exportData`). Le hint "Article 20 of the GDPR" est lisible visuellement ; verifier s'il est vocalise (sinon, recommander `accessibilityHint`). Lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si label correct ; KO si la ligne n'est pas focusable.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### SET-MAIN-049 - Inviter des amis partage le lien personnel

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, `invitesApi.getLink` renvoie `{ url, code, remaining: 3 }`.
- **Etapes** :
  1. Verifier la ligne "Invite friends" avec hint "3 invite left" (`invite.remaining`).
  2. Taper la ligne (locator `invite.inviteFriends`).
- **Resultat attendu** : la feuille systeme `Share.share` s'ouvre avec le message `invite.shareMessage` (URL incluse, ex. "Rejoins-moi sur Chathouse 👋 https://x.test/i/abc") et `url`.
- **Critere d'acceptation (OK/KO)** : OK si la feuille de partage s'ouvre avec le lien personnel ; KO sinon.
- **Donnees de test** : `getLink -> { url: 'https://x.test/i/abc', code: 'abc', remaining: 3 }`.
- **Duree estimee** : 3 min

### SET-MAIN-050 - Inviter des amis : quota epuise + echec reseau + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`. Variante A : `remaining = 0`. Variante B : `getLink` rejette (hors-ligne). Variante C : taps rapides.
- **Etapes** :
  1. Variante A : `getLink -> { remaining: 0 }`, taper la ligne.
  2. Variante B : passer en mode avion, taper la ligne (cache vide).
  3. Variante C : taper 4 fois tres vite.
- **Resultat attendu** : A -> Alert "Plus d'invitations" (`invite.noneLeftTitle`/`noneLeftBody`), PAS de feuille de partage. B -> `catch` declenche Alert `common.error` ("Une erreur est survenue"). C -> chaque tap relit `invite` (cache) ou refait `getLink` ; pas de crash ni de multiples feuilles empilees (l'OS ne presente qu'une feuille de partage).
- **Critere d'acceptation (OK/KO)** : OK si quota 0 -> Alert sans partage, echec -> Alert erreur, multi-tap -> pas de crash ; KO sinon.
- **Donnees de test** : `getLink -> { remaining: 0 }` ; `getLink mockRejectedValue(new Error('offline'))`.
- **Duree estimee** : 5 min

### SET-MAIN-051 - Inviter des amis : accessibilite + hint dynamique

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%, `invite` charge (remaining 3) puis indisponible.
- **Etapes** :
  1. Focus sur la ligne, ecouter.
  2. Recharger avec `invite = undefined` -> hint neutre.
- **Resultat attendu** : annonce "Invite friends, bouton" (label = `invite.inviteFriends`). Hint affiche "3 invite left" quand `invite` present, sinon "Share your personal link" (`invite.shareHint`). Lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si label correct et hint bascule selon disponibilite du lien ; KO sinon.
- **Donnees de test** : `invite = { remaining: 3 }` puis `undefined`.
- **Duree estimee** : 3 min

### SET-MAIN-052 - Notifications ouvre les reglages de notifications

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, Wi-Fi.
- **Etapes** :
  1. Taper la ligne "Notifications" (locator `settings.notifications`).
- **Resultat attendu** : navigation `navigation.navigate('NotificationSettings')`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers NotificationSettings ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-053 - Notifications : multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, latence reseau elevee.
- **Etapes** :
  1. Taper 4 fois tres vite "Notifications".
- **Resultat attendu** : un seul ecran NotificationSettings pousse, pas d'empilement, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si navigation unique ; KO si multiple.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-054 - Notifications : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : lecteur d'ecran actif, police 200%.
- **Etapes** :
  1. Focus sur la ligne, ecouter, double-taper.
- **Resultat attendu** : annonce "Notifications, bouton" (label = `settings.notifications`). Lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si label correct et activable ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-055 - Delete my account ouvre le flux de suppression

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, Wi-Fi.
- **Etapes** :
  1. Defiler en bas, reperer la ligne danger "Delete my account" (style rouge).
  2. Taper la ligne (locator `settings.deleteAccount`).
- **Resultat attendu** : navigation `navigation.navigate('DeleteAccount')` vers l'ecran de confirmation de suppression (irreversible).
- **Critere d'acceptation (OK/KO)** : OK si navigation vers DeleteAccount ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### SET-MAIN-056 - Delete my account : multi-tap + hors-ligne (action irreversible)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, mode avion puis reconnexion.
- **Etapes** :
  1. Taper 3 fois tres vite "Delete my account".
  2. Verifier qu'aucune suppression n'est declenchee depuis cet ecran (il ne fait QUE naviguer).
  3. Hors-ligne, taper la ligne.
- **Resultat attendu** : multi-tap pousse un seul ecran DeleteAccount (aucune suppression directe ici — confirmation requise sur l'ecran cible). Hors-ligne, la navigation s'effectue ; la suppression reelle (sur l'ecran cible) ne doit pas partir sans confirmation explicite ni sans reseau.
- **Critere d'acceptation (OK/KO)** : OK si seul DeleteAccount est ouvert (une instance), aucune suppression declenchee depuis Reglages ; KO si suppression part ou empilement.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### SET-MAIN-057 - Delete my account : accessibilite action destructive

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : lecteur d'ecran actif, police 200%, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a la ligne "Delete my account".
  2. Ecouter l'annonce, verifier le contraste du libelle rouge danger.
- **Resultat attendu** : annonce "Delete my account, bouton" (label = `settings.deleteAccount`). Le libelle danger (`colors.danger` #ffb4ab sur fond rouge translucide) doit conserver un contraste suffisant (verifier WCAG AA pour texte 14pt gras). NOTE QA : le role ne signale pas explicitement "destructif" — recommander un `accessibilityHint` d'avertissement. Lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si label correct, focusable, contraste >= AA ; KO si illisible ou non atteignable.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min
