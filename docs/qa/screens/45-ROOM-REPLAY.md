# 45 - Replays (`rooms`)

## Contexte ecran

- **Route** : `Replays` (sans params) dans `RoomsNavigator` (stack Rooms), declaree dans `src/core/navigation/types.ts` (`RoomStackParamList.Replays: undefined`).
- **Feature flag** : l'ecran n'est monte que si `FEATURES.replays` est `true` (`src/core/navigation/stacks/RoomsNavigator.tsx` ligne 65 : `{FEATURES.replays && <Stack.Screen name="Replays" .../>}`). Quand le flag est `false`, aucun point d'entree ni la route n'existent. **Pre-condition globale obligatoire : `FEATURES.replays = true`.**
- **Roles requis** : `guest` / `standard` / `admin`. L'ecran ne filtre rien par role ; il liste les replays publics recents (`GET /recordings`). Un compte authentifie quelconque suffit (l'`apiClient` porte le token).
- **Source de donnees** : `useRecentReplays()` -> `recordingService.recent()` -> `GET /recordings` (envelope `{ data: RawReplay[] }`), mappe vers `Replay[]` (`id`, `roomId`, `fileUrl`, `durationMs`, `createdAt`, `roomTitle`, `host`). React Query, pas de polling ni de socket.
- **Comportements temps-reel** :
  - Aucun WebSocket ni push sur cet ecran. La liste n'est pas live (pas de refetch auto ni d'event socket).
  - **Le seul "temps-reel" est la lecture audio** : le bouton Play de chaque carte (`ReplayPlayer`) streame le fichier enregistre depuis son URL publique (`item.fileUrl`) via `expo-audio` (`useAudioPlayer` / `useAudioPlayerStatus`), avec barre de progression et horloge qui se mettent a jour pendant la lecture. C'est un flux media reseau -> classe isRealtime.
  - Cote serveur la feature est elle aussi feature-flaggee (LiveKit Egress) : si l'egress n'est pas configure, `GET /recordings` renvoie une liste vide -> etat vide permanent.
- **Pre-conditions globales** : reseau pour charger la liste et pour streamer l'audio ; `playsInSilentMode: true` est applique a la lecture (le son sort meme en mode silencieux iOS).
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` -> `<Loader fullscreen accessibilityLabel={t('common.loading')} />` ("Loading…"), la liste n'est pas rendue.
  - **Liste vide** : `data = []` -> `<EmptyState title={t('replays.emptyTitle')} description={t('replays.emptyBody')} />` ("No replays yet" / "Recorded rooms show up here once they end.").
  - **Liste peuplee** : une carte par replay ; titre = `roomTitle` sinon `t('replays.untitled')` ("Untitled room") ; meta = `host.displayName || host.username` + date relative (`Xd` / `Xh` / `Xm`) ou date seule si pas de host ; player audio inline.
  - **Notion de "non lus"** : non applicable (pas de statut lu/non-lu dans le modele `Replay`).
  - **Hors-ligne** : la query echoue silencieusement (pas de bloc d'erreur dedie dans l'ecran ; `isError` n'est pas affiche) -> reste sur Loader puis liste vide/cache. Le Play ne peut pas streamer.

## Matrice bouton

| #   | Bouton                                      | Emplacement                                                        | Type                            | Locator reel                                                                                                                                                                                   | Pre-condition                                                           | Priorite |
| --- | ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| 1   | Retour (icone `arrow-back`)                 | Header (gauche)                                                    | navigation / icon               | `accessibilityLabel` = `t('common.back', 'Back')` -> **"Back"** ; `accessibilityRole="button"`                                                                                                 | Ecran monte (`FEATURES.replays=true`), une vue precedente dans le stack | P1       |
| 2   | Play / Pause (icone `play-arrow` / `pause`) | Corps -> cellule de liste (carte replay, composant `ReplayPlayer`) | realtime-action / icon / toggle | `accessibilityLabel` = `status.playing ? t('voice.pauseA11y') : t('replays.playA11y')` -> **"Play replay"** (au repos) / **"Pause voice message"** (en lecture) ; `accessibilityRole="button"` | Au moins 1 replay avec `fileUrl` valide ; reseau pour streamer          | P0       |

> Note : l'ecran n'a que **2 elements interactifs**. Il n'y a **pas** de pull-to-refresh (`FlatList` sans `refreshControl`/`onRefresh`), pas de swipe, pas de long-press, pas d'`onPress` sur la cellule entiere (la carte est une `View` non pressable), pas de FAB, pas de menu, pas d'input. La barre de progression (`track`/`fill`) est purement visuelle (pas de seek interactif expose). Le `Loader` et l'`EmptyState` ne sont pas actionnables ici.

## Cas de test

### ROOM-REPLAY-001 - Retour ferme l'ecran Replays

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie ; `FEATURES.replays=true` ; reseau Wi-Fi ; ecran Replays ouvert depuis un ecran precedent (ex: profil/menu) ; permissions : aucune.
- **Etapes** :
  1. Naviguer jusqu'a l'ecran Replays (depuis l'ecran qui l'ouvre).
  2. Verifier la presence du titre "Replays" et du controle "Back".
  3. Taper une fois le bouton Retour (icone `arrow-back`, label "Back").
- **Resultat attendu** : `navigation.goBack()` est appele ; l'ecran Replays se ferme et l'ecran precedent reapparait avec son etat conserve.
- **Critere d'acceptation (OK/KO)** : OK si retour a l'ecran precedent apres 1 tap ; KO si rien ne se passe ou crash.
- **Donnees de test** : compte `qa.standard@chathouse.test` / OTP `000000` ; aucune donnee de replay requise.
- **Duree estimee** : 2 min

### ROOM-REPLAY-002 - Multi-tap rapide sur Retour ne depile pas trop d'ecrans

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie ; `FEATURES.replays=true` ; reseau 4G avec latence (~600 ms) ; ecran Replays ouvert au sommet d'un stack d'au moins 2 ecrans.
- **Etapes** :
  1. Ouvrir Replays.
  2. Taper le bouton "Back" 5 fois tres rapidement (rafale < 1 s).
  3. Observer la pile de navigation resultante.
  4. Couper le reseau pendant la transition (mode avion) puis re-taper Back.
- **Resultat attendu** : un seul `goBack` effectif (les taps suivants sont absorbes car l'ecran est deja demonte) ; on ne depile pas plusieurs ecrans d'un coup, pas de double pop ni d'ecran blanc ; aucune dependance reseau pour le retour (la navigation reste fonctionnelle hors-ligne).
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur revient exactement a l'ecran parent direct sans saut intempestif ni crash ; KO si depile 2+ niveaux ou freeze.
- **Donnees de test** : meme compte ; stack = [Home -> Profil -> Replays].
- **Duree estimee** : 4 min

### ROOM-REPLAY-003 - Retour accessible (TalkBack/VoiceOver, police agrandie, contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; `FEATURES.replays=true` ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme au max (200%) ; mode contraste eleve active ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir Replays avec le lecteur d'ecran actif.
  2. Balayer jusqu'au premier element focusable du header.
  3. Ecouter l'annonce du lecteur d'ecran.
  4. Double-taper pour activer.
  5. Verifier le rendu du titre "Replays" en police agrandie.
- **Resultat attendu** : le lecteur d'ecran annonce "Back, bouton" (role `button`, label "Back") ; double-tap declenche le retour ; le titre "Replays" reste lisible (texte `text-xxl font-display`) sans troncature ni chevauchement avec l'icone en police 200% ; cible tactile suffisante (icone 24 px + `hitSlop=8`).
- **Critere d'acceptation (OK/KO)** : OK si label/role annonces correctement + activable au double-tap + pas de contenu coupe en police max ; KO sinon.
- **Donnees de test** : compte standard ; settings systeme : font scale 2.0, high contrast ON.
- **Duree estimee** : 5 min

### ROOM-REPLAY-004 - Lecture d'un replay (Play -> Pause)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard authentifie ; `FEATURES.replays=true` cote app ET egress configure cote serveur ; reseau Wi-Fi stable ; au moins 1 replay avec `fileUrl` joignable ; build dev-client/EAS (expo-audio est un module natif, pas Expo Go) ; volume media audible.
- **Etapes** :
  1. Ouvrir Replays ; attendre la fin du Loader.
  2. Reperer la premiere carte (titre = roomTitle ou "Untitled room", meta host + date relative).
  3. Taper le bouton Play (icone `play-arrow`, label "Play replay").
  4. Laisser jouer ~10 s et observer barre de progression + horloge.
  5. Taper de nouveau le bouton (label desormais "Pause voice message", icone `pause`).
- **Resultat attendu** : au 1er tap, `setAudioModeAsync({ playsInSilentMode: true })` + `player.play()` ; le son sort, l'icone passe a `pause`, le label a "Pause voice message", la barre `fill` se remplit proportionnellement (`progress = currentTime/totalSec`), l'horloge affiche le temps ecoule (mm:ss). Au 2e tap, `player.pause()` : audio en pause, icone repasse `play-arrow`, label "Play replay", progression figee.
- **Critere d'acceptation (OK/KO)** : OK si lecture/pause alternent correctement avec audio audible et UI synchronisee ; KO si pas de son, icone/label non mis a jour, ou crash natif.
- **Donnees de test** : replay `{ id: "rep1", fileUrl: "https://cdn.example.com/rep1.m4a", durationMs: 125000, roomTitle: "Building in public", host: { displayName: "Alice Doe" } }` ; date `createdAt` = il y a 2 jours (meta attendue : "Alice Doe · 2d").
- **Duree estimee** : 4 min

### ROOM-REPLAY-005 - Relecture apres fin : Play repart du debut

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : idem 004 ; replay court (ex: ~5 s) pour atteindre la fin rapidement ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir Replays, lancer le replay court avec Play.
  2. Laisser la lecture aller jusqu'a la fin (atteindre `durationMs`).
  3. Verifier l'etat de fin (icone repasse `play-arrow`, horloge a la duree totale).
  4. Taper de nouveau Play.
- **Resultat attendu** : a la fin (`status.didJustFinish` ou `currentTime >= totalSec`), le bouton revient en etat "Play replay" ; au tap suivant, le code appelle `player.seekTo(0)` puis `player.play()` -> la lecture **reprend depuis 0:00**, barre remise a zero puis re-remplie.
- **Critere d'acceptation (OK/KO)** : OK si relecture depuis le debut (pas bloquee a la fin) ; KO si rien ne se passe ou reprend a la fin.
- **Donnees de test** : replay `{ id: "rep-short", fileUrl: "https://cdn.example.com/short.m4a", durationMs: 5000, roomTitle: "Quick sync" }`.
- **Duree estimee** : 3 min

### ROOM-REPLAY-006 - Play : multi-clic rapide + perte reseau / reconnexion pendant le stream

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; `FEATURES.replays=true` + egress configure ; build dev-client ; reseau 4G instable (outil de throttling/avion) ; au moins 1 replay valide.
- **Etapes** :
  1. Ouvrir Replays, attendre l'affichage de la carte.
  2. Taper le bouton Play/Pause 6 fois en < 1 s (rafale).
  3. Pendant la lecture, activer le mode avion 5 s puis le desactiver.
  4. Re-taper Play une fois la connexion revenue.
- **Resultat attendu** : pas de double-instanciation/cacophonie : chaque tap bascule l'etat unique du player (play/pause alternes), pas de deux pistes superposees ; pendant la coupure reseau le buffer s'epuise -> lecture s'arrete/se met en attente sans crash ; au retour reseau + re-tap Play, le stream reprend (depuis la position ou depuis 0 si la session a expire) sans planter l'ecran. Le bouton reste reactif.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash, pas de son double, bouton toujours toggable apres reconnexion ; KO si app freeze, audio fantome persistant, ou bouton bloque.
- **Donnees de test** : replay `rep1` ci-dessus ; profil reseau : 4G -> avion 5 s -> 4G.
- **Duree estimee** : 6 min

### ROOM-REPLAY-007 - Play accessible (TalkBack/VoiceOver, police agrandie, contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; `FEATURES.replays=true` + au moins 1 replay ; TalkBack/VoiceOver actif ; police systeme 200% ; contraste eleve ; reseau Wi-Fi ; build dev-client.
- **Etapes** :
  1. Ouvrir Replays avec lecteur d'ecran actif ; attendre la carte.
  2. Balayer jusqu'au bouton de lecture de la 1re carte ; ecouter l'annonce.
  3. Double-taper pour lancer la lecture.
  4. Re-focaliser le meme bouton apres demarrage ; ecouter l'annonce mise a jour.
  5. Verifier en police 200% que titre, meta et player ne se chevauchent pas.
- **Resultat attendu** : au repos, annonce "Play replay, bouton" (label `t('replays.playA11y')`, role button) ; apres lecture, l'annonce devient "Pause voice message, bouton" (label `t('voice.pauseA11y')`) ; double-tap active la lecture ; le pastille Play 40x40 + `hitSlop=8` offre une cible suffisante ; le contraste de l'icone (`colors.onPrimary` sur `colors.primary`) reste lisible ; en police max, le titre `numberOfLines={1}` tronque proprement sans casser la mise en page.
- **Critere d'acceptation (OK/KO)** : OK si labels Play/Pause annonces correctement et changent selon l'etat + cible et contraste conformes + pas de layout casse en police max ; KO sinon.
- **Donnees de test** : replay `rep1` ; settings : font scale 2.0, high contrast ON.
- **Duree estimee** : 6 min

### ROOM-REPLAY-008 - Lecture multi-utilisateur / coherence du contenu replay

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 devices, 2 comptes (`userA` standard, `userB` standard), tous deux `FEATURES.replays=true` + egress configure ; un meme replay public present dans `GET /recordings` ; reseau Wi-Fi sur les deux ; builds dev-client.
- **Etapes** :
  1. Sur device A et device B, ouvrir Replays.
  2. Verifier que la meme carte (meme `roomTitle`, meme host, meme `durationMs`) apparait des deux cotes.
  3. Sur A, taper Play et noter la position a ~0:08.
  4. Sur B, taper Play sur le meme replay independamment.
  5. Comparer le contenu audio entendu et la duree totale affichee sur les deux devices.
- **Resultat attendu** : le replay est un enregistrement statique servi par URL : les deux lecteurs jouent **le meme contenu**, chacun avec sa propre position (pas de synchronisation live entre A et B, et c'est attendu) ; la duree totale et la progression sont coherentes sur chaque device ; aucun etat partage ne fuit (la pause de A n'affecte pas B).
- **Critere d'acceptation (OK/KO)** : OK si meme audio/duree des deux cotes, lectures independantes sans interference ; KO si contenu different, duree incoherente, ou une action sur A impacte B.
- **Donnees de test** : replay `rep1` (`durationMs: 125000`) ; userA `qa.a@chathouse.test`, userB `qa.b@chathouse.test`, OTP `000000`.
- **Duree estimee** : 8 min

### ROOM-REPLAY-009 - Etat vide : aucun bouton de lecture, EmptyState seul

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; `FEATURES.replays=true` cote app mais **egress non configure** cote serveur (ou aucun room termine) -> `GET /recordings` renvoie `[]` ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir Replays.
  2. Attendre la fin du Loader.
  3. Observer le corps de l'ecran.
  4. Tenter de balayer/chercher un bouton Play.
- **Resultat attendu** : affichage de `EmptyState` avec titre "No replays yet" (`t('replays.emptyTitle')`) et description "Recorded rooms show up here once they end." (`t('replays.emptyBody')`) ; aucun bouton Play present (aucune carte) ; seul le bouton "Back" reste actionnable.
- **Critere d'acceptation (OK/KO)** : OK si EmptyState affiche et zero player rendu ; KO si liste fantome, spinner infini, ou crash.
- **Donnees de test** : reponse API `{ "data": [] }` (stub/feature-flag egress OFF).
- **Duree estimee** : 3 min

### ROOM-REPLAY-010 - Player avec fileUrl manquant / replay sans host (limite de donnees)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; `FEATURES.replays=true` ; reseau Wi-Fi ; replay avec `fileUrl` vide (mappe a `''` quand le backend renvoie `null`) et sans `room`/`host` (host = null, roomTitle = null).
- **Etapes** :
  1. Stubber `GET /recordings` pour renvoyer le replay degrade ci-dessous.
  2. Ouvrir Replays.
  3. Observer la carte : titre, meta, bouton Play.
  4. Taper le bouton Play.
- **Resultat attendu** : titre = "Untitled room" (`t('replays.untitled')`, car `roomTitle` null) ; meta = date relative seule (ex: "1d"), sans nom d'hote ; le bouton Play reste annonce "Play replay" mais, avec un `fileUrl` vide, le tap ne produit pas de son (player sans source) et **ne crash pas** l'ecran (echec silencieux du stream). L'UI reste stable.
- **Critere d'acceptation (OK/KO)** : OK si carte rendue proprement (Untitled room + date seule) et tap Play sans crash malgre URL vide ; KO si crash, exception, ou meta avec separateur "·" orphelin.
- **Donnees de test** : `{ "data": [{ "id":"rep3","roomId":"r3","status":"completed","fileUrl":null,"durationMs":null,"startedAt":"2026-06-08T10:00:00Z","endedAt":null,"createdAt":"2026-06-08T10:00:00Z" }] }`.
- **Duree estimee** : 4 min
