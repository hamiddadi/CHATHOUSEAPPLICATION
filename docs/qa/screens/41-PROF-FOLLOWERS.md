# 41 - Abonnes / Abonnements (`profile`)

## Contexte ecran

- **Route** : `Followers` (stack `SettingsStackParamList`), parametres `{ userId: string; initialTab?: 'followers' | 'following' }`. L'ecran ouvre l'onglet `initialTab` s'il est fourni, sinon `followers`.
- **Fichier** : `src/features/profile/screens/FollowersScreen/FollowersScreen.tsx`. Pas de partials (verifie : seuls `index.ts`, `FollowersScreen.tsx`, `FollowersScreen.test.tsx`).
- **Roles requis** : `standard` et `admin` (tout compte authentifie ayant un profil). `guest` ne peut pas atteindre l'ecran (route sous le stack Settings, derriere l'auth). Le bouton Follow/Unfollow agit au nom du viewer connecte.
- **Comportements temps-reel** : AUCUN WebSocket / LiveKit / push direct sur cet ecran. Les actions Follow/Unfollow passent par REST (`POST /follow/:userId`, `DELETE /follow/:userId` via `profileService`). La "synchro" inter-ecrans est assuree par l'invalidation React Query : `useFollow`/`useUnfollow` invalident `profileKeys.detail(userId)` puis tout l'arbre `profileKeys.all`, ce qui rafraichit `me` (followingCount), les listes followers/following et le profil cible. La mise a jour multi-utilisateur n'est donc PAS poussee en push : elle apparait au prochain refetch (remontage / invalidation / focus). Les cas multi-utilisateur ci-dessous testent cette coherence eventuelle (et non un push instantane).
- **Pre-conditions globales** : compte authentifie ; reseau pour charger les listes (`GET /follow/:userId/followers` et `GET /follow/:userId/following`, envelope paginee `{ data, nextCursor, hasMore }` — seule la 1re page est consommee, pas de pagination infinie dans cet ecran) et pour muter le follow.
- **Etats de donnees pertinents** :
  - **Chargement** : `active.isLoading` -> `Loader` plein ecran (`accessibilityLabel` = `profile.loadingConnections`).
  - **Erreur** : `active.isError` -> `EmptyState` titre `profile.couldNotLoadConnections`, description `profile.pleaseTryAgain`.
  - **Liste vide** : `ListEmptyComponent` -> `EmptyState` `profile.noFollowers` (onglet followers) ou `profile.noFollowing` (onglet following), description `profile.emptyConnectionsHint`.
  - **Liste pleine** : `FlatList` de `UserRow` (avatar + displayName + @username + bouton Follow/Following).
  - **Etat pending** : la ligne dont l'id == `pendingId` (variables de la mutation en cours) affiche le bouton en `loading`. Un seul follow/unfollow en vol a la fois est materialise visuellement.
  - **Hors-ligne** : echec de la mutation -> `Alert` (`common.error` + `profile.actionFailed`) ; la query peut servir le cache (donnees periment) ou tomber en erreur si pas de cache.

## Matrice bouton

| #   | Bouton                     | Emplacement                            | Type               | Locator reel                                                                                                                        | Pre-condition                              | Priorite |
| --- | -------------------------- | -------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------- |
| 1   | Retour                     | Header (gauche)                        | navigation         | `accessibilityLabel` = `t('common.back', 'Back')` (icone MaterialIcons `arrow-back`, `accessibilityRole="button"`, `hitSlop={8}`)   | Ecran monte                                | P1       |
| 2   | Onglet Abonnes             | Barre d'onglets (TabToggle)            | toggle             | texte `t('profile.followers', 'Followers')`, `accessibilityRole="tab"`, `accessibilityState.selected`                               | Ecran monte                                | P1       |
| 3   | Onglet Abonnements         | Barre d'onglets (TabToggle)            | toggle             | texte `t('profile.following', 'Following')`, `accessibilityRole="tab"`, `accessibilityState.selected`                               | Ecran monte                                | P1       |
| 4   | Suivre / Suivi (par ligne) | Cellule de liste (`UserRow`, a droite) | list-item / submit | label `t('profile.follow', 'Follow')` (etat non suivi) ou `t('profile.following', 'Following')` (etat suivi) sur composant `Button` | Liste non vide, compte authentifie, reseau | P1       |

> Note : il n'y a ni FAB, ni champ de recherche, ni swipe/long-press, ni pull-to-refresh, ni lien legal sur cet ecran. La cellule `UserRow` elle-meme n'a pas d'`onPress` (pas de navigation vers le profil tape) ; seul le bouton Follow/Following de la cellule est actionnable.

## Cas de test

### PROF-FOLLOWERS-001 - Retour ferme l'ecran et revient en arriere

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, Wi-Fi, ecran `Followers` ouvert depuis le profil (pile de navigation avec un ecran precedent).
- **Etapes** :
  1. Ouvrir l'ecran Abonnes/Abonnements depuis un profil.
  2. Taper l'icone Retour (fleche) en haut a gauche (`accessibilityLabel` = `Back`).
  3. Observer la navigation.
- **Resultat attendu** : `navigation.goBack()` est appele ; retour a l'ecran precedent ; aucun crash, aucune requete reseau supplementaire declenchee par le retour.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est affiche apres le tap ; KO si l'ecran reste affiche ou crash.
- **Donnees de test** : `routeParams = { userId: 'me-1' }`.
- **Duree estimee** : 2 min

### PROF-FOLLOWERS-002 - Retour : multi-clic rapide n'empile pas les pops

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, latence reseau elevee (4G degradee simulee), ecran ouvert.
- **Etapes** :
  1. Taper tres rapidement 4 a 5 fois l'icone Retour.
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul retour effectif ; on ne depasse pas l'ecran cible (pas de double pop qui sortirait du stack) ; aucun ecran blanc / crash.
- **Critere d'acceptation (OK/KO)** : OK si on atterrit exactement sur l'ecran precedent (et pas deux ecrans en arriere) ; KO si l'app pop trop d'ecrans ou crashe.
- **Donnees de test** : N/A (action de navigation pure).
- **Duree estimee** : 3 min

### PROF-FOLLOWERS-003 - Retour : accessibilite lecteur d'ecran et police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au max ; contraste eleve active.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'a l'element Retour.
  3. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : l'element est annonce "Back, bouton" (`accessibilityRole="button"`, label `Back`) ; il est focusable et atteignable ; le titre `Connections` est lisible sans troncature en police max ; le double-tap declenche `goBack`.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce contient le label "Back" + role bouton ET le double-tap revient en arriere ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### PROF-FOLLOWERS-004 - Onglet Abonnes affiche la liste des abonnes

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, Wi-Fi, `userId` cible possedant des abonnes.
- **Etapes** :
  1. Ouvrir l'ecran (onglet `followers` par defaut, ou taper l'onglet `Followers`).
  2. Attendre la fin du `Loader`.
  3. Observer la liste.
- **Resultat attendu** : l'onglet `Followers` est selectionne (`accessibilityState.selected = true`, fond `bg-primary`) ; la `FlatList` affiche les `UserRow` (avatar, displayName, @username, bouton Follow/Following) provenant de `GET /follow/:userId/followers`.
- **Critere d'acceptation (OK/KO)** : OK si la liste des abonnes s'affiche et l'onglet est marque selectionne ; KO si liste vide alors que des abonnes existent ou mauvais onglet selectionne.
- **Donnees de test** : `userId = 'me-1'` ; reponse mock `{ data: [{ id:'u1', username:'janedoe', displayName:'Jane Doe', isFollowedByMe:false }], nextCursor:null, hasMore:false }`.
- **Duree estimee** : 3 min

### PROF-FOLLOWERS-005 - Bascule Abonnes <-> Abonnements : multi-clic rapide et reseau lent

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; reseau lent (latence 3-5 s sur les deux endpoints) ; les deux queries (followers/following) montees.
- **Etapes** :
  1. Taper rapidement en alternance `Followers` puis `Following` puis `Followers` (5-6 taps en < 2 s).
  2. Observer l'etat de selection et le contenu pendant les chargements.
- **Resultat attendu** : l'onglet refletant le dernier tap reste selectionne ; pas de melange des donnees (les abonnes ne s'affichent pas sous l'onglet abonnements) ; pendant le chargement de l'onglet actif son `Loader` apparait ; pas de crash ni de flicker bloquant. `active` suit toujours `tab`.
- **Critere d'acceptation (OK/KO)** : OK si l'onglet final selectionne == dernier tap ET le contenu correspond a cet onglet ; KO si desynchronisation onglet/contenu.
- **Donnees de test** : followers mock = 2 users, following mock = 3 users distincts.
- **Duree estimee** : 4 min

### PROF-FOLLOWERS-006 - Onglet Abonnements vide affiche l'EmptyState dedie

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, Wi-Fi, `userId` ne suivant personne.
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper l'onglet `Following`.
  3. Observer le corps de l'ecran.
- **Resultat attendu** : `EmptyState` titre `profile.noFollowing` ("Not following anyone yet") + description `profile.emptyConnectionsHint`. Aucun `UserRow` rendu.
- **Critere d'acceptation (OK/KO)** : OK si l'EmptyState "Not following anyone yet" est affiche ; KO si EmptyState "No followers yet" ou liste non vide.
- **Donnees de test** : following mock = `{ data: [], nextCursor:null, hasMore:false }`.
- **Duree estimee** : 2 min

### PROF-FOLLOWERS-007 - Onglets : accessibilite role tab + etat selectionne + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police systeme max ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer sur l'onglet `Followers` puis `Following`.
  3. Ecouter les annonces ; double-taper `Following`.
- **Resultat attendu** : chaque onglet est annonce avec son role "onglet" (`accessibilityRole="tab"`) et son etat selectionne/non selectionne (`accessibilityState.selected`) ; apres double-tap sur `Following`, son etat selectionne passe a vrai et est reannonce ; les libelles restent lisibles (pas tronques) en police max ; le contraste texte selectionne (`text-primary-on-container`) vs non selectionne (`text-ink-muted`) reste perceptible.
- **Critere d'acceptation (OK/KO)** : OK si le role "onglet" + l'etat selected correct sont annonces pour les deux onglets ET le changement est reannonce ; KO si role/etat manquant.
- **Donnees de test** : N/A.
- **Duree estimee** : 5 min

### PROF-FOLLOWERS-008 - Suivre un abonne depuis la liste (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, Wi-Fi, onglet Followers avec au moins un user `isFollowedByMe: false`.
- **Etapes** :
  1. Reperer la ligne de "Jane Doe" (`@janedoe`), bouton libelle `Follow`.
  2. Taper le bouton `Follow`.
  3. Observer le bouton et l'etat.
- **Resultat attendu** : `follow.mutate('u1', { onError: <fn> })` est appele (`POST /follow/u1`). Le bouton de cette ligne passe en `loading` tant que la mutation est pending. Au succes, `profileKeys.detail('u1')` puis `profileKeys.all` sont invalides ; au refetch le bouton bascule sur `Following` (variant `ghost`).
- **Critere d'acceptation (OK/KO)** : OK si `follow.mutate` est appele avec le bon id et le bouton reflete l'etat suivi apres invalidation ; KO si aucun appel ou mauvais id.
- **Donnees de test** : user `{ id:'u1', username:'janedoe', displayName:'Jane Doe', isFollowedByMe:false }`.
- **Duree estimee** : 3 min

### PROF-FOLLOWERS-009 - Ne plus suivre depuis la liste (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, Wi-Fi, ligne avec user `isFollowedByMe: true` (bouton `Following`, variant ghost).
- **Etapes** :
  1. Reperer la ligne avec le bouton `Following`.
  2. Taper le bouton `Following`.
  3. Observer.
- **Resultat attendu** : `unfollow.mutate(<id>, { onError })` est appele (`DELETE /follow/:id`) ; bouton en `loading` pendant la mutation ; au succes, invalidation `detail(id)` + `all` ; apres refetch le bouton repasse a `Follow` (variant `primary`).
- **Critere d'acceptation (OK/KO)** : OK si `unfollow.mutate` appele avec le bon id et le bouton repasse a `Follow` ; KO sinon.
- **Donnees de test** : user `{ id:'u2', displayName:'Bob', isFollowedByMe:true }`.
- **Duree estimee** : 3 min

### PROF-FOLLOWERS-010 - Suivre : multi-clic rapide + perte reseau -> Alert d'erreur

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; reseau coupe (mode avion) APRES chargement de la liste depuis le cache ; ligne avec bouton `Follow`.
- **Etapes** :
  1. Couper le reseau (avion).
  2. Taper 4-5 fois tres vite le bouton `Follow` d'une meme ligne.
  3. Attendre la reponse d'echec.
- **Resultat attendu** : pendant le 1er appel, le bouton est en `loading` (les taps suivants tombent sur un bouton occupe ; `pendingId` ne materialise qu'un follow en vol). A l'echec reseau, le callback `onError` declenche un `Alert` titre `common.error` ("Something went wrong") + message `profile.actionFailed` ("Action failed. Please try again."). L'invalidation `detail(id)` re-synchronise l'etat -> le bouton revient a `Follow` (pas bloque en "Following" optimiste).
- **Critere d'acceptation (OK/KO)** : OK si l'Alert d'erreur s'affiche ET l'etat du bouton revient a `Follow` apres l'echec ; KO si pas d'Alert, etat fige, ou follows multiples envoyes en double.
- **Donnees de test** : `follow` mutation forcee a rejeter (erreur reseau).
- **Duree estimee** : 5 min

### PROF-FOLLOWERS-011 - Bouton Suivre/Suivi : accessibilite lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police systeme max ; contraste eleve ; liste avec au moins une ligne.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer dans une `UserRow` : avatar, nom, @username, bouton.
  3. Ecouter l'annonce du bouton ; double-taper pour suivre.
- **Resultat attendu** : le bouton est annonce avec son libelle visible (`Follow` ou `Following`) et son role bouton ; en etat `loading` il reste annonce comme occupe/desactive si applicable ; le libelle ne deborde pas en police max ; le contraste `primary` (Follow) reste lisible. Le double-tap declenche follow/unfollow.
- **Critere d'acceptation (OK/KO)** : OK si le libelle exact (Follow/Following) est annonce, le bouton est activable au double-tap, et reste lisible en police max ; KO sinon.
- **Donnees de test** : user `{ id:'u1', displayName:'Jane Doe', username:'janedoe', isFollowedByMe:false }`.
- **Duree estimee** : 5 min

### PROF-FOLLOWERS-012 - Coherence multi-utilisateur du follow apres refetch

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes : viewer A (cet ecran) et cible B ; un 3e compte C observe le profil de B sur un autre device ; Wi-Fi.
- **Etapes** :
  1. Sur device A, dans la liste, suivre B (bouton `Follow` -> `POST /follow/B`).
  2. Au succes, l'invalidation `profileKeys.all` rafraichit sur A : le bouton de B passe a `Following`, le `followingCount` de A augmente, la liste followers/following de A se re-fetch.
  3. Sur device C (profil de B), declencher un refetch (re-focus / remontage de l'ecran profil).
  4. Comparer les compteurs.
- **Resultat attendu** : sur A, etat coherent immediatement apres invalidation (bouton Following, compteurs a jour). Sur C, le `followerCount` de B augmente APRES son prochain refetch (pas de push instantane : il n'y a pas de WebSocket sur ce flux). Aucune incoherence persistante apres refetch des deux cotes.
- **Critere d'acceptation (OK/KO)** : OK si, apres refetch des deux cotes, A montre "Following" et les compteurs followers(B)/following(A) sont coherents avec l'action ; KO si etat divergent persiste apres refetch.
- **Donnees de test** : A=`me-1`, B=`u1`, C=observateur ; endpoints REST follow standards.
- **Duree estimee** : 6 min

### PROF-FOLLOWERS-013 - Etat d'erreur de chargement de la liste (reseau + reconnexion)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; reseau coupe au moment du 1er chargement (pas de cache) ; onglet Followers.
- **Etapes** :
  1. Couper le reseau avant d'ouvrir l'ecran.
  2. Ouvrir l'ecran Abonnes.
  3. Observer l'etat ; puis retablir le reseau et declencher un refetch (changer d'onglet aller-retour ou remonter l'ecran).
- **Resultat attendu** : `active.isError` -> `EmptyState` titre `profile.couldNotLoadConnections` ("Couldn't load list") + description `profile.pleaseTryAgain` ("Please try again."). Apres reconnexion + refetch, la liste se charge normalement.
- **Critere d'acceptation (OK/KO)** : OK si l'EmptyState d'erreur s'affiche hors-ligne ET la liste se charge apres reconnexion+refetch ; KO si crash ou etat fige.
- **Donnees de test** : query forcee `isError: true` hors-ligne ; puis `data: [...]` apres refetch.
- **Duree estimee** : 4 min
