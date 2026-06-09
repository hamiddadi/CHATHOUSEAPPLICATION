# 30 - Nouveau message (`messages`)

## Contexte ecran

- **Route** : `NewMessage` dans le `MessageStackParamList` (`src/core/navigation/types.ts`). Ouvert depuis la liste des conversations, en general via un bouton de composition. Navigue ensuite en `navigation.replace(...)` (et non `navigate`) pour que le bouton Retour revienne a la liste de conversations, pas a ce selecteur.
- **Roles requis** : `standard` et `admin` (utilisateur authentifie). Un `guest` (non authentifie) ne peut pas atteindre cet ecran ni appeler `/search` ni `/groups` (les deux endpoints tournent sous auth). Pas de role specifique requis cote messagerie : tout compte connecte peut composer un message.
- **Comportements temps-reel** :
  - L'ecran lui-meme **n'ouvre pas** de socket WebSocket ni de session LiveKit. La recherche de personnes est un appel HTTP `GET /search?type=users` (trigram PG, appele a chaque frappe avec un debounce de 250 ms). La creation de groupe est un `POST /groups` (HTTP, via React Query `useCreateGroup`).
  - **Effet temps-reel indirect** : selectionner 1 personne ouvre un fil 1:1 (`ChatDetail`) et selectionner >= 2 personnes cree puis ouvre un groupe (`GroupChat`) ; ces ecrans cibles sont, eux, temps-reel (messages WebSocket / push). La conversation/groupe nouvellement cree(e) doit apparaitre dans la liste des conversations des autres membres (invalidation `groupKeys.list()` cote createur ; cote destinataires, dependant du push/refresh de leur liste). Les cas multi-utilisateurs ci-dessous valident cette propagation.
- **Pre-conditions globales** : compte connecte, reseau disponible pour la recherche et la creation, token d'auth valide (le refresh silencieux ne deconnecte pas sur un simple blip reseau).
- **Etats de donnees pertinents** :
  - **Avant toute saisie** (`debounced.length === 0`) : aucune liste, un `EmptyState` d'invite avec le titre `messages.newMessageTitle` et la description `messages.searchGroupHint`.
  - **Recherche en cours** (`searching === true` et requete non vide) : le `ListEmptyComponent` renvoie `null` (aucun placeholder de chargement visible dans la liste).
  - **Aucun resultat** (requete non vide, recherche terminee, 0 hit) : `EmptyState` `messages.noResults` + `messages.noResultsHint`.
  - **Resultats** : `FlatList` de personnes ; chaque ligne est une case a cocher (radio non cochee / `check-circle` cochee).
  - **Selection non vide** (`selectedCount > 0`) : une barre d'action collee en bas apparait avec le bouton CTA (`Message` si 1 selection, `Create group · N` si >= 2).
  - **Hors-ligne** : la recherche echoue silencieusement (le `.finally` remet `searching` a false, la liste reste vide -> etat "aucun resultat") ; la creation de groupe en echec leve `Alert` `messages.groupError`.

## Matrice bouton

| #   | Bouton                                | Emplacement                   | Type               | Locator reel                                                                                                                                                                                       | Pre-condition                                      | Priorite |
| --- | ------------------------------------- | ----------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------- |
| 1   | Fermer / Retour                       | Header (gauche)               | navigation         | `accessibilityLabel = t('common.close', 'Close')` ; icone `MaterialIcons name="arrow-back"` ; `accessibilityRole="button"`                                                                         | Ecran ouvert                                       | P1       |
| 2   | Champ de recherche de personnes       | Corps (sous le header)        | input-submit       | `placeholder = t('messages.searchPeople', 'Search people')` (selecteur `getByPlaceholderText`) ; `leftAdornment` icone `search`                                                                    | Ecran ouvert ; reseau pour declencher la recherche | P1       |
| 3   | Ligne personne (cocher / decocher)    | Corps (cellule de `FlatList`) | list-item / toggle | `accessibilityRole="checkbox"` ; `accessibilityLabel = item.displayName \|\| item.username` ; `accessibilityState={{ checked }}` ; icone `check-circle` / `radio-button-unchecked`                 | Au moins 1 resultat de recherche affiche           | P0       |
| 4   | Demarrer (Message / Create group · N) | Barre d'action basse          | submit             | `label` = `t('messages.message', 'Message')` (1 selection) ou `t('messages.createGroupN', { count, defaultValue: 'Create group · N' })` (>= 2) ; `accessibilityRole="button"` (composant `Button`) | `selectedCount > 0` ; reseau (creation de groupe)  | P0       |

Tous les elements interactifs reellement rendus par l'ecran sont listes ci-dessus (4 elements). Il n'existe pas de partials, pas de swipe, pas de long-press, pas de pull-to-refresh, pas de FAB et pas de soumission par touche Entree (`Input` n'a pas de `onSubmitEditing` ici : la recherche est pilotee uniquement par `onChangeText` + debounce).

## Cas de test

### MSG-NEW-001 - Retour revient a la liste de conversations

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, aucune permission particuliere, ecran Nouveau message ouvert depuis la liste de conversations.
- **Etapes** :
  1. Ouvrir l'ecran Nouveau message.
  2. Taper sur le bouton header dont le libelle accessible est `Close` (icone fleche retour).
- **Resultat attendu** : `navigation.goBack()` est appele ; retour immediat a l'ecran precedent (liste de conversations) sans creation ni appel reseau.
- **Critere d'acceptation (OK/KO)** : OK si l'on revient a la liste de conversations et qu'aucune conversation/groupe n'a ete cree ; KO sinon.
- **Donnees de test** : compte `standard` `qa.standard@chathouse.test` / OTP `000000`.
- **Duree estimee** : 2 min

### MSG-NEW-002 - Multi-tap rapide sur Retour ne provoque pas de double navigation

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, latence reseau elevee simulee (throttle 3G), ecran ouvert.
- **Etapes** :
  1. Taper 5 fois tres rapidement (< 1 s) sur le bouton `Close`.
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul `goBack` effectif ; pas d'ecran noir, pas de retour deux niveaux en arriere, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'on atterrit exactement sur la liste de conversations (un seul niveau remonte) ; KO si l'app remonte trop loin ou plante.
- **Donnees de test** : compte `standard` `qa.standard@chathouse.test`.
- **Duree estimee** : 3 min

### MSG-NEW-003 - Accessibilite du bouton Retour (TalkBack/VoiceOver, police agrandie, contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme reglee au maximum, mode contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au premier element focusable du header.
  3. Ecouter l'annonce et double-taper pour activer.
  4. Verifier le rendu du titre `New message` a la police agrandie.
- **Resultat attendu** : le lecteur annonce `Close, bouton` (libelle `common.close`) ; le double-tap declenche le retour ; le titre `messages.newMessageTitle` reste lisible et non tronque a la police max ; l'icone fleche reste visible en contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si l'element est focusable, correctement annonce comme bouton avec le libelle `Close`, et activable ; KO si non focusable ou annonce vide/"image".
- **Donnees de test** : compte `standard` `qa.standard@chathouse.test`.
- **Duree estimee** : 4 min

### MSG-NEW-004 - Recherche affiche les personnes correspondantes

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, au moins un utilisateur existant correspondant a la requete (ex. "Ada Lovelace", username `ada`).
- **Etapes** :
  1. Ouvrir l'ecran (le champ recherche a l'autofocus).
  2. Saisir `ada` dans le champ de placeholder `Search people`.
  3. Attendre ~300 ms (debounce 250 ms + reseau).
- **Resultat attendu** : appel `searchService.users('ada', 20)` (`GET /search?q=ada&type=users&limit=20`) ; la liste affiche une cellule avec le nom `Ada Lovelace` et `@ada` ; chaque ligne a une icone `radio-button-unchecked`.
- **Critere d'acceptation (OK/KO)** : OK si la cellule `Ada Lovelace` (`getByLabelText('Ada Lovelace')`) et le texte `@ada` apparaissent apres saisie ; KO si rien ne s'affiche malgre un hit serveur.
- **Donnees de test** : requete `ada` ; reponse `{ data: { users: [{ id: 'u1', username: 'ada', displayName: 'Ada Lovelace', avatarUrl: null, bio: null, isOnline: true }] } }`.
- **Duree estimee** : 3 min

### MSG-NEW-005 - Recherche : aucun resultat, multi-frappe rapide et perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; requete sans correspondance ; puis bascule hors-ligne en cours de saisie.
- **Etapes** :
  1. Saisir `zzz` (aucun utilisateur correspondant) ; attendre la fin de la recherche.
  2. Effacer puis re-saisir tres vite plusieurs lettres differentes (`a`, `ab`, `abc`, retour arriere) pour stresser le debounce.
  3. Couper le reseau (mode avion) puis saisir `bob`.
  4. Retablir le reseau et re-saisir `bob`.
- **Resultat attendu** :
  - Etape 1 : `EmptyState` `messages.noResults` ("No one found") + `messages.noResultsHint`.
  - Etape 2 : une seule requete effective par valeur stabilisee (le debounce annule les precedentes via `cancelled`) ; aucune cellule fantome ni resultat d'une frappe obsolete.
  - Etape 3 : la recherche echoue silencieusement, `searching` repasse a false, la liste retombe sur l'etat "aucun resultat" (pas de crash, pas de spinner bloque).
  - Etape 4 : la recherche reussit a nouveau et affiche les hits.
- **Critere d'acceptation (OK/KO)** : OK si aucune requete obsolete ne pollue l'affichage, aucun spinner bloque hors-ligne, et la recherche se retablit apres reconnexion ; KO si l'UI reste bloquee "en chargement" ou affiche un resultat perime.
- **Donnees de test** : requetes `zzz`, `a`/`ab`/`abc`, `bob` ; serveur renvoyant `[]` pour `zzz`.
- **Duree estimee** : 6 min

### MSG-NEW-006 - Accessibilite du champ de recherche (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police systeme au maximum, contraste eleve.
- **Etapes** :
  1. Ouvrir l'ecran ; verifier l'autofocus du champ et l'ouverture du clavier.
  2. Avec le lecteur d'ecran, focaliser le champ et ecouter l'annonce.
  3. Saisir `ada`, verifier que le texte saisi reste lisible (non tronque) a la police agrandie.
- **Resultat attendu** : le champ est annonce comme champ de saisie avec le placeholder `Search people` ; l'icone loupe (`search`) ne capte pas le focus tactile (decoratif) ; le texte saisi reste visible a grande police ; le contraste du placeholder (`#c2c6d7`) reste suffisant sur le fond surface.
- **Critere d'acceptation (OK/KO)** : OK si le champ est focusable, correctement annonce et utilisable a la police max ; KO si le placeholder est illisible ou le champ non annonce.
- **Donnees de test** : requete `ada`.
- **Duree estimee** : 4 min

### MSG-NEW-007 - Cocher une personne fait apparaitre la barre d'action

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, recherche ayant retourne au moins une personne (`Ada Lovelace`).
- **Etapes** :
  1. Rechercher `ada` et attendre la cellule `Ada Lovelace`.
  2. Taper sur la ligne (`getByLabelText('Ada Lovelace')`).
- **Resultat attendu** : l'icone passe de `radio-button-unchecked` a `check-circle` (couleur `colors.primary`) ; `accessibilityState.checked = true` ; la barre d'action basse apparait avec le bouton libelle `Message`.
- **Critere d'acceptation (OK/KO)** : OK si la ligne passe a l'etat coche et que le bouton `Message` devient visible ; KO sinon.
- **Donnees de test** : hit `{ id: 'u1', username: 'ada', displayName: 'Ada Lovelace' }`.
- **Duree estimee** : 2 min

### MSG-NEW-008 - Toggle rapide coche/decoche et selection multiple stable

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, recherche retournant >= 2 personnes (`Ada Lovelace`, `Grace Hopper`).
- **Etapes** :
  1. Rechercher `a`, attendre les deux cellules.
  2. Taper tres vite 6 fois sur `Ada Lovelace` (toggle on/off/on/off/on/off).
  3. Taper une fois sur `Grace Hopper`.
  4. Taper une fois de plus sur `Ada Lovelace`.
- **Resultat attendu** : l'etat final est deterministe (apres 6 taps Ada est decochee, puis re-cochee a l'etape 4) ; la `Map selected` reste coherente (pas de doublon ni d'etat fige) ; le libelle du CTA reflete le compte exact (`Create group · 2` quand Ada + Grace sont cochees, `Message` si une seule). Aucun crash.
- **Critere d'acceptation (OK/KO)** : OK si le compteur du CTA correspond exactement au nombre de cases cochees visibles apres la rafale de taps ; KO si desynchronisation compteur/cases.
- **Donnees de test** : hits `u1` (`ada`/Ada Lovelace), `u2` (`grace`/Grace Hopper).
- **Duree estimee** : 4 min

### MSG-NEW-009 - Accessibilite des cellules personne (case a cocher annoncee)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police au maximum, contraste eleve, recherche retournant `Ada Lovelace`.
- **Etapes** :
  1. Rechercher `ada`.
  2. Avec le lecteur d'ecran, focaliser la cellule `Ada Lovelace` et ecouter l'annonce (etat non coche).
  3. Double-taper pour cocher, ecouter la nouvelle annonce.
- **Resultat attendu** : la cellule est annoncee comme case a cocher avec le libelle `Ada Lovelace` et l'etat `non coche` ; apres double-tap, annonce `coche` (`accessibilityState.checked = true`) ; le nom et `@ada` restent lisibles a la police max (chaque champ est `numberOfLines={1}` : verifier la troncature propre par "..." sans chevauchement).
- **Critere d'acceptation (OK/KO)** : OK si l'element est annonce comme `case a cocher` avec le bon libelle et que l'etat coche/decoche est restitue vocalement ; KO si annonce comme simple bouton sans etat ou libelle vide.
- **Donnees de test** : hit `Ada Lovelace` / `@ada`.
- **Duree estimee** : 4 min

### MSG-NEW-010 - Selection/deselection synchro multi-appareil (information temps-reel indirecte)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux appareils connectes avec le meme compte `standard` (ou un compte + un observateur du destinataire). Wi-Fi.
- **Etapes** :
  1. Sur l'appareil A, ouvrir Nouveau message et cocher `Ada Lovelace` puis `Grace Hopper`.
  2. Ne pas encore valider ; observer qu'aucun evenement n'est emis vers le serveur a la simple selection (la selection est purement locale, pas de WebSocket).
- **Resultat attendu** : aucune ecriture serveur ni evenement temps-reel n'est emis tant que le CTA n'est pas presse ; la selection reste locale a l'appareil A (pas de propagation a B). Ceci confirme que la phase de selection est offline-safe et sans effet de bord reseau.
- **Critere d'acceptation (OK/KO)** : OK si l'inspecteur reseau ne montre aucun `POST /groups` ni trame WebSocket pendant la seule selection ; KO si une requete part avant l'appui sur le CTA.
- **Donnees de test** : hits `u1`, `u2`.
- **Duree estimee** : 4 min

### MSG-NEW-011 - Demarrer un fil 1:1 avec une seule personne selectionnee

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, exactement une personne cochee (`Ada Lovelace`, id `u1`).
- **Etapes** :
  1. Rechercher `ada`, cocher `Ada Lovelace`.
  2. Taper sur le bouton libelle `Message`.
- **Resultat attendu** : `navigation.replace('ChatDetail', { conversationId: 'u1' })` (l'id de conversation 1:1 = l'id du pair). Aucun appel `POST /groups`. Le bouton Retour de ChatDetail ramene a la liste de conversations (replace, pas push).
- **Critere d'acceptation (OK/KO)** : OK si l'on ouvre `ChatDetail` avec `conversationId = u1` et que ce selecteur ne reste pas dans la pile ; KO sinon.
- **Donnees de test** : selection `[u1]`.
- **Duree estimee** : 2 min

### MSG-NEW-012 - Creer un groupe avec deux personnes ou plus

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, deux personnes cochees (`u1`, `u2`).
- **Etapes** :
  1. Rechercher `a`, cocher `Ada Lovelace` puis `Grace Hopper`.
  2. Verifier le libelle du CTA `Create group · 2`.
  3. Taper sur le CTA.
- **Resultat attendu** : `createGroup.mutate({ memberIds: ['u1', 'u2'] })` -> `POST /groups { memberIds: ['u1','u2'] }` ; pendant la requete le bouton est en `loading` (spinner) et `disabled` ; au succes, `navigation.replace('GroupChat', { conversationId: group.id })` et invalidation de `groupKeys.list()` (le groupe apparait dans la liste de conversations).
- **Critere d'acceptation (OK/KO)** : OK si un seul `POST /groups` part avec exactement `memberIds: ['u1','u2']` et que l'on ouvre `GroupChat` avec l'id renvoye ; KO sinon.
- **Donnees de test** : selection `[u1, u2]` ; reponse groupe `{ data: { id: 'g_77', title: null, ownerId: 'me', members: [...], lastMessage: null, unreadCount: 0, updatedAt: '...' } }`.
- **Duree estimee** : 3 min

### MSG-NEW-013 - CTA : multi-clic rapide, echec reseau et reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte, latence elevee puis coupure reseau, deux personnes cochees (`u1`, `u2`).
- **Etapes** :
  1. Avec deux personnes cochees, taper 4 fois tres vite sur le CTA `Create group · 2`.
  2. Couper le reseau (mode avion) avant que la requete aboutisse, observer le resultat.
  3. Re-taper le CTA hors-ligne.
  4. Retablir le reseau, re-taper le CTA.
- **Resultat attendu** :
  - Etape 1 : pendant `isPending`, le bouton passe `disabled`/`loading` -> les taps suivants sont ignores (un seul `POST /groups`).
  - Etape 2/3 : a l'echec de creation, `onError` declenche `Alert.alert(t('messages.groupError', 'Impossible de créer le groupe. Réessaie.'))` ; on reste sur l'ecran de selection, la selection est preservee, le bouton redevient actif.
  - Etape 4 : une nouvelle tentative reussit et ouvre `GroupChat`.
- **Critere d'acceptation (OK/KO)** : OK si au plus une requete part par appui effectif, l'alerte `messages.groupError` s'affiche en cas d'echec, et la creation reussit apres reconnexion sans perdre la selection ; KO si doublon de groupe, blocage en loading, ou absence d'alerte.
- **Donnees de test** : selection `[u1, u2]` ; serveur renvoyant 500 / timeout en echec.
- **Duree estimee** : 6 min

### MSG-NEW-014 - Accessibilite du CTA Demarrer (lecteur d'ecran + etat busy + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police au maximum, contraste eleve, une personne cochee.
- **Etapes** :
  1. Cocher `Ada Lovelace` (libelle CTA `Message`).
  2. Focaliser le CTA avec le lecteur d'ecran, ecouter l'annonce.
  3. Cocher une 2e personne ; verifier l'annonce du libelle mis a jour (`Create group · 2`).
  4. Activer la creation et ecouter l'annonce d'etat pendant le chargement.
- **Resultat attendu** : le CTA est annonce comme `bouton` avec le libelle courant (`Message` puis `Create group · 2`) ; pendant la creation, `accessibilityState.busy = true` (spinner) et le bouton est annonce occupe/desactive ; le libelle reste lisible et non tronque a la police max (`numberOfLines={1}` -> verifier troncature propre) ; contraste du texte primaire suffisant.
- **Critere d'acceptation (OK/KO)** : OK si le libelle vocal suit le compte de selection et l'etat busy est restitue ; KO si l'annonce ne reflete pas le nombre selectionne ou ne signale pas l'etat de chargement.
- **Donnees de test** : selection `[u1]` puis `[u1, u2]`.
- **Duree estimee** : 4 min

### MSG-NEW-015 - Creation de groupe : reception temps-reel chez les membres invites

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 3 comptes connectes sur 3 appareils : createur (`me`), `u1` (Ada), `u2` (Grace). Wi-Fi sur les trois. Liste de conversations ouverte sur les appareils de Ada et Grace.
- **Etapes** :
  1. Sur l'appareil createur, cocher Ada et Grace et taper `Create group · 2`.
  2. Le createur atterrit sur `GroupChat`.
  3. Observer la liste de conversations des appareils de Ada et Grace.
- **Resultat attendu** : le groupe est cree cote serveur (`POST /groups`) ; le createur ouvre `GroupChat` ; le nouveau groupe apparait dans la liste de conversations des membres invites (via push / rafraichissement de leur liste de groupes) ; tous les membres voient le meme `conversationId`.
- **Critere d'acceptation (OK/KO)** : OK si les 3 appareils referencent le meme groupe (meme id) et que les invites voient la nouvelle conversation sans recharger manuellement (dans un delai raisonnable) ; KO si un invite ne recoit jamais le groupe ou voit un id different.
- **Donnees de test** : membres `[u1, u2]` ; groupe renvoye `id: 'g_77'`.
- **Duree estimee** : 6 min

### MSG-NEW-016 - Ecran d'invite avant saisie et etat de recherche vide

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte, Wi-Fi, ecran fraichement ouvert (champ vide).
- **Etapes** :
  1. Ouvrir l'ecran sans rien saisir.
  2. Observer la zone de liste.
  3. Saisir puis tout effacer.
- **Resultat attendu** : avec le champ vide, l'`EmptyState` d'invite s'affiche (titre `messages.newMessageTitle`, description `messages.searchGroupHint`) ; apres effacement complet, on revient a cet etat d'invite (la liste de resultats est videe) ; aucune barre d'action tant qu'aucune selection.
- **Critere d'acceptation (OK/KO)** : OK si l'invite `searchGroupHint` s'affiche champ vide et reapparait apres effacement ; KO si un etat "aucun resultat" s'affiche alors que le champ est vide.
- **Donnees de test** : aucune (champ vide).
- **Duree estimee** : 2 min

## Recapitulatif

- Elements interactifs : 4 (Retour, champ recherche, cellule personne, CTA Demarrer).
- Cas de test : 16 (MSG-NEW-001 a MSG-NEW-016).
- Couverture par bouton : Retour (001-003), champ recherche (004-006 + 016), cellule personne (007-010), CTA Demarrer (011-015). Chaque bouton a >= 3 cas (positif / erreur-limite / accessibilite) ; les boutons a impact temps-reel indirect (cellule, CTA) ont un cas multi-utilisateur dedie (010, 015).
