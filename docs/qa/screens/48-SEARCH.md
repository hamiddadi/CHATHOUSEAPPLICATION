# 48 - Explorer / Recherche (`search`)

## Contexte ecran

- **Route** : `Explore` dans le `RoomStack` (`RoomStackParamList`). Cible de navigation depuis la barre principale / l'accueil. Navigue vers `Room` (room), `HouseDetail` (club), `Profile` (utilisateur), et `goBack()` pour le retour.
- **Fichier** : `src/features/search/screens/ExploreScreen/ExploreScreen.tsx` + partials `partials/SearchResultsView.tsx`, `partials/ExploreFeedView.tsx`, `partials/rows.tsx`.
- **Roles requis** : authentifie. Les deux appels (`GET /explore` et `GET /search`) tournent sous auth (cf. commentaire `searchService` : « Requests run under auth »). Donc roles `standard` et `admin`. Un `guest` (non authentifie) ne devrait pas atteindre cet ecran ; s'il y arrive, les requetes 401 et l'ecran reste vide/loader.
- **Comportements temps-reel** : AUCUN au sens WebSocket/LiveKit/push. L'ecran consomme uniquement des appels HTTP REST via `apiClient` (TanStack Query). `useExplore` = `GET /explore` (`staleTime` 60s). `useSearch(q)` = `GET /search?q=&type=all&limit=20` (`staleTime` 10s, `enabled` seulement si `q.trim().length > 0`). Aucun bouton n'emet/recoit en direct ; `isRealtime = false` partout. La seule « fraicheur » est le pull-to-refresh et la requete de recherche debouncee (200 ms).
- **Pre-conditions globales** : token valide en memoire, connectivite reseau pour le premier chargement (sinon TanStack sert le cache si present, sinon `isLoading`/erreur silencieuse - l'ecran n'affiche pas d'erreur explicite hors `EmptyState` de recherche).
- **Etats de donnees pertinents** :
  - Feed en cours de chargement → `Loader` plein ecran avec `accessibilityLabel = t('explore.title')` (= « Explorer »).
  - Feed charge vide → 3 sections affichent leurs messages vides : `emptyRooms`, `emptyClubs`, `emptyUsers`.
  - Recherche en cours de chargement → `Loader` plein ecran avec `accessibilityLabel = t('explore.searchResults')` (= « Resultats »).
  - Recherche sans resultat → `EmptyState` titre `t('explore.searchEmpty', { q })` (= « Rien ne correspond a « {q} ». »).
  - Bascule feed ↔ recherche pilotee par `isSearching = debouncedQuery.length > 0`.
  - Hors-ligne : pas d'indicateur dedie ; comportement = cache si dispo, sinon loader figé / liste non remplie.

## Matrice bouton

| #   | Bouton                        | Emplacement                                                            | Type                                    | Locator reel                                                                                                                                  | Pre-condition                           | Priorite |
| --- | ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------- |
| 1   | Retour (fleche arriere)       | Header (gauche)                                                        | navigation                              | `accessibilityRole="button"` + icone MaterialIcons `arrow-back` (1er bouton de l'ecran : `getAllByRole('button')[0]`)                         | Ecran monte, navigateur avec historique | P1       |
| 2   | Champ de recherche            | Corps (sous header)                                                    | input-submit                            | `placeholder = t('explore.searchPlaceholder')` (FR « Rooms, clubs, personnes ») via `getByPlaceholderText` ; adornement gauche icone `search` | Authentifie, reseau                     | P0       |
| 3   | Pull-to-refresh feed          | Corps (FlatList Explore)                                               | realtime-action (rafraichissement HTTP) | `onRefresh` du `FlatList` (`refreshing = isFetching`) — pas de label ; geste de tirage vers le bas                                            | Feed affiche (mode non-recherche)       | P1       |
| 4   | Cellule Room (RoomRow)        | Cellule de liste (feed `trendingRooms` ou recherche `trendingRooms`)   | list-item                               | `accessibilityRole="button"` ; texte visible `room.title` (ex. via `getByText('Building in public')`)                                         | Au moins 1 room dans les donnees        | P1       |
| 5   | Cellule Club (ClubRow)        | Cellule de liste (feed `popularClubs` ou recherche `popularClubs`)     | list-item                               | `accessibilityRole="button"` ; texte visible `club.name` (ex. `getByText('Founders Club')`)                                                   | Au moins 1 club                         | P1       |
| 6   | Cellule Utilisateur (UserRow) | Cellule de liste (feed `peopleToFollow` ou recherche `peopleToFollow`) | list-item                               | `accessibilityRole="button"` ; texte visible `user.displayName` (ex. `getByText('Grace Hopper')`)                                             | Au moins 1 utilisateur                  | P1       |

> Note : l'ecran ne contient aucun bouton destructif, aucun toggle/switch, aucune FAB, aucun lien legal, aucune action de swipe/long-press, et aucune action temps-reel WebSocket/LiveKit/push. La « soumission » de recherche est implicite (debounce 200 ms sur `onChangeText`), il n'y a pas de bouton « Rechercher » physique.

## Cas de test

### SEARCH-001 - Retour : navigation arriere reussie

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed charge (donnees presentes), Wi-Fi, navigateur arrive sur `Explore` depuis un ecran precedent (historique non vide).
- **Etapes** :
  1. Ouvrir l'ecran Explorer depuis l'accueil.
  2. Taper sur la fleche retour en haut a gauche (`getAllByRole('button')[0]`).
- **Resultat attendu** : `navigation.goBack()` est appele ; retour a l'ecran precedent ; l'ecran Explorer est demonte.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient a l'ecran d'origine sans crash. KO si rien ne se passe ou crash.
- **Donnees de test** : compte `standard` (`grace@test.io` / OTP `000000`). Provenance = accueil.
- **Duree estimee** : 2 min

### SEARCH-002 - Retour : multi-clic rapide / sans historique

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Explorer ouvert comme ecran racine (historique vide ou tres court), Wi-Fi puis coupure.
- **Etapes** :
  1. Ouvrir Explorer comme premier ecran de la pile.
  2. Taper 5 fois tres rapidement (<300 ms) sur la fleche retour.
  3. Repeter en mode Avion active.
- **Resultat attendu** : un seul retour effectif ; pas de double-pop de pile, pas d'ecran noir, pas de crash. Si pas d'historique, `goBack()` est no-op (reste sur Explorer). La coupure reseau n'affecte pas la navigation locale.
- **Critere d'acceptation (OK/KO)** : OK si au plus un retour est effectue et aucune exception. KO si la pile saute deux ecrans ou crash.
- **Donnees de test** : compte `standard`. Multi-tap manuel ou via `fireEvent.press` x5.
- **Duree estimee** : 4 min

### SEARCH-003 - Retour : accessibilite lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) / VoiceOver (iOS) actif, taille de police systeme au max, contraste eleve active.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'au premier element focusable (la fleche retour).
  3. Verifier l'annonce (role bouton) puis double-taper pour activer.
  4. Regler la police systeme sur la plus grande valeur et verifier que la cible reste atteignable (hitSlop 8).
- **Resultat attendu** : l'element est annonce comme bouton ; double-tap declenche le retour ; la zone tactile (icone 24 + hitSlop 8) reste actionnable meme avec police agrandie. Note QA : l'icone n'a pas de `accessibilityLabel` explicite (juste `accessibilityRole="button"`) — defaut a remonter si l'annonce est vide.
- **Critere d'acceptation (OK/KO)** : OK si l'element est focusable, annonce comme bouton et activable. KO si non focusable ou label vide bloquant.
- **Donnees de test** : compte `standard`. Police = 200%.
- **Duree estimee** : 5 min

### SEARCH-004 - Recherche : saisie d'une requete et affichage des resultats

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, Wi-Fi, backend en ligne, donnees correspondantes existantes (utilisateur `linus`).
- **Etapes** :
  1. Ouvrir Explorer (feed affiche).
  2. Saisir `linus` dans le champ (`getByPlaceholderText(t('explore.searchPlaceholder'))`).
  3. Attendre la fin du debounce (200 ms) et la reponse `GET /search?q=linus&type=all&limit=20`.
- **Resultat attendu** : bascule du feed vers `SearchResultsView` ; pendant le chargement, `Loader` (`accessibilityLabel = t('explore.searchResults')`) ; puis les sections `peopleToFollow` / `popularClubs` / `trendingRooms` peuplees ; le hit `Linus` est visible (`findByText('Linus')`).
- **Critere d'acceptation (OK/KO)** : OK si le resultat `Linus` apparait apres saisie. KO si le feed reste affiche ou aucun resultat.
- **Donnees de test** : query `linus`. Reponse attendue `{ users: [{ id: 'user-9', username: 'linus', displayName: 'Linus' }], clubs: [], rooms: [] }`.
- **Duree estimee** : 3 min

### SEARCH-005 - Recherche : frappe rapide, query vide, latence/coupure reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, reseau avec latence elevee (throttle 3G) puis coupure ; backend en ligne.
- **Etapes** :
  1. Taper tres vite `b`, `bu`, `bui`, `buil`, `build` (5 frappes < 200 ms chacune) — verifier que le debounce ne lance qu'une requete finale (`q=build`).
  2. Effacer entierement le champ → la query redevient vide.
  3. Re-saisir `build` sous latence 2-3 s puis activer le mode Avion en plein vol de requete ; rallumer le reseau.
- **Resultat attendu** : (1) une seule requete pour `build` grace au debounce ; pas de flicker entre feed et resultats a chaque frappe. (2) Champ vide → `isSearching=false` → retour au feed (`useSearch` desactive car `enabled: q.trim()>0`). (3) Sous latence, `Loader` resultats s'affiche ; coupure → la requete echoue silencieusement (pas de toast d'erreur dedie) ; au retour reseau, TanStack peut refetch et afficher les resultats. Les espaces seuls (`"   "`) ne declenchent PAS de recherche (trim).
- **Critere d'acceptation (OK/KO)** : OK si une seule requete par valeur stabilisee, query vide => feed, et aucune exception lors de la coupure. KO si requete par frappe, ou crash, ou recherche lancee sur espaces seuls.
- **Donnees de test** : queries `build`, `""`, `"   "`. Throttle 3G (~400 ms RTT).
- **Duree estimee** : 6 min

### SEARCH-006 - Recherche : zero resultat (EmptyState)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, backend renvoie `{ users: [], clubs: [], rooms: [] }`.
- **Etapes** :
  1. Saisir `zzz` dans le champ de recherche.
  2. Attendre la reponse.
- **Resultat attendu** : `EmptyState` affiche avec titre `t('explore.searchEmpty', { q: 'zzz' })` (FR « Rien ne correspond a « zzz ». »), description vide ; aucune section affichee.
- **Critere d'acceptation (OK/KO)** : OK si le message vide interpole bien la query `zzz`. KO si sections vides affichees ou message generique sans la query.
- **Donnees de test** : query `zzz`, reponse `{ users: [], clubs: [], rooms: [] }`.
- **Duree estimee** : 2 min

### SEARCH-007 - Recherche : accessibilite champ + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police systeme max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au champ de recherche.
  2. Verifier que le placeholder `t('explore.searchPlaceholder')` est annonce et que le clavier s'ouvre a l'activation.
  3. Dicter `grace` via la saisie vocale ; verifier `autoCapitalize="none"` et `autoCorrect={false}` (pas de majuscule/correction forcee).
  4. Agrandir la police au max et verifier que le champ et l'icone loupe restent lisibles et non tronques.
- **Resultat attendu** : champ focusable et annonce ; texte saisi reste en minuscules sans autocorrection ; resultats affiches lisibles a police max ; contraste suffisant entre `text` et `background`.
- **Critere d'acceptation (OK/KO)** : OK si champ utilisable au lecteur d'ecran, sans autocaps/autocorrect, lisible police max. KO sinon.
- **Donnees de test** : query `grace`. Police 200%.
- **Duree estimee** : 5 min

### SEARCH-008 - Pull-to-refresh : rafraichissement du feed

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed deja charge (mode non-recherche, champ vide), Wi-Fi.
- **Etapes** :
  1. S'assurer que le champ de recherche est vide (feed affiche dans le `FlatList`).
  2. Tirer la liste vers le bas pour declencher `onRefresh` (`() => void explore.refetch()`).
- **Resultat attendu** : `refreshing` passe a `true` (spinner natif) le temps de `GET /explore` ; les sections `trendingRooms`/`popularClubs`/`peopleToFollow` se mettent a jour avec les nouvelles donnees ; spinner disparait a la fin (`isFetching=false`).
- **Critere d'acceptation (OK/KO)** : OK si le spinner s'affiche puis disparait et les donnees sont rafraichies. KO si pas de refetch ou spinner bloque.
- **Donnees de test** : compte `standard`. Feed initial vs feed apres ajout d'une room.
- **Duree estimee** : 3 min

### SEARCH-009 - Pull-to-refresh : multi-tirage rapide / coupure reseau pendant refetch

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed charge, reseau coupable (mode Avion) puis retabli.
- **Etapes** :
  1. Tirer 4-5 fois tres rapidement pour declencher plusieurs `refetch` enchaines.
  2. Pendant un refetch, activer le mode Avion.
  3. Rallumer le reseau et tirer une fois de plus.
- **Resultat attendu** : TanStack deduplique les refetch en vol (pas d'empilement infini de requetes) ; coupure → le refetch echoue, `refreshing` revient a `false`, le feed garde les anciennes donnees du cache (pas d'ecran vide, pas de crash) ; au retour reseau, le pull-to-refresh fonctionne a nouveau.
- **Critere d'acceptation (OK/KO)** : OK si spinner se reinitialise, donnees cache conservees, aucune exception. KO si crash, spinner bloque, ou feed vide apres echec.
- **Donnees de test** : compte `standard`. Mode Avion ON/OFF.
- **Duree estimee** : 5 min

### SEARCH-010 - Pull-to-refresh : accessibilite + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police max.
- **Etapes** :
  1. Avec le lecteur d'ecran, naviguer dans la liste du feed.
  2. Declencher le geste de rafraichissement accessible (TalkBack : action « actualiser » via menu local si exposee, sinon geste de defilement).
  3. Verifier l'annonce de l'etat de chargement.
- **Resultat attendu** : le rafraichissement reste declenchable ; idealement l'etat « chargement » est annonce ; les sections restent navigables a police max. Note QA : `RefreshControl` natif n'a pas de label custom — remonter si l'etat n'est pas annonce.
- **Critere d'acceptation (OK/KO)** : OK si le refresh est atteignable au lecteur d'ecran et la liste reste navigable. KO si inaccessible.
- **Donnees de test** : compte `standard`. Police 200%.
- **Duree estimee** : 4 min

### SEARCH-011 - Cellule Room : navigation vers la Room

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed (ou resultats) avec au moins une room, Wi-Fi.
- **Etapes** :
  1. Afficher le feed contenant la room `Building in public` (id `room-1`).
  2. Taper sur la cellule (`getByText('Building in public')`, role bouton).
- **Resultat attendu** : `navigation.navigate('Room', { roomId: 'room-1' })` ; ouverture de l'ecran Room. Icone de cellule = `mic` si `isLive`, sinon `schedule` ; sous-ligne `host.displayName · listenersCount listeners`.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers `Room` avec le bon `roomId`. KO si mauvaise route/id ou rien.
- **Donnees de test** : `{ id: 'room-1', title: 'Building in public', isLive: true, host: { displayName: 'Ada' }, listenersCount: 12 }`.
- **Duree estimee** : 2 min

### SEARCH-012 - Cellule Room : multi-clic rapide / room expiree / coupure reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, room presente dans la liste, reseau instable.
- **Etapes** :
  1. Taper 4 fois tres vite sur la meme cellule room.
  2. Repeter avec le mode Avion active juste avant le tap.
  3. Cas room non-live (`isLive=false`) → icone `schedule` attendue.
- **Resultat attendu** : une seule navigation `Room` est empilee (pas 4 ecrans superposes) ; sous coupure, la navigation locale s'effectue mais l'ecran Room gerera l'erreur de chargement (hors scope de cet ecran) ; l'icone reflete bien l'etat live/planifie.
- **Critere d'acceptation (OK/KO)** : OK si au plus une instance Room est poussee et aucune exception ici. KO si N ecrans empiles ou crash.
- **Donnees de test** : room live et room `isLive=false` (`scheduledFor` non null).
- **Duree estimee** : 4 min

### SEARCH-013 - Cellule Room : accessibilite + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a la cellule room.
  2. Verifier l'annonce (role bouton + titre + sous-titre) et activer par double-tap.
  3. Verifier en police max que le titre (`numberOfLines={1}`) reste lisible / tronque proprement.
- **Resultat attendu** : cellule annoncee comme bouton avec contenu textuel lu ; double-tap navigue vers Room ; pas de chevauchement a police max ; contraste `text`/`text-muted` suffisant. Note QA : la cellule n'a pas de `accessibilityLabel` composite — TalkBack lit la concatenation des `Text` enfants.
- **Critere d'acceptation (OK/KO)** : OK si cellule focusable, contenu lu, navigation au double-tap. KO sinon.
- **Donnees de test** : room `Building in public` / `Ada · 12 listeners`.
- **Duree estimee** : 4 min

### SEARCH-014 - Cellule Room : coherence multi-utilisateur (etat live)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 comptes (`standard` A et B), une room qui passe live puis se termine cote serveur ; A et B sur l'ecran Explorer.
- **Etapes** :
  1. Utilisateur B (host) demarre une room live.
  2. Utilisateur A ouvre Explorer puis fait pull-to-refresh.
  3. B termine la room ; A refait pull-to-refresh.
- **Resultat attendu** : apres rafraichissement, A voit la room avec icone `mic` (live) puis, apres fin, soit la room disparait du feed live soit passe en `schedule` selon la reponse serveur. Important : il n'y a PAS de mise a jour temps-reel automatique — l'etat ne change que sur refetch/pull-to-refresh (pas de WebSocket sur cet ecran).
- **Critere d'acceptation (OK/KO)** : OK si l'etat de la room reflete le serveur APRES refresh manuel. KO si l'app pretend un push live automatique ou affiche un etat perime apres refresh.
- **Donnees de test** : 2 comptes test ; 1 room creee/terminee cote B.
- **Duree estimee** : 6 min

### SEARCH-015 - Cellule Club : navigation vers HouseDetail

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed/resultats avec au moins un club, Wi-Fi.
- **Etapes** :
  1. Afficher le feed contenant `Founders Club` (id `club-1`).
  2. Taper sur la cellule (`getByText('Founders Club')`, role bouton).
- **Resultat attendu** : `navigation.navigate('HouseDetail', { houseId: 'club-1' })` ; ouverture du detail du club. Cellule : emoji categorie a gauche, sous-ligne `membersCount members · liveRoomsCount live`.
- **Critere d'acceptation (OK/KO)** : OK si navigation `HouseDetail` avec `houseId='club-1'`. KO sinon.
- **Donnees de test** : `{ id: 'club-1', name: 'Founders Club', categoryEmoji: '🚀', membersCount: 99, liveRoomsCount: 2 }`.
- **Duree estimee** : 2 min

### SEARCH-016 - Cellule Club : multi-clic rapide / coupure reseau / club sans live

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, club present, reseau instable ; cas club avec `liveRoomsCount` absent (resultats de recherche : `liveRoomsCount` optionnel → affiche `0`).
- **Etapes** :
  1. Taper 4 fois rapidement sur la cellule club.
  2. Repeter en mode Avion.
  3. Verifier qu'un hit de recherche sans `liveRoomsCount` affiche bien `0 live` (et non crash / `undefined`).
- **Resultat attendu** : une seule navigation `HouseDetail` empilee ; pas de crash hors-ligne ; affichage `99 members · 0 live` quand `liveRoomsCount` est absent (`?? 0`).
- **Critere d'acceptation (OK/KO)** : OK si une seule navigation, `0 live` affiche proprement, aucune exception. KO si N ecrans, ou `undefined live`, ou crash.
- **Donnees de test** : club feed (`liveRoomsCount: 2`) et club hit recherche (sans `liveRoomsCount`).
- **Duree estimee** : 4 min

### SEARCH-017 - Cellule Club : accessibilite + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a la cellule club.
  2. Verifier annonce (role bouton + nom + sous-titre) et activer.
  3. Verifier que l'emoji categorie n'est pas lu comme parasite et que le nom (`numberOfLines={1}`) reste lisible a police max.
- **Resultat attendu** : cellule annoncee comme bouton, contenu lu, double-tap → HouseDetail ; lisibilite et contraste OK a police max.
- **Critere d'acceptation (OK/KO)** : OK si cellule accessible et navigable. KO sinon.
- **Donnees de test** : `Founders Club` / `99 members · 2 live`.
- **Duree estimee** : 4 min

### SEARCH-018 - Cellule Utilisateur : navigation vers Profile

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, feed/resultats avec au moins un utilisateur, Wi-Fi.
- **Etapes** :
  1. Afficher le feed contenant `Grace Hopper` (id `user-1`).
  2. Taper sur la cellule (`getByText('Grace Hopper')`, role bouton).
- **Resultat attendu** : `navigation.navigate('Profile', { userId: 'user-1' })` ; ouverture du profil. Cellule : `Avatar` (uri ou initiales du `displayName`), sous-ligne `@username · followersCount followers`.
- **Critere d'acceptation (OK/KO)** : OK si navigation `Profile` avec `userId='user-1'`. KO sinon.
- **Donnees de test** : `{ id: 'user-1', username: 'grace', displayName: 'Grace Hopper', avatarUrl: null, followersCount: 5 }`.
- **Duree estimee** : 2 min

### SEARCH-019 - Cellule Utilisateur : multi-clic / avatar manquant / followers absent / reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, utilisateur present, reseau instable ; cas `avatarUrl: null` et hit de recherche sans `followersCount` (optionnel → `0`).
- **Etapes** :
  1. Taper 4 fois rapidement sur la cellule utilisateur.
  2. Repeter en mode Avion.
  3. Verifier qu'avec `avatarUrl: null` l'`Avatar` affiche les initiales du `displayName`.
  4. Verifier qu'un hit de recherche sans `followersCount` affiche `0 followers` (`?? 0`).
- **Resultat attendu** : une seule navigation `Profile` empilee ; pas de crash hors-ligne ; avatar de repli (initiales) quand pas d'uri ; `@linus · 0 followers` propre quand `followersCount` absent.
- **Critere d'acceptation (OK/KO)** : OK si une seule navigation, avatar de repli OK, `0 followers` affiche, aucune exception. KO sinon.
- **Donnees de test** : user feed (`followersCount: 5`, avatar null) et user hit recherche (sans `followersCount`).
- **Duree estimee** : 5 min

### SEARCH-020 - Cellule Utilisateur : accessibilite + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a la cellule utilisateur.
  2. Verifier annonce (role bouton + nom affiche + `@username · followers`) et activer.
  3. Verifier que l'`Avatar` (image ou initiales) ne casse pas l'annonce et que le nom (`numberOfLines={1}`) reste lisible a police max.
- **Resultat attendu** : cellule annoncee comme bouton, contenu lu, double-tap → Profile ; lisibilite/contraste OK a police max.
- **Critere d'acceptation (OK/KO)** : OK si cellule accessible et navigable. KO sinon.
- **Donnees de test** : `Grace Hopper` / `@grace · 5 followers`.
- **Duree estimee** : 4 min
