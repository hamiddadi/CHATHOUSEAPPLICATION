# 44 - Inviter dans la room (`rooms`)

## Contexte ecran

- **Route** : `InviteToRoom` (pile `RoomStack`, `RoomStackParamList`). Parametre obligatoire : `roomId` (`route.params.roomId`, ex. `r1`). Sans `roomId` valide, l'envoi cible une room inexistante (erreur backend).
- **Composant** : `src/features/rooms/screens/InviteToRoomScreen/InviteToRoomScreen.tsx` (aucun partial ; tout est inline dans l'ecran).
- **Roles requis** : `standard` et `admin`. L'ecran est atteint depuis une room ; l'invite suppose un compte authentifie. Un `guest` ne devrait pas y acceder (pas de session). La permission reelle d'inviter (host/moderateur vs participant) est arbitree cote backend `POST /rooms/{roomId}/invite`.
- **Comportements temps-reel** :
  - L'action **Envoyer** appelle `useInviteToRoom` -> `roomService.invite(roomId, userIds)` -> `POST /rooms/{roomId}/invite` avec body `{ userIds: [...] }`, reponse `{ invitedCount }`. Ce n'est PAS un appel WebSocket/LiveKit direct : c'est une requete REST qui, cote serveur, declenche des **push notifications** (et/ou un evenement temps-reel d'invitation) vers chaque utilisateur invite. Du point de vue QA, c'est l'unique action « temps-reel/diffusion » de l'ecran (impact multi-utilisateur observable cote invite).
  - La recherche (`searchService.users(q, 20)`) est REST debouncee (250 ms) ; non temps-reel.
- **Pre-conditions globales** : reseau requis pour la recherche et l'envoi ; aucune permission micro/localisation/stockage necessaire ; permission **notifications** pertinente uniquement cote destinataire (pour recevoir le push d'invitation).
- **Etats de donnees pertinents** :
  - **Liste vide / initial** : `debounced.length === 0` -> `EmptyState` « Cherchez quelqu'un » (`rooms.invite.emptyTitle`).
  - **Aucun resultat** : requete non vide sans hit -> `EmptyState` « Aucun resultat » (`rooms.invite.noResultsTitle`).
  - **Recherche en cours** : `searching && results.length === 0` -> `Loader` plein ecran (`rooms.invite.searchingA11y`).
  - **Selection** : compteur `rooms.invite.selectedCount` affiche `{{count}} selectionne(s) · max {{max}}` (max = `MAX_INVITEES` = 50). Au-dela de 50, le toggle ignore l'ajout (cap silencieux).
  - **Hors-ligne** : la recherche echoue silencieusement (resultats vides) ; l'envoi remonte une `Alert` d'erreur via `errorMessage`.
- **Constantes** : `SEARCH_DEBOUNCE_MS = 250`, `MAX_INVITEES = 50`.

## Matrice bouton

| #   | Bouton                           | Emplacement                     | Type                     | Locator reel                                                                                                                               | Pre-condition                    | Priorite |
| --- | -------------------------------- | ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------- |
| 1   | Fermer                           | Header (haut droite)            | navigation               | `accessibilityLabel` = `t('rooms.invite.closeA11y', 'Fermer')` ; `accessibilityRole="button"` ; icone `MaterialIcons name="close"`         | Ecran ouvert                     | P1       |
| 2   | Champ de recherche               | Header (sous le titre)          | input-submit             | `placeholder` = `t('rooms.invite.searchPlaceholder', 'Rechercher des utilisateurs')`                                                       | Reseau pour resultats            | P1       |
| 3   | Cellule candidat / case a cocher | Corps (FlatList)                | list-item / toggle       | `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}` ; texte visible `displayName` / `@username`                            | Au moins 1 resultat de recherche | P1       |
| 4   | Envoyer                          | Barre d'action basse (CTA fixe) | submit / realtime-action | `label` = `t('rooms.invite.btnIdle', 'Sélectionnez des invités')` (idle) puis `t('rooms.invite.btnActive', 'Envoyer ({{count}})')` (actif) | >= 1 invite selectionne ; reseau | P0       |

> Note : aucun FAB, swipe, long-press ni pull-to-refresh sur cet ecran. Les `EmptyState` (« Cherchez quelqu'un », « Aucun resultat ») et le `Loader` ne sont pas interactifs. Le seul element a impact multi-utilisateur/diffusion est le bouton **Envoyer** (push d'invitation cote destinataires).

## Cas de test

### ROOM-INVITE-001 - Fermer revient a l'ecran precedent

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, ecran `InviteToRoom` ouvert depuis une room (`roomId=r1`), aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'ecran « Inviter ».
  2. Taper l'icone Fermer (locator `Fermer`) en haut a droite.
- **Resultat attendu** : `navigation.goBack()` est appele ; retour a l'ecran d'origine (detail room) sans envoi d'invitation.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent reapparait et aucun appel `POST /rooms/r1/invite` n'est emis ; KO sinon.
- **Donnees de test** : `routeParams = { roomId: 'r1' }`.
- **Duree estimee** : 2 min

### ROOM-INVITE-002 - Multi-tap rapide sur Fermer + retour pendant une frappe

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau en latence (3G simulee), ecran ouvert.
- **Etapes** :
  1. Saisir un debut de requete (ex. « ja ») dans le champ de recherche.
  2. Avant la fin du debounce (250 ms), taper l'icone Fermer 5 fois tres rapidement.
- **Resultat attendu** : un seul retour navigation (pas d'empilement de `goBack`), aucune erreur, la recherche en vol est annulee proprement (`cancelled = true`), aucune `Alert` ne s'affiche.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient une seule fois sans crash ni double navigation ; KO si l'ecran clignote ou double-pop.
- **Donnees de test** : requete `ja`, latence reseau ~1500 ms.
- **Duree estimee** : 3 min

### ROOM-INVITE-003 - Accessibilite du bouton Fermer (TalkBack/VoiceOver + police XXL + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, lecteur d'ecran actif (TalkBack Android / VoiceOver iOS), taille de police systeme reglee au maximum, mode contraste eleve.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'au controle Fermer en haut a droite.
  3. Verifier l'annonce vocale et la zone tactile.
  4. Double-taper pour activer.
- **Resultat attendu** : annonce « Fermer, bouton » (libelle `rooms.invite.closeA11y`, role `button`) ; cible atteignable malgre `hitSlop=8` ; l'activation declenche le retour ; icone `close` reste visible en contraste eleve et police agrandie (icone non deformee).
- **Critere d'acceptation (OK/KO)** : OK si le libelle « Fermer » + role bouton sont annonces et l'action fonctionne ; KO si annonce « bouton sans libelle » ou cible introuvable.
- **Donnees de test** : police 200%, contraste eleve ON.
- **Duree estimee** : 4 min

### ROOM-INVITE-004 - Recherche d'utilisateurs et affichage des resultats

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins un utilisateur correspondant existe (`Jane Doe` / `@jdoe`).
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Saisir « jane » dans le champ (locator placeholder `Rechercher des utilisateurs`).
  3. Attendre la fin du debounce (250 ms) puis le retour reseau.
- **Resultat attendu** : `searchService.users` est appele avec `('jane', 20)` ; la cellule « Jane Doe » + « @jdoe » s'affiche dans la FlatList avec avatar et case a cocher vide.
- **Critere d'acceptation (OK/KO)** : OK si la cellule du candidat apparait avec son `displayName`/`username` ; KO si rien ne s'affiche alors que l'API renvoie un hit.
- **Donnees de test** : requete `jane` ; hit `{ id:'u1', username:'jdoe', displayName:'Jane Doe', avatarUrl:null }`.
- **Duree estimee** : 3 min

### ROOM-INVITE-005 - Recherche frappe rapide / annulation + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau coupe (mode avion) puis retabli, ecran ouvert.
- **Etapes** :
  1. Taper plusieurs requetes successives tres vite : « j », « ja », « jan », « jane » (sous 250 ms chacune).
  2. Couper le reseau (mode avion) juste avant la resolution.
  3. Effacer entierement le champ (chaine vide).
  4. Retablir le reseau et resaisir « jane ».
- **Resultat attendu** : un seul appel reseau effectif (debounce) pour la derniere requete ; les requetes precedentes sont annulees (`cancelled`) sans melange de resultats ; hors-ligne la liste reste vide (echec silencieux, aucun crash) ; champ vide -> `EmptyState` « Cherchez quelqu'un » ; apres reconnexion la recherche « jane » re-fonctionne.
- **Critere d'acceptation (OK/KO)** : OK si aucun resultat obsolete n'est affiche et aucune exception non geree ; KO si les resultats d'une ancienne requete remplacent ceux de la derniere.
- **Donnees de test** : requetes `j`/`ja`/`jan`/`jane`.
- **Duree estimee** : 4 min

### ROOM-INVITE-006 - Etat « Aucun resultat » sur requete non vide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi, aucune correspondance pour la requete.
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Saisir « zzzz » dans le champ de recherche.
  3. Attendre la resolution.
- **Resultat attendu** : `EmptyState` « Aucun resultat » (`rooms.invite.noResultsTitle`) affiche ; le `Loader` disparait ; le compteur de selection n'apparait pas.
- **Critere d'acceptation (OK/KO)** : OK si le titre « Aucun resultat » s'affiche ; KO si l'etat initial « Cherchez quelqu'un » reste affiche ou si le loader tourne indefiniment.
- **Donnees de test** : requete `zzzz`, reponse API `[]`.
- **Duree estimee** : 2 min

### ROOM-INVITE-007 - Accessibilite du champ de recherche (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police systeme au maximum, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Naviguer jusqu'au champ de recherche (placeholder `Rechercher des utilisateurs`).
  3. Verifier l'annonce du champ et de l'icone loupe (decorative).
  4. Saisir « jane » au clavier logiciel.
- **Resultat attendu** : champ annonce comme zone de saisie editable ; le placeholder est lisible et non tronque a 200% (passe a la ligne / reste accessible) ; l'icone `search` (adornment gauche) n'intercepte pas le focus utile ; `autoCapitalize='none'` et `autoCorrect=false` actifs.
- **Critere d'acceptation (OK/KO)** : OK si la saisie est possible et annoncee, sans recouvrement de l'icone ; KO si le champ n'est pas focusable ou si le texte est coupe.
- **Donnees de test** : requete `jane`, police 200%.
- **Duree estimee** : 4 min

### ROOM-INVITE-008 - Selection/deselection d'un candidat

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, recherche renvoyant >= 1 candidat (`Jane Doe`).
- **Etapes** :
  1. Rechercher « jane » et attendre la cellule.
  2. Taper la cellule (locator role `checkbox`).
  3. Verifier l'etat coche (icone `check`) et le compteur.
  4. Re-taper la meme cellule.
- **Resultat attendu** : 1er tap -> case cochee (`accessibilityState.checked = true`), icone check visible, compteur « 1 selectionne(s) · max 50 » (`rooms.invite.selectedCount`), libelle CTA passe a « Envoyer (1) ». 2e tap -> case decochee, compteur masque, CTA repasse a « Selectionnez des invites » et redevient disabled.
- **Critere d'acceptation (OK/KO)** : OK si le toggle bascule l'etat checked et synchronise compteur + CTA ; KO si l'etat ou le compteur se desynchronise.
- **Donnees de test** : candidat `u1` (Jane Doe).
- **Duree estimee** : 3 min

### ROOM-INVITE-009 - Plafond MAX_INVITEES (50) et taps repetes

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi, recherche renvoyant > 50 candidats distincts.
- **Etapes** :
  1. Rechercher un terme large renvoyant beaucoup d'utilisateurs.
  2. Cocher 50 candidats.
  3. Tenter de cocher un 51e candidat (et marteler le tap dessus).
  4. Decocher un candidat puis recocher le 51e.
- **Resultat attendu** : compteur affiche « 50 selectionne(s) · max 50 » ; le 51e candidat ne se coche pas (cap silencieux `prev.length >= MAX_INVITEES` -> retourne `prev`) ; aucun crash ni doublon ; apres deselection, l'ajout redevient possible.
- **Critere d'acceptation (OK/KO)** : OK si la selection est plafonnee a 50 et que les taps au-dela sont ignores sans effet de bord ; KO si > 50 sont selectionnes.
- **Donnees de test** : requete large (ex. « a »), 51 candidats `u1..u51`.
- **Duree estimee** : 5 min

### ROOM-INVITE-010 - Accessibilite de la cellule candidat (etat coche annonce)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police au maximum, contraste eleve.
- **Etapes** :
  1. Rechercher « jane » et attendre la cellule.
  2. Balayer jusqu'a la cellule candidat (role `checkbox`).
  3. Ecouter l'annonce (nom + etat coche/non coche).
  4. Double-taper pour cocher, re-ecouter.
- **Resultat attendu** : annonce « Jane Doe, @jdoe, case a cocher, non cochee » puis apres activation « cochee » (via `accessibilityState.checked`) ; nom et pseudo restent lisibles a 200% (deux lignes) ; la pastille check reste visible en contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si l'etat coche/non coche est vocalise et bascule correctement ; KO si la cellule est annoncee comme simple bouton sans etat ou si le texte est tronque.
- **Donnees de test** : candidat `Jane Doe` / `@jdoe`.
- **Duree estimee** : 4 min

### ROOM-INVITE-011 - Envoyer les invitations (chemin nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` (host/inviteur autorise), Wi-Fi, room `r1` existante, 1 candidat selectionne (`u1`).
- **Etapes** :
  1. Rechercher « jane », cocher la cellule de Jane Doe.
  2. Verifier que le CTA affiche « Envoyer (1) ».
  3. Taper le bouton Envoyer.
  4. Attendre la reponse.
- **Resultat attendu** : `invite.mutate({ roomId:'r1', userIds:['u1'] }, ...)` declenche `POST /rooms/r1/invite` body `{ userIds:['u1'] }` ; au succes, `Alert` « Invitations envoyees » / « 1 personne(s) notifiee(s) » (`rooms.invite.successTitle` / `successBody` avec `count=invitedCount`) ; apres l'alerte, `navigation.goBack()`.
- **Critere d'acceptation (OK/KO)** : OK si la requete part avec le bon payload, l'alerte succes s'affiche avec le bon `count` et l'ecran se ferme ; KO sinon.
- **Donnees de test** : `roomId='r1'`, `userIds=['u1']`, reponse `{ invitedCount: 1 }`.
- **Duree estimee** : 3 min

### ROOM-INVITE-012 - Envoyer : multi-clic rapide + perte reseau + reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, reseau coupe puis retabli (mode avion), room `r1`, 2 candidats selectionnes.
- **Etapes** :
  1. Selectionner 2 candidats (CTA « Envoyer (2) »).
  2. Couper le reseau (mode avion).
  3. Taper Envoyer 5 fois tres vite.
  4. Observer l'etat du bouton et l'alerte.
  5. Retablir le reseau et retaper Envoyer une fois.
- **Resultat attendu** : pendant l'envoi le bouton passe en `loading` et `disabled` (`invite.isPending`), empechant les soumissions multiples (1 seul `POST` par sequence) ; hors-ligne -> `Alert` « Erreur » avec message issu de `errorMessage(e)` (`rooms.invite.errorBody` en fallback « Echec ») ; le bouton se reactive apres l'erreur ; apres reconnexion, le re-tap envoie correctement et affiche l'alerte succes.
- **Critere d'acceptation (OK/KO)** : OK si au plus une requete par tentative (pas de rafale) et l'erreur reseau est notifiee sans crash ; KO si plusieurs `POST` partent ou si l'app fige/plante.
- **Donnees de test** : `roomId='r1'`, `userIds=['u1','u2']`.
- **Duree estimee** : 5 min

### ROOM-INVITE-013 - Envoyer desactive sans selection

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, aucune selection.
- **Etapes** :
  1. Ouvrir l'ecran (aucun candidat coche).
  2. Observer le CTA.
  3. Tenter de taper le bouton.
- **Resultat attendu** : le bouton affiche « Selectionnez des invites » (`rooms.invite.btnIdle`), est `disabled` (`selected.length === 0`) ; le tap n'a aucun effet (`handleSend` retourne immediatement, aucun `mutate`).
- **Critere d'acceptation (OK/KO)** : OK si aucun `POST /rooms/r1/invite` n'est emis tant que la selection est vide ; KO si une requete part avec `userIds=[]`.
- **Donnees de test** : selection vide.
- **Duree estimee** : 2 min

### ROOM-INVITE-014 - Accessibilite du bouton Envoyer (etat disabled/loading + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police maximale, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Sans selection, balayer jusqu'au CTA et ecouter.
  3. Cocher un candidat, re-ecouter le CTA.
  4. Activer Envoyer et observer l'etat loading.
- **Resultat attendu** : sans selection, annonce « Selectionnez des invites, bouton, desactive » ; avec selection, « Envoyer (1), bouton » actif ; libelle non tronque a 200% ; pendant l'envoi, etat loading annonce/visible et bouton non re-activable ; contraste suffisant du bouton primaire.
- **Critere d'acceptation (OK/KO)** : OK si l'etat disabled puis le libelle dynamique sont correctement vocalises et le bouton reste lisible a grande police ; KO si l'etat disabled n'est pas annonce ou le libelle deborde.
- **Donnees de test** : 0 puis 1 selection, police 200%.
- **Duree estimee** : 4 min

### ROOM-INVITE-015 - Temps-reel multi-utilisateur : reception du push d'invitation

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes (A = inviteur `standard` dans room `r1`, B = invite `standard` connecte sur un autre device avec permission **notifications** accordee), Wi-Fi sur les deux. B n'est pas deja dans la room.
- **Etapes** :
  1. Device A : rechercher et selectionner l'utilisateur B, taper Envoyer.
  2. Device A : observer l'alerte succes et le retour.
  3. Device B : observer la reception (push notification d'invitation et/ou entree d'invitation en app).
  4. Device B : ouvrir/accepter l'invitation pour rejoindre `r1`.
- **Resultat attendu** : A recoit « Invitations envoyees / 1 personne(s) notifiee(s) » ; B recoit un push « invitation a rejoindre la room » dans un delai court ; en suivant l'invitation, B atteint la room `r1` ; `invitedCount` cote A correspond au nombre reel de destinataires notifies.
- **Critere d'acceptation (OK/KO)** : OK si B recoit l'invitation et peut rejoindre `r1`, et `invitedCount` reflete les invites valides ; KO si B ne recoit rien ou si le compteur est faux.
- **Donnees de test** : A=`standard` host de `r1`, B=`u2` invite ; `roomId='r1'`.
- **Duree estimee** : 6 min

### ROOM-INVITE-016 - Temps-reel multi-utilisateur : invite deja membre / non invitable

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 comptes ; B est DEJA participant de la room `r1` (ou a bloque A / a desactive les invitations), Wi-Fi.
- **Etapes** :
  1. Device A : selectionner B (deja membre) plus un utilisateur C invitable.
  2. Taper Envoyer (2 selectionnes).
  3. Observer le `invitedCount` retourne.
  4. Device B : verifier l'absence de push en double ; Device C : verifier la reception.
- **Resultat attendu** : le backend ignore/dedup B (deja present) ; `invitedCount` reflete seulement les invites reellement notifies (ex. 1 pour C) ; l'alerte succes affiche ce compte ; B ne recoit pas de notification redondante ; C recoit l'invitation.
- **Critere d'acceptation (OK/KO)** : OK si `invitedCount` exclut les destinataires non notifiables et C est invite ; KO si B est notifie en double ou `invitedCount` surcompte.
- **Donnees de test** : `userIds=['B_id','C_id']`, reponse attendue `{ invitedCount: 1 }`.
- **Duree estimee** : 5 min
