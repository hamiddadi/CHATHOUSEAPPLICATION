# 20 - Detail house (`houses`)

## Contexte ecran

- **Route** : `HouseDetail` dans le `RoomStackParamList` (param obligatoire `houseId: string`). Navigue vers `Room` (ouverture d'une room) et `InviteMember` (invitation de membres).
- **Composant** : `src/features/houses/screens/HouseDetailScreen/HouseDetailScreen.tsx`. Aucun partial separe — tout est rendu dans le fichier principal (header de stack maison, `FlatList` de membres avec `ListHeaderComponent` portant la fiche house + les sections de rooms).
- **Roles requis** :
  - `guest` / `standard` non membre : peut consulter, voir le bouton `Rejoindre` (house publique) ou la mention `Sur invitation uniquement` (house privee).
  - `standard` membre : voit `Invite members` au lieu de `Rejoindre`.
  - `admin` de la house (membre dont `role === 'admin'`) : peut gerer les roles des membres manageables. Determine via `canManageRoles` = le viewer est dans `house.members` avec `role === 'admin'`.
- **Comportements temps-reel** :
  - Les donnees `useHouse`, `useHouseRooms('live')` et `useHouseRooms('upcoming')` proviennent de React Query (GET `/clubs/:id`, GET `/rooms?clubId=…&filter=live|upcoming`). Le rafraichissement des compteurs (membres, rooms live, participants par room) et l'apparition/disparition de rooms live depend de l'invalidation de cache et des refetch ; il n'y a PAS d'abonnement WebSocket direct dans cet ecran. Les changements multi-utilisateur (un membre promu par un autre admin, une room qui passe live) ne se refletent qu'apres invalidation/refetch.
  - `Rejoindre` (POST `/clubs/:id/join`) et `Promouvoir/Retrograder` (PATCH `/clubs/:id/members/:userId/role`) invalident le cache `houses` au succes → propagation cross-ecrans.
  - L'ouverture d'une room (`navigate('Room')`) declenche en aval la connexion LiveKit/WebSocket de l'ecran Room (hors de cet ecran).
- **Pre-conditions globales** : utilisateur authentifie (l'`authStore` fournit `viewerId`) ; backend accessible ; `houseId` valide passe en param de route.
- **Etats de donnees pertinents** :
  - Chargement : `isLoading` → `Loader` plein ecran (`accessibilityLabel="Loading house"`).
  - Erreur / house absente : `isError || !house` → `EmptyState` titre `House unavailable`, description `This house may have been deleted.`.
  - Sections rooms vides : `renderRoomSection` retourne `null` si `rooms` vide/undefined → aucune section affichee (pas d'empty state dedie).
  - Liste membres : toujours au moins le proprietaire ; chaque membre rend une cellule pressable seulement si manageable.
  - Hors-ligne : les requetes GET echouent → potentiel `EmptyState` si la query est en erreur ; les mutations remontent des `Alert` d'erreur.

## Matrice bouton

| #   | Bouton                                    | Emplacement                            | Type                        | Locator reel                                                                                | Pre-condition                                       | Priorite |
| --- | ----------------------------------------- | -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------- |
| 1   | Retour                                    | Header (haut gauche)                   | navigation                  | `accessibilityLabel="Back"`                                                                 | Ecran charge                                        | P1       |
| 2   | Options de la house                       | Header (haut droite)                   | menu                        | `accessibilityLabel="House options"`                                                        | Ecran charge                                        | P1       |
| 3   | Partager la house                         | Modale Alert (via Options)             | link                        | Bouton Alert `text: 'Partager la house'`                                                    | Alert Options ouvert                                | P2       |
| 4   | Inviter des membres (depuis Options)      | Modale Alert (via Options)             | navigation                  | Bouton Alert `text: 'Inviter des membres'`                                                  | Alert Options ouvert                                | P1       |
| 5   | Rejoindre                                 | Corps / header de fiche                | submit (realtime)           | `t('house.join','Rejoindre')` → texte `Rejoindre`                                           | House publique ET `isJoinedByMe === false`          | P0       |
| 6   | Invite members                            | Corps / header de fiche                | navigation                  | `t('house.inviteMembers','Invite members')` → texte `Invite members`                        | `isJoinedByMe === true`                             | P1       |
| 7   | Ouvrir une room (cellule live/planifiee)  | Corps, sections En direct / Planifiees | list-item (realtime)        | `accessibilityLabel={`Open room ${room.title}`}`                                            | Au moins une room dans la section                   | P0       |
| 8   | Gerer le role d'un membre (cellule)       | Corps, liste des membres               | list-item / menu (realtime) | `accessibilityLabel={`Manage role for ${member.displayName}`}`                              | Viewer admin ET membre manageable (≠ self, ≠ owner) | P0       |
| 9   | Promouvoir / Retrograder (action de role) | Modale Alert (via cellule membre)      | destructive (realtime)      | Bouton Alert `text: 'Promouvoir Admin' / 'Promouvoir Modérateur' / 'Rétrograder en Membre'` | Alert de gestion membre ouvert                      | P0       |

> Note : il n'existe pas de pull-to-refresh, de swipe, de long-press ni de FAB sur cet ecran. Les boutons `Annuler` des Alerts (Options et gestion de role) sont des `style: 'cancel'` standards et sont couverts implicitement dans les cas d'erreur des boutons parents.

## Cas de test

### HOUSE-DETAIL-001 - Retour ferme l'ecran et revient en arriere

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie ; house chargee ; reseau Wi-Fi ; pile de navigation avec un ecran precedent (ex : liste des houses).
- **Etapes** :
  1. Ouvrir une house depuis la liste (arriver sur `HouseDetail`).
  2. Taper l'icone fleche retour (locator `Back`, `arrow-back`, haut gauche).
  3. Observer la transition.
- **Resultat attendu** : `navigation.goBack()` est appele ; l'utilisateur revient a l'ecran precedent ; aucune requete supplementaire declenchee.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est affiche apres le tap ; KO si l'ecran reste sur HouseDetail ou crash.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-002 - Retour : multi-tap rapide ne double pas le pop

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; house chargee ; reseau Wi-Fi ; un seul ecran precedent dans la pile.
- **Etapes** :
  1. Sur `HouseDetail`, taper tres rapidement 4-5 fois l'icone `Back`.
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul `goBack` effectif ; pas de double pop (pas de sortie au-dela de l'ecran precedent) ; pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'app s'arrete a l'ecran precedent immediat ; KO si elle remonte plusieurs niveaux ou crash.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-003 - Retour accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; house chargee ; TalkBack (Android) ou VoiceOver (iOS) actif ; police systeme XXL ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran et naviguer jusqu'au header.
  2. Focus sur l'icone retour.
  3. Verifier l'annonce, puis double-taper pour activer.
- **Resultat attendu** : le lecteur annonce `Back` avec le role `button` ; le double-tap declenche le retour ; l'icone reste tappable avec police agrandie (`hitSlop=8`) et l'icone reste visible en contraste eleve (`colors.text`).
- **Critere d'acceptation (OK/KO)** : OK si annonce "Back, bouton" + activation fonctionnelle ; KO si non focusable ou non annonce.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-004 - Options ouvre le menu d'actions

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; house chargee ; reseau Wi-Fi.
- **Etapes** :
  1. Taper l'icone trois-points verticaux (locator `House options`, `more-vert`, haut droite).
  2. Observer l'Alert.
- **Resultat attendu** : un `Alert` titre `Options de la house` apparait avec exactement 3 actions : `Partager la house`, `Inviter des membres`, `Annuler` (cancel).
- **Critere d'acceptation (OK/KO)** : OK si les 3 entrees sont presentes dans cet ordre ; KO si une manque ou libelle different.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-005 - Options : multi-tap rapide n'empile pas plusieurs Alerts

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; house chargee.
- **Etapes** :
  1. Taper rapidement 4-5 fois l'icone `House options`.
  2. Fermer l'Alert via `Annuler`.
  3. Verifier qu'aucun second Alert n'est dessous.
- **Resultat attendu** : un seul Alert visible (le runtime serialise les Alert) ; apres `Annuler`, retour direct a l'ecran sans Alert residuel.
- **Critere d'acceptation (OK/KO)** : OK si un seul dialog a fermer ; KO si plusieurs Alerts s'empilent.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-006 - Options accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; house chargee ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Focus sur l'icone options du header.
  2. Verifier l'annonce, puis activer.
  3. Parcourir les entrees de l'Alert au lecteur d'ecran.
- **Resultat attendu** : annonce `House options, bouton` ; chaque action de l'Alert (`Partager la house`, `Inviter des membres`, `Annuler`) est focusable et lisible ; l'icone reste tappable en police agrandie.
- **Critere d'acceptation (OK/KO)** : OK si annonce + navigation dans l'Alert au lecteur d'ecran ; KO sinon.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-007 - Partager la house ouvre la feuille de partage native

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard ; house chargee ; Alert Options ouvert.
- **Etapes** :
  1. Ouvrir Options.
  2. Taper `Partager la house`.
  3. Observer la share sheet native.
- **Resultat attendu** : `Share.share` est invoque avec `title='Chathouse'`, `message` contenant `https://app.chathouse.com/h/house-1`, `url=https://app.chathouse.com/h/house-1` ; la feuille de partage systeme s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si la share sheet s'ouvre avec l'URL correcte ; KO si URL erronee ou pas de feuille.
- **Donnees de test** : `houseId='house-1'`, URL attendue `https://app.chathouse.com/h/house-1`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-008 - Partager : annulation de la feuille ne crash pas

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; house chargee ; Alert Options ouvert.
- **Etapes** :
  1. Ouvrir Options puis `Partager la house`.
  2. Annuler/fermer la share sheet sans partager.
  3. Re-taper rapidement Options → `Partager la house` plusieurs fois.
- **Resultat attendu** : le `.catch(() => undefined)` absorbe le rejet ; aucun crash ni Alert d'erreur ; chaque tap rouvre proprement la feuille.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash apres annulation/multi-tap ; KO si exception non geree.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-009 - Partager accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; Alert Options ouvert ; TalkBack/VoiceOver actif ; police XXL.
- **Etapes** :
  1. Ouvrir Options.
  2. Focus sur `Partager la house` au lecteur d'ecran.
  3. Double-taper pour activer.
- **Resultat attendu** : l'entree `Partager la house` est annoncee et activable ; la share sheet native reste accessible (gere par l'OS).
- **Critere d'acceptation (OK/KO)** : OK si annonce + activation ; KO si entree non focusable.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-010 - Inviter des membres (depuis Options) navigue vers InviteMember

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ou admin ; house chargee ; Alert Options ouvert.
- **Etapes** :
  1. Ouvrir Options.
  2. Taper `Inviter des membres`.
  3. Observer la navigation.
- **Resultat attendu** : `navigation.navigate('InviteMember', { houseId: 'house-1' })` est appele ; l'ecran InviteMember s'affiche pour cette house.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran InviteMember s'ouvre avec le bon `houseId` ; KO sinon.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-011 - Inviter (Options) : reseau hors-ligne au moment de la navigation

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; house chargee ; Alert Options ouvert ; passer hors-ligne avant de taper.
- **Etapes** :
  1. Couper le reseau (mode avion).
  2. Ouvrir Options → `Inviter des membres`.
  3. Multi-taper l'entree avant fermeture de l'Alert.
- **Resultat attendu** : la navigation vers InviteMember se fait localement (pas de reseau requis pour ouvrir l'ecran) ; un seul push d'ecran malgre les multi-taps (l'Alert se ferme apres le 1er) ; l'eventuel chargement de donnees cible est gere par l'ecran InviteMember, pas ici.
- **Critere d'acceptation (OK/KO)** : OK si un seul push InviteMember sans crash ; KO si double-push ou crash.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-012 - Inviter (Options) accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; Alert Options ouvert ; TalkBack/VoiceOver actif ; police XXL.
- **Etapes** :
  1. Ouvrir Options.
  2. Focus sur `Inviter des membres`.
  3. Activer.
- **Resultat attendu** : entree annoncee, activable, navigation effectuee ; focus ramene sur l'ecran InviteMember.
- **Critere d'acceptation (OK/KO)** : OK si annonce + navigation au lecteur d'ecran ; KO sinon.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-013 - Rejoindre une house publique (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard non membre ; house publique (`privacy='open'`, `isJoinedByMe=false`) ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir une house publique non rejointe.
  2. Verifier la presence du bouton `Rejoindre` (locator `t('house.join','Rejoindre')`).
  3. Taper `Rejoindre`.
  4. Attendre la fin de la mutation.
- **Resultat attendu** : `joinHouse.mutate('house-1', { onError })` appele ; POST `/clubs/house-1/join` ; au succes, invalidation du cache `houses` ; le bouton passe en etat `loading` pendant `isPending` puis le header se met a jour (bascule vers `Invite members` apres refetch indiquant `isJoinedByMe=true`).
- **Critere d'acceptation (OK/KO)** : OK si la requete join part et l'UI reflete l'adhesion ; KO si aucun appel ou pas de bascule.
- **Donnees de test** : `houseId='house-1'`, payload POST sans body.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-014 - Rejoindre : multi-clic rapide + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard non membre ; house publique ; reseau instable (latence 5s puis coupure).
- **Etapes** :
  1. Ouvrir la house publique.
  2. Taper `Rejoindre` 5 fois tres rapidement.
  3. Pendant la requete, couper le reseau (mode avion).
  4. Observer l'etat du bouton et l'alerte.
- **Resultat attendu** : pendant `isPending`, le bouton est `disabled` (anti double-submit) → au plus une mutation effective ; sur echec reseau, le callback `onError` declenche `Alert.alert('Erreur', 'Impossible de rejoindre cette house.')` (ou message backend via `errorMessage`) ; pas de double adhesion.
- **Critere d'acceptation (OK/KO)** : OK si max 1 requete + Alert d'erreur sur coupure ; KO si requetes multiples ou crash.
- **Donnees de test** : `houseId='house-1'` ; message attendu `Impossible de rejoindre cette house.`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-015 - Rejoindre accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard non membre ; house publique ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Focus sur le bouton `Rejoindre`.
  2. Verifier l'annonce et l'etat.
  3. Activer puis observer l'etat `loading`.
- **Resultat attendu** : le bouton est annonce avec son label `Rejoindre` et role bouton ; pendant `loading/disabled` le lecteur annonce l'etat desactive ; le label reste lisible en police XXL (pas de troncature) et en contraste eleve (variant `primary`).
- **Critere d'acceptation (OK/KO)** : OK si label + etat (actif/desactive) annonces ; KO si non focusable ou etat non communique.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-016 - Rejoindre : synchro multi-utilisateur du compteur membres

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes (A standard non membre sur l'ecran, B deja membre ou admin) ; meme house publique ; reseau Wi-Fi.
- **Etapes** :
  1. Sur l'appareil A, ouvrir la house et noter `membersCount` (ex : 1234).
  2. Sur A, taper `Rejoindre` (succes).
  3. Sur A, declencher un refetch (revenir/retourner sur l'ecran ou tirer une re-navigation) puisque l'invalidation `houses` est cross-cache.
  4. Sur l'appareil B, recharger la house.
- **Resultat attendu** : apres adhesion et refetch, `membersCount` augmente de 1 cote A (header passe a `Invite members`) ; cote B le compteur reflete +1 apres rechargement. Note : pas d'event WebSocket push ici, la synchro est via invalidation/refetch.
- **Critere d'acceptation (OK/KO)** : OK si les deux appareils convergent vers le meme compteur apres refetch ; KO si desynchronisation persistante.
- **Donnees de test** : `houseId='house-1'` ; compteur initial 1234 → 1235.
- **Duree estimee** : 4 min

### HOUSE-DETAIL-017 - House privee : pas de bouton Rejoindre (mention invitation)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard non membre ; house privee (`privacy='private'`, `isJoinedByMe=false`).
- **Etapes** :
  1. Ouvrir une house privee non rejointe.
  2. Verifier la zone d'action du header de fiche.
- **Resultat attendu** : pas de bouton `Rejoindre` ; affichage du texte `t('house.inviteOnly','Sur invitation uniquement')` ; aucune action de join possible.
- **Critere d'acceptation (OK/KO)** : OK si la mention `Sur invitation uniquement` est affichee sans bouton join ; KO si un bouton join apparait.
- **Donnees de test** : house privee `house-priv`, `privacy='private'`.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-018 - Invite members (header membre) navigue vers InviteMember

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard membre (`isJoinedByMe=true`) ; house chargee ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir une house deja rejointe.
  2. Verifier la presence du bouton `Invite members` (locator `t('house.inviteMembers','Invite members')`).
  3. Taper le bouton.
- **Resultat attendu** : `navigation.navigate('InviteMember', { houseId: 'house-1' })` ; l'ecran InviteMember s'ouvre.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers InviteMember avec bon houseId ; KO sinon.
- **Donnees de test** : `houseId='house-1'`, `isJoinedByMe=true`.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-019 - Invite members : multi-tap rapide ne double pas le push

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte membre ; house chargee ; reseau Wi-Fi.
- **Etapes** :
  1. Taper le bouton `Invite members` 5 fois rapidement.
  2. Observer la pile.
- **Resultat attendu** : idealement un seul ecran InviteMember pousse (la navigation stack deduplique les destinations rapides) ; pas de crash ni multiples ecrans empiles.
- **Critere d'acceptation (OK/KO)** : OK si pas de stack multiple anormale ; KO si plusieurs InviteMember empiles bloquant le retour.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-020 - Invite members accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte membre ; house chargee ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Focus sur `Invite members`.
  2. Verifier annonce et activer.
- **Resultat attendu** : bouton annonce avec label `Invite members` + role bouton ; activation navigue ; label lisible en police XXL (variant `primaryContainer`, contraste suffisant).
- **Critere d'acceptation (OK/KO)** : OK si annonce + navigation au lecteur d'ecran ; KO sinon.
- **Donnees de test** : `houseId='house-1'`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-021 - Ouvrir une room live (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; house chargee avec au moins une room live (`useHouseRooms('live')` non vide) ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir une house ayant une room live (ex : `Friday critique`).
  2. Reperer la section `En direct` et la cellule avec pastille verte + `12 en ligne`.
  3. Taper la cellule (locator `Open room Friday critique`).
- **Resultat attendu** : `navigation.navigate('Room', { roomId: 'room-9' })` ; l'ecran Room s'ouvre et amorce la connexion temps-reel (LiveKit/WebSocket cote ecran Room).
- **Critere d'acceptation (OK/KO)** : OK si navigation vers Room avec bon `roomId` ; KO sinon.
- **Donnees de test** : room `{ id:'room-9', title:'Friday critique', isLive:true, participantCount:12 }`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-022 - Ouvrir une room : multi-tap rapide + latence reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; room live presente ; reseau a forte latence (3-5s).
- **Etapes** :
  1. Taper la cellule room 5 fois rapidement.
  2. Pendant le rendu de l'ecran Room, simuler une latence/coupure.
- **Resultat attendu** : un seul push de l'ecran Room (la stack ne double pas la destination Room/roomId identique) ; en cas d'echec de connexion temps-reel, la gestion est cote ecran Room (pas d'effet de bord ici) ; retour depuis Room ramene proprement a HouseDetail.
- **Critere d'acceptation (OK/KO)** : OK si un seul ecran Room et retour propre ; KO si stack dupliquee ou crash.
- **Donnees de test** : `roomId='room-9'`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-023 - Ouvrir une room accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; room live + room planifiee presentes ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Parcourir les sections `En direct` puis `Planifiees` au lecteur d'ecran.
  2. Focus sur une cellule room.
  3. Verifier annonce puis activer.
- **Resultat attendu** : chaque cellule est annoncee avec `Open room <titre>` + role bouton ; le titre (`numberOfLines=1`) et le sous-texte (`X en ligne` ou date/`Planifiée`) restent lisibles ; la pastille de statut (verte live / grise) garde un contraste suffisant ; double-tap navigue.
- **Critere d'acceptation (OK/KO)** : OK si chaque room est focusable, annoncee avec son titre, activable ; KO si cellule non focusable ou titre tronque illisible.
- **Donnees de test** : room live `Friday critique`, room planifiee `Atelier UX`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-024 - Room : passage live multi-utilisateur (synchro liste)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes ; A sur l'ecran HouseDetail ; B (createur/host) demarre une room dans cette house ; reseau Wi-Fi.
- **Etapes** :
  1. Sur A, ouvrir la house : noter la section `En direct` (ex : 0 room) et `Planifiees`.
  2. Sur B, faire passer une room planifiee en live (ou en creer une live).
  3. Sur A, declencher un refetch (re-navigation/retour-entree sur l'ecran).
  4. Observer la section `En direct` sur A.
- **Resultat attendu** : apres refetch, la room apparait sous `En direct` cote A avec pastille verte et `participantCount en ligne` ; `liveRoomsCount` du header reflete l'augmentation. Note : pas de push WebSocket ; la mise a jour necessite un refetch (la section est cachee par React Query).
- **Critere d'acceptation (OK/KO)** : OK si la room live apparait cote A apres refetch et le compteur live est coherent ; KO si elle reste absente.
- **Donnees de test** : room `room-9` planifiee → live, `participantCount=3`.
- **Duree estimee** : 4 min

### HOUSE-DETAIL-025 - Sections rooms vides : aucune section affichee

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; house chargee sans room live ni planifiee (`useHouseRooms` retourne `[]` pour les deux filtres).
- **Etapes** :
  1. Ouvrir une house sans aucune room.
  2. Observer le corps sous la fiche.
- **Resultat attendu** : `renderRoomSection` retourne `null` pour les deux sections → ni `En direct` ni `Planifiees` ne sont rendues ; seul le titre `Members` puis la liste des membres apparaissent ; pas d'empty state dedie rooms.
- **Critere d'acceptation (OK/KO)** : OK si aucune section room visible sans erreur de layout ; KO si une section vide ou un crash apparait.
- **Donnees de test** : `liveRooms=[]`, `upcomingRooms=[]`.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-026 - Gerer le role d'un membre : admin ouvre le menu d'actions

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin de la house (viewer dans `members` avec `role='admin'`) ; un membre cible manageable (≠ viewer, ≠ owner) ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir la house en tant qu'admin.
  2. Dans la liste des membres, reperer une cellule manageable affichant l'icone `more-horiz`.
  3. Taper la cellule (locator `Manage role for Bob Builder`).
- **Resultat attendu** : `Alert.alert('Bob Builder', 'Rôle actuel : Membre', [...])` avec les actions de role disponibles (toutes sauf le role actuel) + `Annuler`. Pour un membre `member` : `Promouvoir Admin`, `Promouvoir Modérateur`.
- **Critere d'acceptation (OK/KO)** : OK si l'Alert s'ouvre avec titre = nom du membre, sous-titre role actuel, et les options correctes ; KO si Alert absent ou options erronees.
- **Donnees de test** : membre `{ id:'m2', displayName:'Bob Builder', role:'member' }`, viewer admin `viewer-1`, owner `owner-1`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-027 - Gestion role : cellule non manageable (self / owner / non-admin) non pressable

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : (a) viewer admin regardant sa propre cellule, (b) viewer admin regardant l'owner, (c) viewer non-admin regardant n'importe quel membre.
- **Etapes** :
  1. Cas (a) : en admin, taper sa propre cellule membre.
  2. Cas (b) : en admin, taper la cellule de l'owner (`member.id === house.ownerId`).
  3. Cas (c) : en membre standard, taper n'importe quelle cellule.
- **Resultat attendu** : aucune de ces cellules n'est pressable (rendue comme `View`, pas `Pressable`) → aucun Alert, pas d'icone `more-horiz`, pas de label `Manage role for…` ; `isManageable` renvoie `false`.
- **Critere d'acceptation (OK/KO)** : OK si aucun Alert ne s'ouvre dans les 3 cas et aucune cellule n'expose le label de gestion ; KO si une action de role est offerte.
- **Donnees de test** : viewer `viewer-1` admin, self `viewer-1`, owner `owner-1`, membre standard non-admin.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-028 - Gestion role accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; membre manageable ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Parcourir la liste des membres au lecteur d'ecran.
  2. Focus sur une cellule manageable.
  3. Verifier annonce, activer, parcourir l'Alert.
- **Resultat attendu** : la cellule est annoncee `Manage role for <displayName>` + role bouton ; les cellules non manageables ne sont PAS annoncees comme boutons ; l'icone `more-horiz` (`colors.textMuted`) doit rester perceptible en contraste eleve ; les badges de role (`ADMIN`/`MODERATOR`) restent lisibles en police XXL.
- **Critere d'acceptation (OK/KO)** : OK si seules les cellules manageables sont des boutons annonces et l'Alert est navigable ; KO si une cellule non manageable est annoncee comme bouton ou si l'action est inaccessible.
- **Donnees de test** : membre manageable `Bob Builder`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-029 - Promouvoir un membre Moderateur (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin ; membre cible `role='member'` manageable ; reseau Wi-Fi ; Alert de gestion ouvert.
- **Etapes** :
  1. Ouvrir l'Alert via `Manage role for Bob Builder`.
  2. Taper `Promouvoir Modérateur`.
  3. Attendre la fin de la mutation.
- **Resultat attendu** : `setMemberRole.mutate({ houseId:'house-1', userId:'m2', role:'moderator' })` ; PATCH `/clubs/house-1/members/m2/role` body `{ role:'moderator' }` ; au succes, `qc.setQueryData` rafraichit le cache detail + invalidation `houses` ; la cellule du membre affiche le badge `MODERATOR` et le sous-libelle role mis a jour.
- **Critere d'acceptation (OK/KO)** : OK si la requete part avec le bon role et la cellule reflete le nouveau role ; KO si role errone ou pas de mise a jour.
- **Donnees de test** : `{ houseId:'house-1', userId:'m2', role:'moderator' }`.
- **Duree estimee** : 2 min

### HOUSE-DETAIL-030 - Promouvoir/Retrograder : multi-clic rapide + echec reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; membre manageable ; reseau instable (latence puis coupure) ; Alert de gestion ouvert.
- **Etapes** :
  1. Ouvrir l'Alert de gestion d'un membre.
  2. Taper une action de role (ex : `Promouvoir Admin`).
  3. Pendant `setMemberRole.isPending`, re-ouvrir une cellule manageable : verifier qu'elle est `disabled`.
  4. Couper le reseau pour forcer l'echec de la mutation.
- **Resultat attendu** : pendant `isPending`, toutes les cellules de gestion sont `disabled` (anti double action) ; sur echec, `Alert.alert('Action impossible', 'Impossible de modifier le rôle de ce membre.')` ; pas de double PATCH ni d'etat incoherent.
- **Critere d'acceptation (OK/KO)** : OK si cellules desactivees pendant pending + Alert d'erreur sur echec ; KO si double PATCH ou pas d'erreur affichee.
- **Donnees de test** : `{ houseId:'house-1', userId:'m2', role:'admin' }` ; message attendu `Impossible de modifier le rôle de ce membre.`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-031 - Retrograder en Membre accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; membre cible `role='moderator'` ou `admin` ; Alert de gestion ouvert ; TalkBack/VoiceOver actif ; police XXL.
- **Etapes** :
  1. Ouvrir l'Alert d'un membre moderateur.
  2. Au lecteur d'ecran, focus sur `Rétrograder en Membre`.
  3. Activer.
- **Resultat attendu** : l'action `Rétrograder en Membre` est annoncee et activable ; le titre de l'Alert (nom du membre) et le sous-titre `Rôle actuel : Modérateur` sont lus ; la mutation part au double-tap.
- **Critere d'acceptation (OK/KO)** : OK si l'action est annoncee/activable au lecteur d'ecran ; KO sinon.
- **Donnees de test** : membre `{ id:'m3', displayName:'Carla Mod', role:'moderator' }` → `member`.
- **Duree estimee** : 3 min

### HOUSE-DETAIL-032 - Changement de role : synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes admin (A et B) de la meme house ; un membre cible C ; reseau Wi-Fi.
- **Etapes** :
  1. A et B ont la house ouverte ; C est `member`.
  2. Sur A, ouvrir `Manage role for <C>` et `Promouvoir Modérateur` (succes).
  3. Sur B, recharger la house (refetch).
  4. Comparer la cellule de C sur A et B.
- **Resultat attendu** : cote A, la cellule de C affiche immediatement le nouveau role (cache detail seede via `setQueryData`) ; cote B apres refetch, C apparait avec le badge `MODERATOR`. Note : pas de push WebSocket, la convergence necessite un refetch cote B.
- **Critere d'acceptation (OK/KO)** : OK si A et B convergent sur le meme role pour C apres refetch ; KO si desynchronisation persistante.
- **Donnees de test** : membre C `{ id:'m4', displayName:'Dora Dev', role:'member' }` → `moderator`.
- **Duree estimee** : 4 min

### HOUSE-DETAIL-033 - Etat de chargement : Loader plein ecran

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; reseau lent forcant un `isLoading` prolonge.
- **Etapes** :
  1. Ouvrir une house avec un GET `/clubs/:id` lent.
  2. Observer l'ecran avant resolution.
- **Resultat attendu** : `Loader` plein ecran affiche, annonce `Loading house` au lecteur d'ecran ; aucun bouton du corps n'est rendu tant que `isLoading`.
- **Critere d'acceptation (OK/KO)** : OK si Loader visible et annonce ; KO si contenu partiel ou crash.
- **Donnees de test** : `houseId='house-1'`, latence 5s.
- **Duree estimee** : 1 min

### HOUSE-DETAIL-034 - Etat d'erreur : EmptyState house indisponible

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; `houseId` invalide ou GET en erreur / hors-ligne.
- **Etapes** :
  1. Ouvrir une house dont le GET echoue (404 ou hors-ligne).
  2. Observer l'ecran.
- **Resultat attendu** : `EmptyState` titre `House unavailable`, description `This house may have been deleted.` ; aucun bouton d'action du corps (sauf navigation systeme) ; le header (Back/Options) n'est PAS rendu dans cet etat (early return avant le layout principal).
- **Critere d'acceptation (OK/KO)** : OK si EmptyState affiche avec le bon texte ; KO si crash ou ecran vide.
- **Donnees de test** : `houseId='house-404'`, reponse 404.
- **Duree estimee** : 1 min

## Recapitulatif

- Elements interactifs recenses : 9 (Back, Options, Partager, Inviter via Options, Rejoindre, Invite members, Ouvrir room, Gerer role membre, Action Promouvoir/Retrograder).
- Cas de test ecrits : 34 (HOUSE-DETAIL-001 a HOUSE-DETAIL-034).
- P0 (temps-reel/critiques) : Rejoindre, Ouvrir room, Gerer role membre, Action de role.
