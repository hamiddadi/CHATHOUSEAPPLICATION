# 36 - Export des donnees (`privacy`)

## Contexte ecran

- **Route** : `DataExport`, enregistree dans `SettingsNavigator` (pile `Settings`). Acces utilisateur : Reglages -> Confidentialite -> "Exporter mes donnees" (`SettingsScreen` -> `navigation.navigate('DataExport')`). `headerShown: false` au niveau de la pile : il n'y a PAS de bouton retour custom rendu par cet ecran ; le retour se fait par le geste natif iOS (swipe edge) ou le bouton hardware/back Android, gere par `@react-navigation/native-stack`.
- **Composant** : `src/features/privacy/screens/DataExportScreen.tsx`. Pas de partials (dossier `partials/` inexistant). Tous les boutons sont des `Button` partages (`src/shared/components/Button/Button.tsx`) avec `accessibilityRole="button"` et `label` = cle i18n.
- **Roles requis** : tout utilisateur authentifie (guest, standard, admin). Droit RGPD article 20 (portabilite) ouvert a tous, AUCUN gating admin (cf. commentaire navigateur : "GDPR — accessible to every authed user, even non-admins."). Un visiteur non connecte n'atteint pas l'ecran (pile Settings derriere l'auth).
- **Comportements temps-reel** : AUCUN. L'export est une requete REST `GET /users/me/export` (`privacyService.exportMyData`, axios `responseType: 'text'`, `transformResponse` passthrough). Pas de WebSocket, pas de LiveKit, pas de push. La remise de l'archive passe par la feuille de partage OS (`Share.share`) ou le presse-papier (`expo-clipboard`). Aucun evenement realtime emis ou recu.
- **Pre-conditions globales** : session valide (token), reseau atteignant l'API (`/users/me/export`). L'archive est conservee en memoire composant (`archiveRef`), jamais auto-persistee dans le presse-papier (copie = action opt-in explicite).
- **Etats de donnees pertinents** :
  - **Etat initial** : seul le bouton "Generer et partager mon export" est visible (carte de description + note RGPD). `lastBytes === null`, `copied === false`.
  - **Apres export reussi** (`lastBytes !== null`) : apparaissent le message de succes (`accessibilityLiveRegion="polite"`), un avertissement presse-papier, et le bouton "Copier dans le presse-papier".
  - **Apres copie** (`copied === true`) : apparait en plus le bouton "Effacer le presse-papier".
  - **Hors-ligne / erreur reseau** : l'export rejette -> `Alert` titre `errorExportTitle` + corps `errorExportBody`. La feuille de partage n'est PAS ouverte. Les controles de copie n'apparaissent pas (l'etat reste initial).
  - **Liste vide / non lus** : sans objet (pas de liste, pas de flux temps-reel). L'archive peut etre "vide" cote contenu (profil seul + `messages: []`) mais l'export reussit quand meme.

## Matrice bouton

| #   | Bouton                         | Emplacement                         | Type        | Locator reel                                                                                                                                                                                                                                                 | Pre-condition                                                                   | Priorite |
| --- | ------------------------------ | ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| 1   | Generer et partager mon export | Corps (CTA principal)               | submit      | `accessibilityRole="button"` + label `t('privacy.export.buttonExport')` = "Generer et partager mon export" (devient `t('privacy.export.buttonPrepare')` = "Preparation…" + spinner pendant `busy`). `accessibilityHint` = `t('privacy.export.description1')` | Session valide + reseau API                                                     | P0       |
| 2   | Copier dans le presse-papier   | Corps (apparait apres export OK)    | submit      | `accessibilityRole="button"` + label `t('privacy.export.buttonCopy')` = "Copier dans le presse-papier". `accessibilityHint` = `t('privacy.export.warning')`                                                                                                  | Un export reussi prealable (`archiveRef.current` non nul, `lastBytes !== null`) | P1       |
| 3   | Effacer le presse-papier       | Corps (apparait apres copie)        | destructive | `accessibilityRole="button"` + label `t('privacy.export.buttonClear')` = "Effacer le presse-papier"                                                                                                                                                          | Une copie prealable reussie (`copied === true`)                                 | P1       |
| 4   | Retour (natif)                 | Header natif / geste / back Android | navigation  | Pas de locator custom : geste edge iOS ou bouton hardware/back Android (`native-stack`, `headerShown:false`)                                                                                                                                                 | Etre arrive sur l'ecran via Settings                                            | P2       |

> Remarque : l'ecran ne contient aucun toggle, switch, FAB, lien legal, item de liste pressable, swipe, long-press, pull-to-refresh ni input texte. Les 3 boutons d'action ci-dessus sont les seuls elements actionnables rendus par le composant ; le retour est assure par la navigation native (inclus par exhaustivite).

## Cas de test

### PRIV-EXPORT-001 - Export RGPD reussi via la feuille de partage

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard connecte, Wi-Fi stable, API joignable, permission stockage non requise (partage OS).
- **Etapes** :
  1. Ouvrir Reglages -> Confidentialite -> "Exporter mes donnees".
  2. Verifier l'etat initial : titre "Exporter mes donnees", carte description1/description2/note, et UNIQUEMENT le bouton "Generer et partager mon export".
  3. Taper le bouton "Generer et partager mon export".
  4. Observer le passage en etat occupe : le label devient "Preparation…" et un spinner remplace le texte (bouton non re-actionnable).
  5. Attendre la reponse de `GET /users/me/export`.
- **Resultat attendu** : la feuille de partage OS s'ouvre avec `message` = archive JSON complete et `title` = "Exporter mes donnees". Apres fermeture, le message de succes "✓ Export genere ({{size}} Ko) — partagez-le via le menu de partage." s'affiche (taille = `(bytes/1024).toFixed(1)`), suivi de l'avertissement presse-papier et du bouton "Copier dans le presse-papier". Le bouton principal revient a "Generer et partager mon export".
- **Critere d'acceptation (OK/KO)** : OK si la Share sheet recoit l'archive integrale (non tronquee) ET le bloc succes + bouton "Copier dans le presse-papier" apparait. KO si l'archive est tronquee, copiee silencieusement dans le presse-papier, ou si le succes ne s'affiche pas.
- **Donnees de test** : compte `qa.standard@chathouse.test`. Archive renvoyee ex. `{"profile":{"id":"u1"},"messages":[]}` (39 octets -> "0.0 Ko") ou un payload realiste ~12 800 octets -> "12.5 Ko".
- **Duree estimee** : 3 min

### PRIV-EXPORT-002 - Export en echec reseau + multi-clic rapide (anti double-soumission)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard connecte, mode Avion active OU coupure reseau juste avant le tap (`/users/me/export` injoignable / timeout).
- **Etapes** :
  1. Ouvrir l'ecran "Exporter mes donnees".
  2. Activer le mode Avion (ou simuler latence puis coupure cote proxy).
  3. Taper "Generer et partager mon export" puis re-taper 4-5 fois tres vite pendant l'etat "Preparation…".
  4. Attendre l'echec de la requete.
  5. Variante latence/reconnexion : repasser en Wi-Fi, re-taper le bouton et verifier qu'un nouvel export reussit.
- **Resultat attendu** : pendant `busy`, `onPress` est neutralise (le `Button` met `onPress=undefined` quand `loading`) : un seul appel `exportMyData` est declenche, pas de Share multiple. A l'echec, une `Alert` titre "Erreur" + corps "Echec de l'export" (ou message d'erreur serveur) s'affiche ; la feuille de partage n'est PAS ouverte ; aucun bloc succes/copie n'apparait ; le bouton redevient actionnable. En reconnexion (etape 5), l'export aboutit normalement.
- **Critere d'acceptation (OK/KO)** : OK si exactement 1 requete par campagne de taps, alerte d'erreur affichee, Share non ouverte, et reprise OK apres retour reseau. KO si plusieurs requetes/partages, crash, ou bloc copie affiche malgre l'echec.
- **Donnees de test** : compte `qa.standard@chathouse.test`. Reponse simulee : timeout / `503` sur `GET /users/me/export`. Verifier compteur de requetes via proxy (Charles/mitmproxy) = 1.
- **Duree estimee** : 5 min

### PRIV-EXPORT-003 - Accessibilite du bouton d'export (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; police systeme reglee au maximum ; mode contraste eleve active.
- **Etapes** :
  1. Activer TalkBack/VoiceOver et la plus grande taille de police.
  2. Naviguer au focus vers le bouton "Generer et partager mon export".
  3. Ecouter l'annonce (role + label + hint).
  4. Double-taper pour activer ; ecouter l'etat occupe.
  5. Apres succes, verifier l'annonce automatique du message de succes (`accessibilityLiveRegion="polite"`).
  6. Verifier la lisibilite du label non tronque et le contraste du texte sur le fond sombre.
- **Resultat attendu** : le lecteur annonce "Generer et partager mon export, bouton" puis le hint (description RGPD article 20). En cours d'export l'etat `busy` est annonce (accessibilityState busy=true). Le texte de succes est annonce sans action utilisateur grace a la live region polite. Le label reste lisible en grande police (numberOfLines=1 -> verifier qu'il n'est pas illisiblement tronque ; signaler si coupe). Contraste texte/fond conforme WCAG AA.
- **Critere d'acceptation (OK/KO)** : OK si role+label+hint annonces, etat busy annonce, succes annonce automatiquement, et contraste/zoom acceptables. KO si bouton non focusable, label muet, hint absent, succes non annonce, ou texte illisible en grande police.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; taille police "Tres grand" ; contraste eleve ON.
- **Duree estimee** : 5 min

### PRIV-EXPORT-004 - Copie opt-in de l'archive dans le presse-papier

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard connecte ; un export prealable reussi (cf. PRIV-EXPORT-001) ; bouton "Copier dans le presse-papier" visible.
- **Etapes** :
  1. Apres un export reussi, lire l'avertissement "Le presse-papier est lisible par d'autres applications…".
  2. Taper "Copier dans le presse-papier".
  3. Coller le contenu dans une autre app (note) pour controle.
- **Resultat attendu** : `Clipboard.setStringAsync` est appele avec l'archive integrale (`archiveRef.current`). Le bouton "Effacer le presse-papier" apparait alors (`copied === true`). Le contenu colle ailleurs correspond exactement a l'archive JSON exportee.
- **Critere d'acceptation (OK/KO)** : OK si le presse-papier contient l'archive complete ET le bouton "Effacer le presse-papier" devient visible. KO si presse-papier vide/partiel, ou bouton "Effacer" absent.
- **Donnees de test** : archive `{"profile":{"id":"u1"},"messages":[]}` ; verification par collage.
- **Duree estimee** : 3 min

### PRIV-EXPORT-005 - Copie : multi-clic rapide + echec presse-papier (limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; export prealable reussi ; bouton "Copier" visible. Pour l'echec : refuser/bloquer l'acces au presse-papier (ou simuler rejet de `Clipboard.setStringAsync`).
- **Etapes** :
  1. Taper "Copier dans le presse-papier" 5 fois tres vite.
  2. Verifier le comportement (pas de doublons d'effet visible, idempotence de la copie).
  3. Variante echec : forcer `Clipboard.setStringAsync` a rejeter, retaper "Copier".
- **Resultat attendu** : multi-clic -> copies idempotentes (meme archive ecrasee), bouton "Effacer le presse-papier" affiche une seule fois, pas de crash. En cas de rejet de la copie -> `Alert` titre "Erreur" + corps "Echec de la copie" (`errorCopyBody`) ; `copied` reste false donc le bouton "Effacer" n'apparait pas. Note : si l'archive n'existe pas (`archiveRef.current` null) le handler sort silencieusement (no-op).
- **Critere d'acceptation (OK/KO)** : OK si copie idempotente, alerte "Echec de la copie" sur rejet, et aucun bouton "Effacer" affiche apres echec. KO si crash, copie partielle, ou bouton "Effacer" affiche malgre l'echec.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; mock rejet `Clipboard.setStringAsync` -> Error("clipboard denied").
- **Duree estimee** : 4 min

### PRIV-EXPORT-006 - Accessibilite du bouton "Copier dans le presse-papier"

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : TalkBack/VoiceOver actif ; police agrandie ; contraste eleve ; export prealable reussi (bouton "Copier" visible).
- **Etapes** :
  1. Apres export, faire defiler le focus jusqu'au bouton "Copier dans le presse-papier".
  2. Ecouter l'annonce du role, du label et du hint.
  3. Double-taper pour copier.
  4. Verifier l'apparition et l'annonce du bouton "Effacer le presse-papier".
- **Resultat attendu** : le lecteur annonce "Copier dans le presse-papier, bouton" + hint = avertissement presse-papier (`t('privacy.export.warning')`). Apres activation, le nouveau bouton "Effacer le presse-papier" est focusable et annonce. Labels lisibles en grande police, contraste conforme (variant ghost sur fond sombre — verifier la lisibilite).
- **Critere d'acceptation (OK/KO)** : OK si label+hint annonces et bouton "Effacer" focusable apres copie. KO si hint manquant, bouton non focusable, ou contraste insuffisant du variant ghost.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; police "Tres grand".
- **Duree estimee** : 4 min

### PRIV-EXPORT-007 - Effacement du presse-papier (hygiene PII)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard ; export reussi PUIS copie effectuee (bouton "Effacer le presse-papier" visible, `copied === true`).
- **Etapes** :
  1. Apres une copie, taper "Effacer le presse-papier".
  2. Coller dans une autre app pour controle.
- **Resultat attendu** : `Clipboard.setStringAsync('')` est appele (presse-papier vide). Le bouton "Effacer le presse-papier" disparait (`copied` repasse a false) ; le bouton "Copier dans le presse-papier" reste disponible pour re-copier. Le collage dans une autre app ne restitue plus l'archive.
- **Critere d'acceptation (OK/KO)** : OK si presse-papier vide apres tap ET bouton "Effacer" masque. KO si l'archive subsiste au presse-papier ou si le bouton "Effacer" reste affiche.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; verifier presse-papier vide par collage.
- **Duree estimee** : 2 min

### PRIV-EXPORT-008 - Effacer : best-effort en cas d'echec + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard ; bouton "Effacer le presse-papier" visible ; forcer `Clipboard.setStringAsync('')` a rejeter (acces presse-papier bloque).
- **Etapes** :
  1. Forcer le rejet de `Clipboard.setStringAsync`.
  2. Taper "Effacer le presse-papier" 5 fois rapidement.
- **Resultat attendu** : le handler avale l'erreur (catch best-effort, pas d'alerte) et met quand meme `copied = false` -> le bouton "Effacer" disparait sans crash ni alerte. Multi-clic sans effet de bord (idempotent). Comportement attendu : aucune `Alert` n'est levee sur l'echec d'effacement (contrairement a la copie).
- **Critere d'acceptation (OK/KO)** : OK si pas de crash, pas d'alerte, et bouton "Effacer" masque apres tap. KO si crash, alerte affichee, ou bouton qui reste.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; mock rejet `Clipboard.setStringAsync('')`.
- **Duree estimee** : 3 min

### PRIV-EXPORT-009 - Accessibilite + retour navigation (sortie d'ecran)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ; TalkBack/VoiceOver actif ; police agrandie ; arrive sur l'ecran "Exporter mes donnees".
- **Etapes** :
  1. Ouvrir l'ecran ; verifier que le titre "Exporter mes donnees" est annonce comme entete (focus initial).
  2. Parcourir au focus la carte description1 / description2 / note (textes RGPD).
  3. Declencher le retour : geste de retour (swipe edge iOS) ou bouton back Android / geste TalkBack "retour".
- **Resultat attendu** : le titre et les textes de la carte sont focusables et lus integralement (defilement si police agrandie). Le retour ramene a l'ecran Confidentialite (pile Settings) sans perte d'etat de la navigation parente. Aucun bouton de retour custom n'est rendu par cet ecran (verifier : le retour passe par le mecanisme natif).
- **Critere d'acceptation (OK/KO)** : OK si textes lus + retour fonctionnel vers Confidentialite. KO si textes non focusables, troncature bloquante en grande police, ou retour casse.
- **Donnees de test** : compte `qa.standard@chathouse.test` ; police "Tres grand".
- **Duree estimee** : 3 min

### PRIV-EXPORT-010 - Export accessible aux roles guest et admin (non gating)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : tester successivement avec un compte guest puis un compte admin connectes ; Wi-Fi stable.
- **Etapes** :
  1. Avec un compte guest, ouvrir Reglages -> Confidentialite -> "Exporter mes donnees" et taper "Generer et partager mon export".
  2. Repeter avec un compte admin.
  3. Verifier que l'archive guest ne contient PAS le journal d'audit ni les signalements emis contre le compte (cf. note ecran, RGPD art. 23).
- **Resultat attendu** : l'export reussit pour guest comme pour admin (aucun 403, aucun gating role). L'archive respecte le perimetre annonce par `note` : profil, rooms, participations, abonnements, DM, messages room, RSVP, appareils (sans token), preferences notif ; PAS de journal de moderation ni signalements.
- **Critere d'acceptation (OK/KO)** : OK si les deux roles obtiennent un export RGPD valide et que le journal d'audit/signalements sont exclus. KO si un role est bloque (403) ou si l'archive contient des donnees de moderation exclues.
- **Donnees de test** : `qa.guest@chathouse.test`, `qa.admin@chathouse.test`. Verifier l'absence des cles `auditLog` / `reportsAgainst` dans le JSON exporte.
- **Duree estimee** : 5 min
