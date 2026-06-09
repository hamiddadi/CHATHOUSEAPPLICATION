# 22 - Liste des houses (`houses`)

## Contexte ecran

- **Fichier** : `src/features/houses/screens/HouseListScreen/HouseListScreen.tsx`
- **Route** : `HouseList` (dans `RoomStackParamList`). Navigue vers `HouseDetail` (param `{ houseId }`) et `CreateHouse`.
- **Roles requis** : tout utilisateur authentifie (`standard`, `admin`). Un `guest` non authentifie n'atteint pas cet ecran (il vit dans la stack des rooms protegee). Aucune permission systeme (micro/notif/localisation/stockage) n'est requise pour afficher la liste.
- **Source de donnees** : hook `useHouses(tab)` -> `@tanstack/react-query` -> `houseService.list(filter)` -> `GET /clubs?filter={mine|discover}` (REST, enveloppe `Envelope<HouseSummary[]>`). Le backend mappe `/api/clubs` sur le domaine House.
- **Comportements temps-reel** : AUCUN flux WebSocket / LiveKit / push n'est branche sur cet ecran. La liste n'est PAS live ; la fraicheur depend de react-query (refetch manuel via pull-to-refresh, invalidation apres `create/join/accept/setRole` declenches depuis d'autres ecrans). A noter pour la couverture : ce n'est donc pas un ecran "realtime core" - tous les boutons sont `isRealtime=false`.
- **Onglets** : segmented control 2 etats - `mine` ("My Houses", defaut au montage) et `discover` ("Discover"). Le changement d'onglet change la `queryKey` (`houses/list/mine` vs `houses/list/discover`) donc declenche une nouvelle requete par filtre.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` -> `Loader` plein ecran (`accessibilityLabel = t('houses.loading', 'Loading houses')`).
  - **Erreur** : `isError` -> `EmptyState` titre `t('houses.errorTitle', "Couldn't load houses")` + corps `t('houses.errorBody', 'Check your connection.')`. ATTENTION : pas de bouton "Reessayer" dans cet etat (seul le retour arriere ou le changement d'onglet permet de relancer). A signaler comme manque.
  - **Liste vide** : `data = []` -> FlatList vide (aucun `ListEmptyComponent` defini -> ecran simplement vide sous les onglets ; pas de message). A signaler comme manque UX.
  - **Hors-ligne / latence** : `GET /clubs` echoue -> etat erreur ; un retour/reentree relance la requete.
- **Pre-conditions globales** : utilisateur connecte avec token valide ; backend `/clubs` accessible ; au moins un house existant pour les cas "liste pleine".

## Matrice bouton

| #   | Bouton                | Emplacement                   | Type                                   | Locator reel                                                                                                                 | Pre-condition                            | Priorite |
| --- | --------------------- | ----------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| 1   | Retour                | Header (gauche)               | navigation                             | `accessibilityLabel="Back"` (MaterialIcons `arrow-back`)                                                                     | Ecran monte                              | P1       |
| 2   | Onglet "My Houses"    | Sous le header (TabToggle)    | toggle                                 | `getByText` `t('houses.tabs.mine', 'My Houses')` ; `accessibilityRole="tab"`, `accessibilityState.selected`                  | Ecran monte                              | P1       |
| 3   | Onglet "Discover"     | Sous le header (TabToggle)    | toggle                                 | `getByText` `t('houses.tabs.discover', 'Discover')` ; `accessibilityRole="tab"`, `accessibilityState.selected`               | Ecran monte                              | P1       |
| 4   | Cellule house (ligne) | Corps / cellule de liste      | list-item                              | `accessibilityLabel={\`Open house ${house.name}\`}`(template ; ex.`Open house Indie Hackers`) ; `accessibilityRole="button"` | Au moins 1 house dans la liste filtree   | P0       |
| 5   | Pull-to-refresh       | Corps (FlatList)              | realtime-action (refetch REST, non WS) | Geste tirer-vers-le-bas ; `FlatList.onRefresh` lie a `refetch()` ; indicateur `refreshing={isFetching}`                      | Liste affichee (pas etat loading/erreur) | P1       |
| 6   | FAB Creer une house   | Bas-droite (overlay flottant) | fab                                    | `accessibilityLabel="Create a new house"` (MaterialIcons `add`)                                                              | Ecran monte (utilisateur authentifie)    | P1       |

> Remarque : il n'y a PAS de bouton recherche (l'affordance a ete volontairement retiree, cf. commentaire dans le code : un spacer `View w-6` garde le titre centre). Il n'y a PAS de bouton "Reessayer" dans l'etat erreur, ni d'action dans l'etat vide. Le chevron `chevron-right` de chaque ligne est decoratif (il est inclus dans la zone pressable de la cellule, ce n'est pas un bouton independant).

## Cas de test

### HOUSE-LIST-001 - Retour ferme l'ecran (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, ecran HouseList ouvert depuis un ecran precedent (pile de navigation non vide), aucune permission requise
- **Etapes** :
  1. Ouvrir l'ecran "Liste des houses" depuis un ecran parent.
  2. Taper le bouton `Back` (fleche en haut a gauche).
- **Resultat attendu** : `navigation.goBack()` est appele ; l'ecran precedent reapparait sans rechargement complet.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient a l'ecran precedent ; KO si rien ne se passe ou si l'app crashe.
- **Donnees de test** : compte `std_test_01` (token valide)
- **Duree estimee** : 2 min

### HOUSE-LIST-002 - Retour : multi-clic rapide + retour pendant un fetch (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau 4G avec latence simulee (~2 s sur `GET /clubs`), ecran HouseList en cours de chargement
- **Etapes** :
  1. Brider le reseau (Network Link Conditioner / throttling) pour ralentir `GET /clubs`.
  2. Ouvrir HouseList ; pendant l'affichage du `Loader`, taper 5 fois tres vite sur `Back`.
  3. Observer la pile de navigation.
- **Resultat attendu** : un seul `goBack` effectif ; pas d'empilement de retours, pas de double pop, pas de crash ni d'ecran blanc ; toute requete en vol est abandonnee proprement.
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur revient une seule fois a l'ecran parent sans erreur console/Sentry ; KO si double pop, freeze ou crash.
- **Donnees de test** : profil throttling "3G slow", compte `std_test_01`
- **Duree estimee** : 4 min

### HOUSE-LIST-003 - Retour accessible (accessibilite)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, police systeme agrandie (200%), contraste eleve active
- **Etapes** :
  1. Activer le lecteur d'ecran + taille de police XXL + contraste eleve.
  2. Ouvrir HouseList et balayer vers le premier element focusable du header.
  3. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Back, bouton" (label `Back`, role `button`) ; double-tap declenche le retour ; l'icone `arrow-back` reste visible et contrastee en police agrandie (pas de troncature/chevauchement avec le titre centre).
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, correctement annonce et activable, et que le titre `Houses` reste lisible ; KO si non focusable, mal annonce ou layout casse.
- **Donnees de test** : compte `std_test_01` ; reglage police 200%
- **Duree estimee** : 4 min

### HOUSE-LIST-004 - Basculer sur l'onglet Discover et charger le filtre (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, backend renvoyant des houses differents pour `mine` et `discover`
- **Etapes** :
  1. Ouvrir HouseList (onglet `My Houses` selectionne par defaut).
  2. Verifier que la liste correspond a `GET /clubs?filter=mine`.
  3. Taper l'onglet `Discover`.
  4. Attendre le chargement.
- **Resultat attendu** : l'onglet `Discover` passe en etat selectionne (pilule `bg-primary`, texte `text-primary-on-container`) ; `useHouses('discover')` est invoque ; `GET /clubs?filter=discover` part ; la liste se met a jour avec les houses "a decouvrir".
- **Critere d'acceptation (OK/KO)** : OK si le contenu change et que la requete part avec `filter=discover` ; KO si la liste reste identique a `mine` ou si l'onglet ne se selectionne pas.
- **Donnees de test** : `mine` -> [Indie Hackers], `discover` -> [Designers, Startups FR]
- **Duree estimee** : 3 min

### HOUSE-LIST-005 - Bascule d'onglets : double-tap rapide + perte reseau (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau coupable a la volee (mode avion), ecran HouseList ouvert
- **Etapes** :
  1. Sur Wi-Fi, taper alternativement `My Houses` / `Discover` 8 fois en 2 s.
  2. Pendant le dernier fetch `discover`, couper le reseau (mode avion).
  3. Attendre la fin du timeout.
- **Resultat attendu** : un seul etat d'onglet final coherent (le dernier tape, `Discover`) ; pas de clignotement infini ; si le fetch echoue hors-ligne -> `EmptyState` "Couldn't load houses" / "Check your connection." (et NON un crash) ; pas de fuite de requete concurrente qui ecraserait le bon resultat.
- **Critere d'acceptation (OK/KO)** : OK si l'onglet final = `Discover` et l'etat erreur s'affiche proprement sans crash ; KO si freeze, mauvais onglet selectionne, ou liste melangee `mine`+`discover`.
- **Donnees de test** : compte `std_test_01`
- **Duree estimee** : 5 min

### HOUSE-LIST-006 - Onglets annonces et utilisables au lecteur d'ecran (accessibilite)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police agrandie 200%, contraste eleve
- **Etapes** :
  1. Activer le lecteur d'ecran et la police XXL.
  2. Balayer jusqu'au segmented control, focaliser `My Houses` puis `Discover`.
  3. Activer `Discover` par double-tap.
- **Resultat attendu** : chaque onglet est annonce avec son role `tab` et son etat selectionne (ex. "My Houses, onglet, selectionne" puis apres bascule "Discover, onglet, selectionne") ; les deux labels restent entierement lisibles cote a cote en police 200% sans troncature ; le contraste du texte sur pilule active reste suffisant.
- **Critere d'acceptation (OK/KO)** : OK si `accessibilityState.selected` est correctement reflete par le lecteur et le layout tient ; KO si l'etat selectionne n'est pas annonce ou si le texte est coupe.
- **Donnees de test** : compte `std_test_01`
- **Duree estimee** : 4 min

### HOUSE-LIST-007 - Ouvrir une house depuis sa cellule (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins une house dans l'onglet courant (ex. "Indie Hackers")
- **Etapes** :
  1. Ouvrir HouseList, onglet `My Houses`.
  2. Reperer la cellule "Indie Hackers" (avatar squircle, nom, `categorie + emoji`, nombre de membres formate, chevron).
  3. Taper la cellule.
- **Resultat attendu** : animation de press (scale 0.98) ; `navigation.navigate('HouseDetail', { houseId: 'h1' })` ; ouverture de l'ecran detail de la house "Indie Hackers".
- **Critere d'acceptation (OK/KO)** : OK si l'ecran HouseDetail s'ouvre avec le bon `houseId` ; KO si mauvaise house, pas de navigation, ou crash.
- **Donnees de test** : `house = { id: 'h1', name: 'Indie Hackers', category: 'Startups', categoryEmoji: '🚀', membersCount: 1234, privacy: 'public' }`
- **Duree estimee** : 2 min

### HOUSE-LIST-008 - Cellule house : multi-tap rapide + latence reseau (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, reseau 4G avec latence (~2 s), liste affichee avec >= 1 house
- **Etapes** :
  1. Brider le reseau.
  2. Taper 6 fois tres vite sur la meme cellule "Indie Hackers".
  3. Sur HouseDetail (qui charge lentement), couper le reseau puis le retablir.
- **Resultat attendu** : une seule navigation `HouseDetail` (pas 6 ecrans empiles) ; le detail gere proprement la coupure (etat erreur/retry cote detail) ; retour ramene une seule fois a HouseList ; aucun crash ni ecran fantome.
- **Critere d'acceptation (OK/KO)** : OK si une seule instance de HouseDetail est poussee et que la perte/reprise reseau ne provoque pas de crash ; KO si empilement multiple, freeze ou crash.
- **Donnees de test** : profil "3G slow", `houseId='h1'`
- **Duree estimee** : 5 min

### HOUSE-LIST-009 - Cellule house annoncee et lisible au lecteur d'ecran (accessibilite)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police 200%, contraste eleve
- **Etapes** :
  1. Activer le lecteur d'ecran et la police XXL.
  2. Balayer jusqu'a la premiere cellule house.
  3. Ecouter l'annonce, puis double-taper pour ouvrir.
- **Resultat attendu** : la cellule est annoncee comme "Open house Indie Hackers, bouton" (label `Open house ${name}`, role `button`) ; le nom, la categorie+emoji et le compteur de membres restent lisibles (numberOfLines geres, pas de chevauchement) en police agrandie ; double-tap ouvre le detail.
- **Critere d'acceptation (OK/KO)** : OK si la cellule entiere est un seul element focusable correctement nomme et activable ; KO si elements eclates, mal nommes, ou texte tronque illisible.
- **Donnees de test** : `house.name='Indie Hackers'`
- **Duree estimee** : 4 min

### HOUSE-LIST-010 - Cellules synchronisees apres action multi-utilisateur (temps-reel / synchro cache)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes - `admin_A` (membre/proprietaire d'une house privee) et `std_B` (invite). Deux appareils. Wi-Fi.
- **Etapes** :
  1. Sur l'appareil B (`std_B`), ouvrir HouseList onglet `My Houses` ; noter que la house privee "Indie Hackers" n'y figure PAS.
  2. Sur l'appareil A (`admin_A`), inviter `std_B` puis le faire accepter (ou `std_B` accepte une invitation CLUB_INVITE).
  3. Sur l'appareil B, declencher un pull-to-refresh sur HouseList (l'ecran n'etant pas WebSocket, la mise a jour passe par refetch/invalidation de `houseKeys.all`).
- **Resultat attendu** : apres acceptation, l'invalidation `houseKeys.all` (ou le refetch manuel) fait apparaitre "Indie Hackers" dans l'onglet `My Houses` de B ; le compteur `membersCount` reflete +1 membre ; les deux clients convergent (eventuellement apres refresh, car pas de push live).
- **Critere d'acceptation (OK/KO)** : OK si la house adhere apparait cote B apres refresh et que membersCount est coherent sur A et B ; KO si la liste reste figee meme apres refresh ou affiche un compteur incoherent.
- **Donnees de test** : `admin_A=adm_test_01`, `std_B=std_test_02`, house `id='h1'` privacy `private`
- **Duree estimee** : 7 min

### HOUSE-LIST-011 - Pull-to-refresh recharge la liste (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, liste affichee (onglet `My Houses`), au moins 1 house ; une nouvelle house creee cote backend depuis le dernier fetch
- **Etapes** :
  1. Ouvrir HouseList ; noter le contenu actuel.
  2. Tirer la liste vers le bas (pull-to-refresh) et relacher.
  3. Observer l'indicateur de rafraichissement (`refreshing` lie a `isFetching`).
- **Resultat attendu** : le spinner de refresh apparait puis disparait a la fin du `refetch()` ; `GET /clubs?filter=mine` est rejoue ; la liste integre la house nouvellement creee.
- **Critere d'acceptation (OK/KO)** : OK si la requete part et la liste se met a jour, l'indicateur se cache a la fin ; KO si le spinner reste bloque ou la liste ne change pas.
- **Donnees de test** : nouvelle house `{ name: 'QA Refresh Club' }` cote backend
- **Duree estimee** : 3 min

### HOUSE-LIST-012 - Pull-to-refresh hors-ligne + tirages repetes (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau coupe (mode avion), liste deja chargee (donnees en cache react-query)
- **Etapes** :
  1. Charger HouseList sur Wi-Fi (cache rempli) puis passer en mode avion.
  2. Tirer pour rafraichir 4 fois d'affilee rapidement.
  3. Attendre les timeouts, puis retablir le reseau et retirer une fois.
- **Resultat attendu** : hors-ligne, chaque refetch echoue mais l'indicateur finit par se cacher (pas de spinner infini) ; la liste en cache reste affichee (pas de bascule destructive vers etat vide) ; au retablissement reseau, un pull reussit et resynchronise. Aucun crash malgre les tirages multiples.
- **Critere d'acceptation (OK/KO)** : OK si le cache reste visible hors-ligne, l'indicateur ne se bloque pas, et le refetch reseau retabli reussit ; KO si spinner infini, liste videe a tort, ou crash.
- **Donnees de test** : compte `std_test_01`, cache pre-rempli
- **Duree estimee** : 5 min

### HOUSE-LIST-013 - Pull-to-refresh utilisable / annonce au lecteur d'ecran (accessibilite)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police 200%
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Sur HouseList, utiliser le geste d'actualisation accessible (sur iOS : "Refresh"/rotor ; sur Android : action d'accessibilite associee au RefreshControl).
  3. Observer l'annonce d'etat de rafraichissement.
- **Resultat attendu** : l'utilisateur lecteur d'ecran peut declencher le refresh et entend une indication de debut/fin de chargement ; en l'absence d'action accessible dediee, documenter le manque (le RefreshControl natif n'expose pas toujours d'action explicite -> defaut a remonter).
- **Critere d'acceptation (OK/KO)** : OK si le refresh est declenchable au lecteur d'ecran ET l'etat de chargement est percevable ; KO si le geste est inatteignable sans manipulation visuelle.
- **Donnees de test** : compte `std_test_01`
- **Duree estimee** : 4 min

### HOUSE-LIST-014 - Creer une house via le FAB (positif)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` authentifie, Wi-Fi, ecran HouseList affiche
- **Etapes** :
  1. Ouvrir HouseList.
  2. Taper le FAB rond `+` en bas a droite (`Create a new house`).
- **Resultat attendu** : animation de press (scale 0.9) ; `navigation.navigate('CreateHouse')` ; ouverture de l'ecran de creation de house.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran CreateHouse s'ouvre ; KO si rien ne se passe ou crash.
- **Donnees de test** : compte `std_test_01`
- **Duree estimee** : 2 min

### HOUSE-LIST-015 - FAB : multi-clic rapide (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau 4G, ecran HouseList affiche
- **Etapes** :
  1. Ouvrir HouseList.
  2. Taper le FAB `Create a new house` 6 fois tres rapidement.
  3. Revenir en arriere depuis CreateHouse.
- **Resultat attendu** : un seul ecran `CreateHouse` est pousse (pas 6) ; un seul retour ramene a HouseList ; pas de double-navigation ni de crash.
- **Critere d'acceptation (OK/KO)** : OK si une seule instance de CreateHouse dans la pile ; KO si empilement multiple ou crash.
- **Donnees de test** : compte `std_test_01`
- **Duree estimee** : 3 min

### HOUSE-LIST-016 - FAB accessible et non masquant (accessibilite)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, police 200%, contraste eleve, liste longue (>= 15 houses)
- **Etapes** :
  1. Activer le lecteur d'ecran et la police XXL.
  2. Balayer jusqu'au FAB ; ecouter l'annonce.
  3. Faire defiler la liste jusqu'en bas et verifier que le dernier item reste atteignable (padding bas = `insets.bottom + FAB_BOTTOM_OFFSET + giant`).
  4. Double-taper le FAB.
- **Resultat attendu** : le FAB est annonce "Create a new house, bouton" ; il flotte sans masquer le dernier item (le `contentContainerStyle` reserve l'espace) ; le contraste de l'icone `add` sur fond `bg-primary` est suffisant ; double-tap ouvre CreateHouse.
- **Critere d'acceptation (OK/KO)** : OK si FAB focusable, correctement annonce, n'occulte aucun contenu et activable ; KO si non focusable, masque le dernier item, ou contraste insuffisant.
- **Donnees de test** : 15 houses de test dans l'onglet `My Houses`
- **Duree estimee** : 5 min

### HOUSE-LIST-017 - Etat erreur sans bouton "Reessayer" : recuperation par re-fetch (erreur/limite, defaut UX)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, backend `/clubs` en echec (500 ou hors-ligne), ecran HouseList ouvert
- **Etapes** :
  1. Forcer un echec sur `GET /clubs` (mock 500 ou mode avion).
  2. Ouvrir HouseList et observer l'`EmptyState` d'erreur.
  3. Chercher un bouton "Reessayer".
  4. Restaurer le reseau, puis basculer d'onglet ou faire un retour/reentree pour relancer.
- **Resultat attendu** : l'`EmptyState` affiche "Couldn't load houses" + "Check your connection." ; AUCUN bouton "Reessayer" n'est present (a remonter comme defaut UX) ; la seule recuperation est le changement d'onglet (nouvelle queryKey) ou retour+reentree. Apres reseau restaure et bascule d'onglet, la liste se charge.
- **Critere d'acceptation (OK/KO)** : OK si l'etat erreur s'affiche correctement et qu'une recuperation par bascule d'onglet fonctionne ; KO si crash, ou si aucune voie de recuperation ne marche. (Defaut a ticketer : absence de retry direct.)
- **Donnees de test** : reponse mock `500 Internal Server Error` sur `/clubs?filter=mine`
- **Duree estimee** : 4 min

### HOUSE-LIST-018 - Etat liste vide (erreur/limite, defaut UX)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` neuf sans aucune house, Wi-Fi, onglet `My Houses`
- **Etapes** :
  1. Se connecter avec un compte n'appartenant a aucune house.
  2. Ouvrir HouseList, onglet `My Houses` (reponse `data: []`).
  3. Observer la zone sous les onglets.
- **Resultat attendu** : la FlatList est vide ; il n'y a PAS de `ListEmptyComponent` ni de message d'invite ("Aucune house, creez-en une") -> zone vide (a remonter comme defaut UX) ; le FAB `Create a new house` reste accessible pour creer une premiere house.
- **Critere d'acceptation (OK/KO)** : OK si l'app ne crashe pas avec liste vide et que le FAB permet de creer ; KO si crash ou si la liste vide laisse l'utilisateur sans piste. (Defaut a ticketer : pas d'empty state contextualise.)
- **Donnees de test** : compte neuf `std_empty_01`
- **Duree estimee** : 3 min
