# 38 - Politique de confidentialite (`privacy`)

## Contexte ecran

- **Route** : `PrivacyPolicy` (sans parametre, `undefined`). L'ecran est enregistre **deux fois** :
  - dans l'`AuthNavigator` (`AuthStackParamList`), atteint en **pre-auth** depuis `PhoneScreen` via `navigation.navigate('PrivacyPolicy')` (lien « Politique de confidentialite » du bas de l'ecran telephone) ;
  - dans le `SettingsNavigator` (`SettingsStackParamList`), atteint en **post-auth** depuis `SettingsScreen` via `goPrivacyPolicy` (`navigation.navigate('PrivacyPolicy')`).
- **Composant** : `PrivacyPolicyScreen.tsx`. Document legal **statique, en lecture seule**, embarque dans l'app (volontairement pas une URL distante : fonctionne hors-ligne et la version vue par l'utilisateur correspond a celle revue au build).
- **Roles requis** : aucun role privilegie. Accessible a un visiteur non authentifie (`guest`, via l'AuthStack) comme a un utilisateur authentifie (`standard`, `admin`, via le SettingsStack). C'est une page RGPD ouverte a tous.
- **Comportements temps-reel** : **AUCUN**. L'ecran ne fait aucun appel reseau, ne lit aucun store, n'ouvre aucune WebSocket/LiveKit, n'emet/recoit aucun push. Il n'affiche que des chaines i18n statiques (`t('privacy.policy.*')`) dans la mise en page partagee `LegalDoc`.
- **Pre-conditions globales** : aucune. Le contenu est identique en ligne, hors-ligne, en 4G ou en avion — aucune donnee distante n'est requise. La langue affichee (FR/EN) depend de la locale i18n active.
- **Etats de donnees pertinents** : sans objet (pas de liste, pas de « non lus », pas d'etat vide, pas d'etat de chargement, pas d'etat d'erreur reseau). Le seul « etat » est la position de defilement et la langue active.

### Note importante sur l'interactivite

Cet ecran ne contient **litteralement aucun bouton, toggle, champ de saisie, lien actionnable, FAB ni cellule pressable**. Inspection du code (`PrivacyPolicyScreen.tsx` + composants `LegalDoc` / `LegalSection` / `LegalParagraph` / `LegalEmail`) :

- tout est rendu via `<Text>` et `<View>` non pressables dans un `<ScrollView>` ;
- l'adresse e-mail `privacy@chathouse.app` (composant `LegalEmail`) est un **simple `<Text>` colore** (couleur primaire) — **PAS** un lien : aucun `onPress`, aucun `accessibilityRole="link"`, aucun `Linking.openURL`. Elle n'ouvre donc pas le client mail ;
- les deux navigateurs declarent `headerShown: false` → **aucun bouton retour natif rendu dans un header**. Le retour se fait exclusivement par le **geste de retour natif** (swipe iOS / bouton materiel Android) du native-stack.

Conformement a la consigne « ecran legal en lecture seule », on traite donc au minimum : l'**affordance de retour** (geste / bouton materiel), la **zone de defilement** (ScrollView) et le **texte e-mail** (selectionnable mais non actionnable). Le test confirme cette absence d'interactivite (`PrivacyPolicyScreen.test.tsx` n'asserte que la presence de textes, aucun `fireEvent.press`).

## Matrice bouton

| #   | Bouton                                             | Emplacement                                                   | Type                                       | Locator reel                                                                                                                           | Pre-condition                                          | Priorite |
| --- | -------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| 1   | Retour (geste swipe iOS / bouton materiel Android) | Geste systeme / hors-UI (header masque, `headerShown:false`)  | navigation                                 | Aucun locator dans l'app (affordance OS native du native-stack) ; cible = ecran appelant (`Phone` ou `Settings`)                       | Etre arrive sur l'ecran via navigation (pile non vide) | P1       |
| 2   | Defilement du document (ScrollView)                | Corps (conteneur scrollable plein ecran)                      | list-item (zone scrollable, non-pressable) | `ScrollView` racine de `LegalDoc` (pas de testID ; identifiable par `accessibilityRole="header"` du titre `t('privacy.policy.title')`) | Contenu plus haut que le viewport                      | P2       |
| 3   | Adresse e-mail de contact (texte, NON actionnable) | Corps, section 7 « Contact » (`t('privacy.policy.s7.title')`) | link (apparence lien mais inerte)          | Texte litteral `privacy@chathouse.app` (composant `LegalEmail`, sans `onPress`)                                                        | Avoir defile jusqu'a la section 7                      | P2       |

## Cas de test

### PRIV-POLICY-001 - Retour vers l'ecran appelant depuis l'AuthStack (pre-auth)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte = guest (non authentifie) ; reseau indifferent (Wi-Fi) ; aucune permission requise ; etre sur `PhoneScreen` puis avoir tape le lien « Politique de confidentialite ».
- **Etapes** :
  1. Lancer l'app, depuis Landing aller sur `Phone`.
  2. Taper le lien « Politique de confidentialite » en bas de `PhoneScreen` → l'ecran `PrivacyPolicy` s'ouvre.
  3. Verifier que le titre `Politique de confidentialite` (FR) est affiche en haut.
  4. Declencher le retour : swipe depuis le bord gauche (iOS) ou bouton materiel Retour (Android).
- **Resultat attendu** : l'ecran `PrivacyPolicy` se ferme avec l'animation `slide_from_right` inverse et l'app revient exactement sur `PhoneScreen`, dans l'etat ou il etait laisse (numero saisi conserve). Aucun crash, aucun double-pop.
- **Critere d'acceptation (OK/KO)** : OK si l'utilisateur revient sur `Phone` (et non sur Landing ou un ecran blanc) ; KO sinon.
- **Donnees de test** : compte guest ; numero pre-saisi `+33612345678`.
- **Duree estimee** : 2 min

### PRIV-POLICY-002 - Retour : multi-pop rapide + retour materiel repete (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard (authentifie) ; reseau Wi-Fi puis bascule mode avion ; etre sur `PrivacyPolicy` via `Settings → Confidentialite → Politique de confidentialite`.
- **Etapes** :
  1. Ouvrir `Settings`, taper l'entree menant a `PrivacyPolicy` (`goPrivacyPolicy`).
  2. Activer le mode avion (hors-ligne) — le contenu doit rester intact (document statique embarque).
  3. Declencher le geste de retour **3 fois tres rapidement** (Android : appuis materiels repetes ; iOS : swipes successifs).
  4. Observer la pile de navigation.
- **Resultat attendu** : un seul pop effectif vers `Settings` ; les appuis supplementaires sont absorbes par le native-stack sans depiler au-dela de `Settings` ni provoquer d'ecran blanc / fermeture inattendue de l'app. Le passage hors-ligne n'altere ni le contenu ni la navigation (aucune dependance reseau).
- **Critere d'acceptation (OK/KO)** : OK si l'app reste stable sur `Settings` apres la rafale et que le mode avion n'a degrade ni l'affichage ni le retour ; KO si crash, double-pop au-dela de `Settings`, ou ecran blanc.
- **Donnees de test** : compte standard `+33611111111` / OTP de test `000000`.
- **Duree estimee** : 3 min

### PRIV-POLICY-003 - Retour accessible au lecteur d'ecran + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte guest ou standard ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; theme sombre par defaut de l'app.
- **Etapes** :
  1. Activer TalkBack/VoiceOver et la police « tres grande » dans les reglages systeme.
  2. Ouvrir `PrivacyPolicy`.
  3. Balayer pour atteindre le premier element : le titre, expose avec `accessibilityRole="header"` (titre `Politique de confidentialite`).
  4. Effectuer le geste de retour standard du lecteur d'ecran (TalkBack : geste retour ; VoiceOver : « zigzag » 2 doigts).
  5. Verifier le retour vers l'ecran appelant et l'annonce vocale de ce dernier.
- **Resultat attendu** : le titre du document et chaque titre de section (`s1..s7`) sont annonces comme en-tetes (role `header`) ; le texte ne deborde pas / reste lisible avec la police max (`ScrollView` defilable) ; le contraste texte/fond reste suffisant ; le geste retour ramene proprement a l'ecran appelant qui est ensuite annonce.
- **Critere d'acceptation (OK/KO)** : OK si les 8 en-tetes (titre + 7 sections) sont navigables au rotor/headings et le retour fonctionne au geste lecteur d'ecran ; KO si un en-tete est annonce comme simple texte ou si le retour ne fonctionne pas sous lecteur d'ecran.
- **Donnees de test** : compte guest ; locale FR.
- **Duree estimee** : 4 min

### PRIV-POLICY-004 - Defilement complet du document (fonctionnel positif)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte guest ou standard ; reseau indifferent ; etre sur `PrivacyPolicy`.
- **Etapes** :
  1. Ouvrir `PrivacyPolicy`.
  2. Verifier l'affichage du titre `Politique de confidentialite` et de la ligne « Derniere mise a jour : 25 avril 2026 ».
  3. Faire defiler de haut en bas (swipe vertical) jusqu'au bas du document.
  4. Verifier la presence successive des 7 titres de section : « 1. Quelles donnees nous collectons » … « 7. Contact ».
  5. Verifier que la section 7 affiche le texte de contact et l'adresse `privacy@chathouse.app`.
- **Resultat attendu** : tout le contenu est accessible par defilement, sans coupe ni chevauchement ; le `paddingBottom` (insets bas + giant) laisse l'adresse e-mail entierement visible en fin de defilement. Aucun spinner ni etat de chargement (contenu statique).
- **Critere d'acceptation (OK/KO)** : OK si les 7 sections + l'e-mail sont visibles apres defilement ; KO si du texte est tronque, inaccessible, ou si un etat de chargement apparait.
- **Donnees de test** : locale FR (titres tels que ci-dessus). En EN : verifier les equivalents `privacy.policy.s1.title`…`s7.title`.
- **Duree estimee** : 2 min

### PRIV-POLICY-005 - Defilement : inertie / multi-fling rapide + rotation ecran (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte indifferent ; reseau indifferent ; etre sur `PrivacyPolicy` ; rotation d'ecran autorisee par l'appareil.
- **Etapes** :
  1. Ouvrir `PrivacyPolicy`.
  2. Enchainer **plusieurs flings verticaux tres rapides** (haut/bas) sans laisser l'inertie se terminer.
  3. Pendant le defilement, faire pivoter l'appareil portrait → paysage → portrait.
  4. Relacher et observer la position finale et la mise en page.
- **Resultat attendu** : aucun crash ni saut visuel aberrant ; apres rotation le contenu se re-dispose (paddings horizontaux conserves) et reste integralement defilable ; la position de defilement reste coherente (pas de blocage en zone vide). Aucune requete reseau declenchee par le defilement.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran reste stable et entierement lisible apres rafale de flings + rotations ; KO si crash, contenu fige, ou zone blanche persistante.
- **Donnees de test** : sans objet (contenu statique).
- **Duree estimee** : 3 min

### PRIV-POLICY-006 - Defilement accessible (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte indifferent ; TalkBack/VoiceOver actif ; police systeme maximale ; theme sombre.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police max.
  2. Ouvrir `PrivacyPolicy`.
  3. Naviguer element par element (balayage) du titre jusqu'a la fin du document ; le focus doit faire defiler automatiquement le `ScrollView` pour suivre l'element annonce.
  4. Verifier que chaque paragraphe (`p1..pN`) est annonce integralement et que les en-tetes de section sont annonces avec le role `header`.
  5. Verifier le contraste du texte attenue (`textMuted`) sur fond sombre avec un outil de contraste.
- **Resultat attendu** : tous les paragraphes et titres sont atteignables et lisibles au lecteur d'ecran avec police agrandie (le `ScrollView` suit le focus) ; aucun texte coupe ; contraste conforme (cible WCAG AA pour le corps de texte legal).
- **Critere d'acceptation (OK/KO)** : OK si l'integralite du document est navigable au lecteur d'ecran avec police max sans perte de contenu ; KO si un paragraphe est inatteignable, tronque, ou en sous-contraste.
- **Donnees de test** : locale FR ; verifier au moins `privacy.policy.s1.p1` et `privacy.policy.s5.p5` (assertions du test unitaire).
- **Duree estimee** : 4 min

### PRIV-POLICY-007 - Adresse e-mail de contact : presence et apparence (fonctionnel positif)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte indifferent ; reseau indifferent ; etre sur `PrivacyPolicy`, section 7 visible.
- **Etapes** :
  1. Ouvrir `PrivacyPolicy` et defiler jusqu'a la section « 7. Contact ».
  2. Verifier le texte introductif « Pour toute question relative a vos donnees : » suivi de l'adresse `privacy@chathouse.app`.
  3. Verifier que l'adresse est rendue dans la couleur primaire (style `email`) au sein du paragraphe.
- **Resultat attendu** : l'adresse `privacy@chathouse.app` est affichee, en couleur primaire, inline dans le paragraphe de contact ; le texte est correct et sans faute.
- **Critere d'acceptation (OK/KO)** : OK si le texte litteral `privacy@chathouse.app` est present et colore ; KO si absent, mal orthographie, ou non distingue visuellement.
- **Donnees de test** : chaine attendue exacte = `privacy@chathouse.app` (asseree telle quelle dans `PrivacyPolicyScreen.test.tsx`).
- **Duree estimee** : 1 min

### PRIV-POLICY-008 - Adresse e-mail : tap n'ouvre PAS le client mail (erreur/limite)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte indifferent ; reseau indifferent ; client mail installe sur l'appareil ; etre sur la section 7.
- **Etapes** :
  1. Defiler jusqu'a l'adresse `privacy@chathouse.app`.
  2. **Taper plusieurs fois rapidement** directement sur l'adresse.
  3. Effectuer un appui long sur l'adresse.
  4. Observer le comportement.
- **Resultat attendu** : aucun client mail ne s'ouvre, aucune action de navigation, aucun feedback de pression (l'element n'a pas d'`onPress` ni `accessibilityRole="link"`). L'appui long peut au plus declencher la selection de texte native, jamais une intention `mailto:`. Les taps multiples n'ont aucun effet cumule. C'est le comportement **attendu** : l'adresse est purement informative.
- **Critere d'acceptation (OK/KO)** : OK si aucun client mail / aucune navigation ne se declenche, meme apres taps repetes ; KO si un client mail s'ouvre (cela signalerait un comportement non prevu par le code actuel) ou si l'app crashe.
- **Donnees de test** : sans objet.
- **Duree estimee** : 2 min

### PRIV-POLICY-009 - Adresse e-mail accessible (lecteur d'ecran + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte indifferent ; TalkBack/VoiceOver actif ; police systeme maximale ; theme sombre.
- **Etapes** :
  1. Activer le lecteur d'ecran et la police max.
  2. Ouvrir `PrivacyPolicy`, naviguer jusqu'a la section 7.
  3. Mettre le focus sur le paragraphe de contact contenant l'adresse.
  4. Ecouter l'annonce et verifier qu'aucun role « lien »/« bouton » n'est annonce (puisque l'element est inerte).
- **Resultat attendu** : le lecteur d'ecran annonce le paragraphe de contact suivi de l'adresse comme **texte** (pas comme lien ni bouton, conforme au code) ; l'adresse reste lisible en police max sans troncature ; le contraste couleur primaire / fond sombre reste lisible.
- **Critere d'acceptation (OK/KO)** : OK si l'adresse est annoncee comme texte lisible, sans role interactif trompeur ; KO si annoncee comme lien/bouton actionnable (incoherence avec l'implementation) ou tronquee.
- **Donnees de test** : adresse = `privacy@chathouse.app`.
- **Duree estimee** : 3 min

### PRIV-POLICY-010 - Coherence i18n FR/EN du document (fonctionnel positif)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte indifferent ; bascule de langue disponible (reglages app/systeme) ; etre sur `PrivacyPolicy`.
- **Etapes** :
  1. Ouvrir `PrivacyPolicy` en FR : verifier le titre « Politique de confidentialite » et les 7 titres de section FR.
  2. Basculer la langue de l'app en EN (puis rouvrir l'ecran si necessaire).
  3. Verifier que titre, ligne « last updated », 7 titres de section et adresse e-mail s'affichent en EN sans cle brute (`privacy.policy.*`) visible.
  4. Verifier qu'aucune chaine ne reste en FR par erreur et inversement.
- **Resultat attendu** : toutes les chaines proviennent des cles `privacy.policy.title`, `privacy.policy.lastUpdated`, `privacy.policy.sN.title`, `privacy.policy.sN.pN` ; aucune cle non resolue n'apparait ; l'adresse e-mail reste `privacy@chathouse.app` dans les deux langues.
- **Critere d'acceptation (OK/KO)** : OK si FR et EN affichent un texte traduit complet, sans cle brute ni melange de langues ; KO si une cle `privacy.policy.*` apparait litteralement ou si une section reste non traduite.
- **Donnees de test** : cles de reference `privacy.policy.s1.title` … `privacy.policy.s7.title`, `privacy.policy.s1.p1`, `privacy.policy.s5.p5` ; valeur FR du titre = « Politique de confidentialite ».
- **Duree estimee** : 3 min
