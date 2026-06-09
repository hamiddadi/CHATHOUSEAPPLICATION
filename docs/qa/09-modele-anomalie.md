# 09 - Modele de rapport d'anomalie (ChatHouse)

> **But** : standardiser la remontee de bugs sur **ChatHouse** (app audio live facon Clubhouse — React Native / Expo, temps-reel WebSocket socket.io + audio LiveKit, push, i18n FR/EN, roles guest/standard/admin, Android + iOS, reseaux 3G/4G/5G/Wi-Fi).
>
> Perimetre du parc : **50 ecrans · 381 boutons · 991 cas de test**. Chaque anomalie doit pointer vers l'**ecran**, le **bouton** (avec son **locator reel**) et le **cas de test** d'origine (`docs/qa/screens/NN-*.md` ou un scenario `RT-NNN` / `A11Y-NNN`).
>
> **Regle d'or** : une anomalie = un seul probleme. Si plusieurs symptomes, ouvrir plusieurs tickets et les lier (`bloque par` / `duplique`).

---

## 0. Comment utiliser ce document

1. **Section 1** : le template a copier-coller pour chaque bug (un bloc complet).
2. **Section 2** : le bareme de severite (Bloquant / Majeur / Mineur / Cosmetique) + matrice severite x priorite.
3. **Section 3** : le workflow de cycle de vie (etats + transitions autorisees).
4. **Section 4** : deux exemples remplis (un bug temps-reel, un bug UI/accessibilite) servant de reference.

**Conventions reprises du parc** :

- Locator = ce que le testeur trouve dans le code / l'inspecteur : en general `accessibilityLabel` = `t('cle')` (ex. `room.muteA11y`), parfois `testID`, sinon le texte visible.
- Priorite **P0 / P1 / P2** (voir `docs/qa/02-priorisation.md`).
- Statuts audio LiveKit : `idle` / `connecting` / `live` / `reconnecting` / `error` / `unsupported` (Expo Go = `unsupported`).
- Events socket.io a citer dans les logs : `room:role_changed`, `room:mute-changed`, `room:user_kicked`, `room:ended`, `room:reaction`, `chat:message`, `chat:typing`, `group:message`, `notification:new`, `maps:user-moved`, etc.

---

## 1. Template a copier-coller

> Copier le bloc ci-dessous tel quel pour chaque nouvelle anomalie. Supprimer les commentaires `<!-- ... -->` apres remplissage. Laisser `N/A` quand un champ ne s'applique pas, mais ne jamais laisser un champ vide.

```markdown
# BUG-XXX — <Titre court, factuel, oriente symptome>

<!-- Titre = [Ecran] symptome observable. Ex: [Room live] L'audio reste muet apres reconnexion 3G -->

## Identification

| Champ                 | Valeur                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- |
| **ID**                | BUG-XXX <!-- numerotation continue, jamais reutilisee -->                           |
| **Titre**             | <symptome observable, pas de cause supposee>                                        |
| **Severite**          | Bloquant / Majeur / Mineur / Cosmetique <!-- voir section 2 -->                     |
| **Priorite**          | P0 / P1 / P2 <!-- urgence de traitement, voir 02-priorisation.md -->                |
| **Statut**            | Nouveau <!-- voir workflow section 3 -->                                            |
| **Rapporteur**        | <nom / equipe QA>                                                                   |
| **Assigne a**         | <dev / equipe ou "non assigne">                                                     |
| **Date de detection** | AAAA-MM-JJ                                                                          |
| **Type**              | Temps-reel / Fonctionnel / UI / Accessibilite / Performance / Securite-RGPD / Crash |

## Environnement

| Champ                    | Valeur                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Plateforme + OS**      | Android <version> / iOS <version> <!-- ex: Android 14 (API 34) -->                             |
| **Device**               | <modele exact> <!-- ex: Pixel 6, iPhone SE 2020, Galaxy A14 (low-end) -->                      |
| **Type de build**        | Expo Go / EAS dev-client / EAS preview / production <!-- audio LiveKit = dev-client requis --> |
| **Version app / commit** | vX.Y.Z (`<sha7>`) <!-- ex: 1.4.0 (300a11b) -->                                                 |
| **Backend / API**        | <URL ou IP:port> + version/branche <!-- ex: 192.168.1.20:4000 / main -->                       |
| **Reseau**               | Wi-Fi / 4G / 5G / 3G throttle / mode avion / coupure controlee                                 |
| **Role / compte**        | guest / standard / admin — <compte de test> <!-- ex: standard, qa-a@chathouse.test -->         |
| **Langue**               | FR / EN                                                                                        |

## Localisation

| Champ                         | Valeur                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| **Ecran**                     | <Nom + fichier doc> <!-- ex: Room live — docs/qa/screens/47-ROOM-LIVE.md --> |
| **Route / deep-link**         | <route navigation ou deep-link> <!-- ex: Room (roomId), room/:roomId -->     |
| **Bouton / controle**         | <libelle>                                                                    |
| **Locator reel**              | <`accessibilityLabel` = `t('...')` ou `testID` ou texte visible>             |
| **Fichier source (si connu)** | <chemin src/...>                                                             |

## Pre-conditions

## <!-- Etat de depart minimal et reproductible : compte, role, donnees, room/conversation existante, permissions OS (micro/push), reseau. -->

-

## Etapes de reproduction (minimales)

<!-- Le strict minimum pour reproduire. Numerote. Prefixer par l'acteur si multi-device: [A]/[B]/[A1]. Supprimer toute etape non necessaire au bug. -->

1.
2.
3.

## Resultat obtenu vs attendu

- **Obtenu** : <ce qui se passe reellement, observable, mesurable>
- **Attendu** : <comportement specifie ; citer le critere OK/KO du cas de test source>

## Frequence

<!-- Toujours (X/X) / Intermittent (n/X essais) / Une seule fois (non reproduit). Preciser le ratio. -->

- <ex: Intermittent — 3/5 essais, uniquement sur bascule Wi-Fi -> 4G>

## Pieces jointes

<!-- Capture annotee, video courte (< 30 s) pour les bugs temps-reel/animation, dump de logs. Donner chemins/liens. -->

- Capture : <fichier/lien>
- Video : <fichier/lien>
- Logs bruts : <fichier/lien>

## Logs pertinents (extrait)

<!-- Extrait CIBLE et horodate. Masquer tout secret (token, inviteToken, OTP, PII). Privilegier les lignes WebSocket / LiveKit / console qui datent l'incident. -->
```

[HH:MM:SS] <event socket.io / statut LiveKit / erreur console / requete REST + code HTTP>

```

## Impact
<!-- Qui est touche, combien, sur quel parcours, perte de donnees/revenu/conformite. Lier au critere de severite. -->
-

## Contournement
<!-- Workaround connu cote utilisateur ou QA, ou "Aucun connu". -->
-

## Tracabilite
| Champ | Valeur |
|-------|--------|
| **Cas de test source** | <ID> <!-- ex: ROOM-LIVE-026, RT-022, A11Y-014 --> |
| **Tickets lies** | <duplique de / bloque par / lie a BUG-YYY> |
| **Regression depuis** | <version/commit ou "inconnu"> |
```

---

## 2. Bareme de severite

La **severite** mesure l'impact technique/metier du defaut (objectif, decide par QA). La **priorite** (P0/P1/P2) mesure l'urgence de traitement (negociee QA + produit). Les deux sont **independantes** : un bug Cosmetique peut etre P0 (ex. faute sur un ecran legal RGPD), un bug Majeur peut etre P2 (ecran rarement atteint).

### 2.1 Niveaux

| Severite       | Definition                                                                                                                               | Exemples ChatHouse                                                                                                                                                                                        | Decision release                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Bloquant**   | Empeche l'usage d'une fonction coeur, **aucun contournement** ; ou crash, perte de donnees, faille securite/RGPD, escalade de privilege. | Impossible de rejoindre une room ; OTP jamais verifie ; audio LiveKit jamais `live` sur dev-client ; crash au boot (AnyTypeCache) ; export PII d'un autre compte ; force-end ne ferme pas le canal.       | **Release bloquee.** Hotfix immediat.                           |
| **Majeur**     | Fonction importante KO ou fortement degradee, mais **contournement penible** existe, ou impacte un parcours non critique.                | Mute non propage aux autres participants ; file des mains levees ne se met pas a jour sans pull-to-refresh ; reconnexion socket lente (> 10 s) ; badge non-lus faux ; push room_invite non recu app tuee. | A corriger avant release majeure ; tolerable avec ticket si P1. |
| **Mineur**     | Defaut local, gene limitee, contournement evident ou impact UX faible.                                                                   | Toast d'erreur mal formule ; compteur "+N auditeurs" off-by-one ; debounce recherche trop court ; haptique manquant sur une action secondaire.                                                            | Non bloquant ; backlog.                                         |
| **Cosmetique** | Aucun impact fonctionnel : visuel, libelle, alignement, i18n non load-bearing.                                                           | Troncature de titre ; espacement ; emoji de reaction mal centre ; faute d'orthographe FR/EN (hors ecran legal).                                                                                           | Opportuniste / polish.                                          |

> **Surclassement automatique** : tout defaut touchant **securite, RGPD, conformite age legal, ou irreversibilite** (suppression compte, force-end, suspension) est au minimum **Majeur**, meme si cosmetique en apparence (ex. lien "Supprimer mon compte" mal libelle).

### 2.2 Matrice severite x priorite (aide a la decision)

|                | **P0** (chemin critique)                 | **P1** (important)             | **P2** (secondaire)    |
| -------------- | ---------------------------------------- | ------------------------------ | ---------------------- |
| **Bloquant**   | Hotfix immediat, release bloquee         | Corriger avant release majeure | A planifier rapidement |
| **Majeur**     | Hotfix immediat, release bloquee         | Corriger avant release majeure | Backlog priorise       |
| **Mineur**     | Corriger avant release                   | Backlog priorise               | Backlog                |
| **Cosmetique** | Corriger avant release (ex. ecran legal) | Backlog                        | Opportuniste           |

---

## 3. Workflow de cycle de vie du bug

### 3.1 Etats

| Statut       | Qui le pose       | Signification                                                                             |
| ------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| **Nouveau**  | Rapporteur (QA)   | Ticket cree, pas encore triage.                                                           |
| **Confirme** | Lead QA / triage  | Reproduit + bien renseigne (env, etapes, severite/priorite validees).                     |
| **En cours** | Dev assigne       | Correction en developpement.                                                              |
| **Resolu**   | Dev               | Fix livre sur une branche/build, en attente de verification QA. Indiquer le commit/build. |
| **Verifie**  | QA                | Fix rejoue OK sur le build cible (rejouer le cas de test source + non-regression).        |
| **Ferme**    | Lead QA           | Cloture definitive (apres Verifie, ou doublon/invalide tranche).                          |
| **Rejete**   | Lead QA / produit | Non reproductible, "by design", doublon, ou hors perimetre.                               |
| **Differe**  | Produit           | Reel mais reporte (backlog) avec justification + jalon de revue.                          |

### 3.2 Transitions autorisees

```
                 ┌─────────────────────────────────────────────┐
                 ▼                                             │
  [Nouveau] ──► [Confirme] ──► [En cours] ──► [Resolu] ──► [Verifie] ──► [Ferme]
     │             │              │              │
     │             │              │              └──(echec re-test)──► [En cours]
     │             │              │
     │             ├──────────────┴──► [Differe] ──(reprise au jalon)──► [En cours]
     │             │
     ├─────────────┴──► [Rejete] ──► [Ferme]
     │
     └──(non reproductible / infos manquantes)──► [Rejete]
```

### 3.3 Regles de transition

- **Nouveau -> Confirme** : exige env + etapes minimales reproduites + cas de test source lie. Sinon -> **Rejete** (motif : infos manquantes / non reproductible) en demandant complement.
- **Resolu -> Verifie** : QA **rejoue le cas de test source** sur le build qui contient le fix (commit indique) ET un test de non-regression rapide autour (P0 voisins).
- **Verifie -> En cours** (reouverture) : si le fix ne tient pas ou casse autre chose ; documenter le nouveau symptome.
- **-> Differe** : autorise depuis Confirme ou En cours ; exige une **justification produit** + un **jalon de revue** (sinon le ticket dort). Interdit pour Bloquant/Majeur P0.
- **-> Rejete** : motif obligatoire (non reproductible / by design / doublon de BUG-YYY / hors perimetre).
- **-> Ferme** : seulement depuis Verifie, Rejete ou Differe arrive a echeance. Ne jamais fermer un bug juste "Resolu" sans verification QA.

---

## 4. Exemples remplis

### 4.1 Exemple A — Bug temps-reel (audio / WebSocket)

# BUG-101 — [Room live] L'audio reste muet pour B apres une bascule Wi-Fi -> 4G du host A

## Identification

| Champ                 | Valeur                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                | BUG-101                                                                                                                                                      |
| **Titre**             | Apres reconnexion reseau du host, sa piste audio LiveKit n'est pas republiee : les auditeurs ne l'entendent plus alors que l'UI le montre "live" et non-mute |
| **Severite**          | Bloquant                                                                                                                                                     |
| **Priorite**          | P0                                                                                                                                                           |
| **Statut**            | Confirme                                                                                                                                                     |
| **Rapporteur**        | QA — equipe temps-reel                                                                                                                                       |
| **Assigne a**         | non assigne                                                                                                                                                  |
| **Date de detection** | 2026-06-08                                                                                                                                                   |
| **Type**              | Temps-reel                                                                                                                                                   |

## Environnement

| Champ                    | Valeur                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| **Plateforme + OS**      | Android 14 (API 34) cote A (host) ; iOS 17.5 cote B (auditeur)                   |
| **Device**               | A : Pixel 6 ; B : iPhone 13                                                      |
| **Type de build**        | EAS dev-client (audio LiveKit requis)                                            |
| **Version app / commit** | 1.4.0 (`300a11b`)                                                                |
| **Backend / API**        | 192.168.1.20:4000 / branche main, Postgres + Redis up                            |
| **Reseau**               | A : bascule controlee Wi-Fi -> 4G ; B : Wi-Fi stable                             |
| **Role / compte**        | A = host (`qa-a@chathouse.test`) ; B = auditeur standard (`qa-b@chathouse.test`) |
| **Langue**               | FR                                                                               |

## Localisation

| Champ                         | Valeur                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Ecran**                     | Room live — `docs/qa/screens/47-ROOM-LIVE.md`                                                               |
| **Route / deep-link**         | `Room` (roomId), deep-link `room/:roomId`                                                                   |
| **Bouton / controle**         | Micro (Mute / Unmute) — barre d'action ; declencheur indirect = reconnexion reseau                          |
| **Locator reel**              | `accessibilityLabel` = `t('room.unmuteA11y','Unmute microphone')` ; `accessibilityState.selected = isMuted` |
| **Fichier source (si connu)** | `src/features/rooms/hooks/useRoomAudio` (republication piste apres `reconnecting`)                          |

## Pre-conditions

- Room live existante, A = host avec micro autorise et audio `live`, B = auditeur dans la meme room avec audio `live`.
- 2 appareils dev-client, micros autorises des deux cotes.
- A parle (B l'entend) avant la manipulation reseau.

## Etapes de reproduction (minimales)

1. **[A]** Etre host, micro actif (non-mute), parler — **[B]** confirme entendre A.
2. **[A]** Couper le Wi-Fi pour forcer la bascule sur 4G (la banniere audio passe `reconnecting` puis revient `live`).
3. **[A]** Continuer a parler sans toucher au bouton micro.

## Resultat obtenu vs attendu

- **Obtenu** : cote B, plus aucun son de A apres la reconnexion. L'UI de A affiche statut `live` et micro non-mute (`isMuted=false`), donc rien n'indique le probleme a A. La piste audio locale de A n'est pas republiee apres le passage `reconnecting -> live`.
- **Attendu** : apres reconnexion, la piste audio locale du host est republiee automatiquement ; B reentend A sans action. (Reference : critere OK/KO de **RT-022** — l'audio doit etre audible des le retour `live`.)

## Frequence

- Intermittent — **3/5** essais, uniquement sur bascule Wi-Fi -> 4G ; non reproduit sur simple throttle 3G sans changement d'interface reseau.

## Pieces jointes

- Video : `bugs/BUG-101/repro-wifi-to-4g.mp4` (split-screen A/B, 24 s)
- Logs bruts : `bugs/BUG-101/livekit-A.log`, `bugs/BUG-101/socket-A.log`

## Logs pertinents (extrait)

```
[14:22:03] LiveKit  status: live -> reconnecting   (network changed, transport=4g)
[14:22:07] LiveKit  status: reconnecting -> live    (room re-joined)
[14:22:07] LiveKit  localParticipant: audioTrack publication=NONE  <-- piste non republiee
[14:22:09] socket   emit setMute{muted:false} ACK 200            (REST OK mais piste absente)
[14:22:30] (cote B) LiveKit  remoteParticipant=A  audioTrack=absent, lastFrame=27s ago
```

## Impact

- Coeur de l'experience Clubhouse casse : un host qui change de reseau (cas frequent en mobilite) devient inaudible sans le savoir, toute la room le subit. Aucun contournement utilisateur cote auditeur.

## Contournement

- A doit toggler manuellement Mute puis Unmute (`room.muteA11y` -> `room.unmuteA11y`) pour forcer la republication de la piste. Non evident pour un utilisateur.

## Tracabilite

| Champ                  | Valeur                                                                     |
| ---------------------- | -------------------------------------------------------------------------- |
| **Cas de test source** | RT-022 (reconnexion reseau du host) ; voisins : RT-002, ROOM-LIVE-026      |
| **Tickets lies**       | lie a BUG-104 (banniere `reconnecting` qui disparait trop tot)             |
| **Regression depuis**  | inconnu (a bisecter autour de e720363 — source Room depuis livekit-client) |

---

### 4.2 Exemple B — Bug UI / accessibilite

# BUG-205 — [Room live] Le bouton Micro n'annonce pas son etat (mute/unmute) au lecteur d'ecran

## Identification

| Champ                 | Valeur                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                | BUG-205                                                                                                                              |
| **Titre**             | Le toggle Micro ne reflete pas `accessibilityState.selected` : TalkBack/VoiceOver lit le meme label que le micro soit coupe ou actif |
| **Severite**          | Majeur                                                                                                                               |
| **Priorite**          | P1                                                                                                                                   |
| **Statut**            | Nouveau                                                                                                                              |
| **Rapporteur**        | QA — accessibilite                                                                                                                   |
| **Assigne a**         | non assigne                                                                                                                          |
| **Date de detection** | 2026-06-09                                                                                                                           |
| **Type**              | Accessibilite                                                                                                                        |

## Environnement

| Champ                    | Valeur                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| **Plateforme + OS**      | Android 13 (TalkBack) ; reproduit aussi iOS 16.4 (VoiceOver)     |
| **Device**               | Samsung Galaxy A14 (TalkBack ON) ; iPhone SE 2020 (VoiceOver ON) |
| **Type de build**        | EAS dev-client                                                   |
| **Version app / commit** | 1.4.0 (`300a11b`)                                                |
| **Backend / API**        | 192.168.1.20:4000 / main                                         |
| **Reseau**               | Wi-Fi stable                                                     |
| **Role / compte**        | standard speaker (`qa-a@chathouse.test`)                         |
| **Langue**               | FR puis verifie EN                                               |

## Localisation

| Champ                         | Valeur                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Ecran**                     | Room live — `docs/qa/screens/47-ROOM-LIVE.md`                                                                          |
| **Route / deep-link**         | `Room` (roomId)                                                                                                        |
| **Bouton / controle**         | Micro (Mute / Unmute) — barre d'action (bas), bouton #11 de la matrice                                                 |
| **Locator reel**              | `accessibilityLabel` = `t('room.muteA11y')` / `t('room.unmuteA11y')` ; attendu `accessibilityState.selected = isMuted` |
| **Fichier source (si connu)** | `src/features/rooms/screens/RoomScreen/` (barre d'action, composant bouton micro)                                      |

## Pre-conditions

- Lecteur d'ecran actif (TalkBack sur Android / VoiceOver sur iOS).
- Compte speaker dans une room (bouton micro present car `viewerCanSpeak`).

## Etapes de reproduction (minimales)

1. Activer TalkBack, entrer dans la room en tant que speaker.
2. Swiper jusqu'au bouton Micro et ecouter l'annonce.
3. Double-taper pour couper le micro, re-focaliser le bouton et ecouter de nouveau.

## Resultat obtenu vs attendu

- **Obtenu** : le lecteur d'ecran annonce "Couper le micro, bouton" dans les deux etats ; `accessibilityState.selected` ne change pas, donc l'etat coupe/actif n'est pas vocalise. L'utilisateur non-voyant ignore si son micro est ouvert.
- **Attendu** : l'etat est annonce — label qui suit l'action ("Couper le micro" quand actif / "Activer le micro" quand coupe) **et** `accessibilityState.selected = isMuted` (annonce "selectionne"/"active"). (Reference : critere **A11Y-014**, etats WCAG 4.1.2, et matrice bouton ROOM-LIVE #11.)

## Frequence

- Toujours (5/5), Android et iOS.

## Pieces jointes

- Capture : `bugs/BUG-205/talkback-mic-focus.png` (overlay TalkBack sur le bouton)
- Video : `bugs/BUG-205/voiceover-mic.mp4` (10 s, annonce identique aux deux etats)

## Logs pertinents (extrait)

```
(inspecteur a11y — bouton Micro, micro ACTIF)
  role=button  label="Couper le micro"  state.selected=false
(apres double-tap -> micro COUPE)
  role=button  label="Couper le micro"  state.selected=false   <-- label & selected inchanges
```

## Impact

- Bloquant a l'usage pour les utilisateurs de lecteur d'ecran sur un controle P0 (micro = coeur de la room). Risque de parler/etre coupe sans le savoir. Touche tous les speakers non-voyants ; non-conformite WCAG 2.1 AA (4.1.2 Nom, role, valeur).

## Contournement

- Aucun cote lecteur d'ecran. Visuellement, l'icone change (non perceptible sans la vue).

## Tracabilite

| Champ                  | Valeur                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| **Cas de test source** | A11Y-014 (etats annonces) ; matrice bouton ROOM-LIVE #11 ; voir `docs/qa/05-accessibilite.md` 1.3 |
| **Tickets lies**       | lie a BUG-206 (meme defaut sur Lever/Baisser la main, bouton #12)                                 |
| **Regression depuis**  | inconnu                                                                                           |

---

> **Rappel de qualite d'un bon ticket** : titre = symptome (pas la cause), etapes **minimales** rejouables, obtenu **vs** attendu lie a un critere OK/KO existant, severite justifiee par l'impact, locator reel renseigne, logs cibles et **sans secret** (token / inviteToken / OTP / PII masques).
