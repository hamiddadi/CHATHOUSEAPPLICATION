# 15 - Playground (extensions) (`extensions`)

## Contexte ecran

- **Fichier** : `src/features/extensions/screens/ExtPlaygroundScreen.tsx`.
- **Nature** : ecran de developpement / banc d'essai QA. Il rend chaque composant d'extension (vagues V1 a V13) en isolation pour qu'un testeur verifie visuellement le rendu sur un vrai device. Le commentaire d'en-tete precise : _"Pure additive — never wired into the legacy navigator by default"_. Il n'est donc PAS branche dans le navigateur principal et doit etre monte comme **route temporaire** pendant une passe QA (dev-client EAS recommande car l'audio LiveKit et certains modules natifs n'existent pas en Expo Go).
- **Structure** : un `SafeAreaView` + `ScrollView` (defilement vertical). Aucun header de navigation, aucun bouton retour/fermer natif rendu par l'ecran lui-meme (la fermeture depend de la route hote qui le monte). C'est un ecran sans barre d'action propre : il agrege des sous-composants, chacun avec ses propres boutons.
- **Roles requis** : aucune restriction de role dans le code. Accessible des qu'on est authentifie (les appels reseau `wave`, `chatReactionsApi`, `badgesApi`, `shareApi`, `calendarApi` passent par `apiClient` qui injecte le token). En pratique : `standard` ou `admin`. `guest` peut afficher l'UI mais les actions reseau echoueront (401) si non connecte.
- **Comportements temps-reel / reseau** :
  - **Wave** (`useExtWave`) : `POST /users/:id/wave` (fallbacks `/social/wave/:id`, `/ext/presence/wave/:id`). Ping social qui declenche une notification cote cible. Realtime (push). NB : le bouton "Wave" n'est rendu QUE si `useExtAvailablePeople` renvoie des donnees non vides ; sur le playground avec un compte sans presence, la strip rend `null` et le bouton est absent.
  - **Chat reactions bar** : `POST /ext/chat-reactions/:messageId/toggle` avec update optimiste + reconciliation serveur + rollback. Quasi temps-reel (effet collaboratif si plusieurs utilisateurs reagissent au meme message).
  - **Badges row** : `GET` (fetch a l'affichage). Non interactif (Views, pas de Pressable) — rend `null` si liste vide.
  - **Share sheet** : `shareApi.forRoom(roomId)` (fetch des liens pre-remplis) puis `Linking.openURL` / `Share.share`.
  - **Calendar export** : `Linking.openURL(calendarApi.icsUrl(roomId))`.
  - **Social deep-links** : `Linking` vers `twitter://` / `instagram://` avec fallback web.
  - **Linkified text** : `Linking.openURL` sur URL detectee.
- **Pre-conditions globales** : route playground montee, backend joignable (`apiClient` configure sur l'IP LAN du `.env` racine), compte authentifie pour les actions reseau.
- **Etats de donnees pertinents** :
  - _Liste vide / presence vide_ : `ExtAvailablePeopleStrip` -> `null` (pas de bouton Wave) ; `ExtUpcomingForYouStrip` -> affiche `upcomingEmpty` ; `ExtBadgesRow` -> `null`.
  - _Hors-ligne_ : wave -> `lastResult='error'` ; share sheet -> "Failed to build share links." ; deep-links/calendar -> echec silencieux (swallow).
  - _Reactions_ : `initial` est mocke en dur (`❤️`:4 byMe, `🔥`:2, `😂`:1) donc les chips s'affichent toujours sur le playground.

## Matrice bouton

| #   | Bouton                               | Emplacement                        | Type            | Locator reel                                                             | Pre-condition                      | Priorite |
| --- | ------------------------------------ | ---------------------------------- | --------------- | ------------------------------------------------------------------------ | ---------------------------------- | -------- |
| 1   | Segment theme "Auto"                 | Corps / section V2 toggle          | toggle          | `accessibilityLabel="Theme mode Auto"`                                   | aucune                             | P1       |
| 2   | Segment theme "Light"                | Corps / section V2 toggle          | toggle          | `accessibilityLabel="Theme mode Light"`                                  | aucune                             | P1       |
| 3   | Segment theme "Dark"                 | Corps / section V2 toggle          | toggle          | `accessibilityLabel="Theme mode Dark"`                                   | aucune                             | P1       |
| 4   | Lien URL `https://clubhouse.com`     | Corps / section V1 linkified       | link            | `accessibilityLabel="Open link https://clubhouse.com"`                   | navigateur/handler installe        | P2       |
| 5   | Lien URL `chathouse.app/r/demo`      | Corps / section V1 linkified       | link            | `accessibilityLabel="Open link chathouse.app/r/demo"`                    | navigateur/handler installe        | P2       |
| 6   | Ouvrir Twitter                       | Corps / section V1 deep-links      | navigation      | `t('extensions.playground.openTwitter')` = "Open @clubhouse on Twitter"  | app Twitter/X ou navigateur        | P1       |
| 7   | Ouvrir Instagram                     | Corps / section V1 deep-links      | navigation      | `t('extensions.playground.openInstagram')` = "Open @instagram"           | app Instagram ou navigateur        | P1       |
| 8   | Wave a un utilisateur (conditionnel) | Corps / section V1 people strip    | realtime-action | `accessibilityLabel="Wave to <name>"`                                    | presence non vide + connecte       | P0       |
| 9   | Champ Room ID                        | Corps / section V8 calendar        | input-submit    | `TextInput` value=`pickedRoomId` (defaut "demo-room-1")                  | aucune                             | P1       |
| 10  | Add to Calendar                      | Corps / section V8 calendar        | submit          | `accessibilityLabel="Add to Calendar"`                                   | roomId valide + handler calendrier | P1       |
| 11  | Open share sheet                     | Corps / section V8 share           | menu            | `t('extensions.playground.openShareSheet')` = "Open share sheet"         | aucune                             | P1       |
| 12  | Share via Twitter / X                | Modale share sheet                 | link            | `accessibilityLabel="Share via Twitter / X"`                             | liens charges + connecte           | P1       |
| 13  | Share via WhatsApp                   | Modale share sheet                 | link            | `accessibilityLabel="Share via WhatsApp"`                                | liens charges + WhatsApp installe  | P1       |
| 14  | Share via Telegram                   | Modale share sheet                 | link            | `accessibilityLabel="Share via Telegram"`                                | liens charges + Telegram installe  | P1       |
| 15  | Share via More… (system)             | Modale share sheet                 | link            | `accessibilityLabel="Share via More…"`                                   | liens charges                      | P1       |
| 16  | Cancel (share sheet)                 | Modale share sheet                 | navigation      | texte "Cancel" (Pressable sans label)                                    | sheet ouvert                       | P2       |
| 17  | Backdrop fermer (share)              | Modale share sheet                 | navigation      | backdrop `Pressable` `onPress=onClose`                                   | sheet ouvert                       | P2       |
| 18  | Open reaction picker                 | Corps / section V10 picker         | menu            | `t('extensions.playground.openReactionPicker')` = "Open reaction picker" | aucune                             | P1       |
| 19  | Reaction emoji ❤️                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with ❤️"`                                     | picker ouvert                      | P1       |
| 20  | Reaction emoji 👏                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with 👏"`                                     | picker ouvert                      | P2       |
| 21  | Reaction emoji 🔥                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with 🔥"`                                     | picker ouvert                      | P2       |
| 22  | Reaction emoji 😂                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with 😂"`                                     | picker ouvert                      | P2       |
| 23  | Reaction emoji 🙏                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with 🙏"`                                     | picker ouvert                      | P2       |
| 24  | Reaction emoji 🎉                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with 🎉"`                                     | picker ouvert                      | P2       |
| 25  | Reaction emoji ✨                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with ✨"`                                     | picker ouvert                      | P2       |
| 26  | Reaction emoji 🤯                    | Modale reaction picker             | realtime-action | `accessibilityLabel="React with 🤯"`                                     | picker ouvert                      | P2       |
| 27  | Backdrop fermer (picker)             | Modale reaction picker             | navigation      | backdrop `Pressable` `onPress=onClose`                                   | picker ouvert                      | P2       |
| 28  | Champ Interests                      | Corps / section V2 validator       | input-submit    | `TextInput` value=`interestsInput` placeholder `interestsPlaceholder`    | aucune                             | P1       |
| 29  | Back-to-room (tap retour room)       | Corps / section V10 banner         | navigation      | `accessibilityLabel="Back to the active room"`                           | banner visible                     | P0       |
| 30  | Toggle mute (banner)                 | Corps / section V10 banner         | realtime-action | `accessibilityLabel="Mute microphone"` (ou "Unmute microphone")          | banner visible                     | P0       |
| 31  | Leave room (banner)                  | Corps / section V10 banner         | destructive     | `accessibilityLabel="Leave room"`                                        | banner visible                     | P0       |
| 32  | Chip reaction ❤️                     | Corps / section V13 chat reactions | realtime-action | `accessibilityLabel="4 reactions ❤️, you reacted"`                       | aucune (initial mocke)             | P1       |
| 33  | Chip reaction 🔥                     | Corps / section V13 chat reactions | realtime-action | `accessibilityLabel="2 reactions 🔥"`                                    | aucune (initial mocke)             | P1       |
| 34  | Chip reaction 😂                     | Corps / section V13 chat reactions | realtime-action | `accessibilityLabel="1 reactions 😂"`                                    | aucune (initial mocke)             | P1       |

> Note : sur le playground les boutons mute/leave du banner sont rendus car `onToggleMute` et `onLeave` recoivent `() => undefined` (truthy). Ils ne declenchent rien (no-op) en mode playground — mais on les teste pour valider rendu + a11y + l'integration future. Le bouton "Wave" (#8) n'apparait que si la presence n'est pas vide. La `ExtBadgesRow` (V13) est purement presentationnelle (pas de Pressable) — non listee comme bouton.

## Cas de test

### EXT-PLAY-001 - Selectionner le mode de theme "Dark"

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, playground monte, reseau Wi-Fi, aucune permission speciale
- **Etapes** :
  1. Ouvrir le playground et faire defiler jusqu'a "V2 — Theme toggle".
  2. Taper sur le segment "Dark" (`Theme mode Dark`).
  3. Observer l'etat du segment.
- **Resultat attendu** : le segment "Dark" passe a l'etat actif (`accessibilityState.selected=true`, style `segmentActive`), les deux autres deviennent inactifs ; le mode est persiste via `ExtThemeProvider` (AsyncStorage).
- **Critere d'acceptation (OK/KO)** : OK si seul "Dark" est marque selectionne et le choix survit a un re-render. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### EXT-PLAY-002 - Tapotage rapide alternant Auto/Light/Dark

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, playground monte, reseau avec latence simulee 1s
- **Etapes** :
  1. Aller a la section theme toggle.
  2. Taper tres rapidement et en alternance sur "Auto", "Light", "Dark", "Auto" (8 taps en < 2 s).
  3. Couper le reseau pendant les taps puis le retablir.
- **Resultat attendu** : aucun crash, un seul segment actif a la fin (le dernier tape) ; pas d'etat incoherent (deux segments actifs). La persistance AsyncStorage est locale donc insensible au reseau.
- **Critere d'acceptation (OK/KO)** : OK si exactement un segment est selectionne et l'app reste stable. KO si double-selection ou crash.
- **Donnees de test** : sequence Auto->Light->Dark->Auto
- **Duree estimee** : 3 min

### EXT-PLAY-003 - Accessibilite du toggle de theme (radiogroup)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, TalkBack (Android) ou VoiceOver (iOS) actif, police systeme a 200%, contraste eleve
- **Etapes** :
  1. Activer le lecteur d'ecran et naviguer par balayage jusqu'au groupe theme.
  2. Verifier que le conteneur est annonce comme `radiogroup` et chaque segment comme `radio`.
  3. Selectionner "Light" et ecouter l'annonce d'etat.
- **Resultat attendu** : annonce "Theme mode Auto / Light / Dark" pour chaque segment, etat "selectionne" annonce pour l'actif ; labels emoji + texte lisibles a 200% sans troncature bloquante.
- **Critere d'acceptation (OK/KO)** : OK si role radiogroup/radio + etat selected annonces et libelles lisibles. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### EXT-PLAY-004 - Ouvrir une URL detectee dans le texte linkifie

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, navigateur installe, Wi-Fi
- **Etapes** :
  1. Aller a "V1 — Linkified text".
  2. Taper sur le lien souligne `https://clubhouse.com` (`Open link https://clubhouse.com`).
- **Resultat attendu** : `Linking.openURL` ouvre `https://clubhouse.com` dans le navigateur/handler ; l'app reste en arriere-plan.
- **Critere d'acceptation (OK/KO)** : OK si le navigateur s'ouvre sur l'URL exacte. KO sinon.
- **Donnees de test** : `https://clubhouse.com`
- **Duree estimee** : 2 min

### EXT-PLAY-005 - Lien bare-domain sans schema + double-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard, navigateur installe, reseau coupe puis retabli
- **Etapes** :
  1. Aller a "V1 — Linkified text".
  2. Taper deux fois tres vite sur `chathouse.app/r/demo` (`Open link chathouse.app/r/demo`).
  3. Repeter une fois le reseau coupe.
- **Resultat attendu** : le schema `https://` est prefixe automatiquement (`ensureScheme`) ; pas de double ouverture ni crash ; en cas d'echec `Linking` l'erreur est avalee (catch silencieux) sans toast d'erreur.
- **Critere d'acceptation (OK/KO)** : OK si au plus une ouverture vers `https://chathouse.app/r/demo` et aucune exception. KO sinon.
- **Donnees de test** : `chathouse.app/r/demo`
- **Duree estimee** : 3 min

### EXT-PLAY-006 - Accessibilite des liens linkifies (role link)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%
- **Etapes** :
  1. Naviguer au lecteur d'ecran jusqu'au paragraphe linkifie.
  2. Verifier que chaque URL est annoncee comme "lien" avec le label "Open link <url>".
- **Resultat attendu** : role `link` annonce, label explicite, le texte non-lien reste lisible et le focus se pose distinctement sur chaque URL.
- **Critere d'acceptation (OK/KO)** : OK si chaque URL est focusable et annoncee comme lien. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### EXT-PLAY-007 - Ouvrir le handle Twitter @clubhouse

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, app Twitter/X installee, Wi-Fi
- **Etapes** :
  1. Aller a "V1 — Social deep-links".
  2. Taper "Open @clubhouse on Twitter" (`extensions.playground.openTwitter`).
- **Resultat attendu** : `canOpenURL('twitter://user?screen_name=clubhouse')` reussit -> ouverture in-app du profil ; sinon fallback `https://x.com/clubhouse` dans le navigateur.
- **Critere d'acceptation (OK/KO)** : OK si le profil @clubhouse s'ouvre (app ou web). KO sinon.
- **Donnees de test** : handle `@clubhouse`
- **Duree estimee** : 2 min

### EXT-PLAY-008 - Deep-link Instagram sans app installee + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, app Instagram NON installee, navigateur present, reseau instable
- **Etapes** :
  1. Aller a "V1 — Social deep-links".
  2. Taper rapidement 3 fois "Open @instagram" (`extensions.playground.openInstagram`).
  3. Simuler la perte reseau pendant la 2e tentative.
- **Resultat attendu** : `canOpenURL('instagram://...')` echoue -> fallback `https://instagram.com/instagram` ; pas de double ouverture parasite, pas de crash ; si `openURL` echoue (hors-ligne) l'erreur n'est pas avalee par `openWithFallback` final mais ne fait pas planter l'app (rejet de promesse non bloquant via `void`).
- **Critere d'acceptation (OK/KO)** : OK si fallback web declenche au plus une fois et app stable. KO si crash ou multiples ouvertures.
- **Donnees de test** : handle `instagram`
- **Duree estimee** : 3 min

### EXT-PLAY-009 - Accessibilite des boutons deep-links sociaux

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Balayer jusqu'aux deux boutons sociaux.
  2. Verifier l'annonce du label et du role bouton, et que les libelles ne sont pas tronques a 200%.
- **Resultat attendu** : "Open @clubhouse on Twitter" et "Open @instagram" annonces comme boutons ; cibles tactiles >= 44pt.
- **Critere d'acceptation (OK/KO)** : OK si les deux boutons sont focusables, annonces et lisibles. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### EXT-PLAY-010 - Envoyer un Wave a un utilisateur disponible

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard connecte, presence non vide (au moins 1 utilisateur dispo retourne par `useExtAvailablePeople`), Wi-Fi, backend up
- **Etapes** :
  1. S'assurer que la strip "People available to chat" affiche au moins une carte (sinon seeder un user en ligne).
  2. Taper "Wave to <name>" (`accessibilityLabel="Wave to <name>"`).
  3. Observer le statut sous la strip ("Wave status").
- **Resultat attendu** : `POST /users/<id>/wave` envoye ; statut passe "sending…" (`waving`) puis "ok" (`lastResult`) ; cote utilisateur cible une notification push est recue.
- **Critere d'acceptation (OK/KO)** : OK si requete 2xx et statut final "ok" + notification cote cible. KO sinon.
- **Donnees de test** : userId cible ex. `user-1` ; endpoint `/users/user-1/wave`
- **Duree estimee** : 4 min

### EXT-PLAY-011 - Wave en double-clic rapide et en perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard connecte, presence non vide, bascule Wi-Fi -> hors-ligne
- **Etapes** :
  1. Taper deux fois tres vite "Wave to <name>".
  2. Couper le reseau, retaper.
  3. Retablir le reseau.
- **Resultat attendu** : pendant `pending` le statut reste "sending…" ; en hors-ligne `lastResult` devient "error" (pas de fallback infini : 404/405 -> endpoint suivant, autre erreur/network -> arret immediat) ; pas de double notification ; aucun crash.
- **Critere d'acceptation (OK/KO)** : OK si une seule notification max, statut "error" en hors-ligne, app stable. KO si double-wave, boucle, ou crash.
- **Donnees de test** : userId `user-1`
- **Duree estimee** : 5 min

### EXT-PLAY-012 - Accessibilite du bouton Wave

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, presence non vide, lecteur d'ecran actif, police 200%
- **Etapes** :
  1. Balayer jusqu'a la carte d'un utilisateur dispo.
  2. Verifier l'annonce "Wave to <name>" + role bouton.
- **Resultat attendu** : carte annoncee avec le nom de l'utilisateur ; nom tronque a 1 ligne mais label a11y complet ; cible >= 44pt.
- **Critere d'acceptation (OK/KO)** : OK si label dynamique avec le nom + role bouton. KO sinon.
- **Donnees de test** : displayName "Alice"
- **Duree estimee** : 3 min

### EXT-PLAY-013 - Wave multi-utilisateur (synchro notification)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 devices/comptes (A=emetteur standard, B=cible standard), tous deux connectes, notifications autorisees cote B
- **Etapes** :
  1. Sur A, ouvrir le playground avec presence affichant B.
  2. Taper "Wave to B".
  3. Observer le device B.
- **Resultat attendu** : statut "ok" sur A ; sur B une notification push "wave" arrive en quasi temps reel (proposant de creer une room privee).
- **Critere d'acceptation (OK/KO)** : OK si B recoit la notification < 5 s apres le tap de A. KO sinon.
- **Donnees de test** : A=`alice`, B=`bob`
- **Duree estimee** : 6 min

### EXT-PLAY-014 - Modifier le Room ID puis exporter le calendrier

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, app calendrier installee, Wi-Fi
- **Etapes** :
  1. Aller a "V8 — Calendar .ics export".
  2. Effacer le champ Room ID et saisir `room-qa-42`.
  3. Taper "Add to Calendar" (`accessibilityLabel="Add to Calendar"`).
- **Resultat attendu** : `Linking.openURL(calendarApi.icsUrl('room-qa-42'))` -> l'app calendrier propose d'ajouter l'evenement ; pendant le chargement un `ActivityIndicator` remplace le contenu et le bouton est `disabled`.
- **Critere d'acceptation (OK/KO)** : OK si le calendrier s'ouvre avec l'.ics du bon roomId. KO sinon.
- **Donnees de test** : roomId `room-qa-42`
- **Duree estimee** : 3 min

### EXT-PLAY-015 - Calendar export avec roomId vide + double-tap hors-ligne

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, reseau coupe, aucune app calendrier (ou handler manquant)
- **Etapes** :
  1. Vider completement le champ Room ID.
  2. Taper deux fois rapidement "Add to Calendar".
  3. Retablir le reseau.
- **Resultat attendu** : pendant `busy=true` le bouton est `disabled` -> le 2e tap est ignore ; si `Linking.openURL` echoue, l'erreur est avalee (catch) et `busy` revient a false (finally) ; pas de crash ni toast.
- **Critere d'acceptation (OK/KO)** : OK si une seule tentative d'ouverture max et le bouton se reactive. KO si double ouverture ou bouton bloque en spinner.
- **Donnees de test** : roomId `` (vide)
- **Duree estimee** : 3 min

### EXT-PLAY-016 - Accessibilite du bouton Calendar + champ Room ID

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Balayer jusqu'au label "Room ID:" et au champ texte.
  2. Saisir une valeur via le clavier a l'ecran sans capitalisation auto (`autoCapitalize="none"`).
  3. Balayer jusqu'au bouton et verifier "Add to Calendar" + role bouton ; verifier l'etat disabled annonce pendant le chargement.
- **Resultat attendu** : champ saisi proprement, bouton annonce "Add to Calendar", spinner annonce "occupe/disabled" pendant l'export.
- **Critere d'acceptation (OK/KO)** : OK si label/role/etat disabled correctement exposes. KO sinon.
- **Donnees de test** : roomId `demo-room-1`
- **Duree estimee** : 4 min

### EXT-PLAY-017 - Ouvrir la share sheet et partager via Twitter

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, backend up (`shareApi.forRoom`), app Twitter/X installee, Wi-Fi
- **Etapes** :
  1. Aller a "V8 — Share sheet", taper "Open share sheet" (`extensions.playground.openShareSheet`).
  2. Attendre la fin du chargement des liens (le spinner disparait).
  3. Taper "Share via Twitter / X" (`Share via Twitter / X`).
- **Resultat attendu** : `shareApi.forRoom(pickedRoomId)` renvoie les liens ; `Linking.openURL(links.twitter)` ouvre le composer Twitter pre-rempli ; la sheet se ferme apres l'action (`finally onClose`).
- **Critere d'acceptation (OK/KO)** : OK si composer Twitter ouvert avec lien room + sheet fermee. KO sinon.
- **Donnees de test** : roomId `demo-room-1`
- **Duree estimee** : 3 min

### EXT-PLAY-018 - Share sheet : echec de chargement des liens (hors-ligne)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, reseau coupe AVANT l'ouverture, backend injoignable
- **Etapes** :
  1. Couper le reseau.
  2. Taper "Open share sheet".
  3. Observer le contenu de la sheet ; taper rapidement plusieurs fois sur le backdrop.
- **Resultat attendu** : pendant le fetch un `ActivityIndicator` ; en cas d'echec `forRoom` (catch) -> message "Failed to build share links." et aucune ligne de partage ; taper le backdrop ferme la sheet (`onClose`) sans crash.
- **Critere d'acceptation (OK/KO)** : OK si message d'erreur affiche et fermeture propre. KO si sheet vide sans message ou crash.
- **Donnees de test** : roomId `demo-room-1`
- **Duree estimee** : 4 min

### EXT-PLAY-019 - Share via Telegram non installe + Cancel

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, Telegram NON installe, liens charges
- **Etapes** :
  1. Ouvrir la share sheet et attendre les liens.
  2. Taper "Share via Telegram" (`Share via Telegram`).
  3. Si la sheet reste, taper "Cancel".
- **Resultat attendu** : `Linking.openURL(links.telegram)` rejette (app absente) -> erreur avalee (catch) ET `finally onClose` ferme quand meme la sheet (le code corrige fermait l'ancienne sheet ouverte sur erreur) ; "Cancel" ferme sans action.
- **Critere d'acceptation (OK/KO)** : OK si la sheet se ferme apres l'echec Telegram et "Cancel" ferme proprement. KO si la sheet reste ouverte bloquee.
- **Donnees de test** : roomId `demo-room-1`
- **Duree estimee** : 3 min

### EXT-PLAY-020 - Accessibilite de la share sheet

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%
- **Etapes** :
  1. Ouvrir la share sheet.
  2. Balayer les options : "Share via Twitter / X", "Share via WhatsApp", "Share via Telegram", "Share via More…".
  3. Verifier le focus piege dans la modale et le titre "Share this room".
- **Resultat attendu** : chaque ligne annoncee avec son label "Share via <cible>" + role bouton ; le backdrop fermable ; focus gere correctement a l'ouverture/fermeture.
- **Critere d'acceptation (OK/KO)** : OK si les 4 options + Cancel sont annoncees et atteignables au lecteur d'ecran. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### EXT-PLAY-021 - Ouvrir le reaction picker et choisir un emoji

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, playground monte, Wi-Fi
- **Etapes** :
  1. Aller a "V10 — Reaction picker", taper "Open reaction picker" (`extensions.playground.openReactionPicker`).
  2. Dans la pilule, taper l'emoji ❤️ (`React with ❤️`).
- **Resultat attendu** : la modale s'ouvre (animation fade) ; au tap, `Haptics.selectionAsync` declenche un retour haptique, `onPick('❤️')` met a jour "Last picked: ❤️" et la modale se ferme (`onClose`).
- **Critere d'acceptation (OK/KO)** : OK si "Last picked: ❤️" s'affiche et la modale se ferme. KO sinon.
- **Donnees de test** : emoji `❤️`
- **Duree estimee** : 2 min

### EXT-PLAY-022 - Reaction picker : fermeture par backdrop + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard, playground monte
- **Etapes** :
  1. Ouvrir le reaction picker.
  2. Taper plusieurs emojis tres vite (🔥 puis 😂) avant la fermeture.
  3. Rouvrir, puis taper le backdrop (zone sombre hors pilule).
- **Resultat attendu** : le premier tap emoji ferme la modale ; un tap a l'interieur de la pilule ne ferme pas (stopPropagation) ; le backdrop ferme sans selection ; "Last picked" reflete le dernier emoji effectivement enregistre ; aucun crash.
- **Critere d'acceptation (OK/KO)** : OK si fermeture coherente et un seul `onPick` par ouverture. KO si double-pick ou modale bloquee.
- **Donnees de test** : emojis `🔥`, `😂`
- **Duree estimee** : 3 min

### EXT-PLAY-023 - Accessibilite du reaction picker

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Ouvrir le reaction picker.
  2. Balayer les 8 emojis et verifier l'annonce "React with <emoji>" + role bouton.
  3. Verifier la fermeture via `onRequestClose` (geste retour Android).
- **Resultat attendu** : chaque emoji annonce "React with ❤️/👏/🔥/😂/🙏/🎉/✨/🤯", role bouton, cibles tactiles >= 44pt ; le geste retour ferme la modale.
- **Critere d'acceptation (OK/KO)** : OK si les 8 emojis sont annonces individuellement et la modale fermable au clavier/geste. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### EXT-PLAY-024 - Reaction picker multi-utilisateur (propagation eventuelle)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P2
- **Pre-conditions** : 2 comptes dans une vraie room (hors playground, car le playground n'emet rien : `onPick` ne fait que setState local), permission micro accordee
- **Etapes** :
  1. Note : sur le playground, `onPick` est purement local (pas d'appel reseau). Pour valider le temps-reel, reproduire le flux dans une room reelle ou le picker est cable a `chatReactionsApi.toggle`.
  2. Sur A, long-press un message et choisir 🔥.
  3. Observer B.
- **Resultat attendu** : dans le playground, seul "Last picked" change (aucun event reseau). Dans une room reelle, la reaction se propage a B via le backend. Ce cas documente la limite du playground (mock).
- **Critere d'acceptation (OK/KO)** : OK si comportement local conforme dans le playground ET propagation confirmee dans une room reelle. KO si le playground emet un event reseau inattendu.
- **Donnees de test** : emoji `🔥`, messageId reel
- **Duree estimee** : 6 min

### EXT-PLAY-025 - Valider une liste d'interets correcte

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, playground monte
- **Etapes** :
  1. Aller a "V2 — Interests validator".
  2. Constater la valeur par defaut "tech, music, startups".
  3. Verifier le message de validation.
- **Resultat attendu** : 3 interets uniques -> `validateInterests` renvoie `ok=true` -> affichage "✓ valid" (`interestsValid`).
- **Critere d'acceptation (OK/KO)** : OK si "✓ valid" affiche pour 3 interets. KO sinon.
- **Donnees de test** : `tech, music, startups`
- **Duree estimee** : 2 min

### EXT-PLAY-026 - Interets insuffisants (message "need N more")

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, playground monte
- **Etapes** :
  1. Vider le champ Interests et saisir uniquement "tech".
  2. Observer le message ; saisir tres vite des virgules/espaces multiples "a,, b ,".
- **Resultat attendu** : pour "tech" -> `too_few` -> message "✗ <reason> (need N more)" (cles `interestsNeed` + `interestsMore`) en couleur danger (`styles.bad`) ; les separateurs multiples sont normalises (split sur `/[,\s]+/`, filtre vides) sans crash.
- **Critere d'acceptation (OK/KO)** : OK si message "need N more" affiche en rouge et "✓ valid" disparait. KO sinon.
- **Donnees de test** : `tech` puis `a,,  b ,`
- **Duree estimee** : 3 min

### EXT-PLAY-027 - Accessibilite du champ et du message Interests

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Balayer jusqu'au champ Interests (placeholder "tech, music, startups, …").
  2. Saisir une valeur et verifier que le message de validation est annonce et lisible.
  3. Verifier le contraste du texte d'erreur (rouge danger) sur fond sombre.
- **Resultat attendu** : placeholder lu, message "✓ valid" / "✗ … need N more" annonce ; contraste suffisant a 200%.
- **Critere d'acceptation (OK/KO)** : OK si le message de validation est annonce et le contraste passe WCAG AA. KO sinon.
- **Donnees de test** : `music, art`
- **Duree estimee** : 4 min

### EXT-PLAY-028 - Tap sur le banner "Back to room"

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, playground monte (banner rendu `visible`)
- **Etapes** :
  1. Aller a "V10 — Back-to-room banner".
  2. Taper la zone principale "Back to the active room" (`accessibilityLabel="Back to the active room"`).
- **Resultat attendu** : dans le playground `onTapBack` est un no-op (`() => undefined`) -> aucune navigation, aucun crash ; le banner affiche le titre "Late night tech talk" et "with Alice". (En integration reelle : navigue vers la room active.)
- **Critere d'acceptation (OK/KO)** : OK si le tap est gere sans erreur et le contenu du banner est correct. KO si crash.
- **Donnees de test** : roomTitle "Late night tech talk", host "Alice"
- **Duree estimee** : 2 min

### EXT-PLAY-029 - Banner mute/unmute : multi-clic et libelle dynamique

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, playground monte (banner avec `onToggleMute` defini, `isMuted=false`)
- **Etapes** :
  1. Taper rapidement plusieurs fois le bouton micro (`accessibilityLabel="Mute microphone"` quand non mute).
  2. Verifier qu'aucun changement d'icone n'a lieu (etat `isMuted` fige a false dans le playground).
- **Resultat attendu** : `onToggleMute` est un no-op dans le playground -> l'icone reste 🎙️ et le label reste "Mute microphone" ; pas de crash sur multi-clic. (En integration reelle : bascule mute LiveKit, label devient "Unmute microphone", icone 🚫.)
- **Critere d'acceptation (OK/KO)** : OK si multi-clic sans crash et label conforme a l'etat `isMuted`. KO sinon.
- **Donnees de test** : isMuted=false
- **Duree estimee** : 3 min

### EXT-PLAY-030 - Banner Leave room (action destructive)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, playground monte (banner avec `onLeave` defini)
- **Etapes** :
  1. Taper le bouton croix "Leave room" (`accessibilityLabel="Leave room"`).
- **Resultat attendu** : dans le playground `onLeave` est un no-op -> rien ne se passe (banner reste). En integration reelle : quitte la room (deconnexion LiveKit, retour feed). Le bouton a un style danger (fond rouge translucide).
- **Critere d'acceptation (OK/KO)** : OK si le bouton est present avec style destructif et le tap est gere sans erreur. KO si crash.
- **Donnees de test** : N/A
- **Duree estimee** : 2 min

### EXT-PLAY-031 - Accessibilite du banner (mute/leave/back)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Balayer le banner : zone retour, bouton micro, bouton croix.
  2. Verifier les labels "Back to the active room", "Mute microphone"/"Unmute microphone", "Leave room" + role bouton.
  3. Verifier que le titre de room tronque a 1 ligne n'empeche pas l'annonce complete.
- **Resultat attendu** : les 3 actions annoncees distinctement, le libelle micro reflete `isMuted`, cibles 36pt (verifier qu'on atteint >=44pt recommande).
- **Critere d'acceptation (OK/KO)** : OK si les 3 boutons sont annonces avec le bon label/role et atteignables. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### EXT-PLAY-032 - Banner mute multi-utilisateur (synchro etat audio)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 comptes dans une room reelle (le playground etant no-op, ce cas se valide en integration), micro accorde
- **Etapes** :
  1. Reproduire le banner cable a la vraie room (hors playground).
  2. Sur A, taper mute via le banner.
  3. Observer l'indicateur de A cote B.
- **Resultat attendu** : l'etat mute de A se propage via LiveKit -> B voit A en muet ; le label du banner de A devient "Unmute microphone" et icone 🚫.
- **Critere d'acceptation (OK/KO)** : OK si B voit l'etat mute de A < 2 s. KO sinon. (Documente que le playground ne fait que rendre l'UI.)
- **Donnees de test** : A=`alice`, B=`bob`
- **Duree estimee** : 6 min

### EXT-PLAY-033 - Toggle d'une chip de reaction chat (retrait du like existant)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, playground monte, backend up
- **Etapes** :
  1. Aller a "V13 — Chat reactions bar".
  2. Taper la chip ❤️ (`accessibilityLabel="4 reactions ❤️, you reacted"`), qui est `byMe=true`.
- **Resultat attendu** : update optimiste -> count 4->3, `byMe` passe a false (style chip non-mine) ; `POST /ext/chat-reactions/demo-message-1/toggle {emoji:'❤️'}` envoye, l'etat se reconcilie avec la reponse serveur.
- **Critere d'acceptation (OK/KO)** : OK si la chip ❤️ passe a 3 (ou valeur serveur) immediatement puis reconcilie. KO sinon.
- **Donnees de test** : messageId `demo-message-1`, emoji `❤️`
- **Duree estimee** : 3 min

### EXT-PLAY-034 - Chip reaction : echec serveur + rollback + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, backend renvoie une erreur sur `toggle` (ou reseau coupe), playground monte
- **Etapes** :
  1. Couper le reseau.
  2. Taper la chip 🔥 (`accessibilityLabel="2 reactions 🔥"`) puis re-taper tres vite la meme chip.
  3. Retablir le reseau.
- **Resultat attendu** : pendant `pending` la chip est `disabled` -> le 2e tap immediat est ignore ; sur echec `toggle`, rollback en re-listant depuis le serveur (`chatReactionsApi.list`) ; si la liste echoue aussi, l'optimiste est conserve ; pas de crash ni de double increment.
- **Critere d'acceptation (OK/KO)** : OK si pas de double-toggle, rollback coherent et app stable. KO si compteur incoherent ou crash.
- **Donnees de test** : messageId `demo-message-1`, emoji `🔥`
- **Duree estimee** : 4 min

### EXT-PLAY-035 - Accessibilite des chips de reaction chat

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Balayer la barre de reactions (annoncee "Message reactions").
  2. Verifier l'annonce de chaque chip : "4 reactions ❤️, you reacted", "2 reactions 🔥", "1 reactions 😂".
  3. Verifier que la chip "mine" (❤️) se distingue visuellement (couleur primary) avec contraste suffisant.
- **Resultat attendu** : conteneur annonce comme texte "Message reactions" ; chaque chip annoncee avec count + emoji + mention "you reacted" si applicable ; role bouton ; lisible a 200%.
- **Critere d'acceptation (OK/KO)** : OK si chaque chip est annoncee correctement et l'etat "mine" est distinguable. KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### EXT-PLAY-036 - Chips de reaction multi-utilisateur (reconciliation des compteurs)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : 2 comptes pouvant reagir au meme messageId, backend up
- **Etapes** :
  1. Note : sur le playground `initial` est mocke ; pour un vrai multi-user, viser le meme `messageId` reel depuis 2 comptes.
  2. A et B togglent ❤️ sur le meme message a quelques secondes d'intervalle.
  3. Observer les compteurs des deux cotes apres reconciliation.
- **Resultat attendu** : le serveur fait foi (`toggle` renvoie le map complet) -> apres reconciliation, A et B voient le meme count agrege ; pas de divergence persistante malgre les updates optimistes locaux.
- **Critere d'acceptation (OK/KO)** : OK si les compteurs convergent vers la verite serveur sur les deux devices. KO si divergence durable.
- **Donnees de test** : messageId reel partage, emoji `❤️`
- **Duree estimee** : 6 min

### EXT-PLAY-037 - Defilement complet du playground (smoke a11y global)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, lecteur d'ecran actif, police 200%, contraste eleve
- **Etapes** :
  1. Du haut ("Extensions Playground" + "Font scale × N.NN") jusqu'au bas, balayer toutes les sections.
  2. Verifier qu'aucun element interactif n'est saute par le lecteur d'ecran et que l'ordre de focus suit l'ordre visuel.
  3. Verifier l'affichage "Font scale × 2.00" (ou la valeur courante via `useExtFontScale`).
- **Resultat attendu** : tous les boutons listes dans la matrice sont atteignables dans un ordre logique ; le `ScrollView` defile au focus ; pas de chevauchement a 200%.
- **Critere d'acceptation (OK/KO)** : OK si l'ensemble des elements interactifs est atteignable au lecteur d'ecran sans piege de focus. KO sinon.
- **Donnees de test** : font scale systeme = 2.0
- **Duree estimee** : 5 min
