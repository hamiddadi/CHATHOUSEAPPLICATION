# 31 - Notifications (`notifications`)

## Contexte ecran

- **Fichier** : `src/features/notifications/screens/NotificationsScreen/NotificationsScreen.tsx`
- **Route** : `Notifications` (dans le `RoomStack`, type `NativeStackNavigationProp<RoomStackParamList, 'Notifications'>`). On y arrive par navigation depuis l'app authentifiee ; le bouton retour fait `navigation.goBack()`.
- **Roles requis** : `standard` et `admin` (compte authentifie obligatoire). Un `guest` (non authentifie) n'a pas de socket notifications (`useNotificationSocket` ne s'abonne que si `status === 'authenticated'`) et n'a normalement pas acces a cet ecran. Le contenu (room_invite, house_invite, mention, etc.) ne depend pas du role admin ; la moderation n'est pas exposee sur cet ecran.
- **Comportements temps-reel** :
  - Le hook `useNotificationSocket` (monte au niveau navigation, hors de cet ecran) ecoute deux evenements WebSocket sur le canal personnel `user:<id>` :
    - `notification:new` → invalide toutes les requetes `['notifications']` (toutes les listes all/rooms/social/clubs + le compteur non-lus) → la liste se rafraichit sans polling.
    - `notification:count` → ecrit le total non-lus faisant autorite directement dans la query badge → le badge se met a jour instantanement (creation, mark-one-read, mark-all-read).
  - L'ecran lui-meme consomme ces invalidations via React Query : une nouvelle notif fait re-render la `FlatList` et le compteur d'en-tete (`unreadCount`).
- **Pre-conditions globales** : session authentifiee valide (token), socket connecte (`getSocket()`), reseau pour `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id`.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` → `<Loader fullscreen accessibilityLabel={t('notifications.title')} />`.
  - **Liste vide** : `data.length === 0` → `<EmptyState title={t('notifications.empty')} />` ("Rien a signaler.").
  - **Non lus** : `unreadCount > 0` → sous-titre `t('notifications.unread', { count })` ("{{count}} non lues") + bouton "Tout marquer comme lu" affiches ; chaque ligne non lue a un fond `bg-overlay-white-5` + une pastille `bg-primary`.
  - **Lu** : `accessibilityState={{ selected: true }}` sur la ligne, pas de pastille.
  - **Hors-ligne / latence** : `GET /notifications` echoue ou tarde ; les mutations (mark/delete) sont optimistes uniquement au sens React Query (invalidation `onSuccess`), donc en cas d'echec reseau l'etat revient apres refetch.
  - **Pull-to-refresh** : `refreshing={isFetching}`, `onRefresh={() => void refetch()}`.

> Note : aucun partial dans `partials/` (le dossier n'existe pas). Tous les elements interactifs sont definis dans le fichier principal (en-tete, pills d'onglet, lignes `NotificationRow`, action de swipe `RightActions`).

## Matrice bouton

| #   | Bouton                                  | Emplacement                        | Type                                     | Locator reel                                                                                                                                              | Pre-condition                                        | Priorite |
| --- | --------------------------------------- | ---------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| 1   | Retour (fleche)                         | Header (gauche)                    | navigation                               | `accessibilityRole="button"` + icone MaterialIcons `arrow-back` (pas d'`accessibilityLabel`) ; selection texte titre `t('notifications.title')` adjacent  | Ecran ouvert avec un ecran precedent dans la pile    | P1       |
| 2   | Tout marquer comme lu                   | Header (droite)                    | submit / realtime-action                 | `t('notifications.markAllRead')` = "Tout marquer comme lu"                                                                                                | `unreadCount > 0` (au moins 1 non lue)               | P0       |
| 3   | Onglet « Tout »                         | Barre d'onglets                    | toggle (filtre)                          | `t('notifications.tabs.all')` = "Tout"                                                                                                                    | Ecran charge                                         | P1       |
| 4   | Onglet « Rooms »                        | Barre d'onglets                    | toggle (filtre)                          | `t('notifications.tabs.rooms')` = "Rooms"                                                                                                                 | Ecran charge                                         | P1       |
| 5   | Onglet « Social »                       | Barre d'onglets                    | toggle (filtre)                          | `t('notifications.tabs.social')` = "Social"                                                                                                               | Ecran charge                                         | P1       |
| 6   | Onglet « Clubs »                        | Barre d'onglets                    | toggle (filtre)                          | `t('notifications.tabs.clubs')` = "Clubs"                                                                                                                 | Ecran charge                                         | P1       |
| 7   | Ligne de notification (tap → deep-link) | Corps / cellule de liste           | list-item / navigation / realtime-action | Texte du message `notif.message` (ex. "Jane Doe started following you") ; `accessibilityRole="button"`, `accessibilityState={{ selected: notif.isRead }}` | Au moins 1 notif dans `data`                         | P0       |
| 8   | Supprimer (swipe vers la gauche)        | Cellule de liste (action de swipe) | destructive / realtime-action            | `accessibilityLabel={t('notifications.delete')}` = "Supprimer" (icone MaterialIcons `delete`)                                                             | Au moins 1 notif ; geste swipe disponible            | P1       |
| 9   | Pull-to-refresh                         | Corps (FlatList)                   | realtime-action (refetch)                | Pas de label ; geste tirer-pour-rafraichir, `refreshing={isFetching}`                                                                                     | Au moins 1 notif (FlatList rendue, pas l'EmptyState) | P1       |

## Cas de test

### NOTIF-001 - Retour ferme l'ecran et revient a l'ecran precedent

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, ecran Notifications ouvert depuis un ecran precedent (ex. profil/feed), aucune permission speciale.
- **Etapes** :
  1. Ouvrir Notifications depuis l'ecran precedent.
  2. Taper sur la fleche retour en haut a gauche (icone `arrow-back`).
- **Resultat attendu** : `navigation.goBack()` est appele ; l'app revient sur l'ecran precedent ; aucun appel reseau declenche par le retour.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est de nouveau affiche et que Notifications est demonte ; KO si rien ne se passe ou si l'app crashe.
- **Donnees de test** : compte `test-standard@chathouse.io` / mdp `Test1234!`.
- **Duree estimee** : 2 min

### NOTIF-002 - Retour : multi-clic rapide ne depile pas deux ecrans

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, ecran Notifications ouvert avec un seul ecran precedent dans la pile.
- **Etapes** :
  1. Taper 4-5 fois tres rapidement sur la fleche retour.
  2. Observer la pile de navigation resultante.
- **Resultat attendu** : un seul `goBack` effectif ; on revient sur l'ecran precedent sans depiler au-dela (pas d'ecran blanc, pas de sortie inattendue de la pile).
- **Critere d'acceptation (OK/KO)** : OK si l'ecran final est bien l'ecran precedent unique ; KO si l'app sort trop loin dans la pile ou crashe.
- **Donnees de test** : idem NOTIF-001.
- **Duree estimee** : 3 min

### NOTIF-003 - Retour : accessibilite lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme reglee sur le maximum, mode contraste eleve actif.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande taille de police.
  2. Balayer jusqu'au premier element de l'en-tete.
  3. Ecouter l'annonce du bouton retour.
  4. Double-taper pour activer.
- **Resultat attendu** : l'element est annonce comme bouton (role `button`) et activable ; comme l'icone n'a pas d'`accessibilityLabel` explicite, verifier que le lecteur annonce au moins un libelle exploitable (a defaut, lever un defaut d'accessibilite : libelle manquant sur la fleche retour). Le titre "Notifications" reste lisible sans troncature genante en grande police.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, annonce comme bouton et active `goBack` au double-tap, et si le titre reste lisible ; KO si le focus saute l'element ou si aucune annonce n'est fournie.
- **Donnees de test** : idem NOTIF-001.
- **Duree estimee** : 4 min

### NOTIF-004 - Tout marquer comme lu remet le compteur a zero

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins 3 notifications dont au moins 2 non lues (`unreadCount > 0`).
- **Etapes** :
  1. Ouvrir Notifications ; verifier le sous-titre "{{count}} non lues" et la presence du bouton "Tout marquer comme lu".
  2. Taper sur "Tout marquer comme lu".
  3. Attendre la reponse de `PATCH /notifications/read-all`.
- **Resultat attendu** : `markAll.mutate()` est appele une fois ; au succes, invalidation de toutes les listes ; le sous-titre "non lues" et le bouton "Tout marquer comme lu" disparaissent ; les pastilles `bg-primary` disparaissent ; les lignes passent en `accessibilityState selected: true` ; evenement WebSocket `notification:count` met le badge global a 0.
- **Critere d'acceptation (OK/KO)** : OK si toutes les notifs sont marquees lues et que le bouton/compteur disparaissent ; KO si une notif reste non lue ou si le compteur ne bouge pas.
- **Donnees de test** : payload reponse attendu `{ data: { updated: 2 } }`.
- **Duree estimee** : 3 min

### NOTIF-005 - Tout marquer comme lu : multi-clic rapide + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, au moins 2 non lues, reseau bascule en hors-ligne juste apres le premier tap (mode avion ou throttling Charles/Proxyman).
- **Etapes** :
  1. Ouvrir Notifications avec des non lues.
  2. Taper 5 fois tres rapidement sur "Tout marquer comme lu".
  3. Couper le reseau pendant la requete (mode avion).
  4. Restaurer le reseau et tirer pour rafraichir.
- **Resultat attendu** : les taps multiples n'envoient pas plusieurs requetes incoherentes (idealement la mutation est ignoree tant qu'une est en cours ; sinon `read-all` est idempotent). En cas d'echec reseau, l'etat non-lu doit revenir coherent apres refetch (les notifs deja marquees cote serveur restent lues). Aucun crash, aucune notif fantome.
- **Critere d'acceptation (OK/KO)** : OK si l'etat final apres reconnexion est coherent avec le serveur (toutes lues si la requete a abouti, sinon etat inchange) et sans doublon ; KO si l'UI affiche un etat incoherent persistant ou crashe.
- **Donnees de test** : compte avec exactement 2 non lues ; observer le nombre d'appels `read-all` dans le proxy reseau.
- **Duree estimee** : 5 min

### NOTIF-006 - Tout marquer comme lu : accessibilite + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, au moins 1 non lue, TalkBack/VoiceOver actif, grande police, contraste eleve.
- **Etapes** :
  1. Ouvrir Notifications avec des non lues.
  2. Balayer jusqu'au bouton "Tout marquer comme lu".
  3. Verifier l'annonce (texte + role bouton).
  4. Double-taper pour activer.
- **Resultat attendu** : le bouton est annonce "Tout marquer comme lu, bouton" et activable ; le libelle reste lisible (non tronque) en grande police ; le texte `text-ink-muted` sur fond `bg-overlay-white-5` reste suffisamment contraste (verifier ratio >= 4.5:1).
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, correctement annonce, activable et lisible ; KO si non focusable, libelle absent ou contraste insuffisant.
- **Donnees de test** : idem NOTIF-004.
- **Duree estimee** : 4 min

### NOTIF-007 - Tout marquer comme lu : synchro multi-appareil (temps-reel)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : meme compte `standard` connecte sur deux appareils (A et B), socket connecte sur les deux, au moins 2 non lues.
- **Etapes** :
  1. Sur l'appareil A, ouvrir Notifications (compteur "2 non lues").
  2. Sur l'appareil B, ouvrir Notifications (compteur "2 non lues").
  3. Sur A, taper "Tout marquer comme lu".
  4. Observer l'appareil B sans interaction.
- **Resultat attendu** : sur B, l'evenement `notification:count` met le badge global a 0 et `notification:new`/invalidation rafraichit la liste : le sous-titre "non lues" et les pastilles disparaissent sur B sans action manuelle.
- **Critere d'acceptation (OK/KO)** : OK si B reflete l'etat "tout lu" en quelques secondes via le socket, sans pull-to-refresh manuel ; KO si B reste sur "2 non lues" jusqu'a un refresh manuel.
- **Donnees de test** : idem NOTIF-004 ; surveiller les frames WebSocket `notification:count` (count=0).
- **Duree estimee** : 5 min

### NOTIF-008 - Onglet « Tout » affiche toutes les notifications

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, notifications de plusieurs categories (room_invite, follow, house_invite, mention).
- **Etapes** :
  1. Ouvrir Notifications ; "Tout" est selectionne par defaut (`filter = 'all'`, `accessibilityState selected: true`).
  2. Si un autre onglet est actif, taper sur "Tout".
- **Resultat attendu** : `GET /notifications` sans param `filter` ; la liste affiche toutes les notifs toutes categories confondues ; la pill "Tout" passe en `bg-primary` (selected).
- **Critere d'acceptation (OK/KO)** : OK si l'onglet "Tout" est mis en surbrillance et la liste complete s'affiche ; KO si un filtre reste applique.
- **Donnees de test** : jeu de 4 notifs de types differents.
- **Duree estimee** : 2 min

### NOTIF-009 - Onglet « Rooms » filtre les notifications de rooms

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins 1 notif room (room_invite/room_starting/hand_accepted/rsvp_reminder) et 1 notif non-room (follow).
- **Etapes** :
  1. Ouvrir Notifications.
  2. Taper sur l'onglet "Rooms".
  3. Attendre le re-fetch.
- **Resultat attendu** : `GET /notifications?filter=rooms` ; seules les notifs liees aux rooms s'affichent ; la pill "Rooms" passe en `bg-primary` ; les autres onglets reviennent en style non-selectionne.
- **Critere d'acceptation (OK/KO)** : OK si seules les notifs rooms restent et que "Rooms" est selectionne ; KO si des notifs non-rooms apparaissent.
- **Donnees de test** : param de requete attendu `{ filter: 'rooms' }`.
- **Duree estimee** : 3 min

### NOTIF-010 - Onglets : bascule rapide + latence reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau bride a forte latence (>2 s) via proxy, plusieurs notifs.
- **Etapes** :
  1. Ouvrir Notifications.
  2. Taper rapidement en sequence : "Rooms" → "Social" → "Clubs" → "Tout" → "Rooms".
  3. Attendre la stabilisation.
- **Resultat attendu** : l'onglet finalement selectionne ("Rooms") est mis en surbrillance et sa liste correspondante s'affiche ; aucune liste d'un onglet anterieur ne reste affichee a tort (React Query gere les cles par filtre) ; pas de crash ni de loader bloque.
- **Critere d'acceptation (OK/KO)** : OK si l'UI affiche le contenu coherent avec le dernier onglet tape ; KO si la liste affichee ne correspond pas a l'onglet selectionne.
- **Donnees de test** : latence simulee 2-3 s sur `/notifications`.
- **Duree estimee** : 4 min

### NOTIF-011 - Onglets : accessibilite (etat selectionne annonce)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, grande police, contraste eleve.
- **Etapes** :
  1. Ouvrir Notifications.
  2. Balayer sur les 4 pills d'onglet (Tout/Rooms/Social/Clubs).
  3. Activer "Social" par double-tap.
- **Resultat attendu** : chaque pill est annoncee comme bouton avec son etat (`accessibilityState selected`) ; l'onglet actif est annonce "selectionne" ; apres activation de "Social", le lecteur annonce le nouvel etat selectionne. Les libelles courts restent lisibles en grande police.
- **Critere d'acceptation (OK/KO)** : OK si l'etat selectionne est annonce et change a l'activation ; KO si l'etat selected n'est pas communique au lecteur d'ecran.
- **Donnees de test** : idem NOTIF-008.
- **Duree estimee** : 4 min

### NOTIF-012 - Tap sur notification « follow » : marque lu + deep-link profil

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins 1 notif `kind = 'follow'` non lue avec `actor.id` non vide (ex. message "Jane Doe started following you").
- **Etapes** :
  1. Ouvrir Notifications.
  2. Taper sur la ligne "Jane Doe started following you".
- **Resultat attendu** : `markOne.mutate('n1')` (`PATCH /notifications/n1/read`) ; la ligne perd sa pastille et passe `selected: true` ; navigation `navigate('Profile', { userId: 'u1' })`.
- **Critere d'acceptation (OK/KO)** : OK si la notif est marquee lue ET que le profil de l'acteur s'ouvre ; KO si l'un des deux echoue.
- **Donnees de test** : notif `{ id: 'n1', kind: 'follow', actor.id: 'u1' }`.
- **Duree estimee** : 3 min

### NOTIF-013 - Tap sur notification « room_invite » deep-link vers la room

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, Wi-Fi, notif `kind = 'room_invite'` (ou room_starting/hand_accepted/rsvp_reminder) avec `roomId` non nul.
- **Etapes** :
  1. Ouvrir Notifications (onglet Tout ou Rooms).
  2. Taper sur la ligne d'invitation a une room.
- **Resultat attendu** : `markOne.mutate(id)` ; navigation `navigate('Room', { roomId })` ; entree dans la room (chemin critique temps-reel : rejoindre une room audio LiveKit).
- **Critere d'acceptation (OK/KO)** : OK si la notif est marquee lue ET la Room cible s'ouvre avec le bon `roomId` ; KO sinon.
- **Donnees de test** : notif `{ kind: 'room_invite', roomId: 'r123' }`.
- **Duree estimee** : 3 min

### NOTIF-014 - Tap sur notification deja lue : pas de double mark, deep-link quand meme

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, 1 notif `follow` deja lue (`isRead: true`, `actor.id` non vide).
- **Etapes** :
  1. Ouvrir Notifications.
  2. Taper plusieurs fois rapidement sur une ligne deja lue.
- **Resultat attendu** : `markOne.mutate` n'est PAS appele (le code ne marque que si `!notif.isRead`) ; la navigation vers le profil se declenche une seule fois de maniere coherente (multi-tap rapide ne doit pas empiler plusieurs ecrans Profile identiques de facon problematique).
- **Critere d'acceptation (OK/KO)** : OK si aucun appel `read` n'est emis et que la navigation reste coherente ; KO si un `PATCH read` est emis ou si plusieurs ecrans Profile s'empilent.
- **Donnees de test** : notif `{ id: 'n9', kind: 'follow', isRead: true, actor.id: 'u1' }`.
- **Duree estimee** : 3 min

### NOTIF-015 - Tap sur notification : echec reseau du mark-as-read

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, notif `follow` non lue, reseau coupe (mode avion) avant le tap.
- **Etapes** :
  1. Couper le reseau (mode avion).
  2. Ouvrir Notifications (depuis cache) et taper sur une notif non lue.
  3. Restaurer le reseau et tirer pour rafraichir.
- **Resultat attendu** : la navigation deep-link peut se declencher localement ; `PATCH /notifications/:id/read` echoue → pas d'invalidation `onSuccess` → la notif reste affichee non lue apres refetch (etat coherent avec le serveur). Aucun crash, pas d'etat "lu" persistant fictif.
- **Critere d'acceptation (OK/KO)** : OK si, apres reconnexion et refresh, la notif reflete l'etat reel du serveur (toujours non lue puisque le PATCH a echoue) ; KO si elle reste faussement marquee lue.
- **Donnees de test** : notif non lue `{ id: 'n1' }` ; observer l'absence de `PATCH read` reussi.
- **Duree estimee** : 4 min

### NOTIF-016 - Tap sur notification : accessibilite (role + etat lu/non-lu)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, grande police, contraste eleve, 1 notif non lue + 1 lue.
- **Etapes** :
  1. Ouvrir Notifications.
  2. Balayer sur une ligne non lue puis une lue.
  3. Double-taper sur la non lue.
- **Resultat attendu** : chaque ligne est annoncee comme bouton ; l'etat `selected` (= isRead) est communique (la non lue annoncee non selectionnee, la lue selectionnee) ; le message sur 2 lignes (`numberOfLines={2}`) reste lisible en grande police ; au double-tap, la notif est marquee lue et la navigation se declenche.
- **Critere d'acceptation (OK/KO)** : OK si role + etat lu/non-lu sont annonces et l'activation fonctionne ; KO si l'etat lu n'est pas distinguable au lecteur d'ecran.
- **Donnees de test** : 1 notif `isRead: false`, 1 notif `isRead: true`.
- **Duree estimee** : 4 min

### NOTIF-017 - Tap notification temps-reel : arrivee live puis ouverture

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : compte `standard` (utilisateur A) sur l'ecran Notifications ; un second compte (B) declenche une action generant une notif pour A (ex. B suit A → `NEW_FOLLOWER`, ou B invite A dans une room → `ROOM_INVITE`).
- **Etapes** :
  1. A ouvre Notifications et reste dessus.
  2. B effectue l'action (follow / invite room) cote serveur.
  3. Observer l'arrivee de la nouvelle ligne chez A sans interaction.
  4. A tape sur la nouvelle ligne.
- **Resultat attendu** : `notification:new` invalide la liste → la nouvelle notif apparait en tete chez A en quelques secondes (sans pull-to-refresh) ; `notification:count` incremente le badge ; au tap, A est marquee lue et deep-linkee (Profile de B pour un follow, Room pour une invitation).
- **Critere d'acceptation (OK/KO)** : OK si la notif apparait live et le tap deep-link/marque lue correctement ; KO si A doit rafraichir manuellement pour voir la notif.
- **Donnees de test** : compte B `test-standard-2@chathouse.io` ; surveiller frames `notification:new` et `notification:count`.
- **Duree estimee** : 6 min

### NOTIF-018 - Supprimer une notification par swipe

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins 2 notifications.
- **Etapes** :
  1. Ouvrir Notifications.
  2. Balayer une ligne vers la gauche pour reveler l'action rouge "Supprimer".
  3. Taper sur le bouton "Supprimer".
- **Resultat attendu** : `remove.mutate(id)` (`DELETE /notifications/:id`) ; au succes, invalidation des listes → la ligne disparait ; si elle etait non lue, le compteur "non lues" decremente et le badge global se met a jour via `notification:count`.
- **Critere d'acceptation (OK/KO)** : OK si la notif est retiree de la liste et le compteur ajuste ; KO si elle reste affichee.
- **Donnees de test** : notif `{ id: 'n2' }`.
- **Duree estimee** : 3 min

### NOTIF-019 - Supprimer : multi-tap rapide + perte reseau pendant le DELETE

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, au moins 1 notif, reseau coupe juste apres avoir revele l'action de swipe.
- **Etapes** :
  1. Ouvrir Notifications.
  2. Balayer une ligne et taper 4-5 fois tres vite sur "Supprimer".
  3. Couper le reseau (mode avion) avant la reponse.
  4. Restaurer le reseau et tirer pour rafraichir.
- **Resultat attendu** : un seul `DELETE` effectif pour la meme notif (les taps suivants visent un id deja en cours/inexistant) ; en cas d'echec reseau, pas d'invalidation → la notif reste affichee ; apres reconnexion + refresh, l'etat reflete le serveur (supprimee si le DELETE a abouti, presente sinon). Pas de crash ni de ligne fantome.
- **Critere d'acceptation (OK/KO)** : OK si l'etat final est coherent avec le serveur sans doublon ni ligne fantome ; KO sinon.
- **Donnees de test** : notif `{ id: 'n2' }` ; compter les requetes `DELETE /notifications/n2`.
- **Duree estimee** : 5 min

### NOTIF-020 - Supprimer : accessibilite de l'action de swipe

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, grande police, contraste eleve, au moins 1 notif.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Focaliser une ligne de notification.
  3. Acceder a l'action de swipe (sous TalkBack/VoiceOver via le menu d'actions ou le geste de balayage) "Supprimer".
  4. Activer "Supprimer".
- **Resultat attendu** : l'action est exposee avec `accessibilityLabel="Supprimer"` et `accessibilityRole="button"` ; le lecteur l'annonce ; l'activation supprime la notif. Le bouton rouge (`bg-danger`, icone + texte blanc) reste lisible/contraste en grande police.
- **Critere d'acceptation (OK/KO)** : OK si l'action "Supprimer" est decouvrable, annoncee et activable au lecteur d'ecran ; KO si l'action de swipe est inaccessible sans geste tactile precis.
- **Donnees de test** : notif `{ id: 'n2' }`.
- **Duree estimee** : 5 min

### NOTIF-021 - Pull-to-refresh recharge la liste

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins 1 notif (FlatList affichee, pas l'EmptyState).
- **Etapes** :
  1. Ouvrir Notifications.
  2. Tirer la liste vers le bas pour declencher le rafraichissement.
- **Resultat attendu** : indicateur de rafraichissement (`refreshing={isFetching}`) ; `refetch()` relance `GET /notifications` avec le filtre courant ; la liste se met a jour (nouvelles notifs en tete, suppressions cote serveur prises en compte).
- **Critere d'acceptation (OK/KO)** : OK si le spinner apparait et la liste est rechargee ; KO si le geste n'a aucun effet.
- **Donnees de test** : ajouter une notif cote serveur entre l'ouverture et le pull pour verifier qu'elle apparait.
- **Duree estimee** : 2 min

### NOTIF-022 - Pull-to-refresh hors-ligne puis reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, au moins 1 notif en cache, reseau coupe (mode avion).
- **Etapes** :
  1. Ouvrir Notifications (liste depuis cache).
  2. Couper le reseau.
  3. Tirer pour rafraichir plusieurs fois.
  4. Restaurer le reseau et tirer de nouveau.
- **Resultat attendu** : hors-ligne, `refetch` echoue, le spinner s'arrete et la liste reste celle du cache (pas d'ecran vide ni de crash) ; apres reconnexion, le pull recharge correctement la liste a jour.
- **Critere d'acceptation (OK/KO)** : OK si la liste cache reste affichee hors-ligne et se met a jour apres reconnexion ; KO si la liste se vide ou l'app crashe.
- **Donnees de test** : idem NOTIF-021.
- **Duree estimee** : 4 min

### NOTIF-023 - Pull-to-refresh : accessibilite et etat vide apres refresh

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, grande police, contraste eleve, liste avec notifs puis vidage cote serveur.
- **Etapes** :
  1. Ouvrir Notifications avec des notifs.
  2. Supprimer toutes les notifs cote serveur (ou tout marquer lu + filtre vide).
  3. Tirer pour rafraichir.
- **Resultat attendu** : apres refresh, la liste vide bascule sur l'`EmptyState` "Rien a signaler." ; ce texte est annonce par le lecteur d'ecran et lisible en grande police. L'indicateur de rafraichissement ne piege pas le focus.
- **Critere d'acceptation (OK/KO)** : OK si l'EmptyState s'affiche et est annonce apres refresh d'une liste devenue vide ; KO si la liste reste affichee ou si l'EmptyState n'est pas accessible.
- **Donnees de test** : vider toutes les notifs cote serveur.
- **Duree estimee** : 4 min

### NOTIF-024 - Tap notification « house_invite » deep-link vers la maison/club

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, notif `kind = 'house_invite'` (backend `CLUB_INVITE`) avec `houseId` non nul.
- **Etapes** :
  1. Ouvrir Notifications (onglet Tout ou Clubs).
  2. Taper sur la ligne d'invitation a une maison/club.
- **Resultat attendu** : `markOne.mutate(id)` ; navigation `navigate('HouseDetail', { houseId })`.
- **Critere d'acceptation (OK/KO)** : OK si la notif est marquee lue ET l'ecran HouseDetail s'ouvre avec le bon `houseId` ; KO sinon.
- **Donnees de test** : notif `{ kind: 'house_invite', houseId: 'h42' }`.
- **Duree estimee** : 3 min
