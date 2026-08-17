# 26 - Conversation (detail) (`messages`)

## Contexte ecran

- **Route** : `ChatDetail` dans le `MessagesNavigator` (stack). Deep-link : `chat/:conversationId` (voir `src/core/navigation/linking.ts`). Le `conversationId` EST l'identifiant utilisateur du pair (le `peerId` sert aussi de `receiverId` pour le relais de saisie). La barre d'onglets est masquee sur cette route (`HIDDEN_TAB_BAR_ROUTES` dans `MainNavigator.tsx`).
- **Roles requis** : `standard` et `admin` (utilisateur authentifie). `guest` ne dispose pas de messagerie privee. L'identite « moi » provient de `useAuthStore(s => s.user?.id)` avec repli sur `CURRENT_USER.id` (rendu non authentifie / tests uniquement).
- **Comportements temps-reel** :
  - **Indicateur de saisie sortant** : chaque frappe dans le champ appelle `notifyTyping()` qui emet `chat:typing { receiverId }` via socket.io (throttle 2,5 s) — voir `useTypingIndicator`.
  - **Indicateur de saisie entrant** : reception de `chat:typing { senderId }` -> le sous-titre du header affiche `chat.typing` (« ecrit… ») pendant un TTL de 4 s, puis revient a `@username`.
  - **Envoi de message texte** : `useSendMessage` -> `messageService.send` (POST), puis injection optimiste dans le cache `messageKeys.messages(id)` et invalidation de la liste de conversations.
  - **Envoi de message vocal** : `useVoiceMessage` -> enregistrement local -> `voiceService.upload` -> `useSendVoiceMessage` -> meme cache que texte.
  - **Marquage lu** : a l'ouverture, si `unreadCount > 0`, `useMarkConversationRead` est declenche une fois (POST), ce qui invalide `conversations`, `unread` (badge d'onglet) et `conversation(id)`.
  - **Presence du pair** : `usePeerPresence(peerId)` affiche le point online uniquement lorsque le serveur renvoie `visible=true` et `isOnline=true`.
  - **Appel prive** : le bouton Appeler cree une room `closed` a deux via REST, puis navigue vers la room LiveKit ; un verrou immediat et l'etat pending evitent les doubles creations.
- **Pre-conditions globales** : session valide (token), reseau pour POST/socket. La voix necessite la permission micro et un build natif ; sur iOS, cette permission est demandee puis revérifiée via le module WebRTC natif. Socket temps-reel via `getSocket()` (peut etre `null` -> degradation silencieuse, pas de typing).
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` des messages -> `Loader` plein ecran (`accessibilityLabel="Loading messages"`).
  - **Liste vide** : aucun message -> FlatList inversee vide, header + barre de saisie presents.
  - **Non lus** : `conversation.unreadCount > 0` -> marquage lu auto a l'ouverture.
  - **Hors-ligne** : POST en echec -> toast d'erreur via `useApiErrorToast` (texte conserve dans le champ pour reessai) ; socket non connecte -> typing degrade.
  - **Presence** : point vert conditionne par la reponse de presence et ses regles de confidentialite ; aucune presence n'est revelee si `visible=false`.
  - **Brouillon non vide** : la barre affiche le bouton **Envoyer** (gradient) ; brouillon vide -> bouton **Micro**.
  - **Enregistrement vocal actif** (`voice.isActive`) -> la barre de saisie est remplacee par `VoiceRecordingBar` (annuler / minuteur / envoyer).

## Matrice bouton

| #   | Bouton                          | Emplacement                                    | Type                            | Locator reel                                                                       | Pre-condition                                   | Priorite |
| --- | ------------------------------- | ---------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| 1   | Retour                          | Header (gauche)                                | navigation                      | `accessibilityLabel = t('chat.backA11y')` = « Retour »                             | Ecran ouvert                                    | P1       |
| 2   | Appeler                         | Header (droite)                                | realtime-action                 | `accessibilityLabel = t('chat.callA11y')` ; etat busy/disabled pendant la creation | Ecran ouvert                                    | P1       |
| 3   | Plus d'options                  | Header (droite)                                | menu                            | `accessibilityLabel = t('chat.moreA11y')`                                          | Ecran ouvert                                    | P1       |
| 4   | Signaler l'utilisateur          | Alert / sheet de motifs                        | destructive                     | action `t('profile.report')`, puis motifs spam/harassment/fake_profile/other       | Menu ouvert                                     | P1       |
| 5   | Bloquer l'utilisateur           | Alert de confirmation                          | destructive                     | action `t('profile.block')`, confirmation destructive                              | Menu ouvert                                     | P1       |
| 6   | Inserer un emoji                | Barre de saisie (gauche)                       | icon                            | `accessibilityLabel = t('chat.emojiA11y')`                                         | Ecran ouvert                                    | P2       |
| 7   | Champ de message                | Barre de saisie (centre)                       | input-submit                    | `placeholder = t('chat.inputPlaceholder')`                                         | Ecran ouvert                                    | P0       |
| 8   | Envoyer (texte)                 | Barre de saisie (bouton final)                 | submit / realtime-action        | `accessibilityLabel = t('chat.sendA11y')`                                          | Brouillon non vide (`canSend`)                  | P0       |
| 9   | Micro (demarrer enr.)           | Barre de saisie (bouton final, brouillon vide) | realtime-action                 | `accessibilityLabel = t('chat.micA11y')`                                           | Brouillon vide + permission micro               | P0       |
| 10  | Annuler l'enregistrement        | Barre d'enregistrement (gauche)                | destructive                     | `accessibilityLabel = t('voice.cancelA11y')`                                       | `voice.isActive` ; desactive si upload en cours | P1       |
| 11  | Envoyer le message vocal        | Barre d'enregistrement (droite)                | realtime-action                 | `accessibilityLabel = t('voice.sendA11y')`                                         | `voice.isActive` ; desactive si upload en cours | P0       |
| 12  | Lire / Pause (bulle vocale)     | Corps / bulle de message vocal                 | realtime-action (lecture audio) | `accessibilityLabel = t('voice.playA11y')` ou `t('voice.pauseA11y')`               | Message `kind='voice'` avec `audioUrl`          | P1       |
| 13  | Liste des messages (defilement) | Corps (FlatList inversee)                      | list-item (scroll)              | FlatList `inverted`                                                                | Au moins 1 message                              | P2       |

> Note : il n'y a aucun pull-to-refresh, swipe ni FAB. Le long-press d'une bulle ouvre les actions message (suppression de son message ou signalement d'un message recu). L'appel et les options utilisateur sont implementes de bout en bout. Le trombone n'est volontairement pas rendu : aucun pipeline de piece jointe n'est revendique.

## Cas de test

### MSG-CHAT-001 - Retour ferme la conversation

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` authentifie ; conversation ouverte depuis la liste Messages ; Wi-Fi ; aucune permission speciale.
- **Etapes** :
  1. Ouvrir une conversation existante depuis l'onglet Messages.
  2. Taper le bouton « Retour » (icone fleche, en haut a gauche).
- **Resultat attendu** : retour a l'ecran precedent (liste des conversations) via `navigation.goBack()` ; la barre d'onglets reapparait.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est affiche et l'ecran de detail demonte ; KO si rien ne se passe ou crash.
- **Donnees de test** : compte `standard@chathouse.test` / `Passw0rd!` ; conversation avec `Alex Rivers` (`peer-1`).
- **Duree estimee** : 1 min

### MSG-CHAT-002 - Retour : multi-clic rapide ne double pas la navigation

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte ; reseau indifferent.
- **Etapes** :
  1. Ouvrir la conversation.
  2. Taper tres rapidement 4-5 fois sur « Retour ».
  3. Observer la pile de navigation.
- **Resultat attendu** : un seul `goBack` effectif ; pas de pop multiple (sortie de la pile au-dela de la liste), pas de double rendu, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'app reste sur la liste des conversations (un seul niveau remonte) ; KO si l'app remonte plusieurs ecrans ou crash.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 2 min

### MSG-CHAT-003 - Retour accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack (Android) ou VoiceOver (iOS) actif ; police systeme « tres grande » ; contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande taille de police.
  2. Ouvrir la conversation.
  3. Balayer jusqu'au premier element focusable du header.
- **Resultat attendu** : le lecteur annonce « Retour, bouton » (`chat.backA11y`) ; cible tactile >= 44x44 (hitSlop 8) ; double-tap declenche le retour ; le titre du header reste lisible sans troncature bloquante en grande police.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce vocale = « Retour » et l'action s'execute via double-tap ; KO sinon.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 3 min

### MSG-CHAT-004 - Appeler cree une room privee a deux

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte ; Wi-Fi.
- **Etapes** :
  1. Ouvrir la conversation.
  2. Taper l'icone « Appeler » (combine, en haut a droite).
- **Resultat attendu** : un seul `POST /rooms` cree une room `closed`, `coHostIds=[peerId]`, `maxSpeakers=2`, chat et recording desactives ; l'app ouvre ensuite `Main > RoomsTab > Room` avec l'id cree.
- **Critere d'acceptation (OK/KO)** : OK si la room privee correcte s'ouvre ; KO si aucune creation, mauvais destinataire ou navigation incorrecte.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 1 min

### MSG-CHAT-005 - Appeler : taps repetes ne creent qu'une room

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte ; reseau indifferent.
- **Etapes** :
  1. Taper 3 fois rapidement sur « Appeler ».
  2. Observer l'etat du bouton pendant la requete puis la navigation.
- **Resultat attendu** : bouton busy/disabled, une seule mutation de creation et une seule navigation malgre les taps.
- **Critere d'acceptation (OK/KO)** : OK si une seule room existe ; KO si rooms ou navigations multiples.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 1 min

### MSG-CHAT-006 - Appeler accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; grande police.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au bouton « Appeler » du header.
- **Resultat attendu** : annonce « Appeler, bouton » ; pendant la creation, l'etat occupe/desactive est expose, puis la room s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si le libelle, l'etat busy et l'activation sont accessibles ; KO sinon.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 2 min

### MSG-CHAT-007 - Plus d'options expose les actions de surete

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte ; Wi-Fi.
- **Etapes** :
  1. Taper l'icone « Plus d'options » (trois points verticaux, en haut a droite).
- **Resultat attendu** : l'Alert affiche le pair et les actions `Signaler`, `Bloquer` (destructive) et `Annuler`.
- **Critere d'acceptation (OK/KO)** : OK si les trois choix sont presents et correctement localises ; KO sinon.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 1 min

### MSG-CHAT-008 - Signaler le pair avec un motif

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte.
- **Etapes** :
  1. Ouvrir « Plus d'options », choisir `Signaler`.
  2. Dans la sheet, choisir `Harcèlement`.
- **Resultat attendu** : la sheet expose quatre motifs ; un seul appel report est envoye avec `{reason:'harassment'}`, puis la sheet se ferme et le remerciement s'affiche.
- **Critere d'acceptation (OK/KO)** : OK si le bon pair et le bon motif sont transmis ; KO sinon.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 1 min

### MSG-CHAT-009 - Bloquer le pair apres confirmation

- **Type** : Fonctionnel destructif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte ; Wi-Fi.
- **Etapes** :
  1. Ouvrir « Plus d'options », choisir `Bloquer`, puis confirmer l'action destructive.
- **Resultat attendu** : un appel block cible le `peerId` ; apres succes, la conversation se ferme via `goBack`. Annuler ne declenche aucun appel.
- **Critere d'acceptation (OK/KO)** : OK si confirmation, API et sortie sont coherentes ; KO si blocage sans confirmation ou mauvais utilisateur.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 2 min

### MSG-CHAT-010 - Emoji ajoute un smiley au brouillon

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; conversation ouverte ; champ vide.
- **Etapes** :
  1. Taper l'icone « Inserer un emoji » (visage souriant, a gauche du champ).
  2. Observer le champ de saisie.
- **Resultat attendu** : le caractere 🙂 est ajoute au brouillon ; comme le brouillon devient non vide, le bouton final passe de Micro a Envoyer.
- **Critere d'acceptation (OK/KO)** : OK si la valeur du champ contient « 🙂 » et le bouton Envoyer est affiche ; KO sinon.
- **Donnees de test** : champ initial vide ; resultat attendu = « 🙂 ».
- **Duree estimee** : 1 min

### MSG-CHAT-011 - Emoji : insertion repetee et espacement

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; conversation ouverte ; champ contenant deja « Salut ».
- **Etapes** :
  1. Saisir « Salut » dans le champ.
  2. Taper rapidement 3 fois sur « Inserer un emoji ».
- **Resultat attendu** : un espace est insere avant le premier emoji (car le texte ne se termine pas par un espace), puis les emojis s'ajoutent ; resultat type « Salut 🙂🙂🙂 » ; pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si la chaine finale = « Salut 🙂🙂🙂 » ; KO si espacement incorrect ou perte de texte.
- **Donnees de test** : texte initial « Salut » ; 3 taps emoji.
- **Duree estimee** : 2 min

### MSG-CHAT-012 - Emoji accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; grande police.
- **Etapes** :
  1. Balayer jusqu'au bouton emoji.
- **Resultat attendu** : annonce « Inserer un emoji, bouton » (`chat.emojiA11y`) ; double-tap insere 🙂 et le lecteur annonce le nouveau contenu du champ.
- **Critere d'acceptation (OK/KO)** : OK si libelle vocal = « Inserer un emoji » et action effective ; KO sinon.
- **Donnees de test** : champ vide.
- **Duree estimee** : 2 min

### MSG-CHAT-013 - Saisie : declenche l'indicateur « ecrit… » chez le pair

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; conversation ouverte ; socket connecte (Wi-Fi) ; deuxieme device connecte en tant que `Alex Rivers` sur la meme conversation.
- **Etapes** :
  1. Sur le device A, focaliser le champ (placeholder « Ecrire un message… »).
  2. Saisir « bonj » caractere par caractere.
  3. Observer le header sur le device B (pair).
- **Resultat attendu** : un evenement `chat:typing { receiverId: peerId }` est emis (throttle 2,5 s) ; sur le device B le sous-titre du header passe de « @alex » a « ecrit… » (`chat.typing`) puis revient apres ~4 s d'inactivite.
- **Critere d'acceptation (OK/KO)** : OK si le pair voit « ecrit… » pendant la saisie et le retour a « @alex » apres TTL ; KO si l'indicateur n'apparait pas ou reste bloque.
- **Donnees de test** : texte « bonj » ; conversation `peer-1`.
- **Duree estimee** : 3 min

### MSG-CHAT-014 - Saisie : throttle des pings et perte de socket

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; conversation ouverte ; outil de capture socket (logs) ; possibilite de couper le Wi-Fi.
- **Etapes** :
  1. Saisir un texte long en continu pendant 6 s.
  2. Verifier le nombre d'emits `chat:typing` (doit etre throttle a ~1 / 2,5 s).
  3. Couper le reseau (mode avion) et continuer a taper.
  4. Reactiver le reseau.
- **Resultat attendu** : au plus ~1 emit toutes les 2,5 s pendant la frappe ; hors-ligne, `notifyTyping` ne plante pas (socket null/deconnecte ignore silencieusement) ; la saisie reste fluide ; pas d'emit en file qui spamme a la reconnexion.
- **Critere d'acceptation (OK/KO)** : OK si throttle respecte et aucune erreur a la coupure/reconnexion ; KO si flood d'emits ou crash.
- **Donnees de test** : texte de 200 caracteres saisi en continu.
- **Duree estimee** : 4 min

### MSG-CHAT-015 - Champ de saisie accessible (lecteur + grande police)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; police « tres grande » ; contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au champ de message.
  2. Activer la saisie et entrer un texte multi-ligne.
- **Resultat attendu** : le lecteur annonce le champ avec son placeholder « Ecrire un message… » ; le champ multiline grandit (maxHeight 100) sans masquer le bouton Envoyer ; texte lisible (couleur `colors.text` sur fond glass) meme en grande police.
- **Critere d'acceptation (OK/KO)** : OK si le champ est focusable, annonce le placeholder et reste lisible en grande police ; KO si troncature bloquante ou contraste insuffisant.
- **Donnees de test** : texte « Ligne 1\nLigne 2\nLigne 3 ».
- **Duree estimee** : 3 min

### MSG-CHAT-016 - La piece jointe n'est pas exposee sans pipeline

- **Type** : Verification de surface
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; conversation ouverte.
- **Etapes** :
  1. Parcourir la barre de saisie visuellement puis au lecteur d'ecran.
- **Resultat attendu** : aucun bouton trombone ni action `chat.attachA11y` n'est rendu ; emoji, champ et send/mic restent correctement alignes.
- **Critere d'acceptation (OK/KO)** : OK si aucune affordance morte n'est exposee ; KO si un bouton sans pipeline reapparait.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 1 min

### MSG-CHAT-017 - Echec de creation d'appel et retry

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation ouverte ; premier `POST /rooms` en echec, second en succes.
- **Etapes** :
  1. Taper Appeler et observer l'erreur.
  2. Retablir le backend puis retaper Appeler.
- **Resultat attendu** : l'erreur passe par le toast API, le verrou et l'etat disabled sont liberes ; le second essai cree et ouvre la room.
- **Critere d'acceptation (OK/KO)** : OK si retry possible sans remonter l'ecran ; KO si bouton bloque ou creation double.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 1 min

### MSG-CHAT-018 - Options et sheet de signalement accessibles

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; grande police.
- **Etapes** :
  1. Balayer jusqu'a « Plus d'options », ouvrir `Signaler`, parcourir le titre, les quatre motifs et Fermer.
- **Resultat attendu** : le bouton Plus est annonce ; la sheet est traitee comme vue modale, chaque motif est un bouton nomme, et le focus ne fuit pas vers la conversation.
- **Critere d'acceptation (OK/KO)** : OK si toutes les actions sont annoncees et activables ; KO si focus perdu ou libelle absent.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 2 min

### MSG-CHAT-019 - Envoyer un message texte

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; conversation ouverte ; Wi-Fi ; backend joignable.
- **Etapes** :
  1. Saisir « Hello! » dans le champ.
  2. Verifier que le bouton final est passe de Micro a Envoyer (gradient bleu).
  3. Taper « Envoyer le message ».
- **Resultat attendu** : appel `messageService.send(conversationId, 'Hello!')` ; a la reussite, le message s'ajoute en bas du fil (liste inversee, offset 0), le champ se vide, le fil defile vers le bas, la liste des conversations est invalidee. Charge utile : `{ conversationId: 'peer-1', text: 'Hello!' }`.
- **Critere d'acceptation (OK/KO)** : OK si la bulle « Hello! » (cote « mine ») apparait, le champ est vide et le bouton revient a Micro ; KO si message non envoye ou doublon.
- **Donnees de test** : `{ "conversationId": "peer-1", "text": "Hello!" }`.
- **Duree estimee** : 2 min

### MSG-CHAT-020 - Envoyer : double-tap rapide, espaces seuls, et echec reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; conversation ouverte ; possibilite de couper le reseau.
- **Etapes** :
  1. Saisir « Test » et taper « Envoyer » 4 fois tres rapidement.
  2. Vider le champ, saisir uniquement des espaces « » et tenter d'envoyer.
  3. Saisir « Hors-ligne », couper le Wi-Fi (mode avion), taper « Envoyer ».
  4. Reactiver le reseau.
- **Resultat attendu** :
  - Etape 1 : un seul envoi (garde `sendMessage.isPending` + champ vide apres succes) — pas de 4 doublons.
  - Etape 2 : aucun envoi (le draft `trim()` vide ne passe pas `canSend`, le bouton reste Micro) — pas de message blanc.
  - Etape 3 : l'envoi echoue, un toast d'erreur s'affiche (`useApiErrorToast`) et le texte « Hors-ligne » reste dans le champ pour reessai.
  - Etape 4 : reessai possible apres reconnexion, envoi reussi sans doublon.
- **Critere d'acceptation (OK/KO)** : OK si pas de doublon, pas de message vide, toast d'erreur hors-ligne avec texte conserve ; KO sinon.
- **Donnees de test** : « Test », « » (4 espaces), « Hors-ligne ».
- **Duree estimee** : 5 min

### MSG-CHAT-021 - Envoyer accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; grande police ; contraste eleve.
- **Etapes** :
  1. Saisir « Coucou » pour faire apparaitre le bouton Envoyer.
  2. Balayer jusqu'au bouton final.
- **Resultat attendu** : annonce « Envoyer le message, bouton » (`chat.sendA11y`) ; double-tap envoie ; le bouton gradient garde un contraste suffisant (icone blanche sur gradient bleu) ; taille >= 44x44.
- **Critere d'acceptation (OK/KO)** : OK si libelle vocal = « Envoyer le message » et envoi via double-tap ; KO sinon.
- **Donnees de test** : « Coucou ».
- **Duree estimee** : 3 min

### MSG-CHAT-022 - Envoyer : synchronisation multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes `standard` (A = moi, B = `Alex Rivers`) sur deux devices, meme conversation ouverte ; Wi-Fi ; backend + socket en service.
- **Etapes** :
  1. Sur le device A, saisir « Salut Alex » et taper Envoyer.
  2. Observer le device B (conversation deja ouverte).
  3. Sur le device B, repondre « Salut ! ».
  4. Observer le device A et le badge d'onglet Messages des deux cotes.
- **Resultat attendu** : le message de A apparait cote B (bulle recue) ; la reponse de B apparait cote A ; les compteurs non-lus / badge d'onglet se mettent a jour ; pas de duplication. Note : si la livraison push/socket n'est pas instantanee, le message apparait au plus tard au rafraichissement de la requete messages.
- **Critere d'acceptation (OK/KO)** : OK si chaque message arrive cote pair sans doublon et le badge se synchronise ; KO si message perdu, doublonne, ou ordre incoherent.
- **Donnees de test** : A->B « Salut Alex », B->A « Salut ! ».
- **Duree estimee** : 5 min

### MSG-CHAT-023 - Demarrer un enregistrement vocal (bouton Micro)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : build EAS dev-client (module `expo-audio`) ; compte `standard` ; champ vide (bouton Micro affiche) ; permission micro accordee.
- **Etapes** :
  1. Verifier que le champ est vide et que le bouton final est le Micro.
  2. Taper « Enregistrer un message vocal ».
- **Resultat attendu** : l'enregistrement demarre (`voice.startRecording`) ; `voice.isActive` devient vrai ; la barre de saisie est remplacee par `VoiceRecordingBar` (icone corbeille, point rouge + minuteur + libelle « Enregistrement… », bouton Envoyer).
- **Critere d'acceptation (OK/KO)** : OK si la barre d'enregistrement remplace la barre de saisie et le minuteur progresse ; KO si rien ne se passe.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 2 min

### MSG-CHAT-024 - Micro : permission refusee et taps repetes

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; champ vide ; permission micro **refusee** au niveau OS.
- **Etapes** :
  1. Taper « Enregistrer un message vocal ».
  2. Si l'alerte se ferme, retaper rapidement 3 fois.
- **Resultat attendu** : `startRecording` echoue (pas de demarrage) -> `Alert` « Micro necessaire » + corps invitant a autoriser le micro dans les Reglages (`voice.micNeededTitle` / `voice.micNeededBody`) ; aucune barre d'enregistrement ne s'ouvre ; les taps repetes ne lancent pas d'enregistrement fantome.
- **Critere d'acceptation (OK/KO)** : OK si l'alerte « Micro necessaire » s'affiche et aucun enregistrement ne demarre ; KO si crash ou enregistrement sans permission.
- **Donnees de test** : conversation `peer-1` ; permission micro = refusee.
- **Duree estimee** : 3 min

### MSG-CHAT-025 - Micro accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; champ vide ; TalkBack/VoiceOver actif ; grande police.
- **Etapes** :
  1. Balayer jusqu'au bouton final (champ vide -> Micro).
- **Resultat attendu** : annonce « Enregistrer un message vocal, bouton » (`chat.micA11y`) ; double-tap demarre l'enregistrement (sous reserve de permission) ; cible 44x44.
- **Critere d'acceptation (OK/KO)** : OK si libelle vocal = « Enregistrer un message vocal » ; KO sinon.
- **Donnees de test** : conversation `peer-1`.
- **Duree estimee** : 2 min

### MSG-CHAT-026 - Annuler un enregistrement vocal

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : build dev-client ; compte `standard` ; enregistrement en cours (`VoiceRecordingBar` affiche, pas en upload).
- **Etapes** :
  1. Demarrer un enregistrement (cf. 023).
  2. Taper l'icone « Annuler l'enregistrement » (corbeille, a gauche).
- **Resultat attendu** : `voice.cancelRecording` arrete et jette le clip ; `voice.isActive` repasse a faux ; la barre de saisie texte revient ; aucun upload ni message envoye.
- **Critere d'acceptation (OK/KO)** : OK si la barre de saisie revient et aucun message vocal n'est cree ; KO sinon.
- **Donnees de test** : enregistrement de ~3 s puis annulation.
- **Duree estimee** : 2 min

### MSG-CHAT-027 - Annuler : desactive pendant l'upload (multi-clic)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; clip en cours d'**upload** (`voice.isUploading` vrai) — declenchable en envoyant puis pendant le transfert (reseau lent / 4G degradee).
- **Etapes** :
  1. Enregistrer un clip et taper Envoyer (le clip part en upload).
  2. Pendant l'upload, taper plusieurs fois « Annuler l'enregistrement ».
- **Resultat attendu** : le bouton Annuler est `disabled` pendant l'upload -> taps sans effet ; l'upload se poursuit ; pas d'etat incoherent (la barre montre « Envoi… »).
- **Critere d'acceptation (OK/KO)** : OK si Annuler est inactif pendant l'upload et l'envoi aboutit ou echoue proprement ; KO si annulation a mi-upload corrompt l'etat.
- **Donnees de test** : clip ~5 s, reseau 4G bride.
- **Duree estimee** : 3 min

### MSG-CHAT-028 - Annuler accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; enregistrement en cours ; TalkBack/VoiceOver actif.
- **Etapes** :
  1. Demarrer un enregistrement.
  2. Balayer jusqu'au bouton corbeille.
- **Resultat attendu** : annonce « Annuler l'enregistrement, bouton » (`voice.cancelA11y`) ; double-tap annule.
- **Critere d'acceptation (OK/KO)** : OK si libelle vocal = « Annuler l'enregistrement » ; KO sinon.
- **Donnees de test** : enregistrement ~3 s.
- **Duree estimee** : 2 min

### MSG-CHAT-029 - Envoyer un message vocal

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : build dev-client ; compte `standard` ; permission micro ; Wi-Fi ; enregistrement en cours.
- **Etapes** :
  1. Demarrer un enregistrement, parler ~3 s.
  2. Taper « Envoyer le message vocal » (a droite de la barre d'enregistrement).
  3. Attendre la fin de l'upload.
- **Resultat attendu** : `finish` -> `voiceService.upload(uri)` -> `useSendVoiceMessage` avec `{ conversationId, audioUrl, durationMs }` ; pendant l'upload la barre affiche « Envoi… » + spinner ; a la reussite, une bulle vocale (cote « mine ») apparait en bas du fil, le fil defile vers le bas et la barre de saisie texte revient.
- **Critere d'acceptation (OK/KO)** : OK si la bulle vocale lisible apparait dans le fil et la barre de saisie revient ; KO si echec silencieux ou bulle absente.
- **Donnees de test** : clip ~3 s ; conversation `peer-1`.
- **Duree estimee** : 3 min

### MSG-CHAT-030 - Envoyer vocal : echec d'upload et multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; enregistrement en cours ; reseau coupe juste avant l'upload (mode avion) puis retabli.
- **Etapes** :
  1. Enregistrer un clip ~3 s.
  2. Couper le Wi-Fi.
  3. Taper « Envoyer le message vocal » plusieurs fois rapidement.
  4. Reactiver le reseau.
- **Resultat attendu** : pendant l'upload le bouton est `disabled` (pas de double envoi) ; en cas d'echec `voiceService.upload`/send, un toast d'erreur s'affiche (`useApiErrorToast`), `isUploading` repasse a faux et la barre reste utilisable (re-essai possible) ; pas de message vocal partiel dans le fil.
- **Critere d'acceptation (OK/KO)** : OK si echec gere par toast sans doublon ni bulle corrompue, re-essai possible apres reconnexion ; KO sinon.
- **Donnees de test** : clip ~3 s ; coupure reseau pendant l'upload.
- **Duree estimee** : 4 min

### MSG-CHAT-031 - Envoyer vocal accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; enregistrement en cours ; TalkBack/VoiceOver actif ; contraste eleve.
- **Etapes** :
  1. Demarrer un enregistrement.
  2. Balayer jusqu'au bouton d'envoi de la barre d'enregistrement.
- **Resultat attendu** : annonce « Envoyer le message vocal, bouton » (`voice.sendA11y`) ; double-tap declenche l'envoi ; icone send blanche sur fond `colors.primary` (contraste suffisant) ; taille 44x44.
- **Critere d'acceptation (OK/KO)** : OK si libelle vocal = « Envoyer le message vocal » et envoi via double-tap ; KO sinon.
- **Donnees de test** : clip ~3 s.
- **Duree estimee** : 3 min

### MSG-CHAT-032 - Vocal : reception et lecture cote pair (multi-utilisateur)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux devices/comptes `standard` (A = moi, B = `Alex Rivers`) ; conversation ouverte des deux cotes ; build dev-client + permission micro cote A ; Wi-Fi.
- **Etapes** :
  1. Sur A, enregistrer et envoyer un message vocal de ~3 s.
  2. Sur B, attendre l'arrivee de la bulle vocale.
  3. Sur B, taper « Lire le message vocal » sur la bulle recue.
- **Resultat attendu** : la bulle vocale arrive cote B (bulle recue) ; la lecture demarre (icone passe a Pause, `voice.pauseA11y`), la barre de progression avance et le minuteur compte ; un nouveau tap met en pause. Pas de duplication cote A.
- **Critere d'acceptation (OK/KO)** : OK si B recoit et lit le clip avec progression correcte ; KO si clip absent, illisible ou doublonne.
- **Donnees de test** : clip ~3 s ; A=moi, B=`peer-1`.
- **Duree estimee** : 5 min

### MSG-CHAT-033 - Lire / Pause d'une bulle vocale

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : build dev-client ; conversation contenant au moins un message `kind='voice'` avec `audioUrl` valide ; volume non nul (lecture forcee meme en mode silencieux via `playsInSilentMode`).
- **Etapes** :
  1. Reperer une bulle de message vocal dans le fil.
  2. Taper l'icone lecture (▶).
  3. Pendant la lecture, retaper pour mettre en pause.
  4. Laisser la lecture aller jusqu'au bout puis retaper.
- **Resultat attendu** : ▶ demarre la lecture (icone -> Pause), la barre de progression se remplit et le temps avance ; pause arrete et conserve la position ; en fin de clip (`didJustFinish`), un nouveau tap relance depuis 0 (`seekTo(0)`).
- **Critere d'acceptation (OK/KO)** : OK si play/pause/reprise/relecture fonctionnent et la progression est coherente ; KO si pas de son, progression figee ou icone incoherente.
- **Donnees de test** : message vocal existant `audioUrl` valide, `durationMs` ~3000.
- **Duree estimee** : 3 min

### MSG-CHAT-034 - Lecture : audio indisponible / plusieurs bulles

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : conversation avec un message vocal dont l'`audioUrl` est injoignable (404 / hors-ligne) ET plusieurs bulles vocales.
- **Etapes** :
  1. Couper le reseau (clip non encore en cache).
  2. Taper Lire sur la bulle.
  3. Taper rapidement plusieurs fois.
  4. Lancer une autre bulle vocale pendant qu'une autre est censee jouer.
- **Resultat attendu** : pas de crash si l'audio ne se charge pas ; la barre de progression reste a 0 / le temps affiche la duree connue ; les taps multiples ne creent pas d'etats incoherents ; chaque bulle possede son propre player (la lecture d'une bulle n'altere pas la barre d'une autre).
- **Critere d'acceptation (OK/KO)** : OK si pas de crash et chaque player reste independant ; KO si crash ou progression erronee partagee.
- **Donnees de test** : `audioUrl` 404 ; 2+ bulles vocales.
- **Duree estimee** : 3 min

### MSG-CHAT-035 - Lecture vocale accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : conversation avec message vocal ; TalkBack/VoiceOver actif ; grande police ; contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a la bulle vocale.
  2. Activer la commande, observer l'annonce avant/apres lecture.
- **Resultat attendu** : a l'arret le lecteur annonce « Lire le message vocal, bouton » (`voice.playA11y`) ; en lecture il annonce « Mettre en pause, bouton » (`voice.pauseA11y`) ; le libelle reflete dynamiquement l'etat de lecture.
- **Critere d'acceptation (OK/KO)** : OK si les deux libelles (Lire/Pause) sont annonces selon l'etat ; KO si libelle fige ou absent.
- **Donnees de test** : message vocal `durationMs` ~3000.
- **Duree estimee** : 3 min

### MSG-CHAT-036 - Defilement du fil et marquage lu a l'ouverture

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; conversation `peer-1` avec `unreadCount > 0` et un historique > 1 ecran de messages ; Wi-Fi.
- **Etapes** :
  1. Ouvrir la conversation depuis la liste Messages (la ligne affiche une pastille non lu).
  2. Observer le fil (positionne sur le dernier message, liste inversee).
  3. Faire defiler vers le haut pour charger l'historique ancien.
- **Resultat attendu** : a l'ouverture, `useMarkConversationRead` est appele **une seule fois** (gardien `markedRef`) -> la pastille non-lu de la ligne et le badge d'onglet Messages se vident (invalidation `conversations` + `unread`) ; le fil est pin au dernier message ; le defilement vers le haut est fluide.
- **Critere d'acceptation (OK/KO)** : OK si le badge se vide une seule fois et le fil defile correctement ; KO si re-marquage en boucle ou fil mal positionne.
- **Donnees de test** : conversation `peer-1`, `unreadCount = 3`.
- **Duree estimee** : 3 min

### MSG-CHAT-037 - Ouverture : marquage lu hors-ligne et liste vide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; possibilite de couper le reseau ; une conversation sans aucun message et une conversation avec non-lus.
- **Etapes** :
  1. Couper le Wi-Fi.
  2. Ouvrir la conversation avec non-lus.
  3. Verifier que l'app ne plante pas malgre l'echec du POST mark-read.
  4. Reactiver le reseau, rouvrir.
  5. Ouvrir une conversation sans message (liste vide).
- **Resultat attendu** : hors-ligne, le mark-read echoue silencieusement sans crash ni boucle (le `markedRef` empeche le re-trigger sur re-render) ; au retour reseau, l'ouverture re-tente le marquage si `unreadCount` toujours > 0 ; la conversation vide affiche header + barre de saisie sans erreur, FlatList vide.
- **Critere d'acceptation (OK/KO)** : OK si aucune erreur visible hors-ligne et liste vide rendue proprement ; KO si crash, boucle de requetes, ou ecran blanc.
- **Donnees de test** : conversation `peer-1` (non lus), conversation `peer-empty` (vide).
- **Duree estimee** : 4 min

### MSG-CHAT-038 - Fil et separateurs de date accessibles (grande police)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; conversation s'etalant sur plusieurs jours (aujourd'hui, hier, date plus ancienne) ; TalkBack/VoiceOver actif ; police « tres grande » ; contraste eleve.
- **Etapes** :
  1. Ouvrir la conversation.
  2. Balayer le fil avec le lecteur d'ecran.
- **Resultat attendu** : les separateurs annoncent « Aujourd'hui » / « Hier » (`chat.dateToday` / `chat.dateYesterday`) ou la date formatee dans la langue active ; le contenu des bulles (texte + heure) est lisible et annonce ; en grande police les bulles s'agrandissent sans tronquer le texte ; contraste texte/bulle suffisant.
- **Critere d'acceptation (OK/KO)** : OK si les separateurs et bulles sont annonces et lisibles en grande police ; KO si texte tronque ou non annonce.
- **Donnees de test** : messages dates aujourd'hui, hier, et 2026-06-01.
- **Duree estimee** : 3 min
