# 23 - Inviter un membre (house) (`houses`)

## Contexte ecran

- **Route** : `InviteMember` dans le `RoomStackParamList` (stack de navigation natif). Param obligatoire : `{ houseId: string }` (lu via `route.params.houseId`). Ouvert typiquement depuis l'ecran de detail d'une house / club.
- **Fichier** : `src/features/houses/screens/InviteMemberScreen/InviteMemberScreen.tsx` (ecran monolithique, aucun partial).
- **Roles requis** : `standard` ou `admin` (un compte authentifie membre de la house, capable d'inviter). Un `guest` n'atteint pas cet ecran (pas de session). L'envoi reel d'invitation depend de l'autorisation cote backend `POST /clubs/:houseId/invite`.
- **Comportements temps-reel** :
  - L'action **Invite** appelle `useInviteToHouse` → `houseService.invite(houseId, [userId])` → `POST /clubs/:houseId/invite` avec `{ userIds }`. Le backend emet une notification **push `CLUB_INVITE`** vers l'utilisateur invite (le payload porte le `inviteToken` repris ensuite par `useAcceptInvitation`). C'est donc une action a effet temps-reel cote destinataire (push) meme si l'emetteur ne recoit pas d'evenement WebSocket en retour.
  - La reponse backend est `{ sent: number }` ; l'UI ne marque la ligne "Invited" qu'`onSuccess` (pas d'optimistic UI).
  - Le **lien d'invitation** est statique cote front : `https://app.chathouse.com/invite/<houseId>` (constantes `INVITE_HOST` / `INVITE_BASE_URL`), texte affiche `app.chathouse.com/invite/<houseId>`.
- **Pre-conditions globales** : session valide, reseau pour la recherche d'utilisateurs (`useSearchUsers` → `GET /clubs`-search via `profileService.search`) et pour l'envoi d'invitations ; permission systeme **presse-papier** (copie) et acces a la **feuille de partage** OS (Share). La permission notification concerne le destinataire, pas l'emetteur.
- **Etats de donnees pertinents** :
  - **Recherche vide / aucune saisie** (`debouncedQuery.length === 0`) → `EmptyState` "Inviter des membres" + corps "Recherche une personne par nom ou pseudo, ou partage le lien ci-dessus." La requete n'est PAS declenchee (`enabled: query.trim().length > 0`).
  - **Aucun resultat** (query non vide, liste vide) → `EmptyState` "Aucun resultat" + "Essaie un autre nom ou pseudo."
  - **Chargement** → `Loader` plein ecran (`accessibilityLabel` "Searching users"), la FlatList n'est pas montee.
  - **Hors-ligne / latence** → la recherche echoue silencieusement (data `undefined` → liste vide) ; l'invite echoue avec une `Alert` "Erreur" / "L'invitation n'a pas pu etre envoyee."
  - **Debounce** : 250 ms (`SEARCH_DEBOUNCE_MS`) sur la saisie avant requete.
  - **Anti double-invite** : un tap supplementaire est ignore si `invited[id]` est vrai OU si une mutation est `isPending` (garde dans `handleInvite`). Il n'existe AUCUN endpoint d'annulation d'invitation : "Invited" est terminal.

## Matrice bouton

| #   | Bouton                           | Emplacement               | Type                    | Locator reel                                                                                                                      | Pre-condition                                                            | Priorite |
| --- | -------------------------------- | ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| 1   | Fermer                           | Header (gauche)           | navigation              | `accessibilityLabel` = `t('houses.invite.closeA11y','Close invite dialog')` (icone MaterialIcons `close`)                         | Ecran ouvert                                                             | P1       |
| 2   | Copier le lien d'invitation      | Barre lien (corps haut)   | icon                    | `accessibilityLabel` = `t('houses.invite.copyA11y','Copy invite link')` (icone MaterialIcons `content-copy`)                      | `houseId` present ; permission presse-papier                             | P1       |
| 3   | Champ recherche utilisateurs     | Corps (sous barre lien)   | input-submit            | `placeholder` = `t('houses.invite.searchPlaceholder','Search users')` (composant `Input`, `value=query`, `onChangeText=setQuery`) | Reseau pour resultats                                                    | P1       |
| 4   | Inviter (par ligne utilisateur)  | Cellule de liste (droite) | realtime-action         | `label` = `t('houses.invite.inviteBtn','Invite')` (Button variant `outline`)                                                      | Resultats affiches ; reseau ; pas deja invite ; aucune mutation en cours | P0       |
| 5   | Invited (etat post-invitation)   | Cellule de liste (droite) | toggle (terminal/no-op) | `label` = `t('houses.invite.invited','Invited')` (Button variant `primaryContainer`, icone `check`)                               | Ligne deja invitee avec succes                                           | P2       |
| 6   | Partager (dans l'Alert de copie) | Modale Alert systeme      | navigation              | `text` = `t('houses.invite.share','Partager')` (bouton Alert)                                                                     | Alert "Copie" affichee                                                   | P2       |
| 7   | OK (dans l'Alert de copie)       | Modale Alert systeme      | navigation              | `text` = `t('houses.invite.ok','OK')` (bouton Alert, style cancel)                                                                | Alert "Copie" affichee                                                   | P2       |

> Remarque : il n'y a pas de FAB, ni de toggle/switch, ni de pull-to-refresh, ni de swipe/long-press, ni de lien `accessibilityRole='link'`. Les cellules utilisateur ne sont pas pressables en entier : seul le bouton Invite/Invited de la ligne est actionnable. Le champ de recherche ne possede pas de `onSubmitEditing` : la recherche se declenche au `onChangeText` debounce (250 ms), pas par une touche "valider".

## Cas de test

### HOUSE-MEMBER-001 - Fermeture de l'ecran via le bouton Close

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie ; ecran InviteMember ouvert sur `houseId='house-1'` ; reseau Wi-Fi ; aucune permission specifique.
- **Etapes** :
  1. Ouvrir l'ecran "Invite to House" depuis le detail d'une house.
  2. Localiser l'icone `close` en haut a gauche (`accessibilityLabel='Close invite dialog'`).
  3. Taper sur l'icone une fois.
- **Resultat attendu** : `navigation.goBack()` est appele une fois ; retour a l'ecran precedent (detail de la house) ; aucune Alert, aucune requete reseau emise.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est de nouveau affiche apres un seul tap ; KO si l'ecran reste affiche ou si l'app crash.
- **Donnees de test** : `routeParams = { houseId: 'house-1' }`.
- **Duree estimee** : 2 min

### HOUSE-MEMBER-002 - Multi-clic rapide sur Close + retour reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; passer en mode Avion juste avant le test (hors-ligne) puis observer.
- **Etapes** :
  1. Activer le mode Avion (hors-ligne).
  2. Taper tres rapidement 5 fois de suite sur l'icone `close` (`accessibilityLabel='Close invite dialog'`).
  3. Reactiver le Wi-Fi.
- **Resultat attendu** : un seul retour effectif (la stack ne depile pas plusieurs ecrans) ; pas de double pop ni d'ecran blanc ; le bouton Close ne depend d'aucun reseau donc fonctionne hors-ligne.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient une seule fois a l'ecran precedent et reste stable ; KO si plusieurs ecrans sont depiles ou l'app se fige.
- **Donnees de test** : `routeParams = { houseId: 'house-1' }`.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-003 - Accessibilite du bouton Close (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; contraste eleve active.
- **Etapes** :
  1. Activer TalkBack/VoiceOver et augmenter la police au max.
  2. Balayer jusqu'au premier element du header.
  3. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Close invite dialog, bouton" (role `button`) ; le `hitSlop=8` rend la cible facilement atteignable ; le double-tap declenche le retour ; l'icone reste visible et nette en contraste eleve et police agrandie (le titre "Invite to House" peut wrapper mais l'icone ne disparait pas).
- **Critere d'acceptation (OK/KO)** : OK si l'element est annonce avec son label et son role et activable au double-tap ; KO si annonce vide/"bouton sans label" ou cible non atteignable.
- **Donnees de test** : label attendu `Close invite dialog`.
- **Duree estimee** : 4 min

### HOUSE-MEMBER-004 - Copie du lien d'invitation dans le presse-papier

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert sur `houseId='house-1'` ; permission presse-papier accordee ; reseau quelconque (la copie ne necessite pas de reseau).
- **Etapes** :
  1. Reperer la barre du lien affichant `app.chathouse.com/invite/house-1`.
  2. Taper l'icone `content-copy` (`accessibilityLabel='Copy invite link'`).
  3. Dans l'Alert affichee, lire le titre et le corps.
  4. Coller le presse-papier dans une note externe.
- **Resultat attendu** : Alert titre "Copie" + corps "Le lien d'invitation est dans votre presse-papier." avec deux actions "Partager" et "OK". Le presse-papier contient exactement `https://app.chathouse.com/invite/house-1` (avec le schema https complet, alors que l'affichage masque `https://`).
- **Critere d'acceptation (OK/KO)** : OK si la chaine collee est `https://app.chathouse.com/invite/house-1` et l'Alert s'affiche ; KO si presse-papier vide, URL tronquee/sans https, ou pas d'Alert.
- **Donnees de test** : `houseId='house-1'` → URL attendue `https://app.chathouse.com/invite/house-1`.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-005 - Echec de copie (presse-papier indisponible) + multi-clic rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; simuler l'echec de `Clipboard.setStringAsync` (presse-papier refuse / mock rejet) ; reseau indifferent.
- **Etapes** :
  1. Forcer l'echec du presse-papier (env de test : mock `Clipboard.setStringAsync` qui throw ; sinon revoquer l'acces presse-papier OS si possible).
  2. Taper rapidement 4 fois sur l'icone `content-copy` (`accessibilityLabel='Copy invite link'`).
- **Resultat attendu** : une Alert "Erreur" + "Impossible de copier le lien." s'affiche (branche `catch`) ; pas d'empilement incontrole d'Alerts critiques (chaque tap relance la promesse mais l'UX doit rester comprehensible) ; aucune Alert de succes "Copie" ne s'affiche.
- **Critere d'acceptation (OK/KO)** : OK si seule l'Alert d'erreur "Impossible de copier le lien." apparait et l'app reste stable ; KO si l'app crash ou affiche faussement le succes.
- **Donnees de test** : mock `Clipboard.setStringAsync` → `Promise.reject(new Error('clipboard'))`.
- **Duree estimee** : 4 min

### HOUSE-MEMBER-006 - Accessibilite du bouton Copier (lecteur d'ecran + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police agrandie ; contraste eleve.
- **Etapes** :
  1. Balayer jusqu'a la barre du lien d'invitation.
  2. Ecouter l'annonce du texte du lien (`numberOfLines={1}`) puis de l'icone de copie.
  3. Double-taper l'icone de copie.
- **Resultat attendu** : l'icone est annoncee "Copy invite link, bouton" ; le texte du lien est lisible/annonce (tronque a une ligne avec ellipse si police max, mais le `houseId` reste audible via le lecteur) ; le double-tap declenche la copie + Alert ; le contraste de l'icone (couleur `primary`) reste suffisant sur fond glass.
- **Critere d'acceptation (OK/KO)** : OK si label "Copy invite link" annonce avec role bouton et action declenchee ; KO si non focusable, label absent, ou contraste insuffisant.
- **Donnees de test** : label attendu `Copy invite link`.
- **Duree estimee** : 4 min

### HOUSE-MEMBER-007 - Partage du lien depuis l'Alert de copie

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard ; ecran ouvert ; copie reussie (Alert "Copie" affichee) ; feuille de partage OS disponible.
- **Etapes** :
  1. Taper l'icone `content-copy` pour declencher l'Alert "Copie".
  2. Taper l'action "Partager" (`text='Partager'`).
  3. Observer la feuille de partage native.
- **Resultat attendu** : `Share.share` est invoque avec `{ message: 'https://app.chathouse.com/invite/house-1', url: 'https://app.chathouse.com/invite/house-1' }` ; la feuille de partage OS s'ouvre ; toute erreur de partage est avalee silencieusement (`.catch(() => undefined)`), donc pas d'Alert d'erreur ni de crash si l'utilisateur annule.
- **Critere d'acceptation (OK/KO)** : OK si la feuille de partage s'ouvre avec l'URL https complete ; KO si rien ne s'ouvre ou si l'annulation provoque une erreur visible.
- **Donnees de test** : URL `https://app.chathouse.com/invite/house-1`.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-008 - Fermeture de l'Alert via OK + double declenchement

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; ecran ouvert ; Alert "Copie" affichee.
- **Etapes** :
  1. Declencher l'Alert via l'icone de copie.
  2. Taper "OK" (`text='OK'`, style `cancel`).
  3. Re-taper immediatement l'icone de copie 3 fois rapidement.
- **Resultat attendu** : "OK" ferme l'Alert sans declencher de partage ; les taps suivants reaffichent l'Alert "Copie" (une a la fois, pas d'empilement infini) ; le presse-papier reste correct.
- **Critere d'acceptation (OK/KO)** : OK si "OK" ferme proprement et les re-copies restent stables ; KO si l'Alert reste bloquee ou plusieurs Alerts se superposent durablement.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-009 - Accessibilite des actions de l'Alert (Partager / OK)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police agrandie.
- **Etapes** :
  1. Declencher l'Alert "Copie".
  2. Laisser le lecteur d'ecran annoncer titre, corps puis les deux boutons.
  3. Naviguer entre "Partager" et "OK" et activer "OK".
- **Resultat attendu** : l'Alert native est entierement vocalisee (titre "Copie", corps, boutons "Partager" et "OK") ; les deux boutons sont focusables et activables ; "OK" (style cancel) est aussi atteignable via le geste d'annulation systeme.
- **Critere d'acceptation (OK/KO)** : OK si les deux actions sont annoncees et activables au lecteur ; KO si un bouton est ignore par le lecteur.
- **Donnees de test** : textes attendus `Partager`, `OK`.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-010 - Recherche d'un utilisateur et affichage des resultats

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; reseau Wi-Fi ; au moins un utilisateur "Jane Doe / @janedoe" existant cote backend.
- **Etapes** :
  1. Taper dans le champ recherche (`placeholder='Search users'`) la valeur `jane`.
  2. Attendre ~250 ms (debounce) que la requete parte.
  3. Observer la liste.
- **Resultat attendu** : pendant la requete un `Loader` "Searching users" peut apparaitre, puis une cellule affiche l'avatar, "Jane Doe", "@janedoe" et un bouton "Invite" (variant outline). L'`EmptyState` n'est plus affiche.
- **Critere d'acceptation (OK/KO)** : OK si la ligne utilisateur correspondante s'affiche avec le bouton "Invite" apres le debounce ; KO si aucun resultat alors que l'utilisateur existe, ou pas de debounce (requete a chaque frappe).
- **Donnees de test** : query `jane` ; utilisateur `{ id:'u42', username:'janedoe', displayName:'Jane Doe' }`.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-011 - Recherche : etat vide initial, aucun resultat, et hors-ligne

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert.
- **Etapes** :
  1. Sans rien saisir, verifier l'`EmptyState` initial.
  2. Saisir `zzzzznoexist` (aucun match) et attendre le debounce.
  3. Activer le mode Avion, vider puis saisir `jane`, attendre, puis reactiver le reseau.
  4. Saisir et effacer tres vite plusieurs requetes (`ja`, `jan`, `jane`, effacer) pour stresser le debounce.
- **Resultat attendu** :
  - Etape 1 : `EmptyState` "Inviter des membres" + "Recherche une personne par nom ou pseudo, ou partage le lien ci-dessus." Aucune requete n'est emise (query vide → `enabled:false`).
  - Etape 2 : `EmptyState` "Aucun resultat" + "Essaie un autre nom ou pseudo."
  - Etape 3 (hors-ligne) : la liste reste vide (`data ?? []`) sans crash ni Alert ; apres reconnexion + nouvelle frappe, les resultats reapparaissent.
  - Etape 4 : seule la derniere requete debouncee compte ; pas de scintillement de plusieurs listes ni de requetes par frappe.
- **Critere d'acceptation (OK/KO)** : OK si les trois EmptyStates/comportements sont corrects et l'app stable hors-ligne ; KO si crash, requete sur query vide, ou resultats incoherents apres reconnexion.
- **Donnees de test** : queries `''`, `zzzzznoexist`, `jane`.
- **Duree estimee** : 6 min

### HOUSE-MEMBER-012 - Accessibilite du champ de recherche (lecteur + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police agrandie ; clavier logiciel actif.
- **Etapes** :
  1. Balayer jusqu'au champ recherche.
  2. Ecouter l'annonce (placeholder "Search users", role champ de texte editable).
  3. Double-taper pour focus, saisir `jane` au clavier.
  4. Verifier l'annonce du `Loader` "Searching users" pendant le chargement.
- **Resultat attendu** : le champ est annonce comme zone de saisie editable avec le placeholder "Search users" ; l'icone loupe est decorative et non perturbante ; pendant la recherche, le `Loader` est annonce "Searching users" ; en police max, le champ ne tronque pas le texte saisi de maniere bloquante.
- **Critere d'acceptation (OK/KO)** : OK si champ focusable/editable annonce et Loader vocalise ; KO si champ non atteignable au lecteur ou Loader muet.
- **Donnees de test** : placeholder `Search users`, label loader `Searching users`.
- **Duree estimee** : 4 min

### HOUSE-MEMBER-013 - Inviter un utilisateur (chemin nominal, push CLUB_INVITE)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard membre de `house-1` autorise a inviter ; reseau Wi-Fi ; au moins un resultat de recherche affiche ; l'utilisateur cible n'est pas deja invite.
- **Etapes** :
  1. Rechercher `jane`, attendre l'affichage de la ligne "Jane Doe / @janedoe".
  2. Taper le bouton "Invite" (`label='Invite'`) de la ligne.
  3. Attendre la confirmation backend.
- **Resultat attendu** : `useInviteToHouse.mutate` est appele une fois avec `{ houseId:'house-1', userIds:['u42'] }` (et callbacks onSuccess/onError) → `POST /clubs/house-1/invite` body `{ userIds:['u42'] }`. Reponse `{ sent: 1 }`. `onSuccess` met la ligne en etat "Invited" (bouton variant `primaryContainer` + icone `check`). Cote destinataire, une notification push `CLUB_INVITE` est emise (verifiable sur l'appareil de l'invite).
- **Critere d'acceptation (OK/KO)** : OK si la requete part avec le bon payload, le bouton passe a "Invited" apres succes, et la push arrive cote invite ; KO si payload errone, bouton non mis a jour, ou aucune push.
- **Donnees de test** : `houseId='house-1'`, user `{ id:'u42' }` ; payload attendu `{ "houseId":"house-1", "userIds":["u42"] }`.
- **Duree estimee** : 4 min

### HOUSE-MEMBER-014 - Inviter : multi-clic rapide, mutation en cours, et echec reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ligne utilisateur affichee ; possibilite de simuler latence/erreur reseau sur `POST /clubs/:id/invite`.
- **Etapes** :
  1. Introduire une latence (~3 s) sur l'endpoint invite (ou couper le reseau).
  2. Taper "Invite" puis re-taper 4 fois tres rapidement pendant la requete (`isPending`).
  3. Cas A : laisser l'endpoint repondre en erreur (500 / timeout) hors-ligne.
  4. Cas B : reseau OK, mais re-taper apres que la ligne soit deja "Invited".
- **Resultat attendu** :
  - Pendant `isPending`, les taps supplementaires sont ignores (garde `inviteToHouse.isPending`) → `mutate` n'est appele qu'une seule fois.
  - Cas A : `onError` affiche l'Alert "Erreur" + "L'invitation n'a pas pu etre envoyee." ; la ligne NE passe PAS a "Invited" (reste "Invite"), on peut retenter apres reconnexion.
  - Cas B : un tap sur l'etat "Invited" est ignore (garde `invited[id]`) → aucune nouvelle requete, l'UI ne repasse jamais a "Invite".
- **Critere d'acceptation (OK/KO)** : OK si une seule requete par invitation, Alter d'erreur en echec sans bascule "Invited", et "Invited" terminal/non-rejouable ; KO si invitations multiples, double envoi, ou retour faux a "Invite".
- **Donnees de test** : user `{ id:'u42' }` ; reponse erreur simulee HTTP 500.
- **Duree estimee** : 6 min

### HOUSE-MEMBER-015 - Accessibilite du bouton Invite (lecteur + police + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police max ; contraste eleve ; au moins une ligne utilisateur affichee.
- **Etapes** :
  1. Balayer jusqu'a la cellule "Jane Doe".
  2. Ecouter l'annonce de la ligne (nom, @pseudo) puis du bouton.
  3. Double-taper "Invite".
  4. Apres succes, re-balayer le bouton.
- **Resultat attendu** : le bouton est annonce "Invite, bouton" puis, apres invitation, "Invited, bouton" (le changement de libelle est percu par le lecteur) ; le nom et le pseudo de la ligne sont annonces ; en police agrandie la cellule s'etire sans masquer le bouton ; contraste suffisant entre variant outline et le fond.
- **Critere d'acceptation (OK/KO)** : OK si libelles Invite/Invited annonces avec role bouton et action declenchee au double-tap ; KO si bouton non focusable, libelle non mis a jour, ou bouton coupe en police max.
- **Donnees de test** : labels `Invite` / `Invited` ; user `Jane Doe / @janedoe`.
- **Duree estimee** : 5 min

### HOUSE-MEMBER-016 - Invitation multi-utilisateur / synchronisation temps-reel

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux appareils : A = inviteur (standard, sur InviteMember de `house-1`), B = invite (compte `janedoe`, app installee, notifications push autorisees) ; les deux en ligne.
- **Etapes** :
  1. Sur A, rechercher `jane` et taper "Invite" sur la ligne de B.
  2. Observer B : reception de la notification push `CLUB_INVITE`.
  3. Sur B, ouvrir la notification et accepter (flux `useAcceptInvitation` → `POST /clubs/house-1/accept`).
  4. Verifier la liste des membres de `house-1` cote A (rafraichir le detail house).
- **Resultat attendu** : B recoit la push `CLUB_INVITE` peu apres le tap de A (le payload porte le `inviteToken`) ; apres acceptation, B devient membre de `house-1` (les caches `houses` sont invalides cote B) ; cote A, la ligne reste "Invited" ; aucune double-notification si A n'a tape qu'une fois.
- **Critere d'acceptation (OK/KO)** : OK si B recoit exactement une push et devient membre apres acceptation, et A reste coherent ("Invited") ; KO si push absente/dupliquee, ou B n'est pas ajoute apres acceptation.
- **Donnees de test** : `houseId='house-1'` ; A invite B `@janedoe (u42)` ; endpoints `POST /clubs/house-1/invite` puis `POST /clubs/house-1/accept`.
- **Duree estimee** : 8 min

### HOUSE-MEMBER-017 - Etat "Invited" : caractere terminal et non-annulable

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard ; une ligne utilisateur deja invitee avec succes (bouton "Invited" affiche, icone `check`).
- **Etapes** :
  1. Sur une ligne deja "Invited", taper le bouton "Invited" (`label='Invited'`).
  2. Observer l'UI et le reseau.
  3. Modifier la recherche puis revenir a la meme requete pour reafficher la ligne.
- **Resultat attendu** : le tap sur "Invited" est un no-op (garde `invited[id]`), aucune requete reseau, aucun retour a "Invite". Note : l'etat `invited` est en memoire ecran ; s'il n'est pas re-derive du backend, une nouvelle recherche identique peut reafficher l'utilisateur en "Invite" tant que l'etat local le couvre (comportement attendu documente).
- **Critere d'acceptation (OK/KO)** : OK si "Invited" ne declenche aucune requete et ne repasse jamais a "Invite" sur la meme session de liste ; KO si un tap renvoie une invitation ou bascule l'etat.
- **Donnees de test** : user `{ id:'u42' }` deja invite.
- **Duree estimee** : 3 min

### HOUSE-MEMBER-018 - Accessibilite globale : EmptyState et titre en police max / contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police max ; contraste eleve ; aucune saisie (etat vide initial).
- **Etapes** :
  1. Ouvrir l'ecran sans saisir.
  2. Laisser le lecteur parcourir titre "Invite to House", barre lien, champ recherche, puis le bloc EmptyState.
  3. Verifier l'ordre de focus et la lisibilite.
- **Resultat attendu** : ordre de focus logique (Close → titre → lien → copie → recherche → EmptyState) ; le titre "Invite to House" et le texte EmptyState "Inviter des membres" + corps restent lisibles (wrap multi-lignes, pas de troncature destructrice) en police max ; contraste texte/fond conforme.
- **Critere d'acceptation (OK/KO)** : OK si tout le contenu est annonce dans un ordre coherent et reste lisible en police max/contraste eleve ; KO si elements masques, illisibles, ou ordre de focus chaotique.
- **Donnees de test** : textes `Invite to House`, `Inviter des membres`.
- **Duree estimee** : 4 min
