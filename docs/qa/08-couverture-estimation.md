# 08 - Matrice de couverture & estimation de temps

Document de pilotage QA pour **ChatHouse** (app audio live facon Clubhouse — React Native / Expo, temps reel WebSocket + audio LiveKit, push, i18n FR/EN, roles guest/standard/admin, Android + iOS, reseaux variables 3G/4G/5G/Wi-Fi).

**Perimetre du parc** : **50 ecrans** · **381 boutons / controles interactifs** · **991 cas de test deja rediges** (un fichier par ecran sous `docs/qa/screens/`).

Repartition de priorite (cf. `02-priorisation.md`) : **P0 = 89 controles (23 %)** · **P1 = 220 (58 %)** · **P2 = 72 (19 %)**.

> Ce document repond a quatre questions : (1) **ou en est la couverture** par feature (manuel + automatise) ; (2) **quelle cible d'automatisation** retenir ; (3) **quel pourcentage de boutons** est couvert au global ; (4) **combien de temps** coute chaque campagne (manuelle complete, smoke P0, run automatise, matrice 4 devices), en fourchettes h / j realistes avec hypotheses explicites.

---

## 1. Hypotheses de calcul (a lire avant les tableaux)

Toutes les estimations decoulent des hypotheses ci-dessous. Si l'une change (duree par cas, ratio d'automatisation, nb de devices), les fourchettes se recalculent lineairement.

| #   | Hypothese                              | Valeur retenue                                                                                                                                                                                                     | Source / justification                                                                                                                                                                                                                                        |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **Minimum de cas par bouton**          | **>= 3 cas / bouton** (positif + erreur/limite + a11y, et un 4e temps-reel sur les boutons concernes)                                                                                                              | Les 4 axes du plan global (`00-plan-overview.md` §1.3). 3 x 381 = **1143 cas-cibles theoriques** ; les 991 cas ecrits couvrent **2,60 cas/bouton en moyenne** (sous la cible : voir §6 lacunes).                                                              |
| H2  | **Duree moyenne d'un cas manuel**      | **4 a 6 min/cas** (incl. mise en place du pre-requis, execution, observation, journalisation du verdict)                                                                                                           | Plage 2-6 min/cas annoncee dans les fiches ecran ; on prend 4 min en borne basse (cas simples REST/nav) et 6 min en borne haute (cas temps-reel, rollback, a11y).                                                                                             |
| H3  | **Cas multi-device / audio natif**     | comptes dans la borne haute (6 min) ; necessitent **2-3 devices + build EAS dev-client**                                                                                                                           | Rooms, messages, notifs, houses, admin temps-reel ; la voix LiveKit n'existe **pas** en Expo Go.                                                                                                                                                              |
| H4  | **Smoke P0**                           | **1 a 2 cas par controle P0** => **~120 a 150 cas** ; 5-7 min/cas (chemins critiques, setup plus lourd, multi-device)                                                                                              | `02-priorisation.md` §5.                                                                                                                                                                                                                                      |
| H5  | **Cible d'automatisation**             | **263 boutons / 381 = 69 %** couverts par tests automatises (unitaire/composant + integration front Jest)                                                                                                          | Modele §3 : les boutons **purement natifs** (voix LiveKit reelle, share sheet OS, permission OS, geoloc reelle, multi-device WebSocket bout-en-bout) restent **manuels**.                                                                                     |
| H6  | **Priorite d'automatisation**          | **P0 d'abord**, puis P1 frequents ; P2 = couverture opportuniste (souvent contenu statique / a11y manuelle)                                                                                                        | Les 89 P0 sont la cible #1 de l'automatisation de regression (CI a chaque PR).                                                                                                                                                                                |
| H7  | **Journee de travail QA**              | **7 h utiles/jour** (1 testeur)                                                                                                                                                                                    | Net des reunions/pauses ; conversions h -> j faites a 7 h.                                                                                                                                                                                                    |
| H8  | **Matrice devices**                    | **4 devices** : Android low-end, Android high-end, iOS ancien, iOS recent (bornes OS Android 10/15, iOS 15/18)                                                                                                     | `00-plan-overview.md` §6.2. Le rejeu sur N devices **n'est pas lineaire** (x N) : le 1er device coute plein tarif, les rejeux sont plus rapides mais les anomalies specifiques device ajoutent du temps -> **facteur 2,6 a 3,2x** pour 4 devices (et non 4x). |
| H9  | **Contrainte d'execution Jest locale** | suites lancees **feature par feature en `--runInBand`** (PC ~1 Go libre, OOM en parallele)                                                                                                                         | `MEMORY.md` + `00-plan-overview.md` §3.1 ; reference 54 suites / 314 tests verts.                                                                                                                                                                             |
| H10 | **Equipe**                             | estimations donnees **pour 1 testeur** ; diviser par le nombre de testeurs paralleles (les campagnes manuelles se parallelisent bien par feature, sauf le multi-device qui mobilise plusieurs devices par testeur) | —                                                                                                                                                                                                                                                             |

---

## 2. Matrice de couverture par feature

Agregation des 50 fiches ecran par feature (14 features = `src/features/*`).

- **Nb boutons** : controles interactifs reels.
- **Cas manuels** : cas de test deja rediges pour la feature.
- **Cas / bouton** : densite actuelle (cible H1 = 3,00).
- **Cibles auto** : nb de boutons vises par l'automatisation (modele §3, H5).
- **% couvert manuel** : part des boutons ayant **au moins 1 cas manuel redige** = **100 %** par construction (chaque bouton du parc a sa fiche) ; la colonne reporte plutot la **densite vs cible** (cas/bouton normalise sur 3, plafonne a 100 %).
- **% couvert auto** : `cibles auto / nb boutons`.

| Feature         | Ecrans | Nb boutons | Cas manuels | Cas/bouton | % couv. manuel (densite/3) | Cibles auto | % couv. auto |
| --------------- | :----: | :--------: | :---------: | :--------: | :------------------------: | :---------: | :----------: |
| `admin`         |   6    |     45     |     113     |    2,51    |            84 %            |     36      |     80 %     |
| `auth`          |   6    |     25     |     83      |    3,32    |           100 %            |     21      |     84 %     |
| `events`        |   1    |     5      |     14      |    2,80    |            93 %            |      4      |     80 %     |
| `extensions`    |   5    |     62     |     104     |    1,68    |            56 %            |     34      |     55 %     |
| `houses`        |   5    |     32     |     102     |    3,19    |           100 %            |     26      |     81 %     |
| `maps`          |   1    |     9      |     28      |    3,11    |           100 %            |      4      |     44 %     |
| `messages`      |   6    |     41     |     139     |    3,39    |           100 %            |     27      |     66 %     |
| `notifications` |   1    |     9      |     24      |    2,67    |            89 %            |      6      |     67 %     |
| `onboarding`    |   4    |     18     |     42      |    2,33    |            78 %            |     15      |     83 %     |
| `privacy`       |   4    |     13     |     34      |    2,62    |            87 %            |     10      |     77 %     |
| `profile`       |   3    |     28     |     79      |    2,82    |            94 %            |     24      |     86 %     |
| `rooms`         |   5    |     57     |     138     |    2,42    |            81 %            |     26      |     46 %     |
| `search`        |   1    |     6      |     20      |    3,33    |           100 %            |      5      |     83 %     |
| `settings`      |   2    |     31     |     71      |    2,29    |            76 %            |     25      |     81 %     |
| **TOTAL**       | **50** |  **381**   |   **991**   |  **2,60**  |  **87 %** (densite moy.)   |   **263**   |   **69 %**   |

> Lecture rapide :
>
> - **`extensions`** est la feature la **moins dense** (1,68 cas/bouton) : le Playground porte 34 boutons pour 37 cas — beaucoup de variantes de reactions/partage P2 a 1 cas. C'est la **priorite #1 de complement** pour atteindre 3 cas/bouton.
> - **`rooms`** et **`maps`** ont la **plus faible automatisation cible** (46 % / 44 %) car ce sont les surfaces les plus **natives & multi-device** (audio LiveKit, geoloc, WebSocket bout-en-bout) — leur couverture reste majoritairement **manuelle sur build EAS**.
> - **`auth`, `houses`, `messages`, `search`, `maps`** atteignent deja **>= 3 cas/bouton**.

---

## 3. Cible d'automatisation — modele & detail

### 3.1 Principe (H5 + H6)

On distingue ce qui est **automatisable** (logique de bouton, etats, branches de role, validation, rollback optimiste, navigation, invalidation de cache — verifiable au niveau **composant/integration** avec Jest + `@testing-library/react-native` + React Query/sockets mockes) de ce qui reste **manuel obligatoire** :

- **Voix LiveKit reelle** (mute audible, hot-unmute apres reconnexion) — module natif, build EAS.
- **Multi-device temps-reel bout-en-bout** (echo propre, `room:ended`/`role_changed`/`kicked` recus sur un 2e device).
- **Permissions OS** (micro, notifications, localisation, camera/galerie) — accord/refus/revocation a chaud.
- **Share sheet natif, deep-link depuis push, reseau bride/coupe en plein appel**.
- **Accessibilite reelle** (lecteur d'ecran TalkBack/VoiceOver, police XXL, contraste).

### 3.2 Cibles par feature

Le **taux d'automatisation** par feature reflete sa densite native/temps-reel : eleve pour les features REST + formulaires (auth, profile, settings, search), faible pour les surfaces natives (maps, rooms).

| Feature         | Boutons | Taux auto vise | Cibles auto | Reste manuel (natif/multi-device/a11y) |
| --------------- | :-----: | :------------: | :---------: | :------------------------------------: |
| `admin`         |   45    |      80 %      |     36      |                   9                    |
| `auth`          |   25    |      84 %      |     21      |                   4                    |
| `events`        |    5    |      80 %      |      4      |                   1                    |
| `extensions`    |   62    |      55 %      |     34      |                   28                   |
| `houses`        |   32    |      81 %      |     26      |                   6                    |
| `maps`          |    9    |      44 %      |      4      |                   5                    |
| `messages`      |   41    |      66 %      |     27      |                   14                   |
| `notifications` |    9    |      67 %      |      6      |                   3                    |
| `onboarding`    |   18    |      83 %      |     15      |                   3                    |
| `privacy`       |   13    |      77 %      |     10      |                   3                    |
| `profile`       |   28    |      86 %      |     24      |                   4                    |
| `rooms`         |   57    |      46 %      |     26      |                   31                   |
| `search`        |    6    |      83 %      |      5      |                   1                    |
| `settings`      |   31    |      81 %      |     25      |                   6                    |
| **TOTAL**       | **381** |    **69 %**    |   **263**   |                **118**                 |

### 3.3 Ordre d'implementation de l'automatisation (P0 d'abord — H6)

1. **Vague A — P0 automatisables** (~70 des 89 P0, hors voix/multi-device pur) : auth OTP/username, validations Room-Create/House-Create, gardes de submit, gating de role admin, rollback toggles privacy/notif, deep-link routing. **Cible : suite de regression CI verte a chaque PR.**
2. **Vague B — P1 frequents** : navigation, filtres/onglets, follow optimiste, invalidations de cache, etats vides/erreur.
3. **Vague C — P2 opportunistes** : variantes d'emoji, presets de planification, libelles FR/EN (les liens legaux statiques restent souvent en verif manuelle ponctuelle).

---

## 4. Pourcentage global de boutons couverts

| Mode                                                                 |      Boutons couverts       |                       % du parc (381)                        |
| -------------------------------------------------------------------- | :-------------------------: | :----------------------------------------------------------: |
| **Manuel** (au moins 1 cas redige par bouton)                        |        **381 / 381**        |                          **100 %**                           |
| **Manuel a la cible H1 (>= 3 cas/bouton)**                           | densite moyenne 2,60 / 3,00 | **~87 %** de la cible atteinte (lacune surtout `extensions`) |
| **Automatise** (cibles §3)                                           |        **263 / 381**        |                           **69 %**                           |
| dont **P0 automatisables** (cible CI prioritaire)                    |          ~70 / 89           |                       **~79 % des P0**                       |
| **Manuel obligatoire** (non automatisable : natif/multi-device/a11y) |        **118 / 381**        |                           **31 %**                           |

> **Synthese :** 100 % des boutons ont une couverture manuelle redigee, mais seulement **~87 %** atteignent la profondeur cible de 3 cas/bouton ; **69 %** des boutons sont visables par l'automatisation, le **31 %** restant (rooms/maps natif, multi-device, accessibilite) demeurant **manuel par nature**.

---

## 5. Estimation de temps d'execution

> Toutes les durees sont **pour 1 testeur sur 1 device** sauf mention contraire. Conversion h -> j a **7 h/jour** (H7). Fourchettes basse/haute = duree par cas 4 min / 6 min (H2).

### 5.1 Campagne manuelle complete (991 cas, 1 device)

| Borne   | Duree/cas |   Total   | En heures | En jours (7 h) |
| ------- | :-------: | :-------: | :-------: | :------------: |
| Basse   |   4 min   | 3 964 min | **~66 h** |   **~9,5 j**   |
| Mediane |   5 min   | 4 955 min | **~83 h** |   **~12 j**    |
| Haute   |   6 min   | 5 946 min | **~99 h** |   **~14 j**    |

> **Fourchette retenue : 9,5 a 14 j-testeur** (1 device). A ~2-3 testeurs en parallele par feature : **~4 a 7 j calendaires**. Le multi-device temps-reel (R1) et l'audio natif (R3) tirent vers la borne haute.

### 5.2 Campagne smoke P0 (chemins critiques uniquement)

Base : ~120 a 150 cas (1-2 cas par controle P0, H4), 5-7 min/cas.

| Borne                                                                       | Cas | Duree/cas |    Total     | Commentaire                    |
| --------------------------------------------------------------------------- | :-: | :-------: | :----------: | ------------------------------ |
| Basse                                                                       | 120 |   5 min   |  **~10 h**   | P0 happy-path + 1 robustesse   |
| Haute                                                                       | 150 |   7 min   | **~17,5 h**  | inclut multi-device room/admin |
| + Vague 0 (pre-requis env : build EAS, .env/IP LAN, backend, seed, comptes) |  —  |     —     | **+2 a 4 h** | gate technique obligatoire     |

> **Fourchette retenue : ~1,5 a 3 j-testeur** (env compris). Une smoke "minimale" sur 1 device sans multi-device tient en **~1 j**. Joue dans l'ordre des 7 vagues de `02-priorisation.md` (auth -> rooms -> messages -> houses -> social -> admin -> RGPD).

### 5.3 Run automatise sur le parc de 50 ecrans

| Suite                                                             | Contenu                                                          |                    Duree (1 run)                    | Frequence                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- | :-------------------------------------------------: | ------------------------- |
| **Unitaire/composant + integration (Jest)** — local               | 14 features en `--runInBand` (H9), ~320+ tests, 50 ecrans rendus |      **~20 a 40 min** sequentiel sur PC de dev      | a la demande / avant push |
| **Jest sur runner CI propre** (parallele, RAM suffisante)         | meme suite                                                       |                   **~6 a 12 min**                   | a chaque PR / commit      |
| **E2E device (Maestro/Detox)** — happy-paths P0+P1 automatisables | build + scenarios                                                | **build 20-45 min (1x)** + **run 25-45 min/device** | avant livraison           |

> **Run automatise "complet" (Jest CI + 1 passe E2E sur 1 device) : ~1 a 1,5 h** une fois le build pret. La force de l'automatisation : ce run rejoue les **263 cibles** a chaque PR pour un cout marginal quasi nul, **liberant le manuel** pour le natif/multi-device.

### 5.4 Matrice 4 devices (Android low/high, iOS ancien/recent)

Le rejeu sur 4 devices **n'est pas x4** : 1er device plein tarif, rejeux ~0,55x, + anomalies specifiques device. **Facteur global 2,6 a 3,2x** d'un run 1-device (H8).

**(a) Sous-ensemble realiste — P0 + P1 sur la matrice (804 cas, cf. `00-plan-overview.md` §6.2 : P0+P1 sur matrice minimale)**

| Etape         | Base              | Calcul |                   Total                   |
| ------------- | ----------------- | ------ | :---------------------------------------: |
| 1 device      | 804 cas x 4-6 min | —      |              **~54 a 80 h**               |
| **4 devices** | x 2,6 a 3,2       | —      | **~140 a 257 h** = **~20 a 37 j-testeur** |

**(b) Campagne manuelle COMPLETE (991 cas) sur les 4 devices**

| Etape         | Base        |                   Total                   |
| ------------- | ----------- | :---------------------------------------: |
| 1 device      | ~66 a 99 h  |                     —                     |
| **4 devices** | x 2,6 a 3,2 | **~172 a 317 h** = **~25 a 45 j-testeur** |

**(c) Smoke P0 sur les 4 devices**

| Etape         | Base         |                 Total                 |
| ------------- | ------------ | :-----------------------------------: |
| 1 device      | ~10 a 17,5 h |                   —                   |
| **4 devices** | x 2,6 a 3,2  | **~26 a 56 h** = **~4 a 8 j-testeur** |

> **Recommandation de calibrage release** (cf. criteres de sortie §8.2 du plan) : **100 % P0 + P1 sur la matrice 4 devices** (option a, ~20-37 j-testeur, soit **~1 a 2 semaines calendaires** a 3-4 testeurs), **P2 sur >= 1 device de reference par OS** (compris dans la borne haute de (a)), et l'**automatisation absorbe les 263 cibles de regression** a chaque PR pour eviter de rejouer manuellement le fonctionnel repetitif.

---

## 6. Synthese & lacunes a combler

| Indicateur                                      |                                            Valeur                                             |
| ----------------------------------------------- | :-------------------------------------------------------------------------------------------: |
| Boutons couverts (manuel, >= 1 cas)             |                                      **100 %** (381/381)                                      |
| Profondeur vs cible 3 cas/bouton                |                              **~87 %** (2,60 / 3,00 cas/bouton)                               |
| Boutons couverts (automatisation cible)         |                                      **69 %** (263/381)                                       |
| Cas a ajouter pour atteindre 3/bouton           | **1143 - 991 = ~152 cas** (priorite `extensions`, `settings`, `onboarding`, `rooms`, `admin`) |
| Smoke P0 (1 device, env compris)                |                                        **~1,5 a 3 j**                                         |
| Manuel complet (1 device)                       |                                        **~9,5 a 14 j**                                        |
| Manuel P0+P1 sur 4 devices                      |                                        **~20 a 37 j**                                         |
| Manuel complet sur 4 devices                    |                                        **~25 a 45 j**                                         |
| Run automatise complet (Jest CI + 1 E2E device) |                                        **~1 a 1,5 h**                                         |

**Lacunes prioritaires (sous la cible de 3 cas/bouton) :** `extensions` (1,68 — 34 boutons Playground sous-couverts), `settings` (2,29), `onboarding` (2,33), `rooms` (2,42), `admin` (2,51). Completer d'abord les axes **erreur/limite** et **a11y** manquants sur ces boutons.

---

### Annexe — references

- Priorisation P0/P1/P2 & ordre smoke : `docs/qa/02-priorisation.md`
- Matrice ecran x bouton detaillee : `docs/qa/01-matrice-ecran-bouton.md`
- Plan global (axes, matrice devices, criteres entree/sortie) : `docs/qa/00-plan-overview.md`
- Fiches detaillees par ecran : `docs/qa/screens/01-…` a `50-…`
- Harness automatise : `jest.config.js`, `jest-setup.ts`, `src/test-utils/renderScreen.tsx`, `__mocks__/`
