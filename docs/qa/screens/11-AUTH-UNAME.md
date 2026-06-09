# 11 - Nom d'utilisateur (`auth`)

## Contexte ecran

- **Route** : `Username` dans `AuthNavigator` (`src/core/navigation/AuthNavigator.tsx`, `<Stack.Screen name="Username" />`).
- **Fichier** : `src/features/auth/screens/UsernameScreen/UsernameScreen.tsx` (aucun partial : pas de dossier `partials/`).
- **Roles requis** : `guest` au sens metier — c'est l'etape post-OTP d'un **nouvel** utilisateur (`isNewUser === true`). Le store laisse volontairement `status: 'authenticating'` (donc `isAuthenticated === false`) apres `verifyOtp` pour qu'on puisse atteindre cet ecran ; la validation du pseudo via `setUsername()` promeut le compte en `status: 'authenticated'` (devient un compte `standard`). Un compte deja onboarde (`standard`/`admin`) ne voit jamais cet ecran.
- **Header** : `headerShown: false` au niveau du navigateur → **aucun bouton retour/fermer natif** et aucun bouton retour custom dans le JSX. Le seul moyen d'avancer est le bouton « Valider ». (Geste swipe-back iOS techniquement possible mais sans cible UI ; non couvert ici car non rendu par l'ecran.)
- **Comportements temps-reel** : pas de WebSocket ni de LiveKit sur cet ecran. Deux dependances **reseau HTTP** :
  - au montage : `GET /users/suggest-username` (`authService.suggestUsername`) → remplit jusqu'a 3 pills de suggestion ; echec **silencieux** (pas de toast, pas de pill).
  - a la soumission : `PATCH /users/me/username` (`authService.setUsername`) puis `pushService.registerWithBackend()` (fire-and-forget) ; succes → promotion `authenticated` → l'arbre de navigation bascule hors du stack Auth (vers Onboarding/Main).
- **Pre-conditions globales** : session OTP verifiee en memoire (token present, `status='authenticating'`), reseau requis pour la soumission. L'input a `autoFocus` (clavier ouvert au montage), `autoCapitalize="none"`, `autoCorrect={false}`, `maxLength={24}`.
- **Etats de donnees pertinents** :
  - suggestions en cours de chargement → `ActivityIndicator` (couleur `colors.primary`), aucune pill.
  - suggestions vides ou en erreur → aucune pill, aucun indicateur.
  - suggestions presentes → 1 a 3 pills `@<handle>` (les suivantes au-dela de 3 sont tronquees via `.slice(0, 3)`).
  - champ vide → CTA desactive (`isValid === false`).
  - compteur de caracteres `helperText` : `"{n} / 24"` mis a jour a chaque frappe.

## Matrice bouton

| #   | Bouton                                                   | Emplacement                        | Type         | Locator reel                                                                                                                                                                | Pre-condition                                                              | Priorite                                                          |
| --- | -------------------------------------------------------- | ---------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | --- |
| 1   | Champ « pseudo » (saisie + soumission clavier indirecte) | Corps (sous le titre)              | input-submit | placeholder `t('auth.username.placeholder')` = « jean_doe » (FR) / « jane_doe » (EN) ; selecteur test `getByPlaceholderText` ; adornment gauche `@` ; helper `"{len} / 24"` | Ecran monte, session OTP verifiee                                          | P0                                                                |
| 2   | Pill de suggestion `@<handle>` (jusqu'a 3)               | Corps (sous le champ)              | list-item    | Texte `@${sug}` (ex. `getByText('@jane_doe')`) ; pas d'`accessibilityLabel` ni testID dedie → selection par le texte rendu                                                  | `GET /users/suggest-username` a renvoye >=1 suggestion ; reseau au montage | P1                                                                |
| 3   | Bouton « Valider » (CTA primaire)                        | Corps, bas (apres spacer `flex-1`) | submit       | label `t('auth.username.submit')` = « Valider » (FR) / « Continue » (EN) ; `accessibilityRole="button"` ; `accessibilityState.disabled` pilote par `!isValid                |                                                                            | isSubmitting`; selecteur test`getByRole('button', { name: ... })` | Pseudo valide saisi (3-24 car., `[a-z0-9_]`), reseau pour le PATCH | P0  |

> Note : pas d'autre element actionnable. Aucun bouton retour/fermer (header masque), aucun lien legal, aucun toggle/switch, aucun swipe/long-press, aucun pull-to-refresh sur cet ecran. L'`ActivityIndicator` de chargement des suggestions n'est pas interactif.

## Cas de test

### AUTH-UNAME-001 - Saisie d'un pseudo valide active le CTA

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte guest (nouvel utilisateur, OTP verifie, `status='authenticating'`), Wi-Fi, aucune permission speciale requise. Suggestions vides.
- **Etapes** :
  1. Ouvrir l'ecran « Nom d'utilisateur » (le clavier s'ouvre via `autoFocus`).
  2. Verifier que le CTA « Valider » est desactive (grise, `accessibilityState.disabled === true`).
  3. Saisir `jane_doe` dans le champ (adornment `@` visible a gauche).
  4. Observer le compteur helper passer a `8 / 24`.
- **Resultat attendu** : aucune erreur affichee sous le champ ; le compteur affiche `8 / 24` ; le CTA « Valider » devient actif (`accessibilityState.disabled === false`).
- **Critere d'acceptation (OK/KO)** : OK si CTA actif et aucun message d'erreur ; KO si CTA reste desactive ou si une erreur s'affiche.
- **Donnees de test** : `username = "jane_doe"`.
- **Duree estimee** : 2 min

### AUTH-UNAME-002 - Soumission reussie du pseudo et promotion de session

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte guest (OTP verifie), Wi-Fi, backend joignable.
- **Etapes** :
  1. Saisir `jane_doe` dans le champ.
  2. Attendre que le CTA « Valider » devienne actif.
  3. Taper sur « Valider ».
  4. Observer le spinner du bouton (`loading={isSubmitting}`).
- **Resultat attendu** : `PATCH /users/me/username` est emis avec `{ username: "jane_doe" }` ; au succes, `setUsername` du store met `status='authenticated'` ; l'app quitte le stack Auth (navigation vers Onboarding/Main) ; `pushService.registerWithBackend()` est declenche en arriere-plan (best-effort).
- **Critere d'acceptation (OK/KO)** : OK si l'appel reseau part avec le bon payload ET la navigation quitte l'ecran Username ; KO si l'utilisateur reste bloque sur l'ecran apres succes serveur.
- **Donnees de test** : `username = "jane_doe"` ; reponse mock `{ success: true, data: { id, username: "jane_doe", ... } }`.
- **Duree estimee** : 3 min

### AUTH-UNAME-003 - Multi-clic rapide + latence/perte reseau a la soumission

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte guest (OTP verifie), reseau commutable (Wi-Fi → mode avion), proxy de latence si dispo.
- **Etapes** :
  1. Saisir `jane_doe` (CTA actif).
  2. Activer une latence reseau elevee (ou couper le reseau juste apres le tap).
  3. Taper TRES rapidement 5 fois de suite sur « Valider ».
  4. Couper le reseau (mode avion) pendant l'appel, puis le retablir.
  5. Reessayer le tap apres reconnexion.
- **Resultat attendu** : pendant `isSubmitting`, le bouton passe en `accessibilityState.busy=true` et `onPress` est ignore (le composant `Button` met `onPress={undefined}` quand `loading`/`disabled`) → **un seul** `PATCH /users/me/username` part, pas de doublon. En echec reseau, `handleApiError` mappe l'erreur (message d'erreur sous le champ ou message de formulaire) et le CTA redevient actif pour reessayer ; aucune navigation prematuree. Apres reconnexion, un nouveau tap aboutit.
- **Critere d'acceptation (OK/KO)** : OK si exactement 1 requete par cycle (pas de rafale de doublons) ET l'erreur reseau est affichee sans crash ni navigation ; KO si plusieurs PATCH partent en rafale ou si l'app crash/navigue malgre l'echec.
- **Donnees de test** : `username = "jane_doe"` ; simuler erreur `kind:'network'` / timeout puis succes.
- **Duree estimee** : 6 min

### AUTH-UNAME-004 - Accessibilite du CTA « Valider » (lecteur d'ecran + police XL + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte guest ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; mode contraste eleve active.
- **Etapes** :
  1. Activer TalkBack/VoiceOver et la plus grande taille de police.
  2. Naviguer au focus jusqu'au bouton « Valider » sans pseudo saisi.
  3. Ecouter l'annonce vocale (role + libelle + etat).
  4. Saisir un pseudo valide puis re-focaliser le bouton.
- **Resultat attendu** : le lecteur annonce « Valider, bouton, desactive » tant que `isValid===false` (grace a `accessibilityRole="button"` + `accessibilityState.disabled`) ; une fois le pseudo valide, l'etat « desactive » n'est plus annonce et le bouton est activable. Le libelle « Valider » reste lisible sans troncation (`numberOfLines={1}` mais largeur `fullWidth`) ; cible tactile >= 44pt respectee ; contraste texte/fond conforme.
- **Critere d'acceptation (OK/KO)** : OK si l'etat desactive/actif est correctement vocalise et le libelle integralement lisible en police XL ; KO si l'etat n'est pas annonce, si le texte est tronque/illisible, ou si la cible est < 44pt.
- **Donnees de test** : `username = "jane_doe"`.
- **Duree estimee** : 5 min

### AUTH-UNAME-005 - Pseudo trop court bloque la soumission

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte guest, Wi-Fi.
- **Etapes** :
  1. Saisir `ab` (2 caracteres) dans le champ.
  2. Observer le compteur `2 / 24`.
  3. Taper sur « Valider ».
- **Resultat attendu** : message d'erreur `t('auth.username.errors.tooShort')` = « Au moins 3 caracteres. » affiche sous le champ (bordure `border-danger`) ; `setUsername` n'est **pas** appele ; aucune navigation.
- **Critere d'acceptation (OK/KO)** : OK si l'erreur « Au moins 3 caracteres. » est affichee ET aucun appel reseau ; KO si la soumission part ou si aucun message n'apparait.
- **Donnees de test** : `username = "ab"`.
- **Duree estimee** : 2 min

### AUTH-UNAME-006 - Caracteres invalides et longueur max sur le champ

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest, Wi-Fi.
- **Etapes** :
  1. Saisir `jean-doe!` (tiret + point d'exclamation interdits par `^[a-z0-9_]+$`).
  2. Observer l'erreur de format.
  3. Effacer, puis coller/saisir 30 caracteres `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.
  4. Observer le compteur et le blocage de saisie.
- **Resultat attendu** : pour les caracteres interdits, erreur `t('auth.username.errors.format')` = « Seulement lettres, chiffres et \_. » ; pour la longueur, le `maxLength={24}` bloque la saisie a 24 caracteres (compteur plafonne a `24 / 24`) ; le CTA reste desactive tant que la valeur est invalide.
- **Critere d'acceptation (OK/KO)** : OK si l'erreur de format s'affiche pour les caracteres interdits ET la saisie est tronquee a 24 ; KO si des caracteres invalides sont acceptes ou si plus de 24 caracteres sont saisissables.
- **Donnees de test** : `"jean-doe!"`, puis chaine de 30 `a`.
- **Duree estimee** : 4 min

### AUTH-UNAME-007 - Conflit serveur (pseudo deja pris) gere a la soumission

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest, Wi-Fi, backend renvoyant une erreur de validation/champ (ex. 409 ou erreur de champ `username` deja pris).
- **Etapes** :
  1. Saisir un pseudo localement valide mais deja pris cote serveur, ex. `admin`.
  2. Taper sur « Valider ».
  3. Attendre la reponse serveur en erreur.
- **Resultat attendu** : `handleApiError(err)` mappe l'erreur de champ via `setError` → message d'erreur affiche sous le champ (le `usernameFieldError` rend `t(...)` si la cle correspond, sinon le message brut) ; aucune navigation ; le CTA reste utilisable pour corriger.
- **Critere d'acceptation (OK/KO)** : OK si l'erreur serveur est affichee sous le champ sans crash ni navigation ; KO si l'erreur est avalee silencieusement ou provoque un crash/navigation.
- **Donnees de test** : `username = "admin"` ; reponse mock erreur champ `{ field: "username", message: "..." }`.
- **Duree estimee** : 4 min

### AUTH-UNAME-008 - Accessibilite du champ pseudo (lecteur d'ecran + police XL + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte guest ; TalkBack/VoiceOver actif ; police systeme max ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police max.
  2. Focaliser le champ pseudo (autoFocus l'ouvre deja).
  3. Saisir `ab` puis verifier l'annonce de l'erreur « Au moins 3 caracteres. ».
  4. Verifier que l'adornment `@`, le placeholder et le compteur helper restent lisibles en police XL.
- **Resultat attendu** : le lecteur annonce le champ editable et son placeholder ; le message d'erreur sous le champ est vocalise/atteignable ; l'adornment `@`, le compteur `2 / 24` et le placeholder ne sont pas tronques et conservent un contraste suffisant (placeholder `#c2c6d7`, erreur `text-danger`).
- **Critere d'acceptation (OK/KO)** : OK si champ + erreur + compteur sont accessibles et lisibles en police XL/contraste eleve ; KO si l'erreur n'est pas annoncee, si le texte deborde/est coupe, ou contraste insuffisant.
- **Donnees de test** : `username = "ab"`.
- **Duree estimee** : 5 min

### AUTH-UNAME-009 - Selection d'une pill de suggestion remplit le champ et active le CTA

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest, Wi-Fi ; `GET /users/suggest-username` renvoie `["jane_doe", "jdoe", "janed", "extra_one"]`.
- **Etapes** :
  1. Ouvrir l'ecran ; attendre la fin du chargement (l'`ActivityIndicator` disparait).
  2. Verifier que 3 pills sont rendues : `@jane_doe`, `@jdoe`, `@janed` (la 4e `@extra_one` est tronquee par `.slice(0,3)`).
  3. Taper sur la pill `@jane_doe`.
- **Resultat attendu** : le champ se remplit avec `jane_doe` (sans le `@`, via `setValue('username', sug, { shouldValidate: true })`) ; la validation passe ; le CTA « Valider » devient actif ; le compteur affiche `8 / 24`.
- **Critere d'acceptation (OK/KO)** : OK si exactement 3 pills affichees, le tap remplit le champ avec la valeur sans `@` et active le CTA ; KO si 4 pills s'affichent, si le champ ne se remplit pas, ou si le CTA reste desactive.
- **Donnees de test** : suggestions `["jane_doe","jdoe","janed","extra_one"]`.
- **Duree estimee** : 3 min

### AUTH-UNAME-010 - Suggestions : chargement, echec silencieux et multi-tap pill

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest ; reseau controlable pour le `GET /users/suggest-username` (latence puis echec).
- **Etapes** :
  1. Lancer l'ecran avec une reponse suggestions volontairement lente → verifier l'`ActivityIndicator` (couleur primaire) et l'absence de pills.
  2. Cas A : laisser l'appel **echouer** (500 ou timeout) → verifier qu'aucune pill ni toast n'apparait (echec silencieux), l'ecran reste utilisable a la main.
  3. Cas B : avec suggestions chargees, taper tres vite plusieurs fois sur la meme pill `@jane_doe`.
- **Resultat attendu** : pendant le chargement, spinner visible et aucune pill ; en echec, aucune erreur visible (catch silencieux) et la saisie manuelle fonctionne ; multi-tap sur une pill = idempotent (la valeur reste `jane_doe`, pas d'effet de bord, le champ n'est pas corrompu).
- **Critere d'acceptation (OK/KO)** : OK si echec suggestions = silencieux + ecran utilisable, ET multi-tap pill idempotent ; KO si un crash/toast d'erreur surgit au montage, ou si le multi-tap corrompt la valeur.
- **Donnees de test** : suggestions echec (500) ; puis `["jane_doe"]`.
- **Duree estimee** : 5 min

### AUTH-UNAME-011 - Accessibilite des pills de suggestion (lecteur d'ecran + police XL + contraste)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte guest ; TalkBack/VoiceOver actif ; police max ; contraste eleve ; suggestions = `["jane_doe","jdoe","janed"]`.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police max.
  2. Naviguer au focus de pill en pill.
  3. Ecouter l'annonce de chaque pill et l'activer via le geste du lecteur.
- **Resultat attendu** : chaque pill `@jane_doe` est focusable et son texte est vocalise. Limite connue a remonter : les pills sont des `Pressable` **sans** `accessibilityRole="button"` ni `accessibilityLabel` dedie → le lecteur peut ne pas annoncer explicitement le role « bouton ». L'activation par geste lecteur doit tout de meme remplir le champ. Le texte `@jane_doe` (`text-ink` sur `bg-surface`) reste lisible et non tronque en police XL (les pills sont en `flex-wrap`).
- **Critere d'acceptation (OK/KO)** : OK si chaque pill est focusable, vocalisee, activable et lisible en police XL ; KO si une pill est inatteignable au focus, illisible, ou non activable au geste lecteur. (Defaut role bouton manquant = bug a logguer, non bloquant.)
- **Donnees de test** : suggestions `["jane_doe","jdoe","janed"]`.
- **Duree estimee** : 4 min

### AUTH-UNAME-012 - Reseau requis a la soumission : reconnexion apres echec

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte guest ; demarrer hors-ligne (mode avion).
- **Etapes** :
  1. Saisir `jane_doe` (CTA actif — la validation est locale, donc le CTA s'active meme hors-ligne).
  2. En mode avion, taper « Valider ».
  3. Observer le message d'erreur reseau.
  4. Reactiver le Wi-Fi.
  5. Taper a nouveau « Valider ».
- **Resultat attendu** : hors-ligne, le PATCH echoue, `handleApiError` affiche une erreur, aucune navigation, le CTA redevient actif. Apres retour du reseau, un nouveau tap aboutit a `setUsername`, promotion `authenticated` et sortie du stack Auth.
- **Critere d'acceptation (OK/KO)** : OK si l'echec hors-ligne est gere proprement (erreur visible, pas de navigation) ET le retry post-reconnexion reussit ; KO si l'app crash hors-ligne, navigue a tort, ou ne permet pas le retry.
- **Donnees de test** : `username = "jane_doe"`.
- **Duree estimee** : 5 min
