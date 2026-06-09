# 14 - Fil d'activite (extensions) (`extensions`)

## Contexte ecran

- **Route / composant** : `ExtActivityFeedScreen` (`src/features/extensions/screens/ExtActivityFeedScreen.tsx`). Ecran additif "Module 12.7 / NOTIF-014" du lot extensions Clubhouse-parity. Prop optionnelle `onTapItem?: (item: ActivityItem) => void` (le parent gere la navigation reelle vers la room/club/profil ; cet ecran ne navigue pas lui-meme). Aucun bouton retour/fermer dans le composant : la fermeture/back depend du conteneur de navigation parent (non rendu ici).
- **Roles requis** : `standard` et `admin` (utilisateur authentifie ayant un flux de notifications). Un `guest` non authentifie n'atteint pas cet ecran (pas de session -> pas d'appel `/notifications`). Aucune action n'est reservee a l'admin : la matrice est identique pour standard et admin.
- **Comportements temps-reel** :
  - Abonnement socket via `useExtSocketAliases` (hook monte au render, `getSocket()` du `socketClient` partage). Trois alias V8 declenchent un **live-prepend** dans la liste, sous condition de l'onglet actif :
    - `room_started_by_following` -> entree synthetique `type: 'ROOM_STARTED'` (onglets `all` ou `rooms`).
    - `join_request` -> entree `type: 'CLUB_INVITE'` (onglets `all` ou `clubs`).
    - `ping_user` -> entree `type: 'WAVE'` (onglets `all` ou `social`).
  - Les entrees live ont un id prefixe `live-` ; elles ne sont PAS persistees serveur, donc un tap dessus N'appelle PAS `markRead` (gate `!isLiveId(item.id)`). Au prochain fetch, le merge dedupe par `targetType:targetId` (l'entree serveur remplace son double live).
  - Liste plafonnee a `MAX_ITEMS = 200` (cap memoire pour session longue / flux dense).
- **Pre-conditions globales** : session valide (token en `tokenStorage`), backend joignable pour `/notifications` (GET liste, PATCH read, PATCH read-all). i18n charge (FR/EN). Socket joignable pour les cas temps-reel. L'audio LiveKit n'est PAS implique sur cet ecran.
- **Etats de donnees pertinents** :
  - **Liste vide** : `activityApi.list` renvoie `[]` -> `ListEmptyComponent` affiche `t('extensions.activity.empty')` ("Aucune activite pour le moment.").
  - **Non lus** : `item.isRead === false` -> ligne surlignee (`rowUnread`) + point indicateur (`styles.dot`) a droite. Le tap ou "Tout marquer lu" repasse `isRead: true` (optimiste, immediat en UI).
  - **Chargement** : `loading === true` -> `ActivityIndicator` (pas de FlatList, donc pas de tabs masques ; les tabs et le header restent visibles, seul le corps liste est remplace).
  - **Hors-ligne / fetch en echec** : `fetchItems` catch silencieux -> la liste stale est conservee, `loading` repasse a false (donc empty si liste etait vide). `markRead`/`markAllRead` echouent en silence (`.catch(() => undefined)`) mais l'UI optimiste reste appliquee.
  - **Switch d'onglet concurrent** : garde `reqIdRef` (id monotone) -> seule la reponse de la requete la plus recente est commitee (une reponse lente d'un ancien onglet est ignoree).

## Matrice bouton

| #   | Bouton                               | Emplacement                                  | Type                        | Locator reel                                                                                                                                                                               | Pre-condition                                                                        | Priorite |
| --- | ------------------------------------ | -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------- |
| 1   | Tout marquer lu                      | Header (droite)                              | submit                      | `accessibilityLabel` = `t('extensions.activity.markAllA11y')` ("Marquer toutes les notifications comme lues"). Texte visible : `t('extensions.activity.markAll')` ("Tout marquer lu")      | Session valide ; backend joignable pour effet serveur (UI optimiste meme hors-ligne) | P1       |
| 2   | Onglet "Tout" (filtre all)           | Barre d'onglets (sous header)                | toggle                      | `accessibilityLabel` = `` `${t('extensions.activity.filterA11y')}: ${t('extensions.activity.filters.all')}` `` ("Filtrer: Tout"), `accessibilityRole="tab"`, `accessibilityState.selected` | Session valide                                                                       | P1       |
| 3   | Onglet "Rooms" (filtre rooms)        | Barre d'onglets                              | toggle                      | `accessibilityLabel` = "Filtrer: Rooms" (`filterA11y` + `filters.rooms`), `accessibilityRole="tab"`                                                                                        | Session valide                                                                       | P1       |
| 4   | Onglet "Social" (filtre social)      | Barre d'onglets                              | toggle                      | `accessibilityLabel` = "Filtrer: Social" (`filterA11y` + `filters.social`), `accessibilityRole="tab"`                                                                                      | Session valide                                                                       | P1       |
| 5   | Onglet "Clubs" (filtre clubs)        | Barre d'onglets                              | toggle                      | `accessibilityLabel` = "Filtrer: Clubs" (`filterA11y` + `filters.clubs`), `accessibilityRole="tab"`                                                                                        | Session valide                                                                       | P1       |
| 6   | Ligne d'activite (cellule pressable) | Corps, liste (`ActivityRow`)                 | list-item / realtime-action | `accessibilityLabel` = `` `${item.title} — ${item.body}` `` (dynamique par item), `accessibilityRole="button"`                                                                             | Au moins 1 item charge ou recu via socket                                            | P0       |
| 7   | Pull-to-refresh                      | Corps, FlatList (`onRefresh` / `refreshing`) | realtime-action             | Pas de label dedie : geste natif `RefreshControl` du FlatList (`refreshing={refreshing}` / `onRefresh={onRefresh}`)                                                                        | Liste rendue (loading termine) ; backend joignable                                   | P1       |

> Note : le titre `t('extensions.activity.title')` ("Activite"), l'`ActivityIndicator` de chargement, le texte vide `t('extensions.activity.empty')`, les avatars/initiales et le point "non lu" ne sont PAS interactifs (aucun `onPress`). Ils ne comptent pas comme boutons mais sont couverts en accessibilite/observation dans les cas. Aucun bouton retour/fermer, FAB, lien legal, ni switch/checkbox dans ce composant.

## Cas de test

### EXT-FEED-001 - "Tout marquer lu" marque toutes les notifications comme lues

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie. Reseau Wi-Fi. Feed contenant au moins 3 notifications dont au moins 2 non lues (point indicateur visible). Aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'ecran Fil d'activite, onglet "Tout".
  2. Verifier la presence d'au moins 2 lignes surlignees avec point "non lu".
  3. Taper le bouton header `t('extensions.activity.markAllA11y')` ("Marquer toutes les notifications comme lues").
  4. Observer les lignes et tirer pour rafraichir.
- **Resultat attendu** : tous les points "non lus" disparaissent immediatement (UI optimiste), le surlignage `rowUnread` est retire. Un PATCH `/notifications/read-all` part. Apres refresh, l'etat lu est persistant (aucune ligne ne redevient non lue).
- **Critere d'acceptation (OK/KO)** : OK si 0 ligne non lue apres le tap ET apres refresh ; KO si une ligne reste non lue ou redevient non lue.
- **Donnees de test** : feed = `[ {id:'n1',isRead:false}, {id:'n2',isRead:false}, {id:'n3',isRead:true} ]`. Endpoint : `PATCH /api/notifications/read-all`.
- **Duree estimee** : 3 min

### EXT-FEED-002 - "Tout marquer lu" : multi-clic rapide + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard. Reseau a couper (mode avion) avant le tap, puis retablir. Feed avec >= 2 non lues.
- **Etapes** :
  1. Ouvrir le Fil d'activite avec des non lues.
  2. Activer le mode avion (hors-ligne).
  3. Taper TRES rapidement 5 fois de suite sur `t('extensions.activity.markAllA11y')`.
  4. Observer l'UI (aucun crash attendu, catch silencieux).
  5. Retablir le reseau, tirer pour rafraichir.
- **Resultat attendu** : l'UI passe optimistement tout en "lu" des le 1er tap ; les taps suivants sont idempotents (rien de neuf a marquer). Hors-ligne, le PATCH echoue silencieusement (`.catch(() => undefined)`), aucun toast d'erreur ni crash. Apres reseau + refresh, l'etat serveur reel s'affiche (selon que le 1er PATCH avait abouti ou non, les non lues peuvent reapparaitre si tout etait hors-ligne).
- **Critere d'acceptation (OK/KO)** : OK si aucun crash/ANR sur 5 taps rapides hors-ligne et si l'app reste reactive ; KO si crash, double rendu errone, ou spinner bloque.
- **Donnees de test** : feed >= 2 non lues. Endpoint cible (echouera hors-ligne) : `PATCH /api/notifications/read-all`.
- **Duree estimee** : 4 min

### EXT-FEED-003 - "Tout marquer lu" : lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard. TalkBack (Android) ou VoiceOver (iOS) actif. Police systeme au maximum. Mode fort contraste active. Feed avec >= 1 non lue.
- **Etapes** :
  1. Activer lecteur d'ecran + police XXL + fort contraste.
  2. Balayer jusqu'au bouton header.
  3. Ecouter l'annonce du lecteur d'ecran.
  4. Double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Marquer toutes les notifications comme lues, bouton" (label `markAllA11y`, role bouton). Le libelle visible "Tout marquer lu" reste lisible et non tronque en police XXL ; le contraste du texte primaire reste suffisant. L'activation marque tout comme lu.
- **Critere d'acceptation (OK/KO)** : OK si le label vocal correspond exactement a `markAllA11y`, le bouton est focusable/activable, et le texte reste lisible en XXL ; KO si label generique/absent, non focusable, ou texte coupe.
- **Donnees de test** : aucune (lecture du label i18n FR/EN).
- **Duree estimee** : 4 min

### EXT-FEED-004 - Onglet "Rooms" filtre le feed sur les rooms

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard. Wi-Fi. Feed mixte (rooms + social + clubs).
- **Etapes** :
  1. Ouvrir le Fil d'activite (onglet "Tout" actif par defaut).
  2. Taper l'onglet `Filtrer: Rooms` (`t('extensions.activity.filters.rooms')`).
  3. Attendre le rechargement de la liste.
- **Resultat attendu** : `activityApi.list('rooms')` est appele (GET `/notifications?filter=rooms`). Seules les entrees liees aux rooms s'affichent. L'onglet "Rooms" passe en etat selectionne (`tabActive`, `accessibilityState.selected = true`), "Tout" se deselectionne.
- **Critere d'acceptation (OK/KO)** : OK si un seul onglet est actif (Rooms) et la liste correspond au filtre ; KO si plusieurs onglets actifs ou liste non filtree.
- **Donnees de test** : `GET /api/notifications?filter=rooms`. Reponse exemple : `[{id:'r1',type:'ROOM_STARTED',targetType:'room',...}]`.
- **Duree estimee** : 3 min

### EXT-FEED-005 - Switch d'onglets rapide : aucune reponse perimee ne s'affiche (race)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard. Reseau a latence elevee (4G degradee ou throttling ~2s). Feed differant par onglet.
- **Etapes** :
  1. Ouvrir le Fil d'activite.
  2. Taper successivement et TRES vite : `Filtrer: Rooms`, puis `Filtrer: Social`, puis `Filtrer: Clubs` (3 taps en < 1s).
  3. Attendre la fin de toutes les requetes (latence simulee).
- **Resultat attendu** : grace a `reqIdRef`, seule la reponse du DERNIER onglet tape ("Clubs") est commitee. Les reponses lentes de "Rooms"/"Social" sont ignorees et n'ecrasent pas la liste. L'onglet actif final est "Clubs" et la liste correspond a `filter=clubs`.
- **Critere d'acceptation (OK/KO)** : OK si la liste finale = donnees de "Clubs" et l'onglet actif = Clubs, sans clignotement vers d'anciennes donnees ; KO si une reponse perimee s'affiche ou si l'onglet actif et la liste divergent.
- **Donnees de test** : 3 reponses distinctes pour `filter=rooms|social|clubs`, latence injectee 2000 ms.
- **Duree estimee** : 5 min

### EXT-FEED-006 - Onglets : lecteur d'ecran annonce l'etat selectionne + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard. TalkBack/VoiceOver actif. Police au max. Fort contraste.
- **Etapes** :
  1. Activer lecteur d'ecran + police XXL + fort contraste.
  2. Balayer sur la barre d'onglets, focus sur "Tout".
  3. Ecouter l'annonce (role + selection).
  4. Double-taper "Social", reverifier les annonces "Tout" puis "Social".
- **Resultat attendu** : chaque onglet est annonce comme "tab" avec son label `Filtrer: <Label>` ; l'onglet actif est annonce "selectionne" (`accessibilityState.selected`). Apres selection de "Social", "Social" devient selectionne et "Tout" ne l'est plus. Les libelles restent lisibles en XXL (pas de chevauchement entre les 4 pastilles, scroll horizontal acceptable).
- **Critere d'acceptation (OK/KO)** : OK si role=tab, label exact, et etat selectionne correct annonce pour l'onglet actif uniquement ; KO si role/label/selection erronnes ou pastilles tronquees illisibles.
- **Donnees de test** : aucune.
- **Duree estimee** : 4 min

### EXT-FEED-007 - Tap sur une ligne : ouvre la cible et marque comme lu

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard. Wi-Fi. Feed avec >= 1 notification serveur NON lue (id NON prefixe `live-`).
- **Etapes** :
  1. Ouvrir le Fil d'activite, onglet "Tout".
  2. Reperer une ligne non lue (surlignee + point).
  3. Taper la ligne (locator = `` `${item.title} — ${item.body}` ``).
- **Resultat attendu** : `onTapItem(item)` est invoque (le parent ouvre la cible : room/club/profil selon `targetType`). En parallele, `activityApi.markRead(item.id)` part (PATCH `/notifications/{id}/read`) et la ligne passe localement a `isRead: true` (point + surlignage disparaissent immediatement).
- **Critere d'acceptation (OK/KO)** : OK si `onTapItem` recoit l'item exact ET la ligne devient lue (point retire) ET un PATCH read part avec le bon id ; KO si aucune de ces trois conditions.
- **Donnees de test** : item = `{id:'n1',title:'Ada Lovelace',body:'started "Building in public"',targetType:'room',targetId:'r1',isRead:false}`. Endpoint : `PATCH /api/notifications/n1/read`.
- **Duree estimee** : 3 min

### EXT-FEED-008 - Tap sur entree LIVE (socket) : pas d'appel markRead serveur + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard. Socket connecte. Onglet "Tout" actif. Une entree live vient d'arriver (id prefixe `live-`, ex. `live-r1-<ts>`), non persistee serveur.
- **Etapes** :
  1. Faire emettre par un second compte un evenement `room_started_by_following` (room demarree par un compte suivi).
  2. Verifier l'apparition immediate en tete de liste d'une ligne "ROOM_STARTED".
  3. Taper TRES vite 5 fois cette ligne live.
  4. Surveiller le reseau (proxy/Charles) pour les PATCH `read`.
- **Resultat attendu** : `onTapItem` est appele (le parent peut router vers la room) ; la ligne passe localement `isRead: true`. AUCUN PATCH `/notifications/{id}/read` n'est envoye car `isLiveId(id)` est vrai (gate `!isLiveId`). Les 5 taps n'emettent aucune requete reseau de marquage. Aucun crash. Au prochain fetch, l'entree live est dedupliquee par `targetType:targetId` si le serveur a persiste son equivalent.
- **Critere d'acceptation (OK/KO)** : OK si 0 requete `read` pour l'id `live-...` sur 5 taps ET la ligne devient lue localement ; KO si un PATCH part avec un id `live-` (404 garanti) ou crash.
- **Donnees de test** : payload socket `room_started_by_following` = `{ roomId:'r1', hostId:'u9', hostName:'Grace Hopper', title:'Q&A' }`. Id genere = `live-r1-<timestamp>`.
- **Duree estimee** : 5 min

### EXT-FEED-009 - Ligne d'activite : lecteur d'ecran lit titre + corps, police agrandie

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard. TalkBack/VoiceOver actif. Police au max. Fort contraste. >= 1 item charge.
- **Etapes** :
  1. Activer lecteur d'ecran + police XXL + fort contraste.
  2. Balayer dans la liste jusqu'a une ligne.
  3. Ecouter l'annonce complete.
  4. Double-taper pour activer.
- **Resultat attendu** : la ligne est annoncee "bouton" avec le label `` `${item.title} — ${item.body}` `` (ex. "Ada Lovelace — started Building in public, bouton"). Le titre est `numberOfLines={1}` et le corps `numberOfLines={2}` : en XXL le texte tronque visuellement mais le label a11y reste complet (lu en entier). Avatar/initiale et point non-lu n'interceptent pas le focus (la cellule entiere est un seul element focusable).
- **Critere d'acceptation (OK/KO)** : OK si le label vocal = `titre — corps` complet, role bouton, cellule activable au double-tap ; KO si label partiel, multiples focus dans une meme ligne, ou cellule non activable.
- **Donnees de test** : item = `{title:'Ada Lovelace',body:'started "Building in public"'}`.
- **Duree estimee** : 4 min

### EXT-FEED-010 - Live-prepend ROOM_STARTED visible en multi-utilisateur (synchro socket)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes : A (standard, sur l'ecran Fil d'activite, onglet "Tout" ou "Rooms") suit B ; B (standard) demarre une room. Socket connecte des deux cotes. Wi-Fi.
- **Etapes** :
  1. Compte A ouvre le Fil d'activite, onglet "Tout".
  2. Compte B cree/demarre une room avec titre "Building in public".
  3. Observer l'ecran de A sans action manuelle.
  4. Repeter avec A sur l'onglet "Social" (filtre incompatible).
- **Resultat attendu** : sur "Tout" (ou "Rooms"), une nouvelle ligne "ROOM_STARTED" est prependee en tete chez A en quasi temps-reel (titre = `hostName`, corps = `started "<title>"`), non lue (point visible), sans pull-to-refresh. Sur l'onglet "Social", l'evenement est ignore (gate `filter !== 'all' && filter !== 'rooms'`) -> aucune ligne ajoutee. La liste ne depasse jamais 200 items (cap).
- **Critere d'acceptation (OK/KO)** : OK si la ligne apparait chez A < ~2s sur all/rooms ET n'apparait PAS sur social ; KO si absence sur all/rooms, apparition erronee sur social, ou doublon.
- **Donnees de test** : payload `room_started_by_following` = `{ roomId:'r42', hostId:'B-id', hostName:'Compte B', title:'Building in public' }`.
- **Duree estimee** : 6 min

### EXT-FEED-011 - Live-prepend WAVE/JOIN_REQUEST respecte l'onglet actif (multi-event)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : compte A (standard) sur le Fil d'activite. Comptes B et C declenchent respectivement un `ping_user` (wave) et un `join_request`. Socket connecte. Wi-Fi.
- **Etapes** :
  1. A se place sur l'onglet "Social".
  2. B envoie un wave a A (`ping_user`).
  3. Verifier l'ajout d'une ligne "WAVE" en tete chez A.
  4. C envoie un `join_request` sur un club gere par A pendant que A est sur "Social".
  5. A bascule sur l'onglet "Clubs".
- **Resultat attendu** : etape 3 -> une ligne "Wave received / Someone is waving at you" (type WAVE) est prependee (gate social/all OK). Etape 4 -> le `join_request` arrive alors que l'onglet "Clubs" n'est PAS actif : la gate (`filter !== 'all' && filter !== 'clubs'`) l'ignore, aucune ligne live ajoutee a ce moment. Etape 5 -> en passant sur "Clubs", un fetch `filter=clubs` recharge depuis le serveur ; si le serveur a persiste la demande, elle apparait via REST (pas via le live manque).
- **Critere d'acceptation (OK/KO)** : OK si WAVE apparait sur Social en live ET join_request n'apparait pas en live hors onglet clubs/all (mais via fetch apres bascule) ; KO si WAVE manque, ou join_request s'ajoute a tort hors onglet clubs/all.
- **Donnees de test** : `ping_user` = `{ fromUserId:'B-id', roomId:'r7', type:'wave' }` ; `join_request` = `{ clubId:'c3', requesterId:'C-id', message:'Je veux rejoindre' }`.
- **Duree estimee** : 7 min

### EXT-FEED-012 - Pull-to-refresh recharge le feed (fonctionnel)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard. Wi-Fi. Feed deja charge (onglet quelconque).
- **Etapes** :
  1. Ouvrir le Fil d'activite avec une liste non vide.
  2. Tirer la liste vers le bas (geste pull-to-refresh) et relacher.
  3. Observer l'indicateur de refresh et la liste.
- **Resultat attendu** : `onRefresh` declenche `fetchItems()` (GET `/notifications?filter=<onglet courant>`), l'indicateur natif `RefreshControl` s'affiche pendant l'appel puis disparait (`refreshing` true->false). La liste est mise a jour ; les eventuelles entrees live non encore persistees et non dedupliquees (par `targetType:targetId`) sont conservees en tete.
- **Critere d'acceptation (OK/KO)** : OK si l'indicateur apparait/disparait correctement et la liste reflete la reponse serveur (avec live survivants) ; KO si indicateur bloque, liste non rafraichie, ou doublon serveur+live de la meme cible.
- **Donnees de test** : `GET /api/notifications?filter=all`.
- **Duree estimee** : 3 min

### EXT-FEED-013 - Pull-to-refresh : reseau coupe pendant le refresh + multi-pull

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard. Reseau a couper pendant l'appel. Feed deja charge (non vide) pour verifier la conservation du stale.
- **Etapes** :
  1. Ouvrir le Fil d'activite avec une liste non vide.
  2. Activer le mode avion (hors-ligne).
  3. Tirer pour rafraichir plusieurs fois rapidement.
  4. Observer la liste et l'indicateur.
  5. Retablir le reseau, retirer pour rafraichir.
- **Resultat attendu** : hors-ligne, `fetchItems` rejette -> catch silencieux : la liste stale est CONSERVEE (aucune perte de donnees), `refreshing` repasse a false (indicateur ne reste pas bloque). Aucun toast d'erreur, aucun crash sur multi-pull. Apres reseau retabli + refresh, la liste se met a jour normalement.
- **Critere d'acceptation (OK/KO)** : OK si la liste reste intacte hors-ligne, indicateur libere a chaque pull, et refresh OK une fois reconnecte ; KO si liste videe a tort, indicateur bloque, ou crash.
- **Donnees de test** : feed initial >= 3 items. Endpoint (echec hors-ligne) : `GET /api/notifications`.
- **Duree estimee** : 4 min

### EXT-FEED-014 - Pull-to-refresh : accessibilite (focus liste, annonce de rafraichissement)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard. TalkBack/VoiceOver actif. Police au max. Fort contraste. Feed non vide.
- **Etapes** :
  1. Activer lecteur d'ecran + police XXL + fort contraste.
  2. Focus sur la liste, executer le geste/action de rafraichissement accessible (TalkBack : action "rafraichir" ; VoiceOver : geste a 3 doigts vers le bas selon plateforme).
  3. Ecouter les annonces et verifier le retour de focus.
- **Resultat attendu** : le rafraichissement est declenchable au lecteur d'ecran (le `RefreshControl` natif expose l'action de refresh). Apres rechargement, le focus reste coherent (pas perdu en haut de page de facon disruptive) et la liste reste lisible en police XXL. Si la liste devient vide, le texte `t('extensions.activity.empty')` ("Aucune activite pour le moment.") est lu.
- **Critere d'acceptation (OK/KO)** : OK si le refresh est activable au lecteur d'ecran et l'etat resultant (liste ou empty) est correctement annonce/lisible ; KO si non declenchable, focus perdu, ou empty non annonce.
- **Donnees de test** : aucune.
- **Duree estimee** : 4 min

### EXT-FEED-015 - Etat liste vide + chargement initial (couverture etats)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard sans aucune notification. Wi-Fi.
- **Etapes** :
  1. Ouvrir le Fil d'activite.
  2. Observer la phase de chargement (`ActivityIndicator`).
  3. Attendre la reponse vide.
- **Resultat attendu** : pendant le fetch initial, l'`ActivityIndicator` est affiche (header + tabs restent visibles). Apres reponse `[]`, le `ListEmptyComponent` montre `t('extensions.activity.empty')` ("Aucune activite pour le moment."). Aucune ligne, aucun crash.
- **Critere d'acceptation (OK/KO)** : OK si spinner -> texte vide attendu, header/tabs presents tout du long ; KO si spinner bloque, texte vide absent, ou crash.
- **Donnees de test** : `GET /api/notifications?filter=all` -> `[]`.
- **Duree estimee** : 2 min
