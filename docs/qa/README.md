# Plan & cas de tests QA — ChatHouse (50 écrans, Android + iOS)

> Application **temps réel** type Clubhouse : audio live **LiveKit**, messagerie & présence **WebSocket** (`socket.io-client`), **push notifications**, i18n **FR/EN**, rôles **guest / standard / moderator / admin / super_admin**, plateformes **Android + iOS** (OS récents et anciens), réseaux **3G/4G/5G/Wi-Fi** avec pertes/latence/reconnexion.

Cet ensemble couvre **tous les boutons et interactions** des 50 écrans réels de l'application. Chaque cas est **ancré dans le code** (vrais `accessibilityLabel` / clés i18n / handlers / événements WebSocket), donc directement exécutable par une équipe QA **manuelle** et par l'**automatisation** (Detox / Maestro / RTL).

## Chiffres clés du parc testé

| Indicateur                      | Valeur                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Écrans couverts                 | **50 / 50**                                                                                                   |
| Boutons & interactions recensés | **381**                                                                                                       |
| Cas de test détaillés           | **≈ 991** (positif + erreur/limite + accessibilité, + temps-réel multi-utilisateur sur les boutons critiques) |
| Livrables transversaux          | **11**                                                                                                        |
| Lignes de documentation         | **≈ 19 700**                                                                                                  |

## Méthodologie (à lire en premier)

- **Locators réels** : la convention du dépôt est la sélection par `accessibilityLabel` (souvent `t('clé','fallback')`), `accessibilityRole`, `accessibilityState` (`selected`/`checked`/`disabled`). Les tests existants ciblent par `getByLabelText`. Chaque bouton de la matrice indique son **locator exact** trouvé dans le code.
- **3 types de cas minimum par bouton** : (1) **fonctionnel positif**, (2) **erreur/limite** (multi-clic rapide + perte réseau/latence/reconnexion selon pertinence), (3) **accessibilité** (TalkBack/VoiceOver, police agrandie, contraste). Les boutons **temps-réel** reçoivent un 4ᵉ cas **multi-utilisateur / synchro**.
- **Contrôles répétitifs** : les familles de contrôles identiques (ex. 4 presets de suspension admin, 6 emojis de réaction, N deep-links sociaux du playground) sont couvertes par des cas **paramétrés** plutôt que dupliquées littéralement — chaque bouton reste listé dans la matrice et couvert par les 3 types.
- **Priorisation** : `P0` (chemin critique / sécurité / temps-réel cœur : auth OTP, rejoindre/quitter room, mute/main levée, envoi message, modération destructive, suppression compte) · `P1` (navigation, création, follow/invite) · `P2` (secondaire/légal/cosmétique).
- **Convention d'ID** : `<PREFIXE-ÉCRAN>-NNN` (ex. `ROOM-LIVE-011`, `AUTH-OTP-001`) — uniques globalement, prêts pour la traçabilité bug ↔ cas.

---

## Livrables transversaux

| #   | Document                                                       | Contenu                                                                                                                                                                                   |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00  | [Plan de test global](00-plan-overview.md)                     | Objectifs, périmètre, hors-périmètre, risques + mitigations, dépendances (comptes/données/builds EAS), matrice d'appareils Android/iOS, rôles & jeux de données, critères d'entrée/sortie |
| 01  | [Matrice maîtresse écran × bouton](01-matrice-ecran-bouton.md) | Vue agrégée : synthèse par écran + grand tableau plat des 381 boutons (type, locator, temps-réel, priorité), totaux & répartitions                                                        |
| 02  | [Priorisation P0/P1/P2](02-priorisation.md)                    | Définition des niveaux + listes justifiées + ordre d'exécution smoke                                                                                                                      |
| 03  | [Scénarios temps-réel](03-scenarios-temps-reel.md)             | Multi-utilisateurs (room/messages), race conditions notifications, re-sync après reconnexion, cohérence multi-appareils                                                                   |
| 04  | [Plan de test réseau](04-plan-reseau.md)                       | Profils dégradés (latence/bande passante/perte), coupure **pendant** action, idempotence, reconnexion WebSocket/LiveKit                                                                   |
| 05  | [Accessibilité](05-accessibilite.md)                           | Checklist WCAG mobile + procédures pas-à-pas TalkBack / VoiceOver + cas A11Y réutilisables                                                                                                |
| 06  | [Scripts d'automatisation](06-automatisation.md)               | **14 boutons critiques** × 3 pseudo-scripts (Detox + Maestro + RTL) avec assertions + stratégie d'automatisation                                                                          |
| 07  | [Régression ciblée](07-regression.md)                          | Suites smoke / régression UI / régression backend / régression temps-réel + table de traçabilité changement→cas                                                                           |
| 08  | [Couverture & estimation](08-couverture-estimation.md)         | Matrice de couverture % (manuel/auto) + estimations de temps (campagne complète, smoke, run automatisé, matrice 4 devices)                                                                |
| 09  | [Modèle de rapport d'anomalie](09-modele-anomalie.md)          | Template bug à copier-coller + barème de sévérité + cycle de vie + 2 exemples remplis                                                                                                     |
| 10  | [Instrumentation](10-instrumentation.md)                       | Logs structurés, traces WebSocket/LiveKit, métriques temps-réel, overlay debug QA, collecte (logcat/idevicesyslog/HAR/Sentry)                                                             |

---

## Synthèse par feature

| Feature       | Écrans | Boutons | Cas de test |
| ------------- | -----: | ------: | ----------: |
| admin         |      6 |      45 |         114 |
| auth          |      6 |      25 |          83 |
| events        |      1 |       5 |          14 |
| extensions    |      5 |      62 |         104 |
| houses        |      5 |      32 |         102 |
| maps          |      1 |       9 |          28 |
| messages      |      6 |      41 |         139 |
| notifications |      1 |       9 |          24 |
| onboarding    |      4 |      18 |          42 |
| privacy       |      4 |      13 |          35 |
| profile       |      3 |      28 |          79 |
| rooms         |      5 |      57 |         138 |
| search        |      1 |       6 |          20 |
| settings      |      2 |      31 |          71 |
| **Total**     | **50** | **381** |   **≈ 991** |

---

## Index des 50 écrans (cas de test détaillés)

> Chaque fichier contient : **Contexte écran** (route, rôles, comportements temps-réel, états de données) → **Matrice bouton** (locator réel + type + priorité) → **Cas de test** (étapes, résultat attendu, critère OK/KO, données, durée).

### admin (réservé `admin` / `super_admin`)

| #   | Écran              | Boutons | Cas | Fichier                                    |
| --- | ------------------ | ------: | --: | ------------------------------------------ |
| 01  | Journal d'audit    |       3 |  13 | [01-ADM-AUDIT.md](screens/01-ADM-AUDIT.md) |
| 02  | Accueil admin      |       8 |  24 | [02-ADM-HOME.md](screens/02-ADM-HOME.md)   |
| 03  | Signalements       |       7 |  18 | [03-ADM-REP.md](screens/03-ADM-REP.md)     |
| 04  | Rooms (admin)      |       3 |  15 | [04-ADM-ROOMS.md](screens/04-ADM-ROOMS.md) |
| 05  | Détail utilisateur |      14 |  24 | [05-ADM-UDET.md](screens/05-ADM-UDET.md)   |
| 06  | Utilisateurs       |      10 |  20 | [06-ADM-USERS.md](screens/06-ADM-USERS.md) |

### auth

| #   | Écran               | Boutons | Cas | Fichier                                      |
| --- | ------------------- | ------: | --: | -------------------------------------------- |
| 07  | Accueil / Landing   |       3 |  14 | [07-AUTH-LAND.md](screens/07-AUTH-LAND.md)   |
| 08  | Saisie du nom       |       4 |  12 | [08-AUTH-NAME.md](screens/08-AUTH-NAME.md)   |
| 09  | Code OTP            |       3 |  13 | [09-AUTH-OTP.md](screens/09-AUTH-OTP.md)     |
| 10  | Numéro de téléphone |      10 |  24 | [10-AUTH-PHONE.md](screens/10-AUTH-PHONE.md) |
| 11  | Nom d'utilisateur   |       3 |  12 | [11-AUTH-UNAME.md](screens/11-AUTH-UNAME.md) |
| 12  | Liste d'attente     |       2 |   8 | [12-AUTH-WAIT.md](screens/12-AUTH-WAIT.md)   |

### events

| #   | Écran      | Boutons | Cas | Fichier                        |
| --- | ---------- | ------: | --: | ------------------------------ |
| 13  | Événements |       5 |  14 | [13-EVT.md](screens/13-EVT.md) |

### extensions

| #   | Écran                 | Boutons | Cas | Fichier                                      |
| --- | --------------------- | ------: | --: | -------------------------------------------- |
| 14  | Fil d'activité        |       7 |  15 | [14-EXT-FEED.md](screens/14-EXT-FEED.md)     |
| 15  | Playground            |      34 |  37 | [15-EXT-PLAY.md](screens/15-EXT-PLAY.md)     |
| 16  | Réglages extensions   |      12 |  23 | [16-EXT-SET.md](screens/16-EXT-SET.md)       |
| 17  | Suggestions à suivre  |       5 |  14 | [17-EXT-FOLLOW.md](screens/17-EXT-FOLLOW.md) |
| 18  | Explorateur de sujets |       4 |  15 | [18-EXT-TOPIC.md](screens/18-EXT-TOPIC.md)   |

### houses

| #   | Écran             | Boutons | Cas | Fichier                                          |
| --- | ----------------- | ------: | --: | ------------------------------------------------ |
| 19  | Créer une house   |       7 |  21 | [19-HOUSE-CREATE.md](screens/19-HOUSE-CREATE.md) |
| 20  | Détail house      |       9 |  34 | [20-HOUSE-DETAIL.md](screens/20-HOUSE-DETAIL.md) |
| 21  | Invitation house  |       3 |  11 | [21-HOUSE-INVITE.md](screens/21-HOUSE-INVITE.md) |
| 22  | Liste des houses  |       6 |  18 | [22-HOUSE-LIST.md](screens/22-HOUSE-LIST.md)     |
| 23  | Inviter un membre |       7 |  18 | [23-HOUSE-MEMBER.md](screens/23-HOUSE-MEMBER.md) |

### maps

| #   | Écran | Boutons | Cas | Fichier                        |
| --- | ----- | ------: | --: | ------------------------------ |
| 24  | Carte |       9 |  28 | [24-MAP.md](screens/24-MAP.md) |

### messages

| #   | Écran                         | Boutons | Cas | Fichier                                      |
| --- | ----------------------------- | ------: | --: | -------------------------------------------- |
| 25  | Ajouter des membres au groupe |       5 |  17 | [25-MSG-ADDGRP.md](screens/25-MSG-ADDGRP.md) |
| 26  | Conversation (détail)         |      12 |  38 | [26-MSG-CHAT.md](screens/26-MSG-CHAT.md)     |
| 27  | Chat de groupe                |       9 |  28 | [27-MSG-GCHAT.md](screens/27-MSG-GCHAT.md)   |
| 28  | Infos du groupe               |       6 |  22 | [28-MSG-GINFO.md](screens/28-MSG-GINFO.md)   |
| 29  | Messages (liste)              |       5 |  18 | [29-MSG-LIST.md](screens/29-MSG-LIST.md)     |
| 30  | Nouveau message               |       4 |  16 | [30-MSG-NEW.md](screens/30-MSG-NEW.md)       |

### notifications

| #   | Écran         | Boutons | Cas | Fichier                            |
| --- | ------------- | ------: | --: | ---------------------------------- |
| 31  | Notifications |       9 |  24 | [31-NOTIF.md](screens/31-NOTIF.md) |

### onboarding

| #   | Écran                           | Boutons | Cas | Fichier                                        |
| --- | ------------------------------- | ------: | --: | ---------------------------------------------- |
| 32  | Sélection des centres d'intérêt |       8 |   9 | [32-ONB-INT.md](screens/32-ONB-INT.md)         |
| 33  | Permission notifications        |       2 |   7 | [33-ONB-PERM.md](screens/33-ONB-PERM.md)       |
| 34  | Configuration du profil         |       5 |  15 | [34-ONB-SETUP.md](screens/34-ONB-SETUP.md)     |
| 35  | Slides de bienvenue             |       3 |  11 | [35-ONB-WELCOME.md](screens/35-ONB-WELCOME.md) |

### privacy

| #   | Écran                        | Boutons | Cas | Fichier                                        |
| --- | ---------------------------- | ------: | --: | ---------------------------------------------- |
| 36  | Export des données           |       4 |  10 | [36-PRIV-EXPORT.md](screens/36-PRIV-EXPORT.md) |
| 37  | Suppression de compte        |       4 |   8 | [37-PRIV-DELETE.md](screens/37-PRIV-DELETE.md) |
| 38  | Politique de confidentialité |       3 |  11 | [38-PRIV-POLICY.md](screens/38-PRIV-POLICY.md) |
| 39  | Conditions d'utilisation     |       2 |   6 | [39-PRIV-TERMS.md](screens/39-PRIV-TERMS.md)   |

### profile

| #   | Écran                 | Boutons | Cas | Fichier                                              |
| --- | --------------------- | ------: | --: | ---------------------------------------------------- |
| 40  | Édition du profil     |       9 |  26 | [40-PROF-EDIT.md](screens/40-PROF-EDIT.md)           |
| 41  | Abonnés / Abonnements |       4 |  13 | [41-PROF-FOLLOWERS.md](screens/41-PROF-FOLLOWERS.md) |
| 42  | Profil                |      15 |  40 | [42-PROF-VIEW.md](screens/42-PROF-VIEW.md)           |

### rooms (cœur temps-réel audio)

| #   | Écran                    | Boutons | Cas | Fichier                                        |
| --- | ------------------------ | ------: | --: | ---------------------------------------------- |
| 43  | Créer une room           |      21 |  29 | [43-ROOM-CREATE.md](screens/43-ROOM-CREATE.md) |
| 44  | Inviter dans la room     |       4 |  16 | [44-ROOM-INVITE.md](screens/44-ROOM-INVITE.md) |
| 45  | Replays                  |       2 |  10 | [45-ROOM-REPLAY.md](screens/45-ROOM-REPLAY.md) |
| 46  | Fil des rooms (hallway)  |      15 |  32 | [46-ROOM-FEED.md](screens/46-ROOM-FEED.md)     |
| 47  | **Room audio en direct** |      15 |  51 | [47-ROOM-LIVE.md](screens/47-ROOM-LIVE.md)     |

### search

| #   | Écran                | Boutons | Cas | Fichier                              |
| --- | -------------------- | ------: | --: | ------------------------------------ |
| 48  | Explorer / Recherche |       6 |  20 | [48-SEARCH.md](screens/48-SEARCH.md) |

### settings

| #   | Écran                  | Boutons | Cas | Fichier                                    |
| --- | ---------------------- | ------: | --: | ------------------------------------------ |
| 49  | Réglages notifications |      11 |  14 | [49-SET-NOTIF.md](screens/49-SET-NOTIF.md) |
| 50  | Réglages               |      20 |  57 | [50-SET-MAIN.md](screens/50-SET-MAIN.md)   |

---

## Démarrage rapide

**QA manuel** : commencer par [02-priorisation.md](02-priorisation.md) → exécuter d'abord la suite **smoke P0** (≈ 15 cas, < 30 min) listée dans [07-regression.md](07-regression.md), puis dérouler les fichiers `screens/` par feature. Préparer les comptes/données via [00-plan-overview.md](00-plan-overview.md) §dépendances.

**QA temps-réel** : ouvrir [03-scenarios-temps-reel.md](03-scenarios-temps-reel.md) avec **≥ 2 appareils/comptes** + [04-plan-reseau.md](04-plan-reseau.md) pour les coupures/reconnexions ; observer les traces de [10-instrumentation.md](10-instrumentation.md).

**Automatisation** : implémenter en priorité les 14 scripts de [06-automatisation.md](06-automatisation.md) (E2E Detox/Maestro + unitaires RTL), cibler les **P0** d'abord.

**Remontée de bug** : utiliser le template de [09-modele-anomalie.md](09-modele-anomalie.md), joindre les traces recommandées par [10-instrumentation.md](10-instrumentation.md), référencer l'ID de cas (`<PREFIXE>-NNN`).
