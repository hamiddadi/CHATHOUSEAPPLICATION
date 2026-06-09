# 07 - Accueil / Landing (`auth`)

## Contexte ecran

- **Route** : `Landing` (stack `Auth`, type `AuthStackParamList`). C'est l'ecran d'entree quand l'utilisateur n'est pas authentifie (`status === 'unauthenticated'`). Hook nav : `LandingNavProp = NativeStackNavigationProp<AuthStackParamList, 'Landing'>`.
- **Roles requis** : `guest` uniquement. L'ecran n'est rendu que pour un visiteur non connecte. Un compte `standard`/`admin` deja authentifie ne voit jamais cet ecran (le routeur monte la stack `Main`/`Onboarding`).
- **Comportements temps-reel** : Aucun WebSocket ni LiveKit sur cet ecran. La seule action reseau est le bouton dev-skip qui declenche `devLogin()` -> `authService.devLogin()` (POST HTTP de login dev, ecrit le token via `tokenStorage.set`, puis `pushService.registerWithBackend()` en best-effort). Les deux CTA principaux sont de la navigation pure (aucun reseau). Les animations d'entree (logo/features/avatars/cta) sont locales (reanimated `withTiming` + `withDelay`), pas temps-reel.
- **Pre-conditions globales** : session absente (aucun token en `tokenStorage`). Backend joignable uniquement requis pour le dev-skip ; les CTA principaux fonctionnent hors-ligne. i18n charge (FR ou EN). Le bouton dev-skip n'est rendu QUE parce que `onDevSkip` est passe (commentaire code : "TEMP test build : dev-login in release — DO NOT COMMIT"). En build de prod final ce bouton doit disparaitre.
- **Etats de donnees pertinents** :
  - `status === 'unauthenticated'` (defaut) : dev-skip actif, libelle = `t('auth.landing.cta.devSkip')` ("Skip auth (dev)").
  - `status === 'authenticating'` : `devSkipPending = true` -> le bouton dev-skip est `disabled` et affiche "…" a la place du libelle.
  - Pas de liste/feed, donc pas d'etat liste vide ; pas de pull-to-refresh ; pas de notion de non-lus.
  - Hors-ligne : aucun impact visuel ; seul le dev-skip echouera (catch silencieux, voir `handleDevSkip` -> `.catch(() => undefined)`).

## Matrice bouton

| #   | Bouton                                                           | Emplacement                                                        | Type       | Locator reel                                                                                                                                                                                                                         | Pre-condition                                                                                                  | Priorite |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Commencer / Get started (CTA primaire + fleche)                  | Corps, bloc CTA bas (`LandingCTA`)                                 | navigation | `accessibilityLabel` = `t('auth.landing.cta.getStartedA11y')` ("Créer un compte" / "Create an account"). Texte visible : `t('auth.landing.cta.getStarted')`                                                                          | Aucune (fonctionne hors-ligne)                                                                                 | P0       |
| 2   | J'ai déjà un compte / I already have an account (CTA secondaire) | Corps, bloc CTA bas (`LandingCTA`)                                 | navigation | `accessibilityLabel` = `t('auth.landing.cta.loginA11y')` ("Se connecter" / "Sign in"). Texte visible : `t('auth.landing.cta.login')`                                                                                                 | Aucune (fonctionne hors-ligne)                                                                                 | P0       |
| 3   | Skip auth (dev) (lien souligne)                                  | Corps, sous les CTA (`LandingCTA`, rendu conditionnel `onDevSkip`) | submit     | `accessibilityLabel` = `t('auth.landing.cta.devSkipA11y')` ("Connexion en tant que devuser — développement uniquement" / "Sign in as devuser — development only"). Texte visible : `t('auth.landing.cta.devSkip')` ou "…" si pending | Backend joignable + endpoint dev-login actif ; gate `devSkipPending` (disabled si `status==='authenticating'`) | P1       |

> Note : les blocs `LandingLogo` (`accessibilityRole="header"`), `FeatureItem` (x3, `accessibilityRole="text"`) et `AvatarsPreview` (`accessibilityRole="text"`) ne sont PAS interactifs (aucun `onPress`). Ils ne sont donc pas comptabilises comme boutons, mais sont couverts en accessibilite dans les cas ci-dessous. Aucun bouton retour/fermer : c'est l'ecran racine de la stack non authentifiee.

## Cas de test

### AUTH-LAND-001 - CTA primaire navigue vers Phone

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte guest (non authentifie, aucun token). Reseau Wi-Fi (indifferent). Aucune permission requise.
- **Etapes** :
  1. Lancer l'app a froid sans session.
  2. Attendre la fin de l'animation d'entree (CTA visible apres ~450 ms + 600 ms).
  3. Taper le bouton primaire `t('auth.landing.cta.getStartedA11y')` ("Créer un compte").
- **Resultat attendu** : navigation vers l'ecran `Phone` (`navigation.navigate('Phone')`). L'ecran de saisie du numero apparait.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran `Phone` est affiche apres le tap ; KO si rien ne se passe ou si une autre route est ouverte.
- **Donnees de test** : aucune (navigation pure).
- **Duree estimee** : 2 min

### AUTH-LAND-002 - CTA primaire : multi-clic rapide + hors-ligne

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte guest. Reseau : passer en mode avion (hors-ligne) avant le tap, puis retablir.
- **Etapes** :
  1. Lancer l'app, atteindre le Landing.
  2. Activer le mode avion (hors-ligne).
  3. Taper TRES rapidement 5 fois de suite sur `t('auth.landing.cta.getStartedA11y')`.
  4. Observer la pile de navigation.
  5. Revenir au Landing (back depuis Phone), retablir le reseau, retaper une fois.
- **Resultat attendu** : la navigation est purement locale et fonctionne meme hors-ligne ; une seule entree `Phone` est poussee (pas 5 ecrans Phone empiles). Aucun crash, aucun spinner reseau.
- **Critere d'acceptation (OK/KO)** : OK si un seul `Phone` est dans la pile apres le multi-clic et si l'ecran reste stable hors-ligne ; KO si empilage multiple, crash, ou blocage.
- **Donnees de test** : aucune.
- **Duree estimee** : 4 min

### AUTH-LAND-003 - CTA primaire : lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte guest. TalkBack (Android) ou VoiceOver (iOS) actif. Taille de police systeme reglee sur le maximum. Mode fort contraste active.
- **Etapes** :
  1. Activer le lecteur d'ecran + police XXL + fort contraste dans les reglages systeme.
  2. Ouvrir le Landing.
  3. Balayer jusqu'au bouton primaire et ecouter l'annonce.
  4. Double-taper pour activer.
- **Resultat attendu** : le lecteur annonce le libelle `t('auth.landing.cta.getStartedA11y')` ("Créer un compte" / "Create an account") avec le role "bouton" ; le double-tap navigue vers `Phone`. Le texte du bouton ("Commencer") reste lisible et non tronque a police max ; la fleche `arrow-forward` et le texte gardent un contraste suffisant sur fond blanc.
- **Critere d'acceptation (OK/KO)** : OK si annonce role+label correcte, activation fonctionnelle, et aucun chevauchement/troncature a police max ; KO sinon.
- **Donnees de test** : aucune.
- **Duree estimee** : 4 min

### AUTH-LAND-004 - CTA secondaire (login) navigue vers Phone

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte guest. Reseau indifferent.
- **Etapes** :
  1. Atteindre le Landing.
  2. Taper le bouton secondaire `t('auth.landing.cta.loginA11y')` ("Se connecter").
- **Resultat attendu** : navigation vers `Phone` (`navigation.navigate('Phone')`). Meme destination que le CTA primaire (le flux de login passe aussi par la saisie du numero).
- **Critere d'acceptation (OK/KO)** : OK si l'ecran `Phone` s'affiche ; KO sinon.
- **Donnees de test** : aucune.
- **Duree estimee** : 2 min

### AUTH-LAND-005 - CTA secondaire : multi-clic rapide + latence reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte guest. Reseau bride (latence 3G simulee). La navigation etant locale, la latence ne devrait pas l'affecter.
- **Etapes** :
  1. Atteindre le Landing sous reseau bride.
  2. Taper 5 fois rapidement sur `t('auth.landing.cta.loginA11y')`.
  3. Observer la pile de navigation.
- **Resultat attendu** : une seule entree `Phone` poussee ; aucune dependance reseau ne bloque la transition ; pas de double-ecran ni de freeze.
- **Critere d'acceptation (OK/KO)** : OK si un seul `Phone` empile et transition immediate malgre la latence ; KO si empilage multiple ou freeze.
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min

### AUTH-LAND-006 - CTA secondaire : lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte guest. Lecteur d'ecran actif, police max, fort contraste.
- **Etapes** :
  1. Activer lecteur d'ecran + police XXL + contraste eleve.
  2. Balayer jusqu'au bouton `t('auth.landing.cta.loginA11y')`.
  3. Ecouter l'annonce, double-taper.
- **Resultat attendu** : annonce role "bouton" + label "Se connecter" / "Sign in" ; activation -> `Phone`. Le texte "J'ai déjà un compte" sur bouton a bordure (`border-overlay-white-30`) reste lisible avec contraste suffisant a police max (pas de troncature).
- **Critere d'acceptation (OK/KO)** : OK si annonce correcte, activation OK et lisibilite preservee ; KO sinon.
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min

### AUTH-LAND-007 - Dev-skip : connexion devuser reussie

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest. Backend joignable avec endpoint dev-login actif. Reseau Wi-Fi. Build qui rend le bouton (onDevSkip passe).
- **Etapes** :
  1. Atteindre le Landing.
  2. Taper le lien `t('auth.landing.cta.devSkipA11y')` ("Connexion en tant que devuser — développement uniquement").
  3. Observer le libelle du lien et l'etat global.
- **Resultat attendu** : `status` passe a `authenticating` -> le libelle devient "…" et le lien est `disabled` ; `authService.devLogin()` retourne une session ; le token est persiste (`tokenStorage.set`) ; `status` passe a `authenticated` ; le routeur quitte la stack Auth (vers Onboarding si `isNewUser`, sinon Main) ; `pushService.registerWithBackend()` part en best-effort.
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur est connecte et sort de l'ecran Landing apres un seul tap ; KO si reste bloque sur Landing ou erreur visible.
- **Donnees de test** : payload reponse attendu : `{ success: true, data: { user: {...}, accessToken: "<jwt>", refreshToken: "<jwt>", isNewUser: false } }`. Compte : `devuser`.
- **Duree estimee** : 3 min

### AUTH-LAND-008 - Dev-skip : multi-clic rapide + echec/perte reseau (catch silencieux)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest. Reseau : couper la connexion (mode avion) OU pointer vers un backend indisponible.
- **Etapes** :
  1. Atteindre le Landing.
  2. Passer hors-ligne.
  3. Taper 5 fois tres rapidement sur `t('auth.landing.cta.devSkipA11y')`.
  4. Retablir le reseau, retaper une fois.
- **Resultat attendu** : pendant l'appel, `status==='authenticating'` rend le bouton `disabled` (gate `devSkipPending`) -> les taps suivants sont ignores (pas d'appels devLogin concurrents en rafale). En cas d'echec reseau, `devLogin()` met `status='unauthenticated'`, l'exception est avalee par `handleDevSkip` (`.catch(() => undefined)`) : aucun toast, aucun crash, le libelle revient a "Skip auth (dev)". Apres retablissement, un tap reussit normalement.
- **Critere d'acceptation (OK/KO)** : OK si pas de crash, pas d'empilement d'appels, retour propre a l'etat normal apres echec, et succes apres reconnexion ; KO si crash, multi-appel, ou bouton fige sur "…".
- **Donnees de test** : reponse d'echec simulee : timeout reseau / `{ success: false }` ou HTTP 5xx.
- **Duree estimee** : 5 min

### AUTH-LAND-009 - Dev-skip : etat pending non actionnable (latence/reconnexion)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest. Reseau a forte latence (reponse dev-login retardee de ~5 s).
- **Etapes** :
  1. Atteindre le Landing.
  2. Taper une fois sur `t('auth.landing.cta.devSkipA11y')`.
  3. Pendant que "…" est affiche, retaper plusieurs fois le lien.
- **Resultat attendu** : tant que `status==='authenticating'`, le lien affiche "…" et est `disabled` ; les taps supplementaires n'ont aucun effet (pas de second `devLogin`). A la resolution, soit connexion (sortie d'ecran), soit retour a "Skip auth (dev)".
- **Critere d'acceptation (OK/KO)** : OK si un seul appel devLogin part malgre les taps repetes pendant le pending ; KO si plusieurs appels ou si le bouton reste actionnable pendant "…".
- **Donnees de test** : latence injectee 5000 ms sur l'endpoint dev-login.
- **Duree estimee** : 4 min

### AUTH-LAND-010 - Dev-skip : lecteur d'ecran + etat disabled + contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte guest. Lecteur d'ecran actif, police max, fort contraste. Endpoint dev-login lent pour observer l'etat pending.
- **Etapes** :
  1. Activer lecteur d'ecran + police XXL + contraste eleve.
  2. Balayer jusqu'au lien dev-skip, ecouter l'annonce.
  3. Double-taper pour lancer.
  4. Pendant le pending, re-balayer sur le lien et ecouter.
- **Resultat attendu** : annonce role "bouton" + label `t('auth.landing.cta.devSkipA11y')` ; pendant le pending l'element est annonce comme desactive (`disabled`) ; le texte souligne en `text-overlay-white-60` reste lisible/contraste a police max (verifier que le souligne n'aggrave pas la lisibilite). Le "…" est annonce ou l'element est annonce non disponible.
- **Critere d'acceptation (OK/KO)** : OK si label + role corrects, etat disabled annonce pendant le pending, et lisibilite OK ; KO si label manquant, etat disabled non signale, ou texte illisible.
- **Donnees de test** : aucune (compte devuser).
- **Duree estimee** : 4 min

### AUTH-LAND-011 - Dev-skip : synchro multi-utilisateur / session devuser partagee

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux appareils (A et B) sur le Landing, tous deux guests. Backend partage. Le compte dev-login pointe sur le meme `devuser`.
- **Etapes** :
  1. Sur l'appareil A, taper le dev-skip et se connecter en `devuser`.
  2. Sur l'appareil B, taper le dev-skip et se connecter sur le meme `devuser`.
  3. Verifier les sessions/tokens cote backend et l'enregistrement push (`pushService.registerWithBackend`) des deux appareils.
- **Resultat attendu** : les deux appareils obtiennent une session valide pour `devuser` ; l'enregistrement push backend dedupe sur token (un device peut ecraser/cohabiter selon la politique) ; aucune des deux sessions ne crashe l'autre. Cas a documenter : si le backend invalide l'ancien refresh-token, A doit gerer un 401 propre sans boucle.
- **Critere d'acceptation (OK/KO)** : OK si les deux appareils sont connectes en `devuser` sans crash et avec un comportement de session coherent et documente ; KO si une session corrompt l'autre ou si boucle d'auth.
- **Donnees de test** : compte partage `devuser` ; observer tokens accessToken/refreshToken distincts par device.
- **Duree estimee** : 6 min

### AUTH-LAND-012 - Animation d'entree et integrite globale de l'ecran (smoke)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte guest. Reseau indifferent.
- **Etapes** :
  1. Lancer l'app a froid.
  2. Observer l'apparition sequencee : logo (delay 0), features (150 ms), avatars (300 ms), CTA (450 ms), chacun en fondu 600 ms.
  3. Verifier la presence des libelles : `common.appName` ("Chathouse"), `t('auth.landing.tagline')`, les 3 features (`features.rooms/houses/chat.title`), la rangee d'avatars + `t('auth.landing.onlineSuffix')` ("+2k en ligne").
- **Resultat attendu** : tous les blocs apparaissent dans l'ordre, sans saccade ni element manquant ; aucun warning console ; si `AVATAR_URLS` etait vide un warning DEV s'afficherait (les 7 avatars `AVATARS_10.slice(0,7)` doivent etre rendus).
- **Critere d'acceptation (OK/KO)** : OK si tous les blocs et libelles sont presents apres l'animation ; KO si bloc manquant, avatars absents, ou crash.
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min

### AUTH-LAND-013 - Contenu non interactif : annonces lecteur d'ecran (logo / features / avatars)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte guest. Lecteur d'ecran actif, police max.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer du haut vers le bas tout l'ecran.
- **Resultat attendu** : le bloc logo est annonce comme en-tete (`accessibilityRole="header"`) avec le nom de l'app ; les decorations (cercles de fond, boite logo) sont ignorees (`importantForAccessibility="no"`) ; chaque feature est annoncee une seule fois sous forme `"<titre>: <desc>"` (`accessibilityLabel` du `FeatureItem`) sans relire icones ; la rangee d'avatars est annoncee via `t('auth.landing.onlineA11y')` ("Plus de 2000 personnes en ligne") au lieu de lire 7 images.
- **Critere d'acceptation (OK/KO)** : OK si l'ordre de focus est logique, les decorations ignorees, et chaque groupe annonce une fois proprement ; KO si elements decoratifs lus, doublons, ou avatars lus individuellement.
- **Donnees de test** : aucune.
- **Duree estimee** : 4 min

### AUTH-LAND-014 - Bascule de langue FR/EN sur les libelles

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte guest. Appareil reglable en FR puis EN.
- **Etapes** :
  1. Regler l'appareil/app en FR, ouvrir le Landing.
  2. Verifier : CTA "Commencer", "J'ai déjà un compte", tagline "Conversations audio en direct".
  3. Basculer en EN, rouvrir le Landing.
  4. Verifier : CTA "Get started", "I already have an account", tagline "Drop in audio conversations".
- **Resultat attendu** : tous les libelles (CTA, tagline, features, suffixe online) suivent la locale active ; les `accessibilityLabel` aussi (`getStartedA11y`/`loginA11y`/`devSkipA11y`). Aucune cle i18n brute affichee.
- **Critere d'acceptation (OK/KO)** : OK si tous les textes et labels a11y sont traduits correctement dans les deux langues ; KO si cle brute, texte non traduit, ou troncature.
- **Donnees de test** : locales `fr` et `en`.
- **Duree estimee** : 3 min
