# 43 - Creer une room (`rooms`)

## Contexte ecran

- **Route** : `CreateRoom` dans `RoomsNavigator` (deep link `room/new`, alias modal `CreateRoomModal` = `modal/create-room`). Presentation `modal`, animation `slide_from_bottom`. Fichier : `src/features/rooms/screens/CreateRoomScreen/CreateRoomScreen.tsx`.
- **Roles requis** : `standard` et `admin` (compte authentifie pouvant heberger). Un `guest` (non authentifie) ne doit pas atteindre cet ecran ; l'action de creation `POST /rooms` exige un token. Pas de permission micro/notif/localisation/stockage requise par cet ecran (le micro est demande plus tard, a l'entree de la room live).
- **Comportements temps-reel** : l'ecran lui-meme n'emet/recoit AUCUN evenement WebSocket/LiveKit. Le seul appel reseau temps-non-reel est `searchService.users(q, 8)` (debounce 250 ms) pour les co-hosts, et `createRoom.mutateAsync` (`POST /rooms`) au tap sur Demarrer. Le temps-reel demarre APRES creation : une room instantanee est live et on entre dedans via `navigation.replace('Room', { roomId })`, ce qui ouvre le socket + LiveKit dans l'ecran Room (hors perimetre de cet ecran). Une room programmee (`scheduledFor`) n'est pas live : retour au feed via `navigation.goBack()`.
- **Pre-conditions globales** : backend `:4000` joignable ; `.env` racine pointant sur l'IP LAN du PC ; compte de test connecte. Le bouton Demarrer est desactive tant que le titre trimme n'a pas entre `TITLE_MIN=3` et `TITLE_MAX=80` caracteres, ou pendant la mutation (`createRoom.isPending`).
- **Etats de donnees pertinents** :
  - _Liste de recherche co-hosts vide_ : `searchResults=[]` si requete vide ou aucun resultat ; un `…` (indicateur de chargement) s'affiche pendant la recherche debounced.
  - _Limites_ : max 5 tags (`MAX_TOPICS`), max 5 co-hosts (`MAX_COHOSTS`) ; au-dela, le tap supplementaire est ignore (no-op) et le champ de recherche co-host disparait a 5 co-hosts.
  - _Hors-ligne / latence_ : la recherche co-host echoue silencieusement (resultats vides) ; la creation echoue avec `Alert` (`createRoom.errorTitle` + corps `errorMessage`).
  - _Enregistrement_ : toggle masque (`FEATURES.roomRecording=false`) ; `recordingEnabled` force a `false` cote payload quel que soit l'etat residuel.
  - _Visibilite_ : `public` (OPEN, defaut), `social` (SOCIAL, gating follow-graph), `closed` (CLOSED, invite-only). Mapping cote `roomService.visibilityToBackend`.

## Matrice bouton

| #   | Bouton                                | Emplacement                  | Type         | Locator reel                                                                                               | Pre-condition                            | Priorite |
| --- | ------------------------------------- | ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| 1   | Fermer                                | Header (gauche)              | navigation   | `accessibilityLabel` = `t('createRoom.closeA11y')` -> "Fermer sans démarrer"                               | Ecran ouvert                             | P1       |
| 2   | Champ Sujet (titre)                   | Corps                        | input-submit | `placeholderText` = `t('createRoom.topicPlaceholder')` -> "De quoi veux-tu parler ?"                       | -                                        | P0       |
| 3   | Champ Description                     | Corps                        | input-submit | `placeholderText` = `t('createRoom.descriptionPlaceholder')` -> "Donne le ton avant que les gens entrent…" | -                                        | P2       |
| 4   | Visibilite : Open                     | Corps (radiogroup)           | toggle       | `accessibilityLabel` = "Open: Anyone in Chathouse can join" (role `radio`)                                 | -                                        | P1       |
| 5   | Visibilite : Social                   | Corps (radiogroup)           | toggle       | `accessibilityLabel` = "Social: Only people you follow can join"                                           | -                                        | P1       |
| 6   | Visibilite : Closed                   | Corps (radiogroup)           | toggle       | `accessibilityLabel` = "Closed: Only people you invite"                                                    | -                                        | P1       |
| 7   | Chips Tags (x7)                       | Corps                        | toggle       | `accessibilityRole`=button, texte chip = `tech`/`design`/`crypto`/`ai`/`music`/`business`/`health`         | -                                        | P1       |
| 8   | Champ recherche co-host               | Corps                        | input-submit | `placeholderText` = `t('createRoom.coHostsSearchPlaceholder')` -> "Rechercher par pseudo"                  | < 5 co-hosts                             | P1       |
| 9   | Resultat recherche (ajouter co-host)  | Corps (liste resultats)      | list-item    | Pressable role=button, texte = `displayName`/`@username` + icone `add`                                     | Recherche a renvoye >=1 hit              | P1       |
| 10  | Retirer co-host                       | Corps (chip co-host)         | icon         | Pressable role=button, icone `close`, dans le chip `@username`                                             | >=1 co-host ajoute                       | P1       |
| 11  | Toggle "Programmer plus tard"         | Corps                        | toggle       | `accessibilityLabel` = `t('createRoom.scheduleLabel')` -> "Programmer plus tard" (role `switch`)           | -                                        | P1       |
| 12  | Mode planif : Quick presets           | Corps (visible si toggle ON) | toggle       | `accessibilityLabel` = "Quick presets" (role `radio`)                                                      | Toggle planif ON                         | P2       |
| 13  | Mode planif : Pick date & time        | Corps (visible si toggle ON) | toggle       | `accessibilityLabel` = "Pick date & time" (role `radio`)                                                   | Toggle planif ON                         | P2       |
| 14  | Preset +30 min                        | Corps (mode preset)          | toggle       | `accessibilityLabel` = "Schedule +30 min" (role `radio`)                                                   | Planif ON + mode preset                  | P2       |
| 15  | Preset +1 h                           | Corps (mode preset)          | toggle       | `accessibilityLabel` = "Schedule +1 h" (defaut selectionne)                                                | Planif ON + mode preset                  | P2       |
| 16  | Preset +3 h                           | Corps (mode preset)          | toggle       | `accessibilityLabel` = "Schedule +3 h"                                                                     | Planif ON + mode preset                  | P2       |
| 17  | Preset +1 j                           | Corps (mode preset)          | toggle       | `accessibilityLabel` = "Schedule +1 j"                                                                     | Planif ON + mode preset                  | P2       |
| 18  | Cellule Jour (DateTimePickerInline)   | Corps (mode custom)          | toggle       | `accessibilityLabel` = "Date: {{date}}" (role `radio`)                                                     | Planif ON + mode custom                  | P2       |
| 19  | Cellule Heure (DateTimePickerInline)  | Corps (mode custom)          | toggle       | `accessibilityLabel` = "Hour {{hour}}" (role `radio`)                                                      | Planif ON + mode custom                  | P2       |
| 20  | Cellule Minute (DateTimePickerInline) | Corps (mode custom)          | toggle       | `accessibilityLabel` = "Minute {{minute}}" (role `radio`)                                                  | Planif ON + mode custom                  | P2       |
| 21  | Bouton Demarrer                       | Bas (barre d'action)         | submit       | `accessibilityRole`=button, name = `t('createRoom.startRoom')` -> "Démarrer"                               | Titre trimme 3-80 car. + non `isPending` | P0       |

> **Note element masque** : le toggle "Enregistrer (Replay)" (`t('createRoom.recordLabel')`, role `switch`) est present dans le code mais **non rendu** car `FEATURES.roomRecording=false`. Il est donc hors scope des tests actifs ; `recordingEnabled` est force a `false` cote payload. A re-tester si le flag passe a `true`.

## Cas de test

### ROOM-CREATE-001 - Fermer la modale et revenir au feed

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; ecran Creer une room ouvert depuis le feed ; Wi-Fi.
- **Etapes** :
  1. Ouvrir la modale Creer une room.
  2. Taper sur l'icone Fermer (croix) en haut a gauche (`accessibilityLabel` "Fermer sans démarrer").
- **Resultat attendu** : la modale se ferme (slide vers le bas), retour a l'ecran precedent (feed) ; aucune room creee, aucun appel `POST /rooms`.
- **Critere d'acceptation (OK/KO)** : OK si `navigation.goBack()` execute et aucun appel reseau de creation declenche ; KO sinon.
- **Donnees de test** : compte `standard` `qa.standard@chathouse.test` / OTP `000000`.
- **Duree estimee** : 1 min

### ROOM-CREATE-002 - Fermer avec champs remplis (perte de saisie sans confirmation)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi ; saisie partielle en cours.
- **Etapes** :
  1. Saisir un titre "Brouillon room" et selectionner 2 tags.
  2. Taper rapidement 3 fois sur la croix Fermer (multi-clic rapide).
- **Resultat attendu** : la modale se ferme une seule fois (pas de double `goBack` empilant des retours), saisie abandonnee sans dialogue de confirmation (comportement actuel : pas de garde anti-perte).
- **Critere d'acceptation (OK/KO)** : OK si exactement un retour effectue et l'app ne crashe pas ; KO si la stack remonte de plusieurs ecrans ou crash.
- **Donnees de test** : titre "Brouillon room", tags `tech`, `ai`.
- **Duree estimee** : 2 min

### ROOM-CREATE-003 - Accessibilite du bouton Fermer (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack (Android) ou VoiceOver (iOS) actif ; police systeme agrandie (130 %) ; contraste eleve.
- **Etapes** :
  1. Ouvrir la modale.
  2. Balayer jusqu'au premier element focusable du header.
- **Resultat attendu** : le lecteur annonce "Fermer sans démarrer, bouton" ; cible tactile >= 44x44 (hitSlop=8 autour d'une icone 24) ; le titre "Nouvelle room" reste lisible sans troncature a 130 %.
- **Critere d'acceptation (OK/KO)** : OK si l'annonce correspond au label i18n et la cible est activable ; KO si "bouton" non nomme ou cible trop petite.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### ROOM-CREATE-004 - Saisie d'un titre valide active Demarrer

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi ; bouton Demarrer initialement desactive.
- **Etapes** :
  1. Verifier que Demarrer est desactive (titre vide).
  2. Saisir "Building in public" dans le champ Sujet (placeholder "De quoi veux-tu parler ?").
  3. Observer le compteur d'aide `x / 80`.
- **Resultat attendu** : Demarrer s'active des que le titre trimme atteint 3 caracteres ; compteur affiche "18 / 80".
- **Critere d'acceptation (OK/KO)** : OK si `accessibilityState.disabled` passe de `true` a `false` ; KO sinon.
- **Donnees de test** : titre "Building in public".
- **Duree estimee** : 1 min

### ROOM-CREATE-005 - Titre trop court / trop long / espaces seuls

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi.
- **Etapes** :
  1. Saisir "ab" (2 car.) -> verifier Demarrer desactive.
  2. Saisir " " (3 espaces) -> verifier Demarrer desactive (trim a 0).
  3. Coller un texte de 81 caracteres -> verifier que `maxLength=80` tronque l'entree a 80.
- **Resultat attendu** : Demarrer reste desactive pour < 3 car. trimmes ; impossible de depasser 80 car. ; compteur plafonne a "80 / 80".
- **Critere d'acceptation (OK/KO)** : OK si la regle `trimmedTitle.length >= 3 && <= 80` est respectee a l'UI ; KO si Demarrer s'active sur " " ou si > 80 car. acceptes.
- **Donnees de test** : "ab", " ", chaine "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor x" (81 car.).
- **Duree estimee** : 2 min

### ROOM-CREATE-006 - Accessibilite du champ titre (label + compteur)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver actif ; police 130 %.
- **Etapes** :
  1. Focus sur le champ Sujet.
  2. Saisir quelques caracteres.
- **Resultat attendu** : le lecteur annonce le label "Sujet" et lit le helper "x / 80" ; le clavier ne masque pas le champ (`keyboardShouldPersistTaps='handled'`, scroll possible).
- **Critere d'acceptation (OK/KO)** : OK si label + compteur annonces et champ visible au-dessus du clavier ; KO sinon.
- **Donnees de test** : "QA test"
- **Duree estimee** : 2 min

### ROOM-CREATE-007 - Saisie d'une description optionnelle multiligne

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi.
- **Etapes** :
  1. Saisir un titre valide.
  2. Saisir une description sur 2 lignes dans le champ Description (multiline, `maxLength=200`).
  3. Demarrer la room.
- **Resultat attendu** : compteur "x / 200" ; la description trimmee est envoyee dans le payload (`description` ; `undefined` si vide).
- **Critere d'acceptation (OK/KO)** : OK si `mutateAsync` recoit `description` egale au texte trimme ; KO si envoye avec espaces non trimmes ou si depassement de 200.
- **Donnees de test** : "Discussion ouverte\nVenez nombreux."
- **Duree estimee** : 2 min

### ROOM-CREATE-008 - Description vide n'envoie pas de chaine vide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte.
- **Etapes** :
  1. Titre valide, description laissee vide (ou espaces seuls).
  2. Demarrer.
- **Resultat attendu** : payload contient `description: undefined` (pas de chaine vide ni d'espaces).
- **Critere d'acceptation (OK/KO)** : OK si `mutateAsync` appele avec `description === undefined` ; KO si chaine vide envoyee.
- **Donnees de test** : description "" puis " ".
- **Duree estimee** : 1 min

### ROOM-CREATE-009 - Accessibilite description multiligne + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : VoiceOver/TalkBack ; police 150 %.
- **Etapes** :
  1. Focus champ Description.
  2. Saisir un texte long sur plusieurs lignes.
- **Resultat attendu** : le champ s'agrandit (numberOfLines=4), reste scrollable, label "Description (optionnel)" annonce ; pas de chevauchement avec le bloc Visibilite a 150 %.
- **Critere d'acceptation (OK/KO)** : OK si lisible et navigable au lecteur ; KO si texte coupe ou superposition.
- **Donnees de test** : 180 caracteres de lorem ipsum.
- **Duree estimee** : 2 min

### ROOM-CREATE-010 - Selection de la visibilite (Open/Social/Closed)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi.
- **Etapes** :
  1. Verifier que "Open" est selectionne par defaut (coche affichee).
  2. Taper sur "Social" (label "Social: Only people you follow can join").
  3. Taper sur "Closed".
  4. Saisir un titre valide et Demarrer.
- **Resultat attendu** : un seul radio selectionne a la fois (coche `check` deplacee) ; le dernier choix "Closed" est envoye -> `roomService.create` mappe en `isPrivate=true, roomType=CLOSED`.
- **Critere d'acceptation (OK/KO)** : OK si `mutateAsync` recoit `visibility: 'closed'` ; KO si plusieurs selections actives ou mauvais mapping.
- **Donnees de test** : titre "Visibilite test".
- **Duree estimee** : 2 min

### ROOM-CREATE-011 - Multi-tap rapide entre options de visibilite

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte.
- **Etapes** :
  1. Taper tres rapidement Open -> Social -> Closed -> Social (4 taps en < 1 s).
- **Resultat attendu** : l'etat final reflete le dernier tap ("Social"), aucune selection multiple, pas de scintillement bloquant.
- **Critere d'acceptation (OK/KO)** : OK si une seule option active = derniere tapee ; KO si etat incoherent.
- **Donnees de test** : N/A
- **Duree estimee** : 1 min

### ROOM-CREATE-012 - Accessibilite radio de visibilite (etat selected)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver ; contraste eleve.
- **Etapes** :
  1. Balayer les trois options.
  2. Activer "Social".
- **Resultat attendu** : chaque option annoncee comme "radio" avec son label complet "label: description" ; l'etat selectionne annonce ("selectionne") sur l'option active ; le contraste de la pastille selectionnee (primary-container) reste suffisant.
- **Critere d'acceptation (OK/KO)** : OK si `accessibilityState.selected` correctement annonce ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### ROOM-CREATE-013 - Selection/deselection de tags (chips)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi.
- **Etapes** :
  1. Taper sur le chip "tech" (devient selectionne), puis "ai".
  2. Verifier le compteur "Tags · 2/5".
  3. Re-taper "tech" pour le deselectionner.
  4. Titre valide + Demarrer.
- **Resultat attendu** : tags selectionnes mis en surbrillance ; compteur a jour ; payload `topics: ['ai']` apres deselection de tech.
- **Critere d'acceptation (OK/KO)** : OK si `mutateAsync` recoit `topics` = tags selectionnes restants ; KO sinon.
- **Donnees de test** : tags `tech`, `ai`.
- **Duree estimee** : 2 min

### ROOM-CREATE-014 - Limite de 5 tags (6e tap ignore)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte.
- **Etapes** :
  1. Selectionner 5 tags : tech, design, crypto, ai, music.
  2. Taper rapidement sur "business" puis "health" (tentative au-dela de la limite).
- **Resultat attendu** : compteur reste "5/5" ; business et health restent non selectionnes (no-op `next.size < MAX_TOPICS`).
- **Critere d'acceptation (OK/KO)** : OK si jamais plus de 5 tags selectionnes ; KO si 6+ acceptes.
- **Donnees de test** : 7 tags disponibles.
- **Duree estimee** : 2 min

### ROOM-CREATE-015 - Accessibilite des chips tags + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver ; police 130 %.
- **Etapes** :
  1. Balayer la rangee de tags.
  2. Activer "music".
- **Resultat attendu** : chaque chip annonce comme "bouton" avec son texte ; `accessibilityState.selected` annonce a l'activation ; le wrap des chips reste lisible a 130 % (pas de troncature du texte).
- **Critere d'acceptation (OK/KO)** : OK si selection annoncee et texte non coupe ; KO sinon.
- **Donnees de test** : tag "music".
- **Duree estimee** : 2 min

### ROOM-CREATE-016 - Recherche et ajout d'un co-host

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi ; au moins un utilisateur "ada" existe cote backend.
- **Etapes** :
  1. Saisir "ada" dans le champ "Rechercher par pseudo".
  2. Attendre ~250 ms (debounce) -> `searchService.users('ada', 8)`.
  3. Taper la ligne resultat "Ada Lovelace" (icone add).
- **Resultat attendu** : un chip co-host "@ada" apparait (avec avatar + croix de retrait) ; le champ de recherche se vide et la liste de resultats disparait ; compteur "Co-hosts · 1/5".
- **Critere d'acceptation (OK/KO)** : OK si chip "@ada" rendu et `coHostIds` inclut l'id 'u1' au Demarrer ; KO sinon.
- **Donnees de test** : query "ada" ; hit `{ id:'u1', username:'ada', displayName:'Ada Lovelace', avatarUrl:null }`.
- **Duree estimee** : 2 min

### ROOM-CREATE-017 - Recherche co-host : reseau coupe + multi-tap + doublon + limite 5

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; bascule Wi-Fi -> avion en cours de saisie.
- **Etapes** :
  1. Activer le mode avion, saisir "bob" : la recherche echoue silencieusement (catch -> resultats vides), un "…" peut apparaitre brievement.
  2. Reactiver le reseau, saisir "ada", taper deux fois tres vite la meme ligne resultat (multi-tap).
  3. Ajouter 5 co-hosts distincts, puis verifier que le champ de recherche disparait (>= MAX_COHOSTS).
- **Resultat attendu** : hors-ligne -> aucune liste, aucun crash ; double-tap -> le co-host n'est ajoute qu'une fois (dedup par id) ; a 5 co-hosts le champ de recherche n'est plus rendu (`coHosts.length < MAX_COHOSTS` faux).
- **Critere d'acceptation (OK/KO)** : OK si pas de doublon, pas de 6e co-host, pas de crash hors-ligne ; KO sinon.
- **Donnees de test** : queries "bob", "ada" ; 5 utilisateurs test u1..u5.
- **Duree estimee** : 4 min

### ROOM-CREATE-018 - Retirer un co-host ajoute

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; 1 co-host "@ada" deja ajoute.
- **Etapes** :
  1. Taper l'icone close (croix) dans le chip "@ada".
- **Resultat attendu** : le chip disparait, compteur revient sans co-host ; le champ de recherche reapparait si on etait a 5.
- **Critere d'acceptation (OK/KO)** : OK si `coHosts` ne contient plus l'id retire ; KO sinon.
- **Donnees de test** : co-host "@ada" id 'u1'.
- **Duree estimee** : 1 min

### ROOM-CREATE-019 - Accessibilite recherche/ajout/retrait co-host

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver ; police 130 %.
- **Etapes** :
  1. Focus champ "Rechercher par pseudo", saisir "ada".
  2. Balayer jusqu'a la ligne resultat et l'activer.
  3. Balayer jusqu'a la croix de retrait du chip.
- **Resultat attendu** : champ annonce son placeholder ; ligne resultat annoncee comme "bouton" lisant displayName + @username ; la croix de retrait (hitSlop=8) annoncee comme "bouton" activable.
- **Critere d'acceptation (OK/KO)** : OK si chaque element nomme et activable au lecteur ; KO si croix non focusable ou non nommee.
- **Donnees de test** : query "ada".
- **Duree estimee** : 3 min

### ROOM-CREATE-020 - Activer la programmation et choisir un preset

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi.
- **Etapes** :
  1. Activer le switch "Programmer plus tard".
  2. Verifier l'apparition des modes "Quick presets"/"Pick date & time" et des presets.
  3. En mode preset (defaut), verifier "+1 h" selectionne, taper "+3 h" (label "Schedule +3 h").
  4. Titre valide + Demarrer.
- **Resultat attendu** : les presets ne montent que toggle ON ; `scheduledFor` = now + 180 min en ISO ; navigation `goBack()` (room non live) et invalidation du feed.
- **Critere d'acceptation (OK/KO)** : OK si `mutateAsync` recoit `scheduledFor` ~ now+3 h et retour au feed ; KO si entree directe dans la room ou date absente.
- **Donnees de test** : preset "+3 h", titre "Room programmee".
- **Duree estimee** : 2 min

### ROOM-CREATE-021 - Mode custom : choisir jour/heure/minute (clamp futur)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi ; programmation activee.
- **Etapes** :
  1. Toggle planif ON, taper "Pick date & time".
  2. Selectionner jour "Tomorrow" (label "Date: ..."), heure "10" ("Hour 10"), minute "30" ("Minute 30").
  3. Verifier le resume formate ; titre valide + Demarrer.
- **Resultat attendu** : le DateTimePickerInline emet un ISO futur (clampe a now+1 min minimum) ; `scheduledFor=customScheduledFor` envoye ; retour au feed.
- **Critere d'acceptation (OK/KO)** : OK si `scheduledFor` correspond au jour/heure choisis (futur) ; KO si date passee acceptee.
- **Donnees de test** : jour demain, 10:30.
- **Duree estimee** : 3 min

### ROOM-CREATE-022 - Programmation : multi-tap toggle + bascule preset/custom rapide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte.
- **Etapes** :
  1. Taper 4 fois rapidement le switch "Programmer plus tard".
  2. Avec planif ON, basculer rapidement preset <-> custom plusieurs fois.
- **Resultat attendu** : le toggle finit dans un etat coherent (ON apres nb pair+1) ; le bloc planif s'affiche/masque sans crash ; passer en custom remonte le DateTimePickerInline sans perdre la valeur par defaut (now+1 h).
- **Critere d'acceptation (OK/KO)** : OK si etat final coherent et pas de crash ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### ROOM-CREATE-023 - Accessibilite du switch + cellules date/heure

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver ; police 130 % ; contraste eleve.
- **Etapes** :
  1. Balayer jusqu'au switch "Programmer plus tard".
  2. Activer, puis balayer les chips de mode et les cellules du picker.
- **Resultat attendu** : switch annonce role "switch" + etat checked ; modes/presets/cellules annonces comme "radio" avec leur label i18n ("Quick presets", "Schedule +1 h", "Date: ...", "Hour 10", "Minute 30") et etat selected.
- **Critere d'acceptation (OK/KO)** : OK si role/etat annonces correctement ; KO si switch lu comme simple bouton sans etat.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### ROOM-CREATE-024 - Creer une room instantanee et y entrer (chemin critique)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi ; backend `:4000` joignable ; programmation OFF.
- **Etapes** :
  1. Saisir titre "Building in public".
  2. (Optionnel) selectionner visibilite "Open", 1 tag.
  3. Taper "Démarrer" (`createRoom.startRoom`).
- **Resultat attendu** : `createRoom.mutateAsync` appele une fois avec `{ title:'Building in public', visibility:'public', recordingEnabled:false, topics:[...], coHostIds:[], scheduledFor:undefined }` ; room creee live -> `navigation.replace('Room', { roomId })` (entree directe) ; `goBack` NON appele ; le feed est invalide.
- **Critere d'acceptation (OK/KO)** : OK si `replace('Room', {roomId})` execute et payload conforme ; KO si retour feed ou payload errone.
- **Donnees de test** : titre "Building in public".
- **Duree estimee** : 2 min

### ROOM-CREATE-025 - Demarrer : multi-clic rapide + perte reseau pendant la creation

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; latence reseau elevee (throttle) puis coupure.
- **Etapes** :
  1. Titre valide.
  2. Taper "Démarrer" puis re-taper 3 fois tres vite pendant que `isPending` est vrai.
  3. Couper le reseau avant la reponse, attendre l'echec.
- **Resultat attendu** : pendant `isPending`, Demarrer est `disabled` (et `loading`) -> un seul `POST /rooms` ; a l'echec, `Alert` "Création impossible" + corps issu de `errorMessage` ; on reste sur l'ecran (pas de navigation) ; les saisies sont conservees ; on peut re-essayer.
- **Critere d'acceptation (OK/KO)** : OK si exactement 1 mutation declenchee, Alert affichee, aucune navigation, donnees conservees ; KO si doubles creations ou navigation hative.
- **Donnees de test** : titre "Reseau coupe", reponse simulee = rejet `Error('boom')` (cf. test unitaire) -> Alert("Création impossible", "boom").
- **Duree estimee** : 4 min

### ROOM-CREATE-026 - Demarrer desactive sans titre valide (garde de soumission)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte.
- **Etapes** :
  1. Laisser le titre vide (ou < 3 car.).
  2. Tenter de taper "Démarrer".
- **Resultat attendu** : le bouton est `disabled` (`canStart=false`), aucun appel `mutateAsync`, aucun feedback de navigation.
- **Critere d'acceptation (OK/KO)** : OK si tap sans effet et `mutateAsync` jamais appele ; KO si creation declenchee.
- **Donnees de test** : titre "" puis "ab".
- **Duree estimee** : 1 min

### ROOM-CREATE-027 - Accessibilite du bouton Demarrer (etat disabled/loading)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : TalkBack/VoiceOver ; police 130 % ; contraste eleve.
- **Etapes** :
  1. Sans titre, focus "Démarrer".
  2. Saisir un titre valide, refocus.
  3. Lancer la creation et observer l'etat loading.
- **Resultat attendu** : a vide, le lecteur annonce "Démarrer, bouton, desactive" (`accessibilityState.disabled=true`) ; apres titre valide, annonce "bouton" actif ; pendant la mutation, etat occupe/desactive (loading). Cible >= 44 px, label visible non tronque a 130 %.
- **Critere d'acceptation (OK/KO)** : OK si etats disabled/actif/loading correctement exposes au lecteur ; KO sinon.
- **Donnees de test** : titre "Building in public".
- **Duree estimee** : 3 min

### ROOM-CREATE-028 - Synchro multi-utilisateur : co-hosts et room programmee visibles cote invites

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 comptes connectes (Host = `standard` A ; co-host invite = compte B suivant/suivi par A) ; deux devices ; Wi-Fi.
- **Etapes** :
  1. Sur device A, creer une room instantanee "Sync test" en visibilite "Social", en ajoutant le compte B comme co-host, puis Demarrer.
  2. A entre dans la room (`replace('Room', {roomId})`).
  3. Sur device B, ouvrir le feed/notifications et rejoindre la room (ou via invitation/ping selon flux co-host).
- **Resultat attendu** : la room creee apparait cote B (feed invalide cote A apres `onSuccess`) ; B (co-host / follower) peut rejoindre puisque visibilite SOCIAL gate sur le follow-graph ; une fois B dans la room, le temps-reel (presence, audio LiveKit) demarre dans l'ecran Room (hors cet ecran).
- **Critere d'acceptation (OK/KO)** : OK si B voit/rejoint la room avec le bon gating de visibilite et A est bien Host avec B en co-host ; KO si B ne peut rejoindre une room Social qu'il devrait pouvoir, ou si co-host non enregistre.
- **Donnees de test** : compte A `qa.host@chathouse.test`, compte B `qa.cohost@chathouse.test` ; B suit A ; room "Sync test", visibilite Social.
- **Duree estimee** : 5 min

### ROOM-CREATE-029 - Synchro multi-utilisateur : room programmee annoncee aux abonnes

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : compte A (host) + compte B (follower de A) ; Wi-Fi.
- **Etapes** :
  1. Sur A, activer "Programmer plus tard", choisir preset "+1 h", titre "À venir test", Demarrer.
  2. A revient au feed (room non live, `goBack`).
  3. Sur B, ouvrir le feed et la bande "À venir" (filtre `upcoming`).
- **Resultat attendu** : la room programmee n'est pas live, n'apparait pas dans les rooms live, mais apparait dans la bande "À venir" cote A et B (selon visibilite) ; `scheduledFor` ~ now+1 h.
- **Critere d'acceptation (OK/KO)** : OK si room visible dans "À venir" avec l'horaire correct et absente du live ; KO sinon.
- **Donnees de test** : preset "+1 h", titre "À venir test".
- **Duree estimee** : 4 min
