# 12 - Liste d'attente (`auth`)

## Contexte ecran

- **Route** : `Waitlist` dans `AuthNavigator` (`src/core/navigation/AuthNavigator.tsx`), pile de pre-authentification (`createNativeStackNavigator`).
- **Fichier** : `src/features/auth/screens/WaitlistScreen/WaitlistScreen.tsx`.
- **En-tete natif** : AUCUN. Le `Stack.Navigator` de l'auth force `headerShown: false`. Il n'y a donc pas de fleche retour native ni de barre de titre : la seule sortie est le bouton "Retour" rendu dans le corps de l'ecran.
- **Roles requis** : `guest` (l'utilisateur n'a pas encore d'acces a l'app ; il est en file d'attente, donc non encore promu `standard`). L'ecran est strictement pre-auth, accessible sans session active.
- **Comportements temps-reel** : AUCUN sur cet ecran. Pas de WebSocket, pas de LiveKit, pas d'abonnement push declenche ici. L'ecran est purement informatif + une action de partage systeme (`Share.share` natif iOS/Android). La promesse "We'll let you know the moment a spot opens up" est une promesse produit hors-ecran (push backend), pas un flux observable depuis cet ecran.
- **Pre-conditions globales** : l'ecran est statique, ne fait aucun appel reseau au montage. Il s'affiche meme hors-ligne. Le bouton "Inviter un ami" ouvre la feuille de partage native du systeme (ne necessite pas de reseau pour s'ouvrir ; le reseau depend de l'app de partage choisie ensuite).
- **Etats de donnees** : aucun etat de liste, pas de notion de "vide / non lus / hors-ligne" cote contenu — l'ecran rend toujours le meme contenu fixe (icone sablier, titre, sous-titre, 2 boutons). Le seul etat variable est la langue active (FR/EN) qui change les libelles.
- **i18n / libelles** : les cles `auth.waitlist.title`, `auth.waitlist.subtitle`, `auth.waitlist.invite`, `auth.waitlist.shareMessage` ne sont PAS presentes dans `fr.json` / `en.json` ; les chaines de repli (fallback) inline du code sont donc rendues telles quelles en anglais (ex : "You're on the waitlist", "Invite a friend"). Seule la cle `common.back` existe reellement -> "Retour" (FR) / "Back" (EN). C'est important pour les locators : le bouton invite porte le nom accessible "Invite a friend" quelle que soit la langue, tandis que le bouton retour suit la langue.
- **Composant Button** : `src/shared/components/Button/Button.tsx` rend un `Pressable` avec `accessibilityRole="button"` ; le nom accessible vient du `label`. Un haptique leger (`Haptics.impactAsync`) est declenche au `onPressIn` (sauf si desactive/loading).

## Matrice bouton

| #   | Bouton         | Emplacement                                      | Type                                     | Locator reel                                                                                                                   | Pre-condition                                       | Priorite |
| --- | -------------- | ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------- |
| 1   | Inviter un ami | Corps, barre d'action bas (bloc `w-full gap-sm`) | submit (ouvre feuille de partage native) | role `button`, nom accessible = `t('auth.waitlist.invite', 'Invite a friend')` -> "Invite a friend" (fallback inline, anglais) | Aucune (fonctionne hors-ligne pour ouvrir la sheet) | P1       |
| 2   | Retour         | Corps, barre d'action bas, sous le bouton invite | navigation (`navigation.goBack()`)       | role `button`, nom accessible = `t('common.back', 'Back')` -> "Retour" (FR) / "Back" (EN)                                      | Une route precedente dans la pile auth              | P1       |

Note : l'icone sablier (`MaterialIcons name="hourglass-empty"`) est purement decorative, non pressable (pas de `onPress`, pas de `Pressable`) — elle n'est donc pas un element interactif et n'apparait pas dans la matrice.

## Cas de test

### AUTH-WAIT-001 - Ouvrir la feuille de partage via "Inviter un ami"

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `guest` en liste d'attente, ecran Waitlist affiche, reseau Wi-Fi, au moins une app de partage installee (Messages/Mail). Aucune permission speciale requise.
- **Etapes** :
  1. Atteindre l'ecran `Waitlist` (fin du flux d'inscription quand le backend place l'utilisateur en file d'attente).
  2. Verifier la presence de l'icone sablier, du titre "You're on the waitlist" et du sous-titre.
  3. Taper sur le bouton "Invite a friend".
  4. Observer l'ouverture de la feuille de partage native (`Share.share`).
- **Resultat attendu** : la feuille de partage systeme s'ouvre, pre-remplie avec le message d'invitation contenant l'URL `https://app.chathouse.com`. Aucune navigation, l'ecran Waitlist reste monte derriere la sheet.
- **Critere d'acceptation (OK/KO)** : OK si la sheet s'ouvre avec `url: 'https://app.chathouse.com'` et le message d'invitation ; KO si rien ne se passe ou si l'app crashe.
- **Donnees de test** : payload attendu `{ message: "J'attends mon accès à Chathouse — rejoins la waitlist pour m'aider à passer devant : https://app.chathouse.com", url: "https://app.chathouse.com" }` (le `message` est le fallback inline anglais/FR selon `t`).
- **Duree estimee** : 3 min

### AUTH-WAIT-002 - Multi-clic rapide + annulation/echec de partage sur "Inviter un ami"

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `guest`, ecran Waitlist affiche, reseau variable (tester en 4G puis en mode avion).
- **Etapes** :
  1. Sur l'ecran Waitlist, taper TRES rapidement 5 fois de suite sur "Invite a friend".
  2. Quand la feuille de partage s'ouvre, la fermer/annuler (swipe down ou bouton Annuler) sans rien partager.
  3. Repeter le tap une fois en mode avion (hors-ligne).
  4. Observer le comportement.
- **Resultat attendu** : une seule feuille de partage est presentee (le systeme empile/ignore les appels redondants — pas de double sheet ni de freeze). L'annulation est avalee silencieusement (bloc `catch` no-op) : pas de toast d'erreur, pas de crash, l'ecran reste sur Waitlist. En hors-ligne la sheet s'ouvre quand meme (Share est local) ; seul l'envoi via l'app tierce echouera plus loin, hors de notre perimetre.
- **Critere d'acceptation (OK/KO)** : OK si aucun crash, aucune navigation parasite, et l'ecran Waitlist reste affiche apres annulation et apres multi-clic ; KO si l'app gele, ouvre plusieurs sheets superposees ou affiche une erreur.
- **Donnees de test** : tap x5 < 1s ; action de partage = annulation. Simuler echec via mock `Share.share` rejete (`new Error('User did not share')`) en test automatise — comportement attendu : no-op.
- **Duree estimee** : 5 min

### AUTH-WAIT-003 - Accessibilite lecteur d'ecran + police agrandie sur "Inviter un ami"

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `guest`, ecran Waitlist affiche. Activer TalkBack (Android) ou VoiceOver (iOS). Regler la taille de police systeme au maximum et activer le contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au bouton d'invitation.
  3. Ecouter l'annonce vocale.
  4. Double-taper pour activer.
  5. Repasser en police XXL + contraste eleve et verifier la lisibilite du titre, du sous-titre et des libelles boutons.
- **Resultat attendu** : le lecteur annonce "Invite a friend, bouton" (role `button` expose par le composant Button). Le double-tap ouvre la feuille de partage. En police agrandie, le libelle bouton reste sur une ligne (`numberOfLines={1}`) sans etre tronque de maniere illisible ; le sous-titre (max-width 300) reste lisible ; le contraste primary/ink reste suffisant (>= 4.5:1 sur le texte).
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, annonce son role et son nom, activable au double-tap, et reste lisible en police max ; KO si le bouton est ignore par le lecteur, annonce sans role, ou si le libelle devient illisible/tronque.
- **Donnees de test** : TalkBack ON ; taille de police = "Le plus grand" ; contraste eleve ON.
- **Duree estimee** : 5 min

### AUTH-WAIT-004 - Retour vers l'etape precedente via "Retour"

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `guest`, ecran Waitlist atteint depuis une route precedente de la pile auth (ex : Username/Name), reseau Wi-Fi.
- **Etapes** :
  1. Etre sur l'ecran Waitlist avec au moins un ecran precedent dans la pile.
  2. Taper sur le bouton "Retour" (FR) / "Back" (EN).
  3. Observer la transition.
- **Resultat attendu** : `navigation.goBack()` est appele une fois ; l'app revient a l'ecran precedent de la pile auth avec l'animation `slide_from_right` inverse. Aucune feuille de partage n'apparait.
- **Critere d'acceptation (OK/KO)** : OK si on revient exactement a l'ecran precedent ; KO si l'app reste sur Waitlist ou navigue vers un mauvais ecran.
- **Donnees de test** : pile = [..., PrevScreen, Waitlist].
- **Duree estimee** : 2 min

### AUTH-WAIT-005 - Multi-clic rapide sur "Retour" + pile vide / perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `guest`, ecran Waitlist. Tester un cas ou Waitlist est la racine de la pile (pas d'ecran precedent) et un cas en mode avion.
- **Etapes** :
  1. Taper rapidement 4 fois de suite sur "Retour".
  2. Repeter le test en s'assurant que Waitlist est le seul ecran de la pile (root).
  3. Repeter en mode avion.
- **Resultat attendu** : un seul retour effectif (les taps surnumeraires sont ignores une fois l'ecran demonte, pas de double pop ni de crash). Si Waitlist est racine, `goBack()` est un no-op gere par React Navigation (rien ne se passe, pas de crash). Le mode avion n'a aucun impact (navigation locale, aucune dependance reseau).
- **Critere d'acceptation (OK/KO)** : OK si aucun crash, au plus un retour effectif, comportement identique hors-ligne ; KO si double navigation, crash, ou ecran noir.
- **Donnees de test** : tap x4 < 1s ; pile = [Waitlist] (root) ; reseau = mode avion.
- **Duree estimee** : 4 min

### AUTH-WAIT-006 - Accessibilite lecteur d'ecran + police agrandie sur "Retour"

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `guest`, ecran Waitlist. TalkBack/VoiceOver actif, langue FR (pour valider le libelle "Retour"), police max, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran, langue de l'appareil = Francais.
  2. Balayer jusqu'au bouton retour.
  3. Ecouter l'annonce.
  4. Double-taper pour activer.
  5. Verifier la lisibilite du libelle en police XXL.
- **Resultat attendu** : le lecteur annonce "Retour, bouton" (variant `ghost`, role `button`). Le double-tap declenche le retour. Le libelle ghost reste lisible et contraste suffisant meme en police max ; ordre de focus logique (titre -> sous-titre -> Invite a friend -> Retour).
- **Critere d'acceptation (OK/KO)** : OK si focusable, annonce role+nom localise, activable, lisible ; KO sinon.
- **Donnees de test** : VoiceOver/TalkBack ON ; langue = FR ; police = max ; contraste eleve ON.
- **Duree estimee** : 4 min

### AUTH-WAIT-007 - Coherence multi-langue des libelles (FR/EN) sur les deux boutons

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `guest`, ecran Waitlist. Pouvoir basculer la langue de l'app entre EN et FR.
- **Etapes** :
  1. Lancer l'app en anglais ; ouvrir Waitlist ; relever les libelles.
  2. Basculer en francais ; revenir sur Waitlist ; relever les libelles.
  3. Comparer.
- **Resultat attendu** : le titre/sous-titre et le bouton "Invite a friend" restent en anglais dans les DEUX langues (cles `auth.waitlist.*` absentes des locales -> fallback inline anglais). Le bouton retour suit la langue : "Back" en EN, "Retour" en FR. Comportement attendu connu (defaut produit a corriger si la localisation FR du contenu waitlist est requise), pas un crash.
- **Critere d'acceptation (OK/KO)** : OK si "Retour"/"Back" se localise et que les autres libelles restent stables sans casser la mise en page ; KO si un libelle apparait comme cle brute (ex : "auth.waitlist.title") ou si l'ecran crashe.
- **Donnees de test** : langue = en ; puis langue = fr.
- **Duree estimee** : 4 min

### AUTH-WAIT-008 - Robustesse au montage hors-ligne + rotation

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `guest`, mode avion AVANT d'atteindre l'ecran, possibilite de tourner l'appareil.
- **Etapes** :
  1. Passer en mode avion.
  2. Atteindre l'ecran Waitlist.
  3. Verifier l'affichage complet (icone, titre, sous-titre, 2 boutons).
  4. Tourner l'appareil portrait -> paysage -> portrait.
  5. Re-tester un tap sur "Invite a friend".
- **Resultat attendu** : l'ecran s'affiche entierement hors-ligne (aucun appel reseau au montage), respecte les safe-area insets (padding top/bottom), survit a la rotation sans perte d'etat ni chevauchement. La feuille de partage s'ouvre toujours.
- **Critere d'acceptation (OK/KO)** : OK si rendu complet et stable hors-ligne et apres rotation ; KO si elements coupes, chevauchement, ou ecran vide.
- **Donnees de test** : reseau = mode avion ; orientation = portrait/paysage.
- **Duree estimee** : 4 min

> Remarque temps-reel : aucun cas "Temps-reel multi-utilisateur" n'est applicable a cet ecran — il n'emet ni ne recoit aucun evenement WebSocket/LiveKit/push (cf. Contexte). La notification d'ouverture de place ("a spot opens up") est un push backend hors perimetre de cet ecran et fera l'objet d'un cas dans la suite Notifications, pas ici.
