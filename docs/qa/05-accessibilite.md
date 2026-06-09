# 05 - Checklist d'accessibilite + procedures lecteur d'ecran (ChatHouse)

> Perimetre : 50 ecrans, 381 boutons, app audio live (React Native / Expo, temps-reel WebSocket + audio LiveKit), roles guest/standard/admin, Android + iOS (OS recents et anciens), reseaux 3G/4G/5G/Wi-Fi.
> Reference WCAG : **WCAG 2.1 / 2.2 niveau AA**, applique au mobile natif (mapping `accessibilityRole` / `accessibilityLabel` / `accessibilityState` / live regions).
> Convention de l'app deja en place : labels a11y via `t()` (i18n FR/EN), `accessibilityState` `selected` / `checked` / `disabled`, tests qui ciblent par `getByLabelText`. Cette doc s'aligne sur ces conventions reelles.

---

## 0. Comment utiliser ce document

1. **Checklist WCAG mobile** (section 1) : grille de conformite a passer ecran par ecran. Chaque ligne = un critere verifiable, avec le mapping React Native correspondant.
2. **Procedures pas-a-pas TalkBack / VoiceOver** (sections 2 et 3) : activation, navigation au swipe, double-tap, rotor/menus de lecture par element.
3. **Cas de test A11Y-NNN reutilisables** (section 4) : a appliquer sur n'importe quel bouton parmi les 381, en remplacant `<LABEL>` par le label reel de la matrice bouton de l'ecran (fichiers `docs/qa/screens/NN-*.md`).
4. **Verification i18n FR/EN** (section 5).
5. **Outils** (section 6) : Accessibility Scanner (Android), Accessibility Inspector (Xcode/iOS).

Priorites : **P0** = bloquant (audio live : micro, main levee, quitter, fermer la room) ; **P1** = important ; **P2** = confort.

---

## 1. Checklist WCAG mobile applicable

Cocher `[x]` quand verifie. Colonne "Mapping RN" = ce que le testeur/dev doit trouver dans le code ou via l'inspecteur.

### 1.1 Labels (noms accessibles) — WCAG 1.1.1, 4.1.2

| #   | Critere                                                                                                                                | Mapping RN                                                                                                 | OK  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --- |
| L1  | Tout element interactif (bouton, lien, onglet, champ) a un nom accessible non vide                                                     | `accessibilityLabel` (souvent `t('cle.xxxA11y')`) ou texte enfant lisible                                  | [ ] |
| L2  | Les boutons icone-seule (micro, partage, retour, flag, more) ont un label explicite, pas juste l'icone                                 | `accessibilityLabel={t('...A11y')}` present (ex. `room.muteA11y`, `chat.backA11y`)                         | [ ] |
| L3  | Le label decrit l'**action/etat courant**, pas l'icone (ex. "Couper le micro" et non "icone micro")                                    | label = verbe d'action localise                                                                            | [ ] |
| L4  | Les labels interpolent les donnees dynamiques (nom, titre)                                                                             | `t('room.profileA11y', { name })` -> "Profil de Sam"                                                       | [ ] |
| L5  | Les elements purement decoratifs ne sont PAS focalisables (emoji flottant, badge "speaking" graphic-eq, ring vert, avatars decoratifs) | `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"` / `pointerEvents="none"` | [ ] |
| L6  | Pas de label redondant qui double le texte visible deja lu (eviter "bouton bouton Quitter")                                            | label != "button" + texte identique inutile                                                                | [ ] |
| L7  | Le label visible court et le label a11y etendu sont coherents (ex. visible "Quitter" / a11y "Quitter discretement")                    | `accessibilityLabel` contient le texte visible ou son intention                                            | [ ] |

### 1.2 Roles — WCAG 1.3.1, 4.1.2

| #   | Critere                                                                                                                               | Mapping RN                                                                                                                              | OK  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --- |
| R1  | Chaque controle expose le bon role                                                                                                    | `accessibilityRole="button" \| "link" \| "tab" \| "header" \| "search" \| "image" \| "switch" \| "checkbox" \| "alert" \| "adjustable"` | [ ] |
| R2  | Les titres de section/ecran sont annonces comme en-tetes                                                                              | `accessibilityRole="header"` (ex. titre de room non editable cote listener)                                                             | [ ] |
| R3  | Les onglets (bottom tabs, segmented "Houses/Decouvrir") exposent `tab`                                                                | `accessibilityRole="tab"` (ex. `HouseListScreen`)                                                                                       | [ ] |
| R4  | Un element qui change de role selon le contexte le fait correctement (titre de room : `header` pour listener, `button` pour host/mod) | role conditionne au role utilisateur                                                                                                    | [ ] |
| R5  | Les bannieres temps-reel (statut audio, offline, erreur) ont role alerte                                                              | `accessibilityRole="alert"`                                                                                                             | [ ] |
| R6  | Les bascules on/off exposent un role adapte (switch/checkbox) plutot qu'un simple bouton quand c'est un reglage                       | `accessibilityRole="switch"` + `accessibilityState.checked`                                                                             | [ ] |

### 1.3 Etats — WCAG 4.1.2

| #   | Critere                                                                                    | Mapping RN                                                                                 | OK  |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --- |
| E1  | L'etat coche/selectionne est annonce (micro mute, main levee, onglet actif, filtre actif)  | `accessibilityState={{ selected: true }}` (ex. `isMuted`, `isHandRaised`)                  | [ ] |
| E2  | L'etat coche d'un reglage est annonce                                                      | `accessibilityState={{ checked: true \| false }}`                                          | [ ] |
| E3  | Un bouton desactive est annonce "grise / non disponible" et non focalisable comme actif    | `accessibilityState={{ disabled: true }}` + `disabled` prop                                | [ ] |
| E4  | Un element occupe/chargement est signale                                                   | `accessibilityState={{ busy: true }}` ou live-region "Chargement…" (`common.loading`)      | [ ] |
| E5  | Le changement d'etat est re-annonce apres action (apres double-tap, le nouvel etat est lu) | label/state pilotes par le state React (re-render)                                         | [ ] |
| E6  | Un element extensible (bio repliable) expose son etat                                      | `accessibilityState={{ expanded: true \| false }}` (ex. `expandBioA11y`/`collapseBioA11y`) | [ ] |

### 1.4 Ordre de focus & navigation — WCAG 1.3.2, 2.4.3, 2.4.7, 3.2.1, 3.2.2

| #   | Critere                                                                                                                                   | Mapping RN                                                                                                        | OK  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --- |
| F1  | L'ordre de lecture suit l'ordre logique/visuel (haut -> bas, gauche -> droite ; header -> contenu -> barre d'action)                      | ordre du JSX / `accessibilityElementsHidden` sur overlays masques                                                 | [ ] |
| F2  | A l'ouverture d'une modale / feuille (sheet) / sidebar, le focus se deplace dedans                                                        | focus deplace ; `accessibilityViewIsModal` (iOS) sur le conteneur                                                 | [ ] |
| F3  | A la fermeture d'une modale, le focus revient sur l'element declencheur                                                                   | retour de focus gere                                                                                              | [ ] |
| F4  | Le contenu derriere une modale/overlay n'est plus focalisable                                                                             | `accessibilityViewIsModal` (iOS) / `importantForAccessibility="no-hide-descendants"` (Android) sur l'arriere-plan | [ ] |
| F5  | Aucun piege de focus (on peut toujours sortir d'un composant)                                                                             | pas de boucle ; bouton fermer atteignable                                                                         | [ ] |
| F6  | Le focus n'est pas perturbe par les mises a jour temps-reel (nouveau participant, reaction) : le focus de l'utilisateur reste ou il etait | pas de re-mount qui vole le focus ; nouveautes annoncees en live-region polite (cf. 1.7)                          | [ ] |
| F7  | Pas de changement de contexte automatique non sollicite (un champ qui valide tout seul, une navigation auto au focus)                     | actions sur double-tap explicite uniquement                                                                       | [ ] |

### 1.5 Taille de cible — WCAG 2.5.5 (AAA 44px) / 2.5.8 (AA 24px)

| #   | Critere                                                                                                                         | Mapping RN                                                                                                 | OK  |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --- |
| T1  | Toute cible tactile fait **>= 44 x 44 pt** (cible interne)                                                                      | `minHeight: 44` / `minWidth: 44` (ex. lignes admin) **ou** icone ~36px + `hitSlop={8}` (= 36 + 2x8 = 52pt) | [ ] |
| T2  | Les boutons icone du header (retour, partage, chat, flag, more, marquer-tout-lu) ont un `hitSlop` >= 8                          | `hitSlop={8}` (RoomScreen, Notifications, Explore, Avatar, RoomMiniBar)                                    | [ ] |
| T3  | Les cibles voisines ne se chevauchent pas (espacement suffisant entre boutons de la barre d'action / grille avatars)            | `gap` / `spacing` entre slots ; grille 5 colonnes                                                          | [ ] |
| T4  | Les petites pastilles (compteur badge, "+N") ne sont pas des cibles tactiles seules ; l'action est portee par un parent >= 44pt | badge decoratif, parent pressable                                                                          | [ ] |

### 1.6 Contraste & couleur — WCAG 1.4.1, 1.4.3, 1.4.11

| #   | Critere                                                                                                    | Mapping RN                                                                                                                                                 | OK  |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| C1  | Texte normal : ratio **>= 4.5:1** sur fond                                                                 | thema dark M3, fond `#0c112e`, texte `#dee0ff` (ratio ~13:1, OK)                                                                                           | [ ] |
| C2  | Texte large (>= 18pt bold / 24pt) : ratio **>= 3:1**                                                       | titres sur surfaces sombres                                                                                                                                | [ ] |
| C3  | Composants UI et icones porteuses d'info : ratio **>= 3:1** (1.4.11)                                       | icones primary `#b0c6ff`, danger `#ffb4ab`, warning `#ffd700` sur fond navy                                                                                | [ ] |
| C4  | **Aucune information portee par la couleur seule** : un etat n'est jamais signale uniquement par la teinte | mute = icone `mic-off` + couleur danger + `accessibilityState.selected` ; "speaking" = ring vert + badge `graphic-eq` (mais l'audio reste l'info primaire) | [ ] |
| C5  | L'etat actif/inactif d'un onglet/filtre ne repose pas que sur la couleur                                   | + `accessibilityState.selected` + libelle                                                                                                                  | [ ] |
| C6  | Les erreurs de formulaire ne sont pas signalees que par du rouge                                           | texte d'erreur + `accessibilityLiveRegion` (ex. OtpScreen `assertive`)                                                                                     | [ ] |
| C7  | Le texte danger (rouge `#ffb4ab`) reste lisible sur les fonds `bg-danger/10` des bannieres                 | verifier ratio sur le fond translucide reel                                                                                                                | [ ] |

> Note thema : l'app est **mono-dark assumee** (pas de theme clair). Le contraste se valide donc sur le fond navy `#0c112e` uniquement. Verifier surtout les textes muted (`textMuted #c2c6d7`, `textDim #A0AEC0`) et les textes sur fonds translucides (`/10`, `/90`).

### 1.7 Dynamic Type / police agrandie 200% — WCAG 1.4.4, 1.4.10

| #   | Critere                                                                                                                                            | Mapping RN                               | OK  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --- |
| D1  | A **200%** de taille de police systeme, aucun texte tronque/coupe de maniere a perdre du sens                                                      | tester avec Reglages OS (cf. 6.3)        | [ ] |
| D2  | Les labels mono-ligne (`numberOfLines={1}`) tronquent proprement (ellipsis) sans casser la mise en page (ex. barre d'action room, cellules grille) | layout flex stable, pas d'overlap        | [ ] |
| D3  | Pas de scroll horizontal force par l'agrandissement (reflow vertical)                                                                              | conteneurs `flex-wrap` / scroll vertical | [ ] |
| D4  | Les cibles tactiles restent >= 44pt meme en grande police                                                                                          | hitSlop / minHeight inchanges            | [ ] |
| D5  | Le contenu critique (boutons audio P0) reste atteignable et lisible a 200%                                                                         | barre d'action visible, non clippee      | [ ] |

### 1.8 Annonces temps-reel (live regions) — WCAG 4.1.3

| #   | Critere                                                                                                                                           | Mapping RN                                                                                                                | OK  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --- |
| LR1 | Le statut audio (connecting / reconnecting / error / unsupported) est annonce automatiquement                                                     | banniere `accessibilityRole="alert"` + `accessibilityLiveRegion={status==='error' ? 'assertive' : 'polite'}` (RoomScreen) | [ ] |
| LR2 | La perte/retour de connexion reseau est annoncee                                                                                                  | `OfflineBanner` / `SocketStatusBanner` : `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"`                 | [ ] |
| LR3 | Les toasts (succes/erreur/info) sont annonces sans voler le focus                                                                                 | `Toast` : `accessibilityRole="alert"`, label `"<tone>: <message>"`                                                        | [ ] |
| LR4 | Les erreurs de saisie (OTP) sont annoncees                                                                                                        | `accessibilityLiveRegion="assertive"` sur le message d'erreur                                                             | [ ] |
| LR5 | Les ecrans de chargement annoncent l'etat                                                                                                         | `Loader` : `accessibilityLiveRegion="polite"`, label `common.loading` ("Chargement… / Loading…")                          | [ ] |
| LR6 | L'arrivee d'un nouveau message / participant / main levee est annoncee de facon non intrusive (polite) sans interrompre la parole en cours        | live-region polite OU `AccessibilityInfo.announceForAccessibility(...)` (a verifier/cabler par ecran)                     | [ ] |
| LR7 | Les erreurs critiques (ErrorBoundary, impersonation admin) sont annoncees fermement                                                               | `accessibilityLiveRegion="assertive"` (ErrorBoundary), `polite` (ImpersonationBanner)                                     | [ ] |
| LR8 | Les annonces live ne se repetent pas en boucle (anti-spam : reaction emoji throttle, floats plafonnes) ne genere PAS d'annonce par emoji flottant | emojis flottants `pointerEvents="none"`, non focalisables, non annonces                                                   | [ ] |

---

## 2. Procedure pas-a-pas TalkBack (Android)

### 2.1 Activation

1. **Reglages** > **Accessibilite** > **TalkBack** > activer l'interrupteur. (Raccourci possible : maintenir les 2 boutons de volume 3 s, si configure.)
2. Confirmer le dialogue d'autorisation. TalkBack lit alors chaque element focalise.
3. Pour quitter en cours de test : meme chemin, ou raccourci volumes.
4. **Astuce build** : l'audio reel necessite un **build EAS dev-client** (LiveKit = module natif, pas Expo Go). Sur Expo Go, la banniere "audio non supporte" s'affiche ; l'accessibilite UI reste testable, mais les cas P0 audio (LR1, mute) doivent etre repasses sur dev-client.

### 2.2 Gestes de navigation de base

| Geste                                                      | Action                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Balayer a droite** (1 doigt)                             | Element suivant                                                                   |
| **Balayer a gauche** (1 doigt)                             | Element precedent                                                                 |
| **Toucher** un element                                     | Le focaliser et l'entendre annonce (pas d'activation)                             |
| **Double-tap** (n'importe ou)                              | Activer l'element focalise (= "appui" pour un voyant)                             |
| **Double-tap maintenu**                                    | Equivalent appui long                                                             |
| **Balayer haut-puis-bas / bas-puis-haut** (menus du rotor) | Changer la granularite de lecture (caracteres, mots, lignes, controles, en-tetes) |
| **Balayer a 2 doigts**                                     | Defiler la liste/page                                                             |
| **Balayer vers le haut depuis le bas** (geste systeme)     | Revenir / accueil selon config                                                    |
| **Balayer a gauche-puis-haut (L)**                         | Ouvrir le menu global TalkBack                                                    |

### 2.3 Lecture par element / par type (menu TalkBack & granularite)

1. Pour **naviguer par type d'element** : balayer haut-puis-bas pour cycler la granularite jusqu'a **"Controles"**, **"En-tetes"** ou **"Liens"**, puis balayer droite/gauche pour sauter d'un controle/en-tete a l'autre.
2. Verifier qu'on peut atteindre **uniquement les en-tetes** (R2) pour scanner la structure d'un ecran (ex. sauter de "SCENE" a "Main levee" a "Autres" dans la room).
3. Verifier qu'en granularite "Controles" on atteint chaque bouton de la matrice bouton de l'ecran (aucun bouton injoignable, aucun decoratif parasite).

### 2.4 Procedure de validation par ecran (TalkBack)

1. Ouvrir l'ecran (voir `docs/qa/screens/NN-*.md` pour le contexte et la matrice bouton).
2. Mettre le focus en haut a gauche, **balayer a droite** element par element jusqu'en bas.
3. Pour chaque element : noter l'annonce (nom + role + etat), confirmer qu'elle correspond a la colonne "Locator reel" du fichier ecran.
4. **Double-tap** sur chaque bouton P0/P1 : verifier l'action ET la re-annonce de l'etat (E5).
5. Verifier l'ordre de focus (F1), les modales/sheets (F2-F4), et les annonces live (section 1.8) en provoquant un evenement temps-reel.

---

## 3. Procedure pas-a-pas VoiceOver (iOS)

### 3.1 Activation

1. **Reglages** > **Accessibilite** > **VoiceOver** > activer. (Recommande : configurer le **triple-clic du bouton lateral/Home** comme raccourci d'accessibilite pour activer/desactiver vite pendant les tests.)
2. VoiceOver lit l'element selectionne (cadre noir autour).
3. **Astuce build** : meme contrainte LiveKit que TalkBack — audio reel = build dev-client, pas Expo Go.

### 3.2 Gestes de navigation de base

| Geste                                 | Action                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Balayer a droite** (1 doigt)        | Element suivant                                                                              |
| **Balayer a gauche** (1 doigt)        | Element precedent                                                                            |
| **Toucher**                           | Selectionner et entendre l'element                                                           |
| **Double-tap** (n'importe ou)         | Activer l'element selectionne                                                                |
| **Double-tap maintenu**               | Appui long                                                                                   |
| **Balayer a 3 doigts**                | Defiler                                                                                      |
| **Balayer a 2 doigts vers le bas**    | "Lire tout" a partir de la selection                                                         |
| **Tracer un "Z" a 2 doigts (scrub)**  | Retour / annuler / fermer                                                                    |
| **Double-tap a 2 doigts (magic tap)** | Action principale contextuelle (ex. play/pause, raccrocher) — verifier le comportement audio |

### 3.3 Rotor VoiceOver (lecture par element)

1. **Tourner 2 doigts** sur l'ecran (geste de bouton rotatif) pour ouvrir le **rotor**.
2. Choisir une categorie : **En-tetes**, **Liens**, **Boutons**, **Champs de formulaire**, **Mots/Caracteres**, **Elements** statiques, etc.
3. Une fois une categorie choisie, **balayer haut/bas** (1 doigt) pour sauter d'un element de ce type au suivant.
4. Verifications :
   - Categorie **"En-tetes"** : la structure de l'ecran est navigable (R2/F1).
   - Categorie **"Boutons"** : tous les controles de la matrice bouton sont atteignables et nommes.
   - Categorie **"Champs de formulaire"** : chaque input a un nom (L1) et son etat (E2/E3).
5. Pour un element **ajustable** (slider de volume, stepper) : selectionner puis **balayer haut/bas** pour incrementer/decrementer (`accessibilityRole="adjustable"`).

### 3.4 Procedure de validation par ecran (VoiceOver)

1. Ouvrir l'ecran, selectionner le 1er element, **balayer a droite** jusqu'au dernier.
2. Comparer chaque annonce a la matrice bouton (`docs/qa/screens/NN-*.md`).
3. Utiliser le **rotor > Boutons** pour verifier l'exhaustivite (aucun bouton manquant/decoratif parasite).
4. **Double-tap** sur les P0/P1 ; verifier action + re-annonce d'etat.
5. Provoquer un evenement temps-reel : verifier l'annonce (alerte audio = interruption immediate en `assertive` si erreur, sinon `polite`).
6. Verifier le retour de focus apres fermeture des feuilles (HostActionsSheet, ProfileActionSheet, RoomControlsSheet, TitleEditModal, RoomChatSidebar).

---

## 4. Cas de test accessibilite types (A11Y-NNN) reutilisables

> **Mode d'emploi** : ces cas sont **generiques et parametres**. Pour chaque bouton parmi les 381, instancier le cas pertinent en remplacant `<LABEL_FR>` / `<LABEL_EN>` par les valeurs reelles de la matrice bouton de l'ecran. Repasser systematiquement A11Y-001/002/003 sur chaque bouton P0/P1. Lecteur = TalkBack (Android) **et** VoiceOver (iOS), sauf mention contraire.

### A11Y-001 - Label de bouton annonce correctement

- **Type** : Accessibilite | **Priorite** : P1 (P0 si bouton audio)
- **Pre-conditions** : lecteur d'ecran actif, ecran charge, langue de l'app connue.
- **Etapes** :
  1. Balayer (TalkBack) / rotor Boutons (VoiceOver) jusqu'au bouton cible.
  2. Ecouter l'annonce.
- **Resultat attendu** : le lecteur annonce **`<LABEL>`** + role **"bouton"** (ex. "Couper le micro, bouton"). Le label provient de `t('...A11y')` ; aucune annonce du type "bouton" sans nom, ni du nom d'icone brut.
- **Critere OK/KO** : OK si nom + role vocalises ; KO si "bouton" seul, nom d'icone, ou silence.
- **Duree** : 2 min/bouton

### A11Y-002 - Etat annonce (mute / main levee / selectionne)

- **Type** : Accessibilite | **Priorite** : P0
- **Pre-conditions** : lecteur actif ; bouton a etat (micro, main levee, onglet, filtre).
- **Etapes** :
  1. Focaliser le bouton micro (label `room.muteA11y` / `room.unmuteA11y`).
  2. Ecouter l'etat initial.
  3. Double-tap.
  4. Re-focaliser et re-ecouter.
- **Resultat attendu** : l'etat est annonce (`accessibilityState.selected`) : micro coupe -> "selectionne / coche / active" + label "Reactiver le micro"; apres double-tap, le **nouvel etat** est lu (label bascule "Couper le micro", selected=false). Idem main levee (`room.raiseA11y`/`lowerA11y`, selected = `isHandRaised`).
- **Critere OK/KO** : OK si l'etat ET sa bascule sont vocalises ; KO si l'etat n'est jamais annonce ou ne change pas apres action.
- **Duree** : 3 min

### A11Y-003 - Bouton desactive annonce "grise / non disponible"

- **Type** : Accessibilite | **Priorite** : P1
- **Pre-conditions** : ecran ou un bouton est desactive (ex. "Envoyer" champ vide, titre de room non editable pour un listener, submit pendant chargement).
- **Etapes** :
  1. Focaliser le bouton desactive.
  2. Ecouter ; tenter un double-tap.
- **Resultat attendu** : annonce "**desactive / non disponible / grise**" (`accessibilityState.disabled = true`) ; le double-tap ne declenche aucune action. Cas titre listener : annonce en role **header** non actionnable (pas "bouton").
- **Critere OK/KO** : OK si "desactive" vocalise et aucune action ; KO si annonce comme actif ou si l'action se declenche.
- **Duree** : 3 min

### A11Y-004 - Ordre de focus apres navigation / ouverture de feuille

- **Type** : Accessibilite | **Priorite** : P1
- **Pre-conditions** : lecteur actif ; ecran avec modale/sheet/sidebar (HostActionsSheet, ProfileActionSheet, RoomControlsSheet, TitleEditModal, RoomChatSidebar, CountryPicker).
- **Etapes** :
  1. Focaliser le declencheur, double-tap pour ouvrir.
  2. Verifier ou se pose le focus.
  3. Tenter de balayer vers l'arriere-plan.
  4. Fermer (bouton fermer / scrub iOS / retour) et verifier le focus de retour.
- **Resultat attendu** : a l'ouverture le focus entre **dans** la feuille (F2) ; l'arriere-plan n'est PAS atteignable (F4, `accessibilityViewIsModal` iOS / `no-hide-descendants` Android) ; a la fermeture, le focus revient sur le declencheur (F3). Aucun piege (F5).
- **Critere OK/KO** : OK si focus entre/sort proprement et arriere-plan inerte ; KO si focus reste derriere la feuille ou se perd.
- **Duree** : 5 min

### A11Y-005 - Annonce d'un nouveau message / nouveau participant (live region)

- **Type** : Accessibilite temps-reel | **Priorite** : P1 (P0 pour statut audio)
- **Pre-conditions** : 2 devices (ou simulateur d'evenement socket) ; lecteur actif sur le device observe ; reseau actif.
- **Etapes** :
  1. Poser le focus sur un element stable (ex. titre de la room).
  2. Depuis l'autre device, declencher l'evenement : nouveau message chat / nouveau participant / nouvelle main levee / reaction.
  3. Ecouter sans toucher l'ecran.
- **Resultat attendu** : l'evenement est **annonce automatiquement** en **polite** (n'interrompt pas la parole en cours, ne vole pas le focus, LR6). Le **statut audio en erreur** s'annonce en **assertive** (interruption immediate, LR1). Les emojis flottants ne generent **aucune** annonce (LR8). Le focus de l'utilisateur ne bouge pas (F6).
- **Critere OK/KO** : OK si l'evenement est entendu sans perte de focus et avec la bonne urgence (polite vs assertive) ; KO si silence, vol de focus, ou spam d'annonces.
- **Duree** : 5 min

### A11Y-006 - Annonce de perte/retour reseau et reconnexion audio

- **Type** : Accessibilite temps-reel | **Priorite** : P0
- **Pre-conditions** : en room live, lecteur actif, possibilite de couper le reseau.
- **Etapes** :
  1. Couper le reseau.
  2. Ecouter la banniere.
  3. Retablir le reseau.
- **Resultat attendu** : "Reconnexion audio… / Reconnecting audio…" (`room.audioReconnecting`) annonce en live-region polite ; `OfflineBanner`/`SocketStatusBanner` annoncent la perte en alerte ; au retour, l'etat live revient et la banniere disparait. Le mute est conserve (pas de hot-unmute).
- **Critere OK/KO** : OK si transitions annoncees et mute conserve ; KO si silence ou unmute silencieux.
- **Duree** : 5 min

### A11Y-007 - Taille de cible et espacement (>= 44pt)

- **Type** : Accessibilite | **Priorite** : P1
- **Pre-conditions** : Accessibility Scanner (Android) ou inspection visuelle/Inspector (iOS).
- **Etapes** :
  1. Lancer Accessibility Scanner sur l'ecran.
  2. Relever les avertissements "Touch target size" et "Item spacing".
  3. Verifier les boutons icone (hitSlop) et lignes de liste (minHeight).
- **Resultat attendu** : chaque cible >= 44 x 44 pt (icone ~36px + `hitSlop={8}` = 52pt, ou `minHeight: 44`) ; pas de chevauchement entre cibles voisines (T3).
- **Critere OK/KO** : OK si 0 avertissement de taille/espacement bloquant ; KO sinon.
- **Duree** : 4 min/ecran

### A11Y-008 - Contraste & info non portee par la couleur seule

- **Type** : Accessibilite | **Priorite** : P1
- **Pre-conditions** : Accessibility Scanner / verificateur de contraste.
- **Etapes** :
  1. Scanner l'ecran (Scanner) pour les avertissements de contraste.
  2. Verifier les textes muted et sur fonds translucides (`/10`, `/90`).
  3. Pour chaque etat signale visuellement (mute danger, speaking vert, onglet actif), couper mentalement la couleur : l'info reste-t-elle ?
- **Resultat attendu** : texte normal >= 4.5:1, large/icones >= 3:1 (C1-C3) ; chaque etat dispose d'un signal **non chromatique** (icone differente + `accessibilityState`, libelle, badge), conformement a C4/C5/C6.
- **Critere OK/KO** : OK si ratios atteints et aucun etat uniquement chromatique ; KO sinon.
- **Duree** : 5 min/ecran

### A11Y-009 - Police agrandie 200% (Dynamic Type)

- **Type** : Accessibilite | **Priorite** : P1
- **Pre-conditions** : taille de police systeme au max (cf. 6.3).
- **Etapes** :
  1. Regler la police OS au maximum (200% / "Texte plus grand" + tailles d'accessibilite iOS).
  2. Parcourir l'ecran ; observer troncatures, chevauchements, scroll.
  3. Verifier la barre d'action room (P0) et les cellules de grille.
- **Resultat attendu** : aucun texte critique perdu (D1) ; troncature mono-ligne propre avec ellipsis (D2) ; reflow vertical sans scroll horizontal (D3) ; cibles toujours >= 44pt (D4) ; boutons audio toujours atteignables (D5).
- **Critere OK/KO** : OK si lisible et utilisable a 200% ; KO si bouton P0 clippe/injoignable ou texte coupe.
- **Duree** : 5 min/ecran

### A11Y-010 - Element decoratif non focalisable

- **Type** : Accessibilite | **Priorite** : P2
- **Pre-conditions** : lecteur actif ; ecran avec decorations (room : ring vert speaking, badge graphic-eq, emoji flottant, avatars decoratifs ; landing : "2000+ en ligne").
- **Etapes** :
  1. Balayer element par element.
  2. Verifier qu'aucun decor n'est focalise ni annonce comme interactif.
- **Resultat attendu** : les decors sont ignores par le lecteur (`pointerEvents="none"` / `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`, L5/LR8) ; seule l'info utile (label de la cellule parente) est lue.
- **Critere OK/KO** : OK si aucun decor focalise ; KO si le lecteur s'arrete sur un emoji/ring/badge.
- **Duree** : 3 min

### A11Y-011 - Focus a l'ouverture de l'ecran / annonce du titre

- **Type** : Accessibilite | **Priorite** : P2
- **Pre-conditions** : lecteur actif.
- **Etapes** :
  1. Naviguer vers l'ecran.
  2. Ecouter l'annonce initiale.
- **Resultat attendu** : le titre/en-tete de l'ecran est annonce (changement d'ecran signale) ; le focus initial est coherent (premier element pertinent, pas perdu sur un overlay).
- **Critere OK/KO** : OK si le contexte d'ecran est annonce ; KO si arrivee silencieuse sur element aleatoire.
- **Duree** : 2 min

### A11Y-012 - Etat de chargement / liste vide annonce

- **Type** : Accessibilite | **Priorite** : P2
- **Pre-conditions** : ecran avec Loader et EmptyState (reseau lent / liste vide).
- **Etapes** :
  1. Provoquer le chargement (reseau lent) puis l'etat vide.
  2. Ecouter.
- **Resultat attendu** : Loader annonce "Chargement… / Loading…" (`common.loading`, live-region polite) ; EmptyState lit son titre + description (ex. room indisponible). Pas de focus bloque sur un spinner muet.
- **Critere OK/KO** : OK si chargement et vide vocalises ; KO si silence.
- **Duree** : 3 min

---

## 5. Verification i18n FR/EN des labels a11y

L'app porte ses labels a11y via `t('cle.xxxA11y')`, definis dans `src/core/i18n/locales/fr.json` et `src/core/i18n/locales/en.json`. A verifier :

### 5.1 Checklist i18n a11y

| #   | Critere                                                                                                                                                                                 | OK  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| I1  | Chaque cle `*A11y` presente en `en.json` existe aussi en `fr.json` (parite des cles)                                                                                                    | [ ] |
| I2  | Aucune valeur n'est laissee en anglais cote FR (ni l'inverse)                                                                                                                           | [ ] |
| I3  | Les interpolations `{{name}}`, `{{title}}`, `{{label}}` sont preservees dans les deux langues                                                                                           | [ ] |
| I4  | Le **default value** passe en 2e argument de `t()` (ex. `t('room.muteA11y','Mute microphone')`) sert de filet de secours mais N'EST PAS la source de verite : la cle doit exister en FR | [ ] |
| I5  | Bascule de langue **en cours d'utilisation** : les labels a11y se re-traduisent au prochain focus (re-render i18n)                                                                      | [ ] |
| I6  | Les libelles d'etat (selected/disabled) sont coherents avec la langue (le role "bouton"/"button" est fourni par l'OS selon la langue systeme du lecteur, pas par l'app)                 | [ ] |

### 5.2 Exemples de paires verifiees (extrait `room`)

| Cle                      | EN (`en.json`)             | FR (`fr.json`)              |
| ------------------------ | -------------------------- | --------------------------- |
| `room.muteA11y`          | "Mute microphone"          | "Couper le micro"           |
| `room.unmuteA11y`        | "Unmute microphone"        | "Réactiver le micro"        |
| `room.raiseA11y`         | "Raise hand"               | "Lever la main"             |
| `room.lowerA11y`         | "Lower hand"               | "Baisser la main"           |
| `room.profileA11y`       | "Profile of {{name}}"      | "Profil de {{name}}"        |
| `room.promoteA11y`       | "Invite {{name}} to speak" | "Inviter {{name}} à parler" |
| `room.audioReconnecting` | "🔄 Reconnecting audio…"   | "🔄 Reconnexion audio…"     |
| `common.loading`         | "Loading…"                 | "Chargement…"               |

### 5.3 Procedure de test i18n

1. Lancer l'app en **EN** : passer A11Y-001/002 sur 5 ecrans cles (Room, Chat, Notifications, Settings, Profil) et noter les annonces.
2. Basculer en **FR** : repasser les memes ecrans, verifier la traduction de chaque label entendu (I2/I5).
3. Lecteur d'ecran en langue differente de l'app (ex. lecteur EN, app FR) : verifier que le **nom** reste celui de l'app (FR) et que seul le **role** ("bouton") suit la langue du lecteur (I6).
4. Verifier les interpolations : ouvrir une cellule "Profil de Sam" / "Profile of Sam" (I3).

> Astuce dev : un diff des cles `en.json` vs `fr.json` filtre sur `A11y` permet de detecter rapidement toute cle manquante (I1).

---

## 6. Outils

### 6.1 Accessibility Scanner (Android)

- **Installation** : Play Store > "Accessibility Scanner" (Google). Activer dans **Reglages > Accessibilite > Accessibility Scanner**.
- **Usage** : ouvrir l'ecran ChatHouse, taper le bouton flottant "coche" du Scanner > **Capturer l'ecran** (ou "Enregistrer" pour un parcours).
- **Ce qu'il detecte** : taille de cible insuffisante (A11Y-007), contraste texte/icone faible (A11Y-008), libelles manquants (A11Y-001), elements en double, espacement insuffisant.
- **Limite** : ne juge PAS la pertinence du label ni l'ordre de focus dynamique ni les live regions -> completer avec TalkBack (sections 2 et 4).

### 6.2 Xcode Accessibility Inspector (iOS)

- **Lancement** : Xcode > **Xcode > Open Developer Tool > Accessibility Inspector**. Cibler le simulateur ou un device connecte (selecteur de cible en haut a gauche).
- **Inspection** : activer le pointeur (icone viseur), survoler un element pour lire son **Label / Role / Value / Traits / Hint**. Verifier la correspondance avec la matrice bouton.
- **Audit automatique** : onglet **Audit** > **Run Audit** : detecte labels manquants, traits incoherents, contraste, taille de police non dynamique, elements potentiellement coupes en grande police.
- **Live navigation** : flecher "element suivant/precedent" pour simuler l'ordre de focus VoiceOver (A11Y-004/011).

### 6.3 Reglages OS pour les tests Dynamic Type / contraste

- **iOS** : Reglages > Accessibilite > **Ecran et taille du texte** > "Texte plus grand" (activer **Tailles d'accessibilite** pour atteindre ~200-310%). Egalement "Augmenter le contraste", "Reduire la transparence", "Couleurs intelligentes".
- **Android** : Reglages > Affichage > **Taille de police** (max) + **Taille d'affichage**. Et Reglages > Accessibilite > **Texte a contraste eleve**, **Couleurs** (correction/inversion) pour A11Y-008/010.

### 6.4 Verification automatisee (tests existants)

- Les tests RN ciblent par `getByLabelText` : une cle a11y absente ou mal traduite **casse les tests** (filet anti-regression). Lancer la suite par feature (`npx jest <feature> --runInBand`) avant livraison pour confirmer que tous les `accessibilityLabel` attendus sont presents.
- Pour les nouveaux ecrans/boutons : exiger un test `getByLabelText(t('cle.xxxA11y'))` dans la PR (pas de bouton sans assertion de label).

---

## 7. Recapitulatif de couverture (a remplir par campagne)

| Domaine                                  | Cas types | Ecrans couverts / 50 | Boutons couverts / 381 | Statut |
| ---------------------------------------- | --------- | -------------------- | ---------------------- | ------ |
| Labels (A11Y-001)                        | 001       |                      |                        |        |
| Etats (A11Y-002/003)                     | 002, 003  |                      |                        |        |
| Focus / navigation (A11Y-004/011)        | 004, 011  |                      |                        |        |
| Temps-reel / live regions (A11Y-005/006) | 005, 006  |                      |                        |        |
| Cible / contraste (A11Y-007/008)         | 007, 008  |                      |                        |        |
| Dynamic Type (A11Y-009)                  | 009       |                      |                        |        |
| Decoratif / chargement (A11Y-010/012)    | 010, 012  |                      |                        |        |
| i18n FR/EN (section 5)                   | I1-I6     |                      |                        |        |

> Reference croisee : pour chaque ecran, la **matrice bouton** et les cas `*-NNN` de type "Accessibilite" deja ecrits se trouvent dans `docs/qa/screens/NN-*.md` (ex. `47-ROOM-LIVE.md` contient ROOM-LIVE-003/006/009/...). Ce document fournit le **referentiel transverse** ; les fichiers ecran fournissent les **instances concretes** par bouton.
