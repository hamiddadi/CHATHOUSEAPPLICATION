# 18 - Explorateur de sujets (extensions) (`extensions`)

## Contexte ecran

- **Route / point d'entree** : composant `ExtTopicExplorerScreen` (`src/features/extensions/screens/ExtTopicExplorerScreen.tsx`). Ce n'est pas un ecran de navigation autonome avec params : il expose une prop optionnelle `onSelectTopic?: (slug: string) => void` et est monte par un conteneur parent (flux d'onboarding / selection de sujets des extensions Module 11/13.5). La selection d'un sujet n'effectue pas de navigation interne ; elle remonte le `slug` au parent via le callback.
- **Fichier ecran** : `src/features/extensions/screens/ExtTopicExplorerScreen.tsx`. AUCUN partial (le glob `screens/partials/**/*.tsx` ne retourne rien) — tout le rendu (header, barre de recherche, deux panneaux, liste plate de resultats) est dans ce seul fichier.
- **Dependances data** :
  - `useExtTopicsTree()` (`src/features/extensions/hooks/useTopics.ts`) -> `topicsApi.tree()` -> `GET /ext/topics`. `staleTime` = 24 h (donnees statiques). Fournit `{ topics: Topic[]; total }`.
  - `useExtTopicsFlat(query)` -> `topicsApi.flat({ q })` -> `GET /ext/topics/flat?q=<query>`. `staleTime` = 60 s. Fournit `FlatTopic[]`.
  - API REST (`apiClient`), React Query. **Aucun canal temps-reel** : pas de WebSocket, pas de LiveKit, pas de push consomme par cet ecran. La recherche n'est donc PAS du temps-reel au sens "coeur" du produit — c'est du REST avec re-fetch React Query. Tous les elements ont `isRealtime = false`. La seule synchro multi-appareils possible est indirecte (deux appareils recoivent le meme catalogue serveur car les sujets sont statiques cote backend).
- **Roles requis** : ecran de l'application authentifiee. Le composant n'impose aucune garde de role explicite ; il est consomme dans un flux accessible aux comptes `standard` et `admin`. Selon le point de montage, il peut aussi etre presente pendant l'onboarding d'un `guest` en cours d'activation. Aucune action destructive ni privilege admin ici.
- **Pre-conditions globales** : token valide (les endpoints `/ext/topics*` passent par `apiClient` authentifie), backend joignable, i18n charge (locale FR par defaut dans ce projet).
- **Etats de donnees pertinents** :
  - **Chargement de l'arbre** : `tree.isLoading === true` -> rendu d'un `ActivityIndicator` (style `loader`) ; ni le placeholder vide ni aucun sujet ne sont visibles.
  - **Mode navigation (deux panneaux)** : `query.trim()` vide -> `View styles.twoPane` avec panneau gauche (categories parentes, `FlatList`) et panneau droit (sous-sujets de `activeParent`).
  - **Aucune categorie selectionnee** : `activeParent === null` -> panneau droit vide -> `ListEmptyComponent` affiche `t('extensions.topics.empty')` = "Choisissez une categorie a gauche.".
  - **Mode recherche (liste plate)** : `query.trim().length > 0` -> `isSearching === true` -> `FlatList` unique alimentee par `flat.data` (`useExtTopicsFlat`). Les deux panneaux disparaissent.
  - **Recherche sans resultat** : `flat.data` vide ou `undefined` -> `FlatList` vide, AUCUN `ListEmptyComponent` n'est defini pour la liste plate (ecran « vide » sans message). A signaler comme defaut UX potentiel.
  - **Hors-ligne / erreur** : `tree.isError` / `flat.isError` ne sont PAS traites par le composant (pas d'alerte, pas de bouton « Reessayer », pas d'etat d'erreur affiche). En erreur d'arbre on reste sur le loader si `isLoading` reste vrai, sinon on tombe sur le mode navigation avec `tree.data` undefined -> panneau gauche vide + placeholder. A signaler comme limite.
  - **Etats des cellules** : categorie parente active = `item.slug === activeParent` -> styles `parentRowActive` / `parentLabelActive` + `accessibilityState.selected = true`.

## Matrice bouton

| #   | Bouton                                      | Emplacement                                             | Type                                        | Locator reel                                                                                                                                                           | Pre-condition                                                                      | Priorite |
| --- | ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| 1   | Champ de recherche de sujets                | Header (corps haut)                                     | input-submit                                | `accessibilityLabel = t('extensions.topics.searchA11y')` = "Rechercher des sujets" ; placeholder `t('extensions.topics.searchPlaceholder')` = "Rechercher des sujets…" | Ecran monte (arbre charge ou non) ; reseau pour resultats                          | P1       |
| 2   | Cellule categorie parente (panneau gauche)  | Corps — panneau gauche (`FlatList`, `styles.parentRow`) | toggle (selection d'onglet)                 | `accessibilityRole="tab"` + `accessibilityState.selected` ; texte via `getByText(item.label)` (ex. "Technology") ; emoji adjacent                                      | Arbre charge (`tree.data.topics` non vide), mode navigation (champ recherche vide) | P1       |
| 3   | Cellule sous-sujet (panneau droit)          | Corps — panneau droit (`FlatList`, `styles.childRow`)   | list-item (navigation logique via callback) | `accessibilityRole="button"` + `accessibilityLabel = t('extensions.topics.selectSubTopicA11y', { label })` = "Selectionner le sous-sujet {{label}}"                    | Une categorie parente selectionnee (`activeParent` non null) avec enfants          | P0       |
| 4   | Cellule resultat de recherche (liste plate) | Corps — liste plate (`FlatList`, `styles.flatRow`)      | list-item (navigation logique via callback) | `accessibilityRole="button"` + `accessibilityLabel = t('extensions.topics.selectTopicA11y', { label })` = "Selectionner le sujet {{label}}"                            | Mode recherche actif (`query.trim()` non vide) et au moins un resultat             | P0       |

> Remarque : il n'y a PAS de bouton retour/fermer dans ce composant (la fermeture est geree par le conteneur parent), PAS de FAB, PAS de switch/toggle binaire, PAS de checkbox, PAS de pull-to-refresh, PAS de long-press ni de swipe, PAS de lien legal. Le `placeholder` vide du panneau droit (`extensions.topics.empty`) est un texte non actionnable. Les emojis et libelles ne sont pressables que via la cellule parente — pas individuellement.

## Cas de test

### EXT-TOPIC-001 - Recherche : taper une requete bascule en liste plate de resultats

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; arbre des sujets charge (`GET /ext/topics` OK) ; Wi-Fi ; aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'ecran Explorateur de sujets (mode navigation deux panneaux visible).
  2. Localiser le champ via `accessibilityLabel = "Rechercher des sujets"`.
  3. Saisir `intelli`.
  4. Attendre le rendu de la liste plate (`useExtTopicsFlat('intelli')` -> `GET /ext/topics/flat?q=intelli`).
- **Resultat attendu** : `isSearching` passe a vrai ; les deux panneaux disparaissent ; une `FlatList` unique affiche les resultats fuzzy (ex. cellule "Artificial Intelligence" avec emoji). Le champ conserve la valeur saisie.
- **Critere d'acceptation (OK/KO)** : OK si la liste plate s'affiche et contient au moins la ligne attendue pour la requete ; KO si l'arbre reste affiche ou si l'ecran est vide alors que des resultats existent.
- **Donnees de test** : requete `intelli` ; reponse `[{ "slug": "ai", "label": "Artificial Intelligence", "emoji": "🤖", "parent": "tech" }]`.
- **Duree estimee** : 3 min

### EXT-TOPIC-002 - Recherche : multi-frappe rapide + perte reseau ne fige pas l'ecran

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; arbre charge ; reseau commutable (Wi-Fi -> mode avion -> Wi-Fi) ; throttle 3G disponible.
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Dans le champ "Rechercher des sujets", taper tres vite `a`, `ai`, `ai `, puis effacer jusqu'a vider (back-space rapide), puis retaper `web` (10+ frappes en < 2 s).
  3. Pendant la frappe, activer le mode avion pour couper le reseau, attendre 3 s, le reactiver.
  4. Laisser React Query re-fetcher.
- **Resultat attendu** : pas de crash ni de gel ; chaque changement de texte met a jour `query` et la cle React Query `['ext','topics','flat', q, ...]` ; la derniere requete gagne (pas d'affichage de resultats perimes d'une frappe precedente une fois le reseau revenu). Champ vide -> retour automatique au mode navigation (deux panneaux). Note QA : l'absence de `ListEmptyComponent` sur la liste plate signifie qu'en l'absence de resultat l'ecran reste vide sans message — a consigner comme defaut UX, KO produit mais conforme au code actuel.
- **Critere d'acceptation (OK/KO)** : OK si l'UI reste reactive, n'affiche pas de resultats incoherents avec la requete finale, et revient au mode navigation quand le champ est vide ; KO si crash, gel, ou affichage de resultats d'une requete abandonnee.
- **Donnees de test** : sequence de frappes `a`,`ai`,`ai `,(effacer),`web` ; coupure reseau 3 s.
- **Duree estimee** : 6 min

### EXT-TOPIC-003 - Recherche : accessibilite lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee sur le maximum ; arbre charge.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande taille de police systeme.
  2. Balayer jusqu'au champ de recherche.
  3. Verifier l'annonce ; saisir `tech` au clavier accessible.
  4. Inspecter le contraste du texte saisi (`colors.text`) et du placeholder (`colors.textDim`) sur fond `colors.surfaceHigh`.
- **Resultat attendu** : le lecteur annonce le champ comme « Rechercher des sujets, champ de texte » (via `accessibilityLabel`). Le placeholder n'est lu que tant que le champ est vide. Le texte saisi reste lisible et non tronque a la plus grande police (champ a hauteur fixe `paddingVertical: 10` — verifier qu'aucune coupe verticale n'a lieu). Contraste texte/fond >= 4.5:1 (WCAG AA).
- **Critere d'acceptation (OK/KO)** : OK si le champ est focusable, correctement annonce, utilisable au clavier accessible et lisible en grande police avec contraste AA ; KO si non focusable, label generique « Edit box » sans nom, ou texte tronque/illisible.
- **Donnees de test** : requete `tech` ; ratios de contraste mesures (cible >= 4.5:1).
- **Duree estimee** : 5 min

### EXT-TOPIC-004 - Categorie parente : selection revele les sous-sujets a droite

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; arbre charge avec au moins une categorie ayant des enfants (ex. "Technology" -> "Artificial Intelligence", "Web Development") ; champ de recherche vide ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran (mode navigation ; panneau droit affiche "Choisissez une categorie a gauche.").
  2. Dans le panneau gauche, taper la cellule "Technology" (`accessibilityRole="tab"`, texte via `getByText('Technology')`).
- **Resultat attendu** : `setActiveParent('tech')` ; la cellule devient active (`accessibilityState.selected = true`, styles `parentRowActive`/`parentLabelActive`) ; le panneau droit liste "Artificial Intelligence" et "Web Development" ; le placeholder vide disparait.
- **Critere d'acceptation (OK/KO)** : OK si les sous-sujets de la categorie tapee apparaissent et que l'onglet est marque selectionne ; KO si rien ne change ou si les enfants d'une autre categorie s'affichent.
- **Donnees de test** : `treeData = { topics: [tech, arts], total: 2 }` ; `tech.children = [ai, web]`.
- **Duree estimee** : 3 min

### EXT-TOPIC-005 - Categorie parente : double/triple tap rapide entre deux categories reste coherent

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; arbre charge (>= 2 categories) ; throttle 3G actif ; champ vide.
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper tres vite, en moins d'1 s : "Technology", "Arts", "Technology" (3 taps).
  3. Observer le panneau droit apres stabilisation.
- **Resultat attendu** : `activeParent` reflete le dernier tap ("tech") ; le panneau droit affiche les enfants de la derniere categorie selectionnee uniquement (pas de melange) ; un seul onglet a `selected = true` ; aucune requete reseau (l'arbre est deja en cache, selection purement locale). Pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si la derniere selection prime, un seul onglet actif, enfants coherents ; KO si deux onglets actifs, enfants melanges, ou crash.
- **Donnees de test** : taps successifs "Technology"/"Arts"/"Technology".
- **Duree estimee** : 4 min

### EXT-TOPIC-006 - Categorie parente : accessibilite role onglet + etat selectionne + grande police

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police systeme maximale ; arbre charge.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande police.
  2. Balayer dans le panneau gauche jusqu'a une categorie (ex. "Technology").
  3. Ecouter l'annonce avant et apres double-tap d'activation.
  4. Verifier le contraste du libelle actif (`parentLabelActive` = `colors.text`) vs inactif (`parentLabel` = `colors.textMuted`) sur fond `parentRowActive` (`colors.overlayWhite5`).
- **Resultat attendu** : la cellule est annoncee avec le role « onglet » (`accessibilityRole="tab"`) et, une fois selectionnee, comme « selectionne » (`accessibilityState.selected`). Le libelle (font 13) doit rester lisible/non tronque en grande police dans un panneau de largeur fixe `flexBasis: 140`. Contraste du libelle inactif (`colors.textMuted`) a verifier specifiquement (risque < AA).
- **Critere d'acceptation (OK/KO)** : OK si role onglet + etat selectionne annonces, libelle lisible en grande police, contraste actif >= 4.5:1 ; KO si role non annonce, etat selectionne absent, libelle tronque, ou contraste inactif insuffisant signale.
- **Donnees de test** : categorie "Technology" ; ratios de contraste mesures.
- **Duree estimee** : 5 min

### EXT-TOPIC-007 - Sous-sujet : la selection remonte le slug au parent (onSelectTopic)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; arbre charge ; une categorie parente deja selectionnee affichant ses enfants ; callback `onSelectTopic` branche par le conteneur ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran et taper "Technology" (panneau gauche).
  2. Dans le panneau droit, taper "Web Development" (`accessibilityLabel = "Selectionner le sous-sujet Web Development"`).
- **Resultat attendu** : `onSelectTopic` est appele exactement une fois avec `'web'` (le `slug` de l'item). Le conteneur parent reagit (selection enregistree / navigation amont) — non gere par cet ecran.
- **Critere d'acceptation (OK/KO)** : OK si `onSelectTopic('web')` est emis une seule fois ; KO si non appele, appele avec un mauvais slug, ou appele plusieurs fois pour un tap.
- **Donnees de test** : sous-sujet `{ slug: 'web', label: 'Web Development', emoji: '🌐' }`.
- **Duree estimee** : 3 min

### EXT-TOPIC-008 - Sous-sujet : double-tap rapide n'emet pas deux selections

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; categorie selectionnee avec enfants ; latence reseau elevee (throttle 3G) ; `onSelectTopic` instrumente pour compter les appels.
- **Etapes** :
  1. Ouvrir l'ecran, selectionner une categorie, afficher ses enfants.
  2. Taper deux fois tres vite (< 300 ms) la meme cellule sous-sujet "Web Development".
  3. Si le conteneur declenche une action reseau au `onSelectTopic`, couper le reseau juste apres le premier tap puis le retablir.
- **Resultat attendu** : le composant n'a pas de garde anti-double-tap interne (chaque press appelle `onSelectTopic`). A consigner : si le parent ne deduplique pas, deux selections identiques peuvent etre emises. Verifier que cela ne provoque pas double navigation/double POST cote conteneur ; la cellule ne doit pas crasher ni geler. Recommander une garde (debounce/disabled) cote parent si effet de bord reseau.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash et si l'effet observable cote parent reste idempotent (une seule navigation/POST effectif) ; KO si double navigation, double effet reseau non idempotent, ou crash.
- **Donnees de test** : deux taps < 300 ms sur slug `web` ; coupure reseau 2 s.
- **Duree estimee** : 5 min

### EXT-TOPIC-009 - Sous-sujet : accessibilite label parametre + grande police + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police systeme maximale ; categorie selectionnee avec enfants.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande police.
  2. Selectionner une categorie, puis balayer dans le panneau droit jusqu'a "Web Development".
  3. Ecouter l'annonce ; double-tap pour activer.
  4. Verifier la lisibilite du libelle (font 15, `colors.text`) sur fond `colors.background` et la non-troncature.
- **Resultat attendu** : annonce « Selectionner le sous-sujet Web Development, bouton » (label interpole `t('extensions.topics.selectSubTopicA11y', { label })`, role `button`). Double-tap declenche `onSelectTopic('web')`. Libelle lisible et non tronque en grande police ; cible tactile >= 44x44 pt (verifier hauteur de ligne `paddingVertical: 14`). Contraste >= 4.5:1.
- **Critere d'acceptation (OK/KO)** : OK si label parametre correct, role bouton, activation fonctionnelle, lisibilite et contraste AA ; KO si label generique/non interpole, role manquant, cible trop petite, ou texte tronque.
- **Donnees de test** : label "Web Development" ; cible tactile mesuree.
- **Duree estimee** : 5 min

### EXT-TOPIC-010 - Sous-sujet : synchro multi-appareils du catalogue (REST, pas push)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux appareils (A et B) connectes a deux comptes standard distincts ; meme backend ; arbre des sujets statique cote serveur.
- **Etapes** :
  1. Sur A et B, ouvrir l'ecran et selectionner la meme categorie "Technology".
  2. Sur A, taper "Web Development" ; sur B, taper "Artificial Intelligence".
  3. Comparer les `slug` remontes par `onSelectTopic` sur chaque appareil.
  4. Forcer un re-fetch (re-monter l'ecran) apres expiration du `staleTime` (24 h arbre / 60 s recherche) ou via invalidation manuelle.
- **Resultat attendu** : chaque appareil emet independamment son propre `slug` (`web` sur A, `ai` sur B) ; aucune diffusion temps-reel entre appareils (pas de WebSocket/LiveKit/push sur cet ecran). Le catalogue affiche est identique sur A et B car servi par le meme `GET /ext/topics`. Aucun etat partage en direct n'est attendu — confirmer qu'il n'y en a pas (sinon c'est un bug).
- **Critere d'acceptation (OK/KO)** : OK si les deux appareils voient le meme catalogue et que chaque selection reste locale a son appareil ; KO si une selection sur A modifie l'UI de B, ou si les catalogues different sans changement serveur.
- **Donnees de test** : comptes `qa.standard.a@chathouse.test`, `qa.standard.b@chathouse.test` ; slugs `web` / `ai`.
- **Duree estimee** : 6 min

### EXT-TOPIC-011 - Resultat de recherche : selection remonte le slug (onSelectTopic)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; recherche active retournant au moins un resultat ; `onSelectTopic` branche ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran, taper `intelli` dans le champ de recherche.
  2. Attendre la liste plate ; taper la cellule "Artificial Intelligence" (`accessibilityLabel = "Selectionner le sujet Artificial Intelligence"`).
- **Resultat attendu** : `onSelectTopic` est appele exactement une fois avec `'ai'` (slug du `FlatTopic`). La liste plate reste affichee (l'ecran ne reinitialise pas la recherche de lui-meme).
- **Critere d'acceptation (OK/KO)** : OK si `onSelectTopic('ai')` est emis une seule fois ; KO si mauvais slug, non appele, ou appels multiples.
- **Donnees de test** : `flatResults = [{ slug: 'ai', label: 'Artificial Intelligence', emoji: '🤖', parent: 'tech' }]`.
- **Duree estimee** : 3 min

### EXT-TOPIC-012 - Resultat de recherche : zero resultat + reseau lent ne montre aucun message (limite UX)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; reseau throttle 3G puis coupure ; requete sans correspondance.
- **Etapes** :
  1. Ouvrir l'ecran, taper une requete sans correspondance, ex. `zzzqwx`.
  2. Attendre la reponse (`GET /ext/topics/flat?q=zzzqwx` -> `{ items: [] }`).
  3. Couper le reseau, taper `xyz`, attendre, retablir le reseau.
- **Resultat attendu** : la liste plate est vide ; AUCUN `ListEmptyComponent` n'etant defini sur la liste plate dans le code, l'ecran reste blanc sous le header sans message « aucun resultat ». A consigner comme defaut UX (recommander un etat vide dedie). En coupure reseau, la requete echoue silencieusement (aucune gestion d'erreur visible) ; au retour reseau React Query re-fetche selon ses regles. Pas de crash.
- **Critere d'acceptation (OK/KO)** : OK (conforme code) si pas de crash et liste vide ; defaut UX a remonter car aucun message d'absence de resultat / d'erreur reseau n'est affiche. KO produit si un message d'etat vide/erreur est exige par la spec.
- **Donnees de test** : requetes `zzzqwx`, `xyz` ; reponses `{ "items": [] }`.
- **Duree estimee** : 5 min

### EXT-TOPIC-013 - Resultat de recherche : accessibilite label parametre + grande police + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police systeme maximale ; recherche retournant des resultats.
- **Etapes** :
  1. Activer le lecteur d'ecran et la plus grande police.
  2. Taper `intelli` dans le champ ; balayer jusqu'a la cellule resultat.
  3. Ecouter l'annonce ; double-tap pour activer.
  4. Verifier lisibilite (font 15 `flatLabel`) et non-troncature ; emoji decoratif annonce de maniere non intrusive.
- **Resultat attendu** : annonce « Selectionner le sujet Artificial Intelligence, bouton » (label `t('extensions.topics.selectTopicA11y', { label })`, role `button`). Double-tap -> `onSelectTopic('ai')`. Cible tactile >= 44 pt (`paddingVertical: 14`). Contraste libelle/fond >= 4.5:1. L'emoji ne doit pas casser l'annonce du libelle.
- **Critere d'acceptation (OK/KO)** : OK si label parametre correct, role bouton, activation OK, lisibilite + contraste AA ; KO si label non interpole/generique, role manquant, cible trop petite, ou texte tronque.
- **Donnees de test** : label "Artificial Intelligence" ; cible tactile mesuree.
- **Duree estimee** : 5 min

### EXT-TOPIC-014 - Chargement de l'arbre : aucun sujet ni placeholder visible pendant le loader

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard ; `GET /ext/topics` ralenti (throttle) pour observer l'etat `isLoading` ; champ de recherche vide.
- **Etapes** :
  1. Ouvrir l'ecran avec une reponse `/ext/topics` differee.
  2. Observer la zone sous le header pendant le chargement.
- **Resultat attendu** : un `ActivityIndicator` (style `loader`, marge haute) est affiche ; ni le placeholder `t('extensions.topics.empty')` ni aucune cellule de categorie ne sont rendus tant que `tree.isLoading` est vrai. A la fin du chargement, le mode navigation deux panneaux apparait.
- **Critere d'acceptation (OK/KO)** : OK si seul le loader est visible pendant le chargement puis les panneaux apparaissent ; KO si le placeholder/categories apparaissent prematurement ou si le loader ne disparait jamais.
- **Donnees de test** : reponse `/ext/topics` differee de ~3 s.
- **Duree estimee** : 3 min

### EXT-TOPIC-015 - Vider la recherche revient au mode navigation deux panneaux

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; arbre charge ; recherche active avec resultats ; Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran, taper `tech` (liste plate affichee).
  2. Effacer entierement le champ (champ vide).
- **Resultat attendu** : `isSearching` repasse a faux ; la liste plate disparait ; le mode navigation deux panneaux reapparait avec l'etat precedent de `activeParent` (si une categorie etait selectionnee avant la recherche, son panneau droit reste coherent ; sinon le placeholder `t('extensions.topics.empty')` s'affiche).
- **Critere d'acceptation (OK/KO)** : OK si l'effacement restaure les deux panneaux ; KO si la liste plate reste affichee ou si l'ecran reste vide.
- **Donnees de test** : requete `tech` puis champ vide.
- **Duree estimee** : 2 min
