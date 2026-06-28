# ChatHouse — Manuel des écrans

> Guide de référence des **53 écrans** de l'application (sous `src/features/`).
> Pour chaque écran : **Rôle**, **Fonctions** clés, **Accès** (qui / d'où).
> Basé sur l'audit du code source réel · 28 juin 2026.

## Carte de navigation

L'app s'articule autour de 4 navigateurs :

- **RootNavigator** — aiguille selon l'état d'auth : `Onboarding` → `Auth` → `Main`.
- **AuthNavigator** — parcours d'inscription/connexion (téléphone → OTP → nom → username).
- **OnboardingNavigator** — intro + intérêts + profil + permissions.
- **MainNavigator** — barre d'onglets : **Salons** (RoomsNavigator), **Messages** (MessagesNavigator), **Carte** (MapsNavigator), **Réglages** (SettingsNavigator). Les écrans Profil, Clubs, Events, Replays, Explore, Admin, Extensions, Confidentialité sont empilés dans ces stacks.

> _Hors des 53 : `AnimatedSplashScreen` (écran de démarrage, dans `shared/`) et `renderScreen.tsx` (utilitaire de test)._

---

## 1. Authentification (6 écrans)

**1. LandingScreen** — _Écran d'accueil marketing pré-auth._

- Logo animé, 3 atouts (rooms/houses/chat), CTA « Get started » et « Login » (les deux → Phone). Bouton dev-skip visible uniquement en `__DEV__`.
- **Accès** : premier écran pour un visiteur non connecté.

**2. PhoneScreen** — _Saisie du numéro de téléphone (étape 1, façon Clubhouse)._

- Sélecteur de pays (détection locale, drapeau + indicatif), formatage live, validation E.164, case obligatoire « ≥ 16 ans », liens Terms/Privacy → envoi OTP.
- **Accès** : depuis Landing.

**3. OtpScreen** — _Vérification du code SMS._

- 6 cases, auto-submit, numéro masqué, **5 tentatives max**, **renvoi avec compte à rebours 60 s**, animation shake sur erreur. Nouvel utilisateur → Name.
- **Accès** : après PhoneScreen.

**4. NameScreen** — _Vrai nom (prénom + nom), avant le username (ordre Clubhouse)._

- Prénom obligatoire, nom optionnel ; stockés dans le store d'onboarding.
- **Accès** : après OTP (nouvel utilisateur).

**5. UsernameScreen** — _Choix du @username (finalise la connexion)._

- Suggestions de username via API, validation (3–24 car., `[a-z0-9_]`) ; promeut le statut à « authentifié ».
- **Accès** : après NameScreen.

**6. WaitlistScreen** — _Écran « liste d'attente » + invitation virale._

- Visuel sablier, bouton « Inviter un ami » (partage natif). **Écran enregistré mais jamais routé** (pas de gating réel à l'entrée).
- **Accès** : deep-link `auth/waitlist` uniquement (inatteignable par le flux normal).

---

## 2. Onboarding (4 écrans)

**7. WelcomeSlidesScreen** — _Carrousel d'intro (4 slides : welcome/rooms/clubs/topics)._

- Pagination, dots, Skip ; « vu » persisté → bascule vers Landing.
- **Accès** : tout premier lancement de l'app.

**8. InterestSelectionScreen** — _Sélection des centres d'intérêt / topics._

- Chips multi-sélection, **min 3 / max 10**, persistés dans le store.
- **Accès** : étape d'onboarding (après permission notifs).

**9. SetupProfileScreen** — _Photo + nom affiché + bio._

- Photo via galerie (upload), **import depuis X/Twitter** (nom/bio/avatar), bio (150 car.), Skip possible.
- **Accès** : étape d'onboarding.

**10. NotificationsPermissionScreen** — _Demande de permission push._

- Liste de bénéfices, bouton « Enable » (prompt OS + enregistrement token) ou « Not now » (aucun ne bloque le flux).
- **Accès** : étape d'onboarding.

---

## 3. Hallway & Salons audio (5 écrans)

**11. RoomFeedScreen** — _Le « hallway » : fil des salons live et à venir._

- Liste paginée (infinite scroll, pull-to-refresh), filtres (All/Following/Clubs/Tech/Music/Business/Health), cartes salon (catégorie, house, amis présents, avatars speakers/listeners, compteurs, Join), bande « Upcoming », strips d'extensions (personnes dispo + wave, suggestions, recently played), updates live via socket, FAB « Start a room ».
- **Accès** : onglet **Salons** (écran d'accueil principal).

**12. RoomScreen** — _La salle audio live (cœur de l'app)._

- Scène speakers/listeners avec indicateur « is speaking » (LiveKit) ; **lever/baisser la main + file d'attente** ; **modération complète** (mute autrui, inviter à parler, renvoyer au public, nommer modérateur, transférer l'hôte, mute-all, lock, restriction lever-de-main, kick+ban) ; **réactions emoji** ; **captions live on-device** ; **audio en arrière-plan / mini-bar** ; ping + wave + tip + partage + signalement ; mode invisible (listeners). Réception socket : mute/kick/role/ended.
- **Accès** : depuis un tap sur un salon (feed, club, carte, deep-link).

**13. CreateRoomScreen** — _Création de salon (immédiat ou planifié)._

- Titre/description, visibilité Open/Social/Closed, attacher à une House, topics (max 5), **co-hôtes** (max 5), **planification** (presets ou date/heure), toggle enregistrement.
- **Accès** : FAB du RoomFeed.

**14. InviteToRoomScreen** — _Inviter des utilisateurs dans un salon existant._

- Recherche débouncée, sélection multiple (max 50), envoi groupé qui notifie les invités.
- **Accès** : depuis RoomScreen (action inviter).

**15. ReplaysScreen** — _Replays/enregistrements récents des salons._

- Liste (titre, hôte, date), **lecteur audio inline** (play/pause/progression). Pas de scrub ni transcript.
- **Accès** : header du RoomFeed / profil.

---

## 4. Événements (1 écran)

**16. EventsScreen** — _Salons planifiés (à venir + les miens) avec RSVP._

- Onglets Upcoming/Mine, carte événement (hôte, titre, temps relatif, nb RSVP), **RSVP/annulation**, **ajout au calendrier (.ics)**, host : reprogrammer / annuler.
- **Accès** : header du RoomFeed.

---

## 5. Clubs / « Houses » (6 écrans)

**17. HouseListScreen** — _Liste des clubs (mes clubs + découverte)._

- Onglets Mine/Discover, rangée club (icône, nom, catégorie, nb membres), FAB création. (Recherche de clubs : via Explore.)
- **Accès** : depuis le profil / les réglages (« member of »).

**18. HouseDetailScreen** — _Fiche club complète._

- Cover, règles/charte, membres + **rôles admin/mod/member**, CTA selon privacy (Rejoindre / Demander / Sur invitation), **inbox des demandes d'adhésion (SOCIAL)**, rooms live/planifiées/passées, partage, inviter, quitter, « Gérer » (admins).
- **Accès** : tap sur un club (liste, explore, deep-link `/h/:id`).

**19. CreateHouseScreen** — _Création d'un club._

- Upload d'icône, nom/description/**règles**, **privacy à 3 niveaux** (Open/Social/Private).
- **Accès** : FAB de HouseList.

**20. ManageHouseScreen** — _Édition d'un club (admins) + suppression (owner)._

- Édition nom/description/règles/privacy ; **zone de danger « Delete »** réservée à l'owner.
- **Accès** : HouseDetail → engrenage « Gérer » (admins).

**21. HouseInvitationScreen** — _Acceptation d'une invitation reçue._

- Affiche icône/nom/nb membres du club, boutons Accepter (→ HouseDetail) / Refuser.
- **Accès** : deep-link / notification CLUB_INVITE.

**22. InviteMemberScreen** — _Inviter des membres dans un club._

- **Lien d'invitation** copiable/partageable + recherche d'utilisateurs avec invite ciblée.
- **Accès** : HouseDetail → « Invite members ».

---

## 6. Carte (1 écran)

**23. MapsScreen** — _Carte géo-sociale des abonnés en ligne (exclusif ChatHouse)._

- Carte OpenStreetMap, position perso (pulse), markers followers (rôle/micro live), recherche/filtre, auto-centrage, **Ghost Mode** (invisibilité) + broadcast position, mini-carte au tap (rejoindre la room / envoyer un DM), gestion des permissions.
- **Accès** : onglet **Carte**.

---

## 7. Découverte & Recherche (1 écran)

**24. ExploreScreen** — _Recherche unifiée + feed de tendances._

- Feed (query vide) : Trending rooms / Popular clubs / People to follow ; Résultats (query) : users/clubs/rooms/**topics** ; **filtres langue + catégorie**, recherches récentes, lien « Browse topics ».
- **Accès** : header du RoomFeed (loupe).

---

## 8. Notifications (1 écran)

**25. NotificationsScreen** — _Centre de notifications._

- Onglets all/rooms/social/clubs ; 9 types (follow, room_invite, club_invite, room_starting, mention/speaker_request, wave, hand_accepted, rsvp_reminder, new_message) ; deep-link au tap, mark-as-read (un/tous), **swipe-to-delete**, badge non-lus.
- **Accès** : header du RoomFeed (cloche).

---

## 9. Profil & Identité (4 écrans)

**26. ProfileScreen** — _Profil (soi ou autrui)._

- Identité complète : avatar+online, **vrai nom**, **@username** copiable, **Joined**, **Nominated by**, bio, **liens Twitter/Instagram**, **badges**, liens custom, stats following/followers. Actions : Follow/Unfollow, **Wave**, bannière « en direct », Block/Report, Share. Self : Edit, events à venir, replays publics, **« qui a vu mon profil » (premium)**, mes Houses, rooms récentes.
- **Accès** : tap sur un avatar/nom partout dans l'app ; le sien via Réglages.

**27. EditProfileScreen** — _Édition du profil._

- Photo, prénom/nom, display name, username, bio (150), handles Twitter/Instagram, **DM privacy** (everyone/followers/mutual/nobody).
- **Accès** : ProfileScreen (self) / Settings → Edit.

**28. FollowersScreen** — _Listes Followers / Following._

- Onglets, rangée user avec Follow/Following inline.
- **Accès** : tap sur les compteurs followers/following.

**29. TipHistoryScreen** — _Historique des pourboires (monétisation)._

- Liste sent/received, montant formaté, date, sens (lecture seule ; l'envoi se fait via la feuille de tip en room).
- **Accès** : Réglages (si paiements configurés).

---

## 10. Messages / « Backchannel » (6 écrans)

**30. MessagesScreen** — _Liste des conversations (DM 1:1 + groupes)._

- Conversations avec avatar/nom/dernier message/horodatage/badge non-lus, aperçu « voix » 🎤, section Groups séparée, updates socket, bouton nouveau message.
- **Accès** : onglet **Messages**.

**31. ChatDetailScreen** — _Fil de discussion DM 1:1._

- Texte + **notes vocales** (record→upload), liste inversée, séparateurs de date, **indicateur de saisie**, marquage lu auto, suppression de ses messages, emojis. (Appels/pièces jointes = « Coming soon ».)
- **Accès** : tap sur une conversation / un profil.

**32. NewMessageScreen** — _Choisir un ou plusieurs destinataires._

- Recherche débouncée ; 1 sélectionné → DM 1:1, ≥2 → crée un **groupe**.
- **Accès** : MessagesScreen → crayon.

**33. GroupChatScreen** — _Fil de discussion de groupe._

- Texte + notes vocales de groupe, brouillon restauré, nom de l'expéditeur, titre auto-dérivé, accès GroupInfo.
- **Accès** : depuis MessagesScreen (groupe) / création.

**34. GroupInfoScreen** — _Gestion d'un groupe._

- Renommer (owner), liste des membres, **retirer un membre** (owner), **ajouter des personnes**, **quitter le groupe**.
- **Accès** : GroupChat → header/info.

**35. AddGroupMembersScreen** — _Ajouter des membres à un groupe._

- Recherche débouncée, sélection multiple, membres déjà présents grisés.
- **Accès** : GroupInfo → « Ajouter ».

---

## 11. Réglages (3 écrans)

**36. SettingsScreen** — _Profil personnel + hub de réglages._

- En-tête profil + stats ; éditer le profil, créer une house, « member of » ; **Confidentialité/RGPD** (consentement analytics, Politique, CGU, Export des données, Comptes bloqués, thème) ; **Compte** (inviter des amis, Notifications, Extensions, Supprimer le compte) ; déconnexion ; entrées conditionnelles (Premium, Tip history, **Godmode/Admin** si rôle ≥ MODERATOR).
- **Accès** : onglet **Réglages**.

**37. NotificationSettingsScreen** — _Réglages de notifications granulaires._

- **9 catégories** de toggles, sélecteur de fréquence (infrequent/normal/frequent), **mute par club** et **mute par utilisateur**.
- **Accès** : Réglages → Notifications.

**38. BlockedUsersScreen** — _Gérer les comptes bloqués._

- Liste des bloqués, **débloquer** par ligne.
- **Accès** : Réglages → Comptes bloqués.

---

## 12. Confidentialité & Légal (4 écrans)

**39. DataExportScreen** — _Export RGPD des données personnelles._

- Génère l'archive JSON complète et la transmet via la feuille de partage native ; affiche la taille ; copie presse-papiers opt-in + bouton d'effacement.
- **Accès** : Réglages → Confidentialité → Exporter mes données.

**40. DeleteAccountScreen** — _Demande de suppression de compte._

- Avertissements (délai de grâce, conséquences), saisie de la phrase « DELETE », double confirmation → suppression + déconnexion.
- **Accès** : Réglages → Supprimer mon compte.

**41. PrivacyPolicyScreen** — _Politique de confidentialité (statique, embarquée)._

- Document légal 7 sections (i18n), date de mise à jour, email de contact cliquable.
- **Accès** : Réglages → Politique de confidentialité.

**42. TermsScreen** — _Conditions d'utilisation (statique, embarquée)._

- Document légal 8 sections (i18n), date de mise à jour.
- **Accès** : Réglages → Conditions d'utilisation.

---

## 13. Extensions (5 écrans)

**43. ExtActivityFeedScreen** — _Flux d'activité temps réel._

- Notifications REST + préfixe socket (room démarrée par un suivi, demande d'adhésion, wave), dédup, plafond 200, mark-as-read, pull-to-refresh.
- **Accès** : route `ActivityFeed` (programmatique/deep-link ; pas de bouton in-app direct).

**44. ExtSuggestedFollowsScreen** — _Suggestions de personnes à suivre._

- Liste (jusqu'à 30) avec raison (intérêts communs / amis d'amis / followers), Follow optimiste, tap → profil.
- **Accès** : dernière étape d'onboarding (route `onboarding/suggested-follows`).

**45. ExtTopicExplorerScreen** — _Explorateur de 150+ sujets._

- Navigation 2 volets (catégories / sous-catégories), recherche fuzzy, bande de sujets tendance.
- **Accès** : ExploreScreen → « Browse topics ».

**46. ExtSettingsScreen** — _Réglages additionnels._

- Thème ; **qualité audio** (Standard/High/Music) ; **moteur audio** (audio spatial 3D, suppression de bruit, mode drop-in) ; **confidentialité** (profil privé, autoriser waves/pings, visibilité carte).
- **Accès** : Réglages → Extensions.

**47. ExtPlaygroundScreen** — _Banc de QA développeur (composants en isolation)._

- Rend les composants d'extension V1–V15 avec champs de test (room id, intérêts) et actions (wave, partage, réactions).
- **Accès** : aucun (écran de test, non câblé ; à monter manuellement en QA).

---

## 14. Administration / « Godmode » (6 écrans — rôle ≥ MODERATOR)

**48. AdminHomeScreen** — _Tableau de bord du panneau d'administration._

- KPI temps réel (users totaux/online, salons live, signalements ouverts, suspendus, nouveaux 24h/7j, messages 24h) ; tuiles (Utilisateurs, Signalements [badge], Salons [≥ADMIN], Journal d'audit [SUPER_ADMIN]) ; **exports CSV** (SUPER_ADMIN).
- **Accès** : Réglages → Godmode (visible si ≥ MODERATOR ; re-vérifié serveur, 403 sinon).

**49. AdminUsersScreen** — _Recherche & liste paginée des utilisateurs._

- Recherche débouncée + filtre par rôle, liste infinie (curseur), badges rôle/Suspendu/Supprimé, tap → fiche.
- **Accès** : AdminHome → Utilisateurs.

**50. AdminUserDetailScreen** — _Fiche utilisateur + actions de modération._

- Profil complet + état suspension ; **suspendre** (1h/24h/7j/permanent + motif) / lever ; **changer rôle**, **supprimer**, **impersonation** (SUPER_ADMIN) ; garde-fou de hiérarchie (cible de rang inférieur seulement).
- **Accès** : AdminUsers → tap utilisateur.

**51. AdminRoomsScreen** — _Salons live + fermeture forcée (rôle ≥ ADMIN)._

- Liste des salons live (hôte, titre, participants, badge LIVE), **fermer** un salon avec motif (notifie + coupe LiveKit).
- **Accès** : AdminHome → Salons (si ≥ ADMIN).

**52. AdminReportsScreen** — _File de modération des signalements._

- Onglets Ouverts/Résolus/Tous, carte (type USER/ROOM, motif, cible, rapporteur, date), actions **Rejeter** / **Résoudre**.
- **Accès** : AdminHome → Signalements.

**53. AdminAuditLogScreen** — _Journal d'audit en lecture seule (SUPER_ADMIN)._

- 100 dernières actions privilégiées (rôle, suspension, suppression, fermeture salon, résolution signalement, accès Godmode, impersonation) avec acteur, cible, métadonnées, horodatage, IP.
- **Accès** : AdminHome → Journal d'audit (SUPER_ADMIN uniquement).

---

_Fin du manuel — 53 écrans. Document interne ChatHouse._
