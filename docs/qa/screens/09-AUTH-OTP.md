# 09 - Code OTP (`auth`)

## Contexte écran

- **Route** : `Otp` (stack `AuthStackParamList`), atteinte depuis l'écran de saisie du numéro de téléphone. Paramètre de route obligatoire : `phoneNumber` (ex. `+33612345678`).
- **Composant principal** : `src/features/auth/screens/OtpScreen/OtpScreen.tsx`.
- **Sous-composant clé** : `src/shared/components/OtpInput/OtpInput.tsx` (6 cellules visuelles + un `TextInput` caché unique, clavier `number-pad`, `autoComplete="one-time-code"` / `textContentType="oneTimeCode"` pour l'auto-remplissage SMS).
- **Rôles requis** : `guest` (utilisateur non authentifié en cours de connexion). C'est une étape pré-auth : aucun rôle `standard`/`admin` n'est encore établi. À la vérification réussie, l'utilisateur devient `standard` (nouvel utilisateur routé vers `Name`, utilisateur existant promu `authenticated`).
- **Comportements temps réel** : aucun WebSocket ni LiveKit sur cet écran. Les actions réseau sont des appels REST HTTP :
  - `verifyOtp` → `POST /auth/verify-otp` (déclenché automatiquement dès 6 chiffres saisis).
  - `requestOtp` (renvoi) → `POST /auth/send-otp`.
  - Un timer local (`setInterval` 1 s) gère le compte à rebours de renvoi (60 s). Ce n'est pas du temps réel serveur mais une horloge locale sensible à la latence/aux changements d'état.
- **Pré-conditions globales** :
  - L'écran exige `route.params.phoneNumber` ; sans lui, le masquage et l'appel `verifyOtp` échouent.
  - Un code OTP doit avoir été envoyé à l'étape précédente (sinon toute vérification échoue côté backend).
  - Connectivité réseau requise pour `verifyOtp` et `requestOtp`.
- **Constantes métier** : `OTP_LENGTH = 6`, `RESEND_COOLDOWN_SECONDS = 60`, `MAX_ATTEMPTS = 5`.
- **États de données pertinents** :
  - Initial : compte à rebours actif (`isCounting=true`, `countdown=60`), bouton « Renvoyer » masqué (texte « Renvoyer dans 1:00 » affiché).
  - Erreur de code : message `auth.otp.errors.invalid`, animation shake, compteur de tentatives restantes affiché (`attemptsRemaining`), champ vidé.
  - Verrouillé : après `MAX_ATTEMPTS` (5) échecs, `locked=true` → message `tooManyAttempts`, soumissions bloquées côté client jusqu'au renvoi.
  - Hors-ligne : `verifyOtp`/`requestOtp` rejettent ; `verifyOtp` affiche le message d'erreur générique invalide (le code ne distingue pas réseau vs code faux), `requestOtp` échoue en silence (l'erreur remonte via le store).
  - En soumission : indicateur « Vérification… » (`auth.otp.verifying`) en zone live.

## Matrice bouton

| #   | Bouton                       | Emplacement                | Type         | Locator réel                                                                                    | Pré-condition                                                                             | Priorité |
| --- | ---------------------------- | -------------------------- | ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| 1   | Retour / Fermer              | Header (haut gauche)       | navigation   | `accessibilityLabel = t('common.close')` → « Fermer » (icône `MaterialIcons name="arrow-back"`) | Écran monté                                                                               | P1       |
| 2   | Champ code OTP (auto-submit) | Corps (zone centrale)      | input-submit | `accessibilityLabel = "Verification code, 6 digits"` (défaut `OtpInput`)                        | `phoneNumber` présent ; non verrouillé ; réseau                                           | P0       |
| 3   | Renvoyer le code             | Corps (bas, sous le champ) | submit       | `accessibilityLabel = t('auth.otp.resend')` → « Renvoyer le code »                              | `countdown === 0` et `!isResending` (sinon élément absent, remplacé par texte `resendIn`) | P1       |

> Note : le texte « Renvoyer dans {{time}} » (`auth.otp.resendIn`) n'est PAS pressable — c'est un `Text` informatif affiché tant que le compte à rebours n'est pas écoulé. Le bouton « Renvoyer le code » (#3) n'est rendu que lorsque `countdown === 0`. Le champ OTP (#2) n'a pas de bouton « Valider » : la soumission est automatique au 6e chiffre.

## Cas de test

### AUTH-OTP-001 - Retour ferme l'écran OTP

- **Type** : Fonctionnel positif
- **Priorité** : P1
- **Pré-conditions** : compte guest (flux de connexion), écran OTP affiché avec `phoneNumber=+33612345678`, Wi-Fi, aucune permission spéciale.
- **Étapes** :
  1. Arriver sur l'écran « Entre le code reçu ».
  2. Taper sur l'icône flèche retour en haut à gauche (label « Fermer »).
  3. Observer la navigation.
- **Résultat attendu** : `navigation.goBack()` est appelé une fois ; retour à l'écran précédent (saisie du numéro de téléphone). Le code saisi n'est pas persisté.
- **Critère d'acceptation (OK/KO)** : OK si l'écran précédent réapparaît ; KO si l'écran OTP reste affiché ou si l'app crashe.
- **Données de test** : `phoneNumber = "+33612345678"`.
- **Durée estimée** : 1 min.

### AUTH-OTP-002 - Retour : multi-clic rapide ne navigue qu'une fois

- **Type** : Erreur/Limite
- **Priorité** : P1
- **Pré-conditions** : compte guest, écran OTP affiché, réseau quelconque.
- **Étapes** :
  1. Taper 4 fois très rapidement (double/triple tap < 300 ms) sur le bouton « Fermer ».
  2. Observer la pile de navigation.
  3. Simuler une latence réseau (Network Link Conditioner / throttle 3G) puis retaper retour.
- **Résultat attendu** : un seul retour effectif ; pas d'empilement d'écrans, pas de double `goBack` provoquant un crash de pile vide. La latence n'affecte pas le retour (action locale, hors réseau).
- **Critère d'acceptation (OK/KO)** : OK si l'utilisateur revient à un seul écran précédent sans erreur ; KO si la pile se vide / écran blanc / crash.
- **Données de test** : `phoneNumber = "+33612345678"`.
- **Durée estimée** : 2 min.

### AUTH-OTP-003 - Retour accessible (TalkBack/VoiceOver + police agrandie + contraste)

- **Type** : Accessibilité
- **Priorité** : P1
- **Pré-conditions** : compte guest, écran OTP affiché ; TalkBack (Android) ou VoiceOver (iOS) activé ; taille de police système au maximum ; mode contraste élevé activé.
- **Étapes** :
  1. Activer le lecteur d'écran.
  2. Balayer jusqu'au premier élément focusable en haut de l'écran.
  3. Écouter l'annonce, puis double-taper pour activer.
  4. Vérifier que l'icône reste visible/contrastée avec la police agrandie.
- **Résultat attendu** : le lecteur d'écran annonce « Fermer, bouton » (`accessibilityRole="button"`, `accessibilityLabel` « Fermer ») ; le double-tap déclenche le retour ; l'icône flèche (`colors.text`) reste lisible et n'est pas tronquée à la police max.
- **Critère d'acceptation (OK/KO)** : OK si l'élément est annoncé comme bouton « Fermer » et activable ; KO si annoncé sans label, non focusable, ou masqué/tronqué.
- **Données de test** : `phoneNumber = "+33612345678"`.
- **Durée estimée** : 3 min.

### AUTH-OTP-004 - Saisie d'un code valide : utilisateur existant reste connecté

- **Type** : Fonctionnel positif
- **Priorité** : P0
- **Pré-conditions** : compte standard existant (numéro déjà enregistré), code OTP correct connu, Wi-Fi, backend joignable.
- **Étapes** :
  1. Sur l'écran OTP, focus automatique sur le champ (annonce « Verification code, 6 digits »).
  2. Saisir les 6 chiffres du code valide (ex. `654321`).
  3. Observer l'auto-soumission au 6e chiffre.
  4. Attendre la réponse `POST /auth/verify-otp`.
- **Résultat attendu** : indicateur « Vérification… » brièvement affiché ; `verifyOtp("+33612345678","654321")` appelé ; `isNewUser=false` → PAS de navigation vers `Name` ; le store passe `status='authenticated'` et l'app bascule hors du stack Auth (vers Onboarding/Main).
- **Critère d'acceptation (OK/KO)** : OK si l'utilisateur est authentifié sans passer par `Name` ; KO si erreur affichée, navigation vers `Name`, ou aucun changement d'état.
- **Données de test** : `phoneNumber = "+33612345678"`, code `654321`. Payload : `{ phoneNumber: "+33612345678", code: "654321" }`.
- **Durée estimée** : 2 min.

### AUTH-OTP-005 - Saisie d'un code valide : nouvel utilisateur routé vers Name

- **Type** : Fonctionnel positif
- **Priorité** : P0
- **Pré-conditions** : numéro JAMAIS enregistré (nouvel utilisateur), code OTP correct, Wi-Fi.
- **Étapes** :
  1. Saisir le code valide à 6 chiffres (ex. `123456`).
  2. Laisser l'auto-soumission s'exécuter.
  3. Observer la navigation après succès.
- **Résultat attendu** : `verifyOtp("+33612345678","123456")` renvoie `isNewUser=true` ; `navigation.navigate('Name', { phoneNumber: "+33612345678" })` est appelé ; le store reste `status='authenticating'` (stack Auth maintenu pour atteindre l'étape Name puis Username).
- **Critère d'acceptation (OK/KO)** : OK si l'écran « Name » s'affiche avec le bon `phoneNumber` ; KO si l'app bascule sur Main sans passer par Name, ou affiche une erreur.
- **Données de test** : `phoneNumber = "+33699998888"`, code `123456`.
- **Durée estimée** : 2 min.

### AUTH-OTP-006 - Code invalide : erreur, shake, décompte des tentatives, multi-clic et reconnexion

- **Type** : Erreur/Limite
- **Priorité** : P0
- **Pré-conditions** : compte guest, écran OTP, code SAISI faux ou expiré ; réseau variable.
- **Étapes** :
  1. Saisir un code erroné à 6 chiffres (ex. `000000`).
  2. Observer l'auto-soumission et la réponse en échec.
  3. Immédiatement re-saisir un autre mauvais code 3 fois de suite très rapidement (test de spam).
  4. Couper le réseau (mode avion), saisir 6 chiffres et observer.
  5. Réactiver le réseau, ressaisir le code correct.
- **Résultat attendu** :
  - À chaque échec : message « Code invalide. 6 chiffres attendus. » (`auth.otp.errors.invalid`), animation shake, champ vidé, `attempts` incrémenté.
  - Tentatives restantes affichées : « 4 tentatives restantes » après le 1er échec, etc. (`auth.otp.attemptsRemaining`, pluriel/singulier géré : « 1 tentative restante »).
  - En mode avion : même message d'erreur générique invalide (le code ne distingue pas erreur réseau d'un mauvais code), pas de crash, `attempts` incrémenté.
  - Après reconnexion + code correct (si tentatives restantes), vérification réussit.
- **Critère d'acceptation (OK/KO)** : OK si chaque échec affiche l'erreur + le bon nombre de tentatives restantes sans crash et que le multi-clic n'envoie pas de requêtes en doublon non gérées ; KO si l'app crashe, double-soumet le même code en boucle, ou n'affiche pas le décompte.
- **Données de test** : `phoneNumber = "+33612345678"`, codes faux `000000`, `111111`, `222222` ; code correct `654321`.
- **Durée estimée** : 4 min.

### AUTH-OTP-007 - Verrouillage après 5 tentatives : soumissions bloquées

- **Type** : Erreur/Limite
- **Priorité** : P0
- **Pré-conditions** : compte guest, écran OTP, 5 codes faux disponibles, réseau actif.
- **Étapes** :
  1. Saisir 5 codes faux consécutifs (`000000` à `444444`), en laissant chaque auto-soumission échouer.
  2. Après le 5e échec, tenter une 6e saisie de 6 chiffres.
  3. Observer le message et le comportement réseau.
- **Résultat attendu** : après 5 échecs, `attempts >= MAX_ATTEMPTS` → `locked=true` ; message « Trop de tentatives. Renvoie un nouveau code. » (`auth.otp.errors.tooManyAttempts`) affiché ; toute nouvelle saisie de 6 chiffres NE déclenche PAS `verifyOtp` (bloqué côté client) et réaffiche le message de verrouillage. Seul le renvoi d'un nouveau code (cas 008) réinitialise `attempts`.
- **Critère d'acceptation (OK/KO)** : OK si aucun `POST /auth/verify-otp` n'est émis après le 5e échec et le message de verrouillage est visible ; KO si la vérification continue d'être appelée ou si aucun message de blocage n'apparaît.
- **Données de test** : `phoneNumber = "+33612345678"`, codes `000000`,`111111`,`222222`,`333333`,`444444`, puis `555555`.
- **Durée estimée** : 4 min.

### AUTH-OTP-008 - Champ OTP accessible (TalkBack/VoiceOver + police agrandie + contraste)

- **Type** : Accessibilité
- **Priorité** : P0
- **Pré-conditions** : compte guest, écran OTP ; lecteur d'écran actif ; police système max ; contraste élevé.
- **Étapes** :
  1. Activer TalkBack/VoiceOver.
  2. Balayer vers le champ de code.
  3. Écouter le label, le hint et la valeur annoncée.
  4. Saisir 1 chiffre puis réécouter la valeur ; vérifier que les cellules visuelles restent lisibles à la police max.
- **Résultat attendu** : annonce du label « Verification code, 6 digits », du hint « Enter the code you received by text message. », et de la valeur « 0 of 6 digits entered » (puis « 1 of 6 digits entered » après une frappe). Les cellules pressables sont masquées du lecteur (`accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`) pour éviter le bruit ; seul le champ caché est focusable. Cellules et chiffres restent contrastés (`colors.text` sur `surfaceAlt`).
- **Critère d'acceptation (OK/KO)** : OK si le champ est annoncé avec label + hint + valeur évolutive et que les 6 cellules ne polluent pas la lecture ; KO si chaque cellule est lue séparément, si le label/hint manque, ou si la valeur n'est pas mise à jour.
- **Données de test** : `phoneNumber = "+33612345678"`, saisie `1`.
- **Durée estimée** : 3 min.

### AUTH-OTP-009 - Saisie OTP : robustesse multi-utilisateur / synchro backend

- **Type** : Temps-réel multi-utilisateur
- **Priorité** : P0
- **Pré-conditions** : deux appareils/onglets demandant un OTP pour le MÊME numéro `+33612345678` à quelques secondes d'intervalle ; réseau actif. (Note : pas de WebSocket — on valide ici la cohérence de l'OTP côté backend entre deux demandes concurrentes.)
- **Étapes** :
  1. Appareil A demande un OTP (code A envoyé par SMS).
  2. Appareil B redemande un OTP pour le même numéro peu après (code B envoyé, invalide potentiellement code A selon politique backend).
  3. Sur Appareil A, saisir le code A.
  4. Sur Appareil B, saisir le code B (le plus récent).
- **Résultat attendu** : le backend impose un seul code valide actif (le plus récent). Le code A peut être rejeté (« Code invalide ») si invalidé par la 2e demande ; le code B (le plus récent) est accepté. Aucun état incohérent (pas de double session, pas de crash) sur les deux appareils. La latence réseau ne doit pas créer d'auto-soumission fantôme.
- **Critère d'acceptation (OK/KO)** : OK si exactement un code (le plus récent) valide la session et l'autre est proprement rejeté avec le message d'erreur ; KO si les deux codes valident, si aucun ne valide, ou si un appareil reste bloqué en « Vérification… ».
- **Données de test** : `phoneNumber = "+33612345678"`, code A `100001`, code B `100002`.
- **Durée estimée** : 5 min.

### AUTH-OTP-010 - Renvoyer le code : succès après expiration du compte à rebours

- **Type** : Fonctionnel positif
- **Priorité** : P1
- **Pré-conditions** : compte guest, écran OTP, attendre que le compte à rebours de 60 s atteigne 0, réseau actif.
- **Étapes** :
  1. À l'arrivée, vérifier le texte « Renvoyer dans 1:00 » (non pressable) et l'absence du bouton « Renvoyer le code ».
  2. Attendre que le décompte atteigne 0:00 (ou via fixture/horloge de test).
  3. Vérifier l'apparition du bouton « Renvoyer le code ».
  4. Le taper.
- **Résultat attendu** : tant que `countdown > 0`, seul le texte `resendIn` est visible ; à 0, le bouton pressable « Renvoyer le code » (`auth.otp.resend`) apparaît. Au tap : `requestOtp("+33612345678")` appelé → `POST /auth/send-otp` ; le compte à rebours est réinitialisé à 60 s (`isCounting=true`), `attempts` remis à 0, erreur effacée, champ vidé. Le bouton redevient masqué pendant le nouveau cooldown.
- **Critère d'acceptation (OK/KO)** : OK si un nouveau SMS est demandé et le compteur repart à 1:00 avec les tentatives réinitialisées ; KO si le bouton n'apparaît pas à 0, ne renvoie rien, ou ne réinitialise pas le décompte.
- **Données de test** : `phoneNumber = "+33612345678"`.
- **Durée estimée** : 2 min.

### AUTH-OTP-011 - Renvoyer le code : multi-clic rapide, garde anti-doublon et reconnexion

- **Type** : Erreur/Limite
- **Priorité** : P1
- **Pré-conditions** : compte guest, écran OTP, compte à rebours écoulé (bouton « Renvoyer le code » visible), réseau variable.
- **Étapes** :
  1. Taper 5 fois très rapidement sur « Renvoyer le code ».
  2. Observer le nombre d'appels `requestOtp`.
  3. Avant un nouveau renvoi, couper le réseau, attendre le décompte à 0, taper « Renvoyer le code ».
  4. Réactiver le réseau et retaper après expiration.
- **Résultat attendu** :
  - Le multi-clic ne déclenche `requestOtp` qu'une fois : la garde `if (countdown > 0 || isResending) return` bloque les clics suivants (le 1er renvoi réinitialise immédiatement `countdown=60` + `isResending`).
  - Hors-ligne : `requestOtp` rejette ; l'échec est silencieux côté écran (l'erreur remonte via le store), aucun crash, le compte à rebours N'est PAS réinitialisé (le `setCountdown(60)` est dans le bloc `try` après le `await`, donc non atteint en cas d'échec) → le bouton « Renvoyer » reste disponible pour réessayer.
  - Après reconnexion, un nouveau renvoi réussit normalement.
- **Critère d'acceptation (OK/KO)** : OK si au plus un `POST /auth/send-otp` part par salve de clics et qu'un échec hors-ligne laisse le bouton réessayable sans crash ; KO si plusieurs SMS sont demandés en rafale ou si l'écran se fige/crashe hors-ligne.
- **Données de test** : `phoneNumber = "+33612345678"`.
- **Durée estimée** : 3 min.

### AUTH-OTP-012 - Renvoyer le code accessible (TalkBack/VoiceOver + police agrandie + contraste)

- **Type** : Accessibilité
- **Priorité** : P1
- **Pré-conditions** : compte guest, écran OTP, compte à rebours écoulé (bouton visible) ; lecteur d'écran actif ; police max ; contraste élevé.
- **Étapes** :
  1. Activer TalkBack/VoiceOver.
  2. Pendant le décompte, balayer vers la zone du bas : vérifier l'annonce du texte « Renvoyer dans X:XX » (non actionnable).
  3. Attendre 0:00, balayer à nouveau vers le bouton « Renvoyer le code ».
  4. Double-taper pour activer.
- **Résultat attendu** : pendant le cooldown, le texte `resendIn` est lu mais non annoncé comme bouton. À 0, l'élément est annoncé « Renvoyer le code, bouton » (`accessibilityRole="button"`, `accessibilityLabel = t('auth.otp.resend')`) et activable au double-tap (déclenche le renvoi). Le texte du lien primaire (`text-primary`) reste lisible/contrasté à la police max.
- **Critère d'acceptation (OK/KO)** : OK si le bouton est annoncé comme bouton « Renvoyer le code » et activable, et que le texte de cooldown n'est pas faussement annoncé comme bouton ; KO si non focusable, label manquant, ou texte tronqué à la police max.
- **Données de test** : `phoneNumber = "+33612345678"`.
- **Durée estimée** : 3 min.

### AUTH-OTP-013 - Affichage du numéro masqué et état initial

- **Type** : Fonctionnel positif
- **Priorité** : P2
- **Pré-conditions** : compte guest, navigation vers OTP avec `phoneNumber=+33612345678`, réseau actif.
- **Étapes** :
  1. Arriver sur l'écran.
  2. Lire le titre, le sous-titre numéro masqué, l'état du bouton de renvoi.
- **Résultat attendu** : titre « Entre le code reçu » (`auth.otp.title`) ; sous-titre « Code envoyé au +33 ••• ••• 678 » (`auth.otp.sentTo` + `maskPhone`) ; champ OTP vide auto-focusé ; texte « Renvoyer dans 1:00 » visible, bouton « Renvoyer le code » absent.
- **Critère d'acceptation (OK/KO)** : OK si le numéro est masqué (3 premiers + 3 derniers chiffres seulement) et l'état initial conforme ; KO si le numéro complet fuit, ou si le bouton renvoi est actif d'emblée.
- **Données de test** : `phoneNumber = "+33612345678"` → masque attendu `+33 ••• ••• 678`.
- **Durée estimée** : 1 min.
