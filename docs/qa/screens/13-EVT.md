# 13 - Evenements (`events`)

## Contexte ecran

- **Route** : `Events` (sans params) dans le `RoomsNavigator` (`src/core/navigation/stacks/RoomsNavigator.tsx` ; type `RoomStackParamList.Events: undefined`). Acces via une navigation interne depuis la pile Rooms.
- **Fichier ecran** : `src/features/events/screens/EventsScreen/EventsScreen.tsx` (aucun partial — tout le rendu, `EventCard` et `TabPill` inclus, est dans ce seul fichier).
- **Roles requis** : ecran d'application authentifiee (donc `standard` ou `admin`). Pas de garde de role specifique dans le composant ; un `guest` n'atteint pas cette route. Le RSVP suppose un compte connecte cote API.
- **Comportements temps-reel** : AUCUN canal temps-reel propre a cet ecran. Pas de WebSocket, pas de LiveKit, pas de push consomme ici. La fraicheur des donnees repose sur :
  - REST via React Query : `useUpcomingEvents` -> `GET /rooms?filter=upcoming`, `useMyEvents` -> `GET /rooms/events/mine`.
  - Mutations RSVP : `useRsvp` -> `POST /rooms/{id}/rsvp`, `useCancelRsvp` -> `DELETE /rooms/{id}/rsvp`. Les deux invalident la cle `['events']` au succes (`onSuccess` -> `invalidateQueries`), ce qui re-fetch les deux listes. C'est la seule forme de "synchro" : pseudo-temps-reel par invalidation/refetch, pas un push serveur.
- **Pre-conditions globales** : utilisateur connecte, token valide, base API joignable, i18n charge (locale FR par defaut ici).
- **Etats de donnees pertinents** :
  - **Chargement** : `activeList.isLoading` vrai -> `Loader` plein ecran avec `accessibilityLabel = t('events.title')`.
  - **Liste vide (A venir)** : `EmptyState` titre `t('events.empty')` = "Aucun evenement a venir".
  - **Liste vide (Mes evenements)** : `EmptyState` titre `t('events.emptyMine')` = "Tu n'as RSVP a rien pour l'instant.".
  - **Liste pleine** : `FlatList` de `EventCard`.
  - **Mutation en cours** : `mutating = rsvp.isPending || cancelRsvp.isPending` -> tous les boutons RSVP `disabled`, double-soumission bloquee dans `onToggle`.
  - **Rafraichissement** : `activeList.isFetching` pilote le `refreshing` du pull-to-refresh.
  - **Hors-ligne / erreur RSVP** : `Alert.alert(t('events.title'), t('errorBoundary.fallbackMessage'))` via le callback `onError` passe a la mutation.
  - Note : la cle i18n `events.create` ("Creer un evenement") existe dans les locales mais N'EST PAS rendue par cet ecran — aucun bouton de creation/FAB n'est present dans le code.

## Matrice bouton

| #   | Bouton                      | Emplacement                            | Type                                    | Locator reel                                                                                                                                                                         | Pre-condition                                        | Priorite |
| --- | --------------------------- | -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------- |
| 1   | Retour                      | Header (gauche)                        | navigation                              | `accessibilityLabel = t('common.back')` ("Retour")                                                                                                                                   | Ecran monte avec une pile navigable en arriere       | P1       |
| 2   | Onglet "A venir"            | Barre d'onglets (sous header)          | toggle                                  | `t('events.tabs.upcoming')` ("A venir") via `getByText` ; `accessibilityState.selected`                                                                                              | Ecran monte                                          | P1       |
| 3   | Onglet "Mes evenements"     | Barre d'onglets                        | toggle                                  | `t('events.tabs.mine')` ("Mes evenements") via `getByText` ; `accessibilityState.selected`                                                                                           | Ecran monte                                          | P1       |
| 4   | RSVP / Je viens (par carte) | Corps — cellule de liste (`EventCard`) | toggle (realtime via invalidation REST) | `accessibilityLabel = \`${t('events.notRsvp')} · ${event.title}\`` (etat non-RSVP, "RSVP · <titre>") ou `\`${t('events.rsvp')} · ${event.title}\`` (etat RSVP, "Je viens · <titre>") | Liste non vide, compte connecte, reseau              | P0       |
| 5   | Pull-to-refresh             | Corps — `FlatList` (`onRefresh`)       | realtime-action (refetch REST)          | Pas de locator a11y dedie ; geste de tirage sur la `FlatList` (prop `refreshing` = `activeList.isFetching`)                                                                          | Liste affichee (FlatList monte, donc liste non vide) | P1       |

> Remarque : il n'y a pas d'autre element actionnable (pas de FAB, pas de switch, pas de long-press/swipe, pas d'input). L'avatar et les libelles de carte ne sont pas pressables. La cellule de carte n'a pas d'`onPress` global — seul le bouton RSVP de la carte est actionnable.

## Cas de test

### EVT-001 - Retour ferme l'ecran Evenements

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran Evenements ouvert depuis la pile Rooms (un ecran precedent existe) ; Wi-Fi ; aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'ecran Evenements.
  2. Taper le bouton header "Retour" (`accessibilityLabel = "Retour"`).
- **Resultat attendu** : `navigation.goBack()` est appele une fois ; retour a l'ecran precedent ; aucune requete reseau declenchee par l'action.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent reapparait et l'ecran Evenements est demonte ; KO si rien ne se passe ou si l'app crashe.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; pile : Rooms -> Events.
- **Duree estimee** : 2 min

### EVT-002 - Retour : multi-clic rapide ne double-navigue pas

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran Evenements ouvert ; latence reseau elevee simulee (throttle 3G).
- **Etapes** :
  1. Ouvrir l'ecran Evenements.
  2. Taper "Retour" 5 fois en moins d'1 seconde.
- **Resultat attendu** : une seule navigation arriere effective ; pas de double `goBack` qui ferait sortir de la pile Rooms ou crasher ; pas d'ecran blanc.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient d'exactement un niveau et reste stable ; KO si elle saute plusieurs ecrans ou crashe.
- **Donnees de test** : compte standard ; throttle reseau 3G actif.
- **Duree estimee** : 3 min

### EVT-003 - Retour accessible au lecteur d'ecran et police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande taille de police.
  2. Ouvrir l'ecran Evenements.
  3. Balayer jusqu'au bouton header gauche.
  4. Double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Retour, bouton" ; la cible reste atteignable (hitSlop 8) malgre la police agrandie ; le double-tap declenche `goBack`.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce correcte est lue et l'action s'execute ; KO si le bouton est sans libelle, hors ecran ou non focusable.
- **Donnees de test** : compte standard ; police 200% ; TalkBack ON.
- **Duree estimee** : 4 min

### EVT-004 - Basculer sur l'onglet "Mes evenements"

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; onglet "A venir" actif par defaut ; liste "Mes evenements" non vide cote API ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran (onglet "A venir" selectionne).
  2. Taper l'onglet "Mes evenements".
- **Resultat attendu** : `tab` passe a `mine` ; l'onglet "Mes evenements" prend l'etat selectionne (style `bg-primary`, `accessibilityState.selected = true`) ; la liste affichee devient `mine.data` ; l'onglet "A venir" se desactive.
- **Critere d'acceptation (OK/KO)** : OK si la liste des evenements RSVP s'affiche et l'onglet est marque selectionne ; KO si la liste ne change pas.
- **Donnees de test** : compte avec au moins 1 RSVP existant ; event `id=e1` "Building in public".
- **Duree estimee** : 2 min

### EVT-005 - Onglet "Mes evenements" vide affiche l'etat vide dedie

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard SANS RSVP ; ecran ouvert ; onglet "A venir" contient des events ; tapotements rapides successifs entre onglets pour verifier la stabilite ; reseau normal puis coupe.
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper alternativement "Mes evenements" puis "A venir" puis "Mes evenements" 6 fois en < 2 s.
  3. Couper le reseau, retaper "Mes evenements".
- **Resultat attendu** : aucune erreur ; sur l'onglet "Mes evenements" sans donnee, l'`EmptyState` titre "Tu n'as RSVP a rien pour l'instant." (`events.emptyMine`) s'affiche ; le toggle rapide ne provoque ni double rendu errone ni crash ; hors-ligne, l'etat vide (ou les donnees en cache) reste coherent sans alerte.
- **Critere d'acceptation (OK/KO)** : OK si l'etat vide correct est montre et l'UI reste stable apres multi-clic et coupure ; KO si melange de listes, spinner infini ou crash.
- **Donnees de test** : compte `qa.norsvp@chathouse.test` ; mode avion declenche a l'etape 3.
- **Duree estimee** : 4 min

### EVT-006 - Onglets accessibles (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police max ; contraste eleve.
- **Etapes** :
  1. Activer lecteur d'ecran et police 200%.
  2. Ouvrir l'ecran, balayer jusqu'a la barre d'onglets.
  3. Focus sur "A venir" puis "Mes evenements".
  4. Double-taper "Mes evenements".
- **Resultat attendu** : chaque onglet est annonce comme "bouton" avec son libelle ("A venir" / "Mes evenements") et son etat selectionne/non-selectionne (`accessibilityState.selected`) ; les libelles ne sont pas tronques en police max ; l'activation bascule l'onglet.
- **Critere d'acceptation (OK/KO)** : OK si l'etat selectionne est verbalise et le tap fonctionne ; KO si l'etat n'est pas annonce ou si le texte est coupe/illisible.
- **Donnees de test** : compte standard ; police 200% ; TalkBack ON.
- **Duree estimee** : 4 min

### EVT-007 - RSVP a un evenement (chemin nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard connecte ; onglet "A venir" ; au moins 1 evenement non encore RSVP ; Wi-Fi ; API joignable.
- **Etapes** :
  1. Ouvrir l'ecran sur "A venir".
  2. Reperer la carte "Building in public" — son bouton porte `accessibilityLabel = "RSVP · Building in public"`.
  3. Taper le bouton "RSVP".
- **Resultat attendu** : `useRsvp().mutate(event.id, { onError })` appele une fois avec `event.id = "e1"` ; `POST /rooms/e1/rsvp` ; au succes, invalidation de `['events']` -> re-fetch ; le bouton bascule en etat RSVP (libelle "Je viens", `accessibilityLabel = "Je viens · Building in public"`, style `bg-primary-container`) ; le compteur de participants peut augmenter apres refetch.
- **Critere d'acceptation (OK/KO)** : OK si la mutation est appelee 1 fois avec le bon id et le bouton reflete l'etat RSVP apres refetch ; KO si aucune requete ou si le bouton ne change pas.
- **Donnees de test** : event `{ "id": "e1", "title": "Building in public" }` ; endpoint `POST /rooms/e1/rsvp` -> `{ "data": { "rsvped": true } }`.
- **Duree estimee** : 3 min

### EVT-008 - Annuler un RSVP (toggle inverse)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; evenement deja RSVP (present dans `mine`, donc `isMine = true`) ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran ; sur l'onglet "A venir", reperer la carte deja RSVP — bouton `accessibilityLabel = "Je viens · Building in public"`.
  2. Taper le bouton "Je viens".
- **Resultat attendu** : `onToggle(event, false)` -> `useCancelRsvp().mutate("e1", { onError })` ; `DELETE /rooms/e1/rsvp` ; invalidation `['events']` ; le bouton revient a l'etat non-RSVP (libelle "RSVP", `accessibilityLabel = "RSVP · Building in public"`).
- **Critere d'acceptation (OK/KO)** : OK si `cancelRsvp.mutate` appele 1 fois avec `"e1"` et le bouton repasse en "RSVP" apres refetch ; KO sinon.
- **Donnees de test** : event `e1` deja RSVP ; `DELETE /rooms/e1/rsvp` -> `{ "data": { "cancelled": true } }`.
- **Duree estimee** : 3 min

### EVT-009 - RSVP : multi-clic rapide et perte reseau (anti double-soumission + erreur)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; carte non RSVP affichee ; reseau d'abord latent (throttle), puis coupe.
- **Etapes** :
  1. Throttler le reseau (latence ~5 s sur `POST /rooms/{id}/rsvp`).
  2. Taper "RSVP · Building in public" 5 fois en < 1 s pendant que la requete est en vol.
  3. Pendant le vol, observer l'etat `disabled` des boutons (`mutating = rsvp.isPending`).
  4. Couper le reseau et provoquer l'echec de la mutation.
- **Resultat attendu** : grace au garde `if (rsvp.isPending || cancelRsvp.isPending) return` et a `disabled={mutating}`, une seule mutation part malgre les 5 taps ; tous les boutons RSVP sont desactives le temps du vol ; a l'echec, `onError` affiche `Alert.alert("Evenements", t('errorBoundary.fallbackMessage'))` ; le bouton reste/repasse en etat non-RSVP (pas de faux positif optimiste fige).
- **Critere d'acceptation (OK/KO)** : OK si exactement 1 requete partie, boutons grises pendant le vol, et alerte d'erreur affichee a la coupure ; KO si plusieurs POST partent ou si l'app reste bloquee.
- **Donnees de test** : event `e1` ; throttle 5 s ; mode avion a l'etape 4 ; titre alerte "Evenements".
- **Duree estimee** : 5 min

### EVT-010 - RSVP : reconnexion et resynchro apres echec

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes (User A et User B) ; meme evenement `e1` ; A hors-ligne au depart puis reconnecte ; B en ligne.
- **Etapes** :
  1. User B (autre device) tape RSVP sur `e1` -> `rsvpCount` cote serveur passe a +1.
  2. User A, hors-ligne, tape "RSVP · Building in public" -> echec, alerte affichee.
  3. User A retablit le reseau.
  4. User A declenche un pull-to-refresh sur la liste (ou re-rentre dans l'ecran) pour forcer un refetch.
- **Resultat attendu** : apres reconnexion + refetch, la liste de A reflete l'etat serveur a jour, incluant le RSVP de B (compteur participants mis a jour via `events.attendeeCount`) ; si A retape RSVP en ligne, `POST` reussit et l'invalidation `['events']` resynchronise les deux listes (A venir + Mes evenements). Note : pas de push automatique — la synchro multi-utilisateur passe par le refetch/invalidation, pas par WebSocket.
- **Critere d'acceptation (OK/KO)** : OK si apres refetch l'etat de A converge vers l'etat serveur (compteur + etat bouton coherents) ; KO si l'ecran reste fige sur des donnees perimees apres reconnexion.
- **Donnees de test** : User A `qa.a@chathouse.test`, User B `qa.b@chathouse.test` ; event `e1` ; `rsvpCount` initial 3 -> 4 apres B.
- **Duree estimee** : 7 min

### EVT-011 - RSVP accessible (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police max ; contraste eleve ; au moins 1 evenement.
- **Etapes** :
  1. Activer lecteur d'ecran et police 200%.
  2. Ouvrir l'ecran, balayer jusqu'a la carte "Building in public".
  3. Focus sur le bouton RSVP.
  4. Double-taper pour activer, puis re-focus pour verifier l'annonce d'etat.
- **Resultat attendu** : le lecteur annonce le contexte complet "RSVP · Building in public, bouton" (puis "Je viens · Building in public" apres activation) — le titre de l'evenement est inclus dans le label pour lever l'ambiguite entre cartes ; l'etat `accessibilityState.selected`/`disabled` est verbalise ; le libelle du bouton reste lisible et non tronque en police 200% et contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si le titre de l'event est annonce dans le label, l'etat selectionne/desactive verbalise, et l'action s'execute ; KO si le label est generique ("RSVP" seul sans titre) ou si l'etat n'est pas annonce.
- **Donnees de test** : compte standard ; event `e1` "Building in public" ; police 200% ; TalkBack ON.
- **Duree estimee** : 5 min

### EVT-012 - Pull-to-refresh recharge la liste active

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; onglet "A venir" avec liste non vide (FlatList monte) ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran sur "A venir".
  2. Tirer la liste vers le bas pour declencher le pull-to-refresh.
- **Resultat attendu** : `activeList.refetch()` appele ; `GET /rooms?filter=upcoming` rejoue ; l'indicateur de rafraichissement s'affiche tant que `activeList.isFetching` ; la liste se met a jour (nouveaux events / compteurs RSVP).
- **Critere d'acceptation (OK/KO)** : OK si le spinner de refresh apparait et la liste reflete les donnees fraiches ; KO si rien ne se passe ou spinner infini.
- **Donnees de test** : compte standard ; liste "A venir" avec >= 1 event.
- **Duree estimee** : 3 min

### EVT-013 - Pull-to-refresh hors-ligne / refresh repete

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; liste affichee ; reseau coupe puis retabli.
- **Etapes** :
  1. Couper le reseau (mode avion).
  2. Tirer pour rafraichir 4 fois de suite rapidement.
  3. Retablir le reseau et refaire un pull-to-refresh.
- **Resultat attendu** : hors-ligne, le refetch echoue silencieusement (pas d'alerte sur cet ecran pour le fetch de liste — l'`EmptyState`/cache reste affiche) ; le multi-refresh ne lance pas de requetes concurrentes incoherentes ni de crash ; apres reconnexion, le pull-to-refresh recharge correctement la liste a jour.
- **Critere d'acceptation (OK/KO)** : OK si hors-ligne l'ecran reste stable sur le cache et qu'apres reconnexion le refresh ramene des donnees fraiches ; KO si spinner bloque, donnees vidées a tort, ou crash.
- **Donnees de test** : compte standard ; mode avion a l'etape 1, desactive a l'etape 3.
- **Duree estimee** : 4 min

### EVT-014 - Pull-to-refresh accessible et synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes (A, B) ; meme evenement `e1` ; A sur l'ecran Evenements ; lecteur d'ecran actif sur A.
- **Etapes** :
  1. User B RSVP a `e1` depuis un autre device.
  2. User A active TalkBack/VoiceOver et police agrandie.
  3. User A tire pour rafraichir la liste "A venir".
  4. User A balaie jusqu'a la carte `e1` et ecoute le compteur de participants.
- **Resultat attendu** : apres le refetch, la carte `e1` chez A affiche le compteur participants mis a jour (`events.attendeeCount` au pluriel), reflechissant le RSVP de B ; le contenu mis a jour est correctement annonce par le lecteur d'ecran ; aucune mise a jour push spontanee n'est attendue avant le geste de refresh (pas de temps-reel serveur sur cet ecran).
- **Critere d'acceptation (OK/KO)** : OK si apres refresh le compteur de A converge vers l'etat serveur post-RSVP de B et est lu correctement ; KO si le compteur reste perime apres refresh ou n'est pas verbalise.
- **Donnees de test** : User A `qa.a@chathouse.test`, User B `qa.b@chathouse.test` ; event `e1` ; `rsvpCount` 3 -> 4.
- **Duree estimee** : 6 min
