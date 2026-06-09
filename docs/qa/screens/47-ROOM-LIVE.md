# 47 - Room audio en direct (`rooms`)

## Contexte ecran

- **Route** : `Room` (stack `RoomStackParamList`), parametre `roomId` (deep-link `room/:roomId`, partage public `https://app.chathouse.com/room/:roomId`). Fichier : `src/features/rooms/screens/RoomScreen/RoomScreen.tsx`.
- **Roles requis** : tout utilisateur authentifie peut entrer (guest peut etre auditeur). Les controles different selon le role derive **dans la room** :
  - `listener` (auditeur) : pas de bouton micro ; barre = Lever la main / Inviter / Quitter ; tap sur un participant ouvre la fiche profil sociale.
  - `speaker` / `moderator` / `host` (publishers) : bouton micro present.
  - `moderator` / `host` (`viewerCanModerate`) : icone "Room controls" (tune), edition du titre, tap participant = feuille de moderation.
  - `host` uniquement (`viewerIsHost` = `room.hostId === viewerId`) : bouton "Fermer" la room ; pas d'icone "Signaler".
- **Comportements temps-reel** (WebSocket `getSocket()` + LiveKit + hook `useRoomSocket`) :
  - Reception : `room:mute-changed` (force-mute par le host), `room:user_kicked` + `room:you_were_kicked` (expulsion + RoomBan 30 min), `room:role_changed` (promotion SPEAKER/MODERATOR/HOST ou retrogradation LISTENER), `room:ended` (room fermee par le host), `room:reaction` (reactions des autres).
  - Emission : `setMute` (REST + LiveKit local), `raiseHand`/`lowerHand`, `sendReaction`, `leaveRoom`, `endRoom`, `reportRoom`.
  - Audio LiveKit (`useRoomAudio`) : statuts `idle` / `connecting` / `live` / `reconnecting` / `error` / `unsupported` (Expo Go = `unsupported`, banniere avertissement). Scores "is speaking" temps-reel (`SPEAKING_SCORE_THRESHOLD`), ring vert + badge `graphic-eq` sur la cellule orateur.
- **Pre-conditions globales** : compte authentifie + token valide, room existante et non terminee, permission micro (pour publier l'audio), build EAS dev-client pour l'audio reel (Expo Go = banniere "unsupported", reste fonctionnel). Reseau requis pour le temps-reel.
- **Etats de donnees pertinents** :
  - Chargement : `Loader` plein ecran (`accessibilityLabel` = cle `common.loading`, EN "Loading…").
  - Erreur / room absente : `EmptyState` titre `room.unavailable` ("Room indisponible"), description `room.mayHaveEnded` ("Cette room a peut-etre pris fin.").
  - Liste "Autres" vide : la section et son label `room.others` ne s'affichent pas. Au-dela de `OTHERS_DISPLAY_CAP` (50) auditeurs, une pastille "+N" en footer.
  - File de mains levees vide : section `HandRaiseQueue` masquee (la main de l'utilisateur est exclue de la file).
  - Hors-ligne / latence : banniere audio `connecting` / `reconnecting` / `error` ; les mutations optimistes (mute, main) se rollback en cas d'echec REST.

## Matrice bouton

| #   | Bouton                      | Emplacement                 | Type                        | Locator reel                                                                                                                                         | Pre-condition                                          | Priorite |
| --- | --------------------------- | --------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| 1   | Partager le lien de la room | Header (haut droite)        | icon                        | `accessibilityLabel` = `t('room.shareA11y','Share room link')`                                                                                       | Room chargee                                           | P1       |
| 2   | Ouvrir le chat              | Header                      | icon                        | `accessibilityLabel` = `t('room.openChatA11y','Open chat')`                                                                                          | Room chargee                                           | P1       |
| 3   | Controles de la room (tune) | Header                      | menu                        | `accessibilityLabel` = `t('room.controlsA11y','Room controls')`                                                                                      | `viewerCanModerate` (host/mod)                         | P1       |
| 4   | Signaler la room (flag)     | Header                      | destructive                 | `accessibilityLabel` = `t('room.reportA11y','Report room')`                                                                                          | `!viewerIsHost`                                        | P1       |
| 5   | Fermer la room (End Room)   | Header                      | destructive                 | `accessibilityLabel` = `t('room.closeRoom','End Room')` (EN "End Room" / FR "Fermer")                                                                | `viewerIsHost`                                         | P0       |
| 6   | Editer le titre             | Corps (titre de la room)    | input-submit (ouvre modale) | `accessibilityLabel` = `t('room.editTitleA11y','Edit title: {{title}}')`                                                                             | `viewerCanModerate` (sinon role=header, non pressable) | P1       |
| 7   | Cellule orateur (scene)     | Corps (StageGrid)           | list-item                   | `accessibilityLabel` = `Actions pour ${displayName}` (si moderate) sinon `${displayName}`                                                            | Speaker present, pas soi-meme                          | P1       |
| 8   | Cellule main levee          | Corps (HandRaiseQueue)      | realtime-action             | `accessibilityLabel` = `t('room.promoteA11y','Invite {{name}} to speak')` (mod) sinon `t('room.profileA11y','Profile of {{name}}')`                  | File non vide                                          | P0       |
| 9   | Cellule "Suivi par toi"     | Corps (FollowedByListeners) | list-item                   | `accessibilityLabel` = `Profil de ${displayName ?? username}`                                                                                        | Auditeur suivi present, pas soi-meme                   | P2       |
| 10  | Cellule "Autres" (grille)   | Corps (FlatList Others)     | list-item                   | `accessibilityLabel` = `t('room.profileA11y','Profile of {{name}}')`                                                                                 | Auditeur present, pas soi-meme                         | P2       |
| 11  | Micro (Mute / Unmute)       | Barre d'action (bas)        | toggle                      | `accessibilityLabel` = `t('room.muteA11y','Mute microphone')` / `t('room.unmuteA11y','Unmute microphone')` ; `accessibilityState.selected = isMuted` | `viewerCanSpeak` (publisher)                           | P0       |
| 12  | Lever / Baisser la main     | Barre d'action              | realtime-action             | `accessibilityLabel` = `t('room.raiseA11y','Raise hand')` / `t('room.lowerA11y','Lower hand')` ; `accessibilityState.selected = isHandRaised`        | Room chargee                                           | P0       |
| 13  | Inviter                     | Barre d'action              | navigation                  | `accessibilityLabel` = `t('room.invite','Invite')`                                                                                                   | Room chargee                                           | P1       |
| 14  | Quitter                     | Barre d'action              | navigation                  | `accessibilityLabel` = `t('room.leaveQuietly','Leave quietly')` (label visible = `room.leave`)                                                       | Room chargee                                           | P0       |
| 15  | Reaction emoji (x6)         | Barre de reactions (bas)    | realtime-action             | `accessibilityLabel` = `` `Send reaction ${emoji}` `` (emojis ❤️ 🔥 👏 😂 🌊 🎉)                                                                     | Room chargee                                           | P1       |

> Note : la banniere de statut audio porte `accessibilityRole="alert"` (live-region `assertive` en erreur, sinon `polite`) — non pressable, validee en accessibilite mais hors matrice bouton.

## Cas de test

### ROOM-LIVE-001 - Partager le lien de la room (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, room chargee, Wi-Fi
- **Etapes** :
  1. Entrer dans la room.
  2. Taper l'icone "Partager" (`room.shareA11y`) en haut a droite.
  3. Observer la feuille de partage native.
- **Resultat attendu** : la share-sheet OS s'ouvre avec le message `Rejoins-moi sur Chathouse : "<titre>" — https://app.chathouse.com/room/<roomId>` et `url` = `https://app.chathouse.com/room/<roomId>`.
- **Critere d'acceptation (OK/KO)** : OK si l'URL contient `/room/<roomId>` exact ; KO si `/r/<id>` ou URL absente.
- **Donnees de test** : roomId `room-1`, titre `Building in public`.
- **Duree estimee** : 3 min

### ROOM-LIVE-002 - Partage annule / multi-clic rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, room chargee
- **Etapes** :
  1. Taper l'icone "Partager" 5 fois tres vite.
  2. Fermer/annuler la feuille de partage sans choisir de cible.
- **Resultat attendu** : une seule feuille a la fois ; l'annulation est avalee silencieusement (catch no-op), aucune erreur ni toast, l'ecran reste sur la room.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash ni feuilles empilees ; KO si exception remontee a l'UI.
- **Donnees de test** : roomId `room-1`.
- **Duree estimee** : 3 min

### ROOM-LIVE-003 - Partage accessibilite (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver actif, police x2, contraste eleve
- **Etapes** :
  1. Balayer jusqu'a l'icone de partage.
  2. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce "Share room link / Partager le lien de la room", role bouton ; cible >= 44x44 (hitSlop 8 + 36px) ; icone visible en contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si label vocalise et action declenchable ; KO si annonce "bouton" sans nom.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ROOM-LIVE-004 - Ouvrir le chat (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, room chargee, `chatEnabled = true`
- **Etapes** :
  1. Taper l'icone "chat" du header (`room.openChatA11y`).
  2. Observer l'ouverture de `RoomChatSidebar`.
- **Resultat attendu** : le panneau de chat lateral s'ouvre (`chatOpen = true`), avec `chatEnabled` et `chatVisibility` transmis ; le bouton fermer le referme.
- **Critere d'acceptation (OK/KO)** : OK si sidebar visible ; KO si rien ne s'ouvre.
- **Donnees de test** : roomId `room-1`, `chatVisibility = 'ALL'`.
- **Duree estimee** : 3 min

### ROOM-LIVE-005 - Chat double-ouverture / chat desactive

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, room avec `chatEnabled = false`
- **Etapes** :
  1. Taper rapidement 3x l'icone chat.
  2. Verifier l'etat quand le chat est desactive cote room.
- **Resultat attendu** : une seule instance de sidebar (etat booleen) ; quand `chatEnabled = false`, la sidebar reflete l'etat desactive (pas de composeur d'envoi actif).
- **Critere d'acceptation (OK/KO)** : OK si pas de double overlay ni envoi possible chat off ; KO sinon.
- **Donnees de test** : roomId `room-1`, `chatEnabled = false`.
- **Duree estimee** : 4 min

### ROOM-LIVE-006 - Chat accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : VoiceOver/TalkBack, police agrandie
- **Etapes** :
  1. Naviguer au lecteur d'ecran jusqu'a l'icone chat.
  2. Double-taper, verifier le focus dans la sidebar.
- **Resultat attendu** : label "Open chat / Ouvrir le chat", role bouton ; a l'ouverture le focus passe dans le panneau.
- **Critere d'acceptation (OK/KO)** : OK si label vocalise et focus deplace ; KO si focus reste perdu derriere la sidebar.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ROOM-LIVE-007 - Controles de la room visibles host/mod (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte host OU moderator (`viewerCanModerate = true`)
- **Etapes** :
  1. Entrer dans une room dont on est host/mod.
  2. Verifier la presence de l'icone "tune" (`room.controlsA11y`).
  3. Taper l'icone.
- **Resultat attendu** : `RoomControlsSheet` s'ouvre (`controlsOpen = true`) avec edition titre + invite ; pour un auditeur l'icone est absente.
- **Critere d'acceptation (OK/KO)** : OK si feuille de controles ouverte pour host/mod et absente pour listener ; KO sinon.
- **Donnees de test** : roomId `room-1`, viewer host (`hostId = viewer-1`).
- **Duree estimee** : 4 min

### ROOM-LIVE-008 - Controles caches pour un auditeur

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte listener (role nul dans `speakers`)
- **Etapes** :
  1. Entrer en auditeur.
  2. Inspecter le header.
- **Resultat attendu** : l'icone "tune" n'est PAS rendue ; aucune interaction de moderation accessible.
- **Critere d'acceptation (OK/KO)** : OK si `room.controlsA11y` introuvable ; KO si visible/pressable.
- **Donnees de test** : viewer auditeur non present dans `speakers`.
- **Duree estimee** : 3 min

### ROOM-LIVE-009 - Controles accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : host, TalkBack/VoiceOver, contraste eleve
- **Etapes** :
  1. Naviguer jusqu'a l'icone "tune".
  2. Double-taper.
- **Resultat attendu** : label "Room controls / Controles de la room", role bouton, ouverture de la feuille avec focus annonce.
- **Critere d'acceptation (OK/KO)** : OK si label correct et feuille focalisable ; KO sinon.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ROOM-LIVE-010 - Signaler la room (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard NON host, Wi-Fi
- **Etapes** :
  1. Taper l'icone "flag" (`room.reportA11y`).
  2. Dans l'alerte, choisir "Spam".
- **Resultat attendu** : `Alert` avec titre `room.alert.reportTitle` et 4 actions (Annuler, Spam, Harcelement, Autre) ; choisir Spam declenche `reportRoom.mutate({ roomId, reason: 'spam' })`.
- **Critere d'acceptation (OK/KO)** : OK si la mutation part avec le bon `reason` ; KO sinon.
- **Donnees de test** : roomId `room-1`, reason `spam`.
- **Duree estimee** : 4 min

### ROOM-LIVE-011 - Signalement : multi-clic + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard non host, reseau coupe apres ouverture de l'alerte
- **Etapes** :
  1. Taper l'icone flag 4x rapidement.
  2. Choisir "Autre".
  3. Couper le reseau pendant l'appel REST.
- **Resultat attendu** : une seule alerte affichee (re-tap re-presente la meme) ; la mutation `reportRoom` echoue silencieusement sans crasher l'ecran ; pas de double signalement bloquant l'UI.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash et pas d'empilement d'alertes ; KO sinon.
- **Donnees de test** : reason `other`, reseau hors-ligne.
- **Duree estimee** : 5 min

### ROOM-LIVE-012 - Signaler : bouton absent pour le host

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte host (`viewerIsHost = true`), lecteur d'ecran actif
- **Etapes** :
  1. Entrer en tant que host.
  2. Parcourir le header au lecteur d'ecran.
- **Resultat attendu** : l'icone flag (`room.reportA11y`) n'existe pas pour le host ; a la place "End Room" est annonce. Pour un non-host, label "Report room / Signaler la room" vocalise.
- **Critere d'acceptation (OK/KO)** : OK si flag absent chez host et present (label correct) chez non-host ; KO sinon.
- **Donnees de test** : viewer host.
- **Duree estimee** : 4 min

### ROOM-LIVE-013 - Fermer la room (host, succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte host, Wi-Fi, room live
- **Etapes** :
  1. En tant que host, taper "End Room" (`room.closeRoom`).
  2. Dans l'alerte de confirmation, taper l'action destructive "End Room".
- **Resultat attendu** : `Alert` titre `room.alert.confirmEndTitle` + corps avec le titre interpole ; confirmer declenche `endRoom.mutate(roomId)` puis `navigation.goBack()` via `onSettled`. Les autres participants recoivent `room:ended` -> goBack + alerte "Room ended".
- **Critere d'acceptation (OK/KO)** : OK si la room se ferme et le host quitte l'ecran ; KO si reste en room ou double goBack.
- **Donnees de test** : roomId `room-1`, titre `Building in public`.
- **Duree estimee** : 4 min

### ROOM-LIVE-014 - Fermer la room : annulation + multi-clic + reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte host, reseau instable
- **Etapes** :
  1. Taper "End Room" 3x vite (alerte unique).
  2. Taper "Annuler".
  3. Reouvrir, confirmer, couper le reseau pendant l'appel.
- **Resultat attendu** : Annuler ferme l'alerte sans rien envoyer ; en cas d'echec reseau `onSettled` execute quand meme `navigation.goBack()` (l'ecran se ferme proprement) ; pas de double appel `endRoom`.
- **Critere d'acceptation (OK/KO)** : OK si une seule fermeture effective et navigation propre meme en erreur ; KO sinon.
- **Donnees de test** : roomId `room-1`, reseau hors-ligne.
- **Duree estimee** : 5 min

### ROOM-LIVE-015 - Fermer la room : synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 1 host + 2 auditeurs (un standard, un guest) dans la meme room, 3 devices
- **Etapes** :
  1. Host confirme "End Room".
  2. Observer les 2 auditeurs.
- **Resultat attendu** : les 2 auditeurs recoivent `room:ended`, sont sortis (`navigation.goBack()`) et voient l'alerte `room.alert.endedTitle`/`endedBody` ("Room ended"). Le host ne voit PAS cette alerte (filtre `viewerIsHostRef`) ni de double goBack.
- **Critere d'acceptation (OK/KO)** : OK si auditeurs sortis avec alerte et host sans double-pop ; KO sinon.
- **Donnees de test** : roomId `room-1`, host `viewer-1`.
- **Duree estimee** : 6 min

### ROOM-LIVE-016 - Fermer la room accessibilite

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : host, TalkBack/VoiceOver, police x2, contraste eleve
- **Etapes** :
  1. Naviguer jusqu'au bouton "End Room" (texte rouge danger).
  2. Double-taper, parcourir l'alerte.
- **Resultat attendu** : label "End Room / Fermer" vocalise ; le texte tient en police agrandie ; l'alerte de confirmation est lisible et l'action destructive annoncee comme telle ; contraste danger suffisant.
- **Critere d'acceptation (OK/KO)** : OK si label + alerte navigables au lecteur d'ecran ; KO si label muet ou texte tronque.
- **Donnees de test** : n/a
- **Duree estimee** : 5 min

### ROOM-LIVE-017 - Editer le titre (host/mod, succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte host/mod (`viewerCanModerate`), Wi-Fi
- **Etapes** :
  1. Taper le titre de la room (`room.editTitleA11y` interpolant le titre).
  2. Verifier l'ouverture de `TitleEditModal`.
- **Resultat attendu** : la modale d'edition s'ouvre (`titleEditOpen = true`) pre-remplie avec `room.title` ; un auditeur a un titre `accessibilityRole="header"` non pressable.
- **Critere d'acceptation (OK/KO)** : OK si modale ouverte pour mod/host et inerte pour listener ; KO sinon.
- **Donnees de test** : roomId `room-1`, titre `Building in public`.
- **Duree estimee** : 4 min

### ROOM-LIVE-018 - Titre non editable pour un auditeur

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte listener
- **Etapes** :
  1. Taper plusieurs fois le titre de la room.
- **Resultat attendu** : aucune modale (Pressable `disabled`, `onPress` undefined) ; le titre reste un en-tete passif.
- **Critere d'acceptation (OK/KO)** : OK si aucun effet au tap ; KO si modale s'ouvre.
- **Donnees de test** : viewer auditeur.
- **Duree estimee** : 2 min

### ROOM-LIVE-019 - Titre accessibilite (role variable)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver, comparer host/mod vs listener
- **Etapes** :
  1. Au lecteur d'ecran, focaliser le titre en tant que mod.
  2. Refaire en tant que listener.
- **Resultat attendu** : mod -> role bouton + label "Edit title: <titre>" ; listener -> role header + label = titre brut. Police agrandie : le titre wrap sans clipping.
- **Critere d'acceptation (OK/KO)** : OK si role et label corrects selon le role ; KO sinon.
- **Donnees de test** : titre `Building in public`.
- **Duree estimee** : 4 min

### ROOM-LIVE-020 - Tap cellule orateur = moderation (host/mod)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte host/mod, au moins 1 autre orateur en scene
- **Etapes** :
  1. Taper la cellule d'un orateur (label `Actions pour <displayName>`).
  2. Observer la feuille.
- **Resultat attendu** : `HostActionsSheet` s'ouvre cible sur l'orateur (kick / promote / etc.) ; le tap sur sa PROPRE cellule est ignore (`participant.id === viewerId`).
- **Critere d'acceptation (OK/KO)** : OK si feuille de moderation ouverte sur la bonne cible et self-tap ignore ; KO sinon.
- **Donnees de test** : orateur cible id `spk-2`.
- **Duree estimee** : 4 min

### ROOM-LIVE-021 - Tap cellule orateur = profil (auditeur) + self-tap

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte listener, orateurs en scene
- **Etapes** :
  1. En auditeur, taper une cellule orateur (label = `displayName`, pas de role bouton).
  2. Taper sa propre cellule si presente.
- **Resultat attendu** : auditeur -> `ProfileActionSheet` (follow/wave/ping) ; self-tap -> aucun effet ; le speaking-ring vert et le badge mic n'interferent pas avec le tap.
- **Critere d'acceptation (OK/KO)** : OK si feuille profil pour autrui, rien pour soi ; KO si feuille moderation ouverte cote listener.
- **Donnees de test** : orateur `spk-2`, viewer auditeur.
- **Duree estimee** : 3 min

### ROOM-LIVE-022 - Cellule orateur accessibilite + etat "parle"

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver, contraste eleve, un orateur actif (score > seuil)
- **Etapes** :
  1. Focaliser une cellule orateur.
  2. Verifier l'annonce selon le role viewer.
- **Resultat attendu** : mod -> "Actions pour <nom>" role bouton ; listener -> nom seul. Le badge "speaking" (graphic-eq vert) reste decoratif (`pointerEvents` non bloquant). En police x2 le nom (numberOfLines=1) tronque proprement sans casser la grille 5 colonnes.
- **Critere d'acceptation (OK/KO)** : OK si label correct et layout stable ; KO sinon.
- **Donnees de test** : orateur `spk-2`, audio `speaking`.
- **Duree estimee** : 4 min

### ROOM-LIVE-023 - Promouvoir une main levee (host/mod, succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte host/mod, au moins 1 main levee (autre que soi), Wi-Fi
- **Etapes** :
  1. Repere la section `room.handRaised` + compteur.
  2. Taper l'avatar d'un demandeur (label `room.promoteA11y` "Invite <nom> to speak").
  3. Dans `HostActionsSheet`, valider la promotion en SPEAKER.
- **Resultat attendu** : ouverture de la feuille de moderation ciblant l'utilisateur (synthese `RoomParticipant` listener/handRaised) ; le promu recoit `room:role_changed` (SPEAKER) cote son device.
- **Critere d'acceptation (OK/KO)** : OK si la feuille s'ouvre sur le bon utilisateur et la promotion part ; KO sinon.
- **Donnees de test** : demandeur id `hr-2`, nom `Sam`.
- **Duree estimee** : 5 min

### ROOM-LIVE-024 - File des mains : tap auditeur + file vide + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte listener (non mod), puis cas file vide
- **Etapes** :
  1. En auditeur, taper une main levee (label `room.profileA11y`).
  2. Verifier le comportement quand la file ne contient que soi-meme.
  3. Taper 3x vite le meme avatar.
- **Resultat attendu** : auditeur -> ouvre la fiche profil (pas de promotion) ; si seule la main du viewer est levee, la file est masquee (sa main est exclue, reflétée par le bouton barre d'action) ; multi-clic n'ouvre qu'une feuille.
- **Critere d'acceptation (OK/KO)** : OK si pas de promotion cote listener et file auto-masquee ; KO sinon.
- **Donnees de test** : viewer auditeur, file `[viewer-1]` seule.
- **Duree estimee** : 4 min

### ROOM-LIVE-025 - File des mains accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : host, TalkBack/VoiceOver, police agrandie
- **Etapes** :
  1. Focaliser un avatar de la file.
  2. Ecouter l'annonce selon le role.
- **Resultat attendu** : mod -> "Invite <nom> to speak / Inviter <nom> a parler" ; listener -> "Profile of <nom>". L'emoji main (👋) est decoratif (`pointerEvents="none"`). Le compteur `room.handRaised · N` se lit.
- **Critere d'acceptation (OK/KO)** : OK si label correct selon role ; KO sinon.
- **Donnees de test** : demandeur `Sam`.
- **Duree estimee** : 4 min

### ROOM-LIVE-026 - File des mains : synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 1 host + 1 auditeur leve la main, 2 devices, Wi-Fi
- **Etapes** :
  1. L'auditeur leve la main (cf. ROOM-LIVE-031).
  2. Cote host, observer l'apparition dans la file et le compteur.
  3. Host promeut l'auditeur.
- **Resultat attendu** : la file du host se met a jour en temps reel (queue invalidee par socket) ; apres promotion, l'auditeur sort de la file et obtient le micro ; le compteur decremente.
- **Critere d'acceptation (OK/KO)** : OK si file et compteur synchronises entre devices ; KO si la file ne reflete pas l'evenement socket.
- **Donnees de test** : host `viewer-1`, auditeur `hr-2`.
- **Duree estimee** : 6 min

### ROOM-LIVE-027 - Tap cellule "Suivi par toi" (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard suivant >= 1 auditeur present dans la room
- **Etapes** :
  1. Reperer la section `room.followedBy`.
  2. Taper un avatar (label `Profil de <displayName|username>`).
- **Resultat attendu** : `ProfileActionSheet` s'ouvre sur cet auditeur (follow/wave/ping/profil).
- **Critere d'acceptation (OK/KO)** : OK si feuille profil ouverte sur la bonne personne ; KO sinon.
- **Donnees de test** : auditeur suivi id `flw-2`, nom `Lea`.
- **Duree estimee** : 3 min

### ROOM-LIVE-028 - "Suivi par toi" : self-tap + section vide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : viewer ne suit personne dans la room ; puis viewer present dans la liste
- **Etapes** :
  1. Verifier l'affichage quand `followedByViewer` present mais aucun suivi.
  2. Si le viewer y figure, taper sa propre cellule.
- **Resultat attendu** : si flag present et aucun suivi -> section `room.followedBy` masquee (pas de fallback positionnel) ; self-tap ignore (`listener.id === viewerId`).
- **Critere d'acceptation (OK/KO)** : OK si section correctement masquee et self-tap inerte ; KO si premiers auditeurs affiches a tort comme suivis.
- **Donnees de test** : listeners avec `followedByViewer:false` partout.
- **Duree estimee** : 4 min

### ROOM-LIVE-029 - "Suivi par toi" accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver, police x2, contraste eleve
- **Etapes** :
  1. Focaliser un avatar de la section suivie.
- **Resultat attendu** : label "Profil de <nom>", role bouton ; max `FOLLOWED_COUNT` (5) avatars, l'overflow bascule en "Autres" (aucun perdu). Grille 5 colonnes stable en grande police.
- **Critere d'acceptation (OK/KO)** : OK si label vocalise et layout intact ; KO sinon.
- **Donnees de test** : 7 auditeurs suivis (5 visibles + 2 overflow vers Autres).
- **Duree estimee** : 4 min

### ROOM-LIVE-030 - Tap cellule "Autres" + overflow +N (succes/limite)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, > 50 auditeurs non suivis
- **Etapes** :
  1. Scroller la grille "Autres" (`room.others`).
  2. Taper un avatar (label `room.profileA11y` "Profile of <nom>").
  3. Verifier la pastille footer "+N".
- **Resultat attendu** : tap -> `ProfileActionSheet` ouverte ; au-dela de `OTHERS_DISPLAY_CAP` (50) cellules, footer "+N" = `max(0, total - 50)` ; self-tap ignore.
- **Critere d'acceptation (OK/KO)** : OK si feuille profil + "+N" correct ; KO si "+N" toujours 0 ou cellules > 50 montees.
- **Donnees de test** : 73 auditeurs -> 50 cellules + "+23".
- **Duree estimee** : 4 min

### ROOM-LIVE-031 - Lever la main (auditeur, succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte listener, Wi-Fi, room live
- **Etapes** :
  1. Dans la barre d'action, taper "Lever" (`room.raiseA11y`).
  2. Observer l'etat du bouton.
- **Resultat attendu** : `isHandRaised` flip optimiste a true (label devient "Lower hand", `accessibilityState.selected = true`, icone pan-tool) ; `raiseHand.mutate(roomId)` part ; le host voit la main apparaitre dans sa file.
- **Critere d'acceptation (OK/KO)** : OK si etat bascule et mutation emise ; KO sinon.
- **Donnees de test** : roomId `room-1`.
- **Duree estimee** : 3 min

### ROOM-LIVE-032 - Main levee : multi-clic rapide + echec REST (rollback)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte listener, reseau qui rejette l'appel
- **Etapes** :
  1. Taper "Lever" puis "Baisser" tres vite plusieurs fois.
  2. Forcer un echec de `raiseHand` (onError).
- **Resultat attendu** : l'etat suit chaque tap (optimiste) ; en cas d'`onError` l'etat revient a `!next` (rollback) ; pas de blocage du bouton ; aucune incoherence persistante avec la file serveur (`serverHandRaised` resnap l'etat).
- **Critere d'acceptation (OK/KO)** : OK si rollback applique et bouton recoherent ; KO si reste "leve" alors que le serveur a refuse.
- **Donnees de test** : roomId `room-1`, mutation en erreur.
- **Duree estimee** : 5 min

### ROOM-LIVE-033 - Main levee accessibilite

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : TalkBack/VoiceOver, police x2, contraste eleve
- **Etapes** :
  1. Focaliser le bouton main.
  2. Double-taper, re-ecouter.
- **Resultat attendu** : label alterne "Raise hand"/"Lower hand" (FR "Lever"/"Baisser"), `accessibilityState.selected` reflete l'etat ; bouton sur un slot flex egal, label numberOfLines=1 tient en grande police.
- **Critere d'acceptation (OK/KO)** : OK si etat selected vocalise et label correct ; KO sinon.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ROOM-LIVE-034 - Main levee : reconcil. multi-utilisateur (host baisse la main)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 1 auditeur main levee + 1 host, 2 devices
- **Etapes** :
  1. L'auditeur leve la main (bouton "Baisser" affiche).
  2. Le host promeut ou retire la main de l'auditeur.
  3. Observer le bouton cote auditeur.
- **Resultat attendu** : la file serveur change (socket-invalidee), `serverHandRaised` repasse a false et `setIsHandRaised(false)` resnap le bouton sur "Lever" ; en cas de promotion, `room:role_changed` revele le micro (`forceSpeaker`) + alerte "On stage".
- **Critere d'acceptation (OK/KO)** : OK si le bouton se synchronise sur la verite serveur ; KO s'il reste colle sur "Baisser".
- **Donnees de test** : auditeur `viewer-1`, host `host-1`.
- **Duree estimee** : 6 min

### ROOM-LIVE-035 - Mute / Unmute micro (speaker, succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte speaker/mod/host (`viewerCanSpeak`), permission micro accordee, audio LiveKit `live`
- **Etapes** :
  1. Verifier la presence du bouton micro (absent pour un listener).
  2. Taper "Mute" (`room.muteA11y`).
  3. Taper a nouveau pour "Unmute".
- **Resultat attendu** : flip optimiste instantane (icone mic/mic-off, label, `accessibilityState.selected`, badge mic-off sur sa cellule de scene via `speakersForStage`) ; `audio.setMuted(next)` (LiveKit local, fire-and-forget) + `setMute.mutateAsync` (REST) + `currentRoomStore.setMuted`.
- **Critere d'acceptation (OK/KO)** : OK si audio coupe/retabli et UI coherente ; KO si l'icone lag le serveur ou l'audio ne se coupe pas.
- **Donnees de test** : roomId `room-1`, viewer speaker.
- **Duree estimee** : 4 min

### ROOM-LIVE-036 - Mute : multi-clic + echec REST (rollback complet)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte speaker, reseau qui rejette `setMute`
- **Etapes** :
  1. Taper Mute/Unmute tres vite 5x.
  2. Forcer un rejet REST sur le dernier appel.
  3. Verifier l'etat micro et `currentRoomStore`.
- **Resultat attendu** : sur rejet, rollback du badge ET de la source de verite (`setIsMuted(!next)`, `currentRoomStore.setMuted(!next)`, `audio.setMuted(!next)`) pour rester coherent ; pas de desync entre LiveKit, store et UI.
- **Critere d'acceptation (OK/KO)** : OK si les 3 sources reviennent a l'etat pre-tap apres erreur ; KO si l'une diverge.
- **Donnees de test** : roomId `room-1`, mutation `setMute` en erreur.
- **Duree estimee** : 5 min

### ROOM-LIVE-037 - Mute accessibilite

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : speaker, TalkBack/VoiceOver, police x2, contraste eleve
- **Etapes** :
  1. Focaliser le bouton micro.
  2. Double-taper, re-ecouter l'etat.
- **Resultat attendu** : label "Mute microphone"/"Unmute microphone", `accessibilityState.selected = isMuted` ; couleur danger (mic-off) suffisamment contrastee ; label numberOfLines=1 lisible en grande police.
- **Critere d'acceptation (OK/KO)** : OK si selected + label vocalises ; KO sinon.
- **Donnees de test** : n/a
- **Duree estimee** : 4 min

### ROOM-LIVE-038 - Force-mute par le host (multi-utilisateur)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 1 host + 1 speaker, 2 devices, Wi-Fi
- **Etapes** :
  1. Le host force-mute le speaker (depuis HostActionsSheet).
  2. Observer le device du speaker.
- **Resultat attendu** : le speaker recoit `room:mute-changed` (filtre `userId === viewerId`) -> `setIsMuted(true)` + `currentRoomStore.setMuted(true)` ; au prochain reconnect/renew token, l'audio restaure le mute (ne se hot-unmute pas). Le badge mic-off apparait sur sa cellule.
- **Critere d'acceptation (OK/KO)** : OK si le speaker est mute en temps reel et l'etat survit au reconnect ; KO sinon.
- **Donnees de test** : host `host-1`, speaker `viewer-1`.
- **Duree estimee** : 6 min

### ROOM-LIVE-039 - Mute : reconnexion audio / etats banniere

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : speaker mute, perte reseau puis retour
- **Etapes** :
  1. Mute le micro.
  2. Couper le reseau (banniere `reconnecting`).
  3. Retablir le reseau.
- **Resultat attendu** : banniere `room.audioReconnecting` ("🔄 Reconnecting audio…") en live-region polite ; apres reconnexion, l'audio restaure le mute depuis `currentRoomStore` (pas de hot-unmute) ; banniere disparait quand `status` repasse `live`.
- **Critere d'acceptation (OK/KO)** : OK si mute conserve apres reconnexion ; KO si l'utilisateur est unmute silencieusement.
- **Donnees de test** : roomId `room-1`, transitions audio connecting/reconnecting/live.
- **Duree estimee** : 5 min

### ROOM-LIVE-040 - Inviter (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : tout participant, room chargee
- **Etapes** :
  1. Taper "Inviter" (`room.invite`) dans la barre d'action.
- **Resultat attendu** : `navigation.navigate('InviteToRoom', { roomId })` ; l'ecran d'invitation s'ouvre avec le bon roomId.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers InviteToRoom avec `roomId` exact ; KO sinon.
- **Donnees de test** : roomId `room-1`.
- **Duree estimee** : 2 min

### ROOM-LIVE-041 - Inviter : multi-clic rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : room chargee, navigation lente
- **Etapes** :
  1. Taper "Inviter" 4x tres vite.
- **Resultat attendu** : un seul ecran InviteToRoom empile (pas de quadruple push) ; retour ramene a la room intacte.
- **Critere d'acceptation (OK/KO)** : OK si une seule navigation effective ; KO si pile dupliquee.
- **Donnees de test** : roomId `room-1`.
- **Duree estimee** : 3 min

### ROOM-LIVE-042 - Inviter accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver, police x2
- **Etapes** :
  1. Focaliser le bouton Inviter.
  2. Double-taper.
- **Resultat attendu** : label "Invite / Inviter", role bouton ; navigation annoncee ; label tient en grande police.
- **Critere d'acceptation (OK/KO)** : OK si label vocalise et navigation declenchee ; KO sinon.
- **Donnees de test** : n/a
- **Duree estimee** : 3 min

### ROOM-LIVE-043 - Quitter la room (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : tout participant, Wi-Fi, room live
- **Etapes** :
  1. Taper "Quitter" (label a11y `room.leaveQuietly` "Leave quietly", texte visible `room.leave` "Quitter").
- **Resultat attendu** : `leaveRoom.mutateAsync(roomId)` puis `navigation.goBack()` ; l'utilisateur sort de la room et l'audio se libere.
- **Critere d'acceptation (OK/KO)** : OK si mutation leave + retour ecran ; KO si reste en room.
- **Donnees de test** : roomId `room-1`.
- **Duree estimee** : 2 min

### ROOM-LIVE-044 - Quitter : echec reseau + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : reseau coupe au moment du tap
- **Etapes** :
  1. Couper le reseau.
  2. Taper "Quitter" 3x vite.
- **Resultat attendu** : meme si `leaveRoom.mutateAsync` echoue (catch), `navigation.goBack()` est toujours appele (l'utilisateur sort quand meme) ; pas de blocage sur l'ecran ni de multiples pops incoherents.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran se ferme malgre l'echec reseau ; KO si l'utilisateur reste coince.
- **Donnees de test** : roomId `room-1`, reseau hors-ligne.
- **Duree estimee** : 4 min

### ROOM-LIVE-045 - Quitter accessibilite

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : TalkBack/VoiceOver, police x2, contraste eleve
- **Etapes** :
  1. Focaliser le bouton Quitter (icone logout rouge danger).
- **Resultat attendu** : le lecteur annonce l'intention complete "Leave quietly / Quitter discretement" (a11y label etendu) meme si le label visible est court "Quitter" ; contraste danger suffisant.
- **Critere d'acceptation (OK/KO)** : OK si l'intention complete est vocalisee ; KO si seul "Quitter" lu sans contexte.
- **Donnees de test** : n/a
- **Duree estimee** : 3 min

### ROOM-LIVE-046 - Envoyer une reaction emoji (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : tout participant, Wi-Fi, room live
- **Etapes** :
  1. Dans la barre de reactions, taper ❤️ (label `Send reaction ❤️`).
- **Resultat attendu** : haptique leger + emoji flottant anime localement (spawnFloat) + `sendReaction.mutate({ roomId, emoji })` ; les autres recoivent `room:reaction` et voient l'emoji flotter.
- **Critere d'acceptation (OK/KO)** : OK si emoji local affiche et mutation emise ; KO sinon.
- **Donnees de test** : roomId `room-1`, emoji `❤️`.
- **Duree estimee** : 3 min

### ROOM-LIVE-047 - Reactions : spam / throttle + cap de floats

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : participant, reseau normal
- **Etapes** :
  1. Marteler 🔥 le plus vite possible pendant 5 s.
  2. Observer le nombre d'emojis flottants et les appels reseau.
- **Resultat attendu** : taps plus rapprochees que `TAP_THROTTLE_MS` (250 ms) ignorees (pas de spam du POST) ; au plus `MAX_FLOATS` (24) emojis montes simultanement (les plus anciens purges) ; pas de fuite de timers a la sortie de la room.
- **Critere d'acceptation (OK/KO)** : OK si throttle 250 ms applique et floats plafonnes a 24 ; KO si POST spamme ou arbre Reanimated illimite.
- **Donnees de test** : emoji `🔥`, rafale > 4 taps/s.
- **Duree estimee** : 4 min

### ROOM-LIVE-048 - Reactions accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver, contraste eleve
- **Etapes** :
  1. Parcourir les 6 boutons emoji.
- **Resultat attendu** : chaque bouton annonce "Send reaction <emoji>" role bouton ; cibles 36px + hitSlop ; les emojis flottants sont decoratifs (`pointerEvents="none"`, non focalisables).
- **Critere d'acceptation (OK/KO)** : OK si 6 labels distincts vocalises et floats non focalisables ; KO sinon.
- **Donnees de test** : emojis ❤️ 🔥 👏 😂 🌊 🎉.
- **Duree estimee** : 4 min

### ROOM-LIVE-049 - Reactions : synchro multi-utilisateur + echo propre filtre

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 participants min, 2 devices, Wi-Fi
- **Etapes** :
  1. Utilisateur A tape 🎉.
  2. Observer A et B.
- **Resultat attendu** : B voit l'emoji 🎉 flotter (handler `room:reaction`, filtre `roomId`) ; A ne voit PAS de doublon (l'echo de sa propre reaction est filtre via `userId === viewerId`, deja spawn local).
- **Critere d'acceptation (OK/KO)** : OK si B voit la reaction et A pas de doublon ; KO si A voit l'emoji deux fois ou B ne le voit pas.
- **Donnees de test** : emoji `🎉`, A `viewer-1`, B `viewer-2`.
- **Duree estimee** : 5 min

### ROOM-LIVE-050 - Expulsion (kick) en cours de room (multi-utilisateur)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 1 host + 1 participant cible, 2 devices
- **Etapes** :
  1. Le host expulse le participant (HostActionsSheet).
  2. Observer le device de la cible.
- **Resultat attendu** : la cible recoit `room:user_kicked` (filtre self) OU le fallback personnel `room:you_were_kicked` -> `navigation.goBack()` puis `Alert` `room.alert.removedTitle`/`removedBody` ("expelled… cannot rejoin for 30 minutes"). Un re-join immediat est bloque par le RoomBan 30 min.
- **Critere d'acceptation (OK/KO)** : OK si la cible est sortie + alerte 30 min et re-join refuse ; KO si elle reste ou peut re-entrer aussitot.
- **Donnees de test** : host `host-1`, cible `viewer-1`.
- **Duree estimee** : 6 min

### ROOM-LIVE-051 - Promotion / retrogradation recue (multi-utilisateur)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 1 host + 1 auditeur, 2 devices
- **Etapes** :
  1. Le host promeut l'auditeur en SPEAKER puis le retrograde en LISTENER.
  2. Observer le device de l'auditeur a chaque etape.
- **Resultat attendu** : promotion -> `room:role_changed` (SPEAKER) revele le micro immediatement (`forceSpeaker = true`), haptique succes + alerte `room.alert.stageTitle`/`roleSpeaker`. Retrogradation -> `forceSpeaker=false`, `isMuted=false`, `isHandRaised=false`, `currentRoomStore.setMuted(false)`, haptique warning + alerte `room.alert.audienceTitle`/`audienceBody` ; le bouton micro disparait.
- **Critere d'acceptation (OK/KO)** : OK si le micro apparait/disparait et les etats locaux sont nettoyes selon le role ; KO si un badge mute/main perdure apres retrogradation.
- **Donnees de test** : auditeur `viewer-1`, roles `SPEAKER` puis `LISTENER`.
- **Duree estimee** : 6 min
