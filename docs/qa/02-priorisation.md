# 02 - Priorisation des tests P0 / P1 / P2

Document de pilotage QA pour **ChatHouse** (app audio live facon Clubhouse — React Native / Expo, temps reel WebSocket + audio LiveKit, push, i18n FR/EN, roles guest/standard/admin, Android + iOS, reseaux variables).

Perimetre couvert : **50 ecrans**, **381 boutons / controles interactifs**, **991 cas de test** deja rediges.

Repartition des 381 controles par niveau de priorite (issue de l'agregation des 50 fiches ecran) :

| Niveau    | Nombre de controles | Part  | Intention de couverture                                                                         |
| --------- | ------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| **P0**    | 89                  | 23 %  | Chemin critique — bloquant pour livrer. Tout doit passer avant toute mise en production.        |
| **P1**    | 220                 | 58 %  | Important — fonctionnel coeur non-bloquant immediat, a couvrir avant release majeure.           |
| **P2**    | 72                  | 19 %  | Secondaire — confort, contenu statique, accessibilite fine, variantes. Couverture opportuniste. |
| **Total** | **381**             | 100 % |                                                                                                 |

> Remarque : le niveau de priorite est porte par **controle** (bouton/champ/toggle), pas par cas de test. Un meme controle P0 (ex. Micro Mute) genere plusieurs cas de test (positif, multi-clic, hors-ligne, reconnexion, accessibilite). La campagne smoke (section 5) ne retient qu'**un sous-ensemble** des cas de chaque controle P0.

---

## 1. Definition des niveaux

Chaque controle est classe selon **5 criteres** ponderes. Un seul critere « rouge » suffit a faire monter un controle de niveau (logique du maillon faible : la priorite finale = le plus haut niveau atteint sur l'un des criteres).

| Critere                   | Question                                                           | Pousse vers P0 si…                                                                                                             |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Impact metier**         | Si ce controle casse, que perd-on ?                                | Aucune inscription / aucun acces a l'app / aucune room rejointe / aucun message envoye / aucun revenu protege.                 |
| **Securite & conformite** | Y a-t-il un risque donnees, RGPD, privileges ?                     | Escalade de role, suspension/suppression de compte, export PII, exposition de localisation, deconnexion de session, age legal. |
| **Temps-reel coeur**      | Le controle pilote-t-il l'audio live / WebSocket / push critique ? | Connexion/deconnexion LiveKit, mute, main levee, force-end room, force-mute, deep-link vers une room.                          |
| **Frequence d'usage**     | Combien d'utilisateurs et a quelle frequence ?                     | Atteint par 100 % des nouveaux utilisateurs (onboarding/auth) ou utilise a chaque session.                                     |
| **Reversibilite**         | Une erreur est-elle rattrapable ?                                  | Action irreversible ou quasi-irreversible (suppression compte, force-end, resolution de signalement, suspension).              |

### P0 — Critique / bloquant

> **Definition.** Controle dont la defaillance **bloque le lancement** ou cree un **risque grave** (perte de donnees, faille de privilege, fuite RGPD), ou qui constitue le **coeur temps-reel** de l'experience Clubhouse (audio live), ou qui est **irreversible**.

- Au moins un critere est rouge : impact metier majeur, securite/RGPD, temps-reel audio coeur, ou irreversibilite.
- Concerne notamment : tunnel auth OTP, rejoindre/quitter une room, mute & main levee, envoyer un message, moderation admin destructive, suppression de compte.
- **Regle QA :** 100 % des controles P0 doivent etre verts avant toute release. Un P0 KO = release bloquee.

### P1 — Important / non-bloquant immediat

> **Definition.** Controle **fonctionnel coeur** mais non bloquant a l'instant T : navigation principale, filtres, listes, follow/social, invitations, refresh manuel, toggles de preferences avec rollback.

- Impact metier reel mais contournable (autre chemin existe, ou degradation gracieuse).
- Pas d'irreversibilite forte ; effets souvent reconciliables par refetch/invalidation React Query.
- **Regle QA :** a couvrir avant une release majeure ; un P1 KO peut etre tolere ponctuellement avec un ticket de suivi.

### P2 — Secondaire / opportuniste

> **Definition.** Controle de **confort, de contenu statique, de variantes ou d'accessibilite fine**.

- Liens legaux/sociaux, presets de planification, defilements de documents, cellules de liste non pressables, variantes d'emoji de reaction, champs optionnels (Nom de famille, Description).
- Faible frequence ou impact UX limite ; aucune perte de donnees.
- **Regle QA :** couverture opportuniste / regression de fond ; jamais bloquant.

---

## 2. Liste P0 (chemin critique) — 89 controles

Chaque ligne = justification en une phrase. Regroupement par domaine fonctionnel.

### 2.1 AUTH — tunnel d'entree (sans lui, aucune inscription ni connexion)

| Ecran    | Controle                            | Justification (1 ligne)                                                               |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| Landing  | Commencer / Get started             | Seul point d'entree vers l'inscription ; casse = zero nouvelle inscription.           |
| Landing  | J'ai deja un compte                 | Seul point d'entree vers le login d'un utilisateur existant.                          |
| Phone    | Champ numero de telephone           | Identifiant d'auth ; mauvaise normalisation E.164 = pas d'OTP envoye.                 |
| Phone    | Case « J'ai au moins 16 ans »       | Verrou legal de conformite ; bloque le CTA tant que non coche.                        |
| Phone    | Recevoir un code                    | Declenche l'envoi SMS OTP ; sensible reseau/rate-limit/multi-clic.                    |
| OTP      | Champ code 6 chiffres (auto-submit) | Coeur de l'authentification ; verifie l'OTP, ouvre la session, gere les 5 tentatives. |
| Name     | Champ Prenom                        | Champ gating obligatoire qui conditionne l'identite reelle et l'activation du CTA.    |
| Name     | Suivant                             | Stash le profil et fait avancer le flux d'identite.                                   |
| Username | Champ pseudo                        | Conditionne la validite du CTA (regex 3-24) et porte les conflits d'unicite.          |
| Username | Valider                             | PATCH /users/me/username, promeut la session et fait sortir du stack Auth.            |

### 2.2 ROOM & MAP — coeur temps-reel audio (la valeur Clubhouse)

| Ecran       | Controle                      | Justification (1 ligne)                                                                                     |
| ----------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Room-Feed   | Rejoindre (Join)              | Entree dans une room audio live ; chemin critique vers le coeur temps-reel.                                 |
| Room-Live   | Micro Mute/Unmute             | Coupe/retablit la voix LiveKit avec rollback optimiste 3 niveaux ; doit survivre force-mute et reconnexion. |
| Room-Live   | Lever/Baisser la main         | Demande de parole temps-reel avec reconciliation `serverHandRaised` ; alimente la moderation du host.       |
| Room-Live   | Cellule main levee            | Promotion d'un auditeur en speaker (gestion de scene temps-reel).                                           |
| Room-Live   | Quitter                       | Sortie de room ; doit toujours goBack et liberer l'audio meme si l'appel reseau echoue.                     |
| Room-Live   | Fermer la room (End Room)     | Destructif host : ferme la room pour TOUS via `room:ended` ; confirmation obligatoire.                      |
| Room-Create | Champ Sujet (titre)           | Garde de validation (3-80) qui conditionne l'activation de la creation.                                     |
| Room-Create | Demarrer                      | POST /rooms puis replace('Room') ; cree et ouvre la room live.                                              |
| Room-Invite | Envoyer                       | POST /rooms/{id}/invite -> push multi-utilisateur ; anti multi-clic + dedup.                                |
| Room-Replay | Play / Pause                  | Stream de l'audio enregistre via expo-audio ; robustesse multi-clic + reconnexion.                          |
| Map         | Join Room                     | Navigue vers Room et initie la connexion LiveKit ; double-join a eviter.                                    |
| Map         | Toggle See/Unsee (Ghost Mode) | Securite/vie privee : un bug expose la localisation reelle aux autres viewers.                              |
| Map         | Grant access                  | Sans permission de localisation, toute la feature carte est inaccessible (consentement GDPR).               |

### 2.3 MESSAGES — chat temps-reel & vocal

| Ecran      | Controle                            | Justification (1 ligne)                                                           |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| Chat       | Champ de message                    | Saisie coeur ; chaque frappe emet `chat:typing` temps-reel chez le pair.          |
| Chat       | Envoyer le message                  | Envoi texte (optimiste + invalidation) ; risque doublon multi-clic.               |
| Chat       | Enregistrer message vocal (Micro)   | Capture audio (permission micro + module natif) ; creation de contenu vocal.      |
| Chat       | Envoyer le message vocal            | Upload + envoi du clip ; risque double envoi et echec upload.                     |
| GChat      | Champ message                       | Pilote la bascule micro/envoyer et la composition de groupe.                      |
| GChat      | Envoyer (texte)                     | Chemin d'envoi de groupe ; trim + restauration brouillon + anti double-envoi.     |
| GChat      | Micro (demarrer vocal)              | Capture audio gatee par permission micro (module natif EAS).                      |
| GChat      | Envoyer le vocal                    | Upload + POST /groups/:id/voice ; anti uploads concurrents.                       |
| GInfo      | Enregistrer le nom                  | Renomme le groupe (PATCH) ; propage aux autres membres apres invalidation.        |
| GInfo      | Retirer un membre                   | Moderation destructive owner ; le retire perd l'acces (impact securite).          |
| GInfo      | Quitter le groupe                   | Destructif ; depart « optimiste » meme si le leave echoue (divergence a tester).  |
| MSG-List   | Ligne conversation 1:1              | Coeur de la messagerie ; ouvre ChatDetail temps-reel (reorder + badge live).      |
| MSG-New    | Demarrer (Message / Create group)   | Cree un fil 1:1 ou un groupe ; sensible multi-clic (doublons) et reseau.          |
| MSG-New    | Ligne personne (cocher/decocher)    | Determine `memberIds` et le routage 1:1 vs groupe ; coherence sous taps rapides.  |
| MSG-AddGrp | Ajouter N                           | POST /groups/:id/members ; idempotence + invalidation qui propage l'appartenance. |
| MSG-AddGrp | Cellule resultat (toggle selection) | Constitue le payload envoye ; coherence de l'etat sous taps rapides.              |

### 2.4 ADMIN — moderation destructive & securite

| Ecran       | Controle                               | Justification (1 ligne)                                                                                       |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ADM-Home    | Rooms Actives                          | Unique entree vers le force-end destructif d'une room live (impact temps-reel participants).                  |
| ADM-Reports | Resoudre                               | Ferme un signalement (POST resolve) ; irreversible, confirmation obligatoire.                                 |
| ADM-Reports | Ignorer                                | Rejette un signalement (POST dismissed) ; destructif, anti double-envoi.                                      |
| ADM-Rooms   | Fermer la room                         | Force-end : ferme le canal LiveKit et ejecte tous les participants ; irreversible cote session.               |
| ADM-UDet    | Suspendre (1h/24h/7d/Perm)             | Coupe l'acces de la cible cote serveur ; multi-tap + perte reseau a couvrir.                                  |
| ADM-UDet    | Lever la suspension                    | Restaure l'acces ; chemin de moderation critique avec invalidation.                                           |
| ADM-UDet    | Definir le role (USER/MOD/ADMIN/SUPER) | Escalade/desescalade de privileges (securite) ; reserve super admin.                                          |
| ADM-UDet    | Usurper                                | Ouvre une session au nom de la cible (token d'usurpation) ; ne doit pas laisser de session pendante en echec. |
| ADM-UDet    | Supprimer le compte                    | Quasi-irreversible ; multi-tap et echec reseau critiques.                                                     |
| ADM-UDet    | Boutons de dialogue Alert              | Confirmation des actions destructives ; chaque branche doit muter ou annuler proprement.                      |
| ADM-UDet    | Champ motif + Suspendre (Alert.prompt) | Saisie du motif + declenchement de la suspension ; payload `durationMinutes` + motif.                         |
| ADM-Users   | Champ de recherche                     | Chemin critique pour retrouver la cible a moderer ; debounce + trim sous frappe rapide.                       |
| ADM-Users   | Ligne utilisateur (ouvrir detail)      | Unique entree vers les actions destructives ; multi-tap ne doit pas empiler.                                  |

### 2.5 HOUSES — adhesion & moderation de club

| Ecran            | Controle                  | Justification (1 ligne)                                                              |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| House-Create     | Champ Nom                 | Seul champ obligatoire (>=2) qui gouverne l'activation du submit.                    |
| House-Create     | Creer la house            | Upload icone optionnel puis POST /clubs ; risque double-creation multi-clic.         |
| House-Detail     | Rejoindre                 | POST /clubs/:id/join ; bascule membership + compteur, anti double-submit.            |
| House-Detail     | Ouvrir une room           | Entree vers le coeur temps-reel (Room + LiveKit/WebSocket).                          |
| House-Detail     | Gerer le role d'un membre | Moderation admin ; offert uniquement aux admins sur membres manageables.             |
| House-Detail     | Promouvoir / Retrograder  | Destructif/securite : PATCH role modifie les privileges.                             |
| House-Invitation | Accept invitation         | POST /clubs/:id/accept + invalidation + replace(HouseDetail) ; anti double-appel.    |
| House-List       | Cellule house (ligne)     | Entree principale vers HouseDetail (rooms/audio live) ; anti empilement multi-tap.   |
| House-Invite     | Inviter (par ligne)       | POST /clubs/:id/invite -> push CLUB_INVITE ; anti double-submission + Alert d'echec. |

### 2.6 PRIVACY / RGPD — irreversible & conformite

| Ecran       | Controle                       | Justification (1 ligne)                                                                    |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| Priv-Delete | Saisie de confirmation         | Garde-fou : la phrase exacte (SUPPRIMER/DELETE) active l'action irreversible.              |
| Priv-Delete | Supprimer mon compte (Button)  | Declenche l'Alert de confirmation ; reste disabled tant que la phrase n'est pas saisie.    |
| Priv-Delete | Action destructive de l'Alert  | Point de non-retour : POST request-deletion (RGPD, grace 30j) + signOut.                   |
| Priv-Export | Generer et partager mon export | Export de toutes les donnees personnelles (PII RGPD) ; gestion echec + anti double-submit. |
| Settings    | More options / Sign out        | Securite/auth : invalide la session ; chemin critique de sortie de compte.                 |
| Settings    | Delete my account              | Entree vers le flux de suppression RGPD ; doit etre isolee et non declenchee par erreur.   |

### 2.7 NOTIFICATIONS / EXTENSIONS / EVENTS / SEARCH / PROFILE / ONBOARDING — P0 ponctuels

| Ecran          | Controle                       | Justification (1 ligne)                                                                                    |
| -------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Notifications  | Tout marquer comme lu          | PATCH read-all -> `notification:count` propage le badge a 0 sur toutes les sessions.                       |
| Notifications  | Ligne notification (deep-link) | Marque lu + deep-link, notamment vers une room audio LiveKit (chemin temps-reel coeur).                    |
| Ext-Feed       | Ligne d'activite               | Tap ouvre la cible + markRead ; gate critique sur les entrees live (`live-` ne doit pas appeler markRead). |
| Ext-Play       | Wave a un utilisateur          | POST /users/:id/wave -> push cible ; resilience fallbacks + anti double-clic (coeur temps-reel social).    |
| Ext-Play       | Toggle mute (banner)           | Controle audio coeur Clubhouse : bascule le micro LiveKit en integration reelle.                           |
| Ext-Play       | Leave room (banner)            | Action destructive : quitte la room (deconnexion LiveKit) en integration.                                  |
| Ext-Play       | Back-to-room                   | Navigation critique vers la room active ; pierre angulaire de l'experience persistante.                    |
| Ext-Settings   | Profil prive                   | Vie privee : un faux ON (echec non rollback) fait croire a tort a la confidentialite.                      |
| Ext-Settings   | M'afficher sur la carte        | Geolocalisation/vie privee : un faux ON expose la position ; rollback critique.                            |
| Ext-Topics     | Cellule sous-sujet             | Action principale : remonte le slug via onSelectTopic (pas de garde anti double-tap).                      |
| Ext-Topics     | Cellule resultat de recherche  | Second chemin de selection de sujet, meme criticite sans deduplication.                                    |
| Events         | RSVP / Je viens                | Action principale (engagement) : POST/DELETE rsvp avec garde anti double-soumission.                       |
| Search         | Champ de recherche             | Coeur de l'ecran : GET /search debounce ; trim, query vide, hors-ligne a tester.                           |
| Profile        | Bloquer                        | Destructif securite : supprime l'arete follow dans les 2 sens ; irreversible cote relation.                |
| Profile-Edit   | Enregistrer (header)           | Upload avatar + PATCH /users/me + PATCH /username ; risque double-envoi et fuite file://.                  |
| Profile-Edit   | Enregistrer les modifications  | Meme handler que le header ; etat busy/disabled crucial contre double-soumission.                          |
| Profile-Edit   | Champ Pseudo                   | Route vers l'endpoint dedie avec verif d'unicite (USER_002) ; echec ne doit pas perdre les autres champs.  |
| Onboarding-Int | Terminer                       | Persiste les interets (MIN 3) et fait avancer l'onboarding ; bloquant pour finaliser le compte.            |

> Total enumere ci-dessus = 89 controles P0 (les variantes Suspendre 1h/24h/7d/Perm et Definir le role USER/MOD/ADMIN/SUPER comptent chacune comme une famille de 4 boutons reels dans l'agregat).

---

## 3. Liste P1 (important / non-bloquant immediat) — 220 controles

Categories representatives (non exhaustif, regroupe par nature ; chaque controle conserve sa fiche ecran detaillee).

### 3.1 Navigation principale (sortie d'ecran, retour)

- **Retour / Fermer** sur quasiment chaque ecran (Admin Audit/Home/Reports/Rooms/UDet/Users, Auth Name/OTP/Phone, Events, Houses, Messages, Notifications, Profile, Rooms, Search, Settings…) — seule voie de sortie ; multi-clic ne doit pas double-pop. Defaut a11y a relever sur les retours sans `accessibilityLabel` (GChat, GInfo, Notifications, Search).
- **Selecteur de pays** (Phone) + **Item pays** — determine l'indicatif et le formatage E.164.
- **Compteurs Abonnes/Abonnements** (Profile, Settings) — navigation vers les listes de relations.

### 3.2 Filtres, onglets & toggles de vue (pilotent la requete affichee)

- Onglets Admin Reports (Ouverts/Resolus/Tous), Events (A venir/Mes evenements), Ext-Feed (Tout/Rooms/Social/Clubs), Houses (My Houses/Discover), Notifications (Tout/Rooms/Social/Clubs), Profile-Followers (Followers/Following), Ext-Topics (categorie parente).
- Filtres role Admin-Users (Tous/User/Mod/Admin/Super) — surface de gouvernance ; un seul radio selectionne, cache par cle.
- Pills filtre Room-Feed (All/Following/Clubs) — filtres reseau ; bascule rapide sans requetes obsoletes.
- Visibilite Room-Create (Open/Social/Closed) & House-Create (Open/Private) — gating d'acces serveur.

### 3.3 Rafraichissement & synchro manuelle (pull-to-refresh, retry)

- Pull-to-refresh : Admin Audit/Reports/Rooms/Users, Ext-Feed, Houses, Messages, Notifications, Room-Feed, Search — seul moyen de re-synchroniser des ecrans non temps-reel ; robustesse hors-ligne/reconnexion.
- Reessayer (Settings-Notif) — unique recuperation apres echec GET.

### 3.4 Social / viralite / croissance

- Suivre / Following : Profile, Profile-Followers, Ext-Suggested — follow optimiste + rollback ; invalide profileKeys.
- Wave : Profile — ping social temps-reel rate-limite (USER_005) ; anti-spam multi-clic.
- Invitations : Room-Live Inviter, House-Detail Invite members, Settings Inviter des amis (quota + lien signe), House-Invite copier le lien & champ recherche.
- Cellules de decouverte : Ext-Suggested (voir profil), Search (Room/Club/User rows), Profile (ligne House/Room recente).

### 3.5 Reactions, audio differe & controles room secondaires

- Reaction emoji ❤️🔥👏😂🌊🎉 (Room-Live, throttle 250 ms, cap 24 floats).
- Signaler la room (Room-Live, Profile « Plus ») — moderation/securite niveau utilisateur.
- Lecture/Pause des bulles vocales (Chat, GChat) — player independant par bulle.
- Partage/chat/controles room (Partager le lien, Ouvrir le chat, Controles, Editer le titre).

### 3.6 Preferences avec rollback optimiste

- Settings-Notif : 9 interrupteurs (Nouveaux abonnes, Waves, Invitations room/club, Room demarree, Rappels, Nouveaux messages, On t'invite a parler, Mentions) — rollback onError obligatoire ; tous disabled pendant `isPending`.
- Ext-Settings : qualite audio (Standard/Elevee/Musique), audio spatial, suppression de bruit, mode drop-in, autoriser waves & pings — pipeline LiveKit + decouverte.
- Settings : Toggle Analytics (consentement RGPD SecureStore), Premium (Stripe), Godmode (gate role), Edit profile, Create House, Notifications.

### 3.7 Onboarding (parcours obligatoire, chemins alternatifs)

- Welcome (Suivant/Commencer, Passer), Setup profil (Continuer, Passer, avatar, champs Nom/Bio), Interets (chips de categories), Permission notifications (Activer, Plus tard), Suggested-Follows (Suivre, voir profil, Termine, Plus tard).

### 3.8 Champs de recherche & saisie secondaires

- Champs recherche : Houses-Invite, Room-Invite, Room-Create co-host, MSG-AddGrp, MSG-New, Map « Find a friend ».
- Cellules a cocher : Room-Invite candidat, champs nom de groupe (GInfo), champ Nom affiche (Profile-Edit).

### 3.9 Cartes & temps-reel social (non audio)

- Map : Pin follower, Message (DM), Recentrer, Fermer mini-carte, recherche.
- Ext-Play : ouvrir Twitter/Instagram, share sheet, reaction picker, chips reactions, Add to Calendar, segments de theme, champs Room ID/Interests.

### 3.10 Divers P1

- Auth-Landing Skip auth (dev) — seule action reseau de l'ecran, marquee DO NOT COMMIT (risque securite si present en prod).
- Auth-Username pill de suggestion, Auth-Waitlist Inviter un ami + Retour.
- Notifications Supprimer (swipe), House-Detail Options/Partager, Privacy-Policy Retour natif.

---

## 4. Liste P2 (secondaire / opportuniste) — 72 controles

Categories representatives.

### 4.1 Contenu legal & statique (lecture seule)

- Privacy-Policy : defilement du document, e-mail de contact non actionnable, Retour natif.
- Privacy-Terms : Retour natif, document defilable.
- Export-Data : Retour natif.
- Liens « Conditions d'utilisation » / « Politique de confidentialite » (Phone).

### 4.2 Variantes & cellules de liste non pressables

- Cellule d'audit Admin (lecture seule), « Charger plus » (scroll infini Admin-Users), liste des messages (Chat), cellule membre deja present (MSG-AddGrp), item utilisateur en ligne (MSG-List).
- Cellules Room-Live secondaires : « Suivi par toi », « Autres » (grille).

### 4.3 Champs optionnels & adornments

- Champ Nom de famille (Auth-Name, Profile-Edit), champ Description (House-Create, Room-Create), champs Prenom/Nom/Bio non bloquants (Profile-Edit).
- Champ recherche pays + bouton Fermer du selecteur (Phone).

### 4.4 Reactions emoji etendues & partage social (Playground)

- Reactions 👏🔥😂🙏🎉✨🤯 (Ext-Play), liens URL de demo, share via Twitter/WhatsApp/Telegram/More, backdrops de fermeture, Cancel.

### 4.5 Planification de room (presets & pickers)

- Room-Create : Quick presets / Pick date & time, presets +30min/+1h/+3h/+1j, cellules Jour/Heure/Minute.
- Pills filtre par sujet Room-Feed (Tech/Music/Business/Health), icones de navigation secondaires (Explorer, Events, Replays).

### 4.6 Actions de confort & affichage profil/settings

- Profile : copier le pseudo, Voir plus/moins (bio), liens Twitter/Instagram, « Tout voir » Houses.
- Settings : See more/less bio, Stat Clubs (lecture seule), View all houses, Privacy/Terms/Export, Wave top-bar.
- Chat : Appeler, Plus d'options, Inserer un emoji, Joindre un fichier (tous « bientot disponible »).
- House-Invite : etat « Invited », actions Alert Partager/OK ; House-Detail Partager la house.
- Onboarding-Welcome carousel swipe ; Map marker « Your location ».

---

## 5. Ordre d'execution recommande — campagne smoke (P0 d'abord)

Objectif d'une **smoke** : valider en un minimum de temps que les chemins critiques ne sont pas casses, **avant** d'investir dans la couverture P1/P2. On suit le **parcours utilisateur reel** (du premier lancement a l'usage avance), puis les surfaces admin/RGPD. Chaque vague est un **point de controle** : si une vague echoue, on stoppe et on corrige avant de continuer (les vagues aval dependent des amont).

> Pour la smoke, on ne joue que **1 a 2 cas par controle P0** : le cas positif nominal + le cas critique de robustesse (multi-clic OU perte reseau OU reconnexion) selon le controle. Cibler ~120-150 cas sur les ~89 controles P0.

### Vague 0 — Pre-requis environnement (gate technique)

Verifier d'abord, sinon tout le reste est faux negatif : build **EAS dev-client** (la voix LiveKit n'existe pas en Expo Go), `.env` racine pointant l'IP LAN courante, backend `:4000` up, Postgres + Redis up, compte admin de test disponible.

### Vague 1 — AUTH (le verrou d'entree) — 10 controles P0

1. Landing : Commencer -> Phone.
2. Phone : pays + numero E.164 + case 16 ans + Recevoir un code.
3. OTP : saisie 6 chiffres -> auto-submit -> session (tester aussi 1 code errone / verrouillage).
4. Name : Prenom + Suivant.
5. Username : pseudo valide + Valider -> sortie du stack Auth.
   > **Gate :** si l'auth echoue, inutile de continuer — aucun ecran authentifie n'est atteignable.

### Vague 2 — ROOMS, l'experience coeur temps-reel — 13 controles P0

6. Room-Feed : Rejoindre une room live.
7. Room-Live : Mute/Unmute, Lever/Baisser la main, promotion main levee, Reaction, **Quitter**.
8. Room-Live (host) : Fermer la room (End Room) — verifier `room:ended` cote autre device.
9. Room-Create : Sujet + Demarrer -> entre dans la room.
10. Room-Invite : Envoyer ; Room-Replay : Play/Pause.
11. Map : Grant access, Join Room, Toggle Ghost Mode.
    > **Gate :** c'est la valeur produit ; couvrir en **multi-device** (2 comptes) pour le temps-reel (mute force, kick, role_changed, reconnexion 3G/Wi-Fi).

### Vague 3 — MESSAGES (chat + vocal) — 16 controles P0

12. MSG-List : ouvrir une conversation 1:1.
13. Chat : champ + Envoyer (texte), Micro + Envoyer vocal.
14. MSG-New : selection + Demarrer (1:1 et groupe).
15. GChat : champ + Envoyer, Micro + Envoyer vocal.
16. GInfo : renommer, retirer un membre, **Quitter le groupe**.
17. MSG-AddGrp : selection + Ajouter N.

### Vague 4 — HOUSES (clubs & adhesion) — 9 controles P0

18. House-List : ouvrir une house ; House-Create : Nom + Creer.
19. House-Detail : Rejoindre, Ouvrir une room, Gerer le role, Promouvoir/Retrograder.
20. House-Invite : Inviter par ligne ; House-Invitation : Accept.

### Vague 5 — SOCIAL / NOTIFICATIONS / PROFIL — P0 ponctuels

21. Notifications : Tout marquer lu, Ligne notification (deep-link -> Room).
22. Ext-Feed : ligne d'activite (gate `live-`) ; Ext-Play : Wave, mute/leave/back-to-room banner.
23. Events : RSVP ; Search : champ de recherche.
24. Profile : Bloquer ; Profile-Edit : Enregistrer + champ Pseudo.
25. Ext-Settings : Profil prive + M'afficher sur la carte (verifier le **rollback** sur echec serveur).
26. Ext-Topics : cellule sous-sujet / resultat ; Onboarding-Int : Terminer.

### Vague 6 — ADMIN (moderation destructive) — 13 controles P0

> A jouer avec un compte **admin / super_admin** de test, sur des **donnees jetables** (les actions sont irreversibles). 27. ADM-Home : Rooms Actives ; ADM-Users : recherche + ouvrir un detail. 28. ADM-Reports : Resoudre, Ignorer. 29. ADM-Rooms : Fermer la room (force-end) — verifier ejection cote participant. 30. ADM-UDet : Suspendre (chaque duree), Lever, Definir le role, Usurper, Supprimer, Alert/motif.

### Vague 7 — RGPD / SUPPRESSION (irreversible, en dernier) — 6 controles P0

> Joue en **dernier** car ces actions detruisent les comptes/sessions de test. 31. Priv-Export : Generer et partager mon export. 32. Settings : Sign out ; Settings : Delete my account. 33. Priv-Delete : saisie de confirmation + bouton + Alert destructive (sur un compte jetable dedie).

### Apres la smoke (P0 vert) — campagnes etendues

- **Campagne P1** : par feature (Admin, Auth, Events, Extensions, Houses, Maps, Messages, Notifications, Onboarding, Privacy, Profile, Rooms, Search, Settings). Lancer **feature par feature** en `--runInBand` (contrainte memoire PC ~1 Go libre, OOM en parallele).
- **Campagne P2** : regression de fond, accessibilite (labels manquants sur les Retour de GChat/GInfo/Notifications/Search), liens legaux, variantes.
- **Matrices transverses a rejouer sur les P0** : Android + iOS (OS recents + anciens), reseaux 3G/4G/5G/Wi-Fi avec pertes/latence/reconnexion, FR + EN, roles guest/standard/admin.

---

### Recapitulatif de l'ordre smoke

| Vague | Domaine                                       | Controles P0 | Gate bloquante |
| ----- | --------------------------------------------- | ------------ | -------------- |
| 0     | Environnement (EAS dev-client, .env, backend) | —            | Oui            |
| 1     | Auth (OTP)                                    | 10           | Oui            |
| 2     | Rooms (join/quitter, mute, main, end)         | 13           | Oui            |
| 3     | Messages (texte + vocal)                      | 16           | Non            |
| 4     | Houses (adhesion + moderation)                | 9            | Non            |
| 5     | Social / Notifs / Profil / Privacy toggles    | ~22          | Non            |
| 6     | Admin (moderation destructive)                | 13           | Non            |
| 7     | RGPD / suppression compte (irreversible)      | 6            | Dernier        |
|       | **Total P0**                                  | **89**       |                |
