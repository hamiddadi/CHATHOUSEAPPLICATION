# 03 - Scenarios d'integration temps-reel multi-utilisateurs

> **Perimetre** : ce document decrit les scenarios de test **multi-utilisateurs / multi-appareils** qui valident les comportements temps-reel de ChatHouse de bout en bout (room audio LiveKit, messagerie socket.io, notifications push/WebSocket, reconnexion, coherence cross-device). Chaque scenario implique **au moins 2 comptes et/ou 2 appareils** et observe le resultat attendu **sur chaque appareil separement**.
>
> Ces scenarios completent les cas par ecran de `docs/qa/screens/` ; ils ne re-testent pas l'UI d'un ecran isole mais la **synchronisation entre acteurs**.

## Pre-requis communs (a tous les scenarios)

- **Build** : la voix LiveKit requiert un **build EAS dev-client** (le module natif WebRTC est indisponible en Expo Go -> statut audio `unsupported`, banniere d'avertissement, reste fonctionnel pour le reste). Les scenarios audio (RT-001 a RT-012) doivent tourner sur dev-client.
- **Backend** : serveur joignable sur l'IP LAN du `.env` racine (port `:4000`), Postgres + Redis up, socket.io connecte (`getSocket()` non `null`). Redemarrer Expo apres edition du `.env`.
- **Comptes de test** : au minimum 2 comptes authentifies distincts. Convention dans ce doc : **Acteur A** = `qa-a@chathouse.test`, **Acteur B** = `qa-b@chathouse.test`, **Acteur C** = `qa-c@chathouse.test` (utilise pour les scenarios a 3). Pour la coherence multi-appareils, **A** est connecte simultanement sur **Device A1** et **Device A2** (meme compte).
- **Roles** : sauf mention contraire, A et B sont `standard`. Les scenarios de moderation room exigent un host/moderator (precise en pre-conditions).
- **Reseau** : Wi-Fi stable par defaut ; les scenarios de reconnexion (RT-020 a RT-026) imposent des coupures controlees (mode avion, throttling 3G, bascule Wi-Fi/cellulaire).
- **Notation acteur** : les etapes sont prefixees par l'acteur qui agit (**[A]**, **[B]**, **[C]**, **[A1]/[A2]** pour les 2 devices du meme compte). Le **resultat attendu est detaille par appareil**.

## Instrumentation a observer (rappel)

Pour qualifier OK/KO, observer selon le scenario :

- **WebSocket (socket.io)** : tracer l'emission/reception cote client (DevTools reseau ou log applicatif) des events :
  - Room : `room:role_changed`, `room:mute-changed`, `room:user_kicked`, `room:you_were_kicked`, `room:ended`, `room:reaction`, invalidation file de mains (`useRoomSocket`).
  - Chat 1:1 : `chat:message`, `chat:read`, `chat:typing`.
  - Groupe : `group:message`.
  - Notifications (canal `user:<id>`) : `notification:new`, `notification:count`.
  - Hallway : `hallway:room_created`, `hallway:room_closed`, `hallway:room_updated`.
  - Maps : `maps:update-location`, `maps:toggle-visibility`, `maps:user-moved`, `maps:user-offline`.
- **LiveKit** : statut `useRoomAudio` (`idle` / `connecting` / `live` / `reconnecting` / `error` / `unsupported`), scores "is speaking" (`SPEAKING_SCORE_THRESHOLD`), publication/mute de la piste audio locale, fermeture du canal cote backend sur force-end.
- **Push (OS)** : reception de la notification systeme (room_invite, room_starting, hand_accepted, rsvp_reminder, CLUB_INVITE, wave/ping) quand l'app est en arriere-plan ou tuee.
- **REST + React Query** : appels HTTP et invalidations de cache (cles `roomKeys`, `messageKeys`, `groupKeys`, `notifications`, `houseKeys`, `adminKeys`) ; mutations optimistes et rollback.
- **Compteurs** : `unreadCount` (badge onglet), `participantCount` room, file de mains (`room.handRaised · N`), `attendeeCount` evenement, badge notifications.

---

# A) Room audio live multi-participants

> Reference ecran : `47-ROOM-LIVE.md`. Hooks : `useRoomAudio` (LiveKit), `useRoomSocket` (file mains + participants), `getSocket()` (events room). Les scenarios ci-dessous etendent ROOM-LIVE-015/026/034/038/049/050/051 en vues multi-appareils explicites.

### RT-001 - Promotion d'un auditeur en speaker (host -> auditeur)

- **Type** : Temps-reel multi-utilisateur (audio)
- **Priorite** : P0
- **Pre-conditions** : A = **host** d'une room live (`hostId === A`), B = **auditeur** (listener) dans la meme room, 2 appareils dev-client, micro autorise des deux cotes, audio LiveKit `live` sur A et B.
- **Etapes** :
  1. **[B]** Tape "Lever la main" (`room.raiseA11y`) dans la barre d'action.
  2. **[A]** Observe la section file de mains (`room.handRaised · N`).
  3. **[A]** Tape l'avatar de B dans la file (`room.promoteA11y`) puis valide **SPEAKER** dans `HostActionsSheet`.
  4. **[B]** Active son micro et parle.
- **Resultat attendu** :
  - **Device A (host)** : la main de B apparait dans la file en temps reel (queue invalidee par socket, sans pull manuel) ; apres promotion, B sort de la file (compteur decremente) et apparait dans la grille des orateurs ; quand B parle, sa cellule affiche le speaking-ring vert + badge `graphic-eq`.
  - **Device B (promu)** : recoit `room:role_changed` (SPEAKER) -> micro revele immediatement (`forceSpeaker = true`), haptique succes + alerte `room.alert.stageTitle` / `roleSpeaker` ("On stage") ; B peut publier sa piste audio LiveKit.
- **Critere d'acceptation (OK/KO)** : OK si la file du host se met a jour sans refresh, B obtient le micro et son audio est audible par A ; KO si B reste sans micro, si la file ne reflete pas l'event socket, ou si l'audio n'est pas publie.
- **Instrumentation** : reception `room:role_changed{role:SPEAKER, userId:B}` cote B ; invalidation file (`useRoomSocket`) cote A ; LiveKit `live` + piste audio locale B publiee ; score "is speaking" > seuil cote A.
- **Donnees de test** : roomId `room-rt-1`, host A, auditeur B.
- **Duree estimee** : 7 min

### RT-002 - Mute/unmute d'un speaker propage a la scene

- **Type** : Temps-reel multi-utilisateur (audio)
- **Priorite** : P0
- **Pre-conditions** : A et B sont **tous deux speakers** (ou host+speaker) dans la meme room, audio `live`, micros autorises.
- **Etapes** :
  1. **[B]** Tape "Mute" (`room.muteA11y`) sur son micro.
  2. **[A]** Observe la cellule de B dans la grille des orateurs.
  3. **[B]** Tape "Unmute" et parle.
  4. **[A]** Observe a nouveau la cellule de B.
- **Resultat attendu** :
  - **Device B** : flip optimiste instantane (icone mic-off, `accessibilityState.selected = true`, badge mic-off sur sa propre cellule via `speakersForStage`) ; `audio.setMuted(true)` (LiveKit local) + `setMute.mutateAsync` (REST) + `currentRoomStore.setMuted(true)`.
  - **Device A** : la cellule de B affiche le badge mic-off ; aucun audio de B n'est entendu pendant le mute. A l'unmute, le badge disparait et l'audio de B redevient audible (speaking-ring quand il parle).
- **Critere d'acceptation (OK/KO)** : OK si le mute/unmute de B est reflechi visuellement chez A **et** que le flux audio suit (silence pendant mute, audible apres unmute) ; KO si l'icone lag, si l'audio continue malgre le mute, ou si l'UI de A ne se met pas a jour.
- **Instrumentation** : LiveKit piste audio B mute/unmute ; presence/absence de score "is speaking" cote A ; REST `setMute` 200.
- **Donnees de test** : roomId `room-rt-1`, speakers A et B.
- **Duree estimee** : 6 min

### RT-003 - Force-mute par le host survivant au reconnect

- **Type** : Temps-reel multi-utilisateur (audio) + reconnexion
- **Priorite** : P0
- **Pre-conditions** : A = host, B = speaker (micro actif, en train de parler), 2 appareils, audio `live`.
- **Etapes** :
  1. **[B]** Parle (micro actif, non mute).
  2. **[A]** Ouvre `HostActionsSheet` sur B et declenche le **force-mute**.
  3. **[B]** Tente de continuer a parler.
  4. **[B]** Coupe le reseau ~10 s (mode avion) puis le retablit (audio repasse par `reconnecting` -> `live`).
- **Resultat attendu** :
  - **Device B** : recoit `room:mute-changed` (filtre `userId === viewerId`) -> `setIsMuted(true)` + `currentRoomStore.setMuted(true)`, badge mic-off sur sa cellule ; B est rendu silencieux meme s'il parlait. Apres reconnexion, l'audio **restaure le mute** depuis `currentRoomStore` (pas de hot-unmute). Banniere `room.audioReconnecting` pendant la coupure.
  - **Device A** : la cellule de B passe en mic-off ; A n'entend plus B ; apres la reconnexion de B, B reste silencieux (pas de retour audio spontane).
- **Critere d'acceptation (OK/KO)** : OK si B est mute en temps reel **et** reste mute apres reconnexion ; KO si B se hot-unmute apres reconnexion ou si A continue d'entendre B.
- **Instrumentation** : `room:mute-changed{userId:B}` cote B ; LiveKit `reconnecting` -> `live` ; etat `currentRoomStore.muted = true` persistant ; piste audio B muette apres `live`.
- **Donnees de test** : roomId `room-rt-1`, host A, speaker B.
- **Duree estimee** : 8 min

### RT-004 - File de mains levees : ordre et concurrence (3 acteurs)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : A = host, B et C = auditeurs, 3 appareils, room live.
- **Etapes** :
  1. **[B]** et **[C]** levent la main **quasi simultanement** (a < 1 s d'intervalle).
  2. **[A]** Observe l'ordre et le compteur de la file.
  3. **[A]** Promeut B en SPEAKER.
  4. **[C]** Baisse sa main.
- **Resultat attendu** :
  - **Device A** : la file affiche B et C (ordre = ordre d'arrivee serveur, deterministe), compteur `room.handRaised · 2` ; apres promotion de B, B sort de la file (compteur -> 1) ; quand C baisse, file videe (compteur -> 0, section masquee).
  - **Device B** : `room:role_changed` SPEAKER -> micro + "On stage" ; sort de sa propre file.
  - **Device C** : sa main est dans la file cote host ; apres avoir baisse, son bouton revient a "Lever" (`serverHandRaised` resnap a false).
- **Critere d'acceptation (OK/KO)** : OK si les deux mains apparaissent sans en perdre une (pas de race qui ecrase), ordre stable, compteur exact a chaque transition ; KO si une main manque, si le compteur diverge, ou si l'ordre saute.
- **Instrumentation** : invalidations file (`useRoomSocket`) cote A pour chaque event ; `room:role_changed` cote B ; resnap `serverHandRaised` cote C.
- **Donnees de test** : roomId `room-rt-1`, host A, auditeurs B et C.
- **Duree estimee** : 8 min

### RT-005 - Retrogradation d'un speaker en auditeur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : A = host, B = speaker (micro actif, eventuellement mute, main eventuellement levee), 2 appareils.
- **Etapes** :
  1. **[B]** Speaker actif (micro visible).
  2. **[A]** Ouvre `HostActionsSheet` sur B et **retrograde** en LISTENER.
- **Resultat attendu** :
  - **Device B** : recoit `room:role_changed` (LISTENER) -> `forceSpeaker = false`, `isMuted = false`, `isHandRaised = false`, `currentRoomStore.setMuted(false)`, haptique warning + alerte `room.alert.audienceTitle` / `audienceBody` ("Moved to audience") ; le bouton micro **disparait** ; aucun badge mute/main residuel.
  - **Device A** : B disparait de la grille des orateurs et revient cote auditeurs ; A n'entend plus B (piste depubliee).
- **Critere d'acceptation (OK/KO)** : OK si le micro de B disparait et tous les etats locaux (mute/main) sont nettoyes ; KO si un badge mute ou main persiste, ou si B garde le bouton micro.
- **Instrumentation** : `room:role_changed{role:LISTENER}` cote B ; LiveKit depublication piste audio B ; nettoyage `currentRoomStore`.
- **Donnees de test** : roomId `room-rt-1`, host A, speaker B.
- **Duree estimee** : 6 min

### RT-006 - Reactions emoji propagees sans echo propre

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : A et B dans la meme room (n'importe quel role), 2 appareils, room live.
- **Etapes** :
  1. **[A]** Tape la reaction 🎉 (`Send reaction 🎉`).
  2. **[A]** et **[B]** observent leurs ecrans.
  3. **[B]** Martele 🔥 > 4 taps/s pendant 5 s.
- **Resultat attendu** :
  - **Device A** : voit son propre 🎉 flotter **une seule fois** (spawn local) ; ne voit **pas** de doublon (echo `room:reaction` filtre via `user_id === viewerId`). Lors de la rafale de B, A voit au plus `MAX_FLOATS` (24) emojis simultanes.
  - **Device B** : voit le 🎉 de A flotter (handler `room:reaction`, filtre `roomId`) ; pour sa propre rafale 🔥, les taps < `TAP_THROTTLE_MS` (250 ms) sont ignores (pas de spam du POST), floats plafonnes a 24.
- **Critere d'acceptation (OK/KO)** : OK si A ne voit pas de doublon, B voit la reaction de A, throttle 250 ms et cap 24 respectes ; KO si echo double cote emetteur, reaction manquante cote recepteur, ou floats illimites.
- **Instrumentation** : emission/reception `room:reaction{roomId, emoji, userId}` ; filtre echo propre cote A ; throttle POST cote B.
- **Donnees de test** : roomId `room-rt-1`, A=`viewer-a`, B=`viewer-b`, emojis 🎉 / 🔥.
- **Duree estimee** : 6 min

### RT-007 - Un participant quitte la room (impact compteur)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : A = host, B = auditeur, 2 appareils, room live, `participantCount` visible.
- **Etapes** :
  1. **[A]** Note le `participantCount` courant.
  2. **[B]** Tape "Quitter" (`room.leaveQuietly`).
  3. **[A]** Observe la liste des participants et le compteur (apres invalidation/refetch `useRoomSocket`).
- **Resultat attendu** :
  - **Device B** : `leaveRoom.mutateAsync` -> `navigation.goBack()` ; l'audio LiveKit se libere ; B sort de l'ecran room.
  - **Device A** : B disparait de la liste des auditeurs ; `participantCount` decremente de 1 (apres event socket / invalidation, pas en push instantane garanti -> tolerance de quelques secondes).
- **Critere d'acceptation (OK/KO)** : OK si B sort proprement et le compteur de A se decremente sans rester bloque sur l'ancienne valeur ; KO si B reste affiche chez A indefiniment ou si le compteur ne bouge pas.
- **Instrumentation** : LiveKit deconnexion piste B ; invalidation liste participants cote A.
- **Donnees de test** : roomId `room-rt-1`, host A, auditeur B.
- **Duree estimee** : 5 min

### RT-008 - Room fermee par le createur (host + 2 auditeurs)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : A = host (`viewerIsHost`), B = auditeur standard, C = auditeur guest, **3 appareils**, room live.
- **Etapes** :
  1. **[A]** Tape "End Room" (`room.closeRoom`) puis confirme l'action destructive.
  2. **[B]** et **[C]** observent leurs ecrans.
- **Resultat attendu** :
  - **Device A (host)** : `endRoom.mutate(roomId)` puis `navigation.goBack()` via `onSettled` ; **pas** d'alerte "Room ended" (filtre `viewerIsHostRef`) et pas de double goBack.
  - **Device B et Device C** : recoivent `room:ended` -> `navigation.goBack()` + `Alert` `room.alert.endedTitle` / `endedBody` ("Room ended") ; le canal audio LiveKit est ferme cote backend (plus de flux). Les deux sortent de l'ecran.
- **Critere d'acceptation (OK/KO)** : OK si A sort sans alerte/sans double-pop, B et C sortent **chacun** avec l'alerte "Room ended" ; KO si un auditeur reste en room, si le host voit l'alerte, ou si double goBack.
- **Instrumentation** : `room:ended` cote B et C ; fermeture canal LiveKit backend ; absence d'event chez A (filtre host).
- **Donnees de test** : roomId `room-rt-1`, host A, auditeurs B (standard) et C (guest).
- **Duree estimee** : 7 min

### RT-009 - Force-end room par un admin (effet sur participants)

- **Type** : Temps-reel multi-utilisateur (admin)
- **Priorite** : P0
- **Pre-conditions** : A = **admin** (sur l'ecran Rooms admin, hors de la room), B et C = participants dans la room live, 3 appareils.
- **Etapes** :
  1. **[A]** Depuis l'ecran admin Rooms, tape **Force-end** sur la room (`POST /admin/rooms/:id/force-end`).
  2. **[B]** et **[C]** observent leurs ecrans.
  3. **[A]** Observe la liste admin des rooms live.
- **Resultat attendu** :
  - **Device A (admin)** : succes -> invalidation `['admin','rooms']` + `['admin','stats']` -> refetch ; la room disparait de la liste live ; le badge `rooms.live` decremente (poll 30 s ou refetch immediat).
  - **Device B et Device C** : tous les participants sont notifies et le canal audio LiveKit de la room est ferme (effet backend observe sur les appareils participants) -> sortie de la room / fin du flux audio.
- **Critere d'acceptation (OK/KO)** : OK si la room se ferme cote backend, B et C perdent l'audio/sortent, et la liste admin se rafraichit ; KO si B/C restent connectes a l'audio ou si la liste admin garde la room.
- **Instrumentation** : `POST /admin/rooms/:id/force-end` 200 ; fermeture canal LiveKit ; invalidation `adminKeys` rooms+stats.
- **Donnees de test** : roomId `room-rt-2`, admin A.
- **Duree estimee** : 7 min

### RT-010 - Expulsion (kick) + RoomBan 30 min

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : A = host, B = participant cible, 2 appareils.
- **Etapes** :
  1. **[A]** Ouvre `HostActionsSheet` sur B et declenche **Kick**.
  2. **[B]** observe son ecran.
  3. **[B]** Tente de re-rejoindre la room immediatement (deep-link `room/<roomId>` ou via le feed).
- **Resultat attendu** :
  - **Device B** : recoit `room:user_kicked` (filtre self) **ou** le fallback personnel `room:you_were_kicked` -> `navigation.goBack()` + `Alert` `room.alert.removedTitle` / `removedBody` ("expelled... cannot rejoin for 30 minutes") ; le re-join immediat est **refuse** (RoomBan 30 min cote serveur).
  - **Device A** : B disparait de la liste des participants ; compteur decremente.
- **Critere d'acceptation (OK/KO)** : OK si B est sorti avec l'alerte 30 min et le re-join est bloque ; KO si B reste, si l'alerte manque, ou si B peut re-entrer immediatement.
- **Instrumentation** : `room:user_kicked` ou `room:you_were_kicked` cote B ; refus serveur (4xx RoomBan) au re-join.
- **Donnees de test** : roomId `room-rt-1`, host A, cible B.
- **Duree estimee** : 7 min

### RT-011 - Audio "is speaking" en temps reel sur plusieurs orateurs

- **Type** : Temps-reel multi-utilisateur (audio)
- **Priorite** : P1
- **Pre-conditions** : A, B et C **speakers** dans la meme room, 3 appareils, audio `live`, micros actifs.
- **Etapes** :
  1. **[A]** Parle pendant 3 s.
  2. **[B]** Parle pendant 3 s (A se tait).
  3. **[A]** et **[B]** parlent **en meme temps**.
  4. **[C]** Observe la scene tout du long.
- **Resultat attendu** :
  - **Device C (et tous)** : la cellule de l'orateur actif affiche le speaking-ring vert + badge `graphic-eq` quand son score depasse `SPEAKING_SCORE_THRESHOLD` ; le ring s'eteint quand il se tait. En parole simultanee A+B, **les deux** cellules s'illuminent.
- **Critere d'acceptation (OK/KO)** : OK si l'indicateur "is speaking" suit qui parle en quasi temps reel sur tous les appareils ; KO si le ring reste colle, ne s'allume jamais, ou se trompe d'orateur.
- **Instrumentation** : scores LiveKit "is speaking" par participant ; mapping cellule scene correct.
- **Donnees de test** : roomId `room-rt-1`, speakers A/B/C.
- **Duree estimee** : 6 min

### RT-012 - Expo Go (audio non supporte) vs dev-client

- **Type** : Compatibilite / degradation
- **Priorite** : P1
- **Pre-conditions** : A sur **build EAS dev-client**, B sur **Expo Go**, meme room live.
- **Etapes** :
  1. **[A]** et **[B]** entrent dans la room.
  2. **[A]** parle.
  3. **[B]** observe sa banniere de statut audio et tente de parler.
- **Resultat attendu** :
  - **Device A (dev-client)** : audio `live`, entend B si B publiait (mais B ne peut pas) ; UI room pleinement fonctionnelle.
  - **Device B (Expo Go)** : statut `unsupported`, banniere d'avertissement (`accessibilityRole="alert"`) ; B **n'entend pas** l'audio et ne peut pas publier, mais le reste de l'ecran (file de mains, reactions UI, navigation, quitter) reste utilisable sans crash.
- **Critere d'acceptation (OK/KO)** : OK si B degrade proprement (banniere unsupported, pas de crash) et A fonctionne normalement ; KO si B crashe ou si l'absence de module natif fait planter l'ecran.
- **Instrumentation** : statut `useRoomAudio = unsupported` cote B ; banniere alert ; pas d'exception native.
- **Donnees de test** : roomId `room-rt-1`.
- **Duree estimee** : 5 min

---

# B) Messagerie temps-reel (1:1 et groupe)

> Reference ecrans : `26-MSG-CHAT.md`, `27-MSG-GCHAT.md`, `29-MSG-LIST.md`. Hooks : `useChatSocket` (`chat:message`, `chat:read`), `useGroupSocket` (`group:message`), `useTypingIndicator` (`chat:typing`).

### RT-013 - Reception d'un message 1:1 (conversation ouverte des deux cotes)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : A et B ont la conversation 1:1 **ouverte** (ChatDetail) chacun sur son appareil, socket connecte des deux cotes.
- **Etapes** :
  1. **[A]** Saisit "Bonjour B" et tape "Envoyer" (`chat.sendA11y`).
  2. **[B]** Observe le fil de conversation.
  3. **[B]** Repond "Salut A".
- **Resultat attendu** :
  - **Device A** : injection optimiste immediate de "Bonjour B" dans le cache `messageKeys.messages(id)` ; a la reponse de B, "Salut A" apparait sans pull-to-refresh.
  - **Device B** : recoit le message via socket -> "Bonjour B" apparait en bas du fil (FlatList inversee) sans action ; marquage lu auto si la conv etait ouverte (`useMarkConversationRead`).
- **Critere d'acceptation (OK/KO)** : OK si chaque message apparait chez le destinataire en quasi temps reel sans refresh ; KO si un message n'arrive qu'apres pull-to-refresh ou pas du tout.
- **Instrumentation** : `chat:message` recu cote B (et A pour la reponse) ; invalidation `messageKeys.conversations()` + `messages(peerId)`.
- **Donnees de test** : conv A<->B, `peerId` = id de B cote A.
- **Duree estimee** : 5 min

### RT-014 - Envoi simultane (collision des deux cotes)

- **Type** : Temps-reel multi-utilisateur (race)
- **Priorite** : P1
- **Pre-conditions** : A et B, conversation ouverte des deux cotes.
- **Etapes** :
  1. **[A]** et **[B]** tapent "Envoyer" **au meme instant** (chacun un message different).
  2. Les deux observent l'ordre final.
- **Resultat attendu** :
  - **Device A et Device B** : les **deux** messages finissent presents dans le fil des deux cotes ; aucun n'est perdu ni dupplique. L'ordre final est coherent (timestamp serveur faisant autorite) ; un message optimiste local se reconcilie a sa position serveur sans doublon.
- **Critere d'acceptation (OK/KO)** : OK si les 2 messages sont presents, sans doublon, dans le meme ordre sur les 2 appareils ; KO si un message manque, est duplique, ou si l'ordre diverge entre A et B.
- **Instrumentation** : deux `chat:message` ; reconciliation cache optimiste -> serveur (pas de doublon par id).
- **Donnees de test** : conv A<->B.
- **Duree estimee** : 6 min

### RT-015 - Accuse de lecture (read receipt)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : A a envoye un message non lu a B ; B a la conversation **fermee** au depart.
- **Etapes** :
  1. **[A]** Envoie un message a B (conv fermee chez B).
  2. **[B]** Ouvre la conversation (declenche `useMarkConversationRead` -> `chat:read`).
  3. **[A]** Observe l'etat de son message / le badge non-lu cote liste.
- **Resultat attendu** :
  - **Device B** : a l'ouverture (si `unreadCount > 0`), `useMarkConversationRead` POST une seule fois (`markedRef`) -> invalide `conversations`, `unread` (badge onglet) et `conversation(id)` ; le badge non-lu de B retombe a 0.
  - **Device A** : recoit `chat:read` via `useChatSocket` -> la liste se reordonne / l'etat lu se reflete ; pas besoin de pull-to-refresh.
- **Critere d'acceptation (OK/KO)** : OK si le badge non-lu de B retombe et A recoit l'accuse de lecture live ; KO si le marquage lu ne part pas, part en double, ou n'arrive pas chez A.
- **Instrumentation** : `chat:read` recu cote A ; POST mark-read **unique** cote B (`markedRef`).
- **Donnees de test** : conv A<->B, 1 message non lu.
- **Duree estimee** : 5 min

### RT-016 - Indicateur de frappe (typing) avec throttle et TTL

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : A et B, conversation 1:1 ouverte des deux cotes.
- **Etapes** :
  1. **[A]** Tape plusieurs caracteres en continu pendant ~6 s.
  2. **[B]** Observe le sous-titre du header.
  3. **[A]** Arrete de taper et attend > 4 s.
- **Resultat attendu** :
  - **Device A** : emet `chat:typing { receiverId: B }` au plus une fois toutes les **2,5 s** (throttle `notifyTyping`), pas un event par frappe.
  - **Device B** : a la reception de `chat:typing { senderId: A }`, le sous-titre du header affiche `chat.typing` ("ecrit...") ; apres **4 s** sans nouvel event (TTL), revient a `@username`.
- **Critere d'acceptation (OK/KO)** : OK si "ecrit..." s'affiche chez B, le throttle 2,5 s limite les emissions, et le retour a `@username` se fait apres 4 s ; KO si l'indicateur ne s'affiche pas, reste colle, ou si A spamme un event par frappe.
- **Instrumentation** : frequence `chat:typing` emis (>= 2,5 s) cote A ; affichage `chat.typing` + expiration TTL 4 s cote B.
- **Donnees de test** : conv A<->B.
- **Duree estimee** : 6 min

### RT-017 - Message recu hors-focus -> push OS + badge

- **Type** : Temps-reel multi-utilisateur (push)
- **Priorite** : P0
- **Pre-conditions** : A et B ; **l'app de B est en arriere-plan ou tuee** ; B a enregistre son token push (`POST /push/register`) ; preferences notifications de B autorisant les messages.
- **Etapes** :
  1. **[B]** Met l'app en arriere-plan (ou la tue).
  2. **[A]** Envoie un message a B.
  3. **[B]** Observe la notification systeme, puis rouvre l'app et tape la notif.
- **Resultat attendu** :
  - **Device B (background/tue)** : recoit une **notification push OS** ; au retour au premier plan, le badge non-lu de l'onglet Messages reflete le nouveau message ; taper la notif ouvre la conversation 1:1 avec A. Si l'app etait seulement en arriere-plan (socket pas tue), `chat:message` peut aussi mettre a jour la liste a la reprise.
  - **Device A** : aucun changement particulier (message envoye normalement).
- **Critere d'acceptation (OK/KO)** : OK si B recoit la push hors-focus, le badge se met a jour et la conv s'ouvre au tap ; KO si pas de push, badge non mis a jour, ou mauvaise conversation ouverte. (No-op silencieux attendu en simulateur / Expo Go / web.)
- **Instrumentation** : push OS recue cote B ; badge `messageKeys.unread()` ; deep-link conv au tap.
- **Donnees de test** : conv A<->B, token push B enregistre.
- **Duree estimee** : 7 min

### RT-018 - Message de groupe live (3 membres)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : A, B, C membres d'un meme groupe ; B et C ont l'app ouverte (un sur GroupChat, un sur la liste Messages).
- **Etapes** :
  1. **[A]** Envoie un message texte dans le groupe (`POST /groups/:id/messages`).
  2. **[B]** (sur GroupChat) et **[C]** (sur la liste Messages) observent.
- **Resultat attendu** :
  - **Device A** : `setQueryData` ajoute le message en fin de liste + invalidation list ; le message apparait localement.
  - **Device B (GroupChat ouvert)** : recoit `group:message` via `useGroupSocket` -> le fil du groupe se met a jour (apparition du message au focus/invalidation `groupKeys.messages(conversationId)`).
  - **Device C (liste Messages)** : `useGroupSocket` invalide `groupKeys.list()` -> la section Groupes du header se reordonne et le badge non-lu du groupe s'incremente.
- **Critere d'acceptation (OK/KO)** : OK si le message apparait chez B et que la liste/badge de C se met a jour live ; KO si B ne voit le message qu'apres refresh manuel ou si le badge de C ne bouge pas.
- **Instrumentation** : `group:message` cote B et C ; invalidation `groupKeys.list()` + `messages(id)`.
- **Donnees de test** : groupe `grp-rt-1`, membres A/B/C.
- **Duree estimee** : 7 min

### RT-019 - Ajout d'un membre au groupe propage aux membres existants

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : A et B membres d'un groupe (A sur l'ecran "Ajouter des membres", B sur GroupChat/GroupInfo ouvert), C = utilisateur a ajouter.
- **Etapes** :
  1. **[A]** Recherche C (`GET /search`, debounce 250 ms) et l'ajoute (`POST /groups/:id/members`).
  2. **[B]** Observe GroupChat / GroupInfo.
  3. **[C]** Observe sa liste Messages.
- **Resultat attendu** :
  - **Device A** : succes -> `useAddGroupMembers` invalide `groups.detail(id)` + `groups.list()` -> GroupInfo et liste rafraichis ; ajout idempotent (un C deja membre ne cree pas de doublon).
  - **Device B** : recoit la mise a jour d'appartenance via le socket de conversation de groupe (`useGroupSocket`) -> C apparait dans la liste des membres.
  - **Device C** : le groupe remonte/apparait dans sa liste de conversations (apres invalidation/refresh ou message suivant).
- **Critere d'acceptation (OK/KO)** : OK si C est ajoute sans doublon, B voit l'ajout, et C voit le groupe ; KO si doublon cree, B ne voit pas l'ajout, ou C n'a pas acces au groupe.
- **Instrumentation** : `POST /groups/:id/members` 200 ; dedup backend ; event `group:*` appartenance cote B ; invalidation `groupKeys`.
- **Donnees de test** : groupe `grp-rt-1`, ajout de C.
- **Duree estimee** : 7 min

---

# C) Notifications : race conditions, ordre, dedup

> Reference ecran : `31-NOTIF.md`. Hook : `useNotificationSocket` (canal `user:<id>`, events `notification:new` et `notification:count`). Aussi `14-EXT-FEED.md` (fil d'activite live).

### RT-020 - Deux notifications quasi simultanees (ordre + compteur)

- **Type** : Temps-reel multi-utilisateur (race)
- **Priorite** : P0
- **Pre-conditions** : B sur l'ecran Notifications (onglet "Tout"), badge non-lus visible ; deux declencheurs prets (A invite B dans une room, C envoie un wave/ping a B).
- **Etapes** :
  1. **[A]** Invite B dans une room (`room_invite`).
  2. **[C]** Envoie un wave/ping a B **dans la meme seconde**.
  3. **[B]** Observe la liste et le compteur d'en-tete / badge tab-bar.
- **Resultat attendu** :
  - **Device B** : les **deux** notifications apparaissent (chaque `notification:new` invalide toutes les requetes `['notifications']` -> FlatList re-render) ; le compteur non-lus = total faisant autorite ecrit par `notification:count` (pas une somme locale qui pourrait sur/sous-compter). Ordre = ordre serveur (plus recente en haut).
  - **Device A et Device C** : aucun effet notif (ils sont emetteurs).
- **Critere d'acceptation (OK/KO)** : OK si les 2 notifs sont visibles, le compteur reflete le total serveur exact, sans race qui en perd une ; KO si une notif manque, si le compteur diverge (double-comptage ou sous-comptage), ou si l'ordre est incoherent.
- **Instrumentation** : 2x `notification:new` + `notification:count` (valeur autorite) cote B ; invalidation `['notifications']` complete.
- **Donnees de test** : B = cible, sources A (room_invite) et C (wave).
- **Duree estimee** : 7 min

### RT-021 - Compteur faisant autorite vs invalidation (dedup)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : B sur Notifications avec plusieurs non-lus ; A va declencher une notif puis B va marquer-tout-lu.
- **Etapes** :
  1. **[A]** Declenche une notif vers B (le compteur de B s'incremente).
  2. **[B]** Tape "Tout marquer comme lu" (`notifications.markAllRead`).
  3. **[A]** Declenche une **deuxieme** notif immediatement apres.
- **Resultat attendu** :
  - **Device B** : apres mark-all-read, `notification:count` ecrit `0` (autorite) -> badge a 0 ; la 2e notif de A fait remonter le compteur a 1 via un nouveau `notification:count` (pas un increment local desynchronise). Aucune notif comptee deux fois.
- **Critere d'acceptation (OK/KO)** : OK si le compteur suit strictement la valeur autorite serveur (0 puis 1) sans double comptage ni residu ; KO si le badge reste bloque, double-compte, ou ne retombe pas a 0 apres mark-all.
- **Instrumentation** : `notification:count` apres mark-all-read (=0) puis apres nouvelle notif (=1) ; `PATCH /notifications/read-all`.
- **Donnees de test** : B = cible.
- **Duree estimee** : 6 min

### RT-022 - Fil d'activite : live-prepend et dedup au fetch

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : B sur l'ecran Fil d'activite (extensions), abonne via `useExtSocketAliases` ; onglet "Tout" actif. A va declencher un `room_started_by_following`, un `join_request` (club), et un `ping_user` (wave).
- **Etapes** :
  1. **[A]** (suivi par B) demarre une room -> event `room_started_by_following`.
  2. **[A]** Envoie une demande/invitation club -> `join_request`.
  3. **[A]** Envoie un wave a B -> `ping_user`.
  4. **[B]** Observe le fil, puis fait un pull-to-refresh.
- **Resultat attendu** :
  - **Device B (onglet Tout)** : live-prepend de `ROOM_STARTED`, `CLUB_INVITE` (onglet all/clubs) et `WAVE` (onglet all/social) en tete de liste ; les entrees live (id prefixe `live-`) ne sont **pas** persistees ni marquees lues serveur. Au pull-to-refresh, dedup par `targetType:targetId` (pas de doublon entre l'entree live et l'entree serveur). Liste plafonnee a `MAX_ITEMS = 200`.
- **Critere d'acceptation (OK/KO)** : OK si chaque event apparait en tete sur le bon onglet et qu'apres refresh il n'y a pas de doublon ; KO si un event n'apparait pas, apparait sur le mauvais onglet, ou se duplique apres fetch.
- **Instrumentation** : events `room_started_by_following` / `join_request` / `ping_user` ; dedup par `targetType:targetId` ; cap 200.
- **Donnees de test** : B suit A ; events des 3 types.
- **Duree estimee** : 8 min

### RT-023 - Tap notif room_invite -> entree directe en room

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : A = host d'une room live, B recoit une notif `room_invite` (foreground ou push).
- **Etapes** :
  1. **[A]** Invite B (`POST /rooms/{roomId}/invite { userIds:[B] }`).
  2. **[B]** Recoit la notif et la tape.
- **Resultat attendu** :
  - **Device B** : `navigate('Room', { roomId })` -> entree dans la room audio LiveKit (chemin temps-reel coeur) ; B apparait cote host. Si la notif arrive en push hors-focus, le tap deep-link ouvre directement la room.
  - **Device A** : `{ invitedCount }` reflechi dans l'Alert succes ; B apparait dans les participants apres connexion.
- **Critere d'acceptation (OK/KO)** : OK si le tap mene B directement dans la bonne room et l'audio se connecte ; KO si mauvaise room, pas de navigation, ou audio non connecte.
- **Instrumentation** : `POST /rooms/{id}/invite` -> push/notif ; deep-link `Room` ; connexion LiveKit cote B.
- **Donnees de test** : roomId `room-rt-1`, invite B.
- **Duree estimee** : 6 min

### RT-024 - Hallway feed : apparition/disparition de room live

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : B sur le Fil des rooms (hallway), `useHallwaySocket()` abonne (status `authenticated`) ; A va creer puis fermer une room (visible pour B selon le follow-graph Social).
- **Etapes** :
  1. **[A]** Cree une room instantanee.
  2. **[B]** Observe le feed.
  3. **[A]** Ferme la room.
  4. **[B]** Observe a nouveau le feed.
- **Resultat attendu** :
  - **Device B** : `hallway:room_created` -> `roomKeys.list()` invalidee -> la nouvelle room apparait dans le feed score sans pull manuel (avec `keepPreviousData`, pas de flash skeleton) ; `hallway:room_closed` -> la room disparait du feed.
- **Critere d'acceptation (OK/KO)** : OK si la room apparait puis disparait dans le feed de B en temps reel, dans le respect du gating Social ; KO si le feed ne reagit pas aux events ou affiche une room fermee.
- **Instrumentation** : `hallway:room_created` / `hallway:room_closed` cote B ; invalidation `roomKeys.list()`.
- **Donnees de test** : A cree/ferme `room-rt-3` ; B suit A (visibilite Social).
- **Duree estimee** : 6 min

---

# D) Synchronisation apres reconnexion

> Couvre : perte WebSocket pendant qu'on parle, file d'actions en attente, idempotence a la reprise, divergence de compteur participants, restauration LiveKit. Reference : `useRoomAudio` (`reconnecting`), `currentRoomStore`, mutations optimistes a rollback.

### RT-025 - Perte WebSocket pendant qu'on parle (speaker)

- **Type** : Reconnexion (audio)
- **Priorite** : P0
- **Pre-conditions** : A = host (reste connecte), B = speaker en train de parler, 2 appareils, audio `live`.
- **Etapes** :
  1. **[B]** Parle (micro actif).
  2. **[B]** Coupe le reseau ~15 s (mode avion).
  3. **[B]** Retablit le reseau.
  4. **[A]** Observe la cellule de B tout du long.
- **Resultat attendu** :
  - **Device B** : audio passe `live` -> `reconnecting` (banniere `room.audioReconnecting`, live-region polite) -> `live` apres retour reseau ; l'etat mute (s'il etait mute) est restaure depuis `currentRoomStore` (pas de hot-unmute) ; le socket se reconnecte et re-souscrit aux events room.
  - **Device A** : pendant la coupure, B peut etre marque indisponible/silencieux ; apres reconnexion, B reapparait comme orateur actif et son audio redevient audible.
- **Critere d'acceptation (OK/KO)** : OK si B revient en `live` avec l'etat mute correct et A reentend B ; KO si B reste bloque en `reconnecting`/`error`, ou se hot-unmute, ou n'est jamais re-audible chez A.
- **Instrumentation** : transitions LiveKit `live`->`reconnecting`->`live` ; banniere ; re-souscription socket ; etat `currentRoomStore.muted` preserve.
- **Donnees de test** : roomId `room-rt-1`, speaker B.
- **Duree estimee** : 8 min

### RT-026 - File d'actions optimistes en attente + idempotence a la reprise

- **Type** : Reconnexion / idempotence
- **Priorite** : P0
- **Pre-conditions** : A = host, B = auditeur ; le reseau de B sera coupe pendant ses actions optimistes (main levee, mute).
- **Etapes** :
  1. **[B]** Coupe le reseau.
  2. **[B]** Tape "Lever la main", puis "Mute"/"Unmute" plusieurs fois (flips optimistes), pendant que le reseau est coupe.
  3. **[B]** Retablit le reseau.
  4. **[A]** Observe la file de mains et l'etat de B apres la reprise.
- **Resultat attendu** :
  - **Device B** : chaque tap applique un flip optimiste local ; les mutations REST qui echouent (`onError`) **rollback** (`raiseHand`/`lowerHand` revient a `!next` ; mute rollback a 3 niveaux : `setIsMuted`, `currentRoomStore.setMuted`, `audio.setMuted`) ; a la reprise, l'etat final se **reconcilie sur la verite serveur** (`serverHandRaised` resnap) sans rester desynchronise. Pas de double-emission qui creerait deux mains.
  - **Device A** : ne voit pas de fantome de main/mute incoherent ; l'etat final de B reflete la derniere verite serveur (idempotent : taps repetes ne creent pas d'entrees multiples).
- **Critere d'acceptation (OK/KO)** : OK si l'etat de B converge vers la verite serveur apres reprise, sans doublon ni blocage ; KO si la main reste levee alors que le serveur a refuse, si mute/store/UI divergent, ou si des actions dupliquees subsistent.
- **Instrumentation** : rollback `onError` des mutations ; resnap `serverHandRaised` ; absence de double event a la reprise.
- **Donnees de test** : roomId `room-rt-1`, auditeur B.
- **Duree estimee** : 9 min

### RT-027 - Divergence puis reconvergence du compteur participants

- **Type** : Reconnexion / coherence compteur
- **Priorite** : P1
- **Pre-conditions** : A = host (reseau stable), B et C participants ; le reseau de A sera coupe pendant que B quitte et C rejoint.
- **Etapes** :
  1. **[A]** Note `participantCount` (= 3 : A, B, C).
  2. **[A]** Coupe son reseau.
  3. **[B]** Quitte la room ; **[C]** ... reste (et un nouvel acteur D rejoint si dispo).
  4. **[A]** Retablit le reseau et observe le compteur + la liste.
- **Resultat attendu** :
  - **Device A** : pendant la coupure, le compteur peut diverger (gele sur l'ancienne valeur) ; apres reconnexion, le socket re-souscrit et `useRoomSocket` invalide/refetch la liste participants -> le compteur **reconverge** vers la verite serveur (B absent, D present le cas echeant). Pas de compteur fige sur une valeur perimee.
- **Critere d'acceptation (OK/KO)** : OK si le compteur de A se resynchronise sur l'etat reel apres reconnexion ; KO s'il reste bloque sur l'ancienne valeur ou affiche des participants partis.
- **Instrumentation** : re-souscription socket A ; invalidation liste participants ; valeur `participantCount` finale = etat serveur.
- **Donnees de test** : roomId `room-rt-1`, host A, B quitte.
- **Duree estimee** : 8 min

### RT-028 - Reconnexion socket chat : messages rates rattrapes

- **Type** : Reconnexion (messagerie)
- **Priorite** : P1
- **Pre-conditions** : A et B en conversation 1:1 ; B coupe le reseau, A envoie des messages, B revient.
- **Etapes** :
  1. **[B]** Coupe le reseau (app reste ouverte sur ChatDetail).
  2. **[A]** Envoie 3 messages.
  3. **[B]** Retablit le reseau.
- **Resultat attendu** :
  - **Device B** : pendant la coupure, les `chat:message` ne remontent pas (socket deconnecte) ; a la reconnexion, le refetch React Query (focus/invalidation) **rattrape** les 3 messages -> ils apparaissent dans le fil ; aucun doublon. Le badge non-lu reflete les messages rates.
  - **Device A** : messages envoyes normalement (injection optimiste), pas d'effet de la coupure de B.
- **Critere d'acceptation (OK/KO)** : OK si B rattrape exactement les 3 messages a la reprise sans doublon ni perte ; KO si messages perdus, dupliques, ou jamais remontes.
- **Instrumentation** : reconnexion socket B ; refetch `messageKeys.messages(peerId)` ; dedup par id message.
- **Donnees de test** : conv A<->B, 3 messages.
- **Duree estimee** : 7 min

### RT-029 - Token refresh / blip reseau ne deconnecte pas la session

- **Type** : Reconnexion / auth
- **Priorite** : P1
- **Pre-conditions** : A en room ou en conversation ; un blip reseau survient pendant un refresh de token.
- **Etapes** :
  1. **[A]** Reste actif dans une room/conversation.
  2. Provoquer un blip reseau au moment ou le token doit etre rafraichi.
  3. **[A]** Observe s'il est deconnecte ou non.
- **Resultat attendu** :
  - **Device A** : un echec de refresh de token **sur un simple blip reseau** ne declenche **pas** de sign-out (cf. commit `fix(auth): don't sign out when token refresh fails on a network blip`) ; A reste authentifie, le socket et l'audio se reconnectent une fois le reseau retabli ; un vrai 401 (token invalide) seul deconnecte.
- **Critere d'acceptation (OK/KO)** : OK si A reste connecte sur un blip et que tout se reconnecte ; KO si A est ejecte vers l'auth sur une simple coupure transitoire.
- **Instrumentation** : refresh token echoue (blip) sans sign-out ; reconnexion socket/LiveKit ; pas de navigation vers l'ecran d'auth.
- **Donnees de test** : compte A, blip reseau controle.
- **Duree estimee** : 7 min

---

# E) Coherence multi-appareils (meme compte sur 2 devices)

> Acteur A connecte simultanement sur **Device A1** et **Device A2** (meme compte `qa-a@chathouse.test`). Verifie que les actions sur un device se refletent sur l'autre.

### RT-030 - Compteur de notifications synchronise entre 2 devices du meme compte

- **Type** : Coherence multi-appareils
- **Priorite** : P0
- **Pre-conditions** : A connecte sur A1 et A2 (les deux sur Notifications ou app au premier plan), B prêt a declencher une notif vers A.
- **Etapes** :
  1. **[B]** Declenche une notif vers A (ex. follow, room_invite).
  2. **[A1]** Tape "Tout marquer comme lu".
  3. Observer A1 **et** A2.
- **Resultat attendu** :
  - **Device A1 et Device A2** : a l'arrivee de la notif, les deux recoivent `notification:new` + `notification:count` sur le canal `user:<A>` -> badge incremente des deux cotes. Apres mark-all-read sur A1, `notification:count` propage `0` -> le badge de **A2 retombe aussi a 0** en live (compteur faisant autorite propage a toutes les sessions du meme user).
- **Critere d'acceptation (OK/KO)** : OK si le compteur est identique sur A1 et A2 a chaque etape (apparition et mise a 0) ; KO si A2 reste avec un badge non-lu apres que A1 a tout marque lu.
- **Instrumentation** : `notification:count` recu sur A1 **et** A2 ; valeur autorite identique.
- **Donnees de test** : compte A sur 2 devices, source B.
- **Duree estimee** : 7 min

### RT-031 - Edition de profil sur un device refletee sur l'autre

- **Type** : Coherence multi-appareils
- **Priorite** : P1
- **Pre-conditions** : A sur A1 (ecran Edition du profil) et A2 (ProfileScreen / Settings).
- **Etapes** :
  1. **[A1]** Modifie le `displayName` et la bio, enregistre (`PATCH /users/me`).
  2. **[A2]** Revient sur ProfileScreen (focus/refetch) ou pull-to-refresh.
- **Resultat attendu** :
  - **Device A1** : `onSuccess` ecrit le `User` dans le cache `profileKeys.me()` -> Profile/Settings locaux a jour.
  - **Device A2** : **pas de push serveur** ; le nouveau profil n'apparait qu'apres un **re-fetch** (refocus / remontage / pull-to-refresh) de A2 -> displayName et bio mis a jour.
- **Critere d'acceptation (OK/KO)** : OK si A2 reflete les changements apres re-fetch (coherence eventuelle assumee, pas instantanee) ; KO si A2 ne se met jamais a jour meme apres refetch.
- **Instrumentation** : `PATCH /users/me` cote A1 ; re-fetch `profileKeys.me()` cote A2 ; pas d'event socket attendu.
- **Donnees de test** : compte A sur 2 devices.
- **Duree estimee** : 6 min

### RT-032 - Reglages (notifications / extensions) non synchronises en live cross-device

- **Type** : Coherence multi-appareils (coherence eventuelle)
- **Priorite** : P1
- **Pre-conditions** : A sur A1 et A2, tous deux sur Reglages notifications (ou Reglages extensions).
- **Etapes** :
  1. **[A1]** Bascule une preference (`PATCH /users/me/notification-preferences` ou `PATCH /ext/privacy`).
  2. **[A2]** Observe sans rien faire, puis re-ouvre l'ecran (refetch).
- **Resultat attendu** :
  - **Device A1** : update optimiste immediat, reconcilie au serveur `onSuccess` (rollback si echec).
  - **Device A2** : **aucun** changement live (pas de synchro temps-reel multi-appareil documentee) ; le toggle ne reflete la nouvelle valeur qu'apres un **nouveau GET** (re-ouverture de l'ecran / refetch).
- **Critere d'acceptation (OK/KO)** : OK si A2 montre l'ancienne valeur jusqu'au refetch puis la nouvelle (comportement attendu : coherence eventuelle) ; KO si A2 affiche une valeur incoherente apres refetch ou si A1 ne persiste pas.
- **Instrumentation** : `PATCH` preferences cote A1 ; absence de propagation socket ; refetch GET cote A2.
- **Donnees de test** : compte A sur 2 devices.
- **Duree estimee** : 6 min

### RT-033 - Sign-out sur un device : l'autre invalide a la prochaine requete protegee

- **Type** : Coherence multi-appareils
- **Priorite** : P1
- **Pre-conditions** : A sur A1 et A2, tous deux authentifies et actifs.
- **Etapes** :
  1. **[A1]** Se deconnecte (Sign-out depuis Reglages).
  2. **[A2]** Reste sur place, puis declenche une action reseau protegee (refetch, envoi de message, etc.).
- **Resultat attendu** :
  - **Device A1** : session fermee, connexions temps-reel (socket + LiveKit) liberees, retour a l'ecran d'auth.
  - **Device A2** : **pas** de deconnexion poussee en temps reel ; A2 reste affiche jusqu'a sa **prochaine requete protegee**, qui renverra 401 -> alors seulement A2 est deconnecte (ou degrade selon la politique 401). Un simple blip ne deconnecte pas (cf. RT-029).
- **Critere d'acceptation (OK/KO)** : OK si A2 n'est pas ejecte instantanement mais bien a la prochaine requete protegee (401) ; KO si A2 est deconnecte en push immediat (non implemente) ou s'il continue indefiniment avec un token revoque accepte.
- **Instrumentation** : sign-out store cote A1 ; pas d'event de logout pousse vers A2 ; 401 a la prochaine requete A2.
- **Donnees de test** : compte A sur 2 devices.
- **Duree estimee** : 6 min

### RT-034 - Meme compte dans la meme room sur 2 devices (cas limite)

- **Type** : Coherence multi-appareils (cas limite audio)
- **Priorite** : P2
- **Pre-conditions** : A connecte sur A1 et A2 ; A entre dans la **meme** room live sur les deux devices.
- **Etapes** :
  1. **[A1]** Entre dans `room-rt-1`.
  2. **[A2]** Entre dans la meme `room-rt-1`.
  3. Observer l'identite/presence et l'audio sur les deux.
- **Resultat attendu** :
  - **Device A1 et A2** : comportement deterministe et sans crash (selon la politique serveur : soit une seule session room active par user, soit deux connexions LiveKit distinctes). Aucun echo/larsen audio incontrolable ; pas de double-comptage anormal du meme user dans `participantCount` cote autres participants ; les events room (`room:role_changed`, etc.) sont coherents sur les deux sessions.
- **Critere d'acceptation (OK/KO)** : OK si le cas est gere proprement (politique appliquee de maniere coherente, pas de crash, pas de larsen) ; KO si crash, double-comptage durable, ou etats audio incoherents entre A1/A2.
- **Instrumentation** : connexions LiveKit A1 et A2 ; `participantCount` cote tiers ; coherence events room sur les 2 sessions.
- **Donnees de test** : compte A sur 2 devices, roomId `room-rt-1`.
- **Duree estimee** : 7 min

### RT-035 - Maps : presence et deplacement entre 2 utilisateurs

- **Type** : Temps-reel multi-utilisateur (presence)
- **Priorite** : P2
- **Pre-conditions** : A et B sur l'ecran Carte, `REALTIME_ENABLED=true`, A et B se suivent (visibilite map), Ghost Mode OFF, `isVisible` ON, permission localisation accordee.
- **Etapes** :
  1. **[A]** et **[B]** ouvrent la Carte (auto-join `maps:presence`, snapshot `GET /maps/users`).
  2. **[A]** Se deplace (coords changent > 25 m / 30 s) -> emet `maps:update-location`.
  3. **[B]** Observe le pin de A.
  4. **[A]** Active Ghost Mode (ou bascule `isVisible` off via `maps:toggle-visibility`).
- **Resultat attendu** :
  - **Device B** : recoit `maps:user-moved { userId:A, lat, lng }` -> le pin de A est relocalise (presence online, `lastSeen=0`) ; quand A passe en Ghost/invisible, B recoit `maps:user-offline { userId:A }` -> le pin de A est retire du roster.
  - **Device A** : en Ghost Mode, A **n'emet plus** `maps:update-location` ; le toggle See/Unsee `PATCH /users/me/visibility` est persiste.
- **Critere d'acceptation (OK/KO)** : OK si B voit A bouger puis disparaitre selon la visibilite, et A cesse d'emettre en Ghost ; KO si le pin ne bouge pas, ne disparait pas en Ghost, ou si A continue d'emettre sa position invisible.
- **Instrumentation** : `maps:update-location` (cap 30 s/25 m) cote A ; `maps:user-moved` / `maps:user-offline` cote B ; `maps:toggle-visibility` + `PATCH /users/me/visibility`.
- **Donnees de test** : A et B se suivent, REALTIME_ENABLED=true.
- **Duree estimee** : 8 min

---

## Matrice de couverture (synthese)

| Domaine                       | Scenarios       | Events / instrumentation cles                                                                                                                                                       |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a) Room audio live            | RT-001 a RT-012 | `room:role_changed`, `room:mute-changed`, `room:user_kicked`/`you_were_kicked`, `room:ended`, `room:reaction`, file mains (`useRoomSocket`), LiveKit `live`/scores, force-end admin |
| b) Messagerie                 | RT-013 a RT-019 | `chat:message`, `chat:read`, `chat:typing` (throttle 2,5 s / TTL 4 s), `group:message`, push OS hors-focus + badge, ajout membre groupe                                             |
| c) Notifications (race/dedup) | RT-020 a RT-024 | `notification:new`, `notification:count` (autorite), live-prepend fil + dedup `targetType:targetId`, deep-link room*invite, `hallway:room*\*`                                       |
| d) Reconnexion / idempotence  | RT-025 a RT-029 | LiveKit `reconnecting`->`live`, mute restaure via `currentRoomStore`, rollback optimiste, resnap `serverHandRaised`, reconvergence `participantCount`, refresh token sans sign-out  |
| e) Coherence multi-appareils  | RT-030 a RT-035 | `notification:count` cross-session, re-fetch profil/reglages (coherence eventuelle), sign-out -> 401 differe, double session room, presence Maps                                    |

> **Total** : 35 scenarios multi-utilisateurs / multi-appareils (RT-001 a RT-035). Chacun specifie pre-conditions (>= 2 comptes/appareils), etapes par acteur, resultat attendu **par appareil**, critere OK/KO et instrumentation a observer (event WebSocket, log LiveKit, push OS).
