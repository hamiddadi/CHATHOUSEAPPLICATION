# 32 - Selection des centres d'interet (`onboarding`)

## Contexte ecran

- **Route** : `InterestSelection` dans `OnboardingNavigator` (deep link `onboarding/interests`). C'est l'etape 2 du parcours d'onboarding (apres `Onboarding`/SetupProfile, avant `NotificationsPermission`).
- **Fichier** : `src/features/onboarding/screens/InterestSelectionScreen/InterestSelectionScreen.tsx`. Aucun partial (pas de sous-dossier `partials/`).
- **Roles requis** : utilisateur authentifie en cours d'onboarding (compte `standard` nouvellement cree, profil non finalise). Pas d'acces `guest` (le stack onboarding n'est monte qu'apres auth) ; pas d'action `admin`.
- **Header** : `headerShown: false` au niveau du navigateur — il n'y a **aucun bouton retour/fermer natif rendu**. Le retour se fait uniquement par geste systeme (swipe Android/iOS) ou bouton materiel Android, hors scope UI de l'ecran. Seuls 2 types d'elements interactifs sont rendus par l'ecran : les **chips de centres d'interet** (7) et le **bouton Terminer** (1).
- **Comportements temps-reel** : **AUCUN**. Cet ecran ne touche ni WebSocket, ni LiveKit, ni push. La selection est purement locale (state React `useState<Set>`). Le bouton Terminer ne fait **aucun appel reseau** : il ecrit la selection dans le store Zustand `useOnboardingStore.setInterests(...)` (ephemere, en memoire) puis navigue. Le flush reseau (PATCH profil) a lieu plus tard, a l'etape `SuggestedFollows` (« Finish »). Donc latence/perte reseau n'affecte PAS cet ecran.
- **Pre-conditions globales** : etre dans le flux onboarding (sinon l'ecran n'est pas atteignable). i18n FR ou EN charge. Le store onboarding peut deja contenir un `displayName`/`bio` de l'etape precedente (sans impact ici).
- **Regles metier** : minimum `MIN_INTERESTS = 3` requis pour activer Terminer ; maximum `MAX_INTERESTS = 10` selectionnables (mais seulement 7 categories existent au catalogue, donc le plafond 10 n'est jamais atteint en pratique — le code clamp quand meme a 10). Catalogue : `tech, design, crypto, ai, music, business, health` (`INTEREST_CATEGORIES` dans `schemas.ts`).
- **Etats de donnees pertinents** :
  - **Liste « vide »** (0 selection) : sous-titre + hint `onboarding.interests.minHint` (« Au moins 3. »), bouton Terminer **desactive**.
  - **1-2 selections** : hint minHint toujours affiche, Terminer **desactive**.
  - **>= 3 selections** : le hint passe au compteur `« N / 10 »`, Terminer **active**.
  - **Hors-ligne** : sans effet sur cet ecran (aucun I/O reseau). La selection reste possible et la navigation vers `NotificationsPermission` fonctionne offline.

## Matrice bouton

| #   | Bouton                   | Emplacement                 | Type                | Locator reel                                                                                                                            | Pre-condition                            | Priorite |
| --- | ------------------------ | --------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| 1   | Chip « Tech »            | Corps (ScrollView de chips) | toggle              | Texte `t('onboarding.interests.categories.tech')` = « Tech » ; `accessibilityRole="button"` + `accessibilityState={{selected}}`         | Ecran monte                              | P1       |
| 2   | Chip « Design »          | Corps (chips)               | toggle              | Texte `onboarding.interests.categories.design` = « Design »                                                                             | Ecran monte                              | P1       |
| 3   | Chip « Crypto »          | Corps (chips)               | toggle              | Texte `onboarding.interests.categories.crypto` = « Crypto »                                                                             | Ecran monte                              | P1       |
| 4   | Chip « IA » (AI)         | Corps (chips)               | toggle              | Texte `onboarding.interests.categories.ai` = « IA » (FR) / « AI » (EN)                                                                  | Ecran monte                              | P1       |
| 5   | Chip « Musique » (Music) | Corps (chips)               | toggle              | Texte `onboarding.interests.categories.music` = « Musique » (FR) / « Music » (EN)                                                       | Ecran monte                              | P1       |
| 6   | Chip « Business »        | Corps (chips)               | toggle              | Texte `onboarding.interests.categories.business` = « Business »                                                                         | Ecran monte                              | P1       |
| 7   | Chip « Sante » (Health)  | Corps (chips)               | toggle              | Texte `onboarding.interests.categories.health` = « Sante » (FR) / « Health » (EN)                                                       | Ecran monte                              | P1       |
| 8   | Bouton « Terminer »      | Bas (barre d'action)        | submit / navigation | Texte/label `t('onboarding.interests.finish')` = « Terminer » (FR) / « Finish » (EN) ; composant `<Button variant="primary" size="lg">` | >= 3 chips selectionnees pour etre actif | P0       |

> Note : les 7 chips partagent le meme comportement (toggle add/remove avec clamp a 10). Pour eviter une duplication mecanique, les cas de test detaillent le chip « Tech » comme representant nominal du comportement toggle, plus les cas de limite (plafond, deselection) qui couvrent l'ensemble du groupe. Le bouton Terminer (P0, chemin critique de progression d'onboarding) est traite exhaustivement.

## Cas de test

### ONB-INT-001 - Selection d'un chip (toggle ON)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, ecran « Choisis quelques centres d'interet » affiche, 0 chip selectionne, reseau Wi-Fi (sans importance), aucune permission requise.
- **Etapes** :
  1. Observer l'etat initial : hint « Au moins 3. » visible, bouton Terminer grise/desactive.
  2. Taper le chip « Tech ».
  3. Observer le chip et le hint.
- **Resultat attendu** : le chip « Tech » passe en etat selectionne (fond `colors.primary`, libelle en gras/inverse, `accessibilityState.selected=true`). Le compteur reste « Au moins 3. » (1 < 3). Bouton Terminer toujours desactive.
- **Critere d'acceptation (OK/KO)** : OK si le chip affiche visuellement l'etat selectionne ET `accessibilityState.selected` passe a `true` ; KO sinon.
- **Donnees de test** : chip = `tech`.
- **Duree estimee** : 2 min

### ONB-INT-002 - Deselection d'un chip + multi-clic rapide (toggle OFF / anti double-tap)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, ecran affiche, reseau indifferent.
- **Etapes** :
  1. Selectionner `tech`, `design`, `crypto` (3 chips) — le compteur affiche « 3 / 10 », Terminer actif.
  2. Taper a nouveau `crypto` (deselection).
  3. Effectuer un double-tap tres rapide (2 taps < 300 ms) sur `design`.
- **Resultat attendu** : apres etape 2, `crypto` repasse non-selectionne, compteur retombe a « Au moins 3. » (2 selectionnes), Terminer redevient desactive. Apres etape 3, le double-tap rapide produit exactement 2 bascules (ON puis OFF) : `design` revient a non-selectionne, l'etat est coherent et idempotent (pas de selection « fantome » ni d'incoherence du compteur). Aucun crash.
- **Critere d'acceptation (OK/KO)** : OK si chaque tap inverse l'etat de maniere deterministe et le compteur reste exact ; KO si un tap rapide laisse l'UI dans un etat incoherent ou si le compteur diverge du nombre reel de chips selectionnes.
- **Donnees de test** : sequence taps `tech, design, crypto, crypto, design x2`.
- **Duree estimee** : 3 min

### ONB-INT-003 - Plafond de selection MAX_INTERESTS (limite haute)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding, ecran affiche. (Le catalogue ne compte que 7 categories alors que le plafond code est 10 ; ce cas verifie qu'on peut tout selectionner sans depasser et que le clamp ne bloque pas en deca de 10.)
- **Etapes** :
  1. Selectionner successivement les 7 chips : `tech, design, crypto, ai, music, business, health`.
  2. Observer le compteur.
  3. Tenter de re-taper un chip deja selectionne (`tech`).
- **Resultat attendu** : les 7 chips passent selectionnes, compteur « 7 / 10 », Terminer actif. Aucun chip n'est refuse (7 < plafond 10). Re-taper `tech` le deselectionne (compteur « 6 / 10 »). Aucun comportement de blocage tant que < 10.
- **Critere d'acceptation (OK/KO)** : OK si les 7 chips sont selectionnables sans rejet et le compteur affiche « 7 / 10 » ; KO si un chip est refuse alors que < 10 sont selectionnes.
- **Donnees de test** : 7 categories = tout le catalogue `INTEREST_CATEGORIES`.
- **Duree estimee** : 3 min

### ONB-INT-004 - Chips accessibilite (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; mode contraste eleve active si dispo.
- **Etapes** :
  1. Activer le lecteur d'ecran et balayer jusqu'au premier chip.
  2. Ecouter l'annonce vocale du chip « Tech » non-selectionne.
  3. Double-taper pour activer (selectionner) le chip.
  4. Ecouter l'annonce apres selection.
  5. Verifier le rendu avec police agrandie (libelles non tronques) et le contraste libelle/fond en etat selectionne et non-selectionne.
- **Resultat attendu** : chaque chip est annonce comme « bouton » (`accessibilityRole="button"`) avec son libelle (« Tech »), et l'etat selectionne/non-selectionne est vocalise via `accessibilityState.selected` (« selectionne » / « non selectionne ») apres bascule. Avec police max, les libelles restent lisibles (chips wrap correctement, pas de texte coupe). Le contraste texte/fond respecte WCAG AA (>= 4.5:1) dans les deux etats.
- **Critere d'acceptation (OK/KO)** : OK si role, libelle ET etat selectionne sont correctement annonces et le texte reste lisible a police max ; KO si l'etat selectionne n'est pas vocalise ou si un libelle est tronque.
- **Donnees de test** : chip `tech` ; police systeme « tres grande » ; locale FR.
- **Duree estimee** : 5 min

### ONB-INT-005 - Terminer avec selection valide (>= 3) : persistance store + navigation

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` en onboarding, ecran affiche, reseau Wi-Fi (indifferent car pas d'I/O reseau ici).
- **Etapes** :
  1. Selectionner `tech`, `design`, `crypto`.
  2. Verifier que le compteur affiche « 3 / 10 » et que Terminer est actif.
  3. Taper « Terminer ».
- **Resultat attendu** : `useOnboardingStore.setInterests(['tech','design','crypto'])` est appele avec la selection exacte (ordre d'insertion preserve), puis navigation vers l'ecran `NotificationsPermission`. Aucune requete reseau emise par cet ecran.
- **Critere d'acceptation (OK/KO)** : OK si `setInterests` recoit `['tech','design','crypto']` ET `navigation.navigate('NotificationsPermission')` est appele une fois ; KO sinon.
- **Donnees de test** : selection `['tech','design','crypto']`.
- **Duree estimee** : 2 min

### ONB-INT-006 - Terminer en dessous du minimum + multi-clic rapide (garde MIN_INTERESTS)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` en onboarding, ecran affiche.
- **Etapes** :
  1. Selectionner uniquement `tech` (1 chip) — hint « Au moins 3. » visible, Terminer desactive.
  2. Taper « Terminer » plusieurs fois rapidement (5 taps en < 1 s).
  3. Selectionner `design` (2 chips), re-taper « Terminer » rapidement.
- **Resultat attendu** : le bouton etant `disabled` (canSubmit=false tant que < 3), aucun tap ne declenche `onFinish`. De plus la garde interne `if (interests.length < MIN_INTERESTS) return;` empeche toute navigation/persistance meme si l'evenement passait. Apres 1 et 2 chips : `setInterests` JAMAIS appele, `navigation.navigate` JAMAIS appele, on reste sur l'ecran. Le multi-clic rapide ne provoque ni double navigation ni crash.
- **Critere d'acceptation (OK/KO)** : OK si avec < 3 chips, ni `setInterests` ni `navigate` ne sont jamais appeles quel que soit le nombre de taps ; KO si une navigation ou persistance survient sous le seuil.
- **Donnees de test** : selection `['tech']` puis `['tech','design']` ; 5 taps rapides sur Terminer.
- **Duree estimee** : 3 min

### ONB-INT-007 - Terminer hors-ligne (resilience reseau / pas d'I/O sur cet ecran)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, ecran affiche, **mode avion / hors-ligne active**.
- **Etapes** :
  1. Couper le reseau (mode avion).
  2. Selectionner `tech`, `design`, `crypto`.
  3. Taper « Terminer ».
  4. Reactiver le reseau apres navigation.
- **Resultat attendu** : la selection et la navigation vers `NotificationsPermission` fonctionnent **normalement hors-ligne** (aucun spinner reseau, aucun toast d'erreur, aucun timeout) car la persistance est locale (store Zustand) et le flush reseau est differe a l'etape SuggestedFollows. La selection survit dans le store. Pas de regression a la reconnexion.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran progresse vers `NotificationsPermission` sans erreur reseau ni blocage en mode avion ; KO si un appel reseau est tente/echoue ou si la navigation est bloquee.
- **Donnees de test** : selection `['tech','design','crypto']` ; etat reseau = hors-ligne puis online.
- **Duree estimee** : 3 min

### ONB-INT-008 - Bouton Terminer accessibilite (lecteur d'ecran + police agrandie + contraste + etat disabled)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack/VoiceOver actif ; police systeme au maximum ; contraste eleve si dispo.
- **Etapes** :
  1. Avec 0 chip selectionne, balayer jusqu'au bouton « Terminer ».
  2. Ecouter l'annonce vocale (libelle + etat desactive).
  3. Tenter un double-tap d'activation alors qu'il est desactive.
  4. Selectionner 3 chips, retourner au bouton, ecouter l'annonce (maintenant active) et l'activer.
  5. Verifier la lisibilite du libelle « Terminer » a police max et le contraste du bouton primaire.
- **Resultat attendu** : le bouton est annonce avec son libelle « Terminer » et son etat (« desactive » quand < 3 selections, ce qui empeche l'activation via le lecteur d'ecran), puis « actif/bouton » apres >= 3 selections. L'activation accessible avec >= 3 chips declenche la navigation. Le libelle reste lisible a police max (pas tronque) et le contraste texte/fond du bouton primaire respecte WCAG AA.
- **Critere d'acceptation (OK/KO)** : OK si l'etat disabled est vocalise et bloque l'activation sous le seuil, puis l'activation fonctionne au-dessus du seuil avec libelle lisible ; KO si le bouton desactive reste activable au lecteur d'ecran ou si l'etat n'est pas annonce.
- **Donnees de test** : selection finale `['tech','design','crypto']` ; police « tres grande ».
- **Duree estimee** : 5 min

### ONB-INT-009 - Coherence multi-instance / retour-arriere (persistance et re-entree dans l'ecran)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding. (NB : cet ecran n'a pas de synchro reseau multi-appareil ; ce cas couvre la coherence d'etat lors d'une navigation aller-retour, l'equivalent « synchro » pertinent ici. La selection vit dans un `useState` local non re-hydrate depuis le store a l'entree.)
- **Etapes** :
  1. Selectionner `tech, design, crypto`, taper « Terminer » (navigation vers `NotificationsPermission`, store contient ces 3 interets).
  2. Revenir en arriere (geste/back materiel) vers l'ecran InterestSelection.
  3. Observer l'etat des chips et du bouton apres retour.
  4. Re-selectionner et re-terminer.
- **Resultat attendu** : a la re-entree, le composant repart d'un `useState` vide (pas de re-hydratation depuis le store) — comportement documente dans le code : le bouton ne reste PAS bloque disabled apres retour (pas de flag `submitting`). L'utilisateur peut re-selectionner et re-taper Terminer ; `setInterests` est re-appele et ecrase la valeur precedente dans le store de maniere coherente. Aucun etat « fige » ni double-comptage.
- **Critere d'acceptation (OK/KO)** : OK si apres retour le bouton est de nouveau utilisable et `setInterests` ecrase proprement la selection ; KO si le bouton reste bloque desactive ou si la selection du store devient incoherente.
- **Donnees de test** : 1er passage `['tech','design','crypto']`, 2e passage `['ai','music','business']`.
- **Duree estimee** : 4 min
