# 17 - Suggestions a suivre (extensions) (`extensions`)

## Contexte ecran

- **Route / deep-link** : ecran d'extension autonome `ExtSuggestedFollowsScreen` (`src/features/extensions/screens/ExtSuggestedFollowsScreen.tsx`), atteignable via deep-link `chathouse://r/ext/suggested-follows`. En production il est monte dans l'etape finale d'onboarding `SuggestedFollowsRoute` (route `onboarding/suggested-follows`, cf. `src/core/navigation/SuggestedFollowsRoute.tsx` et `linking.ts`). Le wrapper ajoute deux boutons de pied de page ("Terminé" / "Plus tard") qui declenchent `completeOnboarding`.
- **Roles requis** : `standard` et `admin` (utilisateur authentifie). En onboarding, l'utilisateur vient de creer son compte (donc deja authentifie mais `hasCompletedOnboarding=false`). Le `guest` n'atteint pas cet ecran (il faut un token pour `/ext/suggestions` et pour `follow`).
- **Comportements temps-reel** : aucun WebSocket/LiveKit/push n'est emis par cet ecran. Les actions sont des appels HTTP REST : `GET /ext/suggestions?limit=30` (chargement + pull-to-refresh via `useExtSuggestions(30)` / `suggestionsApi.list`), et `POST follow` cote `useFollow` (mutation `profileService.follow(userId)`). Le caractere "réseau temps differe" (latence, perte de connexion, reconnexion) reste central pour les cas d'erreur.
- **Pre-conditions globales** : backend joignable (`apiClient` configure sur l'IP LAN / 127.0.0.1:4000), token d'auth valide, react-query monte (QueryClientProvider), i18n initialise (FR/EN).
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading=true` -> `ActivityIndicator` (couleur `colors.primary`), aucune liste.
  - **Liste pleine** : `data` = tableau de `SuggestedUser` (avatar ou fallback initiale, nom, bio optionnelle, libelle de raison : interets partages / amis d'amis / nombre de followers).
  - **Liste vide** : `data=[]` -> texte `extensions.suggested.empty` ("No suggestions yet. Come back later.").
  - **Rafraichissement** : `isRefetching=true` -> spinner natif du pull-to-refresh (`refreshing`).
  - **Suivi local** : ensemble `followed` (Set d'ids) ; un id present passe le bouton en etat "Following" desactive ; rollback automatique si `onFollow` rejette.
  - **Hors-ligne** : `GET /ext/suggestions` echoue -> react-query renvoie `data=undefined` (l'ecran reste sur liste vide apres chargement, ou conserve le cache `staleTime=60s`).

## Matrice bouton

| #   | Bouton                                   | Emplacement                                    | Type                                  | Locator reel                                                                                                                                                                                  | Pre-condition                                                          | Priorite |
| --- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| 1   | Cellule utilisateur (voir profil)        | Corps / cellule de liste                       | list-item / navigation                | `t('extensions.suggested.viewProfile', 'View profile of {{name}}')` (accessibilityLabel, role=button)                                                                                         | Liste chargee avec au moins 1 suggestion ; `onTapUser` fourni          | P1       |
| 2   | Bouton "Suivre" / "Following"            | Corps / cellule de liste (action a droite)     | submit / toggle (follow)              | `t('extensions.suggested.followUserA11y', 'Follow {{name}}')` (accessibilityLabel) ; texte `t('extensions.suggested.follow', 'Follow')` -> `t('extensions.suggested.following', 'Following')` | Liste chargee ; reseau OK pour `onFollow`/`useFollow` ; non deja suivi | P1       |
| 3   | Pull-to-refresh (rafraichir suggestions) | Corps / FlatList                               | realtime-action (rechargement reseau) | `RefreshControl` du `FlatList` (`onRefresh=refetch`, `refreshing=isRefetching`) — pas de label dedie                                                                                          | Liste montee (pas en `isLoading`)                                      | P2       |
| 4   | Bouton "Terminé" (finir onboarding)      | Pied de page (wrapper `SuggestedFollowsRoute`) | submit (completeOnboarding)           | `t('onboarding.suggestedFollows.done', 'Done')` (label du `Button`)                                                                                                                           | Contexte onboarding ; profil + interets en store ; reseau OK           | P1       |
| 5   | Bouton "Plus tard" (passer)              | Pied de page (wrapper `SuggestedFollowsRoute`) | submit (completeOnboarding)           | `t('onboarding.suggestedFollows.skip', 'Skip for now')` (label du `Button`, variant ghost)                                                                                                    | Contexte onboarding ; reseau OK                                        | P1       |

> Note : les boutons 4 et 5 n'appartiennent pas au fichier `ExtSuggestedFollowsScreen.tsx` lui-meme mais au wrapper d'onboarding `SuggestedFollowsRoute` qui le monte en production. Ils sont inclus car ce sont les seuls boutons "header/footer" presentes a l'utilisateur sur cette route. L'ecran extension pur n'a ni barre de header avec bouton retour, ni FAB, ni menu, ni input, ni swipe/long-press, ni lien legal — il n'y a litteralement pas d'autre element actionnable.

## Cas de test

### EXT-FOLLOW-001 - Ouvrir le profil d'une suggestion (tap cellule)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` authentifie ; Wi-Fi stable ; `GET /ext/suggestions` renvoie au moins 1 utilisateur (ex. "Jane Doe") ; aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'ecran "Suggestions a suivre" (deep-link `chathouse://r/ext/suggested-follows` ou via fin d'onboarding).
  2. Attendre la disparition du `ActivityIndicator` et l'apparition des cellules.
  3. Taper sur la zone avatar+nom de la cellule "Jane Doe" (locator `accessibilityLabel` = "View profile of Jane Doe").
- **Resultat attendu** : `onTapUser(user)` est appele avec l'objet `SuggestedUser` complet ; en production aucune navigation n'a lieu en onboarding (`onTapUser=() => {}`), mais le callback est bien declenche. Aucun changement d'etat du bouton "Suivre".
- **Critere d'acceptation (OK/KO)** : OK si le handler `onTapUser` recoit l'utilisateur exact tape ; KO si rien ne se passe ou si c'est le mauvais utilisateur.
- **Donnees de test** : `{ id: 'u1', username: 'janedoe', displayName: 'Jane Doe', avatarUrl: null, bio: null, followerCount: 1200, sharedInterestsCount: 0, reason: 'trending' }`.
- **Duree estimee** : 2 min

### EXT-FOLLOW-002 - Multi-clic rapide sur la cellule + cellule sans displayName

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; reseau avec latence simulee (Network Link Conditioner ~2s) ; une suggestion sans `displayName` (label retombe sur `username`).
- **Etapes** :
  1. Charger l'ecran avec un utilisateur `{ displayName: null, username: 'johnroe' }`.
  2. Taper 5 fois tres rapidement sur la cellule (locator "View profile of johnroe").
  3. Observer le nombre d'appels de `onTapUser`.
- **Resultat attendu** : chaque tap declenche `onTapUser` (pas de debounce dans l'ecran), mais aucune erreur/crash ; en navigation reelle, l'empilage d'ecrans doit etre gere en amont (hors de ce composant). Le label utilise bien `username` quand `displayName` est null.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash, label correct, et le callback recoit toujours le bon utilisateur ; KO si crash, label vide ("View profile of "), ou exception.
- **Donnees de test** : `{ id: 'u2', username: 'johnroe', displayName: null, reason: 'friends_of_friends', followerCount: 0, sharedInterestsCount: 0, avatarUrl: null, bio: null }`.
- **Duree estimee** : 3 min

### EXT-FOLLOW-003 - Accessibilite cellule (TalkBack/VoiceOver + police XXL + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee sur le maximum ; mode contraste eleve active ; au moins 1 suggestion avec bio longue.
- **Etapes** :
  1. Ouvrir l'ecran ; balayer (swipe) vers la droite pour parcourir les elements.
  2. Atteindre la cellule utilisateur.
  3. Verifier l'annonce du lecteur d'ecran et la lisibilite du texte agrandi.
- **Resultat attendu** : le lecteur annonce "View profile of {nom}, bouton" (role `button`). Le nom (`numberOfLines=1`) et la bio (`numberOfLines=2`) tronquent proprement sans chevauchement ; le libelle de raison (`colors.primary`) reste lisible. La cellule et le bouton "Suivre" sont deux elements focalisables distincts.
- **Critere d'acceptation (OK/KO)** : OK si annonce correcte, focus distinct cellule/bouton, aucun texte tronque illisible ni recouvrement ; KO sinon.
- **Donnees de test** : utilisateur avec `bio` de ~140 caracteres, `displayName='Maximilien de la Tour-Montparnasse'`.
- **Duree estimee** : 4 min

### EXT-FOLLOW-004 - Suivre un utilisateur (passage Follow -> Following)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` authentifie ; Wi-Fi stable ; `POST follow` renvoie 200 ; utilisateur "Jane Doe" affiche, non encore suivi.
- **Etapes** :
  1. Charger l'ecran avec la suggestion "Jane Doe".
  2. Taper sur le bouton "Suivre" (locator `accessibilityLabel` = "Follow Jane Doe").
  3. Attendre la mise a jour du bouton.
- **Resultat attendu** : `onFollow(user)` est appele une fois ; le bouton passe immediatement au texte "Following" (`extensions.suggested.following`), style `followBtnDone`, `accessibilityState={ selected: true, disabled: true }` ; la mutation `useFollow` invalide `profileKeys.detail(userId)` + `profileKeys.all` au succes.
- **Critere d'acceptation (OK/KO)** : OK si le bouton affiche "Following" et devient desactive apres un seul appel reseau reussi ; KO si l'etat ne change pas ou si plusieurs requetes partent.
- **Donnees de test** : user `u1` "Jane Doe" ; reponse `POST` = `200 { ok: true }`.
- **Duree estimee** : 2 min

### EXT-FOLLOW-005 - Multi-clic rapide + echec reseau sur le follow (rollback)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; reseau coupe (mode avion) OU `POST follow` renvoie 500/timeout ; utilisateur "Jane Doe" affiche.
- **Etapes** :
  1. Charger l'ecran avec "Jane Doe".
  2. Couper le reseau (mode avion).
  3. Taper 4 fois tres vite sur "Follow Jane Doe".
  4. Attendre le rejet de la promesse `onFollow`.
  5. Re-activer le reseau et retaper une fois sur le bouton.
- **Resultat attendu** : au 1er tap le bouton passe optimiste a "Following" (desactive) -> les taps 2 a 4 sont ignores (`disabled` + garde `followed.has(user.id)`), donc **un seul** `onFollow` part. A l'echec, l'id est retire du Set `followed` : le bouton revient a "Follow" (re-activable). Apres reconnexion, un nouveau tap declenche un nouvel appel qui reussit -> "Following".
- **Critere d'acceptation (OK/KO)** : OK si exactement 1 appel pendant la rafale, rollback visible vers "Follow" a l'echec, et succes au retry post-reconnexion ; KO si bouton reste bloque sur "Following" apres echec, ou si plusieurs requetes partent.
- **Donnees de test** : user `u1` ; reponse en echec = timeout (axios `ECONNABORTED`) puis `200` au retry.
- **Duree estimee** : 4 min

### EXT-FOLLOW-006 - Accessibilite du bouton Suivre (etat selected/disabled annonce)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; police agrandie ; contraste eleve ; "Jane Doe" affichee.
- **Etapes** :
  1. Avec le lecteur d'ecran, focaliser le bouton "Suivre" de la cellule.
  2. Ecouter l'annonce (avant suivi).
  3. Activer le bouton via le lecteur (double tap).
  4. Re-focaliser le bouton et ecouter l'annonce (apres suivi).
- **Resultat attendu** : avant : "Follow Jane Doe, bouton". Apres activation : etat `selected:true, disabled:true` -> le lecteur annonce "Following / selectionne / désactivé" (selon plateforme) et le bouton n'est plus actionnable. Le contraste texte/fond reste suffisant en variant `followBtnDone`.
- **Critere d'acceptation (OK/KO)** : OK si l'etat selected+disabled est annonce apres suivi et que le bouton n'est plus activable ; KO si l'annonce reste "Follow" ou si le bouton reste actionnable.
- **Donnees de test** : user `u1` "Jane Doe".
- **Duree estimee** : 4 min

### EXT-FOLLOW-007 - Multi-utilisateur : ma liste de suivi reflete le follow (synchro serveur)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes (Viewer = `standard` A, Cible = `standard` B "Jane Doe") ; deux appareils ; reseau OK. Note : la propagation n'est PAS via WebSocket — elle passe par l'invalidation react-query + relecture serveur.
- **Etapes** :
  1. Appareil A : ouvrir l'ecran et taper "Follow Jane Doe" -> "Following".
  2. Appareil A : naviguer vers l'ecran Followers/Following (ou le profil de B).
  3. Appareil B : ouvrir l'ecran de ses followers (ou rafraichir son profil).
- **Resultat attendu** : cote A, apres invalidation de `profileKeys.all`, la liste "Following" du viewer inclut B et `followingCount` augmente. Cote B, apres relecture serveur, `followerCount`/liste followers inclut A. La relation persiste apres relance d'app (relecture `/profile`).
- **Critere d'acceptation (OK/KO)** : OK si la relation follow est coherente cote A et cote B apres relecture serveur ; KO si l'un des deux ne voit pas la relation.
- **Donnees de test** : A = `+33600000001`, B = `+33600000002` (comptes de test OTP `000000`) ; user B `id=u1`.
- **Duree estimee** : 6 min

### EXT-FOLLOW-008 - Pull-to-refresh recharge les suggestions

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; Wi-Fi ; liste deja chargee (au moins 1 suggestion) ; backend renvoie une liste differente au 2e appel.
- **Etapes** :
  1. Ouvrir l'ecran, attendre l'affichage de la liste.
  2. Tirer la liste vers le bas (geste pull-to-refresh) au-dela du seuil.
  3. Observer le spinner natif puis la mise a jour.
- **Resultat attendu** : `refetch()` est declenche, `isRefetching=true` affiche le spinner du `RefreshControl`, puis la liste se met a jour avec les nouvelles suggestions ; le spinner disparait a la fin.
- **Critere d'acceptation (OK/KO)** : OK si un nouvel appel `GET /ext/suggestions?limit=30` part, le spinner apparait/disparait, et la liste reflete les nouvelles donnees ; KO si rien ne se recharge ou si le spinner reste bloque.
- **Donnees de test** : 1er appel = 3 users ; 2e appel = 5 users differents.
- **Duree estimee** : 2 min

### EXT-FOLLOW-009 - Pull-to-refresh hors-ligne puis reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; liste deja chargee depuis le cache (`staleTime=60s`) ; reseau ensuite coupe.
- **Etapes** :
  1. Charger l'ecran avec des donnees en cache.
  2. Couper le reseau (mode avion).
  3. Tirer pour rafraichir plusieurs fois rapidement.
  4. Re-activer le reseau et rafraichir a nouveau.
- **Resultat attendu** : hors-ligne, `refetch` echoue ; le spinner se termine sans crash ; la liste **conserve** les donnees en cache (pas d'ecran vide soudain). Apres reconnexion, un pull-to-refresh recharge la liste a jour.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash hors-ligne, donnees cache conservees, et recuperation correcte apres reconnexion ; KO si crash, liste videe a tort, ou spinner bloque indefiniment.
- **Donnees de test** : cache = 3 users ; apres reconnexion = 3 users (potentiellement re-tries).
- **Duree estimee** : 3 min

### EXT-FOLLOW-010 - Accessibilite pull-to-refresh et etat vide

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; police agrandie ; `GET /ext/suggestions` renvoie `[]` (liste vide).
- **Etapes** :
  1. Ouvrir l'ecran avec `data=[]`.
  2. Parcourir avec le lecteur d'ecran le titre, le sous-titre et l'etat vide.
  3. Tenter le geste de rafraichissement.
- **Resultat attendu** : le lecteur annonce le titre ("People you may know"), le sous-titre, puis le texte vide `extensions.suggested.empty` ("No suggestions yet. Come back later."). Le pull-to-refresh reste disponible meme sur liste vide (le `RefreshControl` est attache au `FlatList`). Aucun texte coupe en police max.
- **Critere d'acceptation (OK/KO)** : OK si titre/sous-titre/etat-vide sont annonces et lisibles, et le refresh fonctionne sur liste vide ; KO sinon.
- **Donnees de test** : `data=[]`.
- **Duree estimee** : 3 min

### EXT-FOLLOW-011 - Bouton "Terminé" finalise l'onboarding (wrapper)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : contexte onboarding (`SuggestedFollowsRoute`) ; compte fraichement cree, `hasCompletedOnboarding=false` ; profil + interets en store onboarding ; Wi-Fi ; `completeOnboarding` renvoie 200.
- **Etapes** :
  1. Atteindre l'etape finale d'onboarding (route `onboarding/suggested-follows`).
  2. Optionnel : suivre 1-2 suggestions.
  3. Taper le bouton "Terminé" (locator label = `onboarding.suggestedFollows.done` = "Terminé"/"Done").
  4. Attendre la fin du chargement.
- **Resultat attendu** : `completeOnboarding({ displayName, firstName, lastName, bio, avatarUrl, interests })` est appele ; le bouton affiche un `loading` et passe en `disabled` pendant l'appel ; si un code de parrainage est en attente, `invitesApi.redeem` est tente (best-effort) ; `resetOnboarding()` ; `user.hasCompletedOnboarding` passe a true et le `RootNavigator` bascule sur la stack Main.
- **Critere d'acceptation (OK/KO)** : OK si l'app bascule sur l'ecran principal apres un appel `completeOnboarding` reussi ; KO si on reste bloque sur l'onboarding ou si double soumission.
- **Donnees de test** : profil `{ displayName: 'Jane Doe', interests: ['tech','music'] }` ; pas de code de parrainage.
- **Duree estimee** : 3 min

### EXT-FOLLOW-012 - "Terminé" : double-tap rapide + echec reseau de completeOnboarding

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : contexte onboarding ; reseau coupe ou `completeOnboarding` renvoie 422/500/timeout.
- **Etapes** :
  1. Sur l'etape finale, couper le reseau.
  2. Taper 3 fois tres vite sur "Terminé".
  3. Observer le nombre d'appels et l'etat du bouton.
  4. Attendre l'erreur ; verifier le toast ; reactiver le reseau et retaper.
- **Resultat attendu** : la garde `if (finishing) return` + `disabled` empechent toute soumission concurrente -> **un seul** appel pendant la rafale. A l'echec, un toast d'erreur (`useApiErrorToast`) s'affiche, le store onboarding reste intact, `finishing` repasse a false (bouton re-activable). Apres reconnexion, retaper "Terminé" reussit et bascule sur Main.
- **Critere d'acceptation (OK/KO)** : OK si 1 seul appel pendant la rafale, toast d'erreur affiche, store preserve, retry possible apres reconnexion ; KO si plusieurs appels, perte des donnees onboarding, ou bouton bloque.
- **Donnees de test** : reponse = `422 { error: 'validation' }` puis `200` au retry.
- **Duree estimee** : 4 min

### EXT-FOLLOW-013 - "Plus tard" passe l'onboarding sans suivre personne

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : contexte onboarding ; compte `hasCompletedOnboarding=false` ; aucune suggestion suivie ; Wi-Fi ; `completeOnboarding` 200.
- **Etapes** :
  1. Sur l'etape finale, ne suivre personne.
  2. Taper le bouton "Plus tard" (locator label = `onboarding.suggestedFollows.skip` = "Plus tard"/"Skip for now", variant ghost).
  3. Attendre la fin du chargement.
- **Resultat attendu** : meme comportement que "Terminé" -> `completeOnboarding` est appele avec le profil/interets actuels, `resetOnboarding`, bascule sur Main. Le fait de ne suivre personne n'empeche pas la completion.
- **Critere d'acceptation (OK/KO)** : OK si l'app entre dans le Main apres avoir passe les suggestions ; KO si on reste bloque ou si une erreur empeche le skip.
- **Donnees de test** : aucun follow ; profil minimal `{ displayName: 'Jane Doe' }`.
- **Duree estimee** : 2 min

### EXT-FOLLOW-014 - Accessibilite des boutons de pied de page (Terminé / Plus tard)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : contexte onboarding ; TalkBack/VoiceOver actif ; police agrandie ; contraste eleve.
- **Etapes** :
  1. Atteindre l'etape finale.
  2. Avec le lecteur d'ecran, parcourir jusqu'aux boutons du pied de page.
  3. Verifier les annonces des deux boutons, leur ordre et l'etat `disabled`/`loading` pendant un appel.
- **Resultat attendu** : "Terminé, bouton" puis "Plus tard, bouton" sont annonces et focalisables ; en `fullWidth size=lg` ils restent atteignables avec police max ; pendant `finishing` les deux sont annonces comme desactives et le bouton primaire indique son etat de chargement. Contraste primary/ghost conforme.
- **Critere d'acceptation (OK/KO)** : OK si les deux boutons sont annonces, focalisables, et leur etat disabled/loading est expose ; KO sinon.
- **Donnees de test** : N/A (UI).
- **Duree estimee** : 3 min
