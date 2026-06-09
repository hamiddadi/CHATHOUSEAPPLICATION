# 25 - Ajouter des membres au groupe (`messages`)

## Contexte ecran

- **Route** : `AddGroupMembers` dans `MessagesNavigator` (stack natif). Deep link : `group/:conversationId/add` (cf. `src/core/navigation/linking.ts`). Parametre obligatoire : `route.params.conversationId`.
- **Fichier** : `src/features/messages/screens/AddGroupMembersScreen/AddGroupMembersScreen.tsx` (aucun partial — ecran monobloc).
- **Roles requis** : `standard` et `admin` (utilisateur authentifie, membre du groupe). Un `guest` ne peut pas atteindre cet ecran (pas de groupe, navigation messages indisponible).
- **But** : rechercher des utilisateurs et ajouter les selectionnes a une conversation de groupe existante (Backchannel groups).
- **Reseau / API** :
  - Recherche : `searchService.users(q, 20)` → `GET /search?q=&type=users&limit=20` (REST, debounce 250 ms, declenchee a chaque frappe une fois le debounce ecoule).
  - Detail groupe : `useGroup(conversationId)` → `GET /groups/:id` (pour filtrer les membres deja presents).
  - Ajout : `useAddGroupMembers().mutate({conversationId, userIds})` → `POST /groups/:id/members { userIds }` (REST). En cas de succes, `invalidateGroup` invalide `groups.detail(id)` + `groups.list()` (react-query) → les ecrans GroupInfo et MessagesScreen se rafraichissent.
- **Comportements temps-reel** : cet ecran n'ouvre PAS de WebSocket/LiveKit lui-meme. L'ajout est un POST REST. L'effet temps-reel est INDIRECT : apres succes, l'invalidation de cache rafraichit les autres surfaces ; les autres membres du groupe recoivent la mise a jour via le socket de conversation de groupe (`useGroupSocket`, ecoute par GroupChat/GroupInfo, pas par cet ecran). A tester en multi-utilisateur cote ecrans cibles.
- **Pre-conditions globales** : session valide ; `conversationId` valide et accessible ; au moins un compte de test cible recherchable.
- **Etats de donnees pertinents** :
  - Liste vide initiale : aucune recherche tapee (`debounced.length === 0`) → EmptyState « hint » (`messages.searchPeopleHint`).
  - Recherche en cours : `searching === true` → ListEmptyComponent rend `null` (pas de spinner visible, liste vide momentanee).
  - Aucun resultat : recherche non vide + 0 hit → EmptyState « No one found » (`messages.noResults`).
  - Membre deja present : cellule grisee (opacity 40), `disabled`, icone `check`, non selectionnable.
  - Selection > 0 : barre d'action basse avec bouton « Add N » apparait.
  - Hors-ligne : la recherche echoue silencieusement (resultats vides) ; l'ajout echoue → `Alert` `messages.addError`.

## Matrice bouton

| #   | Bouton                                   | Emplacement              | Type                       | Locator reel                                                                                           | Pre-condition                                    | Priorite                          |
| --- | ---------------------------------------- | ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------- | ------------------------------------------------------ | --- |
| 1   | Fermer / Retour                          | Header (gauche)          | navigation                 | `accessibilityLabel = t('common.close','Close')` (icone `arrow-back`)                                  | Ecran ouvert                                     | P1                                |
| 2   | Champ de recherche                       | Corps (sous header)      | input-submit               | `placeholder = t('messages.searchPeople','Search people')` (composant `Input`, `autoFocus`)            | Ecran ouvert                                     | P1                                |
| 3   | Cellule resultat (toggle selection)      | Corps / cellule de liste | list-item / toggle         | `accessibilityRole="checkbox"` + `accessibilityState={{checked,disabled}}` ; texte = `item.displayName |                                                  | item.username`(ex.`Ada Lovelace`) | Resultat de recherche affiche, membre non deja present | P0  |
| 4   | Cellule membre deja present (desactivee) | Corps / cellule de liste | list-item (disabled)       | `accessibilityRole="checkbox"` + `accessibilityState={{disabled:true}}` ; icone `check`                | Le hit est deja membre du groupe (`existingIds`) | P2                                |
| 5   | Ajouter N (Add N)                        | Barre d'action basse     | submit (realtime indirect) | `label = t('messages.addN',{count:N,defaultValue:'Add N'})` (composant `Button`, variant primary)      | `selectedCount > 0`                              | P0                                |

> Note : il n'y a ni pull-to-refresh, ni swipe, ni long-press, ni FAB, ni lien legal sur cet ecran. La barre « Add N » n'est montee dans l'arbre que lorsque `selectedCount > 0`.

## Cas de test

### MSG-ADDGRP-001 - Fermer l'ecran via le bouton retour

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie ; ecran ouvert depuis GroupInfo d'un groupe `conv-1` ; Wi-Fi ; aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'ecran « Add people » (Ajouter des membres) depuis l'ecran d'info du groupe.
  2. Taper sur l'icone retour en haut a gauche (locator `common.close`).
- **Resultat attendu** : `navigation.goBack()` est appele une fois ; retour a l'ecran GroupInfo precedent ; aucune mutation reseau declenchee.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est de nouveau affiche sans appel `POST /groups/:id/members`. KO sinon.
- **Donnees de test** : `routeParams = { conversationId: 'conv-1' }`.
- **Duree estimee** : 2 min

### MSG-ADDGRP-002 - Multi-clic rapide sur retour + retour pendant recherche en vol

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; reseau avec latence ajoutee (~2 s) ou bascule Wi-Fi→hors-ligne pendant une requete de recherche.
- **Etapes** :
  1. Ouvrir l'ecran, taper « ad » dans le champ de recherche.
  2. Avant la fin du debounce/reponse, appuyer 3 fois tres rapidement sur le bouton retour.
  3. Couper le reseau juste apres le 1er tap.
- **Resultat attendu** : un seul retour effectif (l'ecran est demonte au 1er tap, les taps suivants sont ignores) ; pas de crash ; la requete de recherche en vol est annulee proprement (effet de nettoyage `cancelled = true`) ; aucune fuite d'etat (pas de setState sur composant demonte).
- **Critere d'acceptation (OK/KO)** : OK si aucun warning « state update on unmounted component », aucune double navigation, aucun crash. KO sinon.
- **Donnees de test** : query partielle `'ad'` ; bascule reseau via mode avion.
- **Duree estimee** : 5 min

### MSG-ADDGRP-003 - Accessibilite du bouton retour (TalkBack/VoiceOver + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee sur le plus grand niveau ; mode contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police agrandie.
  2. Ouvrir l'ecran et naviguer au focus jusqu'au bouton retour.
  3. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : le lecteur annonce « Close / Fermer, bouton » (libelle `common.close`, role button) ; le `hitSlop=8` rend la cible facile a atteindre ; le double-tap declenche `goBack()` ; l'icone `arrow-back` reste lisible (contraste suffisant, couleur `colors.text`) ; le titre « Add people » ne deborde pas avec la police agrandie.
- **Critere d'acceptation (OK/KO)** : OK si le focus, l'annonce du libelle reel et l'activation fonctionnent, et le header reste lisible en grande police. KO sinon.
- **Donnees de test** : libelle attendu = traduction de `common.close`.
- **Duree estimee** : 4 min

### MSG-ADDGRP-004 - Recherche debouncee retourne un utilisateur

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; Wi-Fi ; un compte cible « Ada Lovelace » (@ada) existe et n'est pas deja membre.
- **Etapes** :
  1. Ouvrir l'ecran (le champ a `autoFocus`, le clavier s'ouvre).
  2. Saisir « ada » dans le champ (placeholder `messages.searchPeople`).
  3. Attendre ~250-300 ms (debounce).
- **Resultat attendu** : `searchService.users('ada', 20)` est appele (`GET /search?q=ada&type=users&limit=20`) ; la cellule « Ada Lovelace » + « @ada » s'affiche avec icone `radio-button-unchecked` ; l'EmptyState disparait.
- **Critere d'acceptation (OK/KO)** : OK si l'appel part avec exactement `('ada', 20)` et la cellule du hit apparait. KO sinon.
- **Donnees de test** : query `'ada'` ; hit attendu `{ id:'u1', username:'ada', displayName:'Ada Lovelace' }`.
- **Duree estimee** : 3 min

### MSG-ADDGRP-005 - Recherche sans resultat / frappe rapide + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; Wi-Fi puis coupure ; aucun compte correspondant a la requete.
- **Etapes** :
  1. Saisir tres vite « zzz » puis effacer puis re-saisir « zzz » (rafale de frappes) pour stresser le debounce.
  2. Laisser le debounce s'ecouler ; observer l'etat « searching » (liste momentanement vide, pas de spinner).
  3. Couper le reseau et taper « q » : la requete echoue.
- **Resultat attendu** : un seul appel reseau effectif par valeur stabilisee (debounce 250 ms) ; quand 0 hit → EmptyState « No one found » (`messages.noResults`) + « Try a different name or username. » (`messages.noResultsHint`) ; en cas d'echec reseau, pas de crash, resultats restent vides (echec silencieux), pas d'Alert (l'Alert n'apparait qu'a l'ajout).
- **Critere d'acceptation (OK/KO)** : OK si l'EmptyState « no results » s'affiche pour une requete sans hit et l'app ne plante pas hors-ligne. KO sinon.
- **Donnees de test** : query `'zzz'` (0 hit) ; query `'q'` hors-ligne.
- **Duree estimee** : 5 min

### MSG-ADDGRP-006 - Accessibilite du champ de recherche (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police systeme maximale ; contraste eleve.
- **Etapes** :
  1. Ouvrir l'ecran ; verifier que le focus initial atteint le champ (autoFocus) et que le clavier s'ouvre.
  2. Avec le lecteur, focaliser le champ et ecouter l'annonce (placeholder/role champ de texte).
  3. Dicter ou saisir « ma » et verifier la lisibilite des resultats en grande police.
- **Resultat attendu** : le placeholder reel `messages.searchPeople` (« Search people ») est annonce ; l'icone loupe (`leftAdornment` search) ne masque pas le texte ; les cellules resultats restent lisibles et tronquees proprement (`numberOfLines={1}`) sans chevauchement en grande police ; contraste texte/`text-ink-muted` suffisant.
- **Critere d'acceptation (OK/KO)** : OK si le champ est focusable, annonce, et la liste reste lisible en grande police/contraste. KO sinon.
- **Donnees de test** : query `'ma'`.
- **Duree estimee** : 4 min

### MSG-ADDGRP-007 - Selectionner un resultat fait apparaitre le bouton Ajouter

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; Wi-Fi ; hit « Ada Lovelace » affiche (cf. MSG-ADDGRP-004).
- **Etapes** :
  1. Rechercher « ada » et attendre la cellule.
  2. Taper sur la cellule « Ada Lovelace ».
- **Resultat attendu** : l'etat `accessibilityState.checked` passe a `true` ; l'icone devient `check-circle` en `colors.primary` ; `selectedCount` passe a 1 ; la barre d'action basse apparait avec le bouton « Add 1 » (`messages.addN` count=1).
- **Critere d'acceptation (OK/KO)** : OK si la cellule est cochee et le bouton « Add 1 » devient visible. KO sinon.
- **Donnees de test** : hit `u1` / « Ada Lovelace ».
- **Duree estimee** : 2 min

### MSG-ADDGRP-008 - Toggle selection : double-clic rapide rend la selection coherente

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; plusieurs hits affiches (ex. u1, u2, u3) ; reseau normal.
- **Etapes** :
  1. Taper rapidement 2 fois sur la meme cellule (select puis deselect).
  2. Taper rapidement (rafale) sur 3 cellules differentes d'affilee.
  3. Re-taper une cellule deja cochee pour la decocher.
- **Resultat attendu** : un double-tap sur la meme cellule la laisse NON selectionnee (la `Map` selected ajoute puis retire) ; le compteur du bouton reflete exactement le nombre de cellules cochees (« Add 2 », « Add 3 »...) ; aucune incoherence d'etat malgre les taps rapides (la mise a jour `setSelected(prev => ...)` est fonctionnelle, pas de course) ; quand le compteur retombe a 0, la barre d'action disparait.
- **Critere d'acceptation (OK/KO)** : OK si le compteur du bouton = nombre exact de cellules cochees apres la rafale, et la barre disparait a 0. KO sinon.
- **Donnees de test** : hits `u1,u2,u3` ; sequence taps : u1,u1,u2,u3,u2.
- **Duree estimee** : 4 min

### MSG-ADDGRP-009 - Accessibilite de la cellule resultat (checkbox annoncee, etat coche)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police maximale ; contraste eleve ; un hit non-membre affiche.
- **Etapes** :
  1. Activer le lecteur d'ecran, rechercher un utilisateur.
  2. Focaliser la cellule du resultat ; ecouter l'annonce de role et d'etat.
  3. Double-taper pour cocher ; re-ecouter l'etat.
- **Resultat attendu** : le lecteur annonce le role « case a cocher » (`accessibilityRole="checkbox"`), le nom (`displayName`/`@username`) et l'etat « non coche » puis « coche » apres activation (`accessibilityState.checked`) ; l'avatar + textes restent lisibles en grande police (`numberOfLines={1}` evite le debordement) ; le passage `radio-button-unchecked` → `check-circle` reste perceptible (couleur + role, pas couleur seule).
- **Critere d'acceptation (OK/KO)** : OK si role checkbox + nom + transition d'etat coche/non coche sont annonces. KO sinon.
- **Donnees de test** : hit « Ada Lovelace » / @ada.
- **Duree estimee** : 4 min

### MSG-ADDGRP-010 - Cellule d'un membre deja present : non selectionnable

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; `useGroup` renvoie un groupe dont `members` contient l'id du hit recherche ; le hit apparait aussi dans les resultats de recherche.
- **Etapes** :
  1. Rechercher un utilisateur qui est deja membre du groupe.
  2. Taper sur sa cellule.
- **Resultat attendu** : la cellule est grisee (opacity 40), `disabled=true`, affiche l'icone `check` (et non `radio-button-unchecked`) ; le tap n'a aucun effet (`!alreadyMember && toggle` court-circuite) ; `selectedCount` reste inchange ; aucune barre d'action n'apparait pour ce hit seul.
- **Critere d'acceptation (OK/KO)** : OK si le membre existant est visuellement desactive et non selectionnable. KO sinon.
- **Donnees de test** : `group.members = [{id:'u1',...}]` et hit `u1` dans les resultats.
- **Duree estimee** : 3 min

### MSG-ADDGRP-011 - Accessibilite cellule membre existant (etat disabled annonce)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; lecteur d'ecran actif ; groupe contenant le hit recherche ; police agrandie + contraste eleve.
- **Etapes** :
  1. Rechercher un utilisateur deja membre.
  2. Focaliser sa cellule avec le lecteur ; ecouter l'annonce.
  3. Tenter un double-tap d'activation.
- **Resultat attendu** : le lecteur annonce l'etat « desactive » (`accessibilityState.disabled=true`) ; l'activation est sans effet ; la cellule grisee (opacity 40) reste suffisamment lisible meme avec le contraste eleve ; l'icone `check` differencie clairement « deja membre » d'un element selectionnable.
- **Critere d'acceptation (OK/KO)** : OK si l'etat disabled est annonce et l'activation n'a aucun effet. KO sinon.
- **Donnees de test** : hit deja membre `u1`.
- **Duree estimee** : 3 min

### MSG-ADDGRP-012 - Ajouter les membres selectionnes (chemin nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard membre du groupe `conv-1` ; Wi-Fi ; au moins 1 utilisateur selectionne (ex. u1) ; backend repond 200.
- **Etapes** :
  1. Rechercher et selectionner « Ada Lovelace » (compteur = 1).
  2. Taper sur le bouton « Add 1 » (`messages.addN` count=1).
- **Resultat attendu** : `addMembers.mutate({conversationId:'conv-1', userIds:['u1']}, {onSuccess, onError})` est appele ; pendant l'attente le `Button` passe en `loading`/`disabled` ; au succes (`POST /groups/conv-1/members` 200) → `navigation.goBack()` ; l'invalidation `groups.detail(conv-1)` + `groups.list()` rafraichit GroupInfo et la liste des conversations (le nouveau membre y apparait).
- **Critere d'acceptation (OK/KO)** : OK si le POST part avec le bon payload, retour ecran precedent au succes, et GroupInfo affiche le nouveau membre apres rafraichissement. KO sinon.
- **Donnees de test** : payload `{ conversationId:'conv-1', userIds:['u1'] }`.
- **Duree estimee** : 3 min

### MSG-ADDGRP-013 - Ajout : multi-clic rapide + echec reseau + reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; 1+ membre selectionne ; reseau coupe au moment de l'ajout, puis retabli.
- **Etapes** :
  1. Selectionner 1 utilisateur ; couper le reseau (mode avion).
  2. Taper rapidement 3 fois sur « Add 1 ».
  3. Observer l'Alert d'erreur, fermer.
  4. Retablir le reseau, retaper « Add 1 ».
- **Resultat attendu** : pendant `addMembers.isPending`, le bouton est `disabled` → les taps rapides supplementaires ne relancent pas la mutation (un seul POST en vol) ; a l'echec → `Alert.alert(t('messages.addError',"Couldn't add members. Try again."))` ; PAS de `goBack()` (la selection est conservee) ; apres reconnexion, un nouveau tap relance la mutation et reussit puis `goBack()`.
- **Critere d'acceptation (OK/KO)** : OK si une seule requete part malgre les multi-taps, l'Alert s'affiche a l'echec sans quitter l'ecran, et le retry post-reconnexion reussit. KO sinon.
- **Donnees de test** : `messages.addError` ; payload `{conversationId:'conv-1', userIds:['u1']}`.
- **Duree estimee** : 6 min

### MSG-ADDGRP-014 - Ajout avec selection vide (garde-fou) + bouton absent

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; aucune cellule selectionnee.
- **Etapes** :
  1. Rechercher des utilisateurs mais ne rien selectionner.
  2. Verifier qu'aucun bouton « Add N » n'est rendu (barre d'action montee seulement si `selectedCount > 0`).
  3. (Cas blanc) selectionner puis deselectionner pour ramener le compteur a 0.
- **Resultat attendu** : tant que `selectedCount === 0`, la barre d'action et le bouton « Add » ne sont pas dans l'arbre ; meme si la mutation etait appelee avec une liste vide, la garde `if (userIds.length === 0) return;` empeche tout POST.
- **Critere d'acceptation (OK/KO)** : OK si aucun bouton « Add » n'est visible/actionnable a 0 selection et aucun POST ne peut partir. KO sinon.
- **Donnees de test** : selection vide.
- **Duree estimee** : 2 min

### MSG-ADDGRP-015 - Accessibilite du bouton Ajouter (libelle dynamique + loading)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; lecteur d'ecran actif ; police maximale ; contraste eleve ; 2 utilisateurs selectionnes.
- **Etapes** :
  1. Selectionner 2 utilisateurs (compteur = 2).
  2. Focaliser le bouton d'action avec le lecteur ; ecouter le libelle.
  3. Double-taper pour ajouter ; observer l'etat loading/disabled.
- **Resultat attendu** : le lecteur annonce le libelle reel pluralise « Add 2 » (`messages.addN` count=2, role button) ; en grande police le bouton `fullWidth` reste lisible sans troncature genante ; pendant `loading` le bouton est annonce desactive et n'est pas re-activable ; contraste du `Button` variant primary conforme.
- **Critere d'acceptation (OK/KO)** : OK si le libelle pluralise correct est annonce et l'etat loading/disabled est percu. KO sinon.
- **Donnees de test** : 2 hits selectionnes ; libelle `messages.addN` count=2.
- **Duree estimee** : 4 min

### MSG-ADDGRP-016 - Synchro multi-utilisateur : le nouveau membre voit le groupe (temps-reel indirect)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils — Appareil A = compte standard membre du groupe `conv-1` (sur cet ecran) ; Appareil B = compte cible « Bob » (@bob) non membre, connecte, avec MessagesScreen/GroupChat ouvert ; les deux en ligne (Wi-Fi) ; un 3e observateur C deja membre avec GroupInfo ouvert pour verifier la propagation socket.
- **Etapes** :
  1. Sur A : rechercher « bob », selectionner, taper « Add 1 ».
  2. Attendre la confirmation (A revient en arriere).
  3. Sur B : observer la liste des conversations / l'ecran de groupe.
  4. Sur C : observer la liste des membres dans GroupInfo (alimente par `useGroupSocket` / invalidation).
- **Resultat attendu** : sur A, `POST /groups/conv-1/members` reussit puis `goBack()` ; sur C (deja membre), la liste des membres se met a jour avec Bob (via socket de groupe + invalidation a la prochaine ouverture) ; sur B (Bob), le groupe `conv-1` apparait dans ses conversations et il peut y acceder ; aucun doublon de membre cote serveur.
- **Critere d'acceptation (OK/KO)** : OK si Bob est ajoute une seule fois, devient visible cote B, et la liste de membres de C reflete l'ajout sans rechargement manuel complet. KO sinon.
- **Donnees de test** : compte cible @bob ; payload `{conversationId:'conv-1', userIds:['bob-id']}`.
- **Duree estimee** : 8 min

### MSG-ADDGRP-017 - Synchro multi-utilisateur : deux admins ajoutent en parallele (anti-doublon)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 appareils admins/membres (A et B) du meme groupe `conv-1`, tous deux sur l'ecran « Add people » ; meme utilisateur cible « Carol » selectionne des deux cotes ; reseau normal.
- **Etapes** :
  1. Sur A et B : selectionner Carol simultanement.
  2. Taper « Add 1 » sur A puis, dans la seconde, sur B.
  3. Observer les reponses et l'etat final des membres dans GroupInfo des deux cotes.
- **Resultat attendu** : Carol n'est ajoutee qu'une fois (le backend deduplique l'appartenance) ; le 2e POST ne cree pas de doublon (renvoie le groupe a jour) ; apres invalidation, GroupInfo de A et B affiche Carol une seule fois ; aucune erreur bloquante cote UI (au pire un retour groupe identique).
- **Critere d'acceptation (OK/KO)** : OK si Carol figure exactement une fois cote serveur et dans les deux GroupInfo. KO si doublon ou crash.
- **Donnees de test** : compte cible @carol ; deux POST concurrents `{conversationId:'conv-1', userIds:['carol-id']}`.
- **Duree estimee** : 7 min
