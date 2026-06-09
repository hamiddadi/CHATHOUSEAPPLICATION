# 27 - Chat de groupe (`messages`)

## Contexte ecran

- **Route** : `GroupChat` (pile `MessageStackParamList`), parametre obligatoire `route.params.conversationId`. Fichier : `src/features/messages/screens/GroupChatScreen/GroupChatScreen.tsx`.
- **Roles requis** : utilisateur authentifie (`standard` minimum ; `admin` herite des memes capacites). Un `guest` (non authentifie, `useAuthStore.user?.id === null`) ne peut pas atteindre cet ecran via la navigation normale : il faut un compte connecte et etre membre de la conversation. La moderation/gestion (renommer, ajouter/retirer membres, quitter) ne vit PAS sur cet ecran mais sur `GroupInfo` (atteint via le header).
- **Comportements « temps reel »** : ATTENTION, contrairement aux rooms audio LiveKit/WebSocket, ce chat de groupe est **REST + react-query**, PAS de socket pousse sur cet ecran. La livraison « live » se fait par re-fetch react-query (au focus / invalidation), pas par evenement WebSocket. Concretement :
  - Envoi texte : `POST /groups/:id/messages` puis `setQueryData` (ajout optimiste-apres-reponse en fin de liste) + `invalidateQueries(list)`.
  - Envoi vocal : upload du clip (`voiceService.upload`) puis `POST /groups/:id/voice`, meme strategie de cache.
  - Lecture (`PATCH /groups/:id/read`) declenchee automatiquement a l'ouverture / a l'arrivee de messages si `unreadCount > 0`, puis invalidation `detail` + `list`.
  - La synchro multi-utilisateur (voir le message d'un autre membre apparaitre) depend donc d'un nouveau fetch de `GET /groups/:id/messages` (focus / pull / montage), pas d'un push instantane. Les cas « Temps-reel multi-utilisateur » ci-dessous testent cette latence/refetch, et non un canal socket.
- **Pre-conditions globales** : backend joignable (`apiClient` base URL), compte de test connecte, conversation existante dont le compte est membre. Pour le vocal : permission micro accordee (sinon `Alert` « Micro necessaire »).
- **Etats de donnees pertinents** :
  - Chargement : `useGroupMessages.isLoading === true` → `Loader` plein ecran (`accessibilityLabel = t('common.loading')` = « Chargement… »).
  - Liste vide : `messages = []` → `FlatList` inverse vide, barre de saisie presente.
  - Non lus : `group.unreadCount > 0` → `markRead.mutate` auto au montage.
  - Hors-ligne / latence : `apiClient` echoue → `useApiErrorToast` (sur envoi texte via `onError`, sur upload/send vocal via `toastError`).
  - Titre : `group.title` sinon liste des autres membres (`displayName || username`) ; fallback `t('messages.group')` = « Groupe ».

## Matrice bouton

| #   | Bouton                                     | Emplacement                                                                | Type                     | Locator reel                                                                                                                         | Pre-condition                      | Priorite |
| --- | ------------------------------------------ | -------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------- |
| 1   | Retour                                     | Header (gauche)                                                            | navigation               | `accessibilityRole="button"` sur `Pressable` (icone `arrow-back`, sans `accessibilityLabel` ni testID)                               | Ecran monte                        | P1       |
| 2   | Titre / sous-titre du groupe (ouvre Infos) | Header (centre, zone titre `flex-1`)                                       | navigation               | `accessibilityLabel = t('messages.groupInfo')` = « Infos du groupe »                                                                 | `group` charge                     | P1       |
| 3   | Icone Infos (ouvre Infos)                  | Header (droite, icone `info-outline`)                                      | navigation               | `accessibilityLabel = t('messages.groupInfo')` = « Infos du groupe »                                                                 | `group` charge                     | P1       |
| 4   | Champ message                              | Barre de saisie (bas, `flex-1`)                                            | input-submit             | `placeholder = t('messages.messagePlaceholder')` = « Message »                                                                       | Ecran monte                        | P0       |
| 5   | Envoyer (texte)                            | Barre de saisie (bas, droite) — visible si `draft.trim().length > 0`       | realtime-action / submit | `accessibilityLabel = t('common.send')` = « Envoyer » ; `disabled = send.isPending`                                                  | Texte non vide saisi, reseau       | P0       |
| 6   | Micro (demarrer vocal)                     | Barre de saisie (bas, droite) — visible si `draft.trim().length === 0`     | realtime-action / submit | `accessibilityLabel = t('voice.recordA11y')` = « Enregistrer un message vocal »                                                      | Permission micro                   | P0       |
| 7   | Annuler l'enregistrement                   | Barre d'enregistrement vocal (remplace la saisie pendant `voice.isActive`) | destructive              | `accessibilityLabel = t('voice.cancelA11y')` = « Annuler l'enregistrement » ; `disabled = isUploading`                               | Enregistrement en cours            | P1       |
| 8   | Envoyer le vocal                           | Barre d'enregistrement vocal (droite)                                      | realtime-action / submit | `accessibilityLabel = t('voice.sendA11y')` = « Envoyer le message vocal » ; `disabled = isUploading`                                 | Enregistrement en cours, reseau    | P0       |
| 9   | Lire / Pause (bulle vocale)                | Corps — cellule de message vocal (`VoiceMessageBubble`)                    | toggle                   | `accessibilityLabel = status.playing ? t('voice.pauseA11y') : t('voice.playA11y')` = « Mettre en pause » / « Lire le message vocal » | Au moins un message `kind = voice` | P1       |

> Remarque : le bouton Retour (#1) n'a pas de `accessibilityLabel` ni de `testID` dans le code ; le seul selecteur disponible est le `Pressable` avec `accessibilityRole="button"` (premier de l'ecran, icone `arrow-back`). En automatisation, le cibler par index/role ; il faudra idealement ajouter `accessibilityLabel={t('common.back')}` (cle « Retour » deja presente). Les boutons #2 et #3 partagent EXACTEMENT le meme libelle « Infos du groupe » (le test voisin utilise `getAllByLabelText(...)[0]` pour resoudre l'ambiguite).

## Cas de test

### MSG-GCHAT-001 - Retour vers la liste des conversations

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, membre de la conversation `g1`, ecran `GroupChat` ouvert via la liste de conversations, Wi-Fi.
- **Etapes** :
  1. Depuis la liste des groupes, ouvrir la conversation « Weekend crew ».
  2. Taper le premier `Pressable` du header (icone `arrow-back`, role `button`).
  3. Observer la transition.
- **Resultat attendu** : `navigation.goBack()` est appele ; retour a l'ecran precedent (liste des conversations) ; l'eventuel badge non-lu de la conversation reflete la lecture deja PATCHee.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est restaure sans crash ; KO si rien ne se passe ou si l'app reste bloquee sur le chat.
- **Donnees de test** : `conversationId = "g1"`.
- **Duree estimee** : 2 min

### MSG-GCHAT-002 - Retour : multi-clic rapide ne double-empile pas

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, ecran ouvert, reseau lent simule (latence 2 s, throttling 3G).
- **Etapes** :
  1. Taper rapidement 5 fois le bouton Retour (icone `arrow-back`).
  2. Attendre la stabilisation de la navigation.
- **Resultat attendu** : un seul `goBack` effectif (ou les suivants no-op car la pile n'a plus l'ecran) ; pas de double pop traversant deux ecrans ; pas de crash « can't pop ».
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur atterrit exactement un niveau en arriere ; KO si l'app saute deux ecrans ou plante.
- **Donnees de test** : `conversationId = "g1"`, profil reseau « Slow 3G ».
- **Duree estimee** : 3 min

### MSG-GCHAT-003 - Retour : accessibilite lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) / VoiceOver (iOS) actif, police systeme XXL, contraste eleve.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'au premier element focusable du header.
  3. Ecouter l'annonce, double-taper pour activer.
- **Resultat attendu** : l'element est annonce comme « bouton » (role) ; double-tap declenche `goBack`. NOTE QA : absence de `accessibilityLabel` → l'annonce ne contient pas de libelle explicite (« bouton » seul). A signaler comme amelioration (ajouter `t('common.back')` = « Retour »). La cible tactile reste >= 44 px grace au `hitSlop={8}` autour d'une icone 24.
- **Critere d'acceptation (OK/KO)** : OK si activable au double-tap et zone tactile suffisante ; KO si non focusable ou cible < 44 px.
- **Donnees de test** : police « tres grande », contraste eleve.
- **Duree estimee** : 4 min

### MSG-GCHAT-004 - Ouvrir Infos du groupe via le titre

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, `group` charge (titre « Weekend crew », 2 membres), Wi-Fi.
- **Etapes** :
  1. Verifier que le header affiche « Weekend crew » et « 2 membres ».
  2. Taper la zone titre (centre, `flex-1`, label « Infos du groupe »).
- **Resultat attendu** : `navigation.navigate('GroupInfo', { conversationId: 'g1' })` ; ouverture de l'ecran Infos du groupe.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers `GroupInfo` avec le bon `conversationId` ; KO sinon.
- **Donnees de test** : `group.title = "Weekend crew"`, `members = [Me, Ada]`, `memberCount = 2`.
- **Duree estimee** : 2 min

### MSG-GCHAT-005 - Infos du groupe : double cible (titre + icone) sans double navigation

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, ecran ouvert, reseau normal.
- **Etapes** :
  1. Taper l'icone `info-outline` (droite, label « Infos du groupe »).
  2. Revenir, puis multi-cliquer (4x rapides) sur la zone titre.
- **Resultat attendu** : chaque session ouvre `GroupInfo` une seule fois ; le multi-clic n'empile pas N copies de `GroupInfo` (idempotence raisonnable, max 1 navigation visible). Les deux cibles (#2 et #3) menent au meme ecran avec le meme `conversationId`.
- **Critere d'acceptation (OK/KO)** : OK si une seule instance de `GroupInfo` est presente apres rafale ; KO si pile saturee de doublons.
- **Donnees de test** : `conversationId = "g1"`.
- **Duree estimee** : 3 min

### MSG-GCHAT-006 - Infos du groupe : accessibilite et ambiguite de libelle

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police agrandie, contraste eleve.
- **Etapes** :
  1. Balayer le header au lecteur d'ecran.
  2. Constater que deux elements distincts (zone titre et icone) sont annonces « Infos du groupe, bouton ».
  3. Activer chacun.
- **Resultat attendu** : les deux sont focusables, annonces « Infos du groupe » + role « bouton », et navigues vers `GroupInfo`. NOTE QA : libelle identique pour 2 cibles → potentielle confusion lecteur d'ecran (a documenter ; differencier si besoin). Titre `numberOfLines={1}` reste lisible en police XXL (tronque avec ellipse).
- **Critere d'acceptation (OK/KO)** : OK si chaque cible annonce un libelle + role et est activable ; KO si une cible est non focusable.
- **Donnees de test** : police « tres grande », titre long « Weekend crew on tour 2026 ».
- **Duree estimee** : 4 min

### MSG-GCHAT-007 - Saisie de message : le bouton bascule micro → envoyer

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, ecran ouvert, champ vide.
- **Etapes** :
  1. Verifier qu'avec le champ vide, le bouton de droite est le micro (label « Enregistrer un message vocal »).
  2. Saisir « Bonjour » dans le champ (placeholder « Message »).
  3. Observer le bouton de droite.
  4. Effacer tout le texte.
- **Resultat attendu** : des que `draft.trim().length > 0`, le bouton devient « Envoyer » (icone `send`) ; quand le champ redevient vide, il repasse en micro. Le champ est `multiline`, hauteur max ~28 (`max-h-28`).
- **Critere d'acceptation (OK/KO)** : OK si la bascule micro/envoi suit exactement la presence de texte non-espace ; KO si l'envoi reste visible avec champ vide ou inverse.
- **Donnees de test** : saisies « Bonjour », puis « », puis « » (3 espaces → reste micro).
- **Duree estimee** : 3 min

### MSG-GCHAT-008 - Saisie : espaces seuls ne montrent pas Envoyer

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, ecran ouvert.
- **Etapes** :
  1. Saisir uniquement des espaces « » dans le champ « Message ».
  2. Observer le bouton de droite.
  3. Coller un texte tres long (3000 caracteres) puis observer le rendu/scroll du champ.
- **Resultat attendu** : avec espaces seuls, `draft.trim()` est vide → le bouton reste micro, aucun envoi possible. Le texte long ne casse pas la mise en page (champ scrollable, `max-h-28`), le bouton Envoyer apparait (texte non vide reel).
- **Critere d'acceptation (OK/KO)** : OK si espaces seuls = micro (pas d'envoi), texte long = champ borne sans deborder ; KO si Envoyer apparait sur espaces seuls.
- **Donnees de test** : « (5 espaces) », chaine « A » x 3000.
- **Duree estimee** : 3 min

### MSG-GCHAT-009 - Saisie : accessibilite du champ message

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police XXL, contraste eleve.
- **Etapes** :
  1. Focus lecteur d'ecran sur le champ.
  2. Verifier l'annonce du placeholder « Message » (`placeholderTextColor = colors.textMuted`).
  3. Saisir du texte via clavier accessibilite.
- **Resultat attendu** : champ annonce comme zone de texte editable ; placeholder lisible ; en police XXL le texte saisi et le placeholder restent lisibles (champ `multiline` s'agrandit jusqu'a `max-h-28` puis scrolle). Verifier contraste du placeholder muted >= AA.
- **Critere d'acceptation (OK/KO)** : OK si editable au lecteur d'ecran et placeholder/texte lisibles en XXL ; KO si placeholder illisible (contraste insuffisant) ou champ non focusable.
- **Donnees de test** : police « tres grande », contraste eleve.
- **Duree estimee** : 4 min

### MSG-GCHAT-010 - Envoyer un message texte (trim + reset champ)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, ecran ouvert, backend joignable (Wi-Fi).
- **Etapes** :
  1. Saisir « Hi all » (avec espaces autour).
  2. Taper le bouton « Envoyer » (label `common.send`).
  3. Observer le champ et la liste.
- **Resultat attendu** : `send.mutate({ conversationId: 'g1', text: 'Hi all' }, { onError })` est appele avec le texte **trim** ; le champ est vide immediatement (`setDraft('')`) ; au succes `POST /groups/g1/messages` renvoie le message, ajoute en bas de la liste inversee (`setQueryData`), et la liste de conversations est invalidee. Le message envoye s'affiche dans une bulle alignee a droite (`isMine`).
- **Critere d'acceptation (OK/KO)** : OK si le payload envoye = `{ conversationId:"g1", text:"Hi all" }` et le champ se vide ; KO si espaces conserves ou champ non vide.
- **Donnees de test** : saisie « Hi all », attendu `text = "Hi all"`.
- **Duree estimee** : 3 min

### MSG-GCHAT-011 - Envoyer texte : echec reseau restaure le brouillon + toast

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, mode Avion / coupure reseau pendant l'envoi, ou latence 5 s puis 500.
- **Etapes** :
  1. Saisir « Message offline ».
  2. Couper le reseau (mode Avion).
  3. Taper « Envoyer ».
  4. Taper « Envoyer » 4x de plus rapidement (multi-clic) pendant l'echec.
  5. Retablir le reseau.
- **Resultat attendu** : `send.mutate` echoue → `onError` rappelle `setDraft('Message offline')` (le texte est **restaure** dans le champ) et `toastError(err)` affiche un toast d'erreur. Le multi-clic ne genere pas N messages dupliques cote serveur visibles (le champ etant vide entre temps puis restaure, chaque tap re-tente ; verifier qu'aucun doublon n'est livre apres reconnexion). Pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si le texte revient dans le champ + toast affiche + aucun message fantome en double apres reconnexion ; KO si texte perdu silencieusement ou doublons livres.
- **Donnees de test** : « Message offline », profil reseau « Offline » puis « Online ».
- **Duree estimee** : 5 min

### MSG-GCHAT-012 - Envoyer texte : etat disabled pendant l'envoi (anti double-soumission)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, latence reseau 3 s (envoi lent en cours).
- **Etapes** :
  1. Saisir « Latence ».
  2. Taper « Envoyer ».
  3. Pendant que `send.isPending === true`, re-taper « Envoyer » plusieurs fois.
- **Resultat attendu** : le bouton est `disabled` tant que `send.isPending` ; les taps supplementaires sont ignores ; un seul `POST` part. Remarque : `handleSend` vide deja le champ avant l'appel, donc apres le 1er tap le champ est vide → re-tap n'a pas de texte a envoyer. Aucun double message.
- **Critere d'acceptation (OK/KO)** : OK si exactement un `POST /groups/g1/messages` est emis ; KO si plusieurs.
- **Donnees de test** : « Latence », latence 3 s.
- **Duree estimee** : 4 min

### MSG-GCHAT-013 - Envoyer texte : accessibilite du bouton Envoyer

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police XXL, contraste eleve, texte deja saisi.
- **Etapes** :
  1. Saisir « Accessible ».
  2. Balayer jusqu'au bouton de droite.
  3. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce « Envoyer, bouton » (`accessibilityLabel = common.send`) ; double-tap envoie. Cible 44x44 (`w-11 h-11`) conforme. En police XXL le bouton garde sa taille (icone fixe 20). Contraste icone `onPrimary` sur fond `primary` a verifier >= AA.
- **Critere d'acceptation (OK/KO)** : OK si annonce libelle+role, activable, cible >= 44 px ; KO sinon.
- **Donnees de test** : « Accessible », police « tres grande ».
- **Duree estimee** : 4 min

### MSG-GCHAT-014 - Envoyer texte : synchro multi-utilisateur (deux membres)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes `standard` (Compte A = « Me », Compte B = « Ada ») membres du meme groupe `g1`, deux appareils, Wi-Fi.
- **Etapes** :
  1. Sur l'appareil A, ouvrir le chat `g1`.
  2. Sur l'appareil B, ouvrir le meme chat `g1`.
  3. Sur A, envoyer « Coucou de A ».
  4. Sur B, declencher un re-fetch (revenir/refocus l'ecran ou attendre l'invalidation/refetch au focus).
- **Resultat attendu** : A voit immediatement sa bulle a droite (cache local). B voit « Coucou de A » dans une bulle a gauche, precedee du nom de l'expediteur « Me/Ada » (`nameById`), apres un nouveau `GET /groups/g1/messages` (PAS de push instantane : la latence depend du re-fetch react-query, pas d'un socket). Le `unreadCount` de B se met a 0 a l'ouverture via `PATCH /groups/g1/read`.
- **Critere d'acceptation (OK/KO)** : OK si B affiche le message d'A avec nom correct apres refetch ; KO si message absent, sans nom, ou jamais livre.
- **Donnees de test** : A.id = `me`, B.id = `u2` (Ada), texte « Coucou de A ».
- **Duree estimee** : 6 min

### MSG-GCHAT-015 - Demarrer un enregistrement vocal (micro)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, **permission micro accordee**, champ vide (bouton micro visible), build EAS dev-client (module audio natif, pas Expo Go).
- **Etapes** :
  1. S'assurer que le champ est vide (bouton « Enregistrer un message vocal » visible).
  2. Taper le bouton micro.
- **Resultat attendu** : `voice.startRecording()` est appele → l'enregistrement demarre, `voice.isActive` passe a `true`, la barre de saisie est remplacee par la `VoiceRecordingBar` (point rouge clignotant, timer `0:00` croissant, libelle « Enregistrement… »).
- **Critere d'acceptation (OK/KO)** : OK si la barre vocale apparait et le timer s'incremente ; KO si rien ne se passe.
- **Donnees de test** : permission micro = accordee.
- **Duree estimee** : 3 min

### MSG-GCHAT-016 - Micro : permission refusee declenche l'alerte

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, **permission micro refusee** (au niveau OS), champ vide.
- **Etapes** :
  1. Refuser/revoquer la permission micro dans les reglages OS.
  2. Taper le bouton micro.
  3. Re-taper rapidement le micro 3x (multi-clic).
- **Resultat attendu** : `startRecording` → `start()` renvoie faux → `Alert.alert(t('voice.micNeededTitle'), t('voice.micNeededBody'))` = « Micro necessaire » / « Autorisez l'acces au micro dans les Reglages… ». La barre vocale **n'apparait pas** (`isActive` reste faux). Le multi-clic n'empile pas plusieurs alertes simultanees genantes (une a la fois).
- **Critere d'acceptation (OK/KO)** : OK si l'alerte « Micro necessaire » s'affiche et aucun enregistrement ne demarre ; KO si crash ou enregistrement silencieux.
- **Donnees de test** : permission micro = refusee.
- **Duree estimee** : 4 min

### MSG-GCHAT-017 - Micro : accessibilite du bouton d'enregistrement

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, champ vide, police XXL, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton de droite (champ vide).
  2. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce « Enregistrer un message vocal, bouton » (`voice.recordA11y`) ; double-tap demarre l'enregistrement (ou declenche l'alerte permission). Cible 44x44 (`w-11 h-11`). Bouton bien distinct du bouton « Envoyer » selon l'etat du champ.
- **Critere d'acceptation (OK/KO)** : OK si libelle « Enregistrer un message vocal » annonce + activable ; KO sinon.
- **Donnees de test** : police « tres grande ».
- **Duree estimee** : 4 min

### MSG-GCHAT-018 - Annuler un enregistrement vocal en cours

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, permission micro, enregistrement en cours (`voice.isActive`, barre affichee), reseau indifferent.
- **Etapes** :
  1. Demarrer un enregistrement (micro).
  2. Attendre ~3 s (timer ~0:03).
  3. Taper le bouton « Annuler l'enregistrement » (icone `delete-outline`, label `voice.cancelA11y`).
- **Resultat attendu** : `voice.cancelRecording()` → `cancel()` ; l'enregistrement est jete (aucun upload, aucun `POST /groups/:id/voice`) ; `isActive` repasse a faux ; la barre vocale disparait et la saisie texte revient (bouton micro). Aucun message vocal ajoute.
- **Critere d'acceptation (OK/KO)** : OK si retour a la barre de saisie sans message cree ; KO si un message vocal apparait ou si l'ecran reste en mode enregistrement.
- **Donnees de test** : duree enregistree ~3 s.
- **Duree estimee** : 3 min

### MSG-GCHAT-019 - Annuler : desactive pendant l'upload (anti-annulation tardive)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, enregistrement termine et **upload en cours** (`isUploading === true`), reseau lent (upload 5 s).
- **Etapes** :
  1. Enregistrer un clip puis taper « Envoyer le message vocal ».
  2. Pendant l'upload (libelle « Envoi… », spinner), taper « Annuler l'enregistrement » plusieurs fois.
- **Resultat attendu** : le bouton Annuler est `disabled={isUploading}` → taps ignores ; l'upload se poursuit ; pas d'etat incoherent. Une fois l'upload/envoi termine, la barre disparait.
- **Critere d'acceptation (OK/KO)** : OK si l'annulation est inerte pendant l'upload et l'envoi aboutit ; KO si l'annulation interrompt/corrompt l'envoi.
- **Donnees de test** : upload simule 5 s.
- **Duree estimee** : 4 min

### MSG-GCHAT-020 - Annuler : accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, enregistrement en cours, police XXL, contraste eleve.
- **Etapes** :
  1. Demarrer un enregistrement.
  2. Balayer jusqu'au bouton de gauche de la barre vocale.
  3. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce « Annuler l'enregistrement, bouton » (`voice.cancelA11y`) ; double-tap annule. Cible 44x44 (`iconBtn`). Le timer (`fontVariant: tabular-nums`) reste lisible en police XXL.
- **Critere d'acceptation (OK/KO)** : OK si libelle « Annuler l'enregistrement » annonce + activable ; KO sinon.
- **Donnees de test** : police « tres grande ».
- **Duree estimee** : 3 min

### MSG-GCHAT-021 - Envoyer un message vocal (upload + post)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, permission micro, enregistrement en cours, backend + service d'upload joignables (Wi-Fi).
- **Etapes** :
  1. Demarrer un enregistrement (micro).
  2. Parler ~4 s.
  3. Taper « Envoyer le message vocal » (icone `send`, label `voice.sendA11y`).
- **Resultat attendu** : `voice.sendRecording()` → `finish()` produit un clip → `isUploading = true` (libelle « Envoi… » + spinner) → `voiceService.upload(uri)` → `sendVoice.mutateAsync({ conversationId:'g1', audioUrl, durationMs })` → `POST /groups/g1/voice` → message vocal ajoute en bas de la liste (`setQueryData`) dans une bulle a droite avec lecteur `VoiceMessageBubble` ; barre vocale fermee.
- **Critere d'acceptation (OK/KO)** : OK si un message `kind=voice` apparait avec lecteur et duree ~0:04 ; KO si echec silencieux ou clip perdu.
- **Donnees de test** : clip ~4000 ms, `audioUrl` = URL renvoyee par l'upload.
- **Duree estimee** : 4 min

### MSG-GCHAT-022 - Envoyer vocal : echec upload/envoi → toast, pas de message

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, enregistrement en cours, reseau coupe pendant l'upload (ou serveur 500).
- **Etapes** :
  1. Enregistrer un clip.
  2. Couper le reseau (mode Avion).
  3. Taper « Envoyer le message vocal ».
  4. Pendant l'echec, re-taper « Envoyer le message vocal » plusieurs fois.
- **Resultat attendu** : `sendRecording` entre dans `catch` → `toastError(err)` ; `finally` remet `isUploading = false`. Aucun message vocal ajoute a la liste. Le bouton etant `disabled={isUploading}` pendant l'upload, le multi-clic ne lance pas plusieurs uploads concurrents ; apres echec, un re-essai manuel est possible. Pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si toast d'erreur + aucun message vocal cree + pas de doublon ; KO si message vocal fantome ou crash.
- **Donnees de test** : clip ~3 s, profil « Offline ».
- **Duree estimee** : 5 min

### MSG-GCHAT-023 - Envoyer vocal : accessibilite (etats repos/upload)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, enregistrement en cours, police XXL, contraste eleve.
- **Etapes** :
  1. Demarrer un enregistrement.
  2. Balayer jusqu'au bouton d'envoi (droite de la barre vocale).
  3. Ecouter l'annonce ; double-taper ; pendant l'upload, re-balayer le bouton.
- **Resultat attendu** : annonce « Envoyer le message vocal, bouton » (`voice.sendA11y`) ; pendant l'upload, le bouton affiche un `ActivityIndicator` et est `disabled` (annonce « non disponible » selon plateforme). Cible 44x44 (`sendBtn`). Contraste icone `onPrimary` sur `primary` >= AA.
- **Critere d'acceptation (OK/KO)** : OK si libelle annonce, activable au repos, marque indisponible pendant l'upload ; KO sinon.
- **Donnees de test** : police « tres grande ».
- **Duree estimee** : 4 min

### MSG-GCHAT-024 - Envoyer vocal : reception multi-utilisateur + lecture

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes (A=Me, B=Ada) membres de `g1`, deux appareils, permission micro sur A, Wi-Fi.
- **Etapes** :
  1. Sur A, enregistrer et envoyer un vocal ~5 s.
  2. Sur B, re-focus l'ecran `g1` pour declencher le refetch.
  3. Sur B, taper « Lire le message vocal » sur la bulle recue.
- **Resultat attendu** : A voit sa bulle vocale a droite. B, apres `GET /groups/g1/messages`, voit une bulle vocale a gauche prefixee du nom « Me » avec lecteur ; le tap Lire (`voice.playA11y`) demarre la lecture (`expo-audio`, `playsInSilentMode: true`), l'icone passe a pause et la progression avance. La livraison depend du refetch (pas de push socket).
- **Critere d'acceptation (OK/KO)** : OK si B recoit la bulle vocale et peut la lire ; KO si message absent, illisible, ou sans nom d'expediteur.
- **Donnees de test** : clip ~5000 ms, A.id=`me`, B.id=`u2`.
- **Duree estimee** : 6 min

### MSG-GCHAT-025 - Lire un message vocal recu (play)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, au moins un message `kind=voice` dans le thread, volume audible (l'app force `playsInSilentMode`).
- **Etapes** :
  1. Reperer une bulle vocale (`VoiceMessageBubble`, role bouton « Lire le message vocal »).
  2. Taper Lire.
  3. Observer l'icone et la barre de progression.
- **Resultat attendu** : `onToggle` → si appareil en silencieux, `setAudioModeAsync({ playsInSilentMode: true })` ; si la lecture etait finie/au bout, `seekTo(0)` puis `play()`. L'icone passe `play-arrow` → `pause`, le label devient « Mettre en pause » (`voice.pauseA11y`), la barre de progression (`fill`) progresse, l'horodatage affiche le temps ecoule croissant.
- **Critere d'acceptation (OK/KO)** : OK si la lecture demarre, icone = pause, progression visible ; KO si rien ne joue.
- **Donnees de test** : message vocal `audioUrl` valide, `durationMs = 4000`.
- **Duree estimee** : 3 min

### MSG-GCHAT-026 - Lire/Pause : taps rapides + reprise apres fin

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, un message vocal court (~2 s), reseau pour streamer l'audio (latence possible).
- **Etapes** :
  1. Taper Lire/Pause tres rapidement 6x de suite.
  2. Laisser la lecture aller jusqu'a la fin (`didJustFinish`).
  3. Re-taper Lire.
- **Resultat attendu** : l'alternance play/pause reste coherente (pas de double lecture superposee) ; en fin de clip (`didJustFinish` ou `currentTime >= totalSec`), un nouveau tap Lire fait `seekTo(0)` puis rejoue depuis le debut. Aucun crash du player ; si l'URL est lente, la barre reste a 0 puis demarre quand l'audio est pret.
- **Critere d'acceptation (OK/KO)** : OK si pas de chevauchement audio et reprise depuis le debut apres fin ; KO si lectures multiples superposees ou player bloque.
- **Donnees de test** : clip ~2000 ms.
- **Duree estimee** : 4 min

### MSG-GCHAT-027 - Lire/Pause : accessibilite (libelle dynamique)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, un message vocal present, police XXL, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton de lecture d'une bulle vocale.
  2. Ecouter l'annonce (etat repos).
  3. Double-taper pour lire, re-balayer le meme bouton.
- **Resultat attendu** : au repos, annonce « Lire le message vocal, bouton » (`voice.playA11y`) ; apres lancement, le meme bouton s'annonce « Mettre en pause » (`voice.pauseA11y`) — libelle dynamique selon `status.playing`. Cible >= 32 px + `hitSlop={8}`. La duree (`tabular-nums`) reste lisible en XXL ; contraste de l'icone/track selon `isMine` (blanc sur primary / texte sur glass) a verifier >= AA.
- **Critere d'acceptation (OK/KO)** : OK si le libelle bascule Lire ↔ Mettre en pause selon l'etat et reste activable ; KO si libelle statique ou cible trop petite.
- **Donnees de test** : police « tres grande », contraste eleve, message vocal recu (`isMine=false`) et envoye (`isMine=true`).
- **Duree estimee** : 4 min

### MSG-GCHAT-028 - Etat liste vide + chargement (pas de bouton, etat ecran)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, conversation sans message (`messages = []`) puis en chargement (`isLoading=true`).
- **Etapes** :
  1. Ouvrir une conversation vide.
  2. Pendant le chargement, observer l'ecran.
  3. Apres chargement, observer la liste vide.
- **Resultat attendu** : pendant `isLoading`, `Loader` plein ecran avec `accessibilityLabel` « Chargement… » (`common.loading`). Une fois charge sans message, la `FlatList` inversee est vide et la barre de saisie (champ + micro) reste utilisable. Aucune erreur.
- **Critere d'acceptation (OK/KO)** : OK si loader annonce puis liste vide propre + saisie active ; KO si spinner bloque ou crash sur liste vide.
- **Donnees de test** : `messages = []`, `group.unreadCount = 0`.
- **Duree estimee** : 3 min
