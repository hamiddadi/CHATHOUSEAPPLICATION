# 03 - Signalements (admin) (`admin`)

## Contexte ecran

- **Route** : `AdminReports` dans le `SettingsNavigator` (`createNativeStackNavigator`, `headerShown: false`). Atteint depuis `AdminHomeScreen` via `navigation.navigate('AdminReports')` (handler `goReports`). Fichier : `src/features/admin/screens/AdminReportsScreen.tsx`.
- **Roles requis** : `admin` (moderateur+). L'entree dans `SettingsScreen` n'est rendue que pour moderateur+, et chaque ecran admin re-verifie le role cote serveur via `GET /admin/me`. Un deep-link par un `guest`/`standard` est rejete 403. Aucun acces fonctionnel pour `guest` ni `standard`.
- **Comportements temps-reel** : AUCUN. L'ecran est 100% REST via React Query (`useAdminReports` -> `GET /admin/reports`, `useResolveReport` -> `POST /admin/reports/:id/resolve`). Pas de WebSocket, pas de LiveKit, pas de push entrant. La "fraicheur" repose sur le pull-to-refresh et l'invalidation de cache (`reports` + `stats`) apres mutation. La file ne se met PAS a jour toute seule si un nouveau signalement arrive cote serveur.
- **Pre-conditions globales** : utilisateur authentifie avec `appRole` moderateur+, jeton valide, backend `:4000` joignable, reseau actif. L'API repond une enveloppe `Envelope<Paginated<AdminReport>>`.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` -> `Loader` plein ecran (`accessibilityLabel = t('common.loading')` = "Chargement…").
  - **Erreur** : `isError || !data` -> `EmptyState` (titre `admin.reports.errorTitle`, corps `admin.reports.errorBody`).
  - **Liste vide** : `data.data = []` -> `EmptyState` (titre `admin.reports.emptyTitle`, corps `admin.reports.emptyOpen` sur l'onglet Ouverts, sinon `admin.reports.emptyAll`).
  - **Liste pleine** : `FlatList` de `ReportRow`. Une row affiche cible (USER) OU room (ROUM), motif, signaleur, details, et — si `resolvedAt == null` — les 2 boutons d'action. Les rows resolues affichent un badge "Résolu" et AUCUN bouton d'action.
  - **Hors-ligne** : la requete echoue -> etat erreur ; les mutations echouent -> Alert d'erreur (`admin.reports.errorTitle` / `admin.reports.actionFailed`).
- **Onglets disponibles** : `open` (Ouverts, defaut), `resolved` (Résolus), `all` (Tous). Le changement d'onglet relance `useAdminReports({ status: tab })`.

## Matrice bouton

| #   | Bouton                 | Emplacement                                | Type                                      | Locator reel                                                                                                                        | Pre-condition                                                       | Priorite |
| --- | ---------------------- | ------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| 1   | Retour                 | Header (AdminHeader, gauche)               | navigation                                | `accessibilityLabel="Retour"` (icone `arrow-back`)                                                                                  | Pile de navigation non vide (`navigation.canGoBack()`)              | P1       |
| 2   | Onglet Ouverts         | Barre d'onglets (corps haut)               | toggle                                    | `t('admin.reports.tabs.open')` = "Ouverts", `accessibilityRole="tab"`, `accessibilityState.selected`                                | Ecran charge                                                        | P1       |
| 3   | Onglet Résolus         | Barre d'onglets (corps haut)               | toggle                                    | `t('admin.reports.tabs.resolved')` = "Résolus", `accessibilityRole="tab"`                                                           | Ecran charge                                                        | P1       |
| 4   | Onglet Tous            | Barre d'onglets (corps haut)               | toggle                                    | `t('admin.reports.tabs.all')` = "Tous", `accessibilityRole="tab"`                                                                   | Ecran charge                                                        | P1       |
| 5   | Ignorer (signalement)  | Cellule de liste, barre d'action de la row | destructive                               | `accessibilityLabel = t('admin.reports.dismissA11y')` = "Ignorer ce signalement" ; texte `t('admin.reports.dismiss')` = "Ignorer"   | Row non resolue (`resolvedAt == null`), `busy == false`, role admin | P0       |
| 6   | Résoudre (signalement) | Cellule de liste, barre d'action de la row | destructive                               | `accessibilityLabel = t('admin.reports.resolveA11y')` = "Résoudre ce signalement" ; texte `t('admin.reports.resolve')` = "Résoudre" | Row non resolue (`resolvedAt == null`), `busy == false`, role admin | P0       |
| 7   | Tirer pour rafraichir  | FlatList (corps, pull-to-refresh)          | realtime-action (rafraichissement manuel) | `FlatList.onRefresh = refetch`, `refreshing = isRefetching`                                                                         | Liste affichee (pas en etat loading/erreur)                         | P1       |

> Note : il n'y a pas de FAB, pas de switch, pas de champ de saisie, pas de long-press ni de swipe sur cet ecran. Les onglets utilisent `accessibilityRole="tab"` (pas "button"). Les 2 boutons d'action utilisent un `Alert` de confirmation natif avant la mutation irreversible — les boutons de l'Alert ("Annuler" / "Résoudre" / "Ignorer") sont des controles systeme natifs, couverts dans les cas de test des boutons 5 et 6.

## Cas de test

### ADM-REP-001 - Retour ferme l'ecran et revient a l'accueil admin

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin connecte ; Wi-Fi ; arrive sur `AdminReports` depuis `AdminHome` ; aucune permission particuliere.
- **Etapes** :
  1. Depuis `AdminHome`, taper la tuile Signalements pour ouvrir `AdminReports`.
  2. Attendre l'affichage du titre "Signalements" et des onglets.
  3. Taper l'icone Retour (`accessibilityLabel="Retour"`) en haut a gauche.
- **Resultat attendu** : `navigation.goBack()` est appele, l'ecran `AdminReports` est demonte, retour a `AdminHome`. Aucune requete reseau declenchee par le retour.
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur revient sur `AdminHome` sans crash ni ecran intermediaire ; KO sinon.
- **Donnees de test** : compte `admin@chathouse.test` / OTP `000000` (compte de moderation de test).
- **Duree estimee** : 2 min

### ADM-REP-002 - Retour multi-tap rapide sans pile (racine)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; `AdminReports` ouvert ; simuler le cas ou la pile ne peut pas reculer (deep-link direct sur `AdminReports` comme premier ecran de la pile) ; reseau quelconque.
- **Etapes** :
  1. Ouvrir `AdminReports` via deep-link / etat ou `navigation.canGoBack()` retourne `false`.
  2. Taper l'icone Retour 5 fois tres rapidement (multi-clic).
- **Resultat attendu** : `handleBack` verifie `canGoBack()` ; si faux, aucun `goBack()` n'est appele. Aucun crash, aucune navigation double, l'ecran reste affiche.
- **Critere d'acceptation (OK/KO)** : OK si l'app ne plante pas et reste sur `AdminReports` (ou ne recule qu'une seule fois quand la pile le permet) ; KO si crash ou double-pop.
- **Donnees de test** : deep-link `chathouse://admin/reports`.
- **Duree estimee** : 3 min

### ADM-REP-003 - Bouton Retour annonce par le lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; TalkBack (Android) ou VoiceOver (iOS) actif ; police systeme agrandie (200%) ; contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police XXL.
  2. Ouvrir `AdminReports`.
  3. Balayer jusqu'au premier element focusable en haut a gauche.
- **Resultat attendu** : le lecteur annonce "Retour, bouton" (libelle = `accessibilityLabel="Retour"`, role bouton). La zone tactile (36x36 + `hitSlop=12`) reste >= 44pt effectif. Le titre "Signalements" reste lisible, non tronque au point d'etre vide.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, correctement nomme "Retour" et actionnable en police agrandie ; KO si non annonce, non focusable ou cible trop petite.
- **Donnees de test** : N/A (verification a11y).
- **Duree estimee** : 4 min

### ADM-REP-004 - Bascule vers l'onglet Résolus charge la file resolue

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin ; Wi-Fi ; au moins 1 signalement resolu et 1 ouvert cote backend.
- **Etapes** :
  1. Ouvrir `AdminReports` (onglet "Ouverts" selectionne par defaut).
  2. Taper l'onglet "Résolus" (`t('admin.reports.tabs.resolved')`).
  3. Observer le rechargement de la liste.
- **Resultat attendu** : `setTab('resolved')` met `accessibilityState.selected=true` sur "Résolus" (pilule pleine, texte `text-primary-on-container`), declenche `useAdminReports({ status: 'resolved' })` (`GET /admin/reports?status=resolved`). Les rows affichees portent le badge "Résolu" et N'AFFICHENT PAS les boutons Ignorer/Résoudre.
- **Critere d'acceptation (OK/KO)** : OK si l'onglet est visuellement selectionne et la liste ne contient que des signalements resolus sans boutons d'action ; KO sinon.
- **Donnees de test** : seed admin avec `rep-resolved-1` (resolvedAt non nul) et `rep-open-1`.
- **Duree estimee** : 3 min

### ADM-REP-005 - Changement d'onglet en boucle rapide + latence reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; reseau bride a ~2 s de latence (Network Link Conditioner / throttling 3G) ; plusieurs signalements.
- **Etapes** :
  1. Ouvrir `AdminReports`.
  2. Taper rapidement et alternativement "Ouverts" -> "Tous" -> "Résolus" -> "Ouverts" (8 taps en 3 s).
  3. Attendre la stabilisation du reseau.
- **Resultat attendu** : un seul etat d'onglet final gagne (le dernier tape). React Query annule/ignore les reponses obsoletes ; aucune liste melangee (pas de rows resolues sous l'onglet Ouverts). Pas de crash, pas de double `Loader` empile. Le contenu affiche correspond au dernier onglet selectionne.
- **Critere d'acceptation (OK/KO)** : OK si l'etat final est coherent avec le dernier onglet et qu'aucune reponse perimee n'ecrase l'affichage ; KO si liste incoherente ou crash.
- **Donnees de test** : throttle profil "3G regular".
- **Duree estimee** : 5 min

### ADM-REP-006 - Onglets annonces avec etat selectionne par le lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver actif ; police agrandie ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Ouvrir `AdminReports`.
  3. Balayer sur les 3 onglets "Ouverts", "Résolus", "Tous".
- **Resultat attendu** : chaque onglet est annonce avec son libelle et son role "tab" ; l'onglet actif est annonce "selectionne" (`accessibilityState.selected=true`). En police XXL, les 3 pilules restent atteignables (hauteur min 44pt conservee) sans chevauchement masquant le texte.
- **Critere d'acceptation (OK/KO)** : OK si role tab + etat selectionne correctement annonces et pilules actionnables en grande police ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### ADM-REP-007 - Resoudre un signalement avec confirmation et succes

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin ; Wi-Fi ; au moins 1 signalement ouvert (`resolvedAt == null`) dans l'onglet "Ouverts".
- **Etapes** :
  1. Ouvrir `AdminReports` sur l'onglet "Ouverts".
  2. Sur une row, taper le bouton "Résoudre" (`accessibilityLabel="Résoudre ce signalement"`).
  3. Dans l'`Alert` ("Résoudre le signalement ?" / corps `confirmResolveBody`), taper "Résoudre".
  4. Attendre la fin de la mutation.
- **Resultat attendu** : un `Alert.alert` de confirmation s'ouvre AVANT toute requete. Au tap "Résoudre", `resolve.mutate({ reportId, outcome: 'resolved' }, ...)` -> `POST /admin/reports/:id/resolve` body `{ outcome: 'resolved' }`. En succes, invalidation de `['admin','reports']` + `stats` ; la row disparait de la file "Ouverts" apres refetch.
- **Critere d'acceptation (OK/KO)** : OK si confirmation affichee puis 1 seul POST avec `outcome=resolved` et la row quitte la file ouverte ; KO si POST envoye sans confirmation ou row persistante.
- **Donnees de test** : `reportId='rep-1'`, payload `{ "outcome": "resolved" }` ; endpoint `POST /admin/reports/rep-1/resolve`.
- **Duree estimee** : 3 min

### ADM-REP-008 - Resoudre : multi-tap rapide + perte reseau pendant la mutation

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; reseau coupable de basculer hors-ligne au moment du POST ; 1 signalement ouvert.
- **Etapes** :
  1. Ouvrir `AdminReports` (onglet Ouverts).
  2. Taper "Résoudre" 5 fois tres vite sur la meme row.
  3. Dans l'`Alert`, taper "Résoudre".
  4. Couper le Wi-Fi/4G juste apres le tap de confirmation, puis le retablir 5 s plus tard.
- **Resultat attendu** : pendant `busy` (`resolve.isPending && variables.reportId === item.id`), les boutons "Résoudre"/"Ignorer" de cette row sont `disabled` (`accessibilityState.disabled=true`) -> les taps repetes n'empilent pas plusieurs POST. Si le POST echoue (hors-ligne), `onError` ouvre un `Alert` ("Impossible de charger les signalements" / `actionFailed`). Aucune double resolution. Apres retour reseau, l'admin peut reessayer.
- **Critere d'acceptation (OK/KO)** : OK si un seul POST part, le bouton se desactive pendant l'envoi, et l'echec reseau affiche l'Alert d'erreur sans corrompre l'etat ; KO si plusieurs POST ou crash.
- **Donnees de test** : `reportId='rep-1'` ; couper reseau via mode avion 5 s.
- **Duree estimee** : 5 min

### ADM-REP-009 - Bouton Résoudre via lecteur d'ecran et grande police

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve ; 1 signalement ouvert.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Ouvrir `AdminReports`, balayer jusqu'a une row puis jusqu'au bouton d'action droit.
  3. Double-taper pour activer.
  4. Naviguer dans l'`Alert` de confirmation au lecteur d'ecran et valider "Résoudre".
- **Resultat attendu** : le bouton est annonce "Résoudre ce signalement, bouton" (libelle = `resolveA11y`, role bouton). En police XXL, la pilule (minHeight 44) reste tappable et le texte "Résoudre" lisible. L'`Alert` natif est entierement vocalise (titre, corps, actions Annuler/Résoudre). Si `busy`, l'etat "desactive" est annonce.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est nomme via `resolveA11y`, focusable, et l'Alert vocalise ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### ADM-REP-010 - Resoudre : coherence multi-utilisateur (2 admins, 1 file partagee)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes admin (Admin A, Admin B) sur 2 appareils ; meme backend ; meme signalement ouvert `rep-1` visible dans les 2 files "Ouverts". (Rappel : pas de push temps-reel, la synchro repose sur refetch/invalidation.)
- **Etapes** :
  1. Admin A et Admin B ouvrent `AdminReports` onglet "Ouverts" ; `rep-1` visible chez les deux.
  2. Admin A resout `rep-1` (confirme "Résoudre").
  3. Admin B, SANS rafraichir, tape "Résoudre" sur `rep-1` puis confirme.
  4. Admin B effectue ensuite un pull-to-refresh.
- **Resultat attendu** : Admin A : POST 200, `rep-1` quitte sa file apres invalidation. Admin B : le POST de resolution d'un signalement deja resolu doit etre rejete/idempotent cote serveur (409/422 ou succes idempotent) ; en cas d'erreur, `onError` affiche l'Alert `actionFailed`. Apres pull-to-refresh, `rep-1` disparait aussi de la file de B. Pas de double comptabilite dans les stats.
- **Critere d'acceptation (OK/KO)** : OK si la file converge (rep-1 absent chez les 2 apres refresh) et l'action redondante de B est geree proprement (erreur explicite ou idempotence) ; KO si etat divergent ou crash.
- **Donnees de test** : `rep-1` partage ; comptes `adminA@chathouse.test`, `adminB@chathouse.test`.
- **Duree estimee** : 6 min

### ADM-REP-011 - Ignorer un signalement avec confirmation destructive

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte admin ; Wi-Fi ; 1 signalement ouvert.
- **Etapes** :
  1. Ouvrir `AdminReports` onglet "Ouverts".
  2. Sur une row, taper "Ignorer" (`accessibilityLabel="Ignorer ce signalement"`).
  3. Dans l'`Alert` ("Ignorer le signalement ?" / corps `confirmDismissBody`), le bouton de confirmation "Ignorer" est de style `destructive`.
  4. Taper "Ignorer".
- **Resultat attendu** : `Alert.alert` affiche le titre `confirmDismissTitle` et un bouton "Ignorer" en style destructif (rouge). Au tap, `resolve.mutate({ reportId, outcome: 'dismissed' })` -> `POST /admin/reports/:id/resolve` body `{ outcome: 'dismissed' }`. En succes la row quitte la file et `stats` est invalide.
- **Critere d'acceptation (OK/KO)** : OK si confirmation destructive affichee puis 1 POST `outcome=dismissed` et row retiree ; KO sinon.
- **Donnees de test** : `reportId='rep-1'`, payload `{ "outcome": "dismissed" }`.
- **Duree estimee** : 3 min

### ADM-REP-012 - Ignorer : annulation de la confirmation + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; Wi-Fi ; 1 signalement ouvert.
- **Etapes** :
  1. Ouvrir `AdminReports` onglet "Ouverts".
  2. Taper "Ignorer" 4 fois rapidement.
  3. Dans l'`Alert`, taper "Annuler" (`t('common.cancel')` = "Annuler").
- **Resultat attendu** : meme avec plusieurs taps, l'`Alert` natif est mono-instance (pas de pile d'alertes empilees au point de bloquer l'UI). Le tap "Annuler" ferme l'Alert SANS appeler `resolve.mutate` -> AUCUN `POST /admin/reports/:id/resolve` n'est envoye. La row reste dans la file "Ouverts", non modifiee.
- **Critere d'acceptation (OK/KO)** : OK si zero POST apres annulation et row intacte ; KO si un POST part ou l'UI se bloque sur des alertes empilees.
- **Donnees de test** : `reportId='rep-1'` ; verifier via l'onglet Reseau qu'aucun appel `/resolve` n'apparait.
- **Duree estimee** : 4 min

### ADM-REP-013 - Bouton Ignorer via lecteur d'ecran et grande police

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve ; 1 signalement ouvert.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Ouvrir `AdminReports`, balayer jusqu'au bouton d'action gauche d'une row.
  3. Double-taper pour activer, puis vocaliser et valider l'`Alert`.
- **Resultat attendu** : le bouton est annonce "Ignorer ce signalement, bouton" (libelle = `dismissA11y`). Le texte "Ignorer" reste lisible en police XXL ; la pilule conserve une cible >= 44pt. L'Alert (titre `confirmDismissTitle`, action destructive "Ignorer", "Annuler") est entierement vocalise. La distinction Ignorer/Résoudre est claire au lecteur (libelles distincts), pas seulement par la couleur (contraste).
- **Critere d'acceptation (OK/KO)** : OK si le bouton est nomme via `dismissA11y`, distinct de "Résoudre", et l'Alert vocalise ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### ADM-REP-014 - Pull-to-refresh recharge la file

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin ; Wi-Fi ; liste affichee (au moins 1 row, etat non loading/erreur) ; un nouveau signalement vient d'arriver cote serveur.
- **Etapes** :
  1. Ouvrir `AdminReports` onglet "Ouverts".
  2. Tirer la liste vers le bas (geste pull-to-refresh).
  3. Relacher et observer l'indicateur de rafraichissement.
- **Resultat attendu** : `onRefresh = refetch` declenche un nouvel `GET /admin/reports?status=open`. `refreshing` (= `isRefetching`) affiche le spinner natif pendant l'appel puis le masque. Les nouveaux signalements apparaissent en tete/dans la liste apres reponse.
- **Critere d'acceptation (OK/KO)** : OK si le geste declenche un refetch, le spinner apparait/disparait, et les donnees fraiches s'affichent ; KO si aucun refetch ou spinner bloque.
- **Donnees de test** : ajouter `rep-new-1` cote backend avant le geste.
- **Duree estimee** : 3 min

### ADM-REP-015 - Pull-to-refresh repete hors-ligne / reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte admin ; appareil hors-ligne puis reconnexion ; liste deja affichee (donnees en cache).
- **Etapes** :
  1. Ouvrir `AdminReports` avec une liste deja chargee.
  2. Passer en mode avion (hors-ligne).
  3. Tirer pour rafraichir 3 fois de suite.
  4. Retablir le reseau puis tirer une derniere fois.
- **Resultat attendu** : hors-ligne, le refetch echoue ; l'indicateur `isRefetching` se ferme proprement (pas de spinner infini), la liste en cache reste affichee (pas de bascule brutale en `EmptyState` erreur tant que des donnees existent). Apres reconnexion, le pull-to-refresh reussit et met la liste a jour. Aucun crash sur les refresh rapides successifs.
- **Critere d'acceptation (OK/KO)** : OK si le spinner se termine toujours, la liste cache persiste hors-ligne, et le refresh post-reconnexion reussit ; KO si spinner bloque, crash, ou liste videe a tort.
- **Donnees de test** : mode avion ON/OFF.
- **Duree estimee** : 5 min

### ADM-REP-016 - Pull-to-refresh annonce et utilisable au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver actif ; police agrandie ; liste affichee.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Ouvrir `AdminReports`.
  3. Utiliser le geste d'actualisation accessible (sur iOS : focus sur la liste puis geste a 3 doigts / action "Actualiser" ; sur Android : explorer l'en-tete de rafraichissement).
- **Resultat attendu** : le rafraichissement reste declenchable via lecteur d'ecran ; le changement d'etat (chargement -> contenu) est perceptible (annonce du spinner ou du nouveau contenu). En police agrandie, la liste reste defilable et les rows lisibles.
- **Critere d'acceptation (OK/KO)** : OK si le refresh est atteignable au lecteur d'ecran et l'etat de chargement perceptible ; KO si inaccessible.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### ADM-REP-017 - Onglet Tous affiche ouverts + resolus melanges

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte admin ; Wi-Fi ; au moins 1 signalement ouvert et 1 resolu.
- **Etapes** :
  1. Ouvrir `AdminReports`.
  2. Taper l'onglet "Tous" (`t('admin.reports.tabs.all')`).
- **Resultat attendu** : `GET /admin/reports?status=all` ; la liste contient les deux types. Les rows ouvertes affichent les boutons Ignorer/Résoudre ; les rows resolues affichent le badge "Résolu" sans boutons. Si vide, `EmptyState` avec corps `admin.reports.emptyAll` ("Aucun signalement pour le moment.").
- **Critere d'acceptation (OK/KO)** : OK si les deux statuts coexistent avec le bon rendu conditionnel des boutons ; KO sinon.
- **Donnees de test** : seed mixte (`rep-open-1`, `rep-resolved-1`).
- **Duree estimee** : 3 min

### ADM-REP-018 - Onglet Tous : annonce a11y de l'etat selectionne sous grande police

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte admin ; TalkBack/VoiceOver ; police XXL ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police XXL.
  2. Ouvrir `AdminReports`, balayer jusqu'a l'onglet "Tous".
  3. Double-taper pour selectionner.
- **Resultat attendu** : l'onglet "Tous" est annonce role "tab" et passe a l'etat "selectionne" apres activation (`accessibilityState.selected`). Les 3 pilules restent visibles et non chevauchantes en police XXL ; le contraste texte/pilule reste suffisant (pilule active `primary` vs inactives transparentes).
- **Critere d'acceptation (OK/KO)** : OK si selection annoncee et pilules lisibles/atteignables en grande police ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min
