# 04 - Rooms (admin) (`admin`)

## Contexte ecran

- **Route** : `AdminRooms` dans le `SettingsNavigator` (`createNativeStackNavigator`, `headerShown: false` — d'ou le header maison `AdminHeader`). Chemin de navigation typique : Reglages -> Godmode (entree visible seulement pour moderateur+) -> `AdminHome` -> tuile "Rooms en direct" (`navigation.navigate('AdminRooms')`).
- **Roles requis** : `admin` (moderateur+). L'entree Godmode dans `SettingsScreen` n'est rendue que pour moderateur+ (gate UX), et chaque ecran admin re-verifie le role cote serveur via `/admin/me` ; un deep-link `AdminRooms` par un compte non privilegie est rejete en 403. Les comptes `guest` et `standard` n'ont aucun moyen legitime d'atteindre cet ecran.
- **Source de donnees** : `useAdminRooms({ live: true })` -> `adminService.listRooms({ live: true })` -> `GET /admin/rooms?live=true`. Renvoie `AdminRoom[]` (pas de pagination cote ecran).
- **Action principale** : `useForceEndRoom()` -> `adminService.forceEndRoom(roomId, reason)` -> `POST /admin/rooms/:roomId/force-end` avec body `{ reason }`. En succes : invalidation des queries `['admin','rooms']` et `['admin','stats']` (la ligne disparait/passe `isLive=false` apres refetch).
- **Comportements temps-reel** : la fermeture forcee est une action temps-reel cote serveur. D'apres le texte d'avertissement de l'ecran (`admin.rooms.forceEndNotice`) et le service : forcer la fin **notifie tous les participants** (push/WebSocket) et **ferme le canal audio LiveKit** de la room. Cote app admin l'effet visible est differe (apres invalidation + refetch), mais cote participants l'ejection/fermeture est immediate. Aucun socket n'est ouvert par cet ecran lui-meme — il declenche un effet temps-reel cote backend.
- **Pre-conditions globales** : etre authentifie avec un role moderateur+, backend joignable (API REST), token valide.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` -> `Loader` plein ecran (`accessibilityLabel` = `common.loading` = "Chargement…").
  - **Erreur de chargement** : `isError || !rooms` -> `EmptyState` titre `common.error` ("Erreur") + description `admin.rooms.errorLoadingRooms` ("Impossible de charger les rooms.").
  - **Liste vide** : `data: []` -> `ListEmptyComponent` = `EmptyState` titre `admin.rooms.empty` ("Aucune room active").
  - **Liste peuplee** : une `RoomRow` par room ; badge "LIVE" (`admin.rooms.liveBadge`) si `room.isLive`. Bouton d'action actif seulement si `room.isLive` (sinon libelle "Terminée" `admin.rooms.ended` et bouton desactive).
  - **Rafraichissement** : pull-to-refresh (`onRefresh={refetch}`, `refreshing={isRefetching}`).
  - **Action en cours** : `busy` (`forceEnd.isPending && forceEnd.variables?.roomId === item.id`) desactive le bouton de la room ciblee.
- **Note inventaire** : ecran a faible densite d'interactions. Trois elements actionnables seulement : (1) bouton Retour du header, (2) bouton "Fermer la room" par cellule, (3) pull-to-refresh de la liste. Aucun FAB, toggle, switch, input, swipe ni long-press. Le clic sur le corps de la cellule n'est PAS pressable (pas de navigation vers un detail de room).

## Matrice bouton

| #   | Bouton                                | Emplacement                              | Type                          | Locator reel                                                                                                                                                                                                                                                                | Pre-condition                                                                                    | Priorite |
| --- | ------------------------------------- | ---------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| 1   | Retour                                | Header (`AdminHeader`)                   | navigation                    | `accessibilityLabel="Retour"` (chaine litterale dans `AdminHeader.tsx`, `closeIcon=false`) ; icone `MaterialIcons name="arrow-back"`                                                                                                                                        | Pile de navigation avec ecran precedent (`navigation.canGoBack()`)                               | P1       |
| 2   | Fermer la room                        | Cellule de liste (`RoomRow`), cote droit | destructive / realtime-action | `accessibilityLabel` = `` `${t('admin.rooms.closeRoom')} ${room.title}` `` -> ex. "Fermer la room Morning Standup" ; texte visible = `t('admin.rooms.closeRoom')` = "Fermer la room" (room live) ou `t('admin.rooms.ended')` = "Terminée" (room non-live, bouton desactive) | Role moderateur+, room avec `isLive=true`, reseau ; bouton desactive si `busy` ou `!room.isLive` | P0       |
| 3   | Rafraichir la liste (pull-to-refresh) | Corps (FlatList)                         | realtime-action (refetch)     | pas d'`accessibilityLabel` dedie ; geste natif `RefreshControl` via `onRefresh={refetch}` / `refreshing={isRefetching}`                                                                                                                                                     | Liste rendue (etat peuple ou vide), reseau                                                       | P1       |

## Cas de test

### ADM-ROOMS-001 - Retour ferme l'ecran Rooms

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin (moderateur+), Wi-Fi, navigation arrivee depuis `AdminHome` (donc `canGoBack()` vrai)
- **Etapes** :
  1. Ouvrir Reglages -> Godmode -> tuile "Rooms en direct".
  2. Attendre l'affichage du header "Rooms en direct".
  3. Taper le bouton Retour (icone fleche, `accessibilityLabel="Retour"`).
- **Resultat attendu** : retour a l'ecran `AdminHome` ; l'ecran Rooms est depile, aucun appel reseau supplementaire.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent (`AdminHome`) est affiche apres le tap ; KO si rien ne se passe ou crash.
- **Donnees de test** : compte `admin@test.io` (role moderator).
- **Duree estimee** : 2 min

### ADM-ROOMS-002 - Retour multi-tap rapide sans empilement d'ecrans

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi, ecran Rooms ouvert depuis `AdminHome`
- **Etapes** :
  1. Sur l'ecran Rooms, taper 5 fois tres rapidement (< 1 s) le bouton Retour.
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul `goBack()` effectif (le code garde `if (navigation.canGoBack())`) ; on remonte d'un seul cran a `AdminHome`, pas de double pop vers `Settings`, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'app s'arrete a `AdminHome` (un seul niveau remonte) ; KO si on saute deux ecrans ou si l'app plante.
- **Donnees de test** : n/a
- **Duree estimee** : 3 min

### ADM-ROOMS-003 - Retour accessible au lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte admin ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au max ; contraste eleve active
- **Etapes** :
  1. Activer TalkBack/VoiceOver et la plus grande police systeme.
  2. Ouvrir l'ecran Rooms.
  3. Balayer jusqu'au premier controle interactif (le bouton Retour).
  4. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Retour, bouton" ; la cible reste tapable (zone >= 44 px, `hitSlop=12`) ; le titre du header n'est pas tronque de facon a casser la comprehension (numberOfLines=1) ; double-tap declenche le retour.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce contient "Retour" + role bouton ET le double-tap revient en arriere ; KO si l'element est ignore, mal nomme ou non activable.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ADM-ROOMS-004 - Fermer une room live (chemin nominal avec raison saisie)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin ; au moins une room avec `isLive=true` dans `GET /admin/rooms?live=true` ; reseau OK ; iOS (pour le prompt texte) ou Android (confirmation)
- **Etapes** :
  1. Ouvrir l'ecran Rooms ; verifier qu'une cellule affiche le badge "LIVE" et le bouton "Fermer la room".
  2. Taper le bouton dont `accessibilityLabel` = "Fermer la room Morning Standup".
  3. Dans la boite de dialogue (`promptForReason`) : titre "Fermer la room", message "Voulez-vous vraiment fermer cette room ?". Sur iOS, saisir la raison "Spam audio". Sur Android (pas d'`Alert.prompt`), confirmer (la raison par defaut "Admin" sera utilisee).
  4. Confirmer via le bouton destructif "OK".
- **Resultat attendu** : appel `forceEnd.mutate({ roomId: 'r1', reason: 'Spam audio' })` -> `POST /admin/rooms/r1/force-end` body `{ "reason": "Spam audio" }` (Android : `{ "reason": "Admin" }`). En succes : invalidation `['admin','rooms']` + `['admin','stats']`, refetch ; la room cible disparait de la liste live (ou passe a "Terminée"/bouton desactive). Cote backend : tous les participants sont notifies et le canal LiveKit ferme.
- **Critere d'acceptation (OK/KO)** : OK si la requete force-end part avec le bon `roomId` et la bonne `reason`, ET la room quitte l'etat live apres refetch ; KO si aucune requete, mauvais payload, ou la room reste live.
- **Donnees de test** : room `{ id: "r1", title: "Morning Standup", isLive: true, host.username: "alice" }` ; reason iOS = "Spam audio", reason Android = "Admin" (defaut).
- **Duree estimee** : 4 min

### ADM-ROOMS-005 - Annuler le prompt n'envoie aucune requete

- **Type** : Fonctionnel positif (variante negative cote utilisateur)
- **Priorite** : P0
- **Pre-conditions** : compte admin ; une room live ; reseau OK
- **Etapes** :
  1. Taper "Fermer la room {title}" sur une cellule live.
  2. Dans la boite de dialogue, taper "Annuler" (bouton `cancel`).
- **Resultat attendu** : aucune mutation declenchee (`forceEnd.mutate` non appele) ; aucune requete `POST /force-end` ; la room reste live, la liste inchangee.
- **Critere d'acceptation (OK/KO)** : OK si zero appel reseau et room toujours live ; KO si la room est fermee malgre l'annulation.
- **Donnees de test** : room `r1` live.
- **Duree estimee** : 2 min

### ADM-ROOMS-006 - Fermer une room : multi-clic rapide + perte reseau/latence

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; une room live ; reseau manipulable (Charles/Network Link Conditioner ou mode avion a la volee)
- **Etapes** :
  1. Taper "Fermer la room {title}" et confirmer la raison "Test latence".
  2. Immediatement, re-taper plusieurs fois le meme bouton avant la fin de la requete.
  3. Introduire une latence reseau de 5 s puis couper le reseau (mode avion) avant la reponse serveur.
  4. Re-activer le reseau apres 10 s.
- **Resultat attendu** : pendant `isPending` sur cette room, `busy` desactive le bouton -> les taps supplementaires sont ignores (pas de mutations en doublon). En cas d'echec reseau, `onError` declenche `Alert.alert` "Erreur" + message `admin.rooms.failedEnd` ("Échec de la fermeture de la room.") ; aucun crash ; la room reste live et le bouton redevient actionnable apres l'echec. Un eventuel retry manuel apres reconnexion fonctionne.
- **Critere d'acceptation (OK/KO)** : OK si une seule requete force-end est emise par confirmation ET un toast/alerte d'erreur explicite apparait en cas de coupure, sans double fermeture ; KO si plusieurs requetes partent ou si l'echec est silencieux/plante.
- **Donnees de test** : room `r1` live ; reason = "Test latence".
- **Duree estimee** : 6 min

### ADM-ROOMS-007 - Bouton desactive sur une room deja terminee

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; au moins une room avec `isLive=false` presente dans la liste (ex. fermee entre-temps par un autre admin)
- **Etapes** :
  1. Afficher la liste contenant une room `isLive=false`.
  2. Constater le libelle du bouton = "Terminée" (`admin.rooms.ended`), style desactive.
  3. Tenter de taper le bouton "Terminée".
- **Resultat attendu** : bouton non actionnable (`disabled={busy || !room.isLive}`, `accessibilityState={{ disabled: true }}`) ; aucun prompt, aucune requete.
- **Critere d'acceptation (OK/KO)** : OK si le tap est sans effet et l'etat accessibilite annonce "desactive" ; KO si le prompt s'ouvre ou une requete part.
- **Donnees de test** : room `{ id: "r9", title: "Closed Room", isLive: false }`.
- **Duree estimee** : 2 min

### ADM-ROOMS-008 - Fermer une room : accessibilite lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver actif ; police systeme max ; contraste eleve ; une room live
- **Etapes** :
  1. Activer le lecteur d'ecran et la police max.
  2. Ouvrir l'ecran Rooms et balayer jusqu'au bouton d'action de la premiere room.
  3. Ecouter l'annonce (doit inclure le titre de la room pour distinguer plusieurs rooms).
  4. Double-taper pour ouvrir le prompt, parcourir les boutons du dialogue au lecteur d'ecran.
- **Resultat attendu** : annonce "Fermer la room {titre de la room}, bouton" (le titre fait partie de l'`accessibilityLabel`, ce qui evite l'ambiguite entre plusieurs boutons "Fermer") ; cible >= 44 px (`minHeight: 44`) ; texte du bouton lisible en police max (rouge sur fond `palette.onError`, contraste a verifier) ; le dialogue est navigable et les boutons Annuler/OK annonces.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce inclut le titre de la room + role bouton ET le double-tap ouvre le prompt accessible ; KO si l'annonce est generique ("Fermer la room" sans titre), tronquee, ou la cible < 44 px.
- **Donnees de test** : deux rooms live distinctes `r1`/`r2` avec titres differents pour valider la desambiguisation.
- **Duree estimee** : 5 min

### ADM-ROOMS-009 - Fermeture forcee synchronisee multi-utilisateur (admin + participants)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : compte admin (appareil A) ; au moins 2 comptes participants connectes dans la meme room live (appareils B et C, micro accorde, canal LiveKit actif) ; reseau OK sur les 3 appareils
- **Etapes** :
  1. Sur B et C, rejoindre la room "Morning Standup" et verifier l'audio actif.
  2. Sur A (admin), ouvrir l'ecran Rooms, taper "Fermer la room Morning Standup", saisir "Conduite abusive", confirmer.
  3. Observer simultanement B et C.
  4. Sur A, declencher un pull-to-refresh apres la fermeture.
- **Resultat attendu** : cote A, `POST /force-end` part ; apres refetch la room sort de la liste live. Cote B et C, conformement a `admin.rooms.forceEndNotice` : notification de fin reçue, canal audio LiveKit ferme, ejection de la room (audio coupe). La fermeture est observee quasi-simultanement sur B et C.
- **Critere d'acceptation (OK/KO)** : OK si B et C sont notifies et ejectes (audio coupe) suite a l'action de A, ET la room disparait de la liste admin apres refetch ; KO si un participant reste en audio ou n'est pas notifie.
- **Donnees de test** : room `{ id: "r1", title: "Morning Standup" }`, host `alice` ; reason = "Conduite abusive" ; comptes participants `bob@test.io`, `carol@test.io`.
- **Duree estimee** : 8 min

### ADM-ROOMS-010 - Pull-to-refresh recharge la liste des rooms live

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin ; liste deja chargee (>=1 room) ; reseau OK
- **Etapes** :
  1. Sur la liste, tirer vers le bas (pull-to-refresh).
  2. Observer l'indicateur `refreshing` puis le contenu.
- **Resultat attendu** : `refetch()` appele -> nouvel `GET /admin/rooms?live=true` ; spinner de refresh affiche pendant `isRefetching` puis disparait ; toute room nouvellement live apparait, toute room terminee entre-temps disparait.
- **Critere d'acceptation (OK/KO)** : OK si une requete de rechargement part et la liste reflete l'etat serveur a jour ; KO si aucun appel ou liste figee.
- **Donnees de test** : seeder une room supplementaire live cote backend juste avant le geste pour valider l'apparition.
- **Duree estimee** : 3 min

### ADM-ROOMS-011 - Pull-to-refresh hors-ligne / reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; liste chargee ; passer en mode avion juste avant le geste
- **Etapes** :
  1. Activer le mode avion.
  2. Tirer pour rafraichir plusieurs fois rapidement.
  3. Re-activer le reseau et re-tirer pour rafraichir.
- **Resultat attendu** : hors-ligne, le refetch echoue sans crash ; l'ecran conserve la derniere liste connue (ou bascule sur l'etat erreur `errorLoadingRooms` si aucune donnee en cache) ; les pulls repetes ne declenchent pas de comportement incoherent ; apres reconnexion, le refresh aboutit et met la liste a jour.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash hors-ligne et rechargement correct apres reconnexion ; KO si crash, double-spinner bloque, ou liste vide erronee.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ADM-ROOMS-012 - Pull-to-refresh accessibilite + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver actif ; police systeme max ; liste chargee
- **Etapes** :
  1. Activer le lecteur d'ecran et la police max.
  2. Avec TalkBack/VoiceOver, executer le geste de rafraichissement (geste explorer-par-toucher puis action de refresh, ou bouton "Actualiser" expose par le RefreshControl selon la plateforme).
  3. Ecouter les annonces d'etat.
- **Resultat attendu** : le rafraichissement est declenchable au lecteur d'ecran ; un etat "en cours de chargement"/"Chargement…" est annonce pendant `isRefetching` ; les cellules restent lisibles en police max (titres `numberOfLines=1`, sous-texte hote tronque proprement).
- **Critere d'acceptation (OK/KO)** : OK si le refresh est accessible et un etat de chargement est annonce ; KO si le geste est impossible au lecteur d'ecran ou aucun feedback.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ADM-ROOMS-013 - Etat liste vide (aucune room active)

- **Type** : Fonctionnel positif (etat de donnees)
- **Priorite** : P2
- **Pre-conditions** : compte admin ; `GET /admin/rooms?live=true` renvoie `[]`
- **Etapes** :
  1. S'assurer qu'aucune room n'est live cote backend.
  2. Ouvrir l'ecran Rooms.
- **Resultat attendu** : header "Rooms en direct" + avertissement `forceEndNotice` affiches ; `EmptyState` titre "Aucune room active" (`admin.rooms.empty`) ; aucun bouton "Fermer la room" rendu ; pull-to-refresh toujours disponible.
- **Critere d'acceptation (OK/KO)** : OK si l'etat vide s'affiche avec le bon libelle et aucun bouton d'action ; KO si liste fantome ou erreur affichee a tort.
- **Donnees de test** : reponse `{ "data": [] }`.
- **Duree estimee** : 2 min

### ADM-ROOMS-014 - Etat erreur de chargement

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; backend renvoie une erreur sur `GET /admin/rooms` (500 ou timeout)
- **Etapes** :
  1. Forcer une erreur serveur (couper l'API ou renvoyer 500 via proxy).
  2. Ouvrir l'ecran Rooms.
- **Resultat attendu** : `EmptyState` titre "Erreur" (`common.error`) + description "Impossible de charger les rooms." (`admin.rooms.errorLoadingRooms`) ; aucun bouton d'action ; pas de crash. (Note : l'ecran n'expose pas de bouton "Reessayer" dedie ; le pull-to-refresh n'est pas rendu dans la branche erreur — la recuperation passe par re-entree dans l'ecran.)
- **Critere d'acceptation (OK/KO)** : OK si le message d'erreur exact s'affiche sans crash ; KO si ecran blanc, crash, ou liste vide trompeuse.
- **Donnees de test** : reponse HTTP 500 sur `/admin/rooms`.
- **Duree estimee** : 3 min

### ADM-ROOMS-015 - Acces refuse pour role non-admin (deep-link)

- **Type** : Erreur/Limite (securite)
- **Priorite** : P0
- **Pre-conditions** : compte `standard` (non moderateur) authentifie ; tentative d'atteindre la route `AdminRooms` par deep-link ou navigation forcee
- **Etapes** :
  1. Se connecter avec un compte standard.
  2. Forcer la navigation vers `AdminRooms` (deep-link/dev menu).
  3. Observer la reaction de l'ecran et la reponse serveur.
- **Resultat attendu** : les appels admin (`/admin/rooms`, et `/admin/me` cote re-verification) sont rejetes en 403 ; aucune donnee de room sensible n'est affichee ; l'ecran tombe sur l'etat erreur/charge sans exposer la liste. L'entree Godmode n'etant de toute facon pas rendue pour un compte standard, ce chemin ne doit pas etre atteignable en usage normal.
- **Critere d'acceptation (OK/KO)** : OK si aucune room n'est listee et aucune action force-end n'est possible pour un non-admin (403) ; KO si la liste s'affiche ou si force-end aboutit.
- **Donnees de test** : compte `user@test.io` (role standard).
- **Duree estimee** : 4 min
