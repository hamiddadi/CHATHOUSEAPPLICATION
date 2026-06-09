# 24 - Carte (`maps`)

## Contexte ecran

- **Route** : onglet `Explorer` / Maps. Composant `MapsScreen` (`src/features/maps/screens/MapsScreen/MapsScreen.tsx`). Navigue vers `Main > RoomsTab > Room` (rejoindre une room) et `Main > MessagesTab > ChatDetail` (DM) depuis la mini-carte.
- **Roles requis** : `standard` et `admin` (utilisateur authentifie avec position geolocalisee). Un `guest` non authentifie n'a pas de socket/roster ni de droit de broadcast de position ; l'ecran reste accessible visuellement mais sans pins ni emission de localisation.
- **Comportements temps-reel** :
  - **Emission** : `maps:update-location` (`useLocationBroadcast`) a chaque changement de coords (au plus toutes les 30 s / 25 m), uniquement si Ghost Mode est OFF.
  - **Emission** : `maps:toggle-visibility { isVisible }` au toggle See/Unsee (`ghostModeStore.setGhost`) + PATCH REST `/users/me/visibility`.
  - **Reception** : `maps:user-moved { userId, latitude, longitude }` (relocalise un pin connu), `maps:user-offline { userId }` (retire le pin). Auto-join du canal `maps:presence` (pas de message subscribe).
  - **REST snapshot** : `GET /maps/users` (roster complet) au montage puis toutes les 45 s (`useNearbyOnMap` / `ROSTER_REFRESH_MS`).
  - **Demo mode** (`REALTIME_ENABLED=false`) : roster seede depuis `MOCK_FOLLOWERS_ON_MAP`, aucun socket.
- **Pre-conditions globales** : permission localisation accordee + services GPS actifs. Etats bloquants geres avant le rendu de la carte :
  - `permission === 'denied'` → EmptyState "Location permission needed" + bouton Grant access.
  - `permission === 'disabled'` → EmptyState "Turn on location services" (aucun bouton, lecture seule).
  - `!coords && !ready` → Loader plein ecran "Locating you" (a11y `explorer.maps.locatingA11y`).
  - `coords` absent mais `ready` (timeout fix 8 s) → carte rendue centree sur `DEFAULT_MAP_CENTER` (Dakar).
- **Etats de donnees pertinents** :
  - **Liste vide** : aucun follower nearby → carte sans pins (sauf le point bleu utilisateur). Recherche sans resultat → 0 marker affiche.
  - **Pin live** : `liveRoomId !== null` → anneau vert pulse + badge LIVE + bouton "Join Room" dans la mini-carte.
  - **Hors-ligne / latence** : socket deconnecte → pas de deltas temps-reel ; le polling 45 s tente de re-pull ; un emit (location/visibility) est best-effort et avale silencieusement l'echec.
  - **Ghost Mode ON** : aucun broadcast de position ; l'utilisateur disparait des cartes des autres viewers.

## Matrice bouton

| #   | Bouton                        | Emplacement                       | Type                         | Locator reel                                                                                                                              | Pre-condition                            | Priorite |
| --- | ----------------------------- | --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| 1   | Grant access                  | EmptyState (permission refusee)   | submit                       | `t('explorer.maps.permissionBtn','Grant access')` (texte) / a11y `t('explorer.maps.permissionRetryA11y','Try requesting location again')` | `permission === 'denied'`                | P0       |
| 2   | Recherche "Find a friend"     | Barre flottante haute             | input-submit                 | accessibilityLabel `"Find a friend"` (placeholder `"Find a friend..."`)                                                                   | Carte rendue                             | P1       |
| 3   | Recentrer sur ma position     | Controles flottants droite (haut) | icon                         | accessibilityLabel `"Recenter map on my location"` (icone `my-location`)                                                                  | Carte rendue ; actif si `coords` present | P1       |
| 4   | Toggle See/Unsee (Ghost Mode) | Controles flottants droite (bas)  | toggle                       | accessibilityLabel `"You are visible. Tap to hide."` / `"You are hidden. Tap to reveal."` (role `switch`)                                 | Carte rendue                             | P0       |
| 5   | Pin follower (marker)         | Corps carte                       | list-item / realtime-action  | accessibilityLabel `` `${displayName}` `` ou `` `${displayName}, live` `` (onPress → `handlePinPress`)                                    | Au moins un follower dans le roster      | P1       |
| 6   | Marker "Your location"        | Corps carte                       | (non interactif)             | accessibilityLabel `t('explorer.maps.yourLocationA11y','Your location')`                                                                  | `coords` present                         | P2       |
| 7   | Fermer mini-carte             | Mini-carte (haut droite)          | menu                         | accessibilityLabel `"Close"` (icone `close`)                                                                                              | Un pin selectionne (`selected`)          | P1       |
| 8   | Join Room                     | Mini-carte (action gauche)        | realtime-action / navigation | label `"Join Room"` (icone `mic`)                                                                                                         | `selected.liveRoomId !== null`           | P0       |
| 9   | Message                       | Mini-carte (action droite)        | navigation                   | label `"Message"` (icone `chat-bubble-outline`)                                                                                           | Un pin selectionne                       | P1       |

> Note : le marker "Your location" (#6) est rendu mais n'a pas de `onPress` — il n'est pas actionnable ; il est inclus pour completude et teste a minima cote accessibilite/lisibilite. Le header `MapTopAppBar` est purement decoratif (logo + titre "Chathouse"), sans aucun controle (pas de bouton retour : ecran d'onglet racine).

## Cas de test

### MAP-001 - Grant access relance la demande de permission (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, permission localisation precedemment refusee (`permission='denied'`), reseau Wi-Fi, GPS active au niveau OS, droit de re-demander disponible (`canAskAgain=true`).
- **Etapes** :
  1. Ouvrir l'onglet Carte ; l'EmptyState "Location permission needed" s'affiche avec le bouton "Grant access".
  2. Taper sur "Grant access".
  3. A l'invite de consentement "Location Consent", choisir "I Understand".
  4. A la boite systeme de permission, choisir "Autoriser".
- **Resultat attendu** : `requestAgain` (alias `start`) est invoque ; apres consentement et autorisation, `permission` passe a `granted`, l'EmptyState disparait et la carte se rend (Loader "Locating you" puis recentrage auto sur la position sous 1 s).
- **Critere d'acceptation (OK/KO)** : OK si la carte remplace l'EmptyState et le point bleu utilisateur apparait ; KO si l'EmptyState persiste apres autorisation.
- **Donnees de test** : compte `qa.standard@chathouse.test` / OTP `000000` ; position simulee 14.7,-17.5 (Dakar).
- **Duree estimee** : 3 min

### MAP-002 - Grant access : multi-clic rapide + refus systeme (limite)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, `permission='denied'`, GPS sans fix immediat, reseau 4G instable.
- **Etapes** :
  1. Sur l'EmptyState, taper 5 fois tres rapidement sur "Grant access".
  2. Sur la 1re invite de consentement, choisir "Not Now".
  3. Re-taper "Grant access", choisir "I Understand", puis refuser la permission systeme.
  4. Couper le reseau et re-taper "Grant access".
- **Resultat attendu** : aucun crash ni double-abonnement de watcher (le code fait `subRef.current?.remove()` avant un nouveau `watchPositionAsync`). "Not Now" → reste sur l'EmptyState `denied`. Refus systeme → reste `denied`. Une seule souscription de localisation active a la fois ; pas de fuite memoire.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran reste stable en `denied` apres les refus et qu'un seul watcher est actif (verifiable via logs `watchPositionAsync`) ; KO si crash, doublon de watcher ou ecran fige.
- **Donnees de test** : meme compte que MAP-001 ; basculer GPS OFF puis ON entre les taps.
- **Duree estimee** : 5 min

### MAP-003 - Grant access accessibilite (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack (Android) ou VoiceOver (iOS) actif, taille de police OS au max, contraste eleve, `permission='denied'`.
- **Etapes** :
  1. Activer le lecteur d'ecran, ouvrir l'onglet Carte.
  2. Balayer jusqu'au bouton et ecouter l'annonce.
  3. Double-taper pour activer.
  4. Verifier le rendu du libelle "Grant access" et du titre avec police 200 %.
- **Resultat attendu** : le lecteur annonce le label a11y "Try requesting location again" suivi de "bouton" (`accessibilityRole='button'`). Le texte "Grant access" et le titre restent lisibles sans troncature ; cible tactile >= 44pt ; le double-tap declenche `requestAgain`.
- **Critere d'acceptation (OK/KO)** : OK si annonce correcte + activation au double-tap + aucun chevauchement de texte ; KO sinon.
- **Donnees de test** : N/A (etat UI uniquement).
- **Duree estimee** : 4 min

### MAP-004 - Recherche filtre les pins par nom/username (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue, roster nearby contenant au moins 3 followers dont "Awa Ndiaye" (`@awa`) et "Cheikh Fall" (`@cheikh`), Wi-Fi.
- **Etapes** :
  1. Taper dans le champ "Find a friend".
  2. Saisir `awa`.
  3. Observer les markers restants.
  4. Effacer le champ.
- **Resultat attendu** : le filtre `matches` (insensible casse, sur `displayName` + `username`) ne laisse que les pins correspondant a "awa" ; les autres markers sont demontes. Champ vide → tous les pins du roster reapparaissent. Aucun appel reseau (filtre 100 % client).
- **Critere d'acceptation (OK/KO)** : OK si seul le pin de "Awa Ndiaye" reste sur "awa" et que tout revient au vidage ; KO si filtrage incorrect ou pins non mis a jour.
- **Donnees de test** : roster mock : `[{displayName:'Awa Ndiaye',username:'awa'},{displayName:'Cheikh Fall',username:'cheikh'},{displayName:'Moussa Ba',username:'moussa'}]`.
- **Duree estimee** : 3 min

### MAP-005 - Recherche sans resultat + saisie rapide (limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue, roster non vide, latence reseau elevee (le polling 45 s peut re-pull pendant la saisie).
- **Etapes** :
  1. Saisir tres vite une chaine sans correspondance, ex. `zzz123`.
  2. Coller un texte long (200 caracteres).
  3. Pendant la saisie, laisser le refresh roster (45 s) injecter de nouveaux followers.
- **Resultat attendu** : aucun marker affiche (filtre vide) sauf le point bleu utilisateur ; pas de crash ni de freeze sur saisie longue ; un refresh roster en cours ne reinitialise PAS le texte de recherche (etat `search` local) et reapplique le filtre sur le nouveau roster.
- **Critere d'acceptation (OK/KO)** : OK si 0 pin sur requete absente et le filtre persiste a travers un refresh roster ; KO si pins fantomes ou perte du texte saisi.
- **Donnees de test** : requete `zzz123` ; texte colle = 200x `a`.
- **Duree estimee** : 4 min

### MAP-006 - Recherche accessibilite (clavier lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver actif, police OS au max, contraste eleve, carte rendue.
- **Etapes** :
  1. Balayer jusqu'au champ de recherche.
  2. Ecouter l'annonce.
  3. Activer la saisie et taper `awa` via le clavier a l'ecran.
  4. Verifier le contraste du texte navy sur fond transparent et la lisibilite a 200 %.
- **Resultat attendu** : le lecteur annonce "Find a friend, champ de saisie" (accessibilityLabel `"Find a friend"`) ; `returnKeyType='search'` propose la touche Recherche ; le texte saisi reste lisible (couleur navy `#1E3A8A`) sans rognage du placeholder.
- **Critere d'acceptation (OK/KO)** : OK si annonce + saisie + lisibilite conformes ; KO si label manquant ou contraste insuffisant.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### MAP-007 - Recentrer sur ma position (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue avec `coords` valides (point bleu visible), utilisateur a deplace/panne la carte ailleurs, Wi-Fi.
- **Etapes** :
  1. Faire glisser la carte loin de la position utilisateur.
  2. Taper sur le bouton "Recenter map on my location" (icone cible, haut des controles droits).
  3. Observer l'animation.
- **Resultat attendu** : `handleRecenter` appelle `mapRef.animateToRegion(regionFor(coords), 800)` ; la carte se recentre en douceur (~800 ms) sur le point bleu avec un zoom `ZOOM_DELTA=0.01`. L'icone est navy (active).
- **Critere d'acceptation (OK/KO)** : OK si la carte revient sur la position utilisateur en ~0,8 s ; KO si aucun mouvement ou recentrage sur une mauvaise zone.
- **Donnees de test** : position 14.7,-17.5.
- **Duree estimee** : 2 min

### MAP-008 - Recentrer sans coords / multi-clic / re-demande (limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue MAIS `coords === null` (fix GPS perdu ou timeout 8 s, fallback Dakar), reseau coupe.
- **Etapes** :
  1. Constater le bouton recentrer en etat grise (`disabled` car `!coords`, icone secondaire `poiSecondary`).
  2. Taper plusieurs fois rapidement dessus.
  3. Retablir le GPS ; attendre un nouveau fix ; le bouton redevient actif.
  4. Taper a nouveau.
- **Resultat attendu** : tant que `!coords`, le bouton est `disabled` (opacite 0,6, `accessibilityState.disabled=true`) et les taps n'ont aucun effet — `onPress` non declenche. Note : si la carte est rendue avec `coords` puis on appelle `handleRecenter` sans coords, la fonction tente `requestAgain` ; ici le bouton est neutralise donc pas de boucle d'appel. Au retour du fix, le bouton s'active et recentre normalement.
- **Critere d'acceptation (OK/KO)** : OK si aucun effet/clic absorbe en etat disabled et reactivation propre apres fix ; KO si l'app tente d'animer vers null ou crash.
- **Donnees de test** : forcer perte GPS via mock `coords=null, ready=true`.
- **Duree estimee** : 4 min

### MAP-009 - Recentrer accessibilite (lecteur d'ecran + etats actif/desactive)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver actif, carte rendue, deux scenarios : `coords` present puis absent.
- **Etapes** :
  1. Balayer jusqu'au bouton recentrer avec `coords` present.
  2. Ecouter le label et le hint.
  3. Repeter avec `coords` absent (etat disabled).
- **Resultat attendu** : le lecteur annonce "Recenter map on my location, bouton" + hint "Re-centers the map on your current GPS position" ; en etat disabled il annonce l'etat "desactive" (`accessibilityState.disabled=true`) et n'est pas activable ; cible >= 44pt (BUTTON_SIZE 44).
- **Critere d'acceptation (OK/KO)** : OK si label + hint + etat disabled correctement annonces ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min

### MAP-010 - Toggle See -> Unsee (Ghost Mode ON) emet la visibilite (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, carte rendue, Ghost Mode initialement OFF (chip navy "SEE", `isGhost=false`), socket connecte, Wi-Fi.
- **Etapes** :
  1. Reperer le chip "SEE" (icone `visibility` navy) sous le bouton recentrer.
  2. Taper dessus.
  3. Observer le chip et le reseau.
- **Resultat attendu** : `toggle` → `setGhost(true)` ; persiste `1` dans SecureStore (cle `chathouse.ghostMode.v1`) ; emet `maps:toggle-visibility { isVisible:false }` ; PATCH `/users/me/visibility { isVisible:false }`. Le chip bascule sur "UNSEE" gris (icone `visibility-off`, `accessibilityState.checked=true`). `useLocationBroadcast` cesse d'emettre `maps:update-location`.
- **Critere d'acceptation (OK/KO)** : OK si chip→UNSEE + emit `maps:toggle-visibility{isVisible:false}` observe + PATCH 200 + plus aucun `maps:update-location` ; KO si l'un manque.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; intercepter le socket et `PATCH /users/me/visibility`.
- **Duree estimee** : 4 min

### MAP-011 - Toggle Ghost Mode : double-tap + echec reseau (limite)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, carte rendue, Ghost OFF, reseau coupe ou serveur renvoyant 500 sur `/users/me/visibility`.
- **Etapes** :
  1. Couper le reseau.
  2. Double-taper tres vite sur le chip See/Unsee.
  3. Retablir le reseau et taper une fois de plus.
- **Resultat attendu** : le garde `isToggling` empeche deux toggles concurrents (un seul flip par sequence d'appel ; le 2e tap pendant `isToggling` est ignore). En offline, l'emit socket et le PATCH echouent silencieusement (try/catch) MAIS l'etat local + SecureStore sont deja a jour (source de verite optimiste) : le chip reflete le choix. Au retour reseau, le tap suivant re-synchronise via un nouveau PATCH.
- **Critere d'acceptation (OK/KO)** : OK si pas de double-flip, chip coherent avec SecureStore, aucun crash en offline, re-sync au retour reseau ; KO si flip incoherent, exception non capturee, ou desync persistant.
- **Donnees de test** : forcer `PATCH /users/me/visibility` → 500 ; mode avion ON puis OFF.
- **Duree estimee** : 5 min

### MAP-012 - Toggle Ghost Mode accessibilite (role switch + checked)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver actif, police max, contraste eleve, carte rendue, Ghost OFF.
- **Etapes** :
  1. Balayer jusqu'au chip See/Unsee.
  2. Ecouter l'annonce en etat visible.
  3. Double-taper pour basculer.
  4. Re-ecouter l'annonce en etat masque.
- **Resultat attendu** : role `switch` annonce ; en visible "You are visible. Tap to hide." avec etat "non coche" (`checked=false`) ; apres bascule "You are hidden. Tap to reveal." avec etat "coche" (`checked=true`). Le label "SEE"/"UNSEE" et l'icone restent lisibles a 200 % ; cible >= 44pt (BUTTON_SIZE 46).
- **Critere d'acceptation (OK/KO)** : OK si role switch + label + etat checked annonces correctement aux deux etats ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### MAP-013 - Toggle Ghost Mode synchro multi-utilisateur (temps-reel)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes standard A et B, tous deux sur la Carte a proximite (< 25 km), socket connecte. A est visible et apparait comme pin sur la carte de B.
- **Etapes** :
  1. Sur B, confirmer que le pin de A est present.
  2. Sur A, taper "SEE" pour passer en "UNSEE" (Ghost ON).
  3. Observer la carte de B.
  4. Sur A, re-taper pour repasser visible et observer B (apres prochain `maps:update-location` / refresh roster 45 s).
- **Resultat attendu** : a l'activation de Ghost ON sur A, le serveur recoit `maps:toggle-visibility{isVisible:false}` et fan-out `maps:user-offline{userId:A}` → le pin de A disparait de la carte de B sans rechargement. Au retour visible + nouveau broadcast/refresh, le pin de A reapparait chez B.
- **Critere d'acceptation (OK/KO)** : OK si le pin de A disparait de B en quasi temps-reel a l'activation Ghost et reapparait apres retour visible ; KO si le pin persiste cote B malgre Ghost ON.
- **Donnees de test** : A=`qa.alice@chathouse.test`, B=`qa.bob@chathouse.test` ; positions a < 1 km l'une de l'autre.
- **Duree estimee** : 6 min

### MAP-014 - Tap pin follower ouvre la mini-carte et recentre (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue, au moins un follower "Awa Ndiaye" present sur la carte, Wi-Fi.
- **Etapes** :
  1. Localiser le pin avatar de "Awa Ndiaye".
  2. Taper dessus.
  3. Observer le recentrage et la mini-carte.
- **Resultat attendu** : `handlePinPress` met `selected=Awa` et anime la carte vers la position du pin (`animateToRegion`, 400 ms). La mini-carte s'affiche en bas (avatar, nom, presence/room) ; les controles flottants droits se relevent de `MINI_CARD_LIFT=120` pour ne pas etre masques.
- **Critere d'acceptation (OK/KO)** : OK si la mini-carte de "Awa Ndiaye" apparait et la carte se recentre sur son pin ; KO si rien ne s'ouvre ou mauvaise fiche.
- **Donnees de test** : follower `{id:'u_awa',displayName:'Awa Ndiaye',username:'awa',presence:'online',liveRoomId:null}`.
- **Duree estimee** : 2 min

### MAP-015 - Pin relocalise / disparait pendant interaction (limite + temps-reel)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue, follower "Awa" sur la carte, socket sujet a deltas et a deconnexion.
- **Etapes** :
  1. Taper le pin de "Awa" (mini-carte ouverte).
  2. Coter serveur, emettre `maps:user-moved{userId:'u_awa', lat, lng}` (deplacement).
  3. Puis emettre `maps:user-offline{userId:'u_awa'}` (Awa passe hors-ligne / ghost).
  4. Couper puis retablir le socket.
- **Resultat attendu** : sur `maps:user-moved`, le pin se deplace (presence repasse `online`, `lastSeenMinutesAgo=0`). Sur `maps:user-offline`, le pin est retire du roster. La mini-carte reste affichee avec le dernier `selected` (snapshot) jusqu'a fermeture manuelle ; aucun crash. A la reconnexion, le polling 45 s/le snapshot re-materialise les pins encore eligibles.
- **Critere d'acceptation (OK/KO)** : OK si deplacement et retrait du pin appliques sans crash et mini-carte stable ; KO si exception, pin fantome ou freeze.
- **Donnees de test** : payloads `{"userId":"u_awa","latitude":14.71,"longitude":-17.49}` puis `{"userId":"u_awa"}`.
- **Duree estimee** : 5 min

### MAP-016 - Pin follower accessibilite (label live / non-live)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver actif, carte rendue, deux followers : un en room live, un non-live.
- **Etapes** :
  1. Balayer jusqu'au pin du follower non-live.
  2. Ecouter l'annonce.
  3. Balayer jusqu'au pin live.
  4. Ecouter l'annonce, double-taper pour ouvrir.
- **Resultat attendu** : pin non-live annonce le `displayName` seul ; pin live annonce "`<displayName>, live`" (suffixe `, live`) avec role `button`. Le badge LIVE et l'avatar restent lisibles ; le double-tap ouvre la mini-carte.
- **Critere d'acceptation (OK/KO)** : OK si distinction live/non-live annoncee et ouverture au double-tap ; KO si label generique ou pin non focalisable.
- **Donnees de test** : live `{displayName:'Cheikh Fall',liveRoomId:'room_42'}` ; non-live `{displayName:'Awa Ndiaye',liveRoomId:null}`.
- **Duree estimee** : 4 min

### MAP-017 - Marker "Your location" affichage et lisibilite (lecture seule)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver actif, carte rendue avec `coords` present (point bleu pulse visible).
- **Etapes** :
  1. Balayer jusqu'au marker de position utilisateur.
  2. Ecouter l'annonce.
  3. Verifier le contraste du point bleu (`#4A80F5` + anneau blanc) sur les tuiles.
- **Resultat attendu** : le marker annonce "Your location" (`explorer.maps.yourLocationA11y`). Il n'a pas d'action (pas de `onPress`) : aucune navigation au double-tap. Le point reste visible et contraste sur fond clair et sombre des tuiles.
- **Critere d'acceptation (OK/KO)** : OK si annonce "Your location" + aucune action + contraste suffisant ; KO si label absent ou point invisible.
- **Donnees de test** : N/A.
- **Duree estimee** : 2 min

### MAP-018 - Fermer la mini-carte (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, carte rendue, un pin selectionne (mini-carte ouverte), Wi-Fi.
- **Etapes** :
  1. Ouvrir la mini-carte en tapant un pin.
  2. Taper l'icone "Close" (croix, haut droite de la carte).
- **Resultat attendu** : `handleCloseCard` met `selected=null` ; la mini-carte se demonte ; les controles flottants droits redescendent (suppression du `MINI_CARD_LIFT`).
- **Critere d'acceptation (OK/KO)** : OK si la mini-carte disparait et les controles reviennent a leur position basse ; KO si la carte reste affichee.
- **Donnees de test** : follower `Awa Ndiaye`.
- **Duree estimee** : 1 min

### MAP-019 - Fermer mini-carte : multi-clic + reouverture (limite)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard, carte rendue, mini-carte ouverte.
- **Etapes** :
  1. Taper "Close" 5 fois tres rapidement.
  2. Re-taper aussitot un pin pour rouvrir.
  3. Pendant l'ouverture, un `maps:user-offline` retire le follower selectionne.
- **Resultat attendu** : les taps superflus sur "Close" sont sans effet (selected deja null) ; pas de crash. Reouverture OK. Si le follower selectionne est retire du roster par `maps:user-offline`, la mini-carte conserve le snapshot `selected` (l'objet n'est pas dans le roster mais reste reference) ; "Close" la ferme proprement.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash, etat coherent et fermeture toujours possible ; KO si exception ou carte bloquee.
- **Donnees de test** : payload offline `{"userId":"u_awa"}`.
- **Duree estimee** : 3 min

### MAP-020 - Fermer mini-carte accessibilite (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver actif, police max, mini-carte ouverte.
- **Etapes** :
  1. Balayer jusqu'a l'icone de fermeture.
  2. Ecouter l'annonce.
  3. Double-taper.
- **Resultat attendu** : le lecteur annonce "Close, bouton" (`accessibilityLabel='Close'`, role `button`) ; `hitSlop=8` garantit une cible confortable ; le double-tap ferme la mini-carte.
- **Critere d'acceptation (OK/KO)** : OK si annonce "Close" + fermeture au double-tap ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 2 min

### MAP-021 - Join Room depuis la mini-carte (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, micro autorise, follower "Cheikh Fall" en room live (`liveRoomId='room_42'`, `liveRoomTitle='Tech Talks'`), socket + LiveKit operationnels, Wi-Fi.
- **Etapes** :
  1. Taper le pin live de "Cheikh Fall".
  2. Dans la mini-carte, taper "Join Room".
- **Resultat attendu** : `handleJoinRoom('room_42')` met `selected=null` et navigue vers `Main > RoomsTab > Room { roomId:'room_42' }`. L'ecran Room s'ouvre et lance la connexion audio LiveKit a la room. La mini-carte est fermee.
- **Critere d'acceptation (OK/KO)** : OK si navigation vers Room room_42 + connexion audio initiee ; KO si pas de navigation ou mauvais roomId.
- **Donnees de test** : `{id:'u_cheikh',displayName:'Cheikh Fall',liveRoomId:'room_42',liveRoomTitle:'Tech Talks'}`.
- **Duree estimee** : 3 min

### MAP-022 - Join Room : room fermee entre-temps + multi-clic + perte reseau (limite)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, mini-carte d'un follower live ouverte, reseau instable / room sur le point de fermer.
- **Etapes** :
  1. Taper "Join Room" 5 fois tres rapidement.
  2. Simuler la fermeture de `room_42` cote serveur juste avant l'arrivee sur l'ecran Room.
  3. Couper le reseau pendant la connexion LiveKit puis le retablir.
- **Resultat attendu** : un seul `selected=null` + une seule navigation (les taps suivants n'ont plus de cible car la mini-carte est demontee). Si la room est fermee, l'ecran Room gere l'erreur (message room indisponible / retour) — la Carte n'orchestre que la navigation. Perte reseau → l'ecran Room tente la reconnexion LiveKit ; pas de crash cote Carte.
- **Critere d'acceptation (OK/KO)** : OK si navigation unique, pas de double-join, gestion gracieuse de la room fermee/offline ; KO si double navigation, crash ou etat audio incoherent.
- **Donnees de test** : `roomId='room_42'` ferme via API admin avant l'arrivee.
- **Duree estimee** : 5 min

### MAP-023 - Join Room accessibilite (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver actif, police max, contraste eleve, mini-carte d'un follower live ouverte.
- **Etapes** :
  1. Balayer jusqu'au bouton "Join Room".
  2. Ecouter l'annonce.
  3. Double-taper.
  4. Verifier le rendu du label + icone micro a 200 %.
- **Resultat attendu** : le lecteur annonce "Join Room, bouton" (Button derive le label a11y du texte, role `button`). Le double-tap declenche `handleJoinRoom`. Le libelle "Join Room" et l'icone `mic` restent lisibles, cible >= 44pt (taille `sm` respecte le minimum 44pt).
- **Critere d'acceptation (OK/KO)** : OK si annonce + activation + lisibilite conformes ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min

### MAP-024 - Join Room synchro multi-utilisateur (temps-reel)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes A et B ; B est dans la room live `room_42` (deja sur l'ecran Room) ; A est sur la Carte et voit le pin live de B ; LiveKit + socket OK.
- **Etapes** :
  1. Sur A, taper le pin live de B puis "Join Room".
  2. Observer l'ecran Room cote A (arrivee dans room_42).
  3. Observer cote B la liste des participants.
- **Resultat attendu** : A rejoint `room_42` et se connecte a la piste audio LiveKit ; B voit A apparaitre dans la liste des participants en quasi temps-reel (evenement participant-joined). L'audio est bidirectionnel une fois A non-mute.
- **Critere d'acceptation (OK/KO)** : OK si A entre dans room_42 et B le voit rejoindre + audio etabli ; KO si A n'entre pas ou B ne voit pas la mise a jour.
- **Donnees de test** : A=`qa.alice@chathouse.test`, B=`qa.bob@chathouse.test`, room `room_42`.
- **Duree estimee** : 6 min

### MAP-025 - Message depuis la mini-carte ouvre le DM (succes)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, mini-carte d'un follower "Awa Ndiaye" (`id='u_awa'`) ouverte, Wi-Fi.
- **Etapes** :
  1. Taper le pin de "Awa Ndiaye".
  2. Dans la mini-carte, taper "Message".
- **Resultat attendu** : `handleSendMessage('u_awa')` met `selected=null` et navigue vers `Main > MessagesTab > ChatDetail { conversationId:'u_awa' }` (le DM est keye par le userId du pair). Le fil de discussion avec Awa s'ouvre. Si aucun follower n'est en live, "Message" est l'unique action (variant `primary`, pleine largeur).
- **Critere d'acceptation (OK/KO)** : OK si navigation vers ChatDetail avec conversationId='u_awa' ; KO si pas de navigation ou mauvais conversationId.
- **Donnees de test** : `{id:'u_awa',displayName:'Awa Ndiaye'}`.
- **Duree estimee** : 2 min

### MAP-026 - Message : multi-clic rapide + perte reseau (limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, mini-carte ouverte, reseau instable.
- **Etapes** :
  1. Taper "Message" 5 fois tres rapidement.
  2. Couper le reseau pendant l'ouverture du fil DM puis le retablir.
- **Resultat attendu** : un seul `selected=null` + une seule navigation vers ChatDetail (mini-carte demontee apres le 1er tap). En offline, l'ecran ChatDetail gere le chargement de l'historique (cache/erreur) — la Carte n'orchestre que la navigation. Aucune double-pile de navigation, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si navigation unique et gestion gracieuse offline ; KO si double-navigation ou crash.
- **Donnees de test** : `conversationId='u_awa'` ; mode avion ON/OFF.
- **Duree estimee** : 4 min

### MAP-027 - Message accessibilite (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : TalkBack/VoiceOver actif, police max, contraste eleve, mini-carte ouverte.
- **Etapes** :
  1. Balayer jusqu'au bouton "Message".
  2. Ecouter l'annonce.
  3. Double-taper.
  4. Verifier label + icone bulle a 200 %.
- **Resultat attendu** : le lecteur annonce "Message, bouton" (role `button`) ; double-tap → `handleSendMessage`. Le libelle "Message" et l'icone `chat-bubble-outline` restent lisibles ; cible >= 44pt. En presence d'un bouton "Join Room" adjacent, l'ordre de focus est logique (Join Room puis Message).
- **Critere d'acceptation (OK/KO)** : OK si annonce + activation + ordre de focus + lisibilite conformes ; KO sinon.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min

### MAP-028 - Etat "location disabled" lecture seule (pas de bouton)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, services GPS desactives au niveau OS (`hasServicesEnabledAsync=false` → `permission='disabled'`), TalkBack/VoiceOver actif.
- **Etapes** :
  1. Desactiver la localisation systeme.
  2. Ouvrir l'onglet Carte.
  3. Balayer le contenu avec le lecteur d'ecran.
- **Resultat attendu** : EmptyState "Turn on location services" + corps explicatif "Enable GPS in your device settings...". Cet etat n'a AUCUN bouton (lecture seule) ; aucune action declenchee. Le titre et le corps sont annonces et lisibles a 200 %.
- **Critere d'acceptation (OK/KO)** : OK si EmptyState informatif sans bouton, lisible au lecteur d'ecran ; KO si bouton fantome ou texte tronque.
- **Donnees de test** : N/A.
- **Duree estimee** : 2 min
