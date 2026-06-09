# 02 - Accueil admin (`admin`)

## Contexte ecran

- **Route** : `AdminHome` (stack `SettingsStack`, voir `src/core/navigation/types.ts`). Atteinte depuis Reglages -> Godmode.
- **Fichier** : `src/features/admin/screens/AdminHomeScreen.tsx`. Header partage : `src/features/admin/components/AdminHeader.tsx`.
- **Roles requis** : acces reserve aux roles admin. La hierarchie est `USER (0) < MODERATOR (1) < ADMIN (2) < SUPER_ADMIN (3)` (`ROLE_RANK` / `isAtLeast` dans `src/features/admin/types/admin.types.ts`).
  - Tuiles toujours visibles pour tout admin authentifie : `Gestion Utilisateurs`, `Signalements`.
  - Tuile `Rooms Actives` (force-end) : visible si `appRole >= ADMIN` (`canForceEnd`).
  - Tuile `Journal d'audit` + bloc `Exports CSV` : visibles si `appRole >= SUPER_ADMIN` (`canSeeAuditLog`).
  - Si `whoami` ne renvoie pas de role (`me` absent), `canForceEnd = false` et `canSeeAuditLog = false` -> seules les 2 premieres tuiles s'affichent et le sous-titre du header affiche `—`.
- **Comportements temps-reel / rafraichissement** :
  - `useAdminStats` (hook `src/features/admin/hooks/useAdmin.ts`) fait un `useQuery` avec `refetchInterval: 30_000` -> les KPI et les badges (Signalements ouverts, Lives) se rafraichissent automatiquement toutes les 30 s. Ce n'est PAS du WebSocket/LiveKit/push : c'est du polling REST sur `GET /admin/stats`. Aucun bouton de cet ecran n'emet sur WebSocket/LiveKit/push.
  - `useAdminWhoami` : `useQuery` `staleTime 60_000`, `retry: false` (l'absence de donnees = non-admin/non-connecte, on ne re-essaie pas pour eviter de spammer 401/403).
- **Pre-conditions globales** : compte admin connecte, token valide, backend joignable (`apiClient`). Les KPI proviennent de `GET /admin/stats`, le role de `GET /admin/me`.
- **Etats de donnees pertinents** :
  - Chargement : `isLoading` -> `Loader` plein ecran (`accessibilityLabel = admin.home.loading`).
  - Erreur / pas de stats : `isError || !stats` -> `EmptyState` titre `common.error`, description `admin.home.errorStats`.
  - Nominal : grille de 6 KPI (Utilisateurs, Live, Signalements, Suspendus, Nouveaux 24h, Messages 24h) + section Actions + (SUPER_ADMIN) section Exports CSV.
  - Badges : la tuile Signalements porte un badge = `stats.reports.open` (affiche `99+` au-dela de 99) ; la tuile Rooms porte un badge = `stats.rooms.live`. Badge masque si valeur <= 0.
  - Tonalites KPI : Signalements `warn` si `open > 0`, Suspendus `danger` si `suspended > 0`.

## Matrice bouton

| #   | Bouton                     | Emplacement                | Type       | Locator reel                                                                                                                         | Pre-condition                    | Priorite |
| --- | -------------------------- | -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------- |
| 1   | Retour                     | Header (haut gauche)       | navigation | `accessibilityLabel="Retour"` (icone `arrow-back`) ; appelle `navigation.goBack()` seulement si `canGoBack()`                        | Ecran non racine de la pile      | P1       |
| 2   | Gestion Utilisateurs       | Corps, section Actions     | navigation | `accessibilityLabel = t('admin.home.users')` = "Gestion Utilisateurs" (icone `people`) -> `navigate('AdminUsers')`                   | Admin connecte                   | P1       |
| 3   | Signalements               | Corps, section Actions     | navigation | `accessibilityLabel = t('admin.home.reports')` = "Signalements" (icone `flag`, badge = reports.open) -> `navigate('AdminReports')`   | Admin connecte                   | P1       |
| 4   | Rooms Actives              | Corps, section Actions     | navigation | `accessibilityLabel = t('admin.home.rooms')` = "Rooms Actives" (icone `stop-circle`, badge = rooms.live) -> `navigate('AdminRooms')` | `appRole >= ADMIN`               | P0       |
| 5   | Journal d'audit            | Corps, section Actions     | navigation | `accessibilityLabel = t('admin.home.auditLog')` = "Journal d'audit" (icone `history`) -> `navigate('AdminAuditLog')`                 | `appRole >= SUPER_ADMIN`         | P1       |
| 6   | Export CSV Utilisateurs    | Corps, section Exports CSV | submit     | `accessibilityLabel = t('admin.home.csvA11yUsers')` = "Exporter les utilisateurs en CSV" -> `handleExport('users')`                  | `appRole >= SUPER_ADMIN`, reseau | P1       |
| 7   | Export CSV Journal d'audit | Corps, section Exports CSV | submit     | `accessibilityLabel = t('admin.home.csvA11yAudit')` = "Exporter le journal d'audit en CSV" -> `handleExport('audit-log')`            | `appRole >= SUPER_ADMIN`, reseau | P1       |
| 8   | Export CSV Signalements    | Corps, section Exports CSV | submit     | `accessibilityLabel = t('admin.home.csvA11yReports')` = "Exporter les signalements en CSV" -> `handleExport('reports')`              | `appRole >= SUPER_ADMIN`, reseau | P1       |

> Note : la tuile "Rooms Actives" est classee P0 car elle est l'unique point d'entree vers l'action de moderation destructive `force-end` d'une room en live (impact temps-reel sur les participants connectes). Les exports CSV sont P1 (donnees sensibles RGPD mais non destructifs). Aucun bouton de cet ecran n'emet directement sur WebSocket/LiveKit/push : `isRealtime = false` partout ; le seul aspect temps-reel est le polling auto des stats (30 s). Les pull-to-refresh, swipe, long-press, toggle, switch, FAB et input ne sont PAS presents sur cet ecran (le `ScrollView` n'a pas de `RefreshControl`).

## Cas de test

### ADM-HOME-001 - Retour ferme l'ecran admin

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin (SUPER_ADMIN), Wi-Fi, ecran ouvert depuis Reglages (pile a 2 niveaux), aucune permission speciale.
- **Etapes** :
  1. Ouvrir Reglages puis taper "Godmode" pour arriver sur Accueil admin.
  2. Attendre l'affichage du dashboard (KPI visibles).
  3. Taper le bouton `Retour` (fleche en haut a gauche).
- **Resultat attendu** : retour a l'ecran Reglages, l'ecran Accueil admin est depile.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient sur Reglages sans crash ; KO si l'ecran reste affiche ou plante.
- **Donnees de test** : compte `superadmin@test.io` / role `SUPER_ADMIN`.
- **Duree estimee** : 2 min

### ADM-HOME-002 - Retour quand on est en racine de pile

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, Accueil admin charge comme premier ecran de sa pile (`canGoBack()` renvoie `false`), multi-clic rapide.
- **Etapes** :
  1. Afficher Accueil admin en situation racine de pile.
  2. Taper rapidement 5 fois de suite sur `Retour`.
- **Resultat attendu** : aucun effet (le code ne declenche `goBack()` que si `canGoBack()` est vrai) ; pas de navigation erronee, pas de double-pop, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran reste stable et aucun ecran fantome n'est depile ; KO si crash ou navigation incoherente.
- **Donnees de test** : meme compte SUPER_ADMIN.
- **Duree estimee** : 3 min

### ADM-HOME-003 - Retour au lecteur d'ecran et police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme reglee au maximum, contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande taille de police.
  2. Ouvrir Accueil admin.
  3. Balayer jusqu'au premier element focusable (le bouton retour).
- **Resultat attendu** : le lecteur annonce "Retour, bouton" (role `button`, label `Retour`) ; le `hitSlop={12}` garantit une cible >= 44pt ; double-tap declenche le retour. La grille KPI reste lisible sans troncature critique (le header est `numberOfLines={1}` mais le bouton reste atteignable).
- **Critere d'acceptation (OK/KO)** : OK si le bouton est annonce avec role+label corrects et activable ; KO si non focusable, non annonce, ou cible < 44pt.
- **Donnees de test** : compte SUPER_ADMIN.
- **Duree estimee** : 4 min

### ADM-HOME-004 - Naviguer vers Gestion Utilisateurs

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin connecte, stats chargees, Wi-Fi.
- **Etapes** :
  1. Sur Accueil admin, reperer la tuile "Gestion Utilisateurs" (section Actions, icone people).
  2. Taper la tuile.
- **Resultat attendu** : navigation vers l'ecran `AdminUsers` (`navigation.navigate('AdminUsers')`).
- **Critere d'acceptation (OK/KO)** : OK si l'ecran de gestion des utilisateurs s'ouvre ; KO sinon.
- **Donnees de test** : compte `admin@test.io` (role ADMIN) ou SUPER_ADMIN.
- **Duree estimee** : 2 min

### ADM-HOME-005 - Multi-clic rapide sur Gestion Utilisateurs

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, reseau avec latence simulee (throttle 3G / 1 s de latence), stats chargees.
- **Etapes** :
  1. Taper 4 fois tres rapidement sur la tuile "Gestion Utilisateurs".
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul ecran `AdminUsers` ouvert (le navigator dedoublonne, ou au pire l'utilisateur depile l'excedent) ; pas d'empilement de N copies, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si au plus un AdminUsers visible apres un seul retour ; KO si plusieurs instances empilees ou ecran fige.
- **Donnees de test** : compte ADMIN.
- **Duree estimee** : 3 min

### ADM-HOME-006 - Accessibilite tuile Gestion Utilisateurs

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, lecteur d'ecran actif, police agrandie, contraste eleve.
- **Etapes** :
  1. Activer TalkBack/VoiceOver et la grande police.
  2. Balayer jusqu'a la tuile "Gestion Utilisateurs".
- **Resultat attendu** : annonce "Gestion Utilisateurs, bouton" (role `button`, label = `t('admin.home.users')`) ; le hint texte "Recherche, roles, suspensions" reste lisible ; double-tap navigue.
- **Critere d'acceptation (OK/KO)** : OK si label et role corrects et tuile activable ; KO sinon.
- **Donnees de test** : compte ADMIN.
- **Duree estimee** : 3 min

### ADM-HOME-007 - Naviguer vers Signalements et lecture du badge

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin, `stats.reports.open > 0` (ex : 2 signalements ouverts), Wi-Fi.
- **Etapes** :
  1. Verifier que la tuile "Signalements" affiche un badge rouge avec le nombre de signalements ouverts (ex : 2).
  2. Taper la tuile.
- **Resultat attendu** : badge = `stats.reports.open` ; navigation vers `AdminReports` (`navigate('AdminReports')`).
- **Critere d'acceptation (OK/KO)** : OK si le badge correspond au compteur et l'ecran Signalements s'ouvre ; KO si badge errone ou pas de navigation.
- **Donnees de test** : fixture stats `reports: { open: 2, total: 19 }`.
- **Duree estimee** : 2 min

### ADM-HOME-008 - Badge Signalements limite >99 et rafraichissement

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, backend renvoyant `reports.open = 150`, puis simulation de perte reseau pendant le polling.
- **Etapes** :
  1. Charger l'ecran avec `reports.open = 150`.
  2. Verifier le badge.
  3. Couper le reseau (mode avion), attendre > 30 s (un cycle de `refetchInterval`).
  4. Retablir le reseau et attendre le cycle suivant.
- **Resultat attendu** : le badge affiche "99+" (et non 150). Pendant la coupure, l'ancienne valeur est conservee (pas de crash, pas de passage en EmptyState car `stats` reste en cache). Au retour reseau, la valeur se met a jour au prochain refetch (<= 30 s).
- **Critere d'acceptation (OK/KO)** : OK si "99+" affiche et la valeur se rafraichit apres reconnexion sans crash ; KO si nombre brut affiche ou ecran d'erreur a la coupure.
- **Donnees de test** : stats `reports.open = 150`.
- **Duree estimee** : 4 min

### ADM-HOME-009 - Accessibilite tuile Signalements (badge inclus)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin, lecteur d'ecran actif, police agrandie, contraste eleve, `reports.open = 2`.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'a la tuile "Signalements".
- **Resultat attendu** : annonce "Signalements, bouton" (label = `t('admin.home.reports')`). Verifier le contraste suffisant du badge rouge (`bg-danger`) sur le texte blanc.
- **Critere d'acceptation (OK/KO)** : OK si annonce correcte et contraste badge >= 4.5:1 ; KO sinon.
- **Donnees de test** : stats `reports.open = 2`.
- **Duree estimee** : 3 min

### ADM-HOME-010 - Acces a Rooms Actives (force-end) en tant qu'ADMIN

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `appRole >= ADMIN`, au moins 1 room live (`rooms.live > 0`), Wi-Fi.
- **Etapes** :
  1. Verifier que la tuile "Rooms Actives" (icone stop-circle) est visible avec un badge = nombre de rooms live.
  2. Taper la tuile.
- **Resultat attendu** : navigation vers `AdminRooms` (`navigate('AdminRooms')`), point d'entree de l'action destructive force-end.
- **Critere d'acceptation (OK/KO)** : OK si tuile visible pour ADMIN/SUPER_ADMIN et ouvre AdminRooms ; KO si tuile absente pour un ADMIN ou pas de navigation.
- **Donnees de test** : compte ADMIN, stats `rooms: { live: 5, total: 88 }`.
- **Duree estimee** : 2 min

### ADM-HOME-011 - Tuile Rooms Actives masquee pour MODERATOR/USER

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `appRole = MODERATOR` (ou whoami sans role, `me` absent), stats chargees.
- **Etapes** :
  1. Se connecter avec un compte MODERATOR autorise a voir le dashboard mais pas la moderation de rooms.
  2. Parcourir la section Actions.
  3. Taper rapidement la zone ou serait la tuile (test multi-clic a vide).
- **Resultat attendu** : la tuile "Rooms Actives" n'est PAS rendue (`canForceEnd = false`) ; impossible d'atteindre `AdminRooms` depuis cet ecran ; aucun effet des taps a vide.
- **Critere d'acceptation (OK/KO)** : OK si la tuile est totalement absente du DOM pour MODERATOR/role manquant ; KO si visible ou navigable.
- **Donnees de test** : compte MODERATOR ; cas limite `whoami` -> `{ data: undefined }`.
- **Duree estimee** : 3 min

### ADM-HOME-012 - Accessibilite tuile Rooms Actives

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte ADMIN, lecteur d'ecran actif, police agrandie, contraste eleve, `rooms.live = 5`.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'a la tuile "Rooms Actives".
- **Resultat attendu** : annonce "Rooms Actives, bouton" (label = `t('admin.home.rooms')`) ; le badge (5) reste lisible et n'interrompt pas l'annonce du label.
- **Critere d'acceptation (OK/KO)** : OK si label/role corrects et activable au double-tap ; KO sinon.
- **Donnees de test** : compte ADMIN, `rooms.live = 5`.
- **Duree estimee** : 3 min

### ADM-HOME-013 - Naviguer vers Journal d'audit en tant que SUPER_ADMIN

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `appRole = SUPER_ADMIN`, stats chargees, Wi-Fi.
- **Etapes** :
  1. Verifier la presence de la tuile "Journal d'audit" (icone history).
  2. Taper la tuile.
- **Resultat attendu** : navigation vers `AdminAuditLog` (`navigate('AdminAuditLog')`).
- **Critere d'acceptation (OK/KO)** : OK si l'ecran journal d'audit s'ouvre ; KO sinon.
- **Donnees de test** : compte SUPER_ADMIN.
- **Duree estimee** : 2 min

### ADM-HOME-014 - Journal d'audit masque pour ADMIN

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `appRole = ADMIN` (donc `canSeeAuditLog = false`), stats chargees.
- **Etapes** :
  1. Se connecter en ADMIN.
  2. Parcourir la section Actions.
- **Resultat attendu** : la tuile "Journal d'audit" et le bloc "Exports CSV" sont absents ; seules les tuiles Utilisateurs, Signalements, Rooms sont presentes (conforme au test `hides the audit-log tile and CSV exports for a non-super-admin`).
- **Critere d'acceptation (OK/KO)** : OK si Journal d'audit + Exports CSV absents pour ADMIN et Rooms toujours visible ; KO si l'un d'eux apparait.
- **Donnees de test** : compte ADMIN.
- **Duree estimee** : 3 min

### ADM-HOME-015 - Accessibilite tuile Journal d'audit

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, lecteur d'ecran actif, police agrandie, contraste eleve.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer jusqu'a la tuile "Journal d'audit".
- **Resultat attendu** : annonce "Journal d'audit, bouton" (label = `t('admin.home.auditLog')`) ; hint "Toutes les actions privilegiees" lisible ; double-tap navigue.
- **Critere d'acceptation (OK/KO)** : OK si label/role corrects ; KO sinon.
- **Donnees de test** : compte SUPER_ADMIN.
- **Duree estimee** : 3 min

### ADM-HOME-016 - Export CSV Utilisateurs (copie + feuille de partage)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, Wi-Fi, permission stockage/partage OK, aucun export en cours.
- **Etapes** :
  1. Dans la section Exports CSV, taper "Users" (label a11y "Exporter les utilisateurs en CSV").
  2. Attendre la fin de la requete `GET /admin/export/users.csv`.
- **Resultat attendu** : `adminService.exportCsv('users')` appele ; le CSV est copie dans le presse-papier (`Clipboard.setStringAsync`) puis la feuille de partage native s'ouvre (`Share.share`) avec le titre "Chathouse · export users". Le bouton passe en etat occupe (`opacity 0.5`, `accessibilityState.disabled = true`) pendant l'operation.
- **Critere d'acceptation (OK/KO)** : OK si `exportCsv('users')` est invoque, le presse-papier contient le CSV et la feuille de partage s'ouvre ; KO si rien ne se passe ou erreur.
- **Donnees de test** : reponse CSV `id,name\n1,a` (mock). Verifier collage du presse-papier dans un editeur de notes.
- **Duree estimee** : 3 min

### ADM-HOME-017 - Export CSV : double-clic et echec reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, reseau coupable (4G instable / 500 backend), exporter en cours possible.
- **Etapes** :
  1. Taper rapidement 3 fois sur "Users".
  2. Observer que les 3 boutons d'export (Users, Audit log, Reports) passent `disabled` pendant l'export (`exporting !== null`).
  3. Forcer un echec (couper le reseau ou backend en 500) sur l'appel.
- **Resultat attendu** : un seul appel `exportCsv` actif a la fois (le state `exporting` desactive tous les boutons via `disabled`). En cas d'echec, une `Alert` s'affiche : titre `common.error`, message `admin.home.exportError` ("Echec de l'export") ; `exporting` revient a `null` (boutons reactives) dans le `finally`.
- **Critere d'acceptation (OK/KO)** : OK si pas d'appels concurrents, Alert d'erreur affichee, boutons reactives apres echec ; KO si appels multiples, app figee, ou boutons restes desactives.
- **Donnees de test** : forcer `apiClient.get` a rejeter ; verifier message Alert FR "Echec de l'export".
- **Duree estimee** : 4 min

### ADM-HOME-018 - Accessibilite boutons Export CSV

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, lecteur d'ecran actif, police agrandie, contraste eleve.
- **Etapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer les 3 boutons d'export.
  3. Lancer un export et re-balayer pendant qu'il est en cours.
- **Resultat attendu** : annonces "Exporter les utilisateurs en CSV, bouton" / "Exporter le journal d'audit en CSV, bouton" / "Exporter les signalements en CSV, bouton" (labels = `csvA11yUsers` / `csvA11yAudit` / `csvA11yReports`). Pendant l'export, l'etat est annonce comme desactive (`accessibilityState.disabled = true`). Les boutons respectent `minHeight: 44` (cible tactile OK).
- **Critere d'acceptation (OK/KO)** : OK si les 3 labels distincts sont annonces, l'etat disabled est expose et cible >= 44pt ; KO sinon.
- **Donnees de test** : compte SUPER_ADMIN.
- **Duree estimee** : 4 min

### ADM-HOME-019 - Export CSV Journal d'audit

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, Wi-Fi, aucun export en cours.
- **Etapes** :
  1. Taper le bouton "Audit log" (label a11y "Exporter le journal d'audit en CSV").
  2. Attendre la requete.
- **Resultat attendu** : `adminService.exportCsv('audit-log')` appele (endpoint `GET /admin/export/audit-log.csv`), copie presse-papier + feuille de partage titre "Chathouse · export audit-log".
- **Critere d'acceptation (OK/KO)** : OK si `exportCsv('audit-log')` invoque et partage ouvert ; KO sinon.
- **Donnees de test** : mock CSV non vide.
- **Duree estimee** : 2 min

### ADM-HOME-020 - Export CSV Signalements

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, Wi-Fi, aucun export en cours.
- **Etapes** :
  1. Taper le bouton "Reports" (label a11y "Exporter les signalements en CSV").
  2. Attendre la requete.
- **Resultat attendu** : `adminService.exportCsv('reports')` appele (endpoint `GET /admin/export/reports.csv`), copie presse-papier + feuille de partage titre "Chathouse · export reports".
- **Critere d'acceptation (OK/KO)** : OK si `exportCsv('reports')` invoque et partage ouvert ; KO sinon.
- **Donnees de test** : mock CSV non vide.
- **Duree estimee** : 2 min

### ADM-HOME-021 - Export CSV volumineux (>50 000 caracteres, troncature partage)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte SUPER_ADMIN, backend renvoyant un CSV > 50 000 caracteres (gros export utilisateurs).
- **Etapes** :
  1. Taper "Users" sur un jeu de donnees volumineux.
  2. Inspecter le contenu de la feuille de partage puis le presse-papier.
- **Resultat attendu** : le presse-papier contient le CSV COMPLET ; le message de la feuille de partage est tronque a 50 000 caracteres avec le suffixe "…(truncated, full copy in clipboard)" (logique `csv.length > 50_000`). Pas de crash memoire.
- **Critere d'acceptation (OK/KO)** : OK si presse-papier complet + message de partage tronque avec mention ; KO si app plante ou presse-papier tronque aussi.
- **Donnees de test** : CSV genere de ~60 000 caracteres (ex : 2000 lignes).
- **Duree estimee** : 4 min

### ADM-HOME-022 - Etat de chargement (Loader)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte admin, reseau lent (latence 2 s sur `/admin/stats`).
- **Etapes** :
  1. Ouvrir Accueil admin avec une reponse stats retardee.
  2. Observer l'ecran pendant le chargement.
- **Resultat attendu** : un `Loader` plein ecran s'affiche, `accessibilityLabel = t('admin.home.loading')` = "Chargement des statistiques d'administration" ; aucun KPI ni bouton tant que `isLoading`.
- **Critere d'acceptation (OK/KO)** : OK si Loader visible et annonce a11y correcte pendant le chargement ; KO si ecran vide ou KPI prematures.
- **Donnees de test** : delai artificiel 2 s sur l'endpoint stats.
- **Duree estimee** : 2 min

### ADM-HOME-023 - Etat d'erreur des stats (EmptyState)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin, `/admin/stats` renvoie 500 ou timeout (`isError` ou `stats` absent), hors-ligne possible.
- **Etapes** :
  1. Forcer l'echec de `GET /admin/stats` (backend 500 ou mode avion).
  2. Ouvrir Accueil admin.
- **Resultat attendu** : `EmptyState` affiche, titre `common.error`, description `admin.home.errorStats` = "Impossible de charger les stats." ; aucun KPI ni bouton d'action rendu. Au retablissement reseau, le polling (`refetchInterval 30s`) peut recharger les stats (re-tester en retablissant le reseau).
- **Critere d'acceptation (OK/KO)** : OK si EmptyState d'erreur affiche et l'ecran ne plante pas ; KO si crash ou dashboard vide sans message.
- **Donnees de test** : reponse 500 sur `/admin/stats`.
- **Duree estimee** : 3 min

### ADM-HOME-024 - Synchro temps-reel des KPI (polling 30 s, multi-session)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux sessions admin (Admin A sur Accueil admin, Admin B sur un autre device/onglet), backend partage, Wi-Fi.
- **Etapes** :
  1. Admin A ouvre Accueil admin et note `Live = N` et `Signalements ouverts = M`.
  2. Admin B (ou un utilisateur lambda) cree une nouvelle room en live et depose un nouveau signalement.
  3. Admin A patiente jusqu'a 30 s (un cycle de `refetchInterval`) sans interagir.
- **Resultat attendu** : sans action manuelle, le KPI "Live" passe a N+1, le KPI/badge "Signalements" passe a M+1 chez Admin A apres le prochain refetch automatique (<= 30 s). Note : ce rafraichissement est du polling REST sur `/admin/stats`, pas un push WebSocket -> il peut y avoir jusqu'a 30 s de latence.
- **Critere d'acceptation (OK/KO)** : OK si les KPI/badges se mettent a jour automatiquement dans la fenetre de 30 s sans recharger l'ecran ; KO si les valeurs restent figees indefiniment.
- **Donnees de test** : 2 comptes admin (`superadmin@test.io`, `admin@test.io`), 1 room de test creee live, 1 signalement de test.
- **Duree estimee** : 5 min
