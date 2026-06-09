# 46 - Fil des rooms (hallway) (`rooms`)

## Contexte ecran

- **Route** : `RoomFeed` (premier ecran du `RoomStack`, onglet d'accueil). Cible des actions : `Room` (rejoindre), `CreateRoom` (FAB), `Explore`, `Events`, `Notifications`, et `Replays` (gate desactive par defaut).
- **Composant** : `src/features/rooms/screens/RoomFeedScreen/RoomFeedScreen.tsx`.
- **Roles requis** : authentifie (`standard` ou `admin`). Le `guest` n'a pas acces a la stack room en production ; l'ecran s'affiche seulement une fois la session authentifiee (`useAuthStore.status === 'authenticated'`), condition aussi requise par `useHallwaySocket` pour s'abonner aux broadcasts.
- **Comportements temps-reel** :
  - `useHallwaySocket()` ecoute trois evenements WebSocket et invalide `roomKeys.list()` (refetch du feed score) : `hallway:room_created`, `hallway:room_closed`, `hallway:room_updated`. Aucun patch local de ligne, le ranking est recalcule cote serveur.
  - Le badge non-lu de l'icone Notifications vient de `useUnreadNotificationCount()` (poll / push selon la feature notifications).
  - L'abonnement socket est annule (`cancelled` + `unbind`) au logout pour eviter les listeners fantomes.
- **Pre-conditions globales** : reseau accessible vers l'API ; token valide ; au moins une room live cote serveur pour peupler le feed ; au moins une room programmee (`filter: 'upcoming'`) pour afficher la bande "A venir".
- **Etats de donnees** :
  - **Premier chargement** (`isLoading` + cache vide) : `RoomFeedSkeleton` (4 cartes pulsantes, `accessibilityLabel="Loading live rooms"`, role `progressbar`). Le header reste visible au-dessus.
  - **Erreur** (`isError`) : `EmptyState` "Impossible de charger les rooms" / "Verifie ta connexion et reessaie."
  - **Liste vide** (data `[]`, succes) : FlatList vide, header + pills + (eventuelle) bande Upcoming + titre "En direct" affiches, aucune carte.
  - **Changement de filtre** : `keepPreviousData` garde le feed precedent a l'ecran (pas de flash skeleton) pendant le refetch.
  - **Bande Upcoming masquee** si `upcoming.length === 0` (`UpcomingRow` retourne `null`).
  - **Replays masque** : l'icone Replays n'est rendue que si `FEATURES.replays === true` (desactive par defaut).

## Matrice bouton

| #   | Bouton                        | Emplacement               | Type                     | Locator reel                                                                                                          | Pre-condition                                   | Priorite |
| --- | ----------------------------- | ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| 1   | Rejoindre (Join)              | Corps / carte de liste    | navigation               | `accessibilityLabel="Join room: {title}"` (ex. `Join room: Building in public`), texte `t('feed.join')` = "Rejoindre" | Feed charge, au moins 1 room live               | P0       |
| 2   | FAB Demarrer une room         | Bas-droite flottant       | fab                      | `accessibilityLabel=t('feed.startNewA11y')` = "Demarrer une nouvelle room", hint `t('feed.startNewHint')`             | Authentifie                                     | P1       |
| 3   | Pull-to-refresh               | Corps / FlatList          | realtime-action          | `onRefresh` du FlatList (RefreshControl, `refreshing={isRefetching}`)                                                 | Feed en succes (FlatList rendue)                | P1       |
| 4   | Carte "A venir" (Upcoming)    | Corps / liste horizontale | list-item / navigation   | `accessibilityLabel="Upcoming room: {title}"`                                                                         | `upcoming.length > 0`                           | P1       |
| 5   | Icone Notifications (+ badge) | Header droite             | icon / navigation        | `accessibilityLabel=t('feed.notificationsA11y')` = "Notifications" ; badge `accessibilityLabel="{n} unread"`          | Authentifie                                     | P1       |
| 6   | Icone Explorer / Recherche    | Header droite             | icon / navigation        | `accessibilityLabel=t('feed.exploreA11y')` = "Decouvrir"                                                              | Authentifie                                     | P2       |
| 7   | Icone Events                  | Header droite             | icon / navigation        | `accessibilityLabel=t('feed.eventsA11y')` = "Evenements"                                                              | Authentifie                                     | P2       |
| 8   | Icone Replays (gate)          | Header droite             | icon / navigation        | `accessibilityLabel=t('replays.title')` = "Replays"                                                                   | `FEATURES.replays === true` (masque par defaut) | P2       |
| 9   | Pill de filtre "All"          | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: All"`, `accessibilityState.selected`                                                     | Feed rendu                                      | P1       |
| 10  | Pill de filtre "Following"    | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: Following"`                                                                              | Feed rendu, comptes suivis                      | P1       |
| 11  | Pill de filtre "Clubs"        | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: Clubs"`                                                                                  | Feed rendu                                      | P1       |
| 12  | Pill de filtre "Tech"         | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: Tech"` (-> `topic=tech`)                                                                 | Feed rendu                                      | P2       |
| 13  | Pill de filtre "Music"        | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: Music"` (-> `topic=music`)                                                               | Feed rendu                                      | P2       |
| 14  | Pill de filtre "Business"     | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: Business"` (-> `topic=business`)                                                         | Feed rendu                                      | P2       |
| 15  | Pill de filtre "Health"       | Corps / barre de pills    | toggle / realtime-action | `accessibilityLabel="Filter: Health"` (-> `topic=health`)                                                             | Feed rendu                                      | P2       |

> Note : les 7 pills partagent le composant `FilterPill` ; la matrice les detaille car chacune declenche un jeu de params reseau different (`{}`, `{following:true}`, `{clubs:true}`, `{topic:...}`). Les cas de test couvrent en detail "All", "Following"/"Clubs" (flags) et un `topic` representatif (Tech), les autres pills (Music/Business/Health) etant strictement equivalentes a Tech au parametre `topic` pres.

## Cas de test

### ROOM-FEED-001 - Rejoindre une room live (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` authentifie, Wi-Fi, feed charge avec >= 1 room live, permission micro non requise a ce stade (demandee a l'entree de la room).
- **Etapes** :
  1. Ouvrir l'onglet d'accueil (RoomFeed).
  2. Attendre l'affichage d'au moins une carte sous "En direct".
  3. Taper le bouton "Rejoindre" de la carte "Building in public" (`Join room: Building in public`).
- **Resultat attendu** : navigation vers l'ecran `Room` avec `{ roomId: 'r1' }` ; transition immediate sans flash d'erreur.
- **Critere d'acceptation (OK/KO)** : OK si `navigation.navigate('Room', { roomId })` est emis avec l'id de la carte tapee ; KO sinon.
- **Donnees de test** : room `{ id: 'r1', title: 'Building in public', category: 'tech' }`.
- **Duree estimee** : 2 min

### ROOM-FEED-002 - Rejoindre : multi-clic rapide + latence reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, reseau bride (latence ~3 s, profil "Slow 3G"), feed charge.
- **Etapes** :
  1. Sur la carte "Building in public", taper "Rejoindre" 5 fois en moins d'1 s (double/multi-tap).
  2. Observer le nombre d'ecrans Room empiles.
  3. Couper le reseau juste apres le 1er tap puis revenir sur le feed.
- **Resultat attendu** : un seul ecran `Room` est pousse (pas d'empilement de 5 ecrans). En coupure reseau, la navigation locale reste possible (la jointure reseau echoue dans l'ecran Room, pas ici) ; aucun crash, le feed reste intact en retour arriere.
- **Critere d'acceptation (OK/KO)** : OK si `navigate('Room')` ne produit pas plusieurs ecrans Room superposes et aucun crash ; KO si pile dupliquee ou ANR.
- **Donnees de test** : meme room `r1` ; profil reseau Slow 3G (Charles/Network Link Conditioner).
- **Duree estimee** : 4 min

### ROOM-FEED-003 - Rejoindre : accessibilite lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, police systeme x1.3, contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran et balayer jusqu'a la carte.
  2. Verifier l'annonce du bouton de jointure.
  3. Double-taper pour activer.
  4. Augmenter la taille de police a 130% et verifier le libelle "Rejoindre".
- **Resultat attendu** : le lecteur annonce "Join room: Building in public, bouton" ; le double-tap navigue vers `Room` ; le texte "Rejoindre" reste lisible et non tronque ; contraste du bouton primaire conforme.
- **Critere d'acceptation (OK/KO)** : OK si l'element est focusable, correctement annonce (role bouton + nom de room) et activable ; KO si non focusable ou libelle absent.
- **Donnees de test** : room `r1`.
- **Duree estimee** : 4 min

### ROOM-FEED-004 - Rejoindre : synchro multi-utilisateur via hallway socket

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils authentifies (A et B), Wi-Fi, REALTIME active, A sur le RoomFeed.
- **Etapes** :
  1. Sur l'appareil B, creer puis demarrer une nouvelle room live (broadcast `hallway:room_created`).
  2. Sur A, observer le feed sans tirer pour rafraichir.
  3. Sur B, terminer la room (broadcast `hallway:room_closed`).
  4. Sur A, taper "Rejoindre" sur cette room juste avant qu'elle disparaisse.
- **Resultat attendu** : la nouvelle room de B apparait sur A sans action manuelle (invalidation de `roomKeys.list()`) ; a la fermeture, la carte disparait du feed de A ; rejoindre une room fermee redirige proprement (erreur geree dans l'ecran Room, pas de carte fantome persistante).
- **Critere d'acceptation (OK/KO)** : OK si le feed de A se met a jour sur `room_created`/`room_closed` sans pull manuel ; KO si la liste reste figee.
- **Donnees de test** : room creee par B `{ title: 'QA realtime', topic: 'tech' }`.
- **Duree estimee** : 6 min

### ROOM-FEED-005 - FAB : ouvrir la creation de room (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` authentifie, Wi-Fi.
- **Etapes** :
  1. Sur le RoomFeed, reperer le bouton flottant "+" en bas a droite.
  2. Le taper (`Demarrer une nouvelle room`).
- **Resultat attendu** : navigation vers `CreateRoom` ; micro-animation de scale du FAB (scaleTo 0.9) au press.
- **Critere d'acceptation (OK/KO)** : OK si `navigation.navigate('CreateRoom')` est emis ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 1 min

### ROOM-FEED-006 - FAB : multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, feed charge.
- **Etapes** :
  1. Taper le FAB 4 fois tres rapidement.
  2. Revenir en arriere depuis CreateRoom et observer la pile.
- **Resultat attendu** : un seul ecran `CreateRoom` empile ; le retour ramene directement au feed (pas 4 ecrans CreateRoom).
- **Critere d'acceptation (OK/KO)** : OK si pile = feed + 1x CreateRoom ; KO si ecrans dupliques.
- **Donnees de test** : n/a.
- **Duree estimee** : 2 min

### ROOM-FEED-007 - FAB : accessibilite (hint + zone tactile)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif, police agrandie x1.3.
- **Etapes** :
  1. Balayer jusqu'au FAB.
  2. Ecouter l'annonce (nom + indice).
  3. Double-taper pour activer.
- **Resultat attendu** : annonce "Demarrer une nouvelle room, bouton, Ouvre la fenetre de creation" (label + `accessibilityHint`) ; le `pointerEvents="box-none"` n'empeche pas l'activation du FAB lui-meme ; double-tap ouvre `CreateRoom`.
- **Critere d'acceptation (OK/KO)** : OK si label + hint annonces et FAB activable ; KO si hint manquant ou zone non focusable.
- **Donnees de test** : n/a.
- **Duree estimee** : 3 min

### ROOM-FEED-008 - Pull-to-refresh : rafraichir le feed (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, feed deja charge en succes.
- **Etapes** :
  1. Tirer la liste vers le bas (geste pull-to-refresh).
  2. Observer le spinner `RefreshControl`.
  3. Attendre la fin du refetch.
- **Resultat attendu** : `refetch()` declenche, `refreshing` passe a true puis false ; le feed se recharge avec le ranking serveur a jour ; le spinner disparait.
- **Critere d'acceptation (OK/KO)** : OK si le RefreshControl s'affiche pendant le refetch et le contenu est rafraichi ; KO si le spinner reste bloque.
- **Donnees de test** : n/a.
- **Duree estimee** : 2 min

### ROOM-FEED-009 - Pull-to-refresh : perte reseau / reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed charge, puis mode avion active.
- **Etapes** :
  1. Activer le mode avion.
  2. Tirer pour rafraichir.
  3. Observer le comportement, puis reactiver le reseau et re-tirer.
- **Resultat attendu** : en hors-ligne, le refetch echoue silencieusement (les donnees precedentes restent affichees, pas de vidage du feed) ; pas de crash ; a la reconnexion, un nouveau pull recharge correctement. Si le cache est vide au depart, l'EmptyState "Impossible de charger les rooms" s'affiche.
- **Critere d'acceptation (OK/KO)** : OK si l'app reste stable hors-ligne et recupere a la reconnexion ; KO si crash ou perte definitive du contenu deja charge.
- **Donnees de test** : n/a.
- **Duree estimee** : 3 min

### ROOM-FEED-010 - Pull-to-refresh : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif.
- **Etapes** :
  1. Avec TalkBack/VoiceOver, utiliser l'action de rafraichissement (ou le geste a trois doigts equivalent).
  2. Observer l'annonce d'etat de chargement.
- **Resultat attendu** : le skeleton `Loading live rooms` (role progressbar) est annonce lors d'un (re)chargement complet ; le RefreshControl ne piege pas le focus.
- **Critere d'acceptation (OK/KO)** : OK si l'etat de chargement est annonce et le focus reste navigable ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 3 min

### ROOM-FEED-011 - Carte "A venir" : ouvrir une room programmee (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins 1 room avec `scheduledFor` (bande "A venir" visible).
- **Etapes** :
  1. Verifier la bande horizontale "A venir" sous les pills.
  2. Taper une carte (`Upcoming room: {title}`).
- **Resultat attendu** : navigation vers `Room` avec le `roomId` de la carte programmee (meme handler `onOpen`=`handleJoin`) ; l'horodatage `formatScheduled` est affiche.
- **Critere d'acceptation (OK/KO)** : OK si `navigate('Room', { roomId })` est emis pour la room programmee ; KO sinon.
- **Donnees de test** : room `{ id: 'up1', title: 'Lancement V3', scheduledFor: '2026-06-10T18:00:00Z' }`.
- **Duree estimee** : 2 min

### ROOM-FEED-012 - Carte "A venir" : bande absente quand aucune room programmee

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi, aucune room programmee (`roomService.list({filter:'upcoming'})` retourne `[]`).
- **Etapes** :
  1. Ouvrir le RoomFeed.
  2. Verifier l'absence de la section "A venir".
  3. Multi-tap rapide a l'emplacement habituel de la bande.
- **Resultat attendu** : la section "A venir" n'est pas rendue (`UpcomingRow` renvoie `null`) ; le titre "En direct" suit directement les pills ; les taps a vide ne declenchent aucune navigation.
- **Critere d'acceptation (OK/KO)** : OK si aucune bande Upcoming ni navigation parasite ; KO si carte fantome ou crash.
- **Donnees de test** : reponse upcoming `[]`.
- **Duree estimee** : 2 min

### ROOM-FEED-013 - Carte "A venir" : accessibilite + scroll horizontal

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif, police x1.3, >= 2 rooms programmees.
- **Etapes** :
  1. Balayer dans la bande "A venir".
  2. Ecouter l'annonce de chaque carte.
  3. Double-taper pour ouvrir.
- **Resultat attendu** : chaque carte annonce "Upcoming room: {title}, bouton" ; le titre (2 lignes max) ne deborde pas a 130% ; navigation horizontale au lecteur d'ecran fonctionnelle.
- **Critere d'acceptation (OK/KO)** : OK si chaque carte est focusable, annoncee et activable ; KO sinon.
- **Donnees de test** : 2 rooms upcoming.
- **Duree estimee** : 3 min

### ROOM-FEED-014 - Notifications : ouvrir le centre de notifications (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, >= 1 notification non lue (badge attendu).
- **Etapes** :
  1. Dans le header, reperer l'icone cloche avec son badge.
  2. La taper (`Notifications`).
- **Resultat attendu** : navigation vers `Notifications` ; le badge affiche le compteur non-lu (`{n} unread`), avec "99+" au-dela de 99.
- **Critere d'acceptation (OK/KO)** : OK si `navigate('Notifications')` est emis et le badge reflete le compteur ; KO sinon.
- **Donnees de test** : `unreadCount = 5`.
- **Duree estimee** : 2 min

### ROOM-FEED-015 - Notifications : badge a 0 / >99 + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi.
- **Etapes** :
  1. Avec `unreadCount = 0`, verifier que le badge n'est pas rendu.
  2. Forcer `unreadCount = 150` et verifier l'affichage "99+".
  3. Taper l'icone 4 fois rapidement.
- **Resultat attendu** : badge masque a 0 (`badge > 0` requis) ; "99+" affiche au-dela de 99 ; un seul ecran Notifications empile malgre le multi-tap.
- **Critere d'acceptation (OK/KO)** : OK si badge conditionnel correct et pas d'empilement ; KO sinon.
- **Donnees de test** : `unreadCount` = 0, puis 150.
- **Duree estimee** : 3 min

### ROOM-FEED-016 - Notifications : accessibilite du badge non-lu

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif, `unreadCount = 3`.
- **Etapes** :
  1. Balayer jusqu'a l'icone Notifications.
  2. Ecouter l'annonce du bouton et du badge.
- **Resultat attendu** : le bouton annonce "Notifications, bouton" et le badge expose "3 unread" (`accessibilityLabel`) ; contraste du badge primaire suffisant ; activation possible.
- **Critere d'acceptation (OK/KO)** : OK si le bouton et le compteur non-lu sont annonces ; KO si le badge n'a pas de label accessible.
- **Donnees de test** : `unreadCount = 3`.
- **Duree estimee** : 2 min

### ROOM-FEED-017 - Notifications : synchro temps-reel du badge

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 appareils ; A sur le RoomFeed (`unreadCount = 0`), B capable de declencher une notif (invite/ping/follow vers A).
- **Etapes** :
  1. Depuis B, inviter/pinger A vers une room (genere une notification push).
  2. Sur A, observer le badge sans rafraichir.
- **Resultat attendu** : le compteur du badge s'incremente sur A (via `useUnreadNotificationCount`) ; apres ouverture de l'ecran Notifications, le badge se decremente/disparait.
- **Critere d'acceptation (OK/KO)** : OK si le badge se met a jour cote A apres action de B ; KO si fige.
- **Donnees de test** : action de B = ping vers la room `r1`.
- **Duree estimee** : 5 min

### ROOM-FEED-018 - Explorer : navigation vers Explore (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi.
- **Etapes** :
  1. Dans le header, taper l'icone loupe (`Decouvrir`).
- **Resultat attendu** : navigation vers `Explore`.
- **Critere d'acceptation (OK/KO)** : OK si `navigate('Explore')` est emis ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 1 min

### ROOM-FEED-019 - Explorer : multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi.
- **Etapes** :
  1. Taper l'icone Decouvrir 4 fois rapidement.
  2. Revenir et observer la pile de navigation.
- **Resultat attendu** : un seul ecran `Explore` empile ; pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si pas d'ecrans dupliques ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 1 min

### ROOM-FEED-020 - Explorer : accessibilite (hitSlop + libelle)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif, police x1.3.
- **Etapes** :
  1. Balayer jusqu'a l'icone Decouvrir.
  2. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce "Decouvrir, bouton" ; zone tactile elargie par `hitSlop={8}` ; navigation fonctionnelle malgre la petite icone (20px) a police agrandie.
- **Critere d'acceptation (OK/KO)** : OK si label correct et cible atteignable ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 2 min

### ROOM-FEED-021 - Events : navigation vers Events (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi.
- **Etapes** :
  1. Dans le header, taper l'icone calendrier (`Evenements`).
- **Resultat attendu** : navigation vers `Events`.
- **Critere d'acceptation (OK/KO)** : OK si `navigate('Events')` est emis ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 1 min

### ROOM-FEED-022 - Events : multi-tap + retour reseau

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, reseau instable (coupure breve).
- **Etapes** :
  1. Taper l'icone Evenements 4 fois rapidement.
  2. Couper puis retablir le reseau pendant le chargement de l'ecran Events.
- **Resultat attendu** : un seul ecran `Events` ; la navigation locale aboutit meme hors-ligne (le contenu Events gere son propre etat reseau) ; pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si navigation unique et app stable ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 2 min

### ROOM-FEED-023 - Events : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif.
- **Etapes** :
  1. Balayer jusqu'a l'icone Evenements.
  2. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce "Evenements, bouton" ; activation vers `Events`.
- **Critere d'acceptation (OK/KO)** : OK si label annonce et activable ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 1 min

### ROOM-FEED-024 - Replays : entree masquee par feature flag (positif/etat)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi, `FEATURES.replays === false` (defaut), puis variante `true`.
- **Etapes** :
  1. Avec le flag a false (defaut), inspecter le header.
  2. Activer `FEATURES.replays = true`, recharger, taper l'icone "play" (`Replays`).
- **Resultat attendu** : flag false -> l'icone Replays n'est pas rendue ; flag true -> l'icone apparait entre Events et Notifications et navigue vers `Replays`.
- **Critere d'acceptation (OK/KO)** : OK si l'icone suit strictement `FEATURES.replays` et navigue vers `Replays` quand active ; KO sinon.
- **Donnees de test** : `FEATURES.replays` = false puis true.
- **Duree estimee** : 3 min

### ROOM-FEED-025 - Replays : accessibilite quand active

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, `FEATURES.replays === true`, lecteur d'ecran actif.
- **Etapes** :
  1. Balayer jusqu'a l'icone Replays.
  2. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce "Replays, bouton" ; activation vers `Replays`.
- **Critere d'acceptation (OK/KO)** : OK si label annonce et activable ; KO sinon.
- **Donnees de test** : `FEATURES.replays = true`.
- **Duree estimee** : 2 min

### ROOM-FEED-026 - Filtre "All" : feed complet par defaut (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, feed charge.
- **Etapes** :
  1. Verifier que la pill "All" est selectionnee a l'ouverture (etat initial `activeFilter='All'`).
  2. Apres avoir choisi un autre filtre, retaper "All" (`Filter: All`).
- **Resultat attendu** : `filterToParams('All')` renvoie `{}` (aucun param) ; le feed complet score est requete ; la pill "All" a `accessibilityState.selected=true`, les autres false.
- **Critere d'acceptation (OK/KO)** : OK si la requete sans filtre est lancee et l'etat selected exclusif sur "All" ; KO sinon.
- **Donnees de test** : n/a.
- **Duree estimee** : 2 min

### ROOM-FEED-027 - Filtre "Following" / "Clubs" : flags reseau (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` suivant >= 1 createur, membre >= 1 club, Wi-Fi.
- **Etapes** :
  1. Taper "Following" (`Filter: Following`) -> observer le feed.
  2. Taper "Clubs" (`Filter: Clubs`) -> observer le feed.
- **Resultat attendu** : `Following` envoie `{ following: true }` (rooms des comptes suivis) ; `Clubs` envoie `{ clubs: true }` (rooms rattachees a un club) ; grace a `keepPreviousData`, le feed precedent reste affiche sans flash skeleton pendant le refetch ; la pill active devient `selected`.
- **Critere d'acceptation (OK/KO)** : OK si les bons params sont envoyes et l'etat selected suit la pill tapee ; KO sinon.
- **Donnees de test** : compte suivant `@ada`, membre du club "Founders".
- **Duree estimee** : 3 min

### ROOM-FEED-028 - Filtre par topic "Tech" : filtre vide + retombee "All"

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi, aucune room live de topic "tech".
- **Etapes** :
  1. Taper "Tech" (`Filter: Tech`) -> `topic=tech`.
  2. Observer la liste filtree vide.
  3. Retaper "All" pour revenir au feed complet.
- **Resultat attendu** : `filterToParams('Tech')` renvoie `{ topic: 'tech' }` (label en minuscules) ; le feed peut etre vide (FlatList vide, pas d'erreur) ; retour a "All" restaure le feed complet ; les pills Music/Business/Health se comportent a l'identique avec leur topic respectif.
- **Critere d'acceptation (OK/KO)** : OK si `topic` envoye en minuscules et liste vide geree proprement ; KO si crash ou EmptyState d'erreur a tort.
- **Donnees de test** : topic `tech` sans room live.
- **Duree estimee** : 2 min

### ROOM-FEED-029 - Filtres : multi-tap rapide + bascule pendant le refetch

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau lent (Slow 3G), feed charge.
- **Etapes** :
  1. Taper rapidement en sequence All -> Following -> Tech -> Clubs -> All en moins de 2 s.
  2. Observer les requetes reseau et l'etat des pills.
- **Resultat attendu** : aucune requete obsolete ne remplace la plus recente (React Query annule/ignore les reponses perimees par cle de query distincte par filtre) ; une seule pill reste `selected` (la derniere tapee) ; pas de flash skeleton grace a `keepPreviousData` ; pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'etat final correspond a la derniere pill et le feed est coherent ; KO si pill "collee" ou donnees melangees.
- **Donnees de test** : profil reseau Slow 3G.
- **Duree estimee** : 4 min

### ROOM-FEED-030 - Filtres : accessibilite (etat selectionne + scroll des pills)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif, police x1.3, contraste eleve.
- **Etapes** :
  1. Balayer la rangee de pills.
  2. Ecouter l'annonce de chaque pill et de son etat selectionne.
  3. Double-taper "Following" puis verifier l'annonce d'etat mis a jour.
- **Resultat attendu** : chaque pill annonce "Filter: {label}, bouton, selectionne/non selectionne" via `accessibilityState.selected` ; le contraste pill active (fond primaire) vs inactive (glass) reste lisible ; les libelles ne sont pas tronques a 130%.
- **Critere d'acceptation (OK/KO)** : OK si l'etat selected est annonce et change apres activation ; KO si l'etat n'est pas expose.
- **Donnees de test** : n/a.
- **Duree estimee** : 3 min

### ROOM-FEED-031 - Etat global : premier chargement skeleton (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, cache vide, Wi-Fi (latence simulee pour observer l'etat).
- **Etapes** :
  1. Ouvrir le RoomFeed avec un cache vide.
  2. Observer pendant le chargement.
- **Resultat attendu** : `RoomFeedSkeleton` (4 cartes pulsantes) s'affiche sous le header ; la marque "Chathouse" et les icones header restent visibles ; a la fin, le skeleton est remplace par le feed.
- **Critere d'acceptation (OK/KO)** : OK si le skeleton (label "Loading live rooms") s'affiche puis cede la place aux cartes ; KO si spinner plein ecran ou header masque.
- **Donnees de test** : latence ~2 s.
- **Duree estimee** : 2 min

### ROOM-FEED-032 - Etat global : erreur de chargement + reessai par pull

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, API renvoyant une erreur (5xx ou timeout), cache vide.
- **Etapes** :
  1. Ouvrir le RoomFeed avec l'API en erreur.
  2. Observer l'EmptyState.
  3. Retablir l'API et tirer pour rafraichir (si l'EmptyState laisse la liste accessible) ou relancer l'ecran.
- **Resultat attendu** : EmptyState "Impossible de charger les rooms" + "Verifie ta connexion et reessaie." ; pas de crash ; apres retablissement, le feed se charge.
- **Critere d'acceptation (OK/KO)** : OK si l'EmptyState d'erreur s'affiche et la recuperation fonctionne ; KO sinon.
- **Donnees de test** : reponse API 500.
- **Duree estimee** : 3 min

## Synthese de couverture

- **Boutons / elements interactifs recenses** : 15 (1 Join, 1 FAB, 1 pull-to-refresh, 1 carte Upcoming, 4 icones header dont Replays gate, 7 pills de filtre).
- **Cas de test** : 32 (ROOM-FEED-001 a ROOM-FEED-032), couvrant pour chaque element au moins le positif, l'erreur/limite (incluant multi-tap rapide et perte/latence reseau), l'accessibilite, et la synchro temps-reel multi-utilisateur pour les elements realtime (Join via hallway socket, badge Notifications).
