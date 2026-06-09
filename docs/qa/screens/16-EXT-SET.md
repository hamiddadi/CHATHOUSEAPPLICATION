# 16 - Reglages extensions (`extensions`)

## Contexte ecran

- **Composant** : `src/features/extensions/screens/ExtSettingsScreen.tsx` (exporte depuis `src/features/extensions/index.ts`).
- **Route** : ecran additif autonome, monte sous sa propre route de sous-navigateur (« Mount under its own navigator route or sub-screen » d'apres l'en-tete du fichier). Aucun header/bouton retour n'est rendu par le composant lui-meme : l'ecran s'ouvre dans un `SafeAreaView` + `ScrollView` plein ecran ; le retour/fermeture est fourni par le navigateur hote (donc hors perimetre de ce composant). N'EST PAS encore cable dans un navigateur (`src/navigation/**` ne le reference pas) — tester via montage direct / route de dev.
- **Roles requis** : `standard` et `admin` (compte authentifie ; les appels `GET/PATCH /ext/audio` et `/ext/privacy` passent par `apiClient` avec token). `guest` non authentifie ne peut pas charger l'ecran (401 sur le `get`).
- **Comportements temps-reel** : aucun WebSocket/LiveKit/push direct dans cet ecran. Les ecritures sont des appels REST optimistes :
  - `audioApi.update` -> `PATCH /ext/audio` (la qualite audio + moteur audio influencent ensuite le pipeline LiveKit cote room, mais l'effet est differe, pas temps-reel ici).
  - `privacyApi.update` -> `PATCH /ext/privacy` (`isVisibleOnMap`, `allowWaves`, `isPrivateAccount` impactent presence/decouverte ailleurs dans l'app).
  - Modele optimiste : la valeur s'affiche immediatement, puis se reconcilie avec la reponse serveur ; en cas d'echec, rollback a la valeur precedente + `Alert` d'erreur.
- **Pre-conditions globales** : reseau pour le chargement initial (les deux `get` doivent resoudre avant le rendu ; sinon spinner `ActivityIndicator` infini). Compte de test authentifie avec preferences existantes cote backend.
- **Etats de donnees pertinents** :
  - **Chargement** : tant que `audioApi.get()` ET `privacyApi.get()` ne sont pas resolus (Promise.all), seul un `ActivityIndicator` s'affiche, aucune section visible.
  - **Charge** : 4 sections rendues (Apparence, Qualite audio, Moteur audio, Confidentialite).
  - **Echec de chargement** : le `try/finally` ne capture pas l'erreur du `Promise.all` -> `loading` repasse a `false` dans le `finally` mais `audio`/`privacy` restent `null`. L'UI rend alors les sections avec valeurs par defaut (tiers : aucun coche ; switches sur fallback `?? false`/`?? true`). Aucun message d'erreur de chargement n'est affiche.
  - **Echec d'ecriture** : rollback optimiste + `Alert` (`common.error` + `extensions.settings.saveError`).

## Matrice bouton

| #   | Bouton                            | Emplacement                                       | Type              | Locator reel                                                                                             | Pre-condition | Priorite |
| --- | --------------------------------- | ------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| 1   | Theme Auto                        | Corps / section Apparence (segmented)             | toggle (radio)    | `accessibilityLabel="Theme mode Auto"`                                                                   | ecran charge  | P1       |
| 2   | Theme Light                       | Corps / section Apparence (segmented)             | toggle (radio)    | `accessibilityLabel="Theme mode Light"`                                                                  | ecran charge  | P1       |
| 3   | Theme Dark                        | Corps / section Apparence (segmented)             | toggle (radio)    | `accessibilityLabel="Theme mode Dark"`                                                                   | ecran charge  | P1       |
| 4   | Qualite audio Standard            | Corps / section Qualite audio (cellule pressable) | list-item (radio) | texte `t('extensions.settings.audioStandard')` = « Standard » ; `accessibilityRole="radio"`              | ecran charge  | P1       |
| 5   | Qualite audio Elevee              | Corps / section Qualite audio (cellule pressable) | list-item (radio) | texte `t('extensions.settings.audioHigh')` = « Élevée » ; `accessibilityRole="radio"`                    | ecran charge  | P1       |
| 6   | Qualite audio Musique             | Corps / section Qualite audio (cellule pressable) | list-item (radio) | texte `t('extensions.settings.audioMusic')` = « Musique » ; `accessibilityRole="radio"`                  | ecran charge  | P1       |
| 7   | Audio spatial (3D)                | Corps / section Moteur audio                      | toggle (switch)   | `accessibilityRole="switch"` lie au label `t('extensions.settings.spatialAudio')` ; index 0 des switches | ecran charge  | P1       |
| 8   | Suppression de bruit (AEC)        | Corps / section Moteur audio                      | toggle (switch)   | `accessibilityRole="switch"` lie au label `t('extensions.settings.noiseSuppression')` ; index 1          | ecran charge  | P1       |
| 9   | Mode drop-in (entree silencieuse) | Corps / section Moteur audio                      | toggle (switch)   | `accessibilityRole="switch"` lie au label `t('extensions.settings.dropInMode')` ; index 2                | ecran charge  | P1       |
| 10  | Profil prive                      | Corps / section Confidentialite                   | toggle (switch)   | `accessibilityRole="switch"` lie au label `t('extensions.settings.privateProfile')` ; index 3            | ecran charge  | P0       |
| 11  | Autoriser waves & pings           | Corps / section Confidentialite                   | toggle (switch)   | `accessibilityRole="switch"` lie au label `t('extensions.settings.allowWaves')` ; index 4                | ecran charge  | P1       |
| 12  | M'afficher sur la carte           | Corps / section Confidentialite                   | toggle (switch)   | `accessibilityRole="switch"` lie au label `t('extensions.settings.showOnMap')` ; index 5                 | ecran charge  | P0       |

Note : 12 elements interactifs. L'ecran n'expose ni bouton retour/fermer propre, ni FAB, ni lien, ni input texte, ni pull-to-refresh, ni swipe/long-press, ni modale (hormis l'`Alert` natif d'erreur). Les selecteurs de switch s'appuient sur l'ordre de rendu (index 0..5) car aucun `accessibilityLabel`/`testID` explicite n'est pose sur les `Switch` ; le label visible adjacent sert de reference manuelle.

## Cas de test

### EXT-SET-001 - Selection du theme Light applique le mode clair

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie, ecran charge (sections visibles), reseau Wi-Fi, mode courant = Auto.
- **Etapes** :
  1. Ouvrir l'ecran Reglages extensions.
  2. Attendre la disparition du spinner et l'affichage de la section « Apparence ».
  3. Taper le segment « Light » (`Theme mode Light`).
- **Resultat attendu** : le segment Light prend l'etat selectionne (`accessibilityState.selected=true`, style actif), les autres segments redeviennent inactifs ; le mode est persiste via AsyncStorage (`ext.theme.mode = "light"`).
- **Critere d'acceptation (OK/KO)** : OK si Light est marque selectionne et la preference survit a un remontage de l'ecran ; KO sinon.
- **Donnees de test** : compte `qa.standard@chathouse.test`, valeur AsyncStorage cle `ext.theme.mode`.
- **Duree estimee** : 2 min

### EXT-SET-002 - Theme : multi-clic rapide et bascule sans reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, basculer en mode Avion (hors-ligne) apres chargement.
- **Etapes** :
  1. Charger l'ecran en Wi-Fi.
  2. Activer le mode Avion.
  3. Taper rapidement 6 fois en alternance Auto / Light / Dark / Auto / Light / Dark.
- **Resultat attendu** : aucune erreur reseau (le theme est purement local + AsyncStorage, pas d'appel API) ; le dernier segment tape reste selectionne, l'UI ne flicke pas, pas d'`Alert`.
- **Critere d'acceptation (OK/KO)** : OK si le dernier choix est stable et persiste, aucun crash ni etat incoherent ; KO si un segment reste « bloque » ou l'app plante.
- **Donnees de test** : sequence de taps Auto->Light->Dark->Auto->Light->Dark.
- **Duree estimee** : 3 min

### EXT-SET-003 - Theme : navigation et lecture lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme « Tres grande », contraste eleve actif.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police agrandie.
  2. Balayer jusqu'au groupe radio « Apparence » (`accessibilityRole="radiogroup"`).
  3. Parcourir les trois segments un par un.
  4. Double-taper sur « Theme mode Dark ».
- **Resultat attendu** : chaque segment est annonce avec son label (« Theme mode Auto/Light/Dark ») et son etat selectionne/non ; l'emoji + label restent lisibles en police agrandie (pas de troncature bloquante) ; le double-tap active Dark et l'annonce passe a « selectionne ».
- **Critere d'acceptation (OK/KO)** : OK si les 3 segments sont focusables, annonces avec etat correct, et activables ; KO si un segment est ignore ou son etat n'est pas annonce.
- **Donnees de test** : reglage systeme police 200%, TalkBack/VoiceOver ON.
- **Duree estimee** : 4 min

### EXT-SET-004 - Selection de la qualite audio « Musique » est persistee

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, tier courant = Standard, reseau Wi-Fi, backend repond 200 sur `PATCH /ext/audio`.
- **Etapes** :
  1. Ouvrir l'ecran, attendre la section « Qualité audio ».
  2. Taper la cellule « Musique ».
- **Resultat attendu** : la cellule « Musique » affiche le « ✓ » et le style actif, Standard perd le « ✓ » ; appel `PATCH /ext/audio` avec corps `{ "qualityTier": "music" }` ; l'etat reconcilie avec la reponse serveur.
- **Critere d'acceptation (OK/KO)** : OK si la requete part avec `qualityTier: "music"` et la cellule Musique est cochee apres reponse ; KO sinon.
- **Donnees de test** : payload `{"qualityTier":"music"}`, endpoint `PATCH /ext/audio`.
- **Duree estimee** : 2 min

### EXT-SET-005 - Qualite audio : multi-clic rapide + echec serveur -> rollback

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, tier courant = Standard, backend force a renvoyer 500 sur `PATCH /ext/audio` (ou couper le reseau juste apres le tap).
- **Etapes** :
  1. Charger l'ecran.
  2. Taper tres rapidement « Élevée » puis « Musique » (double tap < 300 ms).
  3. Laisser le(s) `PATCH` echouer (500 / timeout).
- **Resultat attendu** : affichage optimiste transitoire (la derniere cellule tapee se coche) puis rollback a la valeur precedente valide (Standard) a chaque echec ; un `Alert` s'ouvre avec titre « Quelque chose s'est mal passé » (cle `common.error`) et message « Impossible d'enregistrer. Veuillez réessayer. » (cle `extensions.settings.saveError`). Aucun double envoi conflictuel ne laisse l'UI desynchronisee.
- **Critere d'acceptation (OK/KO)** : OK si apres echec la cellule revient a Standard et l'Alert d'erreur s'affiche ; KO si l'UI reste sur un tier non sauvegarde ou aucune alerte.
- **Donnees de test** : reponse mock `HTTP 500` sur `PATCH /ext/audio` ; cles i18n `common.error`, `extensions.settings.saveError`.
- **Duree estimee** : 4 min

### EXT-SET-006 - Qualite audio : lecteur d'ecran annonce le tier selectionne

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, TalkBack/VoiceOver actif, police « Tres grande », contraste eleve.
- **Etapes** :
  1. Activer lecteur d'ecran + police 200%.
  2. Focuser la cellule « Élevée ».
  3. Ecouter l'annonce (role radio + etat).
  4. Double-taper pour selectionner « Élevée ».
- **Resultat attendu** : chaque cellule est annoncee comme bouton radio avec son label + son hint (« ~70 MB/h … ») et son etat selectionne/non (`accessibilityState.selected`) ; le « ✓ » a un contraste suffisant (couleur `primary`) ; le label et le hint ne se chevauchent pas en police agrandie.
- **Critere d'acceptation (OK/KO)** : OK si role radio, label, hint et etat sont annonces et la cellule est activable ; KO si l'etat selectionne n'est pas annonce ou le hint est tronque illisiblement.
- **Donnees de test** : police 200%, TalkBack/VoiceOver ON ; tier cible « high ».
- **Duree estimee** : 4 min

### EXT-SET-007 - Activation de l'Audio spatial (3D) est persistee

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, switch spatial OFF (`spatialAudio=false`), reseau Wi-Fi, backend 200 sur `PATCH /ext/audio`.
- **Etapes** :
  1. Ouvrir l'ecran, attendre la section « Moteur audio ».
  2. Activer le switch « Audio spatial (3D) » (1er switch).
- **Resultat attendu** : le switch passe a ON immediatement (optimiste) ; `PATCH /ext/audio` avec `{ "spatialAudio": true }` ; etat reconcilie avec reponse serveur.
- **Critere d'acceptation (OK/KO)** : OK si requete `spatialAudio: true` envoyee et switch reste ON apres reponse ; KO sinon.
- **Donnees de test** : payload `{"spatialAudio":true}`.
- **Duree estimee** : 2 min

### EXT-SET-008 - Moteur audio : bascule hors-ligne + reconnexion -> rollback

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, switch « Suppression de bruit » ON par defaut, passage hors-ligne juste avant l'action.
- **Etapes** :
  1. Charger l'ecran en Wi-Fi.
  2. Activer le mode Avion.
  3. Taper rapidement 4 fois le switch « Suppression de bruit (AEC) ».
  4. Laisser le `PATCH` echouer, puis retablir le reseau et observer.
- **Resultat attendu** : tentative optimiste a chaque tap puis rollback a la valeur serveur connue (ON) ; `Alert` d'erreur (`saveError`) affichee ; apres reconnexion, un nouveau tap repart correctement et persiste. Aucun etat « fantome » (switch affichant OFF alors que serveur = ON).
- **Critere d'acceptation (OK/KO)** : OK si chaque echec rollback + Alert, et qu'apres reconnexion la sauvegarde fonctionne ; KO si le switch reste desynchronise du serveur.
- **Donnees de test** : endpoint `PATCH /ext/audio`, mode Avion ON/OFF.
- **Duree estimee** : 4 min

### EXT-SET-009 - Mode drop-in : mapping valeur silent/normal correct

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, `dropInMode='normal'` (switch OFF), reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran, section « Moteur audio ».
  2. Activer le switch « Mode drop-in (entrée silencieuse) ».
  3. Le desactiver a nouveau.
- **Resultat attendu** : a l'activation, `PATCH /ext/audio` avec `{ "dropInMode": "silent" }` (switch ON) ; a la desactivation, `{ "dropInMode": "normal" }` (switch OFF). Le switch reflete `dropInMode === 'silent'`.
- **Critere d'acceptation (OK/KO)** : OK si ON envoie `silent` et OFF envoie `normal` ; KO si la valeur envoyee est un booleen ou l'inverse du mapping.
- **Donnees de test** : payloads `{"dropInMode":"silent"}` puis `{"dropInMode":"normal"}`.
- **Duree estimee** : 2 min

### EXT-SET-010 - Moteur audio : accessibilite des switches

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, TalkBack/VoiceOver actif, police « Tres grande », contraste eleve.
- **Etapes** :
  1. Activer lecteur d'ecran + police 200%.
  2. Focuser successivement « Audio spatial (3D) », « Suppression de bruit (AEC) », « Mode drop-in (entrée silencieuse) ».
  3. Double-taper « Audio spatial (3D) ».
- **Resultat attendu** : chaque ligne annonce son label visible + le role switch + l'etat coche/decoche ; les labels ne sont pas tronques en police agrandie (le label et le switch restent sur la meme ligne ou s'adaptent) ; le double-tap bascule l'etat et l'annonce se met a jour.
- **Critere d'acceptation (OK/KO)** : OK si les 3 switches sont focusables, leur label + etat annonces, et activables ; KO si un label n'est pas associe a son switch ou l'etat n'est pas annonce.
- **Donnees de test** : police 200%, TalkBack/VoiceOver ON.
- **Duree estimee** : 4 min

### EXT-SET-011 - Activation du Profil prive est persistee (securite/visibilite)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, ecran charge, `isPrivateAccount=false`, reseau Wi-Fi, backend 200 sur `PATCH /ext/privacy`.
- **Etapes** :
  1. Ouvrir l'ecran, section « Confidentialité ».
  2. Activer le switch « Profil privé » (4e switch global).
- **Resultat attendu** : switch passe ON (optimiste) ; `PATCH /ext/privacy` avec `{ "isPrivateAccount": true }` ; etat reconcilie ; le profil devient prive cote backend (impact decouverte/suivi ailleurs).
- **Critere d'acceptation (OK/KO)** : OK si `isPrivateAccount: true` envoye et switch reste ON apres reponse ; KO sinon.
- **Donnees de test** : payload `{"isPrivateAccount":true}`, endpoint `PATCH /ext/privacy`.
- **Duree estimee** : 2 min

### EXT-SET-012 - Profil prive : echec serveur ne doit pas mentir sur l'etat

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, ecran charge, `isPrivateAccount=false`, backend force 500/timeout sur `PATCH /ext/privacy`.
- **Etapes** :
  1. Charger l'ecran.
  2. Taper rapidement 3 fois le switch « Profil privé ».
  3. Laisser le(s) `PATCH` echouer.
- **Resultat attendu** : affichage optimiste transitoire puis rollback a `false` (OFF) a chaque echec ; `Alert` d'erreur (`common.error` + `saveError`). Critique securite : le switch NE DOIT PAS rester sur ON si le serveur n'a pas confirme (sinon l'utilisateur croit son profil prive alors qu'il est public).
- **Critere d'acceptation (OK/KO)** : OK si apres echec le switch revient a OFF et l'Alert s'affiche ; KO si le switch reste ON sans confirmation serveur.
- **Donnees de test** : mock `HTTP 500` sur `PATCH /ext/privacy`.
- **Duree estimee** : 4 min

### EXT-SET-013 - Profil prive : accessibilite et contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard, ecran charge, TalkBack/VoiceOver actif, police « Tres grande », contraste eleve.
- **Etapes** :
  1. Activer lecteur d'ecran + police 200%.
  2. Focuser le switch « Profil privé ».
  3. Ecouter l'annonce, double-taper pour activer.
- **Resultat attendu** : la ligne annonce « Profil privé » + role switch + etat (decoche puis coche) ; le label reste lisible en police agrandie ; le double-tap bascule et l'etat est re-annonce.
- **Critere d'acceptation (OK/KO)** : OK si le label est associe au switch, l'etat annonce et activable ; KO sinon.
- **Donnees de test** : police 200%, TalkBack/VoiceOver ON.
- **Duree estimee** : 3 min

### EXT-SET-014 - Profil prive : synchro multi-appareil

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : meme compte standard connecte sur 2 appareils (A et B), tous deux sur l'ecran Reglages extensions, reseau Wi-Fi.
- **Etapes** :
  1. Sur appareil A, activer « Profil privé ».
  2. Attendre la confirmation serveur sur A.
  3. Sur appareil B, recharger l'ecran (remontage / re-fetch `GET /ext/privacy`).
- **Resultat attendu** : apres re-fetch, l'appareil B reflete `isPrivateAccount=true`. (Note : pas de push temps-reel — la propagation depend d'un nouveau `GET`, pas d'un evenement WebSocket ; la synchro est donc « au prochain chargement ».)
- **Critere d'acceptation (OK/KO)** : OK si B affiche le profil prive apres re-fetch ; KO si B reste sur l'ancienne valeur malgre re-fetch.
- **Donnees de test** : meme compte sur 2 devices ; endpoint `GET /ext/privacy`.
- **Duree estimee** : 5 min

### EXT-SET-015 - Activation « Autoriser waves & pings » est persistee

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, `allowWaves=true` (ON par defaut), reseau Wi-Fi.
- **Etapes** :
  1. Ouvrir l'ecran, section « Confidentialité ».
  2. Desactiver le switch « Autoriser waves & pings » (5e switch).
- **Resultat attendu** : switch passe OFF (optimiste) ; `PATCH /ext/privacy` avec `{ "allowWaves": false }` ; etat reconcilie.
- **Critere d'acceptation (OK/KO)** : OK si `allowWaves: false` envoye et switch reste OFF apres reponse ; KO sinon.
- **Donnees de test** : payload `{"allowWaves":false}`.
- **Duree estimee** : 2 min

### EXT-SET-016 - Waves & pings : multi-clic rapide + latence reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, latence reseau elevee simulee (3-5 s) sur `PATCH /ext/privacy`.
- **Etapes** :
  1. Charger l'ecran.
  2. Taper le switch « Autoriser waves & pings » 5 fois rapidement.
  3. Attendre la fin des reponses lentes.
- **Resultat attendu** : les reponses lentes reconcilient l'etat ; l'etat final affiche reflete la derniere reponse serveur recue (le code remplace `audio`/`privacy` par la reponse a chaque `update`). Aucun `Alert` si toutes reussissent ; pas de crash sur les promesses concurrentes.
- **Critere d'acceptation (OK/KO)** : OK si l'UI converge vers la valeur serveur finale sans rester « bloquee » entre deux ; KO si le switch reste fige ou affiche une valeur jamais confirmee.
- **Donnees de test** : latence injectee 3-5 s, endpoint `PATCH /ext/privacy`.
- **Duree estimee** : 4 min

### EXT-SET-017 - Waves & pings : accessibilite

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, ecran charge, TalkBack/VoiceOver actif, police « Tres grande », contraste eleve.
- **Etapes** :
  1. Activer lecteur d'ecran + police 200%.
  2. Focuser « Autoriser waves & pings ».
  3. Double-taper pour basculer.
- **Resultat attendu** : annonce du label + role switch + etat ; label lisible en police agrandie ; bascule effective et re-annoncee.
- **Critere d'acceptation (OK/KO)** : OK si label associe, etat annonce, switch activable ; KO sinon.
- **Donnees de test** : police 200%, TalkBack/VoiceOver ON.
- **Duree estimee** : 3 min

### EXT-SET-018 - Activation « M'afficher sur la carte » est persistee (localisation/visibilite)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, ecran charge, `isVisibleOnMap=false` (par defaut), reseau Wi-Fi, backend 200 sur `PATCH /ext/privacy`.
- **Etapes** :
  1. Ouvrir l'ecran, section « Confidentialité ».
  2. Activer le switch « M'afficher sur la carte » (6e switch).
- **Resultat attendu** : switch passe ON (optimiste) ; `PATCH /ext/privacy` avec `{ "isVisibleOnMap": true }` ; etat reconcilie ; l'utilisateur devient visible sur la carte (impact vie privee / geolocalisation).
- **Critere d'acceptation (OK/KO)** : OK si `isVisibleOnMap: true` envoye et switch reste ON apres reponse ; KO sinon.
- **Donnees de test** : payload `{"isVisibleOnMap":true}`.
- **Duree estimee** : 2 min

### EXT-SET-019 - Visibilite carte : echec serveur ne doit pas exposer l'utilisateur

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, ecran charge, `isVisibleOnMap=false`, backend force 500/timeout sur `PATCH /ext/privacy`.
- **Etapes** :
  1. Charger l'ecran.
  2. Taper rapidement 3 fois le switch « M'afficher sur la carte ».
  3. Laisser le(s) `PATCH` echouer.
- **Resultat attendu** : affichage optimiste transitoire puis rollback a `false` (OFF) a chaque echec ; `Alert` d'erreur (`saveError`). Critique vie privee : le switch NE DOIT PAS afficher ON sans confirmation serveur (sinon l'utilisateur croit etre visible/non-visible a tort).
- **Critere d'acceptation (OK/KO)** : OK si apres echec le switch revient a OFF + Alert ; KO si le switch reste ON sans confirmation.
- **Donnees de test** : mock `HTTP 500` sur `PATCH /ext/privacy`.
- **Duree estimee** : 4 min

### EXT-SET-020 - Visibilite carte : accessibilite et police agrandie

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard, ecran charge, TalkBack/VoiceOver actif, police « Tres grande », contraste eleve.
- **Etapes** :
  1. Activer lecteur d'ecran + police 200%.
  2. Focuser « M'afficher sur la carte ».
  3. Ecouter l'annonce, double-taper pour activer.
- **Resultat attendu** : annonce du label « M'afficher sur la carte » + role switch + etat ; label lisible (non tronque) en police agrandie ; bascule effective et re-annoncee.
- **Critere d'acceptation (OK/KO)** : OK si label associe, etat annonce, switch activable ; KO sinon.
- **Donnees de test** : police 200%, TalkBack/VoiceOver ON.
- **Duree estimee** : 3 min

### EXT-SET-021 - Chargement initial : spinner puis sections (gestion du fetch)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, reseau Wi-Fi, backend repond 200 sur `GET /ext/audio` et `GET /ext/privacy`.
- **Etapes** :
  1. Ouvrir l'ecran a froid.
  2. Observer l'`ActivityIndicator`.
  3. Attendre la resolution des deux `get`.
- **Resultat attendu** : pendant le chargement, seul le spinner est visible (aucune section) ; une fois `Promise.all` resolu, les 4 sections apparaissent avec les valeurs serveur (tier actif coche, switches sur valeurs serveur).
- **Critere d'acceptation (OK/KO)** : OK si transition spinner -> sections completes ; KO si sections affichees avant resolution ou spinner persistant.
- **Donnees de test** : `GET /ext/audio` -> `{qualityTier:"standard",spatialAudio:false,noiseSuppression:true,dropInMode:"normal",...}` ; `GET /ext/privacy` -> `{isPrivateAccount:false,allowWaves:true,isVisibleOnMap:false}`.
- **Duree estimee** : 2 min

### EXT-SET-022 - Chargement initial en echec : pas de boucle/crash, valeurs par defaut

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, backend force 500 sur `GET /ext/audio` et/ou `GET /ext/privacy` (ou hors-ligne au boot).
- **Etapes** :
  1. Couper le reseau (ou forcer 500 cote serveur).
  2. Ouvrir l'ecran a froid.
  3. Observer le comportement apres echec du `Promise.all`.
- **Resultat attendu** : le spinner disparait (le `finally` repasse `loading=false`) ; les sections se rendent avec les valeurs par defaut/fallback (`audio=null` -> aucun tier coche, switches sur `?? false`/`?? true` ; `privacy=null` -> switches fallback). Aucun crash, pas de spinner infini. (Limite connue : aucun message d'erreur de chargement ni retry n'est propose — a documenter comme amelioration.)
- **Critere d'acceptation (OK/KO)** : OK si l'app ne plante pas et affiche un etat par defaut exploitable apres echec ; KO si ecran blanc/crash/spinner infini.
- **Donnees de test** : mock `HTTP 500` sur les deux `GET`, ou mode Avion au demarrage.
- **Duree estimee** : 3 min

### EXT-SET-023 - Acces guest non authentifie (securite)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : aucun token / session expiree (role guest), tentative d'ouverture de l'ecran.
- **Etapes** :
  1. Se deconnecter ou invalider le token.
  2. Forcer l'ouverture de la route de l'ecran.
  3. Observer la reponse des `GET /ext/audio` et `GET /ext/privacy`.
- **Resultat attendu** : les `GET` renvoient 401 ; le `Promise.all` rejette ; `finally` met `loading=false` ; l'ecran ne doit pas exposer de donnees d'un autre utilisateur. Idealement la couche `apiClient`/navigation redirige vers l'authentification (a verifier selon le comportement global d'interception 401).
- **Critere d'acceptation (OK/KO)** : OK si aucune donnee privee n'est affichee et le 401 est gere (pas de crash, redirection auth si applicable) ; KO si des reglages sont affiches/modifiables sans auth.
- **Donnees de test** : token absent/expire ; endpoints `/ext/audio`, `/ext/privacy` -> 401.
- **Duree estimee** : 3 min

---

**Total** : 12 elements interactifs, 23 cas de test.
