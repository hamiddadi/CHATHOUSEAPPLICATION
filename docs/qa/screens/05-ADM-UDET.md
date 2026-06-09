# 05 - Detail utilisateur (admin) (`admin`)

## Contexte ecran

- **Route** : `AdminUserDetail` (param `{ userId: string }`), montee dans `SettingsNavigator` (Settings stack), `headerShown: false` -> le header est rendu par le composant `AdminHeader`.
- **Fichier principal** : `src/features/admin/screens/AdminUserDetailScreen.tsx`. Aucun partial (`screens/partials/` inexistant). Composants reutilises : `AdminHeader`, `Avatar`, `Button`, `EmptyState`, `Loader`, helper `promptForReason`.
- **Roles requis** : seul un compte staff peut atteindre l'ecran (acces conditionne par `useAdminWhoami` en amont). Le role courant `me.appRole` est lu via `useAdminWhoami` (defaut `USER`). Les actions visibles dependent du rang :
  - `canActOnTarget = ROLE_RANK[myRole] > ROLE_RANK[targetRole]` (rang STRICTEMENT superieur a la cible). Si faux -> section unique « Vous n'avez pas la permission d'agir sur cet utilisateur » et toutes les actions de moderation sont masquees.
  - Section Suspension visible si `canActOnTarget`.
  - Section Role, Investigation (Usurper) et Zone de danger (Supprimer) visibles uniquement si `isSuper` (`myRole >= SUPER_ADMIN`). Usurper + Supprimer exigent aussi `!user.deletedAt`.
- **Comportements temps-reel** : pas de WebSocket/LiveKit direct sur cet ecran. Effets « quasi temps-reel » cote serveur via REST + invalidation React Query :
  - Suspendre / Lever / Changer le role / Supprimer -> `useSetUserRole`/`useSuspendUser`/`useUnsuspendUser`/`useDeleteUser` invalident `adminKeys.user(id)` et `[...all,'users']` -> la fiche et la liste admin se rafraichissent ; cote utilisateur cible, une suspension/suppression coupe son acces a sa prochaine requete authentifiee (effet propage, pas push instantane).
  - Usurper (`impersonationStore.start`) -> recupere un token d'usurpation, l'injecte dans l'intercepteur axios, puis `navigation.popToTop()` : toutes les requetes suivantes de l'app partent au nom de l'utilisateur cible (action journalisee/audit).
  - Le badge en ligne/hors-ligne de l'`Avatar` reflete `user.isOnline` issu du dernier fetch (pas de live socket ici).
- **Pre-conditions globales** : reseau requis pour le fetch initial (`useAdminUser`). Sans data -> `Loader` (label `common.loading`) puis, si erreur/absence, `EmptyState` « Utilisateur introuvable » (`admin.userDetail.notFound`).
- **Etats de donnees pertinents** :
  - Chargement : `Loader` plein ecran (`accessibilityLabel = common.loading`).
  - Erreur / introuvable : `EmptyState` titre `admin.userDetail.notFound`, sans bouton (seul reste le geste systeme retour ; le header n'est PAS rendu dans cet etat).
  - Utilisateur suspendu (`suspendedUntil` futur) : badge cadenas « Suspendu jusqu'au … », et la section Suspension affiche le bouton « Lever la suspension » au lieu de la grille de presets.
  - Utilisateur supprime (`deletedAt` non null) : Usurper et Supprimer masques meme pour un super admin.
  - Hors-ligne / latence : les mutations remontent une `Alert` d'erreur (`common.error` / `common.actionFailed` ou message serveur via `errorMessage`).

## Matrice bouton

| #   | Bouton                                                                                      | Emplacement                                                           | Type         | Locator reel                                                                                                                                                 | Pre-condition                                             | Priorite |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------- |
| 1   | Retour                                                                                      | Header (`AdminHeader`)                                                | navigation   | `accessibilityLabel="Retour"` (icone `arrow-back`)                                                                                                           | `navigation.canGoBack()` vrai                             | P1       |
| 2   | Suspendre 1 heure                                                                           | Corps / section Suspension (grille presets)                           | destructive  | `accessibilityLabel="Suspendre 1 heure"` (label = `admin.userDetail.suspend1h`)                                                                              | `canActOnTarget` ET non suspendu                          | P0       |
| 3   | Suspendre 24 heures                                                                         | Corps / section Suspension                                            | destructive  | `accessibilityLabel="Suspendre 24 heures"` (`admin.userDetail.suspend24h`)                                                                                   | `canActOnTarget` ET non suspendu                          | P0       |
| 4   | Suspendre 7 jours                                                                           | Corps / section Suspension                                            | destructive  | `accessibilityLabel="Suspendre 7 jours"` (`admin.userDetail.suspend7d`)                                                                                      | `canActOnTarget` ET non suspendu                          | P0       |
| 5   | Suspendre Permanente                                                                        | Corps / section Suspension                                            | destructive  | `accessibilityLabel="Suspendre Permanente"` (`admin.userDetail.suspendPerm`)                                                                                 | `canActOnTarget` ET non suspendu                          | P0       |
| 6   | Lever la suspension                                                                         | Corps / section Suspension                                            | destructive  | label `admin.userDetail.unsuspendBtn` = « Lever la suspension »                                                                                              | `canActOnTarget` ET utilisateur suspendu                  | P0       |
| 7   | Definir le role USER                                                                        | Corps / section Role (grille)                                         | destructive  | `accessibilityLabel="Définir le rôle USER"`                                                                                                                  | `isSuper` ET `canActOnTarget` (desactive si role courant) | P0       |
| 8   | Definir le role MODERATOR                                                                   | Corps / section Role                                                  | destructive  | `accessibilityLabel="Définir le rôle MODERATOR"`                                                                                                             | `isSuper` ET `canActOnTarget` (desactive si role courant) | P0       |
| 9   | Definir le role ADMIN                                                                       | Corps / section Role                                                  | destructive  | `accessibilityLabel="Définir le rôle ADMIN"`                                                                                                                 | `isSuper` ET `canActOnTarget` (desactive si role courant) | P0       |
| 10  | Definir le role SUPER_ADMIN                                                                 | Corps / section Role                                                  | destructive  | `accessibilityLabel="Définir le rôle SUPER_ADMIN"`                                                                                                           | `isSuper` ET `canActOnTarget` (desactive si role courant) | P0       |
| 11  | Usurper                                                                                     | Corps / section Investigation                                         | destructive  | label `admin.userDetail.impersonateBtn` = « Usurper »                                                                                                        | `isSuper` ET `!user.deletedAt`                            | P0       |
| 12  | Supprimer le compte                                                                         | Corps / section Zone de danger                                        | destructive  | label `admin.userDetail.deleteBtn` = « Supprimer le compte »                                                                                                 | `isSuper` ET `!user.deletedAt`                            | P0       |
| 13  | Boutons de dialogue Alert (Confirmer / Annuler / Suspendre / Usurper / Supprimer le compte) | Modale systeme `Alert`                                                | submit       | textes `admin.userDetail.confirm`, `admin.userDetail.cancel`, `admin.userDetail.suspendBtn`, `admin.userDetail.impersonateBtn`, `admin.userDetail.deleteBtn` | declenchee par les boutons 2-12                           | P0       |
| 14  | Champ motif + bouton « Suspendre » (iOS `Alert.prompt`)                                     | Modale systeme prompt (iOS) / fallback motif « Moderation » (Android) | input-submit | bouton destructif texte `admin.userDetail.suspendBtn` ; saisie texte libre                                                                                   | iOS uniquement, declenchee par boutons 2-5                | P0       |

> Note : tous les boutons d'action (2 a 12) ouvrent d'abord une `Alert`/`prompt` de confirmation avant tout appel reseau. Aucun n'agit en un seul tap. La grille de presets de suspension et la grille de roles sont rendues dynamiquement (`.map`) : leurs locators sont generes a partir du label/role exact, listes ci-dessus.

## Cas de test

### ADM-UDET-001 - Retour ferme la fiche

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin, Wi-Fi, fiche utilisateur chargee depuis la liste admin, `canGoBack()` vrai.
- **Etapes** :
  1. Ouvrir une fiche utilisateur depuis l'ecran « Utilisateurs (admin) ».
  2. Attendre l'affichage du header (titre = displayName).
  3. Taper le bouton `accessibilityLabel="Retour"` (icone fleche).
- **Resultat attendu** : retour a l'ecran liste « Utilisateurs (admin) », la fiche est demontee, aucun appel reseau supplementaire.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent est affiche et la fiche n'est plus a l'ecran ; KO si rien ne se passe ou l'app reste sur la fiche.
- **Donnees de test** : userId `u1` (Jane Doe, USER).
- **Duree estimee** : 2 min

### ADM-UDET-002 - Retour multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, latence reseau simulee (Network Link Conditioner 3G/2 s), fiche chargee.
- **Etapes** :
  1. Ouvrir la fiche.
  2. Taper « Retour » 5 fois en moins d'1 seconde.
- **Resultat attendu** : une seule navigation effective (un seul `goBack`), pas de double pop ni d'ecran blanc ; l'app reste stable sur l'ecran liste.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient exactement d'un niveau et reste utilisable ; KO si crash, double retour, ou pile de navigation incoherente.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 3 min

### ADM-UDET-003 - Retour accessibilite (TalkBack/VoiceOver + police XXL)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme maximale, contraste eleve actif.
- **Etapes** :
  1. Activer le lecteur d'ecran et regler la police a la taille maximale.
  2. Ouvrir la fiche, balayer jusqu'au premier element focusable.
- **Resultat attendu** : le lecteur annonce « Retour, bouton » ; cible tactile >= 44x44 (hitSlop 12 + 36px) ; le titre du header reste lisible (numberOfLines=1, pas de chevauchement avec l'icone).
- **Critere d'acceptation (OK/KO)** : OK si annonce correcte du role bouton + label « Retour » et activation possible au double-tap ; KO si non focusable, label vide ou cible < 44px.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 4 min

### ADM-UDET-004 - Suspension 1 heure (chemin nominal iOS)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin (rang > cible), cible USER non suspendue, iOS (prompt motif), Wi-Fi.
- **Etapes** :
  1. Ouvrir la fiche d'un USER non suspendu -> section « Suspension » affiche la grille de presets.
  2. Taper le bouton `accessibilityLabel="Suspendre 1 heure"`.
  3. Dans le prompt iOS « Suspendre l'utilisateur », laisser le champ vide.
  4. Taper le bouton destructif « Suspendre » (`admin.userDetail.suspendBtn`).
- **Resultat attendu** : `suspend.mutate` appele une fois avec `{ userId: 'u1', reason: 'Moderation', durationMinutes: 60 }` ; au succes la fiche s'invalide et re-fetch -> badge « Suspendu jusqu'au … » + le bouton « Lever la suspension » remplace la grille.
- **Critere d'acceptation (OK/KO)** : OK si le payload contient `durationMinutes: 60` et la fiche bascule en etat suspendu ; KO si pas d'appel, mauvaise duree, ou UI non mise a jour.
- **Donnees de test** : userId `u1`, motif laisse vide -> defaut « Moderation ».
- **Duree estimee** : 4 min

### ADM-UDET-005 - Suspension permanente avec motif personnalise

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin, cible MODERATOR (rang inferieur a admin) non suspendue, iOS, Wi-Fi.
- **Etapes** :
  1. Taper « Suspendre Permanente » (`accessibilityLabel="Suspendre Permanente"`).
  2. Saisir le motif « Spam repete + harcelement ».
  3. Confirmer via « Suspendre ».
- **Resultat attendu** : `suspend.mutate` appele avec `{ userId, reason: 'Spam repete + harcelement', durationMinutes: undefined }` (permanente = pas de minutes) ; succes -> etat suspendu sans date de fin definie cote serveur.
- **Critere d'acceptation (OK/KO)** : OK si `durationMinutes` absent/undefined et reason = texte saisi ; KO sinon.
- **Donnees de test** : reason `"Spam repete + harcelement"`.
- **Duree estimee** : 4 min

### ADM-UDET-006 - Suspension : multi-tap rapide + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin, cible USER non suspendue, mode Avion active APRES ouverture de la fiche (cache present), iOS.
- **Etapes** :
  1. Taper « Suspendre 24 heures » 4 fois tres rapidement.
  2. Observer : une seule modale prompt doit s'ouvrir (les taps suivants tombent sur la modale ouverte, pas sur le bouton).
  3. Activer le mode Avion. Confirmer « Suspendre » dans le prompt.
- **Resultat attendu** : au plus un `suspend.mutate` par confirmation ; en hors-ligne la mutation echoue et une `Alert` « Erreur » s'affiche avec message (`errorMessage` / `common.actionFailed`) ; aucun double envoi, la fiche reste dans son etat precedent (non suspendue).
- **Critere d'acceptation (OK/KO)** : OK si aucune suspension fantome, une seule requete par confirmation, et Alert d'erreur affichee hors-ligne ; KO si requetes multiples, crash, ou etat UI incoherent (badge suspendu sans confirmation serveur).
- **Donnees de test** : userId `u1`, reseau hors-ligne.
- **Duree estimee** : 6 min

### ADM-UDET-007 - Suspension accessibilite (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin, TalkBack/VoiceOver actif, police max, contraste eleve, cible USER non suspendue.
- **Etapes** :
  1. Naviguer au clavier/balayage jusqu'a la grille de presets.
  2. Ecouter l'annonce des boutons.
- **Resultat attendu** : chaque preset annonce « Suspendre 1 heure, bouton » / « Suspendre 24 heures, bouton » etc. (role bouton + label complet) ; cibles >= 44px (`minHeight: 44`) ; libelles en jaune `text-warning` restent lisibles en contraste eleve sans troncature ; pas de chevauchement en police XXL (grille `flexWrap`).
- **Critere d'acceptation (OK/KO)** : OK si chaque bouton est focusable, annonce role + label, activable au double-tap ; KO si label manquant/coupe ou cible < 44px.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 5 min

### ADM-UDET-008 - Suspension : synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils : (A) admin sur la fiche de la cible, (B) la cible USER connectee dans l'app. Wi-Fi sur les deux.
- **Etapes** :
  1. Sur A : suspendre la cible (« Suspendre 1 heure », confirmer).
  2. Sur B : effectuer une action authentifiee (rafraichir le feed / rejoindre une room).
  3. Sur un 3e appareil admin C : ouvrir la meme fiche / la liste utilisateurs.
- **Resultat attendu** : A affiche immediatement l'etat suspendu (invalidation locale) ; B se voit refuser/expulser des sa prochaine requete authentifiee (effet de suspension propage cote serveur) ; C, apres fetch, affiche aussi le badge « Suspendu jusqu'au … » (liste + fiche invalidees cote serveur, donnees coherentes au prochain load).
- **Critere d'acceptation (OK/KO)** : OK si les 3 vues convergent vers « suspendu » et B perd l'acces aux actions protegees ; KO si etat divergent durable ou B garde l'acces complet.
- **Donnees de test** : cible userId `u1`, duree 1h.
- **Duree estimee** : 8 min

### ADM-UDET-009 - Lever la suspension (nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin, cible USER actuellement suspendue (`suspendedUntil` futur), Wi-Fi.
- **Etapes** :
  1. Ouvrir la fiche d'un utilisateur suspendu -> bouton « Lever la suspension » visible (label `admin.userDetail.unsuspendBtn`).
  2. Taper « Lever la suspension ».
  3. Dans l'`Alert` « Lever la suspension », taper « Confirmer ».
- **Resultat attendu** : `unsuspend.mutate(userId)` appele ; succes -> invalidation de la fiche, le badge cadenas disparait, la grille de presets reapparait.
- **Critere d'acceptation (OK/KO)** : OK si la cible passe en etat non suspendu apres confirmation ; KO si pas d'appel ou badge persistant.
- **Donnees de test** : userId `u1` avec `suspendedUntil = 2099-01-01`.
- **Duree estimee** : 3 min

### ADM-UDET-010 - Lever la suspension : annulation + echec reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin, cible suspendue, latence/coupure reseau.
- **Etapes** :
  1. Taper « Lever la suspension », puis « Annuler » dans l'Alert -> aucune action.
  2. Re-taper « Lever la suspension » 3x rapidement -> une seule Alert ouverte.
  3. Couper le reseau, confirmer « Confirmer ».
- **Resultat attendu** : « Annuler » ne declenche aucun appel ; un seul `unsuspend.mutate` par confirmation ; hors-ligne -> `Alert` « Erreur » et la cible reste suspendue.
- **Critere d'acceptation (OK/KO)** : OK si annulation = no-op, pas de double appel, Alert d'erreur hors-ligne ; KO si appel sur annulation ou double envoi.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 5 min

### ADM-UDET-011 - Lever la suspension accessibilite

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin, cible suspendue, lecteur d'ecran actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton plein largeur « Lever la suspension ».
  2. Ecouter l'annonce, verifier l'etat loading.
- **Resultat attendu** : annonce « Lever la suspension, bouton » ; pendant `unsuspend.isPending` le bouton expose un etat de chargement (spinner) et reste annonce/desactive ; lisible en police XXL (fullWidth).
- **Critere d'acceptation (OK/KO)** : OK si focusable, annonce correcte et etat loading percu ; KO sinon.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 4 min

### ADM-UDET-012 - Changer le role -> ADMIN (super admin, nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible USER (rang inferieur), Wi-Fi. Section « Role » visible.
- **Etapes** :
  1. Ouvrir la fiche d'un USER -> section « Role » avec USER selectionne (desactive).
  2. Taper `accessibilityLabel="Définir le rôle ADMIN"`.
  3. Dans l'`Alert` « Changer le role », taper « Confirmer ».
- **Resultat attendu** : `setRole.mutate({ userId: 'u1', role: 'ADMIN' })` appele ; succes -> invalidation fiche + liste, le badge role et l'entete passent a ADMIN, le bouton ADMIN devient selectionne/desactive.
- **Critere d'acceptation (OK/KO)** : OK si payload role = ADMIN et UI reflete le nouveau role ; KO si role inchange ou mauvais payload.
- **Donnees de test** : userId `u1`, role cible `ADMIN`.
- **Duree estimee** : 4 min

### ADM-UDET-013 - Changer le role : bouton du role courant desactive + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible USER, latence reseau.
- **Etapes** :
  1. Verifier que le bouton du role courant (USER) est `disabled` (accessibilityState selected+disabled) : taper dessus -> aucune Alert.
  2. Taper « Définir le rôle SUPER_ADMIN » 4x rapidement -> une seule Alert.
  3. Couper le reseau et confirmer.
- **Resultat attendu** : aucun appel pour le role deja en place ; au plus une mutation par confirmation ; hors-ligne -> `Alert` « Erreur », role inchange.
- **Critere d'acceptation (OK/KO)** : OK si bouton courant inerte, pas de double appel, Alert d'erreur hors-ligne ; KO si l'appel part sur le role courant ou doublons.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 5 min

### ADM-UDET-014 - Changer le role accessibilite (etat selected/disabled)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible USER, lecteur d'ecran actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer la grille de roles.
  2. Ecouter l'annonce du role courant vs les autres.
- **Resultat attendu** : chaque bouton annonce « Définir le rôle <ROLE>, bouton » ; le role courant annonce « selectionne » + « non disponible/desactive » (accessibilityState selected+disabled) ; cibles >= 44px, libelles lisibles en contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si etat selected/disabled vocalise correctement et tous focusables ; KO si etat non annonce ou bouton inaccessible.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 5 min

### ADM-UDET-015 - Changer le role : synchro multi-admin

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils super admin (A, B) sur la fiche du meme USER, Wi-Fi.
- **Etapes** :
  1. Sur A : passer la cible a MODERATOR et confirmer.
  2. Sur B : rafraichir la fiche (pull/refetch) ou rouvrir.
- **Resultat attendu** : A reflete MODERATOR immediatement ; B, apres refetch, affiche MODERATOR (fiche + liste invalidees cote serveur) ; aucune perte de coherence ; les permissions de la cible changent cote serveur.
- **Critere d'acceptation (OK/KO)** : OK si A et B convergent vers MODERATOR ; KO si divergence durable.
- **Donnees de test** : userId `u1`, role `MODERATOR`.
- **Duree estimee** : 6 min

### ADM-UDET-016 - Usurper l'identite (nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible non supprimee (`deletedAt = null`), Wi-Fi. Section « Investigation » visible.
- **Etapes** :
  1. Taper le bouton « Usurper » (label `admin.userDetail.impersonateBtn`).
  2. Lire l'`Alert` « Usurper l'identite » incluant l'avertissement (`impersonateWarn`).
  3. Taper le bouton destructif « Usurper ».
- **Resultat attendu** : `startImpersonation(user.id)` resout, le token d'usurpation est pose dans l'intercepteur, puis `navigation.popToTop()` ramene a la racine ; l'app agit desormais en tant que cible (action journalisee dans l'audit log).
- **Critere d'acceptation (OK/KO)** : OK si session d'usurpation active + retour racine ; KO si pas de token, pas de navigation, ou erreur silencieuse.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 5 min

### ADM-UDET-017 - Usurper : echec serveur / token + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible valide, backend renvoyant 4xx/5xx sur `startImpersonation` (ou hors-ligne).
- **Etapes** :
  1. Taper « Usurper » 3x rapidement -> une seule Alert.
  2. Confirmer « Usurper » alors que le backend echoue.
- **Resultat attendu** : un seul appel `startImpersonation` ; en echec, le `catch` affiche une `Alert` « Erreur » (`errorMessage`/`common.actionFailed`) et il N'Y A PAS de `popToTop` -> on reste sur la fiche, pas de session d'usurpation pendante.
- **Critere d'acceptation (OK/KO)** : OK si Alert d'erreur + aucune navigation + aucun token applique ; KO si navigation malgre l'echec ou session corrompue.
- **Donnees de test** : userId `u1`, reponse serveur 500.
- **Duree estimee** : 5 min

### ADM-UDET-018 - Usurper accessibilite + avertissement

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible valide, lecteur d'ecran actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton « Usurper » et au texte d'info `impersonateInfo` sous le bouton.
  2. Declencher, ecouter le contenu de l'Alert.
- **Resultat attendu** : bouton annonce « Usurper, bouton » ; le texte d'info (« Chaque action est enregistree dans le journal d'audit ») est lisible/vocalise ; l'Alert systeme annonce titre + description + avertissement ; contraste suffisant en mode contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si bouton + avertissement accessibles et l'utilisateur comprend la consequence avant de confirmer ; KO si info inaccessible ou bouton non annonce.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 4 min

### ADM-UDET-019 - Supprimer le compte (nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible non supprimee, Wi-Fi. Section « Zone de danger » visible.
- **Etapes** :
  1. Taper le bouton « Supprimer le compte » (label `admin.userDetail.deleteBtn`, variante danger).
  2. Lire l'`Alert` « Supprimer l'utilisateur » (avertissement quasi-irreversible `deleteDesc`).
  3. Taper le bouton destructif « Supprimer le compte ».
- **Resultat attendu** : `del.mutate(user.id)` appele ; au succes `navigation.goBack()` ramene a la liste ; la fiche est demontee ; liste utilisateurs invalidee (compte marque supprime/banni).
- **Critere d'acceptation (OK/KO)** : OK si suppression confirmee + retour liste + cible disparue/marquee ; KO si pas d'appel ou aucune navigation.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 4 min

### ADM-UDET-020 - Supprimer : multi-tap rapide + perte reseau + loading

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible valide, reseau coupe au moment de la confirmation.
- **Etapes** :
  1. Taper « Supprimer le compte » 4x rapidement -> une seule Alert.
  2. Couper le reseau, confirmer « Supprimer le compte ».
  3. Observer l'etat `loading` du bouton (`del.isPending`).
- **Resultat attendu** : un seul `del.mutate` par confirmation ; bouton en etat loading pendant l'appel ; en echec reseau -> `Alert` « Erreur », pas de `goBack`, la fiche reste affichee et la cible n'est pas supprimee.
- **Critere d'acceptation (OK/KO)** : OK si pas de double suppression, loading visible, Alert d'erreur et fiche conservee ; KO si double appel, navigation malgre l'echec, ou suppression fantome.
- **Donnees de test** : userId `u1`, reseau hors-ligne.
- **Duree estimee** : 6 min

### ADM-UDET-021 - Supprimer accessibilite (danger + irreversibilite)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte SUPER_ADMIN, cible valide, lecteur d'ecran actif, police max, contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au bouton danger « Supprimer le compte ».
  2. Declencher, ecouter l'Alert.
- **Resultat attendu** : bouton annonce « Supprimer le compte, bouton » ; couleur danger conserve un contraste suffisant ; l'Alert vocalise l'avertissement quasi-irreversible (`deleteDesc`) avant le bouton destructif ; en police XXL le bouton fullWidth reste entierement lisible.
- **Critere d'acceptation (OK/KO)** : OK si bouton + avertissement accessibles et la gravite est comprehensible avant confirmation ; KO si label/avertissement inaccessible ou contraste insuffisant.
- **Donnees de test** : userId `u1`.
- **Duree estimee** : 4 min

### ADM-UDET-022 - Permissions insuffisantes : actions masquees

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte ADMIN agissant sur une cible SUPER_ADMIN (rang non strictement superieur). Wi-Fi.
- **Etapes** :
  1. Ouvrir la fiche d'un SUPER_ADMIN en tant qu'ADMIN.
  2. Parcourir la page.
- **Resultat attendu** : seule la note « Vous n'avez pas la permission d'agir sur cet utilisateur » (`noActionPerm`) est affichee ; AUCUNE section Suspension / Role / Investigation / Zone de danger n'est rendue ; seuls Retour et le scroll/infos restent disponibles.
- **Critere d'acceptation (OK/KO)** : OK si aucune action de moderation n'est presente et la note s'affiche ; KO si un bouton de moderation est rendu.
- **Donnees de test** : moi = ADMIN, cible = SUPER_ADMIN.
- **Duree estimee** : 3 min

### ADM-UDET-023 - Sections super-admin masquees pour un ADMIN

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte ADMIN (non super) agissant sur une cible USER. Wi-Fi.
- **Etapes** :
  1. Ouvrir la fiche d'un USER en tant qu'ADMIN.
  2. Verifier les sections rendues.
- **Resultat attendu** : section « Suspension » visible (car `canActOnTarget`), mais sections « Role », « Investigation » (Usurper) et « Zone de danger » (Supprimer) MASQUEES (reservees `isSuper`).
- **Critere d'acceptation (OK/KO)** : OK si seules Suspension + infos sont visibles ; KO si Role/Usurper/Supprimer apparaissent pour un ADMIN.
- **Donnees de test** : moi = ADMIN, cible = USER.
- **Duree estimee** : 3 min

### ADM-UDET-024 - Etat chargement et introuvable

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; cas A : reseau lent (fetch en cours) ; cas B : `userId` inexistant / erreur serveur.
- **Etapes** :
  1. Cas A : ouvrir une fiche avec reseau lent -> observer le `Loader` plein ecran.
  2. Cas B : ouvrir une fiche dont l'id n'existe pas / forcer une erreur.
- **Resultat attendu** : Cas A : `Loader` avec `accessibilityLabel = common.loading` (« Loading… »). Cas B : `EmptyState` titre « Utilisateur introuvable » (`admin.userDetail.notFound`), aucun bouton d'action ni header rendu (seul le geste systeme retour fonctionne).
- **Critere d'acceptation (OK/KO)** : OK si chaque etat s'affiche avec le bon libelle et aucune action de moderation n'est exposee ; KO si crash, ecran blanc, ou actions visibles sans data.
- **Donnees de test** : userId valide lent / userId `does-not-exist`.
- **Duree estimee** : 4 min
