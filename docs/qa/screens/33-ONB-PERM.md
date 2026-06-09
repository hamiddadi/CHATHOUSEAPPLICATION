# 33 - Permission notifications (`onboarding`)

## Contexte ecran

- **Route** : `NotificationsPermission` dans l'`OnboardingStack` (`OnboardingNavigator`). Deep link : `onboarding/notifications`. Atteint depuis `InterestSelection` (apres selection des centres d'interet) ; les deux actions de l'ecran mènent vers `SuggestedFollows`.
- **Header** : aucun. Le navigateur d'onboarding est configure avec `headerShown: false` — il n'y a donc **pas de bouton retour ni de bouton fermer** sur cet ecran. La progression est lineaire (avancer uniquement).
- **Roles requis** : utilisateur authentifie en cours d'onboarding. En pratique role `standard` (un compte vient d'etre cree/connecte avant d'arriver ici). Pas d'acces `guest` (l'onboarding suppose une session). Aucun privilege `admin` requis.
- **Fichier** : `src/features/onboarding/screens/NotificationsPermissionScreen/NotificationsPermissionScreen.tsx`.
- **Comportements temps-reel** : aucun flux WebSocket ni LiveKit sur cet ecran. Le bouton « Activer les notifications » declenche en revanche la **chaine push** : prompt de permission OS (via `pushService.getOrRequestToken` → `expo-notifications.requestPermissionsAsync`) puis enregistrement du token cote backend (`POST /push/register` via `pushService.registerWithBackend`). C'est la seule interaction reseau de l'ecran.
- **Pre-conditions globales** :
  - L'enregistrement push est un **no-op silencieux** (aucun prompt OS) dans Expo Go (SDK 53+), sur simulateur/emulateur, sur web, et quand les modules `expo-notifications`/`expo-device` sont absents. Le test du vrai prompt OS exige un **build EAS dev-client ou standalone sur device physique**.
  - L'appel reseau `POST /push/register` est tolerant aux pannes : `.catch(() => undefined)`. Toute erreur (permission refusee, registration KO, reseau coupe) est **avalee** — l'onboarding n'est jamais bloque et on avance toujours vers `SuggestedFollows`.
- **Etats de donnees pertinents** :
  - Permission jamais demandee (premier passage) → le tap « Activer » montre le prompt OS.
  - Permission deja accordee → pas de second prompt, re-POST idempotent du token, on avance.
  - Permission deja refusee (au niveau OS) → pas de prompt re-affiche par le code, token null, pas de POST, on avance quand meme.
  - Hors-ligne / latence → l'enregistrement echoue silencieusement, on avance quand meme.
  - Pas de notion de liste vide / non-lus sur cet ecran (ecran de consentement statique avec 3 puces de benefices en lecture seule).
- **Etat de chargement** : pendant l'enregistrement, l'etat `requesting` passe `true` → le bouton primaire affiche un spinner (`loading`), est desactive (`disabled`), et le lien « Plus tard » est aussi `disabled`.

## Matrice bouton

| #   | Bouton                    | Emplacement                                          | Type                                                      | Locator reel                                                                                                                                                                                                               | Pre-condition                                                                                           | Priorite |
| --- | ------------------------- | ---------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Activer les notifications | Corps - barre d'action bas                           | submit (declenche prompt push OS + `POST /push/register`) | Texte i18n `t('onboarding.notifications.enable')` = « Activer les notifications » / « Enable notifications ». `accessibilityRole="button"`. Pas de testID ni d'accessibilityLabel custom — selection par le label visible. | Session onboarding active. Prompt OS reel uniquement sur build dev-client/standalone + device physique. | P1       |
| 2   | Plus tard                 | Corps - barre d'action bas (sous le bouton primaire) | navigation (skip)                                         | Texte i18n `t('onboarding.notifications.notNow')` = « Plus tard » / « Not now ». `Pressable` avec `accessibilityRole="button"`. Pas de testID.                                                                             | Session onboarding active. Desactive tant que `requesting === true`.                                    | P1       |

> Note : l'ecran ne contient **aucun** autre element actionnable. Les 3 puces de benefices (`onboarding.notifications.benefits.roomsStarted` / `.messages` / `.follows`) et l'icone d'en-tete `notifications-active` sont **purement decoratives** (aucun `onPress`). Il n'y a ni back, ni close, ni lien legal, ni toggle, ni input sur cet ecran.

## Cas de test

### ONB-PERM-001 - Activer : prompt OS accorde et avancee

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding ; build EAS dev-client ou standalone ; device physique (iOS/Android) ; permission notifications jamais demandee ; Wi-Fi stable ; backend joignable.
- **Etapes** :
  1. Parvenir a l'ecran « Reste connecte·e » depuis l'etape de selection des interets.
  2. Verifier l'affichage du titre, du sous-titre et des 3 puces de benefices.
  3. Taper sur « Activer les notifications ».
  4. A l'apparition du prompt systeme iOS/Android, choisir « Autoriser » / « Allow ».
  5. Attendre la fin du chargement du bouton.
- **Resultat attendu** : le bouton passe en etat chargement (spinner) puis l'app navigue vers `SuggestedFollows`. Le token push est recupere via `getExpoPushTokenAsync` et un `POST /push/register` part avec `{ token, platform }` (`ios`/`android`). La permission est ensuite visible comme accordee dans les reglages OS.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran `SuggestedFollows` s'affiche ET qu'une requete `POST /push/register` HTTP 2xx est observee cote reseau/backend. KO si l'app reste bloquee sur l'ecran ou si aucun POST n'est emis malgre la permission accordee.
- **Donnees de test** : compte `qa.standard+onb@chathouse.test` ; payload attendu `{ "token": "ExponentPushToken[xxxxxxxx]", "platform": "android" }`.
- **Duree estimee** : 4 min

### ONB-PERM-002 - Activer : permission refusee / hors-ligne, on avance quand meme

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding ; device physique ; deux sous-scenarios : (a) refuser la permission OS ; (b) couper le reseau (mode avion) avant de taper.
- **Etapes** :
  1. Atteindre l'ecran.
  2. Sous-scenario (a) : taper « Activer les notifications », puis « Ne pas autoriser » / « Don't Allow » dans le prompt OS.
  3. Sous-scenario (b) : activer le mode avion, puis taper « Activer les notifications » (la permission etant accordee, le POST partira mais echouera).
  4. Multi-clic rapide : taper « Activer les notifications » 5 fois en moins d'1 s.
  5. Pendant le chargement, tenter de taper « Plus tard ».
- **Resultat attendu** : dans (a) et (b), aucune erreur visible a l'ecran, aucun toast/alerte ; l'app navigue vers `SuggestedFollows` (l'echec de registration est avale par `.catch`). Au multi-clic, le bouton se desactive (`disabled` durant `requesting`) → un seul `registerWithBackend` est declenche, une seule navigation `navigate('SuggestedFollows')`. « Plus tard » est inactif pendant le chargement (ne declenche pas une seconde navigation).
- **Critere d'acceptation (OK/KO)** : OK si l'onboarding avance toujours sans crash ni double-navigation et qu'aucune erreur n'est exposee a l'utilisateur. KO si l'app crashe, se fige, affiche une erreur, ou navigue deux fois.
- **Donnees de test** : meme compte de test ; pour (b) couper le reseau via mode avion ; verifier au plus un appel `POST /push/register` dans les logs reseau.
- **Duree estimee** : 6 min

### ONB-PERM-003 - Activer : accessibilite (lecteur d'ecran + grande police + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; mode contraste eleve active.
- **Etapes** :
  1. Atteindre l'ecran avec le lecteur d'ecran actif.
  2. Balayer vers la droite pour parcourir : titre, sous-titre, 3 puces de benefices, puis le bouton « Activer les notifications ».
  3. Verifier que le bouton est annonce comme bouton (« Activer les notifications, bouton »).
  4. Double-taper pour l'activer ; pendant le chargement, verifier l'annonce de l'etat occupe/desactive (`accessibilityState busy/disabled`).
  5. Verifier qu'avec la police agrandie le libelle du bouton reste lisible (le `Text` interne est `numberOfLines={1}` — controler qu'il n'est pas tronque de facon illisible) et que le contraste texte/fond respecte un ratio AA.
- **Resultat attendu** : tous les elements sont focalisables et correctement annonces ; le bouton expose role bouton et son etat busy/disabled pendant `requesting` ; la mise en page (CTA + lien « Plus tard ») reste utilisable en grande police ; contraste conforme WCAG AA.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est annonce avec role et libelle, son etat de chargement est verbalise, et le contenu reste lisible/operable en police max + contraste eleve. KO si un element interactif n'est pas focalisable, si l'etat busy n'est pas annonce, ou si le libelle devient illisible.
- **Donnees de test** : reglages OS — police « tres grande » / Dynamic Type XXL ; contraste eleve ON.
- **Duree estimee** : 6 min

### ONB-PERM-004 - Plus tard : skip sans enregistrement

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding ; n'importe quel environnement (Expo Go, simulateur ou device) ; reseau indifferent.
- **Etapes** :
  1. Atteindre l'ecran.
  2. Taper sur « Plus tard ».
- **Resultat attendu** : l'app navigue immediatement vers `SuggestedFollows`. Aucun prompt OS, aucun appel `pushService.registerWithBackend`, aucune requete `POST /push/register`.
- **Critere d'acceptation (OK/KO)** : OK si `SuggestedFollows` s'affiche ET qu'aucune requete `/push/register` n'est emise. KO si un prompt apparait, si un POST part, ou si la navigation n'a pas lieu.
- **Donnees de test** : compte `qa.standard+onb@chathouse.test` ; observer l'absence de tout appel reseau push dans les logs.
- **Duree estimee** : 2 min

### ONB-PERM-005 - Plus tard : multi-clic rapide et etat de chargement concurrent

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding ; environnement indifferent.
- **Etapes** :
  1. Atteindre l'ecran.
  2. Taper « Plus tard » 5 fois en moins d'1 s.
  3. Repeter le scenario en alternant : taper « Activer les notifications » puis, pendant le spinner, marteler « Plus tard ».
- **Resultat attendu** : un seul `navigate('SuggestedFollows')` au total (pas d'empilement de plusieurs ecrans `SuggestedFollows`). Pendant la phase `requesting`, « Plus tard » est `disabled` et ne declenche aucune navigation supplementaire. Aucun crash, pas de double-push de navigation.
- **Critere d'acceptation (OK/KO)** : OK si la pile de navigation ne contient qu'une seule entree `SuggestedFollows` et qu'aucun comportement double n'est observe. KO si plusieurs navigations sont empilees ou si l'app se fige.
- **Donnees de test** : meme compte ; inspecter la pile via les outils React Navigation / logs de `navigate`.
- **Duree estimee** : 3 min

### ONB-PERM-006 - Plus tard : accessibilite (lecteur d'ecran + grande police + contraste)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack/VoiceOver actif ; police systeme au maximum ; contraste eleve active.
- **Etapes** :
  1. Atteindre l'ecran avec le lecteur d'ecran actif.
  2. Naviguer jusqu'au lien « Plus tard » apres le bouton primaire.
  3. Verifier qu'il est annonce comme bouton (`accessibilityRole="button"`) avec son libelle « Plus tard ».
  4. Double-taper pour l'activer.
  5. Verifier en police max que « Plus tard » reste lisible et que sa zone tactile reste suffisante (>= 44 pt avec le `py-sm` du conteneur).
- **Resultat attendu** : le lien « Plus tard » est focalisable, annonce comme bouton, et activable au double-tap → navigation vers `SuggestedFollows`. Le texte (couleur `ink-muted`) conserve un contraste suffisant et reste lisible en grande police.
- **Critere d'acceptation (OK/KO)** : OK si l'element est focalisable, correctement annonce, activable, et lisible avec contraste AA en police max. KO sinon (non focalisable, role manquant, zone tactile trop petite, ou contraste insuffisant).
- **Donnees de test** : reglages OS — police « tres grande » / Dynamic Type XXL ; contraste eleve ON ; verifier le ratio de contraste de la teinte `ink-muted` sur le fond `background`.
- **Duree estimee** : 4 min

### ONB-PERM-007 - Environnement no-op : Expo Go / simulateur (pas de prompt OS)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; app lancee dans **Expo Go** (SDK 53+) ou sur **simulateur** (`Device.isDevice === false`).
- **Etapes** :
  1. Atteindre l'ecran dans Expo Go ou sur simulateur.
  2. Taper « Activer les notifications ».
  3. Observer la console DEV.
- **Resultat attendu** : aucun prompt de permission systeme n'apparait (`getOrRequestToken` retourne `null` apres detection Expo Go / non-device), aucun `POST /push/register`, log info en DEV `[push] skipped — Expo Go detected (use a dev client for remote push)` (cas Expo Go). L'app navigue tout de meme vers `SuggestedFollows`. Le flux n'est jamais bloque.
- **Critere d'acceptation (OK/KO)** : OK si aucun prompt n'apparait, aucun POST push n'est emis, et la navigation vers `SuggestedFollows` a lieu sans blocage ni erreur. KO si l'app tente d'afficher un prompt, log une erreur bloquante, ou se fige.
- **Donnees de test** : meme compte ; environnement Expo Go ou simulateur iOS/Android ; verifier l'absence de requete `/push/register`.
- **Duree estimee** : 3 min
