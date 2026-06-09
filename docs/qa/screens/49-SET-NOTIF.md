# 49 - Reglages notifications (`settings`)

## Contexte ecran

- **Route** : `NotificationSettings`, enregistree dans `SettingsNavigator` (`src/core/navigation/stacks/SettingsNavigator.tsx`), elle-meme montee sous l'onglet `SettingsTab` du `MainNavigator`. Acces par navigation depuis `SettingsScreen` via `navigation.navigate('NotificationSettings')` (cellule "Notifications"). **Aucun deep-link dedie** : l'ecran n'est pas mappe dans `linking.ts` (seuls `Settings`, `Profile`, `EditProfile`, `Followers` y figurent), il n'est donc atteignable que depuis l'app, jamais par URL.
- **Roles requis** : utilisateur **authentifie** (standard ou admin). L'onglet Settings n'existe que dans la pile authentifiee ; un `guest` non connecte ne peut pas atteindre l'ecran. Aucune restriction de role specifique : un compte standard a exactement les memes controles qu'un admin.
- **Fichier ecran** : `src/features/settings/screens/NotificationSettingsScreen/NotificationSettingsScreen.tsx` (un seul fichier, pas de partials).
- **Source de donnees** : `useNotifPrefs()` -> `GET /users/me/notification-preferences` (React Query, queryKey `['notifPrefs']`). Mutation `useUpdateNotifPrefs()` -> `PATCH /users/me/notification-preferences` avec un payload partiel `{ [key]: boolean }`.
- **Comportements temps-reel** : **aucun WebSocket / LiveKit / canal push entrant sur cet ecran**. Les bascules pilotent uniquement des preferences serveur via REST. La seule subtilite "temps quasi-reel" est la **mise a jour optimiste** : `onMutate` bascule l'interrupteur immediatement et le store React Query, `onError` effectue un **rollback** vers le snapshot pre-mutation, `onSuccess` reconcilie avec la reponse serveur. Les notifications push elles-memes (effet de ces preferences) sont hors de cet ecran et se testent indirectement.
- **Pre-conditions globales** : compte connecte avec token valide ; backend joignable sur `/users/me/notification-preferences` ; reseau (Wi-Fi/4G) pour le chargement initial et chaque PATCH.
- **Etats de donnees pertinents** :
  - **Chargement** (`isLoading`) : `Loader` plein ecran avec `accessibilityLabel = t('notificationSettings.title')` ("Notifications").
  - **Erreur** (`isError` ou `prefs` absent) : `EmptyState` titre `t('common.error')` ("Une erreur est survenue") + bouton `t('common.retry')` ("Reessayer").
  - **Charge** : sous-titre + 9 lignes interrupteur (une par cle de `NOTIF_PREF_KEYS`).
  - **Liste vide** : impossible par construction — les 9 cles sont toujours rendues si `prefs` est defini (chaque cle absente serait `undefined` -> interrupteur OFF visuellement).
  - **Hors-ligne** : echec du GET -> etat erreur ; echec du PATCH -> rollback optimiste de l'interrupteur.
- **Interrupteurs (cles, ordre exact de `NOTIF_PREF_KEYS`)** : `newFollower` ("Nouveaux abonnes"), `wave` ("Waves"), `roomInvite` ("Invitations a une room"), `clubInvite` ("Invitations a un club"), `roomStarted` ("Une room qui pourrait te plaire demarre"), `eventReminder` ("Rappels de rooms planifiees"), `newMessage` ("Nouveaux messages"), `handAccepted` ("On t'invite a parler"), `mention` ("Mentions").
- **Note** : pendant qu'une mutation est en cours (`updatePrefs.isPending`), **tous** les interrupteurs sont passes `disabled` (un seul mutation hook partage). Un seul PATCH a la fois.

## Matrice bouton

| #   | Bouton                                     | Emplacement                     | Type       | Locator reel                                                                         | Pre-condition                 | Priorite |
| --- | ------------------------------------------ | ------------------------------- | ---------- | ------------------------------------------------------------------------------------ | ----------------------------- | -------- |
| 1   | Retour                                     | Header (gauche)                 | navigation | `accessibilityLabel = t('common.back')` -> "Retour" (Pressable, icone `arrow-back`)  | Ecran affiche                 | P1       |
| 2   | Reessayer                                  | Corps (EmptyState, etat erreur) | submit     | `t('common.retry')` -> "Reessayer" (texte du `Button`)                               | Etat `isError` / GET en echec | P1       |
| 3   | Interrupteur "Nouveaux abonnes"            | Corps (liste)                   | toggle     | `accessibilityLabel = t('notificationSettings.newFollower')` -> "Nouveaux abonnes"   | Prefs chargees                | P1       |
| 4   | Interrupteur "Waves"                       | Corps (liste)                   | toggle     | `t('notificationSettings.wave')` -> "Waves"                                          | Prefs chargees                | P1       |
| 5   | Interrupteur "Invitations a une room"      | Corps (liste)                   | toggle     | `t('notificationSettings.roomInvite')` -> "Invitations a une room"                   | Prefs chargees                | P1       |
| 6   | Interrupteur "Invitations a un club"       | Corps (liste)                   | toggle     | `t('notificationSettings.clubInvite')` -> "Invitations a un club"                    | Prefs chargees                | P1       |
| 7   | Interrupteur "Une room ... demarre"        | Corps (liste)                   | toggle     | `t('notificationSettings.roomStarted')` -> "Une room qui pourrait te plaire demarre" | Prefs chargees                | P1       |
| 8   | Interrupteur "Rappels de rooms planifiees" | Corps (liste)                   | toggle     | `t('notificationSettings.eventReminder')` -> "Rappels de rooms planifiees"           | Prefs chargees                | P1       |
| 9   | Interrupteur "Nouveaux messages"           | Corps (liste)                   | toggle     | `t('notificationSettings.newMessage')` -> "Nouveaux messages"                        | Prefs chargees                | P1       |
| 10  | Interrupteur "On t'invite a parler"        | Corps (liste)                   | toggle     | `t('notificationSettings.handAccepted')` -> "On t'invite a parler"                   | Prefs chargees                | P1       |
| 11  | Interrupteur "Mentions"                    | Corps (liste)                   | toggle     | `t('notificationSettings.mention')` -> "Mentions"                                    | Prefs chargees                | P1       |

> Note : il n'y a aucun bouton submit "Enregistrer" global — chaque interrupteur PATCH immediatement. Aucun FAB, lien legal, menu, swipe, long-press ni pull-to-refresh sur cet ecran.

## Cas de test

### SET-NOTIF-001 - Retour ferme l'ecran

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, prefs chargees, Wi-Fi
- **Etapes** :
  1. Depuis SettingsScreen, taper la cellule "Notifications" pour ouvrir l'ecran.
  2. Taper le bouton retour (icone `arrow-back`, label "Retour") en haut a gauche.
- **Resultat attendu** : `navigation.goBack()` est appele ; retour a SettingsScreen sans modification des preferences ; aucune requete reseau declenchee par le retour.
- **Critere d'acceptation (OK/KO)** : OK si l'app revient a SettingsScreen et l'ecran Notifications est demonte.
- **Donnees de test** : compte `qa.standard@chathouse.test`
- **Duree estimee** : 2 min

### SET-NOTIF-002 - Retour multi-tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, prefs chargees, latence reseau simulee (~1 s)
- **Etapes** :
  1. Ouvrir l'ecran Notifications.
  2. Taper le bouton "Retour" 5 fois en moins d'une seconde.
- **Resultat attendu** : un seul `goBack` effectif ; pas de double pop de pile, pas d'ecran blanc, pas de crash ; l'app reste sur SettingsScreen.
- **Critere d'acceptation (OK/KO)** : OK si l'app est stable sur SettingsScreen (pas de sortie de l'onglet ni d'ecran vide).
- **Donnees de test** : 5 taps en rafale
- **Duree estimee** : 3 min

### SET-NOTIF-003 - Retour accessibilite lecteur d'ecran

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme XXL, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran Notifications.
  2. Balayer jusqu'au premier element focusable.
  3. Ecouter l'annonce, double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Retour, bouton" (role `button`, label "Retour") ; double-tap declenche le retour ; le titre "Notifications" reste lisible et non tronque en police XXL.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est annonce comme "bouton" avec le libelle "Retour" et activable au double-tap, titre non tronque.
- **Donnees de test** : TalkBack ON, police 200%
- **Duree estimee** : 4 min

### SET-NOTIF-004 - Reessayer recharge les preferences apres erreur

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte ; forcer le GET `/users/me/notification-preferences` en echec (ex : backend OFF) pour atteindre l'etat erreur, puis le retablir
- **Etapes** :
  1. Ouvrir l'ecran avec le backend coupe -> EmptyState "Une erreur est survenue" + bouton "Reessayer".
  2. Retablir le backend.
  3. Taper "Reessayer".
- **Resultat attendu** : `refetch()` est appele ; un nouveau GET part ; l'EmptyState disparait ; le sous-titre + les 9 interrupteurs s'affichent avec les valeurs serveur.
- **Critere d'acceptation (OK/KO)** : OK si la liste des 9 interrupteurs s'affiche apres le tap.
- **Donnees de test** : reponse GET = `{ "data": { "id":"np_1","userId":"u_1","newFollower":true,"wave":false,"roomInvite":true,"clubInvite":false,"roomStarted":true,"eventReminder":false,"newMessage":true,"handAccepted":false,"mention":true } }`
- **Duree estimee** : 4 min

### SET-NOTIF-005 - Reessayer en echec persistant + multi-tap

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, backend toujours injoignable (hors-ligne / 500), latence
- **Etapes** :
  1. Atteindre l'etat erreur (GET en echec).
  2. Taper "Reessayer" 4 fois rapidement.
  3. Observer pendant la latence.
- **Resultat attendu** : chaque tap relance `refetch` mais l'ecran reste en etat erreur tant que le GET echoue ; pas d'empilement d'EmptyState, pas de crash, pas de boucle infinie de requetes au-dela des taps ; le bouton reste actionnable.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran reste stable sur l'EmptyState et le bouton reste utilisable apres les taps.
- **Donnees de test** : reponse GET = HTTP 500
- **Duree estimee** : 4 min

### SET-NOTIF-006 - Reessayer accessibilite

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, etat erreur affiche, TalkBack/VoiceOver actif, police XXL, contraste eleve
- **Etapes** :
  1. Atteindre l'EmptyState d'erreur.
  2. Balayer jusqu'au bouton "Reessayer".
  3. Double-taper.
- **Resultat attendu** : le lecteur annonce "Reessayer, bouton" ; le titre "Une erreur est survenue" est lu ; le bouton est active au double-tap (variant outline, contraste suffisant en mode dark) ; texte non tronque en police XXL.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est annonce comme bouton avec libelle "Reessayer" et activable.
- **Donnees de test** : TalkBack ON, police 200%
- **Duree estimee** : 4 min

### SET-NOTIF-007 - Activer "Nouveaux abonnes" (interrupteur OFF -> ON)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte, Wi-Fi, prefs chargees avec `newFollower=false`
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Reperer la ligne "Nouveaux abonnes" (interrupteur OFF).
  3. Taper l'interrupteur.
- **Resultat attendu** : l'interrupteur bascule ON immediatement (optimiste) ; un `PATCH /users/me/notification-preferences` part avec `{ "newFollower": true }` ; au succes, l'etat reste ON (reconcilie avec la reponse) ; tous les interrupteurs redeviennent actifs apres la fin de la mutation.
- **Critere d'acceptation (OK/KO)** : OK si l'interrupteur est ON et le PATCH a porte `{"newFollower":true}`.
- **Donnees de test** : payload PATCH = `{"newFollower":true}` ; reponse = ligne complete avec `newFollower:true`
- **Duree estimee** : 3 min

### SET-NOTIF-008 - Desactiver "Mentions" (ON -> OFF) et persistance

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, Wi-Fi, `mention=true`
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper l'interrupteur "Mentions" (passe ON -> OFF).
  3. Quitter l'ecran (Retour) puis le rouvrir.
- **Resultat attendu** : PATCH `{ "mention": false }` ; au retour, le GET renvoie `mention=false` et l'interrupteur "Mentions" est OFF -> la modification est persistee cote serveur.
- **Critere d'acceptation (OK/KO)** : OK si "Mentions" reste OFF apres reouverture de l'ecran.
- **Donnees de test** : payload PATCH = `{"mention":false}`
- **Duree estimee** : 3 min

### SET-NOTIF-009 - Bascule en echec reseau -> rollback optimiste

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, `roomInvite=true`, couper le reseau juste avant le tap (ou forcer PATCH en 500)
- **Etapes** :
  1. Ouvrir l'ecran avec prefs chargees.
  2. Passer en mode avion / couper le backend.
  3. Taper l'interrupteur "Invitations a une room" (ON -> OFF visuellement immediat).
  4. Attendre l'echec de la requete.
- **Resultat attendu** : l'interrupteur passe OFF immediatement (optimiste) puis **revient a ON** quand le PATCH echoue (`onError` rollback vers le snapshot) ; aucune fausse persistance ; pas de crash ; un toast/erreur peut s'afficher selon l'intercepteur API.
- **Critere d'acceptation (OK/KO)** : OK si l'interrupteur revient a son etat initial (ON) apres l'echec, sans valeur incoherente.
- **Donnees de test** : PATCH `{"roomInvite":false}` -> reponse erreur reseau ; etat attendu post-rollback = `roomInvite:true`
- **Duree estimee** : 5 min

### SET-NOTIF-010 - Multi-tap rapide sur un interrupteur + concurrence de mutations

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, latence reseau elevee (~2 s), `wave=false`
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper l'interrupteur "Waves" 6 fois tres rapidement.
  3. Observer pendant et apres la resolution des requetes.
- **Resultat attendu** : pendant qu'une mutation est `isPending`, **tous les interrupteurs sont disabled**, ce qui limite les bascules concurrentes ; l'etat final doit refleter la derniere reponse serveur reconciliee (`onSuccess`), sans interrupteur "fantome" ni divergence UI/serveur ; pas de crash. (Verifier qu'aucune sequence de PATCH contradictoires ne laisse l'UI desynchronisee du serveur.)
- **Critere d'acceptation (OK/KO)** : OK si, apres stabilisation, l'etat de "Waves" affiche correspond a la derniere reponse serveur et reste interactif.
- **Donnees de test** : 6 taps en rafale sur `wave`
- **Duree estimee** : 5 min

### SET-NOTIF-011 - Interrupteurs accessibilite lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, prefs chargees (valeurs mixtes ON/OFF), TalkBack/VoiceOver actif, police systeme XXL, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Balayer sequentiellement les 9 lignes.
  3. Sur "Nouveaux abonnes" (ON), double-taper pour basculer.
- **Resultat attendu** : chaque interrupteur a `accessibilityRole="switch"`, est annonce avec son libelle (ex : "Nouveaux abonnes") et son etat (`checked` ON/OFF) via `accessibilityState` ; un interrupteur en cours de mutation est annonce "desactive" (`disabled`) ; les libelles longs ("Une room qui pourrait te plaire demarre") restent lisibles/non tronques en police XXL ; double-tap bascule l'etat.
- **Critere d'acceptation (OK/KO)** : OK si chaque interrupteur est annonce comme "interrupteur" avec libelle + etat coche/decoche, et activable au double-tap.
- **Donnees de test** : prefs = `{newFollower:true, wave:false, roomInvite:true, clubInvite:false, roomStarted:true, eventReminder:false, newMessage:true, handAccepted:false, mention:true}` ; police 200%
- **Duree estimee** : 6 min

### SET-NOTIF-012 - Synchro multi-appareil des preferences

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : **meme** compte standard connecte sur deux appareils A et B, Wi-Fi sur les deux, `newMessage=true` au depart
- **Etapes** :
  1. Sur l'appareil A, ouvrir l'ecran Notifications -> "Nouveaux messages" ON.
  2. Sur A, basculer "Nouveaux messages" OFF (PATCH `{"newMessage":false}`).
  3. Sur l'appareil B, ouvrir (ou rouvrir) l'ecran Notifications.
- **Resultat attendu** : il **n'y a pas de push temps-reel** vers B ; B reflete la nouvelle valeur (OFF) uniquement apres un nouveau GET (ouverture/refetch de l'ecran), car la persistance est serveur. La valeur affichee sur B doit etre OFF, prouvant que le serveur a bien enregistre le changement de A.
- **Critere d'acceptation (OK/KO)** : OK si l'appareil B montre "Nouveaux messages" OFF apres reouverture de l'ecran (sans qu'aucune notif push parasite ne soit recue par A apres desactivation).
- **Donnees de test** : compte partage `qa.standard@chathouse.test`, deux devices
- **Duree estimee** : 6 min

### SET-NOTIF-013 - Effet reel de la preference sur les push (room demarre)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : compte A standard avec permission notif systeme accordee ; compte B (createur de room) ; `roomStarted` desactivable sur A
- **Etapes** :
  1. Sur A, ouvrir l'ecran et **desactiver** "Une room qui pourrait te plaire demarre" (PATCH `{"roomStarted":false}`, succes).
  2. Sur B, demarrer une room correspondant au ciblage qui declencherait normalement une push "room started" vers A.
  3. Sur A (app en arriere-plan), observer le centre de notifications.
- **Resultat attendu** : A ne recoit **pas** de notification push "room demarre" puisque la preference est OFF ; reactiver la preference et repeter -> A recoit la push. Confirme le cablage preference -> emission push cote backend.
- **Critere d'acceptation (OK/KO)** : OK si aucune push "room demarre" n'arrive a A quand `roomStarted=false`, et une push arrive quand `roomStarted=true`.
- **Donnees de test** : A=`qa.standard@chathouse.test`, B=`qa.creator@chathouse.test`
- **Duree estimee** : 7 min

### SET-NOTIF-014 - Etat de chargement initial (loader)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, reseau lent pour prolonger le `isLoading`
- **Etapes** :
  1. Naviguer vers l'ecran Notifications.
  2. Observer pendant le GET en cours.
- **Resultat attendu** : un `Loader` plein ecran s'affiche avec `accessibilityLabel = "Notifications"` ; aucun interrupteur ni EmptyState n'est rendu pendant ce temps ; a la fin du GET, la liste apparait.
- **Critere d'acceptation (OK/KO)** : OK si le loader est visible pendant le fetch puis remplace par la liste des 9 interrupteurs.
- **Donnees de test** : throttling reseau "Slow 3G"
- **Duree estimee** : 3 min
