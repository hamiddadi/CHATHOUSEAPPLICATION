# 35 - Slides de bienvenue (`onboarding`)

## Contexte ecran

- **Fichier** : `src/features/onboarding/screens/WelcomeSlidesScreen/WelcomeSlidesScreen.tsx`
- **Route** : `WelcomeSlides` dans `AuthStackParamList` (pile pre-auth, `AuthNavigator`). Route initiale de la pile si `welcomeStorage.hasSeen()` renvoie `false` ; sinon le navigateur demarre directement sur `Landing`.
- **Roles requis** : aucun (ecran **pre-auth**, accessible en `guest`, avant toute connexion). Les roles `standard` / `admin` ne revoient cet ecran que si le flag AsyncStorage `chathouse.welcomeSlides.completed.v1` est absent (reinstall, vidage du stockage, ou `welcomeStorage.reset()`).
- **Comportements temps-reel** : **AUCUN**. Pas de WebSocket, pas de LiveKit, pas de push, pas d'appel API. Le seul effet de bord est l'ecriture du flag local AsyncStorage via `welcomeStorage.markSeen()` lors de la sortie du flux. L'ecran fonctionne **entierement hors-ligne**.
- **Pre-conditions globales** : application lancee, pile d'authentification montee, i18n charge (FR ou EN). Aucune permission systeme requise (ni micro, ni notif, ni localisation, ni stockage explicite).
- **Etats de donnees pertinents** :
  - Contenu **statique** : 4 slides en dur (`welcome` / `rooms` / `clubs` / `topics`), textes issus de `onboarding.welcome.slides.*`. Pas d'etat "liste vide", "non lus" ni "chargement reseau".
  - **Premiere visite** (flag absent) : l'ecran s'affiche, index = 0.
  - **Deja vu** (flag = `'1'`) : l'ecran n'est normalement pas atteint (navigateur demarre sur `Landing`).
  - **Hors-ligne** : aucun impact fonctionnel ; si `AsyncStorage.setItem` echoue, l'echec est silencieux (catch) et la navigation vers `Landing` a quand meme lieu (le flux finit, le flag pourra simplement etre re-ecrit au prochain lancement).
- **Structure UI** :
  - Header (haut) : bouton **Passer** aligne a droite, masque sur la derniere slide.
  - Corps : `FlatList` horizontale paginee (swipe) affichant les 4 slides (icone `MaterialIcons`, titre, body).
  - Bas : rangee de **points de progression** (`View` non interactifs, purement cosmetiques) + bouton primaire pleine largeur **Suivant** / **Commencer**.

## Matrice bouton

| #   | Bouton                      | Emplacement                          | Type                | Locator reel                                                                                                                                                         | Pre-condition                                                   | Priorite |
| --- | --------------------------- | ------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| 1   | Passer                      | Header (haut droite)                 | navigation          | Texte `t('onboarding.welcome.skip')` = "Passer" (EN "Skip") dans un `Pressable` `accessibilityRole="button"`                                                         | Visible uniquement si **pas** sur la derniere slide (`!isLast`) | P1       |
| 2   | Suivant / Commencer         | Barre d'action (bas, pleine largeur) | submit / navigation | Label `Button` = `t('onboarding.welcome.next')` ("Suivant") sur slides 0-2, `t('onboarding.welcome.start')` ("Commencer") sur slide 3 ; `accessibilityRole="button"` | Toujours present                                                | P1       |
| 3   | Carousel (swipe horizontal) | Corps                                | navigation (geste)  | `FlatList` `horizontal` `pagingEnabled` ; pas de testID, repere par le titre de slide actif `t('onboarding.welcome.slides.<key>.title')`                             | Toujours present                                                | P2       |

> Note : les **points de progression** (dots) sont des `View` sans `onPress` — non interactifs, donc hors matrice. La navigation retour systeme (geste/bouton hardware Android) n'est pas cablee par l'ecran ; sur la derniere slide, la sortie se fait par `replace('Landing')` qui empeche justement le retour-arriere dans les slides.

## Cas de test

### ONB-WELCOME-001 - Passer ferme le flux et marque les slides comme vues

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest (pre-auth), premiere visite (flag `chathouse.welcomeSlides.completed.v1` absent), reseau Wi-Fi, slide 0 (index 0), aucune permission requise
- **Etapes** :
  1. Lancer l'app sur une installation neuve ; verifier que l'ecran "Slides de bienvenue" s'affiche sur la slide 0 (titre "Bienvenue sur Chathouse").
  2. Verifier que le bouton "Passer" est visible en haut a droite.
  3. Taper sur "Passer".
- **Resultat attendu** : `welcomeStorage.markSeen()` est appele une fois (flag AsyncStorage ecrit a `'1'`), puis navigation `replace('Landing')` ; l'ecran de bienvenue est detruit (pas dans la pile retour).
- **Critere d'acceptation (OK/KO)** : OK si l'app affiche l'ecran `Landing` ET que la slide ne reapparait pas via un retour-arriere ; KO sinon.
- **Donnees de test** : flag attendu apres action `chathouse.welcomeSlides.completed.v1 = "1"`
- **Duree estimee** : 2 min

### ONB-WELCOME-002 - Passer : multi-clic rapide et coupure reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest, premiere visite, mode **hors-ligne** (avion), slide 0
- **Etapes** :
  1. Activer le mode avion.
  2. Sur la slide 0, taper **5 fois tres rapidement** sur "Passer" (double/triple tap).
  3. Observer la navigation et les logs (`markSeen`).
- **Resultat attendu** : un seul `replace('Landing')` effectif ; l'ecriture du flag echoue silencieusement si AsyncStorage indisponible mais la navigation aboutit quand meme (echec catch dans `markSeen`). Pas de double navigation ni d'ecran fige, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si exactement un ecran `Landing` est presente et aucune erreur/freeze ; KO si double-push, ecran blanc, ou crash.
- **Donnees de test** : reseau = avion ON ; nb de taps = 5 en < 1 s
- **Duree estimee** : 3 min

### ONB-WELCOME-003 - Passer : lecteur d'ecran, police agrandie, contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte guest, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme = maximale, slide 0
- **Etapes** :
  1. Activer le lecteur d'ecran et la police XXL.
  2. Balayer jusqu'au bouton "Passer".
  3. Ecouter l'annonce ; verifier le contraste du texte gris ("text-ink-muted") sur fond ("bg-background").
  4. Double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Passer, bouton" (role `button` expose) ; le label reste lisible et non tronque a la police max ; le double-tap declenche la sortie vers `Landing`. Le `hitSlop={8}` garantit une cible >= 44pt.
- **Critere d'acceptation (OK/KO)** : OK si role "bouton" annonce, label complet lisible, ratio de contraste >= 4.5:1, action declenchee au double-tap ; KO sinon.
- **Donnees de test** : police = maximale ; outil contraste = analyseur WCAG
- **Duree estimee** : 4 min

### ONB-WELCOME-004 - Suivant fait avancer la slide et les points de progression

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest, premiere visite, reseau Wi-Fi, slide 0
- **Etapes** :
  1. Sur la slide 0 ("Bienvenue sur Chathouse"), verifier que le bouton bas affiche "Suivant".
  2. Taper sur "Suivant".
  3. Verifier que le carousel defile vers la slide 1 ("Rejoins des rooms live") et que le 2e point de progression devient actif.
  4. Taper "Suivant" deux fois de plus pour atteindre la slide 3 ("Choisis ce qui te parle").
- **Resultat attendu** : a chaque tap, `index` augmente, `scrollToIndex` anime le defilement, le point actif suit ; sur la slide 3 le bouton bascule en "Commencer" et le bouton "Passer" disparait du header.
- **Critere d'acceptation (OK/KO)** : OK si chaque tap avance d'exactement une slide, dot synchronise, label = "Commencer" et "Passer" masque sur la derniere ; KO sinon.
- **Donnees de test** : slides ordre = welcome, rooms, clubs, topics
- **Duree estimee** : 3 min

### ONB-WELCOME-005 - Commencer termine le flux

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte guest, premiere visite, reseau Wi-Fi, positionne sur la derniere slide (index 3)
- **Etapes** :
  1. Avancer jusqu'a la slide 3 (3 taps "Suivant" ou swipes).
  2. Verifier que le bouton bas affiche "Commencer" et que "Passer" n'est plus visible.
  3. Taper "Commencer".
- **Resultat attendu** : `welcomeStorage.markSeen()` appele une fois, puis `replace('Landing')`. L'utilisateur arrive sur l'ecran Landing et ne peut pas revenir aux slides.
- **Critere d'acceptation (OK/KO)** : OK si ecran `Landing` affiche, flag ecrit, retour-arriere ne reaffiche pas les slides ; KO sinon.
- **Donnees de test** : flag attendu `chathouse.welcomeSlides.completed.v1 = "1"`
- **Duree estimee** : 2 min

### ONB-WELCOME-006 - Suivant/Commencer : multi-clic rapide et latence

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte guest, premiere visite, reseau 4G avec latence elevee simulee (la nav ne depend pas du reseau, on verifie l'absence de double-action), slide 0
- **Etapes** :
  1. Sur la slide 0, taper **6 fois tres vite** sur "Suivant" (rythme superieur a l'animation de scroll).
  2. Observer l'index final, le label du bouton et l'eventuelle navigation.
  3. Sur la derniere slide, taper "Commencer" **3 fois tres vite**.
- **Resultat attendu** : l'index ne depasse jamais 3 ; arrive a la fin, le 1er tap "Commencer" declenche un unique `replace('Landing')` + un unique `markSeen()`, les taps suivants n'empilent pas d'ecran (l'ecran est deja remplace). Les taps "Suivant" rapides au-dela de la derniere slide aboutissent au plus a une seule sortie. Pas de saut de slide incoherent ni de crash de `scrollToIndex`.
- **Critere d'acceptation (OK/KO)** : OK si un seul ecran `Landing`, `markSeen` non appele plusieurs fois de maniere problematique, aucun crash ni dots desynchronises ; KO sinon.
- **Donnees de test** : nb taps Suivant = 6, taps Commencer = 3 ; latence reseau = 3000 ms (sans effet attendu)
- **Duree estimee** : 4 min

### ONB-WELCOME-007 - Suivant/Commencer : lecteur d'ecran, police agrandie, contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte guest, TalkBack/VoiceOver actif, police systeme maximale, slide 0
- **Etapes** :
  1. Activer le lecteur d'ecran + police XXL.
  2. Balayer jusqu'au bouton primaire bas ; ecouter l'annonce.
  3. Verifier que le label "Suivant" n'est pas tronque (le `Text` a `numberOfLines={1}` — controler qu'il reste lisible a police max, sans coupure abusive).
  4. Double-taper pour avancer ; repeter jusqu'a la slide 3 et verifier que l'annonce devient "Commencer".
  5. Verifier le contraste du label (variante `primary`) sur le fond du bouton.
- **Resultat attendu** : annonce "Suivant, bouton" puis "Commencer, bouton" ; role `button` et `accessibilityState` corrects (non disabled, non busy) ; label lisible a police max ; double-tap fonctionne ; contraste conforme. Le haptique leger au press-in ne perturbe pas l'usage lecteur d'ecran.
- **Critere d'acceptation (OK/KO)** : OK si role + label annonces, label non illisible a police max, contraste >= 4.5:1, action au double-tap ; KO sinon.
- **Donnees de test** : police = maximale ; variantes a verifier : "Suivant" et "Commencer"
- **Duree estimee** : 4 min

### ONB-WELCOME-008 - Carousel : swipe horizontal synchronise les points de progression

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte guest, premiere visite, reseau Wi-Fi, slide 0
- **Etapes** :
  1. Sur la slide 0, swiper de droite a gauche pour passer a la slide 1.
  2. Laisser l'inertie se terminer (declenche `onMomentumScrollEnd`).
  3. Verifier que le point de progression actif passe au 2e et que le titre affiche "Rejoins des rooms live".
  4. Swiper jusqu'a la slide 3 et verifier que "Passer" disparait et que le bouton affiche "Commencer".
- **Resultat attendu** : `onMomentumScrollEnd` recalcule `index = round(offsetX / largeur)` ; les dots et le label du bouton restent coherents avec la position swipee (parite swipe <-> bouton).
- **Critere d'acceptation (OK/KO)** : OK si dots + label suivent le swipe et que la derniere slide masque "Passer" / affiche "Commencer" ; KO si desynchronisation entre swipe et dots/bouton.
- **Donnees de test** : 3 swipes successifs gauche ; largeur fenetre = `Dimensions.get('window').width`
- **Duree estimee** : 3 min

### ONB-WELCOME-009 - Carousel : swipe partiel, rebond et swipe arriere

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte guest, premiere visite, hors-ligne (avion), slide 1
- **Etapes** :
  1. Sur la slide 1, faire un **swipe partiel** (relacher avant la moitie) pour declencher un rebond sur la meme slide.
  2. Verifier que l'index reste 1 (dot inchange).
  3. Tenter un swipe vers la gauche au-dela de la slide 0 (rebord) puis vers la droite au-dela de la slide 3 (rebord) : le `pagingEnabled` doit borner aux extremites.
  4. Mixer un swipe arriere (slide 3 -> 2) puis verifier que "Suivant" reapparait et "Passer" redevient visible.
- **Resultat attendu** : aucun depassement d'index (<0 ou >3) ; rebond aux extremites ; revenir d'une derniere slide reaffiche "Passer" dans le header et "Suivant" sur le bouton. Aucun crash hors-ligne (aucun appel reseau).
- **Critere d'acceptation (OK/KO)** : OK si index borne [0..3], dots/label/Passer coherents apres swipe arriere, pas de crash ; KO sinon.
- **Donnees de test** : reseau = avion ON ; swipe partiel < 50% largeur
- **Duree estimee** : 4 min

### ONB-WELCOME-010 - Carousel : lecteur d'ecran, police agrandie, contraste des slides

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte guest, TalkBack/VoiceOver actif, police systeme maximale, slide 0
- **Etapes** :
  1. Activer le lecteur d'ecran + police XXL.
  2. Balayer dans le corps : verifier que le titre (`text-display`) et le body (`text-ink-muted`) de la slide active sont lus dans l'ordre.
  3. Verifier que le texte agrandi n'est pas coupe / chevauchant (titres centres, body limite a `max-w-xs`).
  4. Verifier le contraste titre (text-ink) et body (text-ink-muted) sur le fond ; verifier que l'icone decorative `MaterialIcons` n'est pas annoncee comme element actionnable.
  5. Naviguer entre slides via le geste d'exploration / swipe a 3 doigts du lecteur d'ecran.
- **Resultat attendu** : titre + body annonces correctement, icone non focusable/decorative, contenu lisible et non tronque a police max, contraste body conforme (point de vigilance sur `text-ink-muted`).
- **Critere d'acceptation (OK/KO)** : OK si lecture ordonnee titre->body, icone non actionnable, lisibilite a police max, contraste >= 4.5:1 (titre) / >= 3:1 (texte large) ; KO sinon.
- **Donnees de test** : police = maximale ; slides a controler : les 4 (welcome/rooms/clubs/topics)
- **Duree estimee** : 5 min

### ONB-WELCOME-011 - Re-entree apres completion (flag deja pose)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte guest, flag `chathouse.welcomeSlides.completed.v1 = "1"` deja present (slides deja vues lors d'une session precedente), reseau Wi-Fi
- **Etapes** :
  1. Terminer le flux une premiere fois (cas 005) pour poser le flag.
  2. Tuer puis relancer l'application.
  3. Observer l'ecran initial de la pile pre-auth.
- **Resultat attendu** : `AuthNavigator` lit `welcomeStorage.hasSeen()` = `true` et demarre directement sur `Landing` ; les slides de bienvenue **ne s'affichent pas**. (Si la lecture du flag rejette, le fallback est aussi `Landing`.)
- **Critere d'acceptation (OK/KO)** : OK si l'app ouvre `Landing` sans repasser par les slides ; KO si les slides reapparaissent malgre le flag pose.
- **Donnees de test** : flag pre-positionne = `"1"` ; verifier aussi le fallback en corrompant la valeur (ex: `"x"`) qui doit reafficher les slides
- **Duree estimee** : 3 min
