# 01 - Journal d'audit (admin) (`admin`)

## Contexte ecran

- **Route / navigation** : ecran de la pile admin (`AdminAuditLogScreen`), atteint depuis le tableau de bord admin. La pile native est configuree `headerShown: false`, donc la seule barre de navigation visible est le `AdminHeader` rendu par l'ecran (bouton retour + titre + sous-titre).
- **Roles requis** : `admin` uniquement. L'acces est garde cote API (`GET /admin/audit-log`) ; un compte `guest` ou `standard` qui atteindrait la route recevrait 401/403 et l'ecran basculerait sur l'etat d'erreur. Le hook `useAdminWhoami` (retry: false) sert de garde-fou amont dans la navigation admin.
- **Source de donnees** : hook `useAdminAuditLog({ limit: 100 })` -> `adminService.listAuditLog` -> `GET /admin/audit-log?limit=100`. Reponse paginee (`Paginated<AdminAuditLogEntry>` : `data`, `nextCursor`, `hasMore`). La pagination n'est PAS branchee a l'UI (pas de `onEndReached`, pas de fetch de page suivante) : seules les 100 premieres entrees sont affichees.
- **Comportements temps-reel** : AUCUN. Cet ecran ne consomme ni WebSocket, ni LiveKit, ni push. Les donnees ne se rafraichissent que sur action manuelle (pull-to-refresh) ou re-montage de l'ecran. Il n'y a pas de `refetchInterval` (contrairement a `useAdminStats`). Les nouvelles entrees d'audit n'apparaissent donc pas en direct ; il faut tirer pour rafraichir.
- **Pre-conditions globales** : authentifie en `admin`, reseau disponible pour le chargement initial. Apres le premier chargement, react-query met en cache la liste : un retour sur l'ecran affiche le cache puis rejoue la requete.
- **Etats de donnees pertinents** :
  - **Chargement initial** : `Loader` plein ecran, `accessibilityLabel` = `t('common.loading', 'Loading…')`.
  - **Erreur ou data absente** (`isError || !data`) : `EmptyState` avec `t('admin.audit.errorTitle')` / `t('admin.audit.errorBody')`. Note : dans cet etat il n'y a PAS de bouton "Reessayer" (l'EmptyState ne rend aucun enfant ici) ; la seule facon de relancer est de quitter/revenir sur l'ecran.
  - **Liste vide** (data presente, 0 entree) : `EmptyState` avec `t('admin.audit.emptyTitle')` / `t('admin.audit.emptyBody')`, dans la `FlatList` (donc le pull-to-refresh reste disponible).
  - **Liste peuplee** : `FlatList` de cellules `Row` (icone d'action + label + acteur + cible + metadonnees + horodatage + IP).
  - **Notion "non lus"** : N/A — cet ecran n'a aucun concept d'entrees lues/non lues.
- **Particularite interactivite** : c'est un ecran de CONSULTATION en lecture seule. Les cellules `Row` sont `accessible` (label compose pour lecteur d'ecran) mais NE sont PAS pressables (aucun `onPress`, aucun swipe, aucun long-press). Les seuls elements reellement actionnables sont : le bouton retour du header et le pull-to-refresh de la liste.

## Matrice bouton

| #   | Bouton                          | Emplacement             | Type                             | Locator reel                                                                                                                                                           | Pre-condition                                                   | Priorite |
| --- | ------------------------------- | ----------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| 1   | Retour                          | Header (`AdminHeader`)  | navigation                       | `accessibilityLabel="Retour"` (texte litteral, role `button`) ; icone `MaterialIcons name="arrow-back"`                                                                | Une vue precedente dans la pile (`navigation.canGoBack()` vrai) | P1       |
| 2   | Pull-to-refresh                 | Corps (FlatList)        | realtime-action (refetch reseau) | Geste natif `RefreshControl` (FlatList `onRefresh={refetch}`, `refreshing={isRefetching}`) — pas de label texte ; cible la `FlatList` / le spinner de rafraichissement | Etat liste/vide affiche (FlatList montee), compte `admin`       | P1       |
| 3   | Cellule d'audit (lecture seule) | Corps (FlatList, `Row`) | list-item (NON pressable)        | `accessibilityLabel` compose = `"<acteur>, → <cible>, <label action>, <horodatage>"` (ex. `"Mod One, → Target Two, Utilisateur suspendu, 31 janv. 2024 13:05"`)        | Au moins 1 entree dans `data.data`                              | P2       |

Note : aucun FAB, switch, toggle, lien legal, input, ni action destructive sur cet ecran. L'element #3 est liste pour la couverture accessibilite mais n'emet aucune action au tap (il n'a pas de `onPress`).

## Cas de test

### ADM-AUDIT-001 - Retour ferme l'ecran et revient a la vue precedente

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `admin` connecte ; reseau Wi-Fi ; ecran Journal d'audit atteint depuis le dashboard admin (une vue precedente existe dans la pile) ; aucune permission speciale requise.
- **Etapes** :
  1. Depuis le dashboard admin, ouvrir l'entree "Journal d'audit".
  2. Attendre l'affichage du header (titre `t('admin.audit.title')` = "Journal d'audit", sous-titre "Toutes les actions privilegiees").
  3. Taper le bouton retour (icone fleche, `accessibilityLabel="Retour"`).
- **Resultat attendu** : `navigation.goBack()` est declenche ; l'ecran Journal d'audit se ferme et l'app revient sur la vue precedente (dashboard admin). Aucun appel reseau supplementaire vers `/admin/audit-log` n'est emis par ce tap.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent reprend le focus et l'audit log disparait ; KO si l'ecran reste affiche ou si l'app crashe.
- **Donnees de test** : compte admin de test `admin.qa@chathouse.test` / mot de passe `Qa!admin2026`.
- **Duree estimee** : 2 min

### ADM-AUDIT-002 - Retour : multi-clic rapide et absence d'historique

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `admin` ; deux scenarios : (a) ecran avec vue precedente, (b) ecran ouvert en racine de pile (cas theorique `canGoBack()` faux) ; reseau indifferent.
- **Etapes** :
  1. Scenario (a) : sur l'ecran Journal d'audit, taper TRES rapidement 5 fois de suite le bouton "Retour".
  2. Observer la pile de navigation apres les taps.
  3. Scenario (b) : si possible, atteindre l'ecran en tant que premiere vue de la pile (deep link) puis taper "Retour".
- **Resultat attendu** : Scenario (a) — un seul `goBack()` effectif ; on ne remonte pas de plusieurs ecrans d'un coup, pas de double pop ni d'ecran blanc/crash (le handler verifie `canGoBack()` avant chaque pop). Scenario (b) — `canGoBack()` retourne faux, `goBack()` n'est pas appele, l'ecran reste affiche sans crash.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash, aucun double-pop visible, et l'app reste dans un etat de navigation coherent ; KO si l'app remonte deux ecrans, fige, ou crashe.
- **Donnees de test** : compte admin `admin.qa@chathouse.test` ; deep link `chathouse://admin/audit-log` (scenario b).
- **Duree estimee** : 4 min

### ADM-AUDIT-003 - Retour accessible (TalkBack/VoiceOver + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `admin` ; lecteur d'ecran actif (TalkBack Android / VoiceOver iOS) ; taille de police systeme reglee au max ; mode contraste eleve active.
- **Etapes** :
  1. Activer TalkBack/VoiceOver et passer la police systeme a la plus grande taille.
  2. Ouvrir le Journal d'audit.
  3. Balayer pour parcourir les elements du header jusqu'au bouton retour.
  4. Double-taper pour l'activer.
- **Resultat attendu** : le lecteur annonce "Retour, bouton" (label `Retour`, role `button`). La zone tactile reste atteignable malgre le `hitSlop={12}` et la police agrandie (le bouton fait 36x36 + hitSlop). Le contraste de l'icone (`colors.text`) reste lisible. Le double-tap declenche le retour.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est annonce avec libelle + role, focusable, activable au double-tap, et que le titre n'est pas tronque au point de masquer la navigation ; KO si le bouton est ignore par le lecteur, sans libelle, ou non activable.
- **Donnees de test** : compte admin `admin.qa@chathouse.test`.
- **Duree estimee** : 4 min

### ADM-AUDIT-004 - Pull-to-refresh recharge le journal avec les dernieres entrees

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `admin` ; reseau Wi-Fi ; au moins 1 entree deja affichee ; une nouvelle action privilegiee a ete realisee cote backend depuis l'ouverture de l'ecran (ex. une suspension d'utilisateur via un autre admin).
- **Etapes** :
  1. Ouvrir le Journal d'audit et attendre la liste peuplee.
  2. Noter l'entree la plus recente en haut de liste.
  3. Faire generer une nouvelle entree d'audit cote serveur (autre admin suspend un user de test).
  4. Tirer la liste vers le bas (pull-to-refresh) et relacher.
- **Resultat attendu** : le spinner de rafraichissement apparait (`isRefetching` vrai), `refetch()` rejoue `GET /admin/audit-log?limit=100`, puis la nouvelle entree apparait en tete de liste. Le spinner disparait a la fin.
- **Critere d'acceptation (OK/KO)** : OK si la nouvelle entree (ex. action `USER_SUSPENDED`) s'affiche apres le pull et le spinner se masque ; KO si la liste ne change pas, le spinner reste bloque, ou l'ecran bascule en erreur.
- **Donnees de test** : action declenchee = suspendre `target.qa@chathouse.test` avec motif "spam" ; entree attendue label `t('admin.audit.roles.suspended')` = "Utilisateur suspendu", meta "Motif : spam".
- **Duree estimee** : 5 min

### ADM-AUDIT-005 - Pull-to-refresh : multi-tirage rapide + perte reseau / reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `admin` ; reseau commutable (mode avion atteignable) ; liste deja chargee.
- **Etapes** :
  1. Liste peuplee affichee.
  2. Activer le mode avion (hors-ligne).
  3. Tirer pour rafraichir 3 fois de suite tres rapidement.
  4. Observer le comportement (spinner, erreurs).
  5. Reactiver le reseau (Wi-Fi).
  6. Tirer pour rafraichir une derniere fois.
- **Resultat attendu** : hors-ligne, le ou les refetch echouent ; react-query conserve les donnees en cache, donc la liste DEJA affichee reste visible (elle ne bascule pas vers l'EmptyState d'erreur, car `data` reste defini par le cache). Le spinner se termine apres l'echec sans rester bloque. Aucun crash malgre les tirages multiples (refetch concurrents dedupliques par react-query). Apres reconnexion, le dernier pull recharge correctement la liste.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash, la liste cachee reste visible hors-ligne, le spinner se ferme, et le rafraichissement post-reconnexion reussit ; KO si l'app crashe, le spinner reste indefini, ou la liste disparait alors que le cache existait.
- **Donnees de test** : compte admin `admin.qa@chathouse.test` ; cycle avion ON->refresh x3->avion OFF->refresh.
- **Duree estimee** : 6 min

### ADM-AUDIT-006 - Pull-to-refresh accessible (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `admin` ; TalkBack/VoiceOver actif ; police au maximum ; liste peuplee.
- **Etapes** :
  1. Activer le lecteur d'ecran et agrandir la police.
  2. Ouvrir le Journal d'audit.
  3. Avec le lecteur, declencher l'action de rafraichissement (sur Android : action "Actualiser" du RefreshControl, ou geste a deux doigts selon la version ; sur iOS : rotor / geste de defilement vers le haut depuis le sommet).
- **Resultat attendu** : l'action de rafraichissement est atteignable au lecteur d'ecran ; l'etat de chargement est perceptible (annonce de progression ou maintien du focus) ; la liste reste navigable element par element apres rafraichissement, sans perte de focus brutale. Avec la police agrandie, les cellules grandissent sans tronquer les libelles d'action (label sur 1 ligne, meta sur 2 lignes max via `numberOfLines`).
- **Critere d'acceptation (OK/KO)** : OK si le rafraichissement est declenchable au lecteur d'ecran et les cellules restent lisibles a police max ; KO si l'action est inatteignable au lecteur ou si le contenu est tronque/illisible.
- **Donnees de test** : compte admin `admin.qa@chathouse.test`.
- **Duree estimee** : 5 min

### ADM-AUDIT-007 - Pull-to-refresh : synchronisation multi-admin (deux moderateurs)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes `admin` (Admin A sur device 1, Admin B sur device 2) ; reseau Wi-Fi pour les deux ; un compte `target` de test manipulable.
- **Etapes** :
  1. Admin A ouvre le Journal d'audit (liste peuplee).
  2. Admin B realise une action privilegiee (ex. lever une suspension sur `target.qa@chathouse.test`).
  3. Sur device 1, observer SANS rafraichir pendant ~30 s.
  4. Sur device 1, tirer pour rafraichir.
- **Resultat attendu** : Etape 3 — l'entree generee par Admin B n'apparait PAS automatiquement sur le device d'Admin A (l'ecran n'est pas temps-reel ; pas de WebSocket/refetchInterval). Etape 4 — apres le pull, l'entree d'Admin B (`USER_UNSUSPENDED`, "Suspension levee") apparait en tete, avec l'acteur = Admin B et la cible = target. Ce cas valide explicitement que la fraicheur depend du rafraichissement manuel.
- **Critere d'acceptation (OK/KO)** : OK si l'entree de B est absente avant le pull puis presente apres, avec acteur/cible corrects ; KO si elle apparait sans rafraichir (comportement inattendu non implemente) ou n'apparait jamais apres pull.
- **Donnees de test** : Admin A `admin.qa@chathouse.test`, Admin B `admin2.qa@chathouse.test`, cible `target.qa@chathouse.test` ; action = unsuspend ; entree attendue label "Suspension levee".
- **Duree estimee** : 8 min

### ADM-AUDIT-008 - Cellule d'audit : annonce accessible complete (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `admin` ; TalkBack/VoiceOver actif ; police agrandie + contraste eleve ; au moins une entree avec acteur, cible et metadonnees (ex. suspension avec motif).
- **Etapes** :
  1. Activer le lecteur d'ecran et agrandir la police.
  2. Ouvrir le Journal d'audit (liste peuplee, au moins l'entree de suspension de `target`).
  3. Balayer jusqu'a la premiere cellule d'audit et ecouter l'annonce.
  4. Tenter un double-tap sur la cellule.
- **Resultat attendu** : le lecteur annonce le label compose de la cellule, ex. "Mod One, → Target Two, Utilisateur suspendu, 31 janv. 2024 13:05" (issu de `accessibilityLabel` = acteur + cible + label action + horodatage). Le double-tap ne declenche AUCUNE navigation ni action (cellule volontairement non pressable, lecture seule). Le contenu reste lisible a police max (label sur 1 ligne, meta tronquee a 2 lignes).
- **Critere d'acceptation (OK/KO)** : OK si l'annonce contient acteur + cible + action + date dans un seul focus, et qu'aucune action parasite ne se declenche au double-tap ; KO si la cellule est silencieuse, annonce des fragments separes incoherents, ou declenche une navigation inattendue.
- **Donnees de test** : entree `id=a1`, acteur "Mod One" (@moderator), cible "Target Two" (@target), action `USER_SUSPENDED`, meta `{ reason: "spam" }`, IP `127.0.0.1`, date `2024-01-31T13:05:00Z`.
- **Duree estimee** : 5 min

### ADM-AUDIT-009 - Cellule d'audit : rendu des variantes d'action et metadonnees

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `admin` ; journal contenant plusieurs types d'actions (`USER_ROLE_CHANGED`, `ROOM_FORCE_ENDED`, `GODMODE_ACCESS`, `IMPERSONATION_STARTED`...) ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir le Journal d'audit avec un jeu de donnees varie.
  2. Faire defiler la liste.
  3. Verifier pour chaque type d'action : l'icone (`ACTION_ICON`), le label traduit (`getActionLabel`), et la meta formatee (`from → to`, "Motif : ...", "jusqu'au ...", titre entre guillemets).
- **Resultat attendu** : chaque entree affiche l'icone correcte (ex. `star` pour role change, `stop-circle` pour room fermee, `visibility` pour god mode), le label FR correct (ex. "Role modifie", "Room fermee de force", "Acces god mode"), et la meta concatenee par " · " quand plusieurs champs sont presents. L'horodatage et l'IP (si presente) s'affichent en bas. Les entrees sans acteur ou sans cible masquent proprement les avatars correspondants.
- **Critere d'acceptation (OK/KO)** : OK si chaque variante d'action rend l'icone + label + meta attendus sans champ manquant ni crash sur meta nulle ; KO si une icone/label est absent, une meta mal formatee, ou un rendu casse sur entree partielle.
- **Donnees de test** : entrees mixtes — `USER_ROLE_CHANGED` meta `{from:"user", to:"mod"}` ; `ROOM_FORCE_ENDED` meta `{title:"Room test", reason:"abus"}` ; `USER_SUSPENDED` meta `{reason:"spam", until:"2026-07-01T00:00:00Z"}` ; `GODMODE_ACCESS` meta null.
- **Duree estimee** : 6 min

### ADM-AUDIT-010 - Etat d'erreur de chargement (offline au premier chargement)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `admin` ; AUCUN cache prealable de l'audit log (premiere ouverture ou cache vide) ; mode avion active avant l'ouverture.
- **Etapes** :
  1. Activer le mode avion.
  2. Naviguer vers le Journal d'audit pour la premiere fois (cache vide).
  3. Observer l'etat affiche.
  4. Tenter de revenir en arriere (bouton "Retour") pour valider que la navigation reste fonctionnelle dans l'etat d'erreur.
- **Resultat attendu** : la requete echoue, `isError` vrai et `data` absente -> affichage de l'`EmptyState` "Impossible de charger le journal d'audit" / "Verifiez votre connexion et reessayez." Aucun bouton "Reessayer" n'est present (limite connue : il faut quitter/revenir). Le bouton "Retour" du header reste fonctionnel et permet de sortir.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran d'erreur s'affiche avec les bons libelles et que le retour fonctionne ; KO si l'app crashe, affiche un loader infini, ou si le retour est bloque.
- **Donnees de test** : compte admin `admin.qa@chathouse.test` ; cache vide (logout/login ou clear storage avant test).
- **Duree estimee** : 4 min

### ADM-AUDIT-011 - Etat liste vide vs etat d'erreur (distinction)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `admin` ; environnement ou le journal d'audit est reellement vide (instance fraiche, 0 action privilegiee enregistree) ; reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir le Journal d'audit sur une instance sans aucune entree d'audit.
  2. Observer l'etat affiche.
  3. Tirer pour rafraichir.
- **Resultat attendu** : la requete reussit (`data` defini, `data.data` vide) -> affichage de l'`EmptyState` "Aucune entree" / "Les actions privilegiees apparaitront ici." (et NON l'etat d'erreur). Le pull-to-refresh reste disponible car l'EmptyState est rendu DANS la FlatList (`ListEmptyComponent`). Tirer rejoue la requete sans crash.
- **Critere d'acceptation (OK/KO)** : OK si l'etat "vide" (et non "erreur") s'affiche et que le pull fonctionne ; KO si l'etat d'erreur s'affiche par erreur, ou si le pull est indisponible/crashe.
- **Donnees de test** : instance de test vierge, compte admin `admin.qa@chathouse.test`.
- **Duree estimee** : 3 min

### ADM-AUDIT-012 - Garde d'acces role non-admin

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` (non admin) ; reseau Wi-Fi ; tentative d'atteindre la route audit log (via deep link ou navigation forcee).
- **Etapes** :
  1. Se connecter avec un compte `standard`.
  2. Tenter d'atteindre l'ecran Journal d'audit (deep link `chathouse://admin/audit-log` ou manipulation de navigation).
  3. Observer le comportement.
- **Resultat attendu** : l'acces est refuse. Soit la navigation vers la pile admin est bloquee en amont (garde `useAdminWhoami`/route admin), soit `GET /admin/audit-log` renvoie 401/403 et l'ecran bascule sur l'`EmptyState` d'erreur sans jamais afficher de donnees d'audit. Aucune entree d'audit n'est exposee a un non-admin.
- **Critere d'acceptation (OK/KO)** : OK si aucune donnee d'audit n'est affichee a un compte standard (blocage navigation ou etat erreur) ; KO si des entrees d'audit s'affichent pour un non-admin.
- **Donnees de test** : compte standard `standard.qa@chathouse.test` / `Qa!user2026`.
- **Duree estimee** : 4 min

---

### Recapitulatif

- Elements interactifs reels : 3 (bouton Retour, pull-to-refresh, cellule accessible non pressable).
- Aucun comportement temps-reel : ecran de consultation, fraicheur via pull-to-refresh manuel uniquement.
- Cas de test : 12 (couvrant retour, pull-to-refresh, cellules, etats erreur/vide, garde de role, accessibilite et synchro multi-admin).
