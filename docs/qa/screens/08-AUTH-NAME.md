# 08 - Saisie du nom (`auth`)

## Contexte ecran

- **Route** : `Name` dans l'`AuthStackParamList` (stack d'authentification). Param obligatoire : `{ phoneNumber: string }` recu de l'ecran OTP precedent.
- **Fichier** : `src/features/auth/screens/NameScreen/NameScreen.tsx`.
- **Position dans le flux** : OTP (verification du code) -> **Saisie du nom** -> `Username` (choix du pseudo). Le nom est collecte AVANT le `@username`, a la maniere de Clubhouse, pour ancrer l'identite sur un vrai nom.
- **Roles requis** : utilisateur en cours d'authentification. Apres l'OTP, le compte est techniquement authentifie cote API mais le stack Auth reste monte (statut `authenticating`) jusqu'au `setUsername`. Aucune distinction guest/standard/admin a ce stade : c'est un ecran d'onboarding pre-profil. Accessible donc en tant que futur `standard`.
- **Comportements temps-reel** : AUCUN. L'ecran n'emet ni ne recoit via WebSocket / LiveKit / push. Le bouton Suivant ne fait qu'ecrire dans le store onboarding local (zustand, `useOnboardingStore.setProfile`) et naviguer. Les valeurs accumulees ne sont flushees a l'API qu'a la fin de l'onboarding (`completeOnboarding`), pas ici. Aucun appel reseau direct n'est declenche depuis cet ecran.
- **Pre-conditions globales** : etre arrive depuis l'OTP avec un `route.params.phoneNumber` valide. Le clavier s'ouvre automatiquement (`autoFocus` sur le champ Prenom). `KeyboardAvoidingView` actif (comportement `padding` sur iOS).
- **Etats de donnees pertinents** :
  - Etat initial : Prenom vide, Nom vide -> bouton Suivant **desactive** (`opacity-45`, `onPress` neutralise).
  - Prenom rempli (apres trim, longueur > 0) -> bouton Suivant **active**.
  - Hors-ligne : sans incidence sur cet ecran (pas d'I/O reseau) ; la navigation vers `Username` fonctionne meme sans reseau.
  - Limite de saisie : `maxLength = 50` (NAME_MAX) sur chaque champ.
  - Le store conserve les valeurs precedentes si on revient sur l'ecran (`input.x ?? state.x`), mais les champs de l'ecran sont des `useState` locaux re-initialises a vide au remontage.

## Matrice bouton

| #   | Bouton                 | Emplacement                 | Type         | Locator reel                                                                                                                                                | Pre-condition                                    | Priorite |
| --- | ---------------------- | --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| 1   | Retour (fleche)        | Header (gauche)             | navigation   | `accessibilityLabel` = `t('common.close', 'Back')` -> "Fermer" (FR) / "Back" (EN) ; icone MaterialIcons `arrow-back` ; `accessibilityRole="button"`         | Ecran monte avec un ecran precedent dans la pile | P1       |
| 2   | Champ Prenom (input)   | Corps                       | input-submit | `placeholder` = `t('auth.name.firstNamePlaceholder')` -> "Jeanne" (FR) / "Jane" (EN) ; `label` = `t('auth.name.firstNameLabel')` -> "Prénom" / "First name" | Ecran affiche                                    | P0       |
| 3   | Champ Nom (input)      | Corps                       | input-submit | `placeholder` = `t('auth.name.lastNamePlaceholder')` -> "Dupont" (FR) / "Doe" (EN) ; `label` = `t('auth.name.lastNameLabel')` -> "Nom" / "Last name"        | Ecran affiche                                    | P2       |
| 4   | Suivant (CTA primaire) | Corps (bas, pleine largeur) | submit       | `label` = `t('auth.name.submit')` -> "Suivant" (FR) / "Next" (EN) ; `accessibilityRole="button"` ; `accessibilityState.disabled` reflete l'etat             | Prenom non vide (apres trim)                     | P0       |

> Remarque : cet ecran ne contient aucun toggle, checkbox, FAB, lien legal, item de liste, swipe, long-press ni pull-to-refresh. Les 4 elements ci-dessus sont l'inventaire exhaustif des elements actionnables.

## Cas de test

### AUTH-NAME-001 - Retour vers l'OTP via la fleche

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte en cours d'authentification (post-OTP) ; donnees : arrive depuis l'ecran OTP avec `phoneNumber` ; etat reseau : Wi-Fi ; permissions : aucune.
- **Etapes** :
  1. Ouvrir l'ecran Saisie du nom depuis l'OTP.
  2. Saisir un debut de prenom (ex. "Ja") dans le champ Prenom.
  3. Taper sur la fleche Retour (locator `Fermer` / `Back`) en haut a gauche.
- **Resultat attendu** : `navigation.goBack()` est appele une fois ; retour a l'ecran OTP precedent ; aucun appel a `setProfile` ; les champs locaux sont abandonnes (rien n'est persiste).
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent (OTP) est affiche et qu'aucune ecriture store/reseau n'a eu lieu ; KO sinon.
- **Donnees de test** : prenom partiel "Ja" ; `phoneNumber` = `+15555550123`.
- **Duree estimee** : 2 min

### AUTH-NAME-002 - Multi-tap rapide sur Retour + reseau coupe

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte en cours d'authentification ; donnees : ecran Saisie du nom affiche ; etat reseau : passer en mode Avion (hors-ligne) avant l'action ; permissions : aucune.
- **Etapes** :
  1. Activer le mode Avion (hors-ligne).
  2. Taper tres rapidement 5 fois de suite sur la fleche Retour (locator `Fermer` / `Back`).
  3. Observer la pile de navigation.
- **Resultat attendu** : un seul retour effectif vers l'OTP (pas de double-pop qui ferait sortir du stack Auth ou planter) ; aucune erreur ; l'absence de reseau n'a aucun impact (ecran sans I/O).
- **Critere d'acceptation (OK/KO)** : OK si l'application reste stable, affiche l'ecran OTP et ne pop pas au-dela de la pile ; KO si crash, ecran blanc ou navigation incoherente.
- **Donnees de test** : N/A (interaction uniquement) ; `phoneNumber` = `+15555550123`.
- **Duree estimee** : 3 min

### AUTH-NAME-003 - Accessibilite du bouton Retour (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte en cours d'authentification ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee sur le maximum ; mode contraste eleve active ; etat reseau : Wi-Fi.
- **Etapes** :
  1. Activer TalkBack / VoiceOver.
  2. Regler la police systeme au plus grand et activer le contraste eleve.
  3. Balayer jusqu'a la fleche Retour en haut a gauche.
  4. Double-taper pour l'activer.
- **Resultat attendu** : le lecteur d'ecran annonce le libelle "Fermer" (FR) / "Back" (EN) et le role "bouton" ; la zone tactile reste atteignable (hitSlop 8, cible >= 44pt) ; l'icone reste visible avec contraste suffisant ; le double-tap declenche `goBack()`.
- **Critere d'acceptation (OK/KO)** : OK si l'element est focusable, correctement annonce (libelle + role bouton) et activable ; KO si non focusable, libelle absent/"unlabeled button", ou cible trop petite.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### AUTH-NAME-004 - Saisie d'un prenom et activation du CTA

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte en cours d'authentification ; ecran Saisie du nom affiche (clavier auto-ouvert sur Prenom) ; etat reseau : Wi-Fi ; permissions : aucune.
- **Etapes** :
  1. Verifier que le champ Prenom a deja le focus (autoFocus) et que le bouton Suivant est grise (desactive).
  2. Saisir "Jane" dans le champ Prenom (placeholder "Jeanne"/"Jane").
  3. Observer l'etat du bouton Suivant.
- **Resultat attendu** : des qu'un caractere non-espace est present, le bouton Suivant passe d'inactif (opacite 45%) a actif ; aucune ecriture store tant que Suivant n'est pas presse.
- **Critere d'acceptation (OK/KO)** : OK si le bouton Suivant devient actif et cliquable apres saisie d'un prenom valide ; KO s'il reste desactive ou s'active a tort sur entree vide.
- **Donnees de test** : Prenom = "Jane".
- **Duree estimee** : 2 min

### AUTH-NAME-005 - Champ Prenom : limite 50 caracteres et entree composee d'espaces

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte en cours d'authentification ; ecran affiche ; etat reseau : Wi-Fi.
- **Etapes** :
  1. Coller une chaine de 60 caracteres dans le champ Prenom.
  2. Verifier le nombre de caracteres reellement acceptes.
  3. Effacer le champ puis saisir uniquement des espaces " ".
  4. Observer l'etat du bouton Suivant.
- **Resultat attendu** : etape 1-2 : seuls 50 caracteres sont acceptes (`maxLength = 50`) ; etape 3-4 : avec uniquement des espaces, `firstName.trim().length === 0`, donc le bouton Suivant reste/redevient desactive.
- **Critere d'acceptation (OK/KO)** : OK si la saisie est tronquee a 50 caracteres ET si une entree 100% espaces laisse le CTA desactive ; KO si depassement de longueur accepte ou CTA active sur espaces seuls.
- **Donnees de test** : chaine 60 chars = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" ; chaine espaces = " ".
- **Duree estimee** : 3 min

### AUTH-NAME-006 - Accessibilite du champ Prenom (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte en cours d'authentification ; TalkBack/VoiceOver actif ; police systeme au maximum ; contraste eleve ; etat reseau : Wi-Fi.
- **Etapes** :
  1. Activer TalkBack/VoiceOver, police max, contraste eleve.
  2. Balayer jusqu'au champ Prenom.
  3. Verifier l'annonce du libelle "Prénom"/"First name" et du placeholder "Jeanne"/"Jane".
  4. Saisir "Jane" via le clavier accessible.
- **Resultat attendu** : le label "Prénom" est associe au champ et annonce ; le champ est focusable et editable ; le texte du label et du placeholder reste lisible avec police agrandie (pas de troncage genant) et contraste suffisant.
- **Critere d'acceptation (OK/KO)** : OK si le champ est annonce avec son label, editable, et lisible en police max + contraste eleve ; KO si label non associe, champ non focusable, ou texte coupe/illisible.
- **Donnees de test** : Prenom = "Jane".
- **Duree estimee** : 4 min

### AUTH-NAME-007 - Saisie du Nom (champ optionnel) et propagation au store

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte en cours d'authentification ; ecran affiche ; etat reseau : Wi-Fi.
- **Etapes** :
  1. Saisir "Jane" dans le champ Prenom.
  2. Saisir "Doe" dans le champ Nom (placeholder "Dupont"/"Doe").
  3. Taper sur Suivant.
- **Resultat attendu** : `setProfile` est appele avec `{ firstName: 'Jane', lastName: 'Doe' }` ; navigation vers `Username` avec `{ phoneNumber }`.
- **Critere d'acceptation (OK/KO)** : OK si le payload store contient bien le nom et que la navigation se fait ; KO si le nom est perdu ou la navigation echoue.
- **Donnees de test** : Prenom = "Jane", Nom = "Doe", `phoneNumber` = `+15555550123`.
- **Duree estimee** : 2 min

### AUTH-NAME-008 - Champ Nom : trim et valeur vide -> undefined

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte en cours d'authentification ; ecran affiche ; etat reseau : Wi-Fi.
- **Etapes** :
  1. Saisir " Jane " (avec espaces) dans le champ Prenom.
  2. Laisser le champ Nom vide.
  3. Taper sur Suivant.
  4. Inspecter le payload transmis a `setProfile`.
- **Resultat attendu** : le prenom est trimme -> "Jane" ; le nom vide est transmis comme `lastName: undefined` (et non chaine vide). Payload : `{ firstName: 'Jane', lastName: undefined }`.
- **Critere d'acceptation (OK/KO)** : OK si `setProfile` recoit `{ firstName: 'Jane', lastName: undefined }` ; KO si espaces conserves ou `lastName: ''`.
- **Donnees de test** : Prenom = " Jane ", Nom = "" ; payload attendu : `{ "firstName": "Jane", "lastName": undefined }`.
- **Duree estimee** : 3 min

### AUTH-NAME-009 - Accessibilite du champ Nom (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte en cours d'authentification ; TalkBack/VoiceOver actif ; police max ; contraste eleve ; reseau : Wi-Fi.
- **Etapes** :
  1. Activer TalkBack/VoiceOver, police max, contraste eleve.
  2. Balayer du champ Prenom vers le champ Nom.
  3. Verifier l'annonce du libelle "Nom"/"Last name" et la possibilite de l'ignorer (champ optionnel).
- **Resultat attendu** : le champ Nom est focusable, annonce avec son label, editable ; l'utilisateur peut le passer sans le remplir et atteindre le bouton Suivant ; texte lisible en police max + contraste eleve.
- **Critere d'acceptation (OK/KO)** : OK si le champ est annonce, optionnel et navigable au lecteur d'ecran ; KO si label manquant ou champ bloquant.
- **Donnees de test** : Nom = (laisse vide).
- **Duree estimee** : 3 min

### AUTH-NAME-010 - Suivant : chemin nominal stash + navigation vers Username

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte en cours d'authentification ; ecran affiche ; Prenom valide saisi ; reseau : Wi-Fi.
- **Etapes** :
  1. Saisir "Jane" dans Prenom et "Doe" dans Nom.
  2. Verifier que Suivant est actif.
  3. Taper sur Suivant (locator `Suivant`/`Next`).
- **Resultat attendu** : `setProfile({ firstName: 'Jane', lastName: 'Doe' })` est appele ; `navigation.navigate('Username', { phoneNumber: '+15555550123' })` est appele ; transition vers l'ecran de choix du pseudo. Aucun appel reseau direct (le flush API est differe a la fin de l'onboarding).
- **Critere d'acceptation (OK/KO)** : OK si le store recoit le bon payload et l'ecran Username s'affiche avec le bon `phoneNumber` ; KO si navigation absente, mauvais param, ou ecriture store erronee.
- **Donnees de test** : Prenom = "Jane", Nom = "Doe", `phoneNumber` = `+15555550123`.
- **Duree estimee** : 2 min

### AUTH-NAME-011 - Suivant desactive : tap sans prenom (no-op) + multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte en cours d'authentification ; ecran affiche ; champ Prenom VIDE ; reseau : Wi-Fi puis bascule hors-ligne.
- **Etapes** :
  1. Laisser le champ Prenom vide (bouton Suivant grise).
  2. Taper 6 fois rapidement sur le bouton Suivant.
  3. Saisir "Jane" puis, en mode Avion (hors-ligne), taper 6 fois tres vite sur Suivant.
  4. Observer les appels store/navigation.
- **Resultat attendu** : etape 2 : aucun appel a `setProfile` ni `navigate` (bouton inactif neutralise `onPress`). Etape 3 : la navigation vers `Username` ne se declenche qu'une fois (pas de multi-push empilant plusieurs ecrans Username) ; l'absence de reseau n'empeche pas la navigation locale.
- **Critere d'acceptation (OK/KO)** : OK si tap sur bouton desactive = no-op total, et si un prenom valide produit exactement une navigation malgre le multi-tap et le hors-ligne ; KO si appel sur etat desactive, ou empilement de plusieurs ecrans Username.
- **Donnees de test** : Prenom etape 1 = "" ; Prenom etape 3 = "Jane" ; `phoneNumber` = `+15555550123`.
- **Duree estimee** : 4 min

### AUTH-NAME-012 - Accessibilite du bouton Suivant (etat desactive/active annonce + police + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte en cours d'authentification ; TalkBack/VoiceOver actif ; police systeme au maximum ; contraste eleve ; reseau : Wi-Fi.
- **Etapes** :
  1. Activer TalkBack/VoiceOver, police max, contraste eleve.
  2. Avec le Prenom vide, balayer jusqu'au bouton Suivant et ecouter l'annonce.
  3. Saisir "Jane", revenir sur le bouton Suivant et ecouter l'annonce.
  4. Double-taper pour activer.
- **Resultat attendu** : etape 2 : le bouton est annonce "Suivant"/"Next", role "bouton", etat "desactive" (`accessibilityState.disabled = true`). Etape 3 : il est annonce comme actif (disabled = false). Le libelle reste sur une ligne et lisible meme en police max (numberOfLines=1, contraste suffisant). Double-tap declenche la navigation.
- **Critere d'acceptation (OK/KO)** : OK si l'etat desactive/active est correctement annonce et que le libelle reste lisible en police max + contraste eleve ; KO si etat non annonce, libelle illisible/tronque de facon genante, ou activable a l'etat desactive.
- **Donnees de test** : Prenom etape 2 = "" ; Prenom etape 3 = "Jane".
- **Duree estimee** : 4 min
