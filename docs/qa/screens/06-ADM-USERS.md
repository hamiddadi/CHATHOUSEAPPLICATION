# 06 - Utilisateurs (admin) (`admin`)

## Contexte ecran

- **Route** : `AdminUsers` dans le `SettingsNavigator` (stack natif, `headerShown: false` — la navigation visible est fournie par le composant `AdminHeader`). Atteinte depuis `AdminHome` (Godmode). Param de route : aucun (`AdminUsers: undefined`).
- **Roles requis** : `MODERATOR`, `ADMIN`, `SUPER_ADMIN`. L'entree dans `SettingsScreen` n'est rendue que pour moderateur+ (gate UX). Les ecrans admin re-verifient le role cote serveur via `/api/admin/me` : un deep-link avec un compte sans privilege est rejete en 403. Un compte `guest`/`standard` (`USER`) ne doit jamais atteindre cet ecran ; s'il y parvient (deep-link), l'API renvoie 403 et l'ecran affiche l'etat erreur.
- **Comportements temps-reel** : AUCUN sur cet ecran. Pas de WebSocket, pas de LiveKit, pas de push. Le chargement est fait par TanStack Query (`useAdminUsersInfinite`) — pagination par curseur (`cursor`/`hasMore`/`nextCursor`), `limit: 50`. La liste ne se met pas a jour en live ; elle se rafraichit uniquement via pull-to-refresh, re-fetch ou invalidation de cache (apres une mutation depuis l'ecran detail). Le badge `online`/`offline` de l'avatar reflete `user.isOnline` au moment du fetch, PAS un statut de presence temps-reel.
- **Pre-conditions globales** : utilisateur authentifie avec role moderateur+, backend `:4000` joignable, reseau actif pour le premier chargement.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` → `Loader` plein ecran (label `common.loading` = « Loading… »).
  - **Erreur** : `isError || !data` → `EmptyState` (titre `admin.users.errorTitle` = « Impossible de charger les utilisateurs », corps `admin.users.errorBody` = « Vérifiez votre connexion et réessayez. »).
  - **Liste vide** (recherche/filtre sans resultat) → `EmptyState` via `ListEmptyComponent` (titre `admin.users.emptyTitle` = « Aucun utilisateur trouvé », corps `admin.users.emptyBody` = « Essayez une autre recherche ou un autre filtre. »).
  - **Pagination en cours** : `isFetchingNextPage` → `Loader` en pied de liste.
  - **Pull-to-refresh** : `isRefetching` controle l'indicateur natif (`refreshing`).
  - Recherche debouncee a 250 ms (`SEARCH_DEBOUNCE_MS`), trim applique ; chaine vide → param `q` non envoye.

## Matrice bouton

| #   | Bouton                            | Emplacement                    | Type                       | Locator reel                                                                                                                                                           | Pre-condition                        | Priorite |
| --- | --------------------------------- | ------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------- |
| 1   | Retour                            | Header (gauche)                | navigation                 | `accessibilityLabel="Retour"` (MaterialIcons `arrow-back`, dans `AdminHeader`)                                                                                         | Ecran monte, pile navigable          | P1       |
| 2   | Champ de recherche                | Corps (sous header)            | input-submit               | placeholder `t('admin.users.searchPlaceholder')` = « Rechercher par nom ou @pseudo »                                                                                   | Liste chargee                        | P0       |
| 3   | Filtre rôle « Tous »              | Corps (barre de filtres)       | toggle                     | texte `t('admin.users.roles.all')` = « Tous », `accessibilityRole="radio"`, `accessibilityState={{selected}}`, `key="ALL"`                                             | Liste chargee                        | P1       |
| 4   | Filtre rôle « User »              | Corps (barre de filtres)       | toggle                     | texte `t('admin.users.roles.user')` = « User », `accessibilityRole="radio"`, `key="USER"`                                                                              | Liste chargee                        | P1       |
| 5   | Filtre rôle « Mod »               | Corps (barre de filtres)       | toggle                     | texte `t('admin.users.roles.mod')` = « Mod », `accessibilityRole="radio"`, `key="MODERATOR"`                                                                           | Liste chargee                        | P1       |
| 6   | Filtre rôle « Admin »             | Corps (barre de filtres)       | toggle                     | texte `t('admin.users.roles.admin')` = « Admin », `accessibilityRole="radio"`, `key="ADMIN"`                                                                           | Liste chargee                        | P1       |
| 7   | Filtre rôle « Super »             | Corps (barre de filtres)       | toggle                     | texte `t('admin.users.roles.super')` = « Super », `accessibilityRole="radio"`, `key="SUPER_ADMIN"`                                                                     | Liste chargee                        | P1       |
| 8   | Ligne utilisateur (ouvrir détail) | Corps (cellule de liste)       | list-item                  | `accessibilityLabel={`Open ${displayName ?? username ?? 'user'}`}` (ex. `Open Jane Doe`), `accessibilityRole="button"`                                                 | Au moins 1 utilisateur dans la liste | P0       |
| 9   | Pull-to-refresh                   | Corps (FlatList)               | realtime-action (re-fetch) | `onRefresh={refetch}` / `refreshing={isRefetching}` (pas de locator a11y dedie — control natif RefreshControl)                                                         | Liste chargee                        | P1       |
| 10  | Charger plus (scroll infini)      | Corps (FlatList, fin de liste) | list-item (chargement)     | `onEndReached={handleEndReached}` (`onEndReachedThreshold=0.5`) ; declenche `fetchNextPage` si `hasNextPage`. Loader pied : `accessibilityLabel={t('common.loading')}` | Plus d'une page (`hasNextPage=true`) | P2       |

Note : il n'existe AUCUN partial (`screens/partials/*`) pour cet ecran. Toute la composition est dans `AdminUsersScreen.tsx` + le composant partage `AdminHeader.tsx`. Aucun bouton destructif/de moderation n'est present sur CET ecran — les actions (suspendre / supprimer / changer le rôle) vivent dans `AdminUserDetail`. Cet ecran est une surface de recherche + navigation.

## Cas de test

### ADM-USERS-001 - Retour ferme l'ecran et revient a AdminHome

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi, ecran `AdminUsers` ouvert depuis `AdminHome`, aucune permission systeme requise
- **Etapes** :
  1. Depuis `AdminUsers`, taper sur l'icone retour (label « Retour ») en haut a gauche.
  2. Observer la transition de navigation.
- **Resultat attendu** : `navigation.goBack()` est appele (uniquement si `canGoBack()`), retour a l'ecran `AdminHome`.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent (`AdminHome`) est affiche ; KO si l'ecran reste sur la liste ou crash.
- **Donnees de test** : compte `admin@chathouse.test` (role ADMIN)
- **Duree estimee** : 1 min

### ADM-USERS-002 - Retour : multi-tap rapide n'empile pas de retours

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi, ecran `AdminUsers` ouvert, pile = [AdminHome, AdminUsers]
- **Etapes** :
  1. Taper 5 fois tres rapidement (< 1 s) sur l'icone « Retour ».
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul retour effectif vers `AdminHome` ; `goBack` n'est pas appele quand `canGoBack()` est faux, donc on ne sort pas du stack Settings ni de l'app.
- **Critere d'acceptation (OK/KO)** : OK si on s'arrete sur `AdminHome` sans ecran blanc ni fermeture de l'app ; KO si l'app quitte le stack Settings ou crash.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### ADM-USERS-003 - Retour accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, TalkBack (Android) ou VoiceOver (iOS) actif, police systeme a 200 %, contraste eleve active
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au premier element focusable du header.
  3. Verifier l'annonce vocale et la taille de cible.
- **Resultat attendu** : annonce « Retour, bouton ». Cible tactile >= 44x44 (header `minHeight: 44`, `hitSlop=12`). Le titre « Gestion Utilisateurs » reste lisible et non tronque de maniere bloquante a 200 %.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, annonce role+label et activable par double-tap ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### ADM-USERS-004 - Recherche par nom filtre la liste

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin, Wi-Fi, >= 2 utilisateurs en base dont « Jane Doe » (@janedoe)
- **Etapes** :
  1. Taper « Jane » dans le champ (placeholder « Rechercher par nom ou @pseudo »).
  2. Attendre ~300 ms (debounce 250 ms).
  3. Observer la liste.
- **Resultat attendu** : une requete `listUsers({ q: "Jane", limit: 50 })` est envoyee ; la liste se restreint a la ligne « Jane Doe » (label `Open Jane Doe`). Recherche egalement possible par @pseudo.
- **Critere d'acceptation (OK/KO)** : OK si seuls les utilisateurs correspondant a « Jane » sont affiches ; KO si la liste ne change pas ou ignore le terme.
- **Donnees de test** : terme `Jane` ; utilisateur attendu `{ id: "u1", displayName: "Jane Doe", username: "janedoe" }`
- **Duree estimee** : 2 min

### ADM-USERS-005 - Recherche : frappe rapide + perte reseau pendant le debounce

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin, reseau coupe-able (mode avion accessible), liste deja chargee
- **Etapes** :
  1. Taper rapidement « janedoe » caractere par caractere (chaque frappe < 250 ms d'intervalle).
  2. Verifier qu'une seule requete part apres l'arret de la frappe (debounce).
  3. Effacer tout le champ → param `q` redevient `undefined`, la liste complete revient.
  4. Couper le reseau (mode avion), retaper « Jane », attendre le debounce.
  5. Reactiver le reseau.
- **Resultat attendu** : etape 2 — une seule requete reseau (pas une par caractere). Etape 3 — chaine vide (trim) → `q` non envoye, liste complete. Etape 4 — la requete echoue, etat `EmptyState` erreur (« Impossible de charger les utilisateurs » / « Vérifiez votre connexion et réessayez. »). Etape 5 — un pull-to-refresh ou re-fetch restaure la liste.
- **Critere d'acceptation (OK/KO)** : OK si pas de tempete de requetes, debounce respecte, l'etat erreur s'affiche hors-ligne puis recupere au retour reseau ; KO si requetes par frappe, crash, ou liste figee apres reconnexion.
- **Donnees de test** : terme `janedoe` ; sequence reseau : ON → OFF → ON
- **Duree estimee** : 4 min

### ADM-USERS-006 - Recherche accessible et police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, lecteur d'ecran actif, police a 200 %, contraste eleve
- **Etapes** :
  1. Avec TalkBack/VoiceOver, focus sur le champ de recherche.
  2. Verifier l'annonce du placeholder « Rechercher par nom ou @pseudo ».
  3. Saisir « Mod » via le clavier accessible ; verifier `autoCapitalize="none"` et `autoCorrect={false}` (pas de majuscule auto ni correction).
- **Resultat attendu** : le champ est annonce comme zone de saisie editable avec son placeholder ; le texte saisi reste « Mod » sans capitalisation/correction imposee ; le champ reste utilisable et non tronque a 200 %.
- **Critere d'acceptation (OK/KO)** : OK si le champ est focusable, annonce son intitule et accepte la saisie sans transformation ; KO sinon.
- **Donnees de test** : terme `Mod`
- **Duree estimee** : 3 min

### ADM-USERS-007 - Filtre rôle applique le param role et met a jour la liste

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi, utilisateurs de differents rôles en base (au moins 1 ADMIN, 1 USER)
- **Etapes** :
  1. Sur la barre de filtres, taper sur la puce « Admin » (locator texte « Admin », role radio, key `ADMIN`).
  2. Observer la puce selectionnee (style `filterChipOn`, `accessibilityState.selected = true`).
  3. Observer la liste.
- **Resultat attendu** : `roleFilter` = `ADMIN` → requete `listUsers({ role: "ADMIN", limit: 50 })` ; seules les lignes avec `appRole=ADMIN` (badge accent #FF6F61) sont listees. La puce « Tous » repasse a l'etat non selectionne.
- **Critere d'acceptation (OK/KO)** : OK si la liste ne contient que des ADMIN et la puce « Admin » est marquee selectionnee ; KO sinon.
- **Donnees de test** : filtre `ADMIN`
- **Duree estimee** : 2 min

### ADM-USERS-008 - Filtre rôle : bascule rapide entre puces + combinaison avec recherche

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi/latence simulee, liste chargee
- **Etapes** :
  1. Taper rapidement, dans l'ordre et en < 1 s : « User », « Mod », « Admin », « Super », « Tous ».
  2. Saisir « jane » dans la recherche, puis taper « User ».
  3. Simuler 2 s de latence reseau et observer.
- **Resultat attendu** : un seul filtre actif a la fin (« Tous » apres l'etape 1), pas d'etat incoherent (un seul radio selectionne a tout instant). Etape 2 — la requete combine `q="jane"` ET `role="USER"`. Sous latence, le `Loader`/etat de chargement s'affiche puis la liste correcte arrive ; pas de melange de resultats de filtres precedents (la cle de cache `usersInfinite` inclut `{q, role, limit}`).
- **Critere d'acceptation (OK/KO)** : OK si exactement une puce selectionnee, recherche+rôle cumulables, aucun resultat perime affiche ; KO si plusieurs puces actives ou resultats melanges.
- **Donnees de test** : sequence de filtres ci-dessus ; combinaison `{ q: "jane", role: "USER" }`
- **Duree estimee** : 4 min

### ADM-USERS-009 - Filtres rôle accessibles comme groupe radio

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, TalkBack/VoiceOver actif, police 200 %, contraste eleve
- **Etapes** :
  1. Balayer a travers les 5 puces de filtre.
  2. Pour chaque puce, ecouter l'annonce du role et de l'etat selectionne.
  3. Double-taper « Mod » pour l'activer.
- **Resultat attendu** : chaque puce est annoncee comme bouton radio avec son label (« Tous »/« User »/« Mod »/« Admin »/« Super ») et son etat (selectionne/non selectionne via `accessibilityState.selected`). Cible >= 44 (chip `minHeight: 44`). A 200 %, le texte des puces (avec `flexWrap`) passe a la ligne sans tronquer.
- **Critere d'acceptation (OK/KO)** : OK si chaque puce annonce role radio + label + etat et que l'activation change la selection annoncee ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### ADM-USERS-010 - Ouvrir le detail d'un utilisateur depuis une ligne

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin, Wi-Fi, au moins l'utilisateur « Jane Doe » (id `u1`) dans la liste
- **Etapes** :
  1. Taper sur la ligne « Jane Doe » (locator `Open Jane Doe`).
  2. Observer la navigation.
- **Resultat attendu** : `navigation.navigate('AdminUserDetail', { userId: 'u1' })` ; ouverture de l'ecran detail de Jane Doe.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran `AdminUserDetail` s'ouvre avec `userId='u1'` ; KO si aucune navigation ou mauvais id.
- **Donnees de test** : utilisateur `{ id: "u1", displayName: "Jane Doe" }`
- **Duree estimee** : 1 min

### ADM-USERS-011 - Ligne utilisateur : multi-tap rapide + perte reseau a l'ouverture

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin, reseau coupe-able, liste chargee avec « Jane Doe »
- **Etapes** :
  1. Taper 4 fois tres vite (< 800 ms) sur « Open Jane Doe ».
  2. Couper le reseau (mode avion).
  3. Sur l'ecran detail ouvert, observer le chargement de `useAdminUser`.
  4. Reactiver le reseau et re-fetch.
- **Resultat attendu** : etape 1 — un seul push de l'ecran `AdminUserDetail` (pas 4 ecrans empiles). Etape 3 — l'ecran detail affiche son etat de chargement/erreur (hors-ligne), pas de crash. Etape 4 — les donnees du detail se chargent.
- **Critere d'acceptation (OK/KO)** : OK si une seule navigation, aucun crash hors-ligne, recuperation au retour reseau ; KO si ecrans empiles, crash, ou ecran fige.
- **Donnees de test** : utilisateur `u1` ; reseau ON → OFF → ON
- **Duree estimee** : 3 min

### ADM-USERS-012 - Ligne utilisateur : label accessible et fallback de nom

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, lecteur d'ecran actif, police 200 %, contraste eleve, utilisateurs avec `displayName`, ou seulement `username`, ou aucun des deux
- **Etapes** :
  1. Avec TalkBack/VoiceOver, balayer sur une ligne utilisateur avec `displayName` (« Jane Doe »).
  2. Balayer sur une ligne sans `displayName` mais avec `username` (« janedoe »).
  3. Balayer sur une ligne sans nom (fallback « user »).
  4. Verifier la lisibilite des badges rôle/Suspendu/Supprimé a 200 %.
- **Resultat attendu** : annonces respectives « Open Jane Doe, bouton », « Open janedoe, bouton », « Open user, bouton » (fallback `'user'`). Les badges (`appRole`, « Suspendu » = `admin.users.badgeSuspended`, « Supprimé » = `admin.users.badgeDeleted`) restent distincts visuellement (ADMIN en #FF6F61 ne se confond pas avec le rouge danger des badges suspendu/supprimé) et lisibles a 200 %.
- **Critere d'acceptation (OK/KO)** : OK si chaque ligne est annoncee « Open <nom> bouton » avec le bon fallback et badges distincts/lisibles ; KO sinon.
- **Donnees de test** : 3 utilisateurs — `{displayName:"Jane Doe"}`, `{displayName:null, username:"janedoe"}`, `{displayName:null, username:null}`
- **Duree estimee** : 4 min

### ADM-USERS-013 - Ligne utilisateur : reflet d'une mutation faite depuis le detail (synchro cache)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes admin (A et B) sur 2 appareils, Wi-Fi, meme utilisateur cible « Jane Doe » (id `u1`)
- **Etapes** :
  1. Admin A ouvre `AdminUsers`, voit « Jane Doe » sans badge « Suspendu ».
  2. Admin A ouvre le detail de Jane et la suspend (mutation `useSuspendUser`) → invalidation `[...admin,'users']`.
  3. Admin A revient sur la liste `AdminUsers`.
  4. Admin B fait un pull-to-refresh sur sa propre liste `AdminUsers`.
- **Resultat attendu** : pour Admin A, au retour, la liste se re-fetch (cache invalide) et « Jane Doe » porte desormais le badge « Suspendu ». Pour Admin B, apres pull-to-refresh, le badge « Suspendu » apparait aussi (pas de push temps-reel : la synchro passe par re-fetch/refresh, conformement a l'absence de WebSocket sur cet ecran).
- **Critere d'acceptation (OK/KO)** : OK si le badge « Suspendu » apparait chez A au retour (invalidation) et chez B apres refresh ; KO si la liste reste perimee malgre le refresh.
- **Donnees de test** : utilisateur cible `u1` ; mutation `suspend(u1, { reason:"Spam", durationMinutes:1440 })`
- **Duree estimee** : 5 min

### ADM-USERS-014 - Pull-to-refresh recharge la liste

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi, liste deja affichee
- **Etapes** :
  1. Tirer la liste vers le bas (geste pull-to-refresh).
  2. Observer l'indicateur de rafraichissement natif.
- **Resultat attendu** : `refetch()` est declenche, `isRefetching=true` affiche l'indicateur, puis la liste se met a jour (nouveaux utilisateurs / changements de statut) et l'indicateur disparait.
- **Critere d'acceptation (OK/KO)** : OK si l'indicateur apparait puis la liste est rafraichie ; KO si rien ne se passe ou l'indicateur reste bloque.
- **Donnees de test** : N/A
- **Duree estimee** : 1 min

### ADM-USERS-015 - Pull-to-refresh : repetition rapide + coupure reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, reseau coupe-able, liste affichee
- **Etapes** :
  1. Declencher le pull-to-refresh 3 fois de suite rapidement.
  2. Pendant un refresh, couper le reseau (mode avion).
  3. Observer l'etat.
  4. Reactiver le reseau et refaire un pull-to-refresh.
- **Resultat attendu** : pas de requetes empilees incoherentes (TanStack Query deduplique/annule) ; sous coupure, le refresh echoue proprement (l'indicateur s'arrete, etat erreur si plus aucune donnee), pas de crash ; au retour reseau, le pull-to-refresh restaure la liste.
- **Critere d'acceptation (OK/KO)** : OK si aucun blocage de l'indicateur, aucun crash hors-ligne, recuperation au retour reseau ; KO si indicateur fige, crash, ou liste figee.
- **Donnees de test** : reseau ON → OFF (pendant refresh) → ON
- **Duree estimee** : 3 min

### ADM-USERS-016 - Pull-to-refresh accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte admin, TalkBack/VoiceOver actif, police 200 %
- **Etapes** :
  1. Avec le lecteur d'ecran, effectuer le geste de rafraichissement (ou l'action « actualiser » exposee par le RefreshControl).
  2. Ecouter le retour vocal pendant le chargement.
- **Resultat attendu** : le geste de refresh est realisable au lecteur d'ecran ; pendant le chargement, le `Loader` (label `common.loading` = « Loading… ») est annoncable ; au terme, la liste mise a jour est navigable.
- **Critere d'acceptation (OK/KO)** : OK si le refresh est declenchable et l'etat de chargement annonce ; KO si le geste est inaccessible.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### ADM-USERS-017 - Scroll infini charge la page suivante

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte admin, Wi-Fi, > 50 utilisateurs en base (pour avoir `hasNextPage=true`)
- **Etapes** :
  1. Faire defiler la liste jusqu'a 50 % de la fin (`onEndReachedThreshold=0.5`).
  2. Observer le `Loader` de pied de liste.
  3. Continuer a defiler.
- **Resultat attendu** : `handleEndReached` appelle `fetchNextPage()` (uniquement si `hasNextPage && !isFetchingNextPage`) ; le `Loader` pied (label « Loading… ») s'affiche ; la page suivante (`cursor`/`nextCursor`) est concatenee a la liste sans doublon ni saut de scroll.
- **Critere d'acceptation (OK/KO)** : OK si les utilisateurs au-dela de la 1re page apparaissent, sans doublons ; KO si la liste s'arrete a 50 ou duplique des entrees.
- **Donnees de test** : base avec >= 120 utilisateurs ; `limit=50` → 3 pages
- **Duree estimee** : 2 min

### ADM-USERS-018 - Scroll infini : fin de pagination + perte reseau en cours de page

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte admin, reseau coupe-able, > 50 utilisateurs
- **Etapes** :
  1. Defiler pour charger la 2e page.
  2. Couper le reseau (mode avion) avant d'atteindre la 3e page, puis continuer a defiler.
  3. Reactiver le reseau et defiler a nouveau.
  4. Atteindre la derniere page (`hasMore=false`).
- **Resultat attendu** : etape 2 — la requete de page suivante echoue sans crash ; pas de boucle infinie de requetes (`fetchNextPage` garde-fou `!isFetchingNextPage`). Etape 3 — la pagination reprend. Etape 4 — quand `hasNextPage=false`, plus aucune requete n'est declenchee en bas de liste et le `Loader` pied disparait.
- **Critere d'acceptation (OK/KO)** : OK si pas de tempete de requetes ni crash hors-ligne, reprise au retour reseau, arret propre en fin de pagination ; KO sinon.
- **Donnees de test** : base >= 120 utilisateurs ; reseau ON → OFF → ON
- **Duree estimee** : 4 min

### ADM-USERS-019 - Etat initial : chargement, erreur et acces non autorise

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : (a) compte admin avec liste lente ; (b) backend renvoyant 500 ; (c) compte `USER`/standard deep-linkant vers `AdminUsers`
- **Etapes** :
  1. (a) Ouvrir l'ecran avec un reseau lent → observer le `Loader` plein ecran.
  2. (b) Forcer une erreur API (couper le backend) → recharger l'ecran.
  3. (c) Avec un compte non-admin, deep-linker `AdminUsers`.
- **Resultat attendu** : (a) `Loader` plein ecran (label « Loading… ») pendant `isLoading`. (b) `EmptyState` erreur (titre « Impossible de charger les utilisateurs », corps « Vérifiez votre connexion et réessayez. »). (c) l'API `/api/admin/me` renvoie 403 → la requete users echoue → etat erreur, aucune donnee sensible affichee.
- **Critere d'acceptation (OK/KO)** : OK si chaque etat s'affiche correctement et qu'un non-admin ne voit jamais la liste ; KO si la liste fuite a un non-admin ou si l'erreur n'est pas geree.
- **Donnees de test** : compte non autorise `user@chathouse.test` (role USER)
- **Duree estimee** : 4 min

### ADM-USERS-020 - Robustesse globale a la police agrandie et au contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte admin, police systeme a 200 %, contraste eleve, liste chargee avec utilisateurs aux noms longs et multiples badges
- **Etapes** :
  1. Regler la police a 200 % et activer le contraste eleve.
  2. Parcourir l'ecran : titre, champ de recherche, barre de filtres (5 puces avec `flexWrap`), lignes utilisateurs avec badges.
- **Resultat attendu** : aucun chevauchement bloquant ; titre tronque proprement (`numberOfLines={1}`), noms tronques (`numberOfLines={1}`) ; les puces de filtres passent a la ligne ; les badges rôle/Suspendu/Supprimé restent distincts et lisibles ; tous les controles restent atteignables et activables.
- **Critere d'acceptation (OK/KO)** : OK si la mise en page reste utilisable et tous les controles activables a 200 % + contraste eleve ; KO si du contenu interactif devient inatteignable ou illisible.
- **Donnees de test** : utilisateur au nom long, ex. `displayName="Maximilien Alexandre De La Tour Très Long"`, role ADMIN + suspendu
- **Duree estimee** : 3 min
