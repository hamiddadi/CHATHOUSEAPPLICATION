# 19 - Creer une house (`houses`)

## Contexte ecran

- **Route** : `CreateHouse` (sans params) dans le `RoomsNavigator` (`src/core/navigation/stacks/RoomsNavigator.tsx`, `name="CreateHouse"`, type `RoomStackParamList.CreateHouse`). Atteignable depuis :
  - le FAB de la liste des houses : `HouseListScreen` -> `navigation.navigate('CreateHouse')` (`src/features/houses/screens/HouseListScreen/HouseListScreen.tsx:138`).
  - les reglages : `SettingsScreen` -> `navigation.navigate('RoomsTab', { screen: 'CreateHouse' })` (`src/features/settings/screens/SettingsScreen/SettingsScreen.tsx:198`).
- **Fichier ecran** : `src/features/houses/screens/CreateHouseScreen/CreateHouseScreen.tsx` (aucun partial — tout le rendu est dans ce seul fichier, y compris le sous-composant `PrivacyRow`).
- **Roles requis** : `standard` ou `admin` (zone application authentifiee). Pas de garde de role dans le composant ; un `guest` n'atteint pas cette route. La creation suppose un token valide cote API.
- **Comportements temps-reel** : AUCUN canal temps-reel propre a cet ecran. Pas de WebSocket, pas de LiveKit, pas de push emis/consomme ici. La "synchro" repose uniquement sur :
  - Mutation REST de creation : `useCreateHouse` -> `houseService.create` -> `POST /clubs` (payload `{ name, description?, privacy: 'OPEN'|'PRIVATE', iconUrl? }`). En `onSuccess` -> `invalidateQueries({ queryKey: ['houses'] })`, ce qui re-fetch la liste des houses (`mine` / `discover`) dans les autres ecrans. C'est la seule forme de propagation : pseudo-synchro par invalidation/refetch, PAS un push serveur.
  - Upload d'icone REST : `mediaService.uploadAvatar` -> `POST /upload/avatar` (corps `{ dataUrl }` en base64, timeout etendu a 60 s). N'est appele QUE si une icone a ete choisie (`iconBase64` non nul). Renvoie l'URL https distante envoyee ensuite comme `iconUrl`.
- **Pre-conditions globales** : utilisateur connecte, token valide, API joignable, i18n charge.
- **Etats de donnees pertinents** :
  - **Formulaire vide a l'ouverture** : `name=''`, `description=''`, `privacy='open'` (option "Open" pre-selectionnee), aucune icone. Compteurs `0 / 30` (nom) et `0 / 200` (description).
  - **Bouton submit desactive** : `canCreate = name.trim().length >= 2 && !createHouse.isPending && !uploading`. Tant que le nom fait moins de 2 caracteres apres trim, ou pendant une creation/upload, le bouton est `disabled` (opacite 45 %, `onPress` ignore).
  - **Etat de chargement** : `loading = createHouse.isPending || uploading` -> le bouton submit affiche un `ActivityIndicator` a la place du libelle et passe `accessibilityState.busy`.
  - **Upload en cours** : `uploading=true` pendant l'appel `uploadAvatar` (uniquement si icone choisie).
  - **Permission galerie refusee** : `Alert.alert(t('houses.create.errorAccessTitle'), t('houses.create.errorAccessBody'))`.
  - **Echec creation / upload** : `Alert.alert(t('houses.create.errorTitle'), errorMessage(e, t('houses.create.errorBody')))`.
- **Note localisation (defaut de l'ecran)** : les locales (`src/core/i18n/locales/fr.json:718` et `en.json:718`) ne definissent pour `houses.create` que `title`, `namePlaceholder`, `descPlaceholder`, `submit`. TOUTES les autres cles utilisees par le code (`submitBtn`, `nameLabel`, `descLabel`, `privacyLabel`, `privacyOpen`/`privacyOpenDesc`, `privacyPrivate`/`privacyPrivateDesc`, `closeA11y`, `uploadIconA11y`/`replaceIconA11y`, `uploadIcon`/`replaceIcon`, `errorAccessTitle`/`errorAccessBody`, `errorTitle`/`errorBody`) sont ABSENTES et retombent sur le defaut anglais inline du `t(key, defaut)`. Consequences observables : le bouton de creation s'affiche "Create House" (et non "Creer"), le placeholder du nom s'affiche "Nom de la House" (FR present) mais le label au-dessus s'affiche "House name" (EN). C'est une incoherence FR/EN reelle a verifier en cas de test multilingue.

## Matrice bouton

| #   | Bouton                           | Emplacement                              | Type           | Locator reel                                                                                                                                                                                      | Pre-condition                                                       | Priorite |
| --- | -------------------------------- | ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| 1   | Fermer (croix)                   | Header (gauche)                          | navigation     | `accessibilityLabel = t('houses.create.closeA11y', 'Close without creating')` (rendu "Close without creating") ; `accessibilityRole="button"`                                                     | Ecran monte avec une pile navigable en arriere                      | P1       |
| 2   | Choisir / remplacer l'icone      | Corps (zone avatar carre 96x96, en haut) | icon           | `accessibilityLabel = t('houses.create.uploadIconA11y', 'Upload house icon')` sans icone, ou `t('houses.create.replaceIconA11y', 'Replace house icon')` avec icone ; `accessibilityRole="button"` | Permission galerie (demandee a la volee)                            | P1       |
| 3   | Champ "Nom de la house"          | Corps (1er input)                        | input-submit   | `placeholder = t('houses.create.namePlaceholder')` ("Nom de la House" en FR) ; label `t('houses.create.nameLabel', 'House name')` ; `maxLength=30`                                                | Ecran monte                                                         | P0       |
| 4   | Champ "Description"              | Corps (2e input, multiligne)             | input-submit   | `placeholder = t('houses.create.descPlaceholder')` ("Description") ; label `t('houses.create.descLabel', 'Description')` ; `maxLength=200` ; `multiline`                                          | Ecran monte                                                         | P2       |
| 5   | Option confidentialite "Open"    | Corps (bloc Privacy, 1ere ligne)         | toggle (radio) | `accessibilityRole="radio"` ; `accessibilityLabel = "Open: Anyone can join and start rooms"` (`${label}: ${description}`) ; `accessibilityState.selected`                                         | Ecran monte                                                         | P1       |
| 6   | Option confidentialite "Private" | Corps (bloc Privacy, 2e ligne)           | toggle (radio) | `accessibilityRole="radio"` ; `accessibilityLabel = "Private: Invitation only"` ; `accessibilityState.selected`                                                                                   | Ecran monte                                                         | P1       |
| 7   | Bouton "Creer la house"          | Corps (bas du ScrollView)                | submit         | `accessibilityRole="button"` ; libelle `t('houses.create.submitBtn', 'Create House')` (rendu "Create House") ; `disabled` tant que `!canCreate`                                                   | Nom >= 2 car. apres trim ; aucune mutation/upload en cours ; reseau | P0       |

> Remarque : l'ecran n'expose aucun FAB, switch, checkbox, lien, swipe, long-press ni pull-to-refresh. Le placeholder de droite du header (`<View className="w-[24px]" />`) n'est pas actionnable. Total elements interactifs : 7 (1 navigation, 1 icone d'upload, 2 inputs, 2 radios de confidentialite, 1 submit).

## Cas de test

### HOUSE-CREATE-001 - Fermer revient en arriere sans creer

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran "Creer une house" ouvert depuis le FAB de la liste des houses (un ecran precedent existe) ; Wi-Fi ; aucune permission requise.
- **Etapes** :
  1. Ouvrir l'ecran "Creer une house".
  2. Saisir partiellement le nom (ex. "Te").
  3. Taper la croix du header (`accessibilityLabel = "Close without creating"`).
- **Resultat attendu** : `navigation.goBack()` appele une fois ; retour a la liste des houses ; aucune requete `POST /clubs` declenchee ; la saisie est perdue (pas de brouillon persiste).
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent reapparait et aucun appel reseau de creation n'est emis ; KO si l'app reste sur l'ecran ou crashe.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; pile Rooms -> HouseList -> CreateHouse.
- **Duree estimee** : 2 min

### HOUSE-CREATE-002 - Fermer : multi-clic rapide ne sort pas de la pile

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; latence reseau elevee simulee (throttle 3G) — sans incidence directe mais represente une charge UI.
- **Etapes** :
  1. Ouvrir l'ecran "Creer une house".
  2. Taper la croix "Close without creating" 5 fois en moins d'1 seconde.
- **Resultat attendu** : une seule navigation arriere effective ; pas de sortie multiple de la pile, pas d'ecran blanc, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'app remonte d'exactement un niveau et reste stable ; KO si elle saute plusieurs ecrans ou crashe.
- **Donnees de test** : compte standard ; throttle reseau 3G actif.
- **Duree estimee** : 3 min

### HOUSE-CREATE-003 - Fermer accessible (TalkBack/VoiceOver, police agrandie, contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; lecteur d'ecran actif (TalkBack Android / VoiceOver iOS) ; taille de police systeme maximale ; mode contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'a la croix du header.
  3. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : la croix est annoncee "Close without creating, bouton" ; la cible tactile respecte ~44 pt (hitSlop=8) ; le double-tap declenche `goBack()` ; l'icone reste visible et contrastee en police agrandie sans rognage du header.
- **Critere d'acceptation (OK/KO)** : OK si l'element est focalisable, correctement annonce comme bouton et activable ; KO si non focalisable, libelle vide/"icone" ou non activable.
- **Donnees de test** : compte standard ; TalkBack ON ; police 200 %.
- **Duree estimee** : 4 min

### HOUSE-CREATE-004 - Ajouter une icone depuis la galerie (chemin nominal)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; permission galerie/photos ACCORDEE ; au moins une image dans la galerie ; Wi-Fi.
- **Etapes** :
  1. Taper la zone avatar (`accessibilityLabel = "Upload house icon"`).
  2. Accorder la permission si demandee.
  3. Choisir une image, recadrer en carre 1:1 et valider.
- **Resultat attendu** : l'image recadree s'affiche dans le carre 96x96 ; le texte sous l'avatar passe de "House icon (optional)" a "Tap to replace" ; le `accessibilityLabel` de la zone devient "Replace house icon" ; AUCUN upload reseau n'est declenche a ce stade (l'upload n'a lieu qu'au submit).
- **Critere d'acceptation (OK/KO)** : OK si l'apercu s'affiche et le libelle bascule en mode "remplacer" ; KO si l'apercu reste vide ou l'app crashe.
- **Donnees de test** : compte standard ; image JPG carree de la galerie de test.
- **Duree estimee** : 3 min

### HOUSE-CREATE-005 - Icone : permission galerie refusee

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; permission photos REFUSEE au niveau systeme ; reseau quelconque.
- **Etapes** :
  1. Taper la zone avatar "Upload house icon".
  2. Au prompt systeme, refuser l'acces (ou avoir deja refuse precedemment).
  3. Re-taper rapidement la zone 3 fois de suite.
- **Resultat attendu** : une `Alert` s'affiche avec titre "Accès refusé" et corps "Autorisez l'accès à vos photos pour ajouter une icône." ; aucun selecteur d'image ne s'ouvre ; les taps repetes n'empilent pas plusieurs alertes ni ne crashent ; l'avatar reste vide.
- **Critere d'acceptation (OK/KO)** : OK si l'alerte de refus apparait et le picker ne s'ouvre pas ; KO si le picker s'ouvre malgre le refus ou si l'app crashe.
- **Donnees de test** : compte standard ; permission photos = "Refuser".
- **Duree estimee** : 3 min

### HOUSE-CREATE-006 - Icone : zone d'upload accessible (TalkBack/VoiceOver + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; ecran ouvert ; lecteur d'ecran actif ; police systeme maximale ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'a la zone avatar.
  3. Ecouter l'annonce avant et apres avoir choisi une icone.
- **Resultat attendu** : sans icone, annonce "Upload house icon, bouton" ; apres choix, l'annonce passe a "Replace house icon, bouton" ; le carre 96x96 reste de taille stable en police agrandie (pas de chevauchement avec le label "House icon (optional)").
- **Critere d'acceptation (OK/KO)** : OK si l'etat (ajouter vs remplacer) est annonce correctement et la zone reste activable ; KO si le libelle ne reflete pas l'etat ou si la zone n'est pas focalisable.
- **Donnees de test** : compte standard ; TalkBack ON ; police 200 %.
- **Duree estimee** : 4 min

### HOUSE-CREATE-007 - Saisie du nom et compteur de caracteres

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ecran ouvert ; Wi-Fi.
- **Etapes** :
  1. Toucher le champ nom (placeholder "Nom de la House").
  2. Saisir "Indie".
  3. Observer le compteur d'aide sous le champ.
- **Resultat attendu** : le texte saisi s'affiche ; le compteur passe de "0 / 30" a "5 / 30" ; le bouton "Create House" devient actif (nom >= 2 car.).
- **Critere d'acceptation (OK/KO)** : OK si le compteur reflete exactement la longueur et le submit s'active ; KO si compteur fige ou submit reste desactive.
- **Donnees de test** : nom = "Indie".
- **Duree estimee** : 2 min

### HOUSE-CREATE-008 - Nom : limite a 30 caracteres et nom vide/espaces

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ecran ouvert ; Wi-Fi.
- **Etapes** :
  1. Coller un nom de 40 caracteres dans le champ nom.
  2. Verifier le compteur et le texte effectivement accepte.
  3. Effacer tout, puis saisir uniquement deux espaces " ".
  4. Observer l'etat du bouton "Create House".
- **Resultat attendu** : la saisie est tronquee a 30 caracteres (compteur "30 / 30") ; avec uniquement des espaces, `name.trim().length` = 0 -> le bouton "Create House" reste desactive (opacite 45 %, tap sans effet).
- **Critere d'acceptation (OK/KO)** : OK si la saisie ne depasse jamais 30 car. ET le submit reste inactif pour un nom vide/espaces ; KO si depassement possible ou submit actif avec nom vide.
- **Donnees de test** : nom long = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" (40 car.) ; nom espaces = " ".
- **Duree estimee** : 3 min

### HOUSE-CREATE-009 - Champ nom accessible (TalkBack/VoiceOver + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; lecteur d'ecran actif ; police systeme maximale ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au champ nom.
  3. Saisir "Te" au clavier accessible et ecouter le compteur.
- **Resultat attendu** : le champ est annonce comme zone de saisie ; le label "House name" et le placeholder "Nom de la House" sont accessibles ; le compteur "2 / 30" reste lisible et non rogne en police agrandie ; le placeholder (#c2c6d7) garde un contraste suffisant.
- **Critere d'acceptation (OK/KO)** : OK si le champ est focalisable, editable au clavier accessible et le compteur reste lisible ; KO si non focalisable ou texte rogne.
- **Donnees de test** : nom = "Te" ; TalkBack ON ; police 200 %.
- **Duree estimee** : 4 min

### HOUSE-CREATE-010 - Description : saisie multiligne et compteur

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard ; ecran ouvert ; Wi-Fi.
- **Etapes** :
  1. Toucher le champ description (placeholder "Description").
  2. Saisir un texte sur 2 lignes (ex. "Une house\\npour testeurs").
  3. Observer le compteur.
- **Resultat attendu** : le texte multiligne s'affiche ; le compteur passe a la longueur reelle (ex. "21 / 200") ; le clavier ne masque pas le champ (KeyboardAvoidingView + keyboardShouldPersistTaps='handled').
- **Critere d'acceptation (OK/KO)** : OK si le multiligne s'affiche et le compteur suit la longueur ; KO si saisie sur une seule ligne forcee ou compteur fige.
- **Donnees de test** : description = "Une house\\npour testeurs".
- **Duree estimee** : 2 min

### HOUSE-CREATE-011 - Description : limite a 200 caracteres

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; ecran ouvert ; Wi-Fi.
- **Etapes** :
  1. Coller un texte de 250 caracteres dans la description.
  2. Verifier le compteur et le texte accepte.
- **Resultat attendu** : saisie tronquee a 200 caracteres (compteur "200 / 200") ; pas de plantage ni de defilement casse.
- **Critere d'acceptation (OK/KO)** : OK si la longueur n'excede jamais 200 ; KO si depassement possible.
- **Donnees de test** : chaine Lorem ipsum de 250 caracteres.
- **Duree estimee** : 2 min

### HOUSE-CREATE-012 - Description accessible (TalkBack/VoiceOver + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; ecran ouvert ; lecteur d'ecran actif ; police systeme maximale ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au champ description.
  3. Saisir une courte phrase et ecouter le compteur.
- **Resultat attendu** : le champ multiligne est annonce comme zone de saisie ; le compteur "x / 200" reste lisible en police agrandie ; le champ s'agrandit sans rogner le bouton "Create House" en dessous.
- **Critere d'acceptation (OK/KO)** : OK si focalisable, editable et compteur lisible ; KO sinon.
- **Donnees de test** : description = "Test a11y" ; TalkBack ON ; police 200 %.
- **Duree estimee** : 3 min

### HOUSE-CREATE-013 - Basculer la confidentialite sur "Private"

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; Wi-Fi.
- **Etapes** :
  1. Constater que "Open" est selectionne par defaut (etat radio coche, icone "check" visible).
  2. Taper la ligne "Private: Invitation only" (`accessibilityRole="radio"`).
- **Resultat attendu** : "Private" devient selectionne (`accessibilityState.selected=true`, fond `primary-container`, icone "check" affichee) ; "Open" se deselectionne ; le futur `POST /clubs` portera `privacy: 'PRIVATE'`.
- **Critere d'acceptation (OK/KO)** : OK si exactement une option est selectionnee a la fois et c'est "Private" ; KO si les deux ou aucune sont selectionnees.
- **Donnees de test** : selection cible = "private".
- **Duree estimee** : 2 min

### HOUSE-CREATE-014 - Confidentialite : taps rapides alternes restent coherents

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; reseau quelconque (action purement locale, aucun appel reseau).
- **Etapes** :
  1. Taper alternativement "Open" puis "Private" 10 fois en moins de 2 secondes.
  2. Arreter sur "Open".
- **Resultat attendu** : a tout moment une seule option est selectionnee ; l'etat final reflete le dernier tap ("Open") ; aucune requete reseau declenchee par ces bascules ; pas de scintillement bloquant ni de crash.
- **Critere d'acceptation (OK/KO)** : OK si l'etat final = derniere option tapee et la selection reste mutuellement exclusive ; KO si etat incoherent.
- **Donnees de test** : sequence de taps Open/Private x10.
- **Duree estimee** : 2 min

### HOUSE-CREATE-015 - Confidentialite accessible (radio annonce + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; lecteur d'ecran actif ; police systeme maximale ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer sur les deux options de confidentialite.
  3. Double-taper "Private" et re-ecouter l'etat.
- **Resultat attendu** : chaque option est annoncee comme "radio" avec son libelle complet ("Open: Anyone can join and start rooms" / "Private: Invitation only") et son etat selectionne/non ; apres activation, "Private" est annonce selectionne et "Open" non selectionne ; les libelles ne sont pas rognes en police 200 %.
- **Critere d'acceptation (OK/KO)** : OK si role radio, libelle complet et etat selected correctement annonces et exclusifs ; KO sinon.
- **Donnees de test** : TalkBack ON ; police 200 %.
- **Duree estimee** : 4 min

### HOUSE-CREATE-016 - Creer une house valide (sans icone) et retour

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ecran ouvert ; Wi-Fi ; API joignable.
- **Etapes** :
  1. Saisir le nom "Indie Hackers".
  2. Laisser la description vide, garder "Open".
  3. Taper le bouton "Create House" (`accessibilityRole="button"`, libelle "Create House").
  4. Attendre la fin de l'appel.
- **Resultat attendu** : pendant l'appel, le bouton affiche un spinner (`busy`) et est desactive ; `POST /clubs` envoye avec `{ name: 'Indie Hackers', description: undefined, privacy: 'OPEN', iconUrl: undefined }` ; AUCUN `POST /upload/avatar` (pas d'icone) ; au succes, `navigation.goBack()` et la liste des houses est invalidee/re-fetchee, faisant apparaitre la nouvelle house.
- **Critere d'acceptation (OK/KO)** : OK si la house est creee (200), retour effectue et la liste contient la nouvelle entree apres refetch ; KO si erreur, pas de retour ou liste non mise a jour.
- **Donnees de test** : payload `{"name":"Indie Hackers","privacy":"OPEN"}` ; compte `qa.standard@chathouse.test`.
- **Duree estimee** : 3 min

### HOUSE-CREATE-017 - Creer une house privee avec icone (upload puis creation)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ecran ouvert ; permission galerie accordee ; image carree disponible ; Wi-Fi ; API joignable.
- **Etapes** :
  1. Taper la zone avatar et choisir une image carree.
  2. Saisir le nom "QA Private House".
  3. Saisir une description "Espace de test".
  4. Selectionner "Private".
  5. Taper "Create House".
- **Resultat attendu** : `uploading` passe a true, bouton en spinner ; `POST /upload/avatar` envoye d'abord (corps `{ dataUrl: 'data:image/...;base64,...' }`, timeout 60 s) et renvoie une URL https ; puis `POST /clubs` avec `{ name: 'QA Private House', description: 'Espace de test', privacy: 'PRIVATE', iconUrl: 'https://.../icon.jpg' }` ; au succes, retour arriere et liste rafraichie ; l'icone distante (https, pas file://) s'affiche pour la house.
- **Critere d'acceptation (OK/KO)** : OK si l'upload precede la creation, l'`iconUrl` est une URL https et la house creee porte cette icone ; KO si `file://` envoye, ordre inverse ou icone cassee.
- **Donnees de test** : nom "QA Private House", description "Espace de test", privacy private, image JPG carree.
- **Duree estimee** : 5 min

### HOUSE-CREATE-018 - Submit : multi-clic rapide, perte reseau et reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ecran ouvert ; nom valide "Net Test" saisi ; reseau manipulable (mode avion / throttle).
- **Etapes** :
  1. Saisir le nom "Net Test".
  2. Passer en mode avion (hors-ligne).
  3. Taper "Create House" 5 fois tres rapidement.
  4. Observer l'etat du bouton et l'eventuelle alerte.
  5. Reactiver le reseau et re-taper "Create House" une fois.
- **Resultat attendu** : pendant `isPending`/`uploading`, `canCreate=false` -> les taps supplementaires sont ignores (UNE seule mutation lancee max) ; hors-ligne, l'appel echoue -> `Alert.alert("Erreur", message d'echec)` ; aucune double-creation cote serveur ; apres reconnexion et nouveau tap, la house se cree une seule fois et le retour s'effectue.
- **Critere d'acceptation (OK/KO)** : OK si zero double-creation, l'erreur reseau est notifiee, et la creation reussit apres reconnexion ; KO si plusieurs houses creees, app figee ou pas d'alerte.
- **Donnees de test** : nom "Net Test" ; bascule mode avion ON puis OFF.
- **Duree estimee** : 5 min

### HOUSE-CREATE-019 - Submit : echec serveur d'upload d'icone

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; ecran ouvert ; icone choisie ; nom valide ; endpoint `/upload/avatar` force a renvoyer une erreur (mock/500) ou a ne pas renvoyer d'URL.
- **Etapes** :
  1. Choisir une icone et saisir le nom "Upload Fail".
  2. Taper "Create House".
  3. Observer le comportement quand l'upload echoue.
- **Resultat attendu** : `uploadAvatar` leve (erreur HTTP ou "Upload failed: no URL returned") ; `POST /clubs` N'est PAS appele ; `Alert.alert("Erreur", ...)` affichee ; `uploading` repasse a false (bloc `finally`) ; le bouton "Create House" redevient actif pour reessayer ; l'apercu d'icone reste affiche.
- **Critere d'acceptation (OK/KO)** : OK si la creation n'est pas tentee apres echec d'upload, l'alerte apparait et le bouton se reactive ; KO si la house est creee sans icone valide ou si le bouton reste fige.
- **Donnees de test** : icone JPG ; backend `/upload/avatar` -> 500.
- **Duree estimee** : 4 min

### HOUSE-CREATE-020 - Submit accessible (etat busy/disabled annonce, police agrandie)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; ecran ouvert ; lecteur d'ecran actif ; police systeme maximale ; contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran sans saisir de nom.
  2. Balayer jusqu'au bouton "Create House" et ecouter l'etat.
  3. Saisir un nom valide, re-focaliser le bouton.
  4. Double-taper et ecouter pendant le chargement.
- **Resultat attendu** : sans nom, le bouton est annonce "Create House, bouton, desactive" (`accessibilityState.disabled`) ; avec nom valide, il devient actif ; pendant l'appel il est annonce "occupe/busy" (spinner, `accessibilityState.busy`) ; le libelle ne deborde pas en police 200 % (texte tronque a une ligne) et reste contraste.
- **Critere d'acceptation (OK/KO)** : OK si l'etat disabled puis busy est correctement annonce et le bouton reste activable une fois le nom valide ; KO si etat non annonce ou bouton activable a vide.
- **Donnees de test** : nom "A11y House" ; TalkBack ON ; police 200 %.
- **Duree estimee** : 4 min

### HOUSE-CREATE-021 - Submit : synchro multi-utilisateur de la nouvelle house

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes (createur `qa.standard@chathouse.test` sur device A, observateur `qa.standard2@chathouse.test` sur device B) ; les deux connectes ; Wi-Fi ; house creee en mode "Open" (visible en discover).
- **Etapes** :
  1. Device A : creer la house "Sync House" en "Open" via "Create House".
  2. Device A : verifier le retour et l'apparition dans sa liste "mine".
  3. Device B : ouvrir/rafraichir l'onglet decouverte des houses.
- **Resultat attendu** : sur A, l'invalidation locale (`invalidateQueries(['houses'])`) re-fetch et affiche la house. Sur B, comme il n'existe PAS de push temps-reel, la house n'apparait qu'apres un refetch cote B (pull-to-refresh / re-montage / refocus) ; valider que les deux clients convergent vers le meme etat apres refresh. Documenter explicitement l'absence de propagation instantanee (pseudo-synchro par refetch, pas WebSocket).
- **Critere d'acceptation (OK/KO)** : OK si A voit la house immediatement et B la voit apres un refetch manuel/auto, sans doublon ; KO si la house manque sur l'un des clients apres refresh ou apparait en double.
- **Donnees de test** : house "Sync House" (Open) ; comptes A et B.
- **Duree estimee** : 6 min
