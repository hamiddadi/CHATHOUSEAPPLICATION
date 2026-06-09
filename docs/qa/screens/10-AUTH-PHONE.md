# 10 - Numero de telephone (`auth`)

## Contexte ecran

- **Route** : `Phone` dans l'`AuthStack` (`AuthStackParamList`, ecran `'Phone'`). Atteint depuis l'ecran d'accueil (Landing) ; navigue ensuite vers `Otp` (apres envoi du code), `Terms` et `PrivacyPolicy`.
- **Roles requis** : `guest` (utilisateur non authentifie). C'est la premiere etape du tunnel d'authentification ; aucun token n'existe encore. Les roles `standard`/`admin` n'atteignent pas cet ecran en usage normal (deja authentifies, routes vers le Main stack).
- **Comportements temps-reel** : aucun WebSocket/LiveKit/push n'est ouvert sur cet ecran. Le seul appel reseau est REST : `useAuthStore.requestOtp(phoneNumber)` -> `authService.requestOtp` (demande d'envoi d'un OTP par SMS cote backend). C'est un appel asynchrone sensible au reseau (latence, hors-ligne, timeout) mais pas un canal persistant. Effet de bord serveur : declenche l'envoi reel d'un SMS (rate-limit cote backend).
- **Pre-conditions globales** : backend joignable (`.env` racine = IP LAN du PC, voir MEMORY). Locale du device determine le pays detecte par defaut (`expo-localization` -> `regionCode`, fallback `US`). Connexion data/Wi-Fi pour l'appel `requestOtp`.
- **Etats de donnees pertinents** :
  - **Formulaire invalide par defaut** : a l'ouverture le champ contient seulement l'indicatif (ex. `+1`) et `ageConfirmed=false` -> bouton "Recevoir un code" desactive (`disabled`, `opacity-45`).
  - **Hors-ligne / latence** : `requestOtp` rejette -> `useFormApiErrors` route en toast (sauf 422 par champ -> erreur sous le champ). Aucune navigation vers `Otp`.
  - **Rate-limit / 422** : message d'erreur serveur affiche sous le champ telephone.
  - **Etat "modale pays ouverte"** : `CountryPicker` (Modal pleine page) avec recherche ; liste filtrable de 14 pays.
  - Pas de notion de liste vide / non-lus (ecran de saisie, pas de flux).

## Matrice bouton

| #   | Bouton                                            | Emplacement                                   | Type         | Locator reel                                                                                                                                  | Pre-condition                                        | Priorite |
| --- | ------------------------------------------------- | --------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| 1   | Retour / Fermer (fleche arriere)                  | Header (haut gauche)                          | navigation   | `accessibilityLabel` = `t('common.close')` = "Fermer" (role `button`)                                                                         | Aucune                                               | P1       |
| 2   | Selecteur de pays (drapeau + indicatif + chevron) | Corps - adornment gauche de l'Input telephone | menu         | Pressable sans label ; reperable via le texte de l'indicatif (`selectedCountry.callingCode`, ex. "+1") et le drapeau ; ouvre `CountryPicker`  | Aucune                                               | P1       |
| 3   | Champ numero de telephone (Input)                 | Corps                                         | input-submit | `placeholder` = `t('auth.phone.placeholder')` = "+33 6 12 34 56 78"                                                                           | Aucune                                               | P0       |
| 4   | Case "J'ai au moins 16 ans"                       | Corps (au-dessus du CTA)                      | toggle       | `accessibilityRole='checkbox'`, libelle `t('auth.phone.ageVerification')` = "Je confirme avoir au moins 16 ans", `accessibilityState.checked` | Aucune                                               | P0       |
| 5   | Bouton "Recevoir un code" (CTA principal)         | Corps (bas)                                   | submit       | role `button`, name = `t('auth.phone.submit')` = "Recevoir un code"                                                                           | Champ valide E.164 + age confirme (sinon `disabled`) | P0       |
| 6   | Lien "Conditions d'utilisation"                   | Pied de page (texte legal)                    | link         | `accessibilityRole='link'`, `accessibilityLabel` = `t('auth.phone.termsLinkA11y')` = "Conditions d'utilisation"                               | Aucune                                               | P2       |
| 7   | Lien "Politique de confidentialite"               | Pied de page (texte legal)                    | link         | `accessibilityRole='link'`, `accessibilityLabel` = `t('auth.phone.privacyLinkA11y')` = "Politique de confidentialite"                         | Aucune                                               | P2       |
| 8   | Bouton "Fermer" du selecteur de pays (croix)      | Header de la modale `CountryPicker`           | navigation   | Pressable avec icone MaterialIcons `close` (pas de label ; reperable par l'icone)                                                             | Modale pays ouverte                                  | P2       |
| 9   | Champ recherche pays                              | Modale `CountryPicker`                        | input-submit | `placeholder` = `t('common.search', 'Search')` (cle absente en FR -> fallback "Search")                                                       | Modale pays ouverte                                  | P2       |
| 10  | Item pays (cellule de liste)                      | Modale `CountryPicker` - FlatList             | list-item    | Pressable de cellule ; reperable par le nom du pays (ex. "France") + indicatif (ex. "+33")                                                    | Modale pays ouverte                                  | P1       |

> Note : les boutons 8, 9, 10 appartiennent au composant partage `CountryPicker` rendu en modale depuis cet ecran (pas de dossier `partials/`). Les boutons-icone du header (1) et de la modale (8) n'ont pas de label texte visible ; (8) n'a pas non plus d'`accessibilityLabel` -> point d'attention accessibilite signale.

## Cas de test

### AUTH-PHONE-001 - Retour ferme l'ecran telephone

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest, reseau indifferent, ecran `Phone` ouvert depuis Landing.
- **Etapes** :
  1. Ouvrir l'ecran `Phone`.
  2. Taper sur la fleche retour (locator `accessibilityLabel="Fermer"`) en haut a gauche.
- **Resultat attendu** : `navigation.goBack()` est appele une fois ; retour a l'ecran precedent (Landing). Aucune saisie n'est conservee.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent s'affiche apres le tap ; KO si l'ecran reste sur `Phone` ou crash.
- **Donnees de test** : aucune.
- **Duree estimee** : 1 min.

### AUTH-PHONE-002 - Retour : multi-clic rapide ne double pas la navigation

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest, reseau Wi-Fi, ecran `Phone` ouvert.
- **Etapes** :
  1. Taper tres rapidement 5 fois de suite sur la fleche retour (locator "Fermer").
  2. Observer la pile de navigation.
- **Resultat attendu** : un seul `goBack` effectif ; pas d'empilement d'animations, pas de double pop menant a un ecran inattendu ni de crash.
- **Critere d'acceptation (OK/KO)** : OK si on revient une seule fois sans ecran blanc/crash ; KO si double-pop ou ecran vide.
- **Donnees de test** : aucune.
- **Duree estimee** : 2 min.

### AUTH-PHONE-003 - Retour accessible au lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte guest ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme au maximum ; contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au premier element focusable de l'ecran.
  3. Ecouter l'annonce et double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Fermer, bouton" ; double-tap declenche `goBack`. La fleche reste visible et le tap target >= 44pt (hitSlop=8). En police agrandie le header ne tronque pas l'icone.
- **Critere d'acceptation (OK/KO)** : OK si annonce role+label corrects et activation fonctionne ; KO si element non focusable ou annonce vide ("bouton" sans nom).
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min.

### AUTH-PHONE-004 - Ouvrir le selecteur de pays

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest, ecran `Phone` ouvert, clavier visible (autoFocus du champ).
- **Etapes** :
  1. Taper sur l'adornment gauche du champ (drapeau + indicatif, ex. "🇺🇸 +1" + chevron).
  2. Observer le clavier et la modale.
- **Resultat attendu** : `Keyboard.dismiss()` ferme le clavier ; la modale `CountryPicker` s'ouvre en `pageSheet` (slide), titre "Select Country", champ de recherche et liste des 14 pays.
- **Critere d'acceptation (OK/KO)** : OK si la modale s'ouvre et le clavier se ferme ; KO si rien ne s'ouvre ou clavier reste superpose.
- **Donnees de test** : aucune.
- **Duree estimee** : 1 min.

### AUTH-PHONE-005 - Selecteur de pays : double-tap rapide ne crash pas

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest, ecran `Phone` ouvert.
- **Etapes** :
  1. Taper deux fois tres vite sur l'adornment pays.
  2. Une fois la modale ouverte, taper plusieurs fois rapidement sur la croix de fermeture.
- **Resultat attendu** : une seule modale s'ouvre (pas de double `Modal` empilee) ; la fermeture rapide ne laisse pas d'ecran fantome. L'etat `countryPickerVisible` revient a `false`.
- **Critere d'acceptation (OK/KO)** : OK si une seule modale et fermeture propre ; KO si modale fantome, freeze ou crash.
- **Donnees de test** : aucune.
- **Duree estimee** : 2 min.

### AUTH-PHONE-006 - Selecteur de pays accessible (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; police systeme XXL ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran, naviguer jusqu'a l'adornment pays.
  2. Ecouter l'annonce, double-taper.
  3. Dans la modale, parcourir le titre, le champ recherche et les cellules pays.
- **Resultat attendu** : l'adornment est focusable et active la modale. Point d'attention : l'adornment n'a pas d'`accessibilityLabel` explicite -> l'annonce s'appuie sur les textes enfants (drapeau emoji + indicatif). Verifier que l'indicatif est lu (ex. "plus un"). Le titre "Select Country" est lu. En police XXL, indicatif et nom de pays ne se chevauchent pas.
- **Critere d'acceptation (OK/KO)** : OK si l'element est atteignable et activable au lecteur d'ecran et que la modale est navigable ; KO si element ignore par le lecteur ou texte tronque illisible.
- **Donnees de test** : aucune.
- **Duree estimee** : 4 min.

### AUTH-PHONE-007 - Selection d'un pays met a jour indicatif et validation

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : guest, ecran `Phone` ouvert, modale pays ouverte.
- **Etapes** :
  1. Ouvrir le selecteur de pays.
  2. Dans la recherche, saisir "France".
  3. Taper la cellule "France +33".
- **Resultat attendu** : la modale se ferme, `setSelectedCountry` = France, le champ telephone est reinitialise a la valeur `+33` (`setValue('phoneNumber', '+33', { shouldValidate: true })`), le drapeau passe a 🇫🇷, l'adornment affiche "+33". La recherche est reinitialisee.
- **Critere d'acceptation (OK/KO)** : OK si l'indicatif affiche est "+33" et le drapeau France apres selection ; KO si l'indicatif reste l'ancien.
- **Donnees de test** : recherche = `France`.
- **Duree estimee** : 2 min.

### AUTH-PHONE-008 - Recherche pays sans resultat

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : guest, modale pays ouverte.
- **Etapes** :
  1. Dans le champ recherche (placeholder "Search"), saisir "Zzzz".
  2. Observer la liste.
- **Resultat attendu** : la FlatList est vide (aucune cellule). Aucun crash. Effacer le texte (clearButton iOS) restaure les 14 pays.
- **Critere d'acceptation (OK/KO)** : OK si liste vide propre puis restauration apres effacement ; KO si crash ou items residuels.
- **Donnees de test** : recherche = `Zzzz`, puis champ vide ; cas mixte : `+33` doit matcher France (filtre par callingCode), `fr` doit matcher France (filtre par cca2).
- **Duree estimee** : 2 min.

### AUTH-PHONE-009 - Fermer le selecteur via la croix accessible

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; modale pays ouverte.
- **Etapes** :
  1. Avec le lecteur d'ecran, naviguer jusqu'a la croix (icone `close`) du header de la modale.
  2. Ecouter l'annonce, double-taper.
  3. Tester aussi le geste systeme de fermeture (`onRequestClose` / back Android).
- **Resultat attendu** : la modale se ferme (`onClose`). Point d'attention a remonter : la croix n'a ni `accessibilityLabel` ni `accessibilityRole` explicite -> annonce potentiellement vide pour le lecteur d'ecran. Le bouton back Android doit aussi fermer la modale.
- **Critere d'acceptation (OK/KO)** : OK si la modale se ferme par la croix ET par le back systeme ; KO si la croix est inatteignable au lecteur d'ecran sans alternative.
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min.

### AUTH-PHONE-010 - Saisie d'un numero valide formate a la volee

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : guest, pays par defaut US (+1), ecran `Phone` ouvert.
- **Etapes** :
  1. Dans le champ telephone (placeholder "+33 6 12 34 56 78"), saisir `4155551234`.
  2. Observer le formatage affiche.
- **Resultat attendu** : seules les chiffres sont conservees (`replace(/[^\d]/g, '')`), la valeur du formulaire devient l'E.164 canonique `+14155551234` ; l'affichage applique `AsYouType` (ex. "(415) 555-1234") sans l'indicatif (retire par `prefixRegex`).
- **Critere d'acceptation (OK/KO)** : OK si la valeur interne est `+14155551234` et l'affichage formate ; KO si caracteres non numeriques persistes ou indicatif duplique.
- **Donnees de test** : saisie `4155551234` -> attendu wire `+14155551234`.
- **Duree estimee** : 2 min.

### AUTH-PHONE-011 - Numero invalide affiche l'erreur et bloque le CTA

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : guest, ecran `Phone` ouvert, age confirme.
- **Etapes** :
  1. Cocher la case d'age.
  2. Saisir `12` (trop court) dans le champ.
  3. Observer l'erreur et l'etat du CTA.
  4. Effacer puis saisir une valeur respectant E.164.
- **Resultat attendu** : avec `12`, le schema zod (`/^\+[1-9][0-9]{1,14}$/`) echoue -> message `t('auth.phone.errors.invalid')` = "Numero invalide. Format attendu : +33612345678." affiche sous le champ (bordure danger), CTA reste `disabled`. Apres saisie valide, l'erreur disparait et le CTA s'active. Cas vide -> message `required` "Ton numero est requis.".
- **Critere d'acceptation (OK/KO)** : OK si message d'erreur correct affiche et CTA desactive tant que invalide ; KO si CTA actif avec numero invalide.
- **Donnees de test** : `12` (invalide), `+0123` (invalide, commence par 0), `4155551234` (valide en US).
- **Duree estimee** : 3 min.

### AUTH-PHONE-012 - Champ telephone accessible (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran, naviguer jusqu'au champ telephone.
  2. Ecouter l'annonce ; saisir un numero invalide pour declencher l'erreur.
  3. Verifier que l'erreur sous le champ est lue.
- **Resultat attendu** : le champ est annonce avec son placeholder ; le clavier `phone-pad` s'ouvre. Le texte d'erreur (`text-danger`) doit etre annonce/atteignable et garder un contraste suffisant en mode contraste eleve. En police XXL, l'adornment pays + le champ restent sur une ligne lisible (size lg).
- **Critere d'acceptation (OK/KO)** : OK si champ + erreur annonces et lisibles en XXL/contraste ; KO si erreur invisible au lecteur ou texte tronque.
- **Donnees de test** : saisie invalide `12`.
- **Duree estimee** : 4 min.

### AUTH-PHONE-013 - Confirmer l'age (case a cocher)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : guest, ecran `Phone` ouvert, numero valide deja saisi.
- **Etapes** :
  1. Saisir un numero valide (`4155551234`).
  2. Taper la case "Je confirme avoir au moins 16 ans" (role `checkbox`).
  3. Observer la coche et l'etat du CTA.
- **Resultat attendu** : `ageConfirmed` passe a `true` ; `accessibilityState.checked=true` ; coche MaterialIcons `check` visible (fond primary) ; le CTA "Recevoir un code" devient actif (numero valide + age coche). Re-taper decoche et redesactive le CTA.
- **Critere d'acceptation (OK/KO)** : OK si la coche bascule et pilote l'activation du CTA ; KO si l'etat ne change pas ou CTA actif sans coche.
- **Donnees de test** : numero `4155551234`.
- **Duree estimee** : 2 min.

### AUTH-PHONE-014 - Case d'age : bascule rapide repetee reste coherente

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : guest, numero valide saisi.
- **Etapes** :
  1. Taper la case d'age 10 fois tres rapidement.
  2. Observer l'etat final (coche/decoche) et le CTA.
- **Resultat attendu** : etat final deterministe (nombre pair de taps -> decoche, impair -> coche) ; `accessibilityState.checked` reflete l'etat reel ; le CTA suit la regle `isValid` (desactive si decoche). Pas de desynchronisation visuel/logique.
- **Critere d'acceptation (OK/KO)** : OK si etat visuel == etat logique apres rafale ; KO si coche affichee mais CTA desactive (ou inverse).
- **Donnees de test** : numero `4155551234`.
- **Duree estimee** : 2 min.

### AUTH-PHONE-015 - Case d'age accessible (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran, naviguer jusqu'a la case d'age.
  2. Ecouter role + etat + libelle ; double-taper pour cocher ; reecouter.
- **Resultat attendu** : annonce "case a cocher, non cochee, Je confirme avoir au moins 16 ans" puis apres double-tap "cochee". Le libelle (`flex-1`) ne deborde pas en police XXL ; zone tappable couvre toute la ligne (Pressable sur la rangee).
- **Critere d'acceptation (OK/KO)** : OK si role checkbox + etat checked annonces correctement et libelle entier ; KO si etat non annonce ou libelle tronque.
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min.

### AUTH-PHONE-016 - Recevoir un code : envoi OTP nominal et navigation vers Otp

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : guest, backend joignable, Wi-Fi stable, numero valide + age confirme.
- **Etapes** :
  1. Saisir `4155551234`, cocher l'age.
  2. Attendre que le CTA "Recevoir un code" s'active (`accessibilityState.disabled=false`).
  3. Taper le CTA.
- **Resultat attendu** : `requestOtp('+14155551234')` est appele ; pendant l'appel le bouton passe `loading` (spinner, `isSubmitting`) ; succes -> `navigation.navigate('Otp', { phoneNumber: '+14155551234' })`. Cote backend, un SMS OTP est envoye au numero.
- **Critere d'acceptation (OK/KO)** : OK si `requestOtp` recoit l'E.164 exact et l'ecran `Otp` s'affiche avec le bon `phoneNumber` ; KO si pas d'appel, mauvais format, ou pas de navigation.
- **Donnees de test** : numero `+14155551234` ; (alt FR) selection France + `612345678` -> `+33612345678`.
- **Duree estimee** : 2 min.

### AUTH-PHONE-017 - Recevoir un code : multi-clic rapide n'envoie qu'un OTP + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : guest ; numero valide + age confirme ; capacite a couper le reseau (mode avion / proxy latence).
- **Etapes** :
  1. CTA actif. Activer le mode avion (hors-ligne).
  2. Taper le CTA 4 fois tres rapidement.
  3. Observer le comportement.
  4. Reactiver le reseau et retaper le CTA une fois.
- **Resultat attendu** : pendant la 1re soumission `isSubmitting=true` -> `onPress` est neutralise (`disabled`/`loading`), donc pas de 4 envois simultanes (au plus 1 appel en vol). Hors-ligne -> `requestOtp` rejette -> `handleApiError` affiche un toast d'erreur reseau (ou erreur 422 par champ si applicable), AUCUNE navigation vers `Otp`. Apres reconnexion, un nouveau tap relance `requestOtp` et navigue.
- **Critere d'acceptation (OK/KO)** : OK si au plus un appel reseau par soumission, toast d'erreur hors-ligne, et reprise apres reconnexion ; KO si appels multiples, navigation prematuree, ou ecran fige.
- **Donnees de test** : numero `+14155551234` ; simuler latence 5 s puis timeout.
- **Duree estimee** : 5 min.

### AUTH-PHONE-018 - Recevoir un code : rate-limit / erreur serveur 429-422

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : guest, backend renvoyant une erreur (rate-limit OTP atteint, ou 422 champ).
- **Etapes** :
  1. Saisir un numero valide + age confirme.
  2. Taper le CTA plusieurs fois sur un court intervalle pour declencher le rate-limit backend (ou utiliser un numero declenchant 422).
- **Resultat attendu** : sur 422 avec `fields` -> `setError('phoneNumber', { message })` affiche l'erreur sous le champ. Sur autre erreur (429/500/reseau) -> toast via `useApiErrorToast`. Le statut store repasse `unauthenticated`, pas de navigation vers `Otp`. Le bouton redevient actif (plus `loading`).
- **Critere d'acceptation (OK/KO)** : OK si erreur surfacee (champ ou toast) sans navigation et bouton reutilisable ; KO si crash, navigation, ou bouton bloque en loading.
- **Donnees de test** : numero `+14155550000` ; reponses simulees 429 et 422 `{ fields: { phoneNumber: "..." } }`.
- **Duree estimee** : 4 min.

### AUTH-PHONE-019 - Recevoir un code : CTA accessible et etat desactive annonce

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. A l'ouverture (formulaire invalide), naviguer au lecteur d'ecran jusqu'au CTA.
  2. Ecouter l'annonce (doit indiquer desactive).
  3. Remplir numero + age, relire l'annonce, double-taper pour soumettre.
- **Resultat attendu** : tant qu'invalide, annonce "Recevoir un code, bouton, desactive" (`accessibilityState.disabled=true`, opacite 45%) et double-tap n'a aucun effet. Une fois valide, annonce sans "desactive" et soumission possible ; pendant l'appel, etat `busy` (loading). Contraste du libelle suffisant ; bouton fullWidth lisible en XXL.
- **Critere d'acceptation (OK/KO)** : OK si l'etat disabled/busy est annonce et bloque/permet l'action en consequence ; KO si bouton activable a vide ou etat non annonce.
- **Donnees de test** : numero `4155551234`.
- **Duree estimee** : 4 min.

### AUTH-PHONE-020 - Lien Conditions d'utilisation

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : guest, ecran `Phone` ouvert.
- **Etapes** :
  1. Faire defiler jusqu'au texte legal du pied de page.
  2. Taper "Conditions d'utilisation" (locator `accessibilityLabel="Conditions d'utilisation"`).
- **Resultat attendu** : `navigation.navigate('Terms')` ; l'ecran Terms s'affiche. Aucune perte de la saisie a priori (stack push). Retour ramene sur `Phone`.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran Terms s'ouvre ; KO si aucune navigation ou mauvais ecran.
- **Donnees de test** : aucune.
- **Duree estimee** : 1 min.

### AUTH-PHONE-021 - Liens legaux : taps rapides alternes ne cassent pas la stack

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : guest, ecran `Phone` ouvert.
- **Etapes** :
  1. Taper rapidement "Conditions d'utilisation" puis "Politique de confidentialite" sans attendre la transition.
  2. Revenir en arriere et observer la pile.
- **Resultat attendu** : navigation vers `Terms` puis `PrivacyPolicy` (ou la derniere cible nette) sans double-push incoherent ni crash ; les retours ramenent proprement vers `Phone`.
- **Critere d'acceptation (OK/KO)** : OK si pile coherente et retours propres ; KO si ecran blanc/double-push bloquant.
- **Donnees de test** : aucune.
- **Duree estimee** : 2 min.

### AUTH-PHONE-022 - Liens legaux accessibles (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; police XXL ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran, naviguer dans le paragraphe legal.
  2. Verifier que "Conditions d'utilisation" et "Politique de confidentialite" sont annonces comme liens distincts.
  3. Double-taper chacun.
- **Resultat attendu** : chaque lien est annonce "lien, Conditions d'utilisation" / "lien, Politique de confidentialite" (`accessibilityRole='link'`) et navigue vers l'ecran correspondant. Les liens (couleur primary) gardent un contraste suffisant sur fond sombre ; en XXL le paragraphe reste lisible (centre, leading 5).
- **Critere d'acceptation (OK/KO)** : OK si deux liens distincts atteignables et activables ; KO si lien non focusable ou indistinct du texte.
- **Donnees de test** : aucune.
- **Duree estimee** : 3 min.

### AUTH-PHONE-023 - Selection d'un item pays accessible (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : guest ; TalkBack/VoiceOver actif ; modale pays ouverte ; police XXL.
- **Etapes** :
  1. Au lecteur d'ecran, parcourir les cellules de la FlatList.
  2. Ecouter une cellule (ex. France), double-taper pour selectionner.
- **Resultat attendu** : la cellule est focusable et lit nom + indicatif (drapeau emoji eventuellement annonce). Double-tap selectionne le pays, ferme la modale et met a jour l'indicatif (cf. AUTH-PHONE-007). Point d'attention : cellule sans `accessibilityRole` explicite -> verifier qu'elle reste activable. En XXL, nom et indicatif ne se chevauchent pas.
- **Critere d'acceptation (OK/KO)** : OK si cellule atteignable + activable au lecteur d'ecran et selection effective ; KO si cellule ignoree ou non activable.
- **Donnees de test** : pays France (+33).
- **Duree estimee** : 3 min.

### AUTH-PHONE-024 - Item pays : indicatif partage (Canada/US) reste coherent

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : guest, modale pays ouverte.
- **Etapes** :
  1. Selectionner "Canada (+1)".
  2. Saisir `4155551234`.
  3. Rouvrir le selecteur et choisir "United States (+1)".
- **Resultat attendu** : les deux pays partagent l'indicatif `+1` mais des `cca2` differents (`CA` vs `US`), donc le formatage `AsYouType` peut differer ; la valeur wire reste `+14155551234`. Le changement de pays reinitialise le champ a `+1` (perte du local apres re-selection, comportement attendu via `setValue`).
- **Critere d'acceptation (OK/KO)** : OK si l'E.164 reste valide et le champ se reinitialise a `+1` apres re-selection ; KO si indicatif duplique (`+1+1...`) ou valeur incoherente.
- **Donnees de test** : Canada puis US, local `4155551234`.
- **Duree estimee** : 2 min.

## Recapitulatif

- Elements interactifs recenses : 10.
- Cas de test rediges : 24.
- Aucun comportement temps-reel (WebSocket/LiveKit/push) sur cet ecran ; seul appel reseau = `requestOtp` (REST, declenche un SMS). Les cas P0 couvrent la saisie, la validation, la case d'age et l'envoi OTP (nominal, multi-clic, hors-ligne, rate-limit, accessibilite).
