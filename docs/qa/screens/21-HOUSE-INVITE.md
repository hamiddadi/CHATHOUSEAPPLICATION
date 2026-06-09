# 21 - Invitation house (`houses`)

## Contexte ecran

- **Route (navigation)** : `HouseInvitation` dans `RoomsNavigator` (stack `RoomStackParamList`).
  Params : `{ houseId: string; inviteToken?: string }` (`src/core/navigation/types.ts`).
- **Deep link** : `house/:houseId/invite/:inviteToken?` (`src/core/navigation/linking.ts`).
  L'ecran est typiquement atteint en tapant une notification push `CLUB_INVITE` ou un lien d'invitation. Le `inviteToken` est sensible : il ne doit JAMAIS etre logge (cf. commentaire `linking.ts` ligne 19) ; l'UI n'en affiche que les 8 premiers caracteres (`code` partiel).
- **Roles requis** : tout utilisateur authentifie (`standard` ou `admin`). Un `guest` non authentifie ne peut pas accepter (l'appel `/clubs/:houseId/accept` exige un token de session). La house peut etre `open` ou `private` ; l'invitation sert surtout aux houses privees.
- **Comportements temps-reel** :
  - Accept declenche `POST /clubs/{houseId}/accept` (via `useAcceptInvitation` → `houseService.acceptInvitation`). Le `inviteToken` n'est PAS envoye au backend (le backend n'a besoin que de `houseId` ; cf. `houseService.ts` lignes 83-91).
  - En cas de succes : invalidation du cache react-query `houseKeys.all` (les listes de houses "mine"/"discover" se rafraichissent) puis `navigation.replace('HouseDetail', { houseId })`.
  - Le compteur de membres (`membersCount`) est lu depuis `useHouse(houseId)` (`GET /clubs/{houseId}`) ; il n'est pas pousse en live sur cet ecran (snapshot au chargement).
- **Pre-conditions globales** : session valide ; reseau pour charger la house (`useHouse`) et pour accepter ; un `houseId` valide en params.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` → `Loader` centre (a11y "Loading invitation").
  - **Erreur de chargement** : `isError` → `EmptyState` "Invitation unavailable" (house supprimee ou invite expire). Dans cet etat, AUCUN bouton Accept/Decline n'est rendu, seul le bouton retour reste.
  - **Charge** : avatar squircle (icone house ou fallback `resolveHouseIcon`), nom de la house, libelle "{{count}} members" (masque si `house` undefined), sous-titre "You've been invited to join this house.", code d'invitation partiel (rendu seulement si `inviteToken` present), puis boutons Accept + Decline.
  - **Acceptation en cours** : `accept.isPending` → bouton Accept en `loading` (spinner) + `disabled`, opacite 45%.

## Matrice bouton

| #   | Bouton            | Emplacement                             | Type                     | Locator reel                                                                                               | Pre-condition                                                        | Priorite |
| --- | ----------------- | --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| 1   | Retour (fleche)   | Header (gauche)                         | navigation / icon        | `accessibilityLabel` = `t('houses.invitation.backA11y', 'Back')` ; icone `MaterialIcons name="arrow-back"` | Ecran monte (visible dans tous les etats : loading / error / charge) | P1       |
| 2   | Accept invitation | Corps, barre d'action bas               | submit / realtime-action | label = `t('houses.invitation.acceptBtn', 'Accept invitation')` (`accessibilityRole="button"`)             | House chargee (`!isLoading && !isError`) + session valide + reseau   | P0       |
| 3   | Decline           | Corps, barre d'action bas (sous Accept) | navigation               | label = `t('houses.invitation.declineBtn', 'Decline')` (variant `ghost`, `accessibilityRole="button"`)     | House chargee (`!isLoading && !isError`)                             | P1       |

> Remarque : le "code d'invitation" (`houses.invitation.code`) et le compteur de membres (`houses.invitation.membersCount`) sont du texte non-interactif (pas de `onPress`), donc hors matrice. L'ecran ne contient ni toggle, ni FAB, ni liste pressable, ni pull-to-refresh, ni input.

## Cas de test

### HOUSE-INVITE-001 - Retour ferme l'ecran d'invitation

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` authentifie, Wi-Fi, ecran charge (house valide affichee), pile de navigation ayant un ecran precedent.
- **Etapes** :
  1. Ouvrir une invitation valide (deep link `house/h1/invite/tok-abcdef12345`).
  2. Attendre l'affichage du nom de la house et des boutons.
  3. Taper la fleche retour en haut a gauche (label "Back").
- **Resultat attendu** : `navigation.goBack()` est appele ; l'ecran d'invitation se ferme et l'ecran precedent reapparait. Aucun appel `/accept` n'est emis.
- **Critere d'acceptation (OK/KO)** : OK si retour a l'ecran precedent sans rejoindre la house ; KO si rien ne se passe ou si la house est rejointe.
- **Donnees de test** : `houseId='h1'`, `inviteToken='tok-abcdef12345'`.
- **Duree estimee** : 2 min

### HOUSE-INVITE-002 - Retour : multi-clic rapide et absence de pile precedente

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau quelconque, ecran d'invitation ouvert directement via deep link (cold start) sans pile precedente OU avec pile profonde.
- **Etapes** :
  1. Ouvrir l'invitation via deep link a froid (app fermee puis ouverte sur le lien).
  2. Taper tres rapidement 3-4 fois la fleche retour (double/triple tap < 300 ms).
  3. Observer le comportement de navigation.
- **Resultat attendu** : un seul `goBack` effectif ; pas de double pop empilant des erreurs de navigation, pas de crash. Si aucune pile precedente, l'ecran reste ou redirige proprement vers l'ecran racine (selon `initialRouteName`), sans ecran blanc.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash ni d'ecran blanc et navigation coherente ; KO si crash, double navigation ou ecran fige.
- **Donnees de test** : deep link `chathouse://house/h1/invite/tok-abcdef12345`.
- **Duree estimee** : 4 min

### HOUSE-INVITE-003 - Retour accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme au maximum, contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Ouvrir l'invitation.
  3. Balayer jusqu'au premier element focusable du header.
  4. Ecouter l'annonce puis double-taper pour activer.
- **Resultat attendu** : l'element est annonce "Back, bouton" (role button via `accessibilityRole="button"`, label `houses.invitation.backA11y`). La cible tactile respecte le minimum (icone 24 + `hitSlop={8}` ≈ 40pt). Le titre "Invitation" reste lisible avec police agrandie (pas de troncature destructive). Double-tap declenche le retour.
- **Critere d'acceptation (OK/KO)** : OK si annonce role+label correcte et activation fonctionnelle ; KO si annonce "sans libelle"/"image" ou cible trop petite.
- **Donnees de test** : police systeme 200%, theme dark (mono-dark assume).
- **Duree estimee** : 4 min

### HOUSE-INVITE-004 - Accepter l'invitation et atterrir sur le detail de la house

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` authentifie, Wi-Fi stable, invitation valide pour une house ou l'utilisateur n'est PAS encore membre (`isJoinedByMe=false`).
- **Etapes** :
  1. Ouvrir l'invitation (house "Builders Guild" affichee, "1,234 members", code "tok-abcd…").
  2. Taper le bouton "Accept invitation".
  3. Observer le bouton pendant l'appel reseau.
  4. Attendre la fin de l'appel.
- **Resultat attendu** : pendant l'appel, le bouton passe en spinner (`loading`) et devient non cliquable (`disabled`, opacite 45%). Au succes, `POST /clubs/h1/accept` renvoie `{ joined: true }`, le cache `houses` est invalide, puis `navigation.replace('HouseDetail', { houseId: 'h1' })` remplace l'ecran (l'invitation n'est plus dans la pile au retour). La house apparait desormais dans la liste "mine".
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur arrive sur HouseDetail en tant que membre et que l'invitation a ete remplacee (pas accumulable) ; KO si reste sur l'invitation, double ecran, ou pas membre.
- **Donnees de test** : payload requete `POST /clubs/h1/accept` (corps vide) ; reponse `{"data":{"joined":true}}`. `inviteToken='tok-abcdef12345'` (non transmis au backend, normal).
- **Duree estimee** : 3 min

### HOUSE-INVITE-005 - Accept : multi-clic rapide, echec serveur et perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, reseau manipulable (mode avion / proxy a latence), invitation valide.
- **Etapes** :
  1. Ouvrir l'invitation chargee.
  2. Couper le reseau (mode avion) OU configurer le backend pour repondre 4xx/5xx (ex. invite expiree, deja membre).
  3. Taper "Accept invitation" puis re-taper 3-4 fois tres vite pendant l'attente.
  4. Pour le sous-cas latence : reactiver le reseau apres ~5 s pendant que l'appel est en cours.
- **Resultat attendu** :
  - Le garde `if (accept.isPending) return;` empeche les appels concurrents ; un SEUL `mutateAsync` est emis malgre les taps repetes (bouton aussi `disabled` pendant `isPending`).
  - En cas d'echec, une `Alert` "Erreur" s'affiche avec le message derive (`errorMessage`, fallback "Impossible d'accepter l'invitation.") ; AUCUNE navigation (`navigation.replace` non appele) ; l'utilisateur reste sur l'invitation et peut reessayer.
  - Reconnexion : l'app ne navigue pas en double, l'etat `loading` se resorbe (echec ou succes du retry manuel).
- **Critere d'acceptation (OK/KO)** : OK si 1 seul appel reseau par tentative, Alert affichee a l'echec, et aucune navigation parasite ; KO si appels multiples, navigation malgre l'erreur, ou app figee sur spinner.
- **Donnees de test** : reponse erreur `{"error":{"code":"INVITE_EXPIRED","message":"Invitation expiree"}}` (HTTP 410) ; ou coupure reseau totale.
- **Duree estimee** : 6 min

### HOUSE-INVITE-006 - Accept accessible au lecteur d'ecran et police agrandie

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police systeme 200%, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran et ouvrir l'invitation.
  2. Balayer jusqu'au bouton "Accept invitation".
  3. Ecouter l'annonce (role + etat).
  4. Double-taper pour accepter, puis pendant le chargement re-focaliser le bouton.
- **Resultat attendu** : annonce "Accept invitation, bouton" (role button). Pendant l'appel, l'etat accessibilite expose `busy: true` et `disabled: true` (`accessibilityState`), donc le lecteur annonce "occupe/desactive" et le double-tap est ignore. Le label tient en `numberOfLines={1}` mais reste lisible a 200% (cible pleine largeur, hauteur taille `lg` ≥ 44pt). Contraste du bouton primaire suffisant.
- **Critere d'acceptation (OK/KO)** : OK si role/etat busy+disabled annonces et activation correcte ; KO si bouton non focalisable, etat busy non annonce, ou texte coupe illisible.
- **Donnees de test** : police 200%, theme dark.
- **Duree estimee** : 4 min

### HOUSE-INVITE-007 - Synchro multi-utilisateur : accepter met a jour le compteur de membres et les listes

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils. Device A = `admin`/owner de la house "Builders Guild" affichant HouseList/HouseDetail (membersCount visible). Device B = invite `standard` sur l'ecran d'invitation. Reseau Wi-Fi sur les deux.
- **Etapes** :
  1. Sur Device A, noter le `membersCount` actuel (ex. 1234) sur HouseDetail.
  2. Sur Device B, taper "Accept invitation" et attendre l'arrivee sur HouseDetail.
  3. Sur Device A, rafraichir / re-naviguer la house (ou attendre l'invalidation cote A si une notif/socket le declenche).
- **Resultat attendu** : Device B est ajoute comme membre (POST /accept) et voit HouseDetail. Apres rafraichissement, Device A voit `membersCount` incremente (1235) et Device B apparait dans la liste des membres. Cote B, les listes "mine"/"discover" sont invalidees donc la house figure dans "mine".
- **Critere d'acceptation (OK/KO)** : OK si le compteur cote A reflete le nouvel adherent apres refetch et que B est bien membre des deux cotes ; KO si compteur fige malgre refetch, double comptage, ou B non membre.
- **Donnees de test** : house `h1` "Builders Guild" ; compte B `standard` non encore membre ; verifier `GET /clubs/h1` renvoie `membersCount` +1.
- **Duree estimee** : 6 min

### HOUSE-INVITE-008 - Decliner l'invitation revient sans rejoindre

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, invitation valide chargee, l'utilisateur n'est pas membre.
- **Etapes** :
  1. Ouvrir l'invitation chargee.
  2. Taper le bouton "Decline".
- **Resultat attendu** : `navigation.goBack()` est appele ; l'ecran se ferme ; AUCUN appel `/accept` n'est emis ; l'utilisateur n'est PAS ajoute a la house (verifier via `GET /clubs/h1` : membersCount inchange, `isJoinedByMe=false`).
- **Critere d'acceptation (OK/KO)** : OK si retour sans adhesion et sans appel reseau d'acceptation ; KO si la house est rejointe ou l'app reste bloquee.
- **Donnees de test** : `houseId='h1'`, `inviteToken='tok-abcdef12345'`.
- **Duree estimee** : 2 min

### HOUSE-INVITE-009 - Decline : multi-clic rapide et indisponibilite (etat erreur)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau coupable de retours lents. Deux sous-cas : (a) house chargee, (b) house en erreur (`isError`) ou Decline n'est PAS rendu.
- **Etapes** :
  1. Sous-cas (a) : sur l'invitation chargee, taper "Decline" 3-4 fois rapidement.
  2. Sous-cas (b) : ouvrir une invitation expiree/house supprimee (forcer `isError`) ; constater l'EmptyState "Invitation unavailable" et l'absence des boutons Accept/Decline ; utiliser la fleche retour.
- **Resultat attendu** :
  - (a) Un seul retour effectif (le premier tap pop l'ecran, les suivants tombent dans le vide) ; pas de double pop ni crash.
  - (b) Aucun bouton Accept/Decline n'est present (rendu conditionnel hors `isError`) ; seul le retour header permet de sortir ; le `inviteToken` n'est jamais affiche en clair ni logge.
- **Critere d'acceptation (OK/KO)** : OK si pas de double navigation (a) et si l'etat erreur n'expose pas de boutons d'action ni le token complet (b) ; KO sinon.
- **Donnees de test** : `GET /clubs/h1` renvoie 404/410 pour forcer `isError`.
- **Duree estimee** : 5 min

### HOUSE-INVITE-010 - Decline accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police 200%, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran, ouvrir l'invitation chargee.
  2. Balayer jusqu'au bouton "Decline" (situe sous "Accept invitation").
  3. Ecouter l'annonce et double-taper.
- **Resultat attendu** : annonce "Decline, bouton" (role button). L'ordre de focus suit l'ordre visuel : header retour → contenu (nom, membres, sous-titre, code) → Accept → Decline. Le variant `ghost` conserve un contraste de texte lisible en theme dark a 200%. Double-tap declenche le retour.
- **Critere d'acceptation (OK/KO)** : OK si annonce role+label correcte, ordre de focus logique et contraste suffisant ; KO si bouton non focalisable, ordre incoherent, ou texte illisible.
- **Donnees de test** : police 200%, theme dark.
- **Duree estimee** : 3 min

### HOUSE-INVITE-011 - Etat de chargement : aucune action premature possible

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau a forte latence (throttling ~3 s sur `GET /clubs/{id}`).
- **Etapes** :
  1. Ouvrir l'invitation sur reseau lent.
  2. Pendant l'etat de chargement, tenter de taper la zone centrale (la ou apparaitront Accept/Decline).
  3. Attendre la fin du chargement.
- **Resultat attendu** : pendant `isLoading`, seul le `Loader` (a11y "Loading invitation") est visible ; les boutons Accept/Decline ne sont PAS rendus, donc aucun appel `/accept` ne peut etre declenche. La fleche retour reste disponible. A la fin du chargement, les boutons apparaissent.
- **Critere d'acceptation (OK/KO)** : OK si aucune action d'adhesion possible avant chargement complet et Loader correctement annonce ; KO si bouton actionnable trop tot ou Loader non accessible.
- **Donnees de test** : latence simulee 3000 ms sur `GET /clubs/h1`.
- **Duree estimee** : 3 min
